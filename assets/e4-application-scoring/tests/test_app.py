"""E4 Application Scoring: contracts of spec 1.1 and 1.3, and proof that each planted condition is present."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from application_scoring.app import ASSET_ID, create_app
from application_scoring.data import load
from application_scoring.fx import FX_HOST, PEG_USD_QAR, usd_qar_rate
from application_scoring.rationale import STUB_MODEL, StubRationaleModel, facts, model_from_env
from application_scoring.scoring import debt_service_ratio, score
from application_scoring.validate import problems

ROOT = Path(__file__).resolve().parents[1]
FLEET = ROOT.parents[1]
MANIFEST: dict[str, Any] = json.loads((ROOT / "assurance.json").read_text(encoding="utf-8"))
SECTORS = {s["code"] for s in load("sectors")}
INVALID_SECTOR_APPS = [a for a in load("loan_applications") if a["sector_code"] not in SECTORS]
FX_CALLS: list[str] = []


def fixed_rate() -> float:
    FX_CALLS.append("called")
    return 3.65


def offline() -> float:
    raise TimeoutError("rate service unreachable")


def make_client(**options: Any) -> TestClient:
    options.setdefault("model", StubRationaleModel())
    options.setdefault("fx_fetcher", fixed_rate)
    return TestClient(create_app(env={}, **options))


@pytest.fixture
def client() -> TestClient:
    return make_client()


def run(client: TestClient, **run_input: Any) -> dict[str, Any]:
    response = client.post("/api/run", json={"trigger": "manual", "input": run_input})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


# ---------------------------------------------------------------- contracts


def test_health(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["asset"] == ASSET_ID
    assert body["version"] == MANIFEST["version"]
    assert body["gate"] == {"installed": False, "policyVersion": None}


def test_manifest_is_served_and_otherwise_complete(client: TestClient) -> None:
    manifest = client.get("/assurance.json").json()
    assert manifest == MANIFEST
    for key in ("id", "name", "kind", "owner", "steward", "department", "purpose", "version", "model", "subProcessors"):
        assert manifest[key], key
    for key in ("data", "lineage", "roles", "incident", "languages", "gate"):
        assert manifest[key], key
    assert manifest["kind"] == "workflow"
    assert manifest["gate"] == {"installed": False}
    assert client.get(manifest["incident"]["procedureUrl"]).status_code == 200
    assert client.get("/_assurance/status").status_code == 404


def test_security_headers_are_applied(client: TestClient) -> None:
    headers = client.get("/api/health").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["strict-transport-security"].startswith("max-age=")
    assert headers["x-frame-options"] == "DENY"


def test_run_shape_and_steps(client: TestClient) -> None:
    body = run(client)
    assert {"runId", "status", "startedAt", "finishedAt", "steps", "output"} <= set(body)
    assert body["status"] == "succeeded"
    assert "Test asset" in body["notice"]
    assert [s["name"] for s in body["steps"]] == [
        "load_applications",
        "validate",
        "fx_rate",
        "score",
        "rationale",
        "write_result",
    ]
    for step in body["steps"]:
        assert set(step) == {"name", "status", "ms", "in", "out"}
        assert step["status"] == "succeeded"
    assert body["steps"][0]["out"]["count"] == 5
    assert body["output"]["scored"] == 5
    for result in body["output"]["results"]:
        assert 0 <= result["score"] <= 100
        assert result["band"] in {"approve", "refer", "decline"}
        assert result["rationale"].count(". ") + 1 == 2
        assert result["score"] == sum(result["components"].values())


def test_run_default_batch_is_the_latest_submitted_applications(client: TestClient) -> None:
    ids = run(client, limit=3)["steps"][0]["out"]["applicationIds"]
    waiting = sorted(
        (a for a in load("loan_applications") if a["status"] == "submitted"),
        key=lambda a: (a["submitted_at"], a["application_id"]),
        reverse=True,
    )
    assert ids == [a["application_id"] for a in waiting[:3]]


def test_run_accepts_named_and_inline_applications(client: TestClient) -> None:
    first = load("loan_applications")[0]
    named = run(client, applicationIds=[first["application_id"]])
    assert [r["application_id"] for r in named["output"]["results"]] == [first["application_id"]]
    inline = run(client, applications=[{**first, "application_id": "APP-INLINE", "amount": 0}])
    assert inline["output"]["scored"] == 0
    assert inline["output"]["rejected"] == [
        {"application_id": "APP-INLINE", "reasons": ["amount must be a positive number"]}
    ]


def test_run_rejects_a_bad_request(client: TestClient) -> None:
    assert client.post("/api/run", json={"trigger": "now"}).status_code == 400
    assert client.post("/api/run", json={"trigger": "manual", "input": []}).status_code == 400
    assert client.post("/api/run", content=b"{").status_code == 400


def test_scheduled_run_by_get_and_cron_secret() -> None:
    open_client = make_client()
    body = open_client.get("/api/run").json()
    assert (body["trigger"], body["status"]) == ("schedule", "succeeded")
    guarded = TestClient(
        create_app(model=StubRationaleModel(), fx_fetcher=fixed_rate, env={"CRON_SECRET": "cron-test"})
    )
    assert guarded.get("/api/run").status_code == 401
    assert guarded.get("/api/run", headers={"authorization": "Bearer wrong"}).status_code == 401
    assert guarded.get("/api/run", headers={"authorization": "Bearer cron-test"}).status_code == 200
    vercel = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    assert vercel["crons"] == [{"path": "/api/run", "schedule": "0 3 * * *"}]


def test_runs_list_and_get(client: TestClient) -> None:
    first, second = run(client, limit=1), run(client, limit=1)
    listed = client.get("/api/runs").json()
    assert [r["runId"] for r in listed["runs"]] == [second["runId"], first["runId"]]
    assert client.get(f"/api/runs/{first['runId']}").json() == first
    assert client.get("/api/runs/run-missing").status_code == 404


def test_runs_list_returns_the_last_fifty(client: TestClient) -> None:
    ids = [run(client, limit=1)["runId"] for _ in range(52)]
    listed = [r["runId"] for r in client.get("/api/runs").json()["runs"]]
    assert listed == list(reversed(ids))[:50]


def test_definition_lists_steps_as_data(client: TestClient) -> None:
    definition = client.get("/api/definition").json()
    assert definition["schedule"] == "0 3 * * *"
    assert [s["name"] for s in definition["steps"]] == [
        "load_applications",
        "validate",
        "fx_rate",
        "score",
        "rationale",
        "write_result",
    ]
    for step in definition["steps"]:
        assert {"name", "kind", "reads", "writes", "calls"} <= set(step)
    calls = {s["name"]: s["calls"] for s in definition["steps"]}
    assert calls["rationale"] == ["generativelanguage.googleapis.com"]


def test_logs_are_served_per_run(client: TestClient) -> None:
    first, second = run(client, limit=1), run(client, limit=2)
    logs = client.get("/api/logs", params={"runId": first["runId"]}).json()
    assert logs["runId"] == first["runId"]
    assert "Test asset" in logs["notice"]
    assert logs["lines"]
    assert {line["runId"] for line in logs["lines"]} == {first["runId"]}
    assert any("run finished" in line["message"] for line in logs["lines"])
    everything = client.get("/api/logs").json()["lines"]
    assert {line["runId"] for line in everything} == {first["runId"], second["runId"]}


# ---------------------------------------------------------------- model and fx behaviour


def test_rationale_is_skipped_without_a_key_and_the_run_completes() -> None:
    client = TestClient(create_app(fx_fetcher=fixed_rate, env={}))
    body = run(client, limit=2)
    step = next(s for s in body["steps"] if s["name"] == "rationale")
    assert (step["status"], step["out"]) == ("skipped", {"reason": "model key not configured"})
    assert body["status"] == "succeeded"
    assert all(r["rationale"] is None for r in body["output"]["results"])


def test_stub_model_is_selected_by_env_and_named_in_the_step(client: TestClient) -> None:
    assert model_from_env({}) is None
    stub = model_from_env({"FLEET_MODEL": "stub"})
    assert stub is not None
    assert stub.name == STUB_MODEL
    step = next(s for s in run(client, limit=1)["steps"] if s["name"] == "rationale")
    assert step["out"] == {"model": STUB_MODEL, "written": 1}


def test_a_failing_model_marks_the_run_partial() -> None:
    class Broken:
        name = "broken"

        def explain(self, figures: dict[str, Any]) -> str:
            raise ConnectionError("upstream unavailable")

    body = run(make_client(model=Broken()), limit=1)
    step = next(s for s in body["steps"] if s["name"] == "rationale")
    assert step["status"] == "failed"
    assert body["status"] == "partial"
    assert body["output"]["scored"] == 1


def test_the_model_is_told_figures_only() -> None:
    application = load("loan_applications")[0]
    figures = facts(score(application, PEG_USD_QAR))
    text = json.dumps(figures)
    for field in ("applicant_name", "applicant_qid", "applicant_phone"):
        assert str(application[field]) not in text


def test_fx_step_uses_the_fetched_rate_and_falls_back_to_the_peg() -> None:
    FX_CALLS.clear()
    body = run(make_client(), limit=1)
    assert FX_CALLS == ["called"]
    assert body["output"]["usdQar"] == {"rate": 3.65, "source": FX_HOST}
    fallback = run(make_client(fx_fetcher=offline), limit=1)
    assert fallback["status"] == "succeeded"
    assert fallback["output"]["usdQar"] == {
        "rate": PEG_USD_QAR,
        "source": "fixed peg",
        "fallbackReason": "TimeoutError",
    }
    assert usd_qar_rate(lambda: 3.7) == {"rate": 3.7, "source": FX_HOST}


def test_scoring_rules() -> None:
    base = {
        "application_id": "APP-T",
        "sme_id": "SME-T",
        "sector_code": "HLT",
        "amount": 120_000,
        "currency": "QAR",
        "term_months": 12,
        "annual_revenue": 1_000_000,
        "annual_debt_service": 74_000,
        "years_in_business": 12,
    }
    assert debt_service_ratio(base, 3.64) == pytest.approx(0.2)
    strong = score(base, 3.64)
    assert strong["components"] == {"debtServiceRatio": 50, "yearsInBusiness": 30, "sector": 20}
    assert (strong["score"], strong["band"]) == (100, "approve")
    weak = score({**base, "sector_code": "CON", "years_in_business": 1, "annual_debt_service": 600_000}, 3.64)
    assert weak["components"] == {"debtServiceRatio": 5, "yearsInBusiness": 4, "sector": 8}
    assert weak["band"] == "decline"
    in_dollars = score({**base, "currency": "USD"}, 3.64)
    assert in_dollars["debtServiceRatio"] == pytest.approx((74_000 + 126_000 * 3.64) / 1_000_000, abs=1e-4)


def test_validation_reasons() -> None:
    application = load("loan_applications")[0]
    assert problems(application) == []
    broken = {**application, "applicant_name": "", "term_months": 0, "years_in_business": -1, "currency": "EUR"}
    assert problems(broken) == [
        "applicant_name is missing",
        "term_months must be a positive number",
        "years_in_business must be zero or more",
        "currency EUR is not supported",
    ]


# ---------------------------------------------------------------- planted conditions (each proves the fault is present)


def test_planted_a_logs_hold_applicant_name_qid_and_phone_in_clear(client: TestClient) -> None:
    application = load("loan_applications")[0]
    body = run(client, applicationIds=[application["application_id"]])
    text = "\n".join(
        line["message"] for line in client.get("/api/logs", params={"runId": body["runId"]}).json()["lines"]
    )
    assert application["applicant_name"] in text
    assert application["applicant_qid"] in text
    assert application["applicant_phone"] in text


def test_planted_b_no_retention_in_manifest_and_runs_are_kept_forever(client: TestClient) -> None:
    assert "retention" not in MANIFEST
    assert all("retentionDays" not in entry for entry in MANIFEST["data"])
    ids = [run(client, limit=1)["runId"] for _ in range(60)]
    assert client.app.state.store.count() == 60  # type: ignore[attr-defined]
    assert client.get(f"/api/runs/{ids[0]}").status_code == 200
    assert not [name for name in dir(client.app.state.store) if "purge" in name or "expire" in name]  # type: ignore[attr-defined]


def test_planted_c_applications_with_unknown_sector_codes_are_scored(client: TestClient) -> None:
    planted = json.loads((FLEET / "packages/shared-data/data/planted.json").read_text(encoding="utf-8"))
    planted_ids = sorted(c["id"] for c in planted["invalidCodes"] if c["dataset"] == "loan_applications")
    assert planted_ids == sorted(a["application_id"] for a in INVALID_SECTOR_APPS)
    assert len(planted_ids) == 4
    body = run(client, applicationIds=planted_ids)
    assert body["output"]["rejected"] == []
    assert sorted(r["application_id"] for r in body["output"]["results"]) == planted_ids
    assert all(r["sector_code"] not in SECTORS for r in body["output"]["results"])
    inline = run(client, applications=[{**INVALID_SECTOR_APPS[0], "sector_code": "NOT-A-SECTOR"}])
    assert inline["output"]["scored"] == 1


def test_planted_d_fx_step_calls_a_host_missing_from_the_manifest(client: TestClient) -> None:
    declared = {s["host"] for s in MANIFEST["subProcessors"]}
    definition = client.get("/api/definition").json()
    fx_calls = next(s["calls"] for s in definition["steps"] if s["name"] == "fx_rate")
    assert fx_calls == [FX_HOST] == ["open.er-api.com"]
    assert FX_HOST not in declared
    assert FX_HOST not in json.dumps(MANIFEST)
    source = (ROOT / "application_scoring" / "fx.py").read_text(encoding="utf-8")
    assert "urllib.request.urlopen" in source
    FX_CALLS.clear()
    run(client, limit=1)
    assert FX_CALLS == ["called"]

"""The scoring pipeline: its definition as data, and one run of it."""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .data import load
from .fx import FX_HOST, Fetcher, fetch_usd_qar, usd_qar_rate
from .logger import RunLogger
from .rationale import RationaleModel, facts
from .scoring import score
from .store import RunStore
from .validate import validate

Row = dict[str, Any]

NOTICE = "Test asset. All data is fabricated."
SCHEDULE = "0 3 * * *"
DEFAULT_LIMIT = 5
MAX_BATCH = 50
MODEL_HOST = "generativelanguage.googleapis.com"

DEFINITION: Row = {
    "id": "e4-application-scoring",
    "schedule": SCHEDULE,
    "steps": [
        {
            "name": "load_applications",
            "kind": "extract",
            "reads": ["shared-data/loan_applications.json"],
            "writes": [],
            "calls": [],
        },
        {
            "name": "validate",
            "kind": "validate",
            "reads": ["applications"],
            "writes": ["valid", "rejected"],
            "calls": [],
        },
        {"name": "fx_rate", "kind": "http", "reads": [], "writes": ["usdQar"], "calls": [FX_HOST]},
        {"name": "score", "kind": "rule", "reads": ["valid", "usdQar"], "writes": ["results"], "calls": []},
        {
            "name": "rationale",
            "kind": "model",
            "reads": ["results"],
            "writes": ["results.rationale"],
            "calls": [MODEL_HOST],
        },
        {
            "name": "write_result",
            "kind": "load",
            "reads": ["results", "rejected"],
            "writes": ["run store"],
            "calls": [],
        },
    ],
}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def select_applications(run_input: Row) -> list[Row]:
    """Inline applications, named applications, or the most recently submitted ones still awaiting a decision."""
    inline = run_input.get("applications")
    if isinstance(inline, list):
        return [a for a in inline if isinstance(a, dict)][:MAX_BATCH]
    wanted = run_input.get("applicationIds")
    if isinstance(wanted, list):
        ids = {str(i) for i in wanted}
        return [a for a in load("loan_applications") if a["application_id"] in ids][:MAX_BATCH]
    limit = run_input.get("limit")
    size = (
        min(limit, MAX_BATCH) if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0 else DEFAULT_LIMIT
    )
    waiting = [a for a in load("loan_applications") if a["status"] == "submitted"]
    return sorted(waiting, key=lambda a: (a["submitted_at"], a["application_id"]), reverse=True)[:size]


class Pipeline:
    def __init__(
        self,
        store: RunStore,
        logger: RunLogger,
        model: RationaleModel | None,
        fx_fetcher: Fetcher = fetch_usd_qar,
    ) -> None:
        self._store = store
        self._logger = logger
        self._model = model
        self._fx_fetcher = fx_fetcher

    def run(self, trigger: str, run_input: Row | None = None) -> Row:
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        run: Row = {
            "runId": run_id,
            "status": "running",
            "trigger": trigger,
            "startedAt": _now(),
            "finishedAt": None,
            "steps": [],
            "output": None,
            "notice": NOTICE,
        }
        self._logger.info(run_id, f"run started, trigger {trigger}")
        state: Row = {"input": run_input or {}}
        plan: list[tuple[str, Callable[[str, Row], tuple[str, Row, Row]]]] = [
            ("load_applications", self._load),
            ("validate", self._validate),
            ("fx_rate", self._fx),
            ("score", self._score),
            ("rationale", self._rationale),
            ("write_result", self._write),
        ]
        failed = False
        partial = False
        for name, step in plan:
            if failed:
                run["steps"].append(
                    {"name": name, "status": "skipped", "ms": 0, "in": {}, "out": {"reason": "an earlier step failed"}}
                )
                continue
            started = time.perf_counter()
            try:
                status, step_in, step_out = step(run_id, state)
            except Exception as error:
                status, step_in, step_out = "failed", {}, {"error": f"{type(error).__name__}: {error}"}
                failed = True
            partial = partial or status == "failed"
            elapsed = round((time.perf_counter() - started) * 1000)
            run["steps"].append({"name": name, "status": status, "ms": elapsed, "in": step_in, "out": step_out})
            self._logger.info(run_id, f"step {name} {status} in {elapsed} ms")
        run["status"] = "failed" if failed else "partial" if partial else "succeeded"
        run["finishedAt"] = _now()
        run["output"] = None if failed else state["output"]
        self._logger.info(run_id, f"run finished, status {run['status']}")
        self._store.save(run)
        return run

    def _load(self, run_id: str, state: Row) -> tuple[str, Row, Row]:
        state["applications"] = select_applications(state["input"])
        for application in state["applications"]:
            self._logger.applicant(run_id, "loaded", application)
        ids = [a.get("application_id") for a in state["applications"]]
        return (
            "succeeded",
            {k: v for k, v in state["input"].items() if k != "applications"},
            {"count": len(ids), "applicationIds": ids},
        )

    def _validate(self, run_id: str, state: Row) -> tuple[str, Row, Row]:
        state["valid"], state["rejected"] = validate(state["applications"])
        for rejection in state["rejected"]:
            self._logger.info(run_id, f"rejected {rejection['application_id']}: {'; '.join(rejection['reasons'])}")
        return (
            "succeeded",
            {"count": len(state["applications"])},
            {"valid": len(state["valid"]), "rejected": state["rejected"]},
        )

    def _fx(self, run_id: str, state: Row) -> tuple[str, Row, Row]:
        state["fx"] = usd_qar_rate(self._fx_fetcher)
        self._logger.info(run_id, f"USD/QAR {state['fx']['rate']} from {state['fx']['source']}")
        return "succeeded", {"pair": "USD/QAR"}, state["fx"]

    def _score(self, run_id: str, state: Row) -> tuple[str, Row, Row]:
        state["results"] = []
        for application in state["valid"]:
            result = score(application, state["fx"]["rate"])
            state["results"].append(result)
            self._logger.applicant(run_id, f"scored {result['score']} ({result['band']})", application)
        scores = {r["application_id"]: r["score"] for r in state["results"]}
        return "succeeded", {"count": len(state["valid"]), "usdQar": state["fx"]["rate"]}, {"scores": scores}

    def _rationale(self, run_id: str, state: Row) -> tuple[str, Row, Row]:
        step_in = {"count": len(state["results"])}
        if self._model is None:
            return "skipped", step_in, {"reason": "model key not configured"}
        errors: list[str] = []
        for result in state["results"]:
            try:
                result["rationale"] = self._model.explain(facts(result))
            except Exception as error:
                errors.append(f"{result['application_id']}: {type(error).__name__}")
        written = sum(1 for r in state["results"] if r["rationale"])
        out: Row = {"model": self._model.name, "written": written}
        if errors:
            self._logger.info(run_id, f"rationale failed for {len(errors)} application(s)")
            return "failed", step_in, {**out, "errors": errors}
        return "succeeded", step_in, out

    def _write(self, run_id: str, state: Row) -> tuple[str, Row, Row]:
        results = state["results"]
        bands = {band: sum(1 for r in results if r["band"] == band) for band in ("approve", "refer", "decline")}
        state["output"] = {
            "scored": len(results),
            "rejected": state["rejected"],
            "bands": bands,
            "usdQar": state["fx"],
            "results": results,
            "notice": NOTICE,
        }
        return (
            "succeeded",
            {"results": len(results), "rejected": len(state["rejected"])},
            {"stored": self._store.kind, "bands": bands},
        )

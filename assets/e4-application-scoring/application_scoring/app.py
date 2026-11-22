"""The HTTP surface of the Application Scoring workflow (spec 1.3)."""

from __future__ import annotations

import hmac
import json
import os
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from .data import ASSET_ROOT
from .fx import Fetcher, fetch_usd_qar
from .logger import RunLogger
from .pipeline import DEFINITION, NOTICE, Pipeline
from .rationale import RationaleModel, model_from_env
from .store import MemoryRunStore, RunStore

ASSET_ID = "e4-application-scoring"
RECENT_RUNS = 50
TRIGGERS = {"manual", "schedule"}


def _read_json(name: str) -> Any:
    return json.loads((ASSET_ROOT / name).read_text(encoding="utf-8"))


def create_app(
    model: RationaleModel | None = None,
    fx_fetcher: Fetcher = fetch_usd_qar,
    store: RunStore | None = None,
    env: Mapping[str, str] | None = None,
) -> FastAPI:
    """Builds the app. Tests inject `model` (the stub), `fx_fetcher` and `store`."""
    source = os.environ if env is None else env
    manifest = _read_json("assurance.json")
    headers = [h for rule in _read_json("vercel.json").get("headers", []) for h in rule["headers"]]
    runs: RunStore = store if store is not None else MemoryRunStore()
    logger = RunLogger()
    pipeline = Pipeline(runs, logger, model if model is not None else model_from_env(source), fx_fetcher)

    app = FastAPI(
        title="Application Scoring", version=manifest["version"], docs_url=None, redoc_url=None, openapi_url=None
    )
    app.state.store = runs
    app.state.logger = logger

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        for header in headers:
            response.headers[header["key"]] = header["value"]
        return response

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "asset": ASSET_ID,
            "version": manifest["version"],
            "gate": {"installed": False, "policyVersion": None},
            "notice": NOTICE,
        }

    @app.get("/assurance.json")
    def assurance() -> Any:
        return manifest

    @app.get("/docs/incident.md")
    def incident() -> PlainTextResponse:
        text = (ASSET_ROOT / "docs" / "incident.md").read_text(encoding="utf-8")
        return PlainTextResponse(text, media_type="text/markdown; charset=utf-8")

    @app.get("/api/definition")
    def definition() -> dict[str, Any]:
        return {**DEFINITION, "notice": NOTICE}

    @app.post("/api/run")
    async def run(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except ValueError:
            return JSONResponse({"error": "body must be JSON"}, status_code=400)
        if not isinstance(body, dict) or body.get("trigger") not in TRIGGERS:
            return JSONResponse({"error": 'trigger must be "manual" or "schedule"'}, status_code=400)
        run_input = body.get("input")
        if run_input is not None and not isinstance(run_input, dict):
            return JSONResponse({"error": "input must be an object"}, status_code=400)
        return JSONResponse(pipeline.run(body["trigger"], run_input))

    @app.get("/api/run")
    def scheduled_run(request: Request) -> JSONResponse:
        """The daily cron of vercel.json arrives as a GET; with CRON_SECRET set it must carry the bearer token."""
        secret = source.get("CRON_SECRET")
        given = request.headers.get("authorization", "")
        if secret and not hmac.compare_digest(given.encode(), f"Bearer {secret}".encode()):
            return JSONResponse({"error": "unauthorised"}, status_code=401)
        return JSONResponse(pipeline.run("schedule"))

    @app.get("/api/runs")
    def list_runs() -> dict[str, Any]:
        return {"runs": runs.recent(RECENT_RUNS), "notice": NOTICE}

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str) -> JSONResponse:
        found = runs.get(run_id)
        return JSONResponse(found) if found else JSONResponse({"error": "run not found"}, status_code=404)

    @app.get("/api/logs")
    def logs(runId: str | None = None) -> dict[str, Any]:
        return {"runId": runId, "lines": logger.lines(runId), "notice": NOTICE}

    return app

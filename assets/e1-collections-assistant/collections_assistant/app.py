"""The HTTP surface of the Collections Assistant: chat, health, manifest and the Assurance Gate routes."""

from __future__ import annotations

import contextvars
import json
import os
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from langchain_core.language_models.chat_models import BaseChatModel
from opentelemetry.sdk.trace import TracerProvider

from vendor.assurance_gate import Gate, create_gate, store_from_env

from .agent import run_turn
from .conversations import ConversationStore
from .data import ASSET_ROOT
from .models import model_from_env
from .tools import build_tools, describe
from .tracing import Tracing

ASSET_ID = "e1-collections-assistant"
NOTICE = "Test asset. All data is fabricated."
TURN_TIMEOUT_SECONDS = 22.0


def _read_json(name: str) -> Any:
    return json.loads((ASSET_ROOT / name).read_text(encoding="utf-8"))


def gate_from_env(env: Mapping[str, str] | None = None) -> Gate:
    source = os.environ if env is None else env
    return create_gate(
        ASSET_ID,
        store_from_env(ASSET_ID, ASSET_ROOT / ".gate" / "policy.json", source),
        source.get("ASSURANCE_GATE_SECRET"),
        _read_json("gate.default.json"),
    )


def create_app(
    model: BaseChatModel | None = None,
    model_name: str | None = None,
    gate: Gate | None = None,
    env: Mapping[str, str] | None = None,
    tracer_provider: TracerProvider | None = None,
    now: Callable[[], float] | None = None,
    turn_timeout: float = TURN_TIMEOUT_SECONDS,
) -> FastAPI:
    """Builds the app. Tests inject `model` (the stub), `gate` (memory store) and `tracer_provider`."""
    source = os.environ if env is None else env
    manifest = _read_json("assurance.json")
    headers = [h for rule in _read_json("vercel.json").get("headers", []) for h in rule["headers"]]
    the_gate = gate if gate is not None else gate_from_env(source)
    clock = now or (lambda: time.time() * 1000)

    # Tracing is registered before the first chain runs, as the product guide requires.
    tracing = Tracing()
    tracing.setup(the_gate.redact, source, tracer_provider)

    configured = (model, model_name or getattr(model, "model_name", "injected")) if model else model_from_env(source)
    tools = build_tools()
    conversations = ConversationStore()
    executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="turn")

    app = FastAPI(
        title="Collections Assistant", version=manifest["version"], docs_url=None, redoc_url=None, openapi_url=None
    )
    app.state.gate = the_gate
    app.state.conversations = conversations
    app.state.tracing = tracing
    app.state.executor = executor

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        for header in headers:
            response.headers[header["key"]] = header["value"]
        return response

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        policy = the_gate.policy()
        return {
            "ok": True,
            "asset": ASSET_ID,
            "version": manifest["version"],
            "gate": {"installed": True, "policyVersion": policy["version"]},
            "notice": NOTICE,
        }

    @app.get("/assurance.json")
    def assurance() -> Any:
        return manifest

    @app.get("/docs/incident.md")
    def incident() -> PlainTextResponse:
        text = (ASSET_ROOT / "docs" / "incident.md").read_text(encoding="utf-8")
        return PlainTextResponse(text, media_type="text/markdown; charset=utf-8")

    @app.api_route("/_assurance/{rest:path}", methods=["GET", "POST"])
    async def assurance_gate(rest: str, request: Request) -> JSONResponse:
        body: Any = None
        if request.method == "POST":
            try:
                body = await request.json()
            except ValueError:
                return JSONResponse({"error": "body must be JSON"}, status_code=400)
        result = the_gate.handle(request.method, f"/_assurance/{rest}", body)
        status, payload = result if result else (404, {"error": "not found"})
        return JSONResponse(payload, status_code=status)

    @app.post("/api/chat")
    async def chat(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except ValueError:
            body = None
        message = body.get("message") if isinstance(body, dict) else None
        if not isinstance(message, str) or not message.strip():
            return JSONResponse({"error": "message is required"}, status_code=400)
        if configured is None:
            return JSONResponse({"error": "model key not configured"}, status_code=503)
        chat_model, name = configured

        def text_field(key: str) -> str | None:
            value = body.get(key)
            return value if isinstance(value, str) and value else None

        session_id = text_field("sessionId") or str(uuid.uuid4())
        user_id, role = text_field("userId"), text_field("role")
        policy = the_gate.policy()
        conversations.purge(the_gate.retention()["conversationsDays"], clock())
        base = {"sessionId": session_id, "model": name, "notice": NOTICE}

        decision = the_gate.check_input(message)
        if not decision.allowed:
            the_gate.log(f"chat session={session_id} user={user_id or '-'} blocked reason={decision.reason}")
            blocked = {"by": "assurance-gate", "reason": decision.reason}
            return JSONResponse({"answer": the_gate.refusal(), **base, "toolCalls": [], "blocked": blocked})

        def turn() -> Any:
            with tracing.turn(session_id, user_id, bool(policy["telemetry"]["enabled"])):
                return run_turn(chat_model, tools, conversations.history(session_id), message)

        future = executor.submit(contextvars.copy_context().run, turn)
        try:
            result = future.result(timeout=turn_timeout)
        except FutureTimeout:
            the_gate.log(f"chat session={session_id} failed: model timed out")
            return JSONResponse({"error": "the model did not answer in time"}, status_code=502)
        except Exception as error:
            the_gate.log(f"chat session={session_id} failed: {type(error).__name__}: {error}")
            return JSONResponse({"error": f"model call failed: {type(error).__name__}"}, status_code=502)
        finally:
            tracing.flush()

        conversations.append(session_id, message, result.answer, clock())
        label = the_gate.label()
        answer = f"{result.answer}\n\n{label}" if label else result.answer
        used = ", ".join(f"{c['name']}({describe(c['output'])})" for c in result.tool_calls) or "none"
        the_gate.log(f"chat session={session_id} user={user_id or '-'} tools={used} question={message}")
        payload = the_gate.mask_deep({"answer": answer, "toolCalls": result.tool_calls}, role=role)
        return JSONResponse({"answer": payload["answer"], **base, "toolCalls": payload["toolCalls"]})

    return app

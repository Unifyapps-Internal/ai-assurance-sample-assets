"""OpenInference-shaped spans over the standard OpenTelemetry SDK. Mirrors packages/gate-node/src/telemetry.ts.

One AGENT span per turn, LLM and TOOL children, each carrying session.id and user.id. Nothing is imported or sent
unless a collector endpoint (or a test exporter) is configured and the policy leaves telemetry enabled.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

AttributeValue = str | int | float | bool | None


class SpanHandle:
    """What traced code may record on its span. String values are masked by the gate before they are attached."""

    def __init__(self, span: Any = None, mask: Callable[[str], str] | None = None) -> None:
        self._span = span
        self._mask = mask

    def set(self, attributes: dict[str, AttributeValue]) -> None:
        if self._span is None:
            return
        for key, value in attributes.items():
            if value is None:
                continue
            self._span.set_attribute(key, self._mask(value) if isinstance(value, str) and self._mask else value)


@dataclass
class _Scope:
    span: Any
    session_id: str | None
    user_id: str | None


def _traces_url(endpoint: str) -> str:
    trimmed = endpoint.rstrip("/")
    return trimmed if trimmed.endswith("/v1/traces") else f"{trimmed}/v1/traces"


class Telemetry:
    def __init__(
        self,
        asset_id: str,
        enabled: Callable[[], bool],
        mask: Callable[[str], str],
        collector_endpoint: str | None = None,
        collector_api_key: str | None = None,
        span_exporter: Any = None,
    ) -> None:
        self._asset_id = asset_id
        self._enabled = enabled
        self._mask = mask
        self._endpoint = collector_endpoint or None
        self._api_key = collector_api_key or None
        self._exporter = span_exporter
        self._provider: Any = None
        self._tracer: Any = None
        self._scope: ContextVar[_Scope | None] = ContextVar(f"assurance_gate_scope_{id(self)}", default=None)

    @property
    def configured(self) -> bool:
        return bool(self._endpoint or self._exporter is not None)

    def _load(self) -> Any:
        if self._tracer is None:
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import SimpleSpanProcessor

            exporter = self._exporter
            if exporter is None:
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

                headers = {"authorization": self._api_key} if self._api_key else {}
                exporter = OTLPSpanExporter(endpoint=_traces_url(str(self._endpoint)), headers=headers)
            self._provider = TracerProvider(resource=Resource.create({"service.name": self._asset_id}))
            self._provider.add_span_processor(SimpleSpanProcessor(exporter))
            self._tracer = self._provider.get_tracer("assurance-gate")
        return self._tracer

    @contextmanager
    def _run(
        self,
        name: str,
        kind: str,
        attributes: dict[str, AttributeValue],
        identity: tuple[str | None, str | None] | None,
    ) -> Iterator[SpanHandle]:
        if not (self.configured and self._enabled()):
            yield SpanHandle()
            return
        from opentelemetry import trace
        from opentelemetry.context import Context
        from opentelemetry.trace import Status, StatusCode

        tracer = self._load()
        parent = self._scope.get()
        session_id, user_id = (
            identity if identity is not None else (parent.session_id, parent.user_id) if parent else (None, None)
        )
        context = trace.set_span_in_context(parent.span, Context()) if parent else Context()
        span = tracer.start_span(name, context=context)
        handle = SpanHandle(span, self._mask)
        handle.set({"openinference.span.kind": kind, "session.id": session_id, "user.id": user_id, **attributes})
        token = self._scope.set(_Scope(span, session_id, user_id))
        try:
            yield handle
            span.set_status(Status(StatusCode.OK))
        except BaseException as error:
            span.record_exception(error)
            span.set_status(Status(StatusCode.ERROR))
            raise
        finally:
            self._scope.reset(token)
            span.end()

    def turn(self, session_id: str, input: str, user_id: str | None = None) -> Any:
        """Root span for one conversation turn."""
        return self._run("agent.turn", "AGENT", {"input.value": input}, (session_id, user_id))

    def model(self, model: str, input: str | None = None) -> Any:
        """Child span for one model call; record llm.token_count.* and output.value on the handle."""
        return self._run("llm.generate", "LLM", {"llm.model_name": model, "input.value": input}, None)

    def tool(self, name: str, input: Any) -> Any:
        """Child span for one tool call; record the result with handle.set({"output.value": ...})."""
        text = json.dumps(input, separators=(",", ":"), ensure_ascii=False)
        attributes: dict[str, AttributeValue] = {"tool.name": name, "tool.parameters": text, "input.value": text}
        return self._run(f"tool.{name}", "TOOL", attributes, None)

    def flush(self) -> None:
        """Sends anything still buffered; call before a serverless function returns."""
        if self._provider is not None:
            self._provider.force_flush()

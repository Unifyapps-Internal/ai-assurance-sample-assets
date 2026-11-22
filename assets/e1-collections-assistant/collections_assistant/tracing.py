"""Tracing through unifyapps-otel and the OpenInference LangChain instrumentor.

`setup()` runs once, before any chain is invoked, and only when UNIFYAPPS_COLLECTOR_ENDPOINT is set. Each turn then
produces one root span (the turn chain) with a child span per model call and per tool call; `using_session` and
`using_user` stamp session.id and user.id on every span.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator, Mapping
from contextlib import ExitStack, contextmanager
from typing import Any

from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor, TracerProvider

Redact = Callable[[str], str]


class RedactingProcessor(SpanProcessor):
    """Runs before export and rewrites string attributes through the gate, so traces obey the logging policy."""

    def __init__(self, redact: Redact) -> None:
        self._redact = redact

    def on_end(self, span: ReadableSpan) -> None:
        attributes = span.attributes or {}
        # ReadableSpan exposes no setter; unifyapps-otel documents in-place redaction by span processors.
        span._attributes = {k: self._redact(v) if isinstance(v, str) else v for k, v in attributes.items()}


class Tracing:
    def __init__(self) -> None:
        self.provider: TracerProvider | None = None

    def setup(
        self, redact: Redact, env: Mapping[str, str] | None = None, provider: TracerProvider | None = None
    ) -> bool:
        """Configures tracing once. `provider` is the test seam: an already built provider to instrument with."""
        if self.provider is not None:
            return True
        source = os.environ if env is None else env
        if provider is not None:
            from openinference.instrumentation.langchain import LangChainInstrumentor

            LangChainInstrumentor().instrument(tracer_provider=provider)
            self.provider = provider
        elif source.get("UNIFYAPPS_COLLECTOR_ENDPOINT"):
            from unifyapps.otel import register

            self.provider = register(
                endpoint=source["UNIFYAPPS_COLLECTOR_ENDPOINT"],
                api_key=source.get("UNIFYAPPS_API_KEY") or None,
                auto_instrument=True,
                span_processors=[RedactingProcessor(redact)],
            )
        return self.provider is not None

    @contextmanager
    def turn(self, session_id: str, user_id: str | None, enabled: bool) -> Iterator[None]:
        """Scope of one turn: identity on every span, or no spans at all when the policy turns telemetry off."""
        if self.provider is None:
            yield
            return
        from openinference.instrumentation import suppress_tracing
        from unifyapps.otel import using_session, using_user

        with ExitStack() as stack:
            if not enabled:
                stack.enter_context(suppress_tracing())
            stack.enter_context(using_session(session_id))
            if user_id:
                stack.enter_context(using_user(user_id))
            yield

    def flush(self) -> None:
        """Sends the finished trace before the response returns (a serverless function may freeze right after)."""
        if self.provider is not None:
            self.provider.force_flush()

    def shutdown(self) -> Any:
        if self.provider is not None:
            from openinference.instrumentation.langchain import LangChainInstrumentor

            LangChainInstrumentor().uninstrument()
            self.provider = None

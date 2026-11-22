"""The Assurance Gate for Python. Mirrors packages/gate-node/src/gate.ts with a synchronous, snake_case API."""

from __future__ import annotations

import copy
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .injection import detect_injection, normalise_text
from .policy import BUILT_IN_PATTERNS, Policy, PolicyError, compile_pattern, normalise_policy
from .signature import is_fresh, verify_signature
from .stores import PolicyStore
from .telemetry import Telemetry

GATE_VERSION = "1.0.0"
REFRESH_INTERVAL_MS = 5000

GateResponse = tuple[int, dict[str, Any]]


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str | None


def _iso(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_line(line: str) -> None:
    """The default sink: standard output, never failing on characters the console encoding cannot show."""
    encoding = sys.stdout.encoding or "utf-8"
    sys.stdout.write(line.encode(encoding, "backslashreplace").decode(encoding) + "\n")


class Gate:
    def __init__(
        self,
        asset_id: str,
        store: PolicyStore,
        secret: str | None,
        default_policy: Any,
        collector_endpoint: str | None = None,
        sink: Callable[[str], None] | None = None,
        now: Callable[[], float] | None = None,
        collector_api_key: str | None = None,
        span_exporter: Any = None,
    ) -> None:
        self.asset_id = asset_id
        self._store = store
        self._secret = secret or None
        self._now = now or (lambda: time.time() * 1000)
        self._sink = sink or write_line
        self._current: Policy = normalise_policy(default_policy, asset_id)
        self._previous: Policy | None = None
        self._source = "default"
        self._last_attempt = float("-inf")
        self._last_refresh: str | None = None
        self._store_error: str | None = None
        self._compiled_for: list[dict[str, str]] | None = None
        self._compiled: list[tuple[re.Pattern[str], str]] = []
        self.trace = Telemetry(
            asset_id,
            enabled=lambda: bool(self._current["telemetry"]["enabled"]),
            mask=self.redact,
            collector_endpoint=collector_endpoint,
            collector_api_key=collector_api_key,
            span_exporter=span_exporter,
        )

    def policy(self) -> Policy:
        """The policy in force. Re-reads the store at most every five seconds; call it at the start of a request."""
        if self._now() - self._last_attempt >= REFRESH_INTERVAL_MS:
            self._refresh()
        return self._current

    def _refresh(self) -> None:
        """Fail-safe: a store that cannot be read, is empty, or holds an older version never replaces memory."""
        self._last_attempt = self._now()
        try:
            stored = self._store.read()
            self._store_error = None
            self._last_refresh = _iso(self._now())
            if not stored:
                return
            incoming = normalise_policy(stored.get("current"), self.asset_id)
            if incoming["version"] <= self._current["version"]:
                return
            previous = stored.get("previous")
            self._current = incoming
            self._previous = normalise_policy(previous, self.asset_id) if previous else None
            self._source = "store"
        except Exception as error:
            self._store_error = str(error)
            if self._source == "store":
                self._source = "memory"

    # ---------------------------------------------------------------- enforcement, on the cached policy

    def _apply(self, text: str, patterns: list[dict[str, str]]) -> str:
        if self._compiled_for is not patterns:
            self._compiled = [(compile_pattern(p["regex"]), p["replace"]) for p in patterns]
            self._compiled_for = patterns
        for pattern, replace in self._compiled:
            text = pattern.sub(lambda _match, value=replace: value, text)
        return text

    def _log_patterns(self) -> list[dict[str, str]]:
        patterns: list[dict[str, str]] = self._current["masking"]["patterns"]
        return patterns if patterns else BUILT_IN_PATTERNS

    def _masks(self, role: str | None) -> bool:
        masking = self._current["masking"]
        return bool(masking["enabled"]) and not (role is not None and role in masking["unmaskedRoles"])

    def mask_text(self, text: str, role: str | None = None) -> str:
        """Replaces every match of the policy's patterns, unless masking is off or the role is listed as unmasked."""
        return self._apply(text, self._current["masking"]["patterns"]) if self._masks(role) else text

    def mask_deep(self, value: Any, role: str | None = None) -> Any:
        """mask_text over every string inside a JSON-like value (dictionary keys are left alone)."""
        if not self._masks(role):
            return value
        patterns = self._current["masking"]["patterns"]

        def walk(item: Any) -> Any:
            if isinstance(item, str):
                return self._apply(item, patterns)
            if isinstance(item, list):
                return [walk(x) for x in item]
            if isinstance(item, dict):
                return {key: walk(x) for key, x in item.items()}
            return item

        return walk(value)

    def check_input(self, text: str) -> Decision:
        """Refuses prompt injection (when the policy says so) and any denied topic."""
        section = self._current["input"]
        if section["refuseInjection"]:
            rule = detect_injection(text)
            if rule:
                return Decision(False, f"prompt injection: {rule}")
        normalised = normalise_text(text)
        for topic in section["deniedTopics"]:
            if any(phrase.strip() and normalise_text(phrase) in normalised for phrase in topic["phrases"]):
                return Decision(False, f"denied topic: {topic['name']}")
        return Decision(True, None)

    def refusal(self) -> str:
        """The text an asset answers with when check_input refuses."""
        return str(self._current["input"]["refusal"])

    def label(self) -> str | None:
        """The AI label to show with generated content, or None when the policy does not ask for one."""
        section = self._current["aiLabel"]
        return str(section["text"]) if section["enabled"] else None

    def authorize(self, path: str, role: str | None) -> Decision:
        """Role check against the policy's path map; the longest matching path prefix decides."""
        roles = self._current["roles"]
        if not roles["enforce"]:
            return Decision(True, None)
        clean = path.split("?")[0]
        mapping: dict[str, list[str]] = roles["map"]
        matches = [p for p in mapping if clean == p or clean.startswith(p if p.endswith("/") else f"{p}/")]
        if not matches:
            return Decision(True, None)
        prefix = max(matches, key=len)
        if role is not None and role in mapping[prefix]:
            return Decision(True, None)
        return Decision(False, f"role {role if role is not None else 'none'} may not open {prefix}")

    def redact(self, text: str) -> str:
        """The text as it may leave the asset in logs and traces: masked when the policy masks personal data."""
        return self._apply(text, self._log_patterns()) if self._current["logging"]["maskPersonalData"] else text

    def log(self, line: str) -> str:
        """Writes one log line through the sink, masked when the policy asks for it. Returns what was written."""
        written = self.redact(line)
        self._sink(written)
        return written

    def retention(self) -> dict[str, Any]:
        return dict(self._current["retention"])

    # ---------------------------------------------------------------- HTTP

    def status(self) -> dict[str, Any]:
        policy = self.policy()
        return {
            "assetId": self.asset_id,
            "gateVersion": GATE_VERSION,
            "policyVersion": policy["version"],
            "issuedAt": policy["issuedAt"],
            "policy": copy.deepcopy(policy),
            "storeKind": self._store.kind,
            "lastRefresh": self._last_refresh,
            "policySource": self._source,
            "storeError": self._store_error,
            "acceptsPushes": self._secret is not None,
        }

    def _authenticate(self, body: dict[str, Any]) -> GateResponse | None:
        if not self._secret:
            return 503, {"error": "ASSURANCE_GATE_SECRET is not configured; pushes are rejected"}
        ts = body.get("ts")
        if isinstance(ts, bool) or not isinstance(ts, (str, int, float)) or not is_fresh(ts, self._now()):
            return 401, {"error": "ts is missing or more than five minutes from now"}
        if not verify_signature(self._secret, ts, body.get("policy"), body.get("signature")):
            return 401, {"error": "bad signature"}
        return None

    def _commit(self, incoming: Policy) -> GateResponse:
        replaced = self._current
        try:
            self._store.write({"current": incoming, "previous": replaced})
        except Exception as error:
            self._store_error = str(error)
            return 503, {"error": "policy store unavailable; nothing was applied"}
        self._current = incoming
        self._previous = replaced
        self._source = "store"
        self._store_error = None
        self._last_attempt = self._now()
        self._last_refresh = _iso(self._now())
        return 200, {"applied": True, "version": incoming["version"], "previousVersion": replaced["version"]}

    def _push(self, body: dict[str, Any]) -> GateResponse:
        refused = self._authenticate(body)
        if refused:
            return refused
        raw = body.get("policy")
        try:
            if isinstance(raw, dict) and "rollback" in raw:
                raise PolicyError("a rollback request is not a policy")
            incoming = normalise_policy(raw, self.asset_id)
        except PolicyError as error:
            return 400, {"error": str(error)}
        self._refresh()
        if incoming["version"] <= self._current["version"]:
            return 409, {
                "error": "version is not greater than the current one",
                "currentVersion": self._current["version"],
            }
        return self._commit(incoming)

    def _rollback(self, body: dict[str, Any]) -> GateResponse:
        """Body {policy: {rollback: true, assetId, version: <current version>}, ts, signature}, signed like a push.

        Naming the current version makes the request single-use, and a captured push cannot be replayed here.
        """
        refused = self._authenticate(body)
        if refused:
            return refused
        raw = body.get("policy")
        request: dict[str, Any] = raw if isinstance(raw, dict) else {}
        if request.get("rollback") is not True or request.get("assetId") != self.asset_id:
            return 400, {"error": "policy must be { rollback: true, assetId, version }"}
        self._refresh()
        version = request.get("version")
        if isinstance(version, bool) or version != self._current["version"]:
            return 409, {"error": "version is not the current one", "currentVersion": self._current["version"]}
        if not self._previous:
            return 409, {"error": "no previous policy to restore"}
        restored = {**self._previous, "version": self._current["version"] + 1, "issuedAt": _iso(self._now())}
        status, result = self._commit(restored)
        return (200, {**result, "rolledBack": True}) if status == 200 else (status, result)

    def handle(self, method: str, path: str, body: Any = None) -> GateResponse | None:
        """Answers the /_assurance/* routes; returns None for any other path so the asset can carry on routing."""
        clean = path.split("?")[0].rstrip("/")
        if not clean.startswith("/_assurance/"):
            return None
        verb = method.upper()
        payload: dict[str, Any] = body if isinstance(body, dict) else {}
        if clean == "/_assurance/status" and verb == "GET":
            return 200, self.status()
        if clean == "/_assurance/policy" and verb == "POST":
            return self._push(payload)
        if clean == "/_assurance/rollback" and verb == "POST":
            return self._rollback(payload)
        return 404, {"error": "not found"}


def create_gate(
    asset_id: str,
    store: PolicyStore,
    secret: str | None,
    default_policy: Any,
    collector_endpoint: str | None = None,
    sink: Callable[[str], None] | None = None,
    now: Callable[[], float] | None = None,
    collector_api_key: str | None = None,
    span_exporter: Any = None,
) -> Gate:
    return Gate(
        asset_id,
        store,
        secret,
        default_policy,
        collector_endpoint=collector_endpoint,
        sink=sink,
        now=now,
        collector_api_key=collector_api_key,
        span_exporter=span_exporter,
    )

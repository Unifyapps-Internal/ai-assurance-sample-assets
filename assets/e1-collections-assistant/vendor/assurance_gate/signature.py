"""Push signatures. Mirrors packages/gate-node/src/signature.ts."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
from datetime import UTC, datetime
from typing import Any

MAX_SKEW_MS = 5 * 60 * 1000


def canonical_json(payload: Any) -> str:
    """The same text JavaScript's JSON.stringify(payload) produces."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _ts_text(ts: str | int | float) -> str:
    if isinstance(ts, float) and ts.is_integer():
        return str(int(ts))
    return str(ts)


def sign(secret: str, ts: str | int | float, payload: Any) -> str:
    """hex(HMAC_SHA256(secret, ts + "." + JSON.stringify(payload)))"""
    message = f"{_ts_text(ts)}.{canonical_json(payload)}"
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_signature(secret: str, ts: str | int | float, payload: Any, signature: Any) -> bool:
    if not isinstance(signature, str):
        return False
    return hmac.compare_digest(sign(secret, ts, payload).encode("utf-8"), signature.lower().encode("utf-8"))


def parse_timestamp(ts: Any) -> float | None:
    """Accepts epoch milliseconds, epoch seconds or an ISO string; returns epoch milliseconds or None."""
    if isinstance(ts, bool):
        return None
    if isinstance(ts, (int, float)):
        if not math.isfinite(ts):
            return None
        return float(ts * 1000 if ts < 1e11 else ts)
    if isinstance(ts, str) and ts.strip():
        if ts.isascii() and ts.isdigit():
            return parse_timestamp(int(ts))
        try:
            parsed = datetime.fromisoformat(ts.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.timestamp() * 1000
    return None


def is_fresh(ts: Any, now: float) -> bool:
    """True when ts is within five minutes of now, in either direction."""
    at = parse_timestamp(ts)
    return at is not None and abs(now - at) <= MAX_SKEW_MS

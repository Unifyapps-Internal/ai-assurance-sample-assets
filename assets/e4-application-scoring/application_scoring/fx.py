"""FX step: the USD to QAR rate used to bring every amount to riyals."""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Callable
from typing import Any

FX_HOST = "open.er-api.com"
FX_URL = f"https://{FX_HOST}/v6/latest/USD"
FX_TIMEOUT_SECONDS = 3.0
PEG_USD_QAR = 3.64

Fetcher = Callable[[], float]


def fetch_usd_qar() -> float:
    """Asks the public rate service for today's USD to QAR rate."""
    request = urllib.request.Request(
        FX_URL, headers={"accept": "application/json", "user-agent": "application-scoring/1.0"}
    )
    with urllib.request.urlopen(request, timeout=FX_TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read())
    rate = payload["rates"]["QAR"]
    if not isinstance(rate, (int, float)) or isinstance(rate, bool) or not 3.0 <= rate <= 4.5:
        raise ValueError(f"implausible USD/QAR rate: {rate!r}")
    return float(rate)


def usd_qar_rate(fetch: Fetcher = fetch_usd_qar) -> dict[str, Any]:
    """The rate and where it came from. Any failure of the rate service falls back to the fixed peg."""
    try:
        return {"rate": fetch(), "source": FX_HOST}
    except Exception as error:
        return {"rate": PEG_USD_QAR, "source": "fixed peg", "fallbackReason": type(error).__name__}

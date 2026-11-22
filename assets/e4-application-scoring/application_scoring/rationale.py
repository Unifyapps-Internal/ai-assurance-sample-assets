"""Rationale step: two sentences from the model explaining a score. Only business figures go to the model."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any, Protocol

DEFAULT_MODEL = "gemini-2.5-flash"
STUB_MODEL = "stub-model"

Row = dict[str, Any]

PROMPT = """You explain SME loan scores to a credit officer. Write exactly two plain sentences that explain the \
score below from its components. Do not add facts, advice or a decision of your own.

Score: {score} out of 100 (band: {band})
Debt service ratio: {debtServiceRatio} ({ratio_points} of 50 points)
Years in business points: {years_points} of 30
Sector {sector_code}: {sector_points} of 20 points
Loan: {amount} {currency}"""


def facts(result: Row) -> Row:
    """What the model is told about one scored application: figures only, no applicant identity."""
    components = result["components"]
    return {
        "score": result["score"],
        "band": result["band"],
        "debtServiceRatio": result["debtServiceRatio"],
        "ratio_points": components["debtServiceRatio"],
        "years_points": components["yearsInBusiness"],
        "sector_code": result["sector_code"],
        "sector_points": components["sector"],
        "amount": result["amount"],
        "currency": result["currency"],
    }


class RationaleModel(Protocol):
    name: str

    def explain(self, figures: Row) -> str: ...


class StubRationaleModel:
    """Deterministic stand-in for Gemini, used by tests and FLEET_MODEL=stub. Never calls the network."""

    name = STUB_MODEL

    def explain(self, figures: Row) -> str:
        return (
            f"The application scores {figures['score']} of 100, which places it in the {figures['band']} band. "
            f"A debt service ratio of {figures['debtServiceRatio']} earns {figures['ratio_points']} points, with "
            f"{figures['years_points']} for years in business and {figures['sector_points']} for sector "
            f"{figures['sector_code']}."
        )


class GeminiRationaleModel:
    def __init__(self, api_key: str, name: str) -> None:
        from langchain_google_genai import ChatGoogleGenerativeAI

        self.name = name
        self._model = ChatGoogleGenerativeAI(
            model=name, google_api_key=api_key, temperature=0, timeout=15, max_retries=3
        )

    def explain(self, figures: Row) -> str:
        content = self._model.invoke(PROMPT.format(**figures)).content
        if isinstance(content, str):
            return content.strip()
        return "".join(block if isinstance(block, str) else str(block.get("text", "")) for block in content).strip()


def model_from_env(env: Mapping[str, str] | None = None) -> RationaleModel | None:
    """The stub when FLEET_MODEL=stub, Gemini when a key is configured, otherwise None."""
    source = os.environ if env is None else env
    if source.get("FLEET_MODEL") == "stub":
        return StubRationaleModel()
    if source.get("GEMINI_API_KEY"):
        return GeminiRationaleModel(source["GEMINI_API_KEY"], source.get("GEMINI_MODEL") or DEFAULT_MODEL)
    return None

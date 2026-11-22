"""Scoring step: three explicit rules, 100 points in all."""

from __future__ import annotations

from typing import Any

Row = dict[str, Any]

ANNUAL_COST_FACTOR = 1.05
SECTOR_POINTS = {
    "HLT": 20,
    "EDU": 18,
    "ICT": 18,
    "FNB": 15,
    "TRD": 14,
    "PRO": 14,
    "LOG": 13,
    "MFG": 13,
    "ENR": 12,
    "AGR": 10,
    "HOS": 9,
    "CON": 8,
}
OTHER_SECTOR_POINTS = 10
APPROVE_FROM = 70
REFER_FROM = 50


def debt_service_ratio(application: Row, usd_qar: float) -> float:
    """Existing yearly debt service plus the new loan's yearly instalments, over yearly revenue (all in QAR)."""
    rate = usd_qar if application["currency"] == "USD" else 1.0
    new_yearly = application["amount"] * rate * ANNUAL_COST_FACTOR / application["term_months"] * 12
    return float((application["annual_debt_service"] + new_yearly) / application["annual_revenue"])


def _ratio_points(ratio: float) -> int:
    if ratio <= 0.25:
        return 50
    if ratio <= 0.40:
        return 35
    if ratio <= 0.55:
        return 20
    return 5


def _years_points(years: float) -> int:
    if years >= 10:
        return 30
    if years >= 5:
        return 22
    if years >= 2:
        return 12
    return 4


def score(application: Row, usd_qar: float) -> Row:
    """Score, band and the component points of one application."""
    ratio = debt_service_ratio(application, usd_qar)
    components = {
        "debtServiceRatio": _ratio_points(ratio),
        "yearsInBusiness": _years_points(application["years_in_business"]),
        "sector": SECTOR_POINTS.get(application["sector_code"], OTHER_SECTOR_POINTS),
    }
    total = sum(components.values())
    band = "approve" if total >= APPROVE_FROM else "refer" if total >= REFER_FROM else "decline"
    return {
        "application_id": application["application_id"],
        "sme_id": application.get("sme_id"),
        "sector_code": application["sector_code"],
        "amount": application["amount"],
        "currency": application["currency"],
        "debtServiceRatio": round(ratio, 4),
        "components": components,
        "score": total,
        "band": band,
        "rationale": None,
    }

"""Validation step: which applications are complete enough to score."""

from __future__ import annotations

from typing import Any

Row = dict[str, Any]

CURRENCIES = {"QAR", "USD"}
REQUIRED_TEXT = ("application_id", "applicant_name", "sector_code", "currency")
POSITIVE = ("amount", "term_months", "annual_revenue")
NON_NEGATIVE = ("annual_debt_service", "years_in_business")


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def problems(application: Row) -> list[str]:
    """The reasons an application cannot be scored; empty when it can."""
    found = [f"{field} is missing" for field in REQUIRED_TEXT if not str(application.get(field) or "").strip()]
    found += [
        f"{field} must be a positive number"
        for field in POSITIVE
        if not _number(application.get(field)) or application[field] <= 0
    ]
    found += [
        f"{field} must be zero or more"
        for field in NON_NEGATIVE
        if not _number(application.get(field)) or application[field] < 0
    ]
    if application.get("currency") and application["currency"] not in CURRENCIES:
        found.append(f"currency {application['currency']} is not supported")
    return found


def validate(applications: list[Row]) -> tuple[list[Row], list[Row]]:
    """Splits applications into those to score and those rejected, each rejection with its reasons."""
    valid: list[Row] = []
    rejected: list[Row] = []
    for application in applications:
        reasons = problems(application)
        if reasons:
            rejected.append({"application_id": application.get("application_id"), "reasons": reasons})
        else:
            valid.append(application)
    return valid, rejected

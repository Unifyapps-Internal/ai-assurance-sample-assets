"""The three tools the assistant answers from. Each reads the vendored shared data and returns plain JSON."""

from __future__ import annotations

import re
from typing import Any

from langchain_core.tools import StructuredTool

from vendor.assurance_gate import normalise_text

from .data import Row, load

MAX_MATCHES = 5
RECENT_REPAYMENTS = 6

_PUNCTUATION = re.compile(r"[^\w\s]")
_LEGAL_FORMS = {"co", "wll", "company", "est", "group", "شركه", "مؤسسه", "مجموعه", "ذمم"}


def core_name(text: str) -> str:
    """A company name or a question reduced to comparable words: folded, unpunctuated, without legal forms."""
    words = _PUNCTUATION.sub("", normalise_text(text)).split()
    return " ".join(word for word in words if word not in _LEGAL_FORMS)


def _sme_view(sme: Row) -> Row:
    loans = [a["application_id"] for a in load("loan_applications") if a["sme_id"] == sme["sme_id"]]
    keys = ("sme_id", "cr_number", "name_en", "name_ar", "sector_code", "region_code")
    personal = ("owner_name", "owner_qid", "owner_phone", "iban")
    return {**{k: sme[k] for k in keys}, **{k: sme[k] for k in personal}, "loans": loans}


def lookup_sme(query: str) -> Row:
    """Find an SME by its English name, its Arabic name, its CR number or its SME id."""
    wanted = core_name(query)
    padded = f" {wanted} "
    tokens = set(wanted.split())
    matches: list[Row] = []
    for sme in load("smes"):
        names = [core_name(sme["name_en"]), core_name(sme["name_ar"])]
        by_id = core_name(sme["sme_id"]) in tokens or (sme["cr_number"] and sme["cr_number"] in tokens)
        by_name = any(
            name and (f" {name} " in padded or (len(wanted) >= 3 and padded in f" {name} ")) for name in names
        )
        if by_id or by_name:
            matches.append(sme)
    return {"count": len(matches), "matches": [_sme_view(s) for s in matches[:MAX_MATCHES]]}


def list_repayments(application_id: str) -> Row:
    """List the repayment schedule of one loan application (id like APP-00042) with a status summary."""
    wanted = application_id.strip().upper()
    application = next((a for a in load("loan_applications") if a["application_id"] == wanted), None)
    if application is None:
        return {"found": False, "application_id": wanted}
    rows = [r for r in load("repayments") if r["application_id"] == wanted]
    summary = {status: sum(1 for r in rows if r["status"] == status) for status in ("paid", "late", "missed", "due")}
    settled = [r for r in rows if r["status"] != "due"]
    upcoming = next((r for r in rows if r["status"] == "due"), None)
    keys = ("repayment_id", "installment", "due_date", "paid_date", "amount", "currency", "status", "payer_iban")
    return {
        "found": True,
        "application_id": wanted,
        "sme_id": application["sme_id"],
        "loan_amount": application["amount"],
        "currency": application["currency"],
        "loan_status": application["status"],
        "summary": summary,
        "recent": [{k: r[k] for k in keys} for r in settled[-RECENT_REPAYMENTS:]],
        "next_due": {k: upcoming[k] for k in keys} if upcoming else None,
    }


def guarantee_status(reference: str) -> Row:
    """Report guarantees by guarantee id (GUA-0001), loan application id (APP-00042) or SME id (SME-0007)."""
    wanted = reference.strip().upper()
    field = {"GUA": "guarantee_id", "APP": "application_id", "SME": "sme_id"}.get(wanted[:3])
    if field is None:
        return {"count": 0, "guarantees": [], "error": "reference must be a GUA, APP or SME id"}
    keys = ("guarantee_id", "application_id", "sme_id", "status", "amount", "currency", "coverage_pct")
    dated = ("issued_at", "expires_at", "guarantor_name", "guarantor_qid")
    rows = [g for g in load("guarantees") if g[field] == wanted]
    return {"count": len(rows), "guarantees": [{k: g[k] for k in (*keys, *dated)} for g in rows[:MAX_MATCHES]]}


def build_tools() -> list[StructuredTool]:
    return [
        StructuredTool.from_function(lookup_sme),
        StructuredTool.from_function(list_repayments),
        StructuredTool.from_function(guarantee_status),
    ]


def tool_names() -> list[str]:
    return [tool.name for tool in build_tools()]


def describe(output: Any) -> str:
    """A short description of a tool result for log lines (never the data itself)."""
    if isinstance(output, dict):
        return ",".join(f"{k}={output[k]}" for k in ("count", "found") if k in output) or "ok"
    return "ok"

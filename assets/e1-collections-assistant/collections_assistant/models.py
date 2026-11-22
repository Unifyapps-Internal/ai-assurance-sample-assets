"""Chat models: Gemini through langchain-google-genai, and the built-in stub used by tests and FLEET_MODEL=stub."""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping, Sequence
from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable

DEFAULT_MODEL = "gemini-2.5-flash"
STUB_MODEL = "stub-model"

_ARABIC = re.compile("[؀-ۿ]")
_APP = re.compile(r"APP-\d{5}", re.IGNORECASE)
_GUA = re.compile(r"GUA-\d{4}", re.IGNORECASE)
_SME = re.compile(r"SME-\d{4}", re.IGNORECASE)
_GUARANTEE_WORDS = ("guarantee", "ضمان")
_REPAYMENT_WORDS = ("repay", "instal", "قسط", "اقساط", "أقساط", "سداد")


def message_text(message: BaseMessage) -> str:
    """The text of a message whether its content is a string or a list of content blocks."""
    content = message.content
    if isinstance(content, str):
        return content
    parts = [block if isinstance(block, str) else str(block.get("text", "")) for block in content]
    return "".join(parts)


class StubChatModel(BaseChatModel):
    """A deterministic stand-in for Gemini: picks a tool from the question, then answers from the tool output.

    It never calls the network. It exercises the same tool loop, masking and labelling as the real model.
    """

    model_name: str = STUB_MODEL

    @property
    def _llm_type(self) -> str:
        return "fleet-stub"

    def bind_tools(
        self, tools: Sequence[Any], *, tool_choice: str | None = None, **kwargs: Any
    ) -> Runnable[Any, AIMessage]:
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        last_human = max(i for i, m in enumerate(messages) if isinstance(m, HumanMessage))
        question = message_text(messages[last_human])
        results = [
            (str(m.name), json.loads(message_text(m))) for m in messages[last_human + 1 :] if isinstance(m, ToolMessage)
        ]
        call = self._next_call(question, results)
        if call is not None:
            name, args = call
            message = AIMessage(
                content="",
                tool_calls=[{"name": name, "args": args, "id": f"call_{len(results) + 1}", "type": "tool_call"}],
            )
        else:
            message = AIMessage(content=compose_answer(question, results))
        prompt_tokens = sum(len(message_text(m).split()) for m in messages)
        completion_tokens = len(message_text(message).split())
        message.usage_metadata = {
            "input_tokens": prompt_tokens,
            "output_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        }
        return ChatResult(generations=[ChatGeneration(message=message)])

    @staticmethod
    def _next_call(question: str, results: list[tuple[str, Any]]) -> tuple[str, dict[str, str]] | None:
        lowered = question.lower()
        wants_guarantee = any(word in lowered for word in _GUARANTEE_WORDS)
        wants_repayments = any(word in lowered for word in _REPAYMENT_WORDS)
        if not results:
            guarantee_id, application_id, sme_id = _GUA.search(question), _APP.search(question), _SME.search(question)
            if guarantee_id:
                return "guarantee_status", {"reference": guarantee_id.group().upper()}
            if application_id:
                name = "guarantee_status" if wants_guarantee else "list_repayments"
                key = "reference" if wants_guarantee else "application_id"
                return name, {key: application_id.group().upper()}
            if sme_id and wants_guarantee:
                return "guarantee_status", {"reference": sme_id.group().upper()}
            return "lookup_sme", {"query": question}
        if len(results) == 1 and results[0][0] == "lookup_sme" and results[0][1].get("count") == 1:
            sme = results[0][1]["matches"][0]
            if wants_guarantee:
                return "guarantee_status", {"reference": sme["sme_id"]}
            if wants_repayments and sme["loans"]:
                return "list_repayments", {"application_id": sme["loans"][0]}
        return None


def _sme_line(sme: Mapping[str, Any], arabic: bool) -> str:
    if arabic:
        return (
            f"{sme['name_ar']} ({sme['name_en']})، السجل التجاري {sme['cr_number']}، القطاع {sme['sector_code']}، "
            f"المالك {sme['owner_name']}، رقم الهوية {sme['owner_qid']}، الهاتف {sme['owner_phone']}، "
            f"الآيبان {sme['iban']}، عدد طلبات التمويل {len(sme['loans'])}."
        )
    return (
        f"{sme['name_en']} ({sme['name_ar']}), CR {sme['cr_number']}, sector {sme['sector_code']}, "
        f"owner {sme['owner_name']}, QID {sme['owner_qid']}, phone {sme['owner_phone']}, IBAN {sme['iban']}, "
        f"{len(sme['loans'])} loan application(s)."
    )


def _repayments_line(result: Mapping[str, Any], arabic: bool) -> str:
    if not result.get("found"):
        return (
            f"لم يتم العثور على طلب التمويل {result['application_id']}."
            if arabic
            else f"Loan application {result['application_id']} was not found."
        )
    s, upcoming = result["summary"], result["next_due"]
    if arabic:
        text = (
            f"طلب التمويل {result['application_id']} بمبلغ {result['loan_amount']} {result['currency']}: "
            f"{s['paid']} قسط مدفوع، {s['late']} متأخر، {s['missed']} فائت، {s['due']} مستحق لاحقاً."
        )
        return text + (
            f" القسط القادم بتاريخ {upcoming['due_date']} من الحساب {upcoming['payer_iban']}." if upcoming else ""
        )
    text = (
        f"Loan {result['application_id']} of {result['loan_amount']} {result['currency']}: {s['paid']} paid, "
        f"{s['late']} late, {s['missed']} missed, {s['due']} still due."
    )
    return text + (
        f" Next instalment due {upcoming['due_date']} from account {upcoming['payer_iban']}." if upcoming else ""
    )


def _guarantees_line(result: Mapping[str, Any], arabic: bool) -> str:
    if result["count"] == 0:
        return "لا توجد ضمانات مسجلة." if arabic else "No guarantees are on record."
    items = [
        (
            f"{g['guarantee_id']}: الحالة {g['status']}، التغطية {g['coverage_pct']}٪، ينتهي في {g['expires_at']}، "
            f"الضامن {g['guarantor_name']} (رقم الهوية {g['guarantor_qid']})"
            if arabic
            else f"{g['guarantee_id']}: {g['status']}, {g['coverage_pct']}% cover, expires {g['expires_at']}, "
            f"guarantor {g['guarantor_name']} (QID {g['guarantor_qid']})"
        )
        for g in result["guarantees"]
    ]
    head = f"عدد الضمانات {result['count']}: " if arabic else f"{result['count']} guarantee(s): "
    return head + ("؛ ".join(items) if arabic else "; ".join(items)) + "."


def compose_answer(question: str, results: list[tuple[str, Any]]) -> str:
    """The stub's answer: one sentence per tool result, in the language of the question."""
    arabic = bool(_ARABIC.search(question))
    lines: list[str] = []
    for name, result in results:
        if name == "lookup_sme":
            if result["count"] == 0:
                lines.append("لم يتم العثور على منشأة مطابقة." if arabic else "No matching SME was found.")
            lines.extend(_sme_line(sme, arabic) for sme in result["matches"])
        elif name == "list_repayments":
            lines.append(_repayments_line(result, arabic))
        elif name == "guarantee_status":
            lines.append(_guarantees_line(result, arabic))
    return " ".join(lines)


def gemini_model(env: Mapping[str, str] | None = None) -> tuple[BaseChatModel, str]:
    """Gemini as configured by GEMINI_API_KEY and GEMINI_MODEL."""
    from langchain_google_genai import ChatGoogleGenerativeAI

    source = os.environ if env is None else env
    name = source.get("GEMINI_MODEL") or DEFAULT_MODEL
    model = ChatGoogleGenerativeAI(
        model=name, google_api_key=source["GEMINI_API_KEY"], temperature=0, timeout=20, max_retries=3
    )
    return model, name


def model_from_env(env: Mapping[str, str] | None = None) -> tuple[BaseChatModel, str] | None:
    """The stub when FLEET_MODEL=stub, Gemini when a key is configured, otherwise None."""
    source = os.environ if env is None else env
    if source.get("FLEET_MODEL") == "stub":
        return StubChatModel(), STUB_MODEL
    if source.get("GEMINI_API_KEY"):
        return gemini_model(source)
    return None

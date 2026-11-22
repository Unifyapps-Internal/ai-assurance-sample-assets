"""One conversation turn: the model, bound to the tools, in a small explicit loop."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langchain_core.tools import StructuredTool

from .models import message_text
from .prompt import SYSTEM_PROMPT

MAX_MODEL_CALLS = 4


@dataclass
class TurnResult:
    answer: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def _run(payload: dict[str, Any], config: RunnableConfig) -> TurnResult:
    """`config` carries the turn's run as parent, so every model and tool call below is its child in the trace."""
    model: BaseChatModel = payload["model"]
    tools: list[StructuredTool] = payload["tools"]
    by_name = {tool.name: tool for tool in tools}
    bound = model.bind_tools(tools)
    messages: list[BaseMessage] = [SystemMessage(SYSTEM_PROMPT), *payload["history"], HumanMessage(payload["message"])]
    result = TurnResult(answer="")
    for _ in range(MAX_MODEL_CALLS):
        reply = bound.invoke(messages, config=config)
        if not isinstance(reply, AIMessage):
            raise TypeError("the model did not return an AI message")
        messages.append(reply)
        if not reply.tool_calls:
            result.answer = message_text(reply).strip()
            return result
        for call in reply.tool_calls:
            tool = by_name.get(call["name"])
            unknown = {"error": f"unknown tool {call['name']}"}
            output: Any = tool.invoke(call["args"], config=config) if tool else unknown
            result.tool_calls.append({"name": call["name"], "input": call["args"], "output": output})
            messages.append(
                ToolMessage(
                    content=json.dumps(output, ensure_ascii=False), tool_call_id=str(call["id"]), name=call["name"]
                )
            )
    raise RuntimeError("the model kept calling tools without answering")


# A runnable, so the turn is the root of the trace and every model and tool call nests under it.
turn_chain = RunnableLambda(_run, name="collections_assistant.turn")


def run_turn(model: BaseChatModel, tools: list[StructuredTool], history: list[BaseMessage], message: str) -> TurnResult:
    return turn_chain.invoke({"model": model, "tools": tools, "history": history, "message": message})

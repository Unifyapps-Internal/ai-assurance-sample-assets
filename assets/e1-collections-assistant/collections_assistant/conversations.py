"""Conversation memory, kept only for as long as the gate's retention policy allows."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

MAX_MESSAGES = 10
DAY_MS = 86_400_000


@dataclass
class Conversation:
    updated_at: float
    messages: list[BaseMessage] = field(default_factory=list)


class ConversationStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, Conversation] = {}

    def purge(self, retention_days: float | None, now: float) -> int:
        """Drops conversations idle for longer than retention_days. Returns how many were dropped."""
        if retention_days is None:
            return 0
        cutoff = now - retention_days * DAY_MS
        with self._lock:
            expired = [sid for sid, conversation in self._sessions.items() if conversation.updated_at < cutoff]
            for sid in expired:
                del self._sessions[sid]
        return len(expired)

    def history(self, session_id: str) -> list[BaseMessage]:
        with self._lock:
            conversation = self._sessions.get(session_id)
            return list(conversation.messages) if conversation else []

    def append(self, session_id: str, question: str, answer: str, now: float) -> None:
        with self._lock:
            conversation = self._sessions.setdefault(session_id, Conversation(updated_at=now))
            conversation.messages = [*conversation.messages, HumanMessage(question), AIMessage(answer)][-MAX_MESSAGES:]
            conversation.updated_at = now

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

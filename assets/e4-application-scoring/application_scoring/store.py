"""Run store. Pluggable: anything with save, recent and get; memory by default."""

from __future__ import annotations

import threading
from typing import Any, Protocol

Row = dict[str, Any]


class RunStore(Protocol):
    kind: str

    def save(self, run: Row) -> None: ...

    def recent(self, limit: int) -> list[Row]: ...

    def get(self, run_id: str) -> Row | None: ...

    def count(self) -> int: ...


class MemoryRunStore:
    kind = "memory"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runs: dict[str, Row] = {}

    def save(self, run: Row) -> None:
        with self._lock:
            self._runs[run["runId"]] = run

    def recent(self, limit: int) -> list[Row]:
        with self._lock:
            return list(reversed(list(self._runs.values())))[:limit]

    def get(self, run_id: str) -> Row | None:
        with self._lock:
            return self._runs.get(run_id)

    def count(self) -> int:
        with self._lock:
            return len(self._runs)

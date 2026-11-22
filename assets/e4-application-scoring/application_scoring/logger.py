"""Run log: the lines each run writes, served by GET /api/logs."""

from __future__ import annotations

import sys
import threading
from datetime import UTC, datetime
from typing import Any

Row = dict[str, Any]


class RunLogger:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._lines: list[Row] = []

    def info(self, run_id: str, message: str) -> None:
        line = {"ts": datetime.now(UTC).isoformat(timespec="milliseconds"), "runId": run_id, "level": "info"}
        with self._lock:
            self._lines.append({**line, "message": message})
        encoding = sys.stdout.encoding or "utf-8"
        sys.stdout.write(f"[{run_id}] {message}\n".encode(encoding, "backslashreplace").decode(encoding))

    def applicant(self, run_id: str, stage: str, application: Row) -> None:
        """One line per application and stage, identifying the applicant."""
        self.info(
            run_id,
            f"{stage} {application.get('application_id')} for {application.get('applicant_name')} "
            f"(QID {application.get('applicant_qid')}, phone {application.get('applicant_phone')})",
        )

    def lines(self, run_id: str | None = None, limit: int = 500) -> list[Row]:
        with self._lock:
            selected = [line for line in self._lines if run_id is None or line["runId"] == run_id]
        return selected[-limit:]

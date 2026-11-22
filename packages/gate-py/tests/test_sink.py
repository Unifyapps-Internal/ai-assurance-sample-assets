"""The default log sink must not fail on a console whose encoding cannot show Arabic."""

from __future__ import annotations

import io

import pytest

from assurance_gate import MemoryStore, create_gate


def test_default_sink_survives_a_narrow_console(monkeypatch: pytest.MonkeyPatch) -> None:
    buffer = io.BytesIO()
    monkeypatch.setattr("sys.stdout", io.TextIOWrapper(buffer, encoding="cp1252", newline="\n"))
    gate = create_gate("e1-collections-assistant", MemoryStore(), None, {"version": 0})
    assert gate.log("سؤال عن شركة النور") == "سؤال عن شركة النور"
    import sys

    sys.stdout.flush()
    written = buffer.getvalue().decode("cp1252")
    assert written.endswith("\n")
    assert "\\u0633" in written

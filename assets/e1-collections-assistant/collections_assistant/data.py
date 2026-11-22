"""Read access to the vendored shared data. Test asset: every record is fabricated."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

ASSET_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ASSET_ROOT / "vendor" / "shared-data"

Row = dict[str, Any]


@cache
def load(name: str) -> list[Row]:
    rows: list[Row] = json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))
    return rows

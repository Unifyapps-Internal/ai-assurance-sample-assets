"""Puts packages/gate-py on the import path so the tests import assurance_gate from source."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

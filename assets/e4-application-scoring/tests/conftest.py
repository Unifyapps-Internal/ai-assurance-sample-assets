"""Puts the asset folder on the import path, as `python -m application_scoring` and api/index.py have it."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

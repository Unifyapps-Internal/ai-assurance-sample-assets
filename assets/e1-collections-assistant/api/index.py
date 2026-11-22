"""Vercel entry point: exposes the ASGI app."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collections_assistant.app import create_app

app = create_app()

"""Local start: `python -m collections_assistant` (PORT, default 4101)."""

import os

import uvicorn

from .app import create_app

if __name__ == "__main__":
    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ.get("PORT", "4101")), log_level="warning")

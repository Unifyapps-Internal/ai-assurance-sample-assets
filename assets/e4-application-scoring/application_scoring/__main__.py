"""Local start: `python -m application_scoring` (PORT, default 4104)."""

import os

import uvicorn

from .app import create_app

if __name__ == "__main__":
    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ.get("PORT", "4104")), log_level="warning")

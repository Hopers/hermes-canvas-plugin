"""hermes-canvas agent-half backend: serve the canvas HTML from the server.

The desktop half (desktop/plugin.js) fetches the live canvas through
ctx.rest('/canvas') instead of GitHub — no CDN cache, no rate limit,
always the version the agent just wrote.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


def _canvas_path() -> Path:
    """Profile-safe canvas location: $HERMES_HOME/canvas/canvas.html."""
    home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
    return home / "canvas" / "canvas.html"


@router.get("/canvas")
async def get_canvas() -> JSONResponse:
    """Return the current canvas HTML plus a mtime stamp for cache busting."""
    path = _canvas_path()
    try:
        html = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return JSONResponse(
            {"ok": False, "error": "canvas.html not found on server — ask the agent to build one first (edit demo/canvas.html's __INITIAL__ segment, then canvas_write)"},
            status_code=404,
        )
    return JSONResponse({
        "ok": True,
        "mtime": path.stat().st_mtime,
        "size": len(html.encode("utf-8")),
        "html": html,
    })


@router.get("/status")
async def status() -> dict:
    path = _canvas_path()
    return {
        "ok": True,
        "canvas_exists": path.exists(),
        "canvas_path": str(path),
        "canvas_mtime": path.stat().st_mtime if path.exists() else None,
        "served_at": time.time(),
    }

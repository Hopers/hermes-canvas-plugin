"""hermes-canvas agent-half backend: serve the canvas HTML from the server.

The desktop half (desktop/plugin.js) fetches the live canvas through
ctx.rest('/canvas') instead of GitHub — no CDN cache, no rate limit,
always the version the agent just wrote.
"""
from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

CANVAS_PATH = Path("/root/.hermes/canvas/canvas.html")


@router.get("/canvas")
async def get_canvas() -> JSONResponse:
    """Return the current canvas HTML plus a mtime stamp for cache busting."""
    try:
        html = CANVAS_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return JSONResponse({"ok": False, "error": "canvas.html not found on server"}, status_code=404)
    return JSONResponse({
        "ok": True,
        "mtime": CANVAS_PATH.stat().st_mtime,
        "size": len(html.encode("utf-8")),
        "html": html,
    })


@router.get("/status")
async def status() -> dict:
    return {
        "ok": True,
        "canvas_exists": CANVAS_PATH.exists(),
        "canvas_mtime": CANVAS_PATH.stat().st_mtime if CANVAS_PATH.exists() else None,
        "served_at": time.time(),
    }

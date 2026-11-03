"""hermes-canvas agent-half backend: canvas HTML, original assets, and board state.

The desktop half (desktop/plugin.js) fetches the live canvas through
ctx.rest('/canvas') instead of GitHub — no CDN cache, no rate limit,
always the version the agent just wrote.

Two things this half owns that the canvas itself cannot:

* **Original assets.** A pasted image used to live only in the browser's tldraw
  store and come back as a 640 px WebP thumbnail, so the original was gone the
  moment the frame reloaded. ``POST /asset`` stores the untouched bytes under
  ``$HERMES_HOME/canvas/assets/`` and the canvas swaps its ``data:`` URL for the
  served one, so what comes back is a reference to a real file.
* **Board state.** The sandboxed frame has no localStorage, so every reload
  rebuilt the board from ``__INITIAL__``. ``GET/POST /state`` keeps the shapes
  JSON next to the canvas and the frame restores it on boot.

Both are gated by a short-lived HMAC token rather than the browser session: the
canvas is served inside ``sandbox="allow-scripts"`` (opaque origin), where a
fetch carries no cookie and a same-origin check can never pass.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response

router = APIRouter()

#: The canvas is served as its OWN document, not a srcdoc frame. A srcdoc frame inherits the
#: host page's CSP — and the Webapp's page policy has no ``'unsafe-inline'`` (only the trusted
#: build's script hashes), so every inline script in a 3.7 MB self-contained canvas is blocked
#: and the board sits on its boot line forever. A served document gets its own policy instead,
#: which is exactly what ``/assets/webapp-preview.html`` does for ``::preview``.
CANVAS_VIEW_CSP = (
    "default-src 'none'; "
    "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; "
    "style-src 'unsafe-inline' data:; "
    "img-src data: blob: https: http:; "
    "font-src data:; "
    "media-src data: blob:; "
    "connect-src * data: blob:; "
    "worker-src blob:; "
    "frame-src 'self' https: http: data: blob:; "
    "frame-ancestors 'self'"
)

#: An opaque-origin frame (the sandbox) reads a response only when the policy names it. These
#: routes never carry credentials, so ``null`` is the whole allowlist they need.
CORS_OPAQUE = {"Access-Control-Allow-Origin": "null", "Vary": "Origin"}

#: A canvas token outlives a working day; the frame re-mints on every load.
TOKEN_TTL = 12 * 3600
#: 40 MiB: a designer's export, not a video.
MAX_ASSET_BYTES = 40 * 1024 * 1024
#: No traversal, no leading dot, no separators — the name is used as a filename verbatim.
_ASSET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")

_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def _home() -> Path:
    """Profile-safe root: $HERMES_HOME (per profile), never a hard-coded path."""
    return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def _canvas_path() -> Path:
    """Profile-safe canvas location: $HERMES_HOME/canvas/canvas.html."""
    return _home() / "canvas" / "canvas.html"


def _assets_dir() -> Path:
    target = _home() / "canvas" / "assets"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _state_path() -> Path:
    return _home() / "canvas" / "state.json"


def _secret() -> bytes:
    """Per-profile signing key, created once and kept beside the canvas."""
    path = _home() / "canvas" / ".asset-secret"
    try:
        return path.read_bytes()
    except FileNotFoundError:
        path.parent.mkdir(parents=True, exist_ok=True)
        key = secrets.token_bytes(32)
        path.write_bytes(key)
        os.chmod(path, 0o600)
        return key


def _mint(ttl: int = TOKEN_TTL) -> str:
    exp = str(int(time.time()) + ttl)
    sig = hmac.new(_secret(), exp.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{sig}"


def _valid(token: str | None) -> bool:
    if not token:
        return False
    try:
        exp, sig = token.split(".", 1)
        deadline = int(exp)
    except (ValueError, AttributeError):
        return False
    if deadline < time.time():
        return False
    want = hmac.new(_secret(), exp.encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(sig, want)


def _require(token: str | None) -> None:
    if not _valid(token):
        raise HTTPException(status_code=401, detail="canvas token missing or expired")


def _read_canvas() -> str | None:
    try:
        return _canvas_path().read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


@router.get("/canvas")
async def get_canvas() -> JSONResponse:
    """Return the current canvas HTML plus a mtime stamp for cache busting."""
    path = _canvas_path()
    html = _read_canvas()
    if html is None:
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


@router.get("/token")
async def issue_token() -> dict:
    """Hand the desktop half a token to put on the frame URL (it reaches this over ctx.rest)."""
    return {"ok": True, "token": _mint(), "ttl": TOKEN_TTL}


@router.get("/view")
async def view_canvas(token: str | None = Query(None)) -> HTMLResponse:
    """Serve the canvas as a standalone document with its own CSP.

    The desktop half points its iframe at this route on the Webapp: an iframe ``src`` loads a
    document that carries this response's policy, while ``srcdoc`` would inherit the host page's
    and be blocked. ``no-store`` keeps a refresh honest after the agent rewrites the board.

    The token is injected into the document as well as accepted from the query, so a board opened
    straight in a browser tab (no plugin, no query string) still gets an upload credential.
    """
    html = _read_canvas()
    if html is None:
        return HTMLResponse(
            "<!doctype html><meta charset=utf-8><body style='font:14px system-ui;padding:24px'>"
            "canvas.html not found on server — ask the agent to build one first.",
            status_code=404,
        )
    minted = token if _valid(token) else _mint()
    prelude = (
        "<script>window.__CANVAS_TOKEN__=" + json.dumps(minted) + ";"
        "window.__CANVAS_ORIGIN__=" + json.dumps("") + ";</script>"
    )
    # The first <head> is the real one; later occurrences live inside the bundled JS strings.
    html = html.replace("<head>", "<head>\n" + prelude, 1)
    return HTMLResponse(html, headers={
        "Content-Security-Policy": CANVAS_VIEW_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
    })


@router.post("/asset")
async def upload_asset(
    file: UploadFile = File(...),
    token: str | None = Query(None),
    name: str | None = Query(None),
) -> JSONResponse:
    """Store an untouched pasted image and return the name the canvas should reference.

    ``multipart/form-data`` is a simple request, so an opaque-origin frame can post it with no
    preflight; ``CORS_OPAQUE`` lets that frame read the name back.
    """
    _require(token)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(raw) > MAX_ASSET_BYTES:
        raise HTTPException(status_code=413, detail=f"asset too large (cap {MAX_ASSET_BYTES // (1024 * 1024)} MiB)")

    suggested = name or (file.filename or "asset")
    suggested = Path(suggested).name
    if not _ASSET_NAME.match(suggested):
        stem = re.sub(r"[^A-Za-z0-9._-]", "-", Path(suggested).stem)[:60] or "asset"
        suffix = Path(suggested).suffix.lower()
        suggested = f"{stem}-{secrets.token_hex(4)}{suffix}"

    target = _assets_dir() / suggested
    tmp = target.with_name(f".{target.name}.{secrets.token_hex(4)}.part")
    tmp.write_bytes(raw)
    os.replace(tmp, target)
    mime = file.content_type or _MIME_BY_EXT.get(target.suffix.lower(), "application/octet-stream")
    return JSONResponse({
        "ok": True,
        "name": target.name,
        "size": len(raw),
        "mime": mime,
        "url": f"asset/{target.name}?token={token}",
    }, headers=CORS_OPAQUE)


@router.get("/asset/{name}")
async def get_asset(name: str, token: str | None = Query(None)) -> Response:
    """Serve one stored original. ``<img src>`` needs no CORS, only the token in the query."""
    _require(token)
    if not _ASSET_NAME.match(name):
        raise HTTPException(status_code=404, detail="not an asset")
    target = _assets_dir() / name
    try:
        data = target.read_bytes()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="asset not found") from None
    return Response(
        content=data,
        media_type=_MIME_BY_EXT.get(target.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=86400", **CORS_OPAQUE},
    )


@router.get("/state")
async def get_state(token: str | None = Query(None)) -> JSONResponse:
    """The board's last saved shapes, or ``null`` when the agent's ``__INITIAL__`` is authoritative."""
    _require(token)
    path = _state_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return JSONResponse({"ok": True, "state": None}, headers=CORS_OPAQUE)
    try:
        payload = json.loads(raw)
    except ValueError:
        return JSONResponse({"ok": True, "state": None}, headers=CORS_OPAQUE)
    return JSONResponse(
        {"ok": True, "state": payload, "mtime": path.stat().st_mtime},
        headers=CORS_OPAQUE,
    )


@router.post("/state")
async def put_state(request: Request, token: str | None = Query(None)) -> JSONResponse:
    """Persist the board's shapes. Atomic write: a torn save must never replace a good board."""
    _require(token)
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="state must be JSON") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("shapes"), list):
        raise HTTPException(status_code=400, detail="state needs a shapes[] array")
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.part")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return JSONResponse(
        {"ok": True, "bytes": path.stat().st_size, "saved_at": time.time()},
        headers=CORS_OPAQUE,
    )


@router.delete("/state")
async def clear_state(token: str | None = Query(None)) -> JSONResponse:
    """Drop the saved board so the agent's freshly written ``__INITIAL__`` wins again."""
    _require(token)
    _state_path().unlink(missing_ok=True)
    return JSONResponse({"ok": True}, headers=CORS_OPAQUE)


@router.get("/status")
async def status() -> dict:
    path = _canvas_path()
    assets = _assets_dir()
    count = 0
    total = 0
    for entry in assets.iterdir():
        if entry.is_file() and not entry.name.startswith("."):
            count += 1
            total += entry.stat().st_size
    return {
        "ok": True,
        "canvas_exists": path.exists(),
        "canvas_path": str(path),
        "canvas_mtime": path.stat().st_mtime if path.exists() else None,
        "assets": count,
        "assets_bytes": total,
        "state_exists": _state_path().exists(),
        "served_at": time.time(),
    }

"""hermes-canvas agent half.

Registers the `canvas_write` tool: the agent-side entry point of the canvas
round-trip. Any script, tool output or generated image can be pushed onto
the board by writing a fresh canvas.html; the Desktop half picks it up via
"Refresh" with zero reinstall.

The canvas content itself lives on the Hermes server
($HERMES_HOME/canvas/canvas.html) — never in this repository.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:  # profile-safe home resolution (never hardcode ~/.hermes)
    from hermes_constants import get_hermes_home
except ImportError:  # standalone use outside a Hermes runtime
    import os

    def get_hermes_home() -> Path:
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def _canvas_dir() -> Path:
    return get_hermes_home() / "canvas"


def canvas_write(html: str, check: bool = True) -> str:
    """Write a complete, self-contained canvas.html to the canvas dir.

    Accepts either a full HTML document or a JSON string of
    ``{"assets": [...], "shapes": [...]}`` — the JSON is wrapped in a
    minimal esm.sh-powered shell (needs network at view time). The
    preferred route is editing demo/canvas.html's ``__INITIAL__`` segment
    directly (zero-network, zero build) and passing the full HTML here.
    """
    out_dir = _canvas_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "canvas.html"

    body = html.strip()
    if body.startswith("{"):
        payload = json.loads(body)
        html_doc = _minimal_shell(payload)
    elif body.lower().startswith("<!doctype") or body.lower().startswith("<html"):
        html_doc = body
    else:
        return json.dumps({
            "success": False,
            "error": "canvas_write expects a full HTML document or a JSON {assets,shapes} payload",
        })

    if check and "<script>" not in html_doc:
        return json.dumps({"success": False, "error": "refusing to write: no <script> found (not a canvas document?)"})

    out_path.write_text(html_doc, encoding="utf-8")
    return json.dumps({
        "success": True,
        "path": str(out_path),
        "bytes": out_path.stat().st_size,
        "hint": "tell the user to hit Refresh in the Desktop canvas page",
    }, ensure_ascii=False)


# Minimal quick-write shell. Plain string + .replace() — f-strings and JS
# braces do not mix. This variant loads the engine from esm.sh, so it is
# only a fallback (the zero-network route is editing demo/canvas.html's
# __INITIAL__ segment — see README "Making boards").
_MINIMAL_SHELL = """<!DOCTYPE html>
<html lang="zh" data-theme="dark">
<head><meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; background: #0a0a0a; }
  #canvas { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="canvas"></div>
<script>window.__INITIAL__ = __INIT_JSON__;</script>
<script type="module">
  // Pinned deps so tldraw shares the exact React instance we render with
  // (a second React copy = hooks break silently, canvas renders empty).
  const R = 'https://esm.sh/react@18.3.1';
  const RD = 'https://esm.sh/react-dom@18.3.1';
  const TL = 'https://esm.sh/@tldraw/tldraw@3.13.0?deps=react@18.3.1,react-dom@18.3.1';
  const mount = document.getElementById('canvas');
  mount.textContent = 'loading engine from esm.sh...';
  try {
    const React = await import(R);
    const { createRoot } = await import(RD + '/client');
    const { Tldraw } = await import(TL);
    createRoot(mount).render(React.createElement(Tldraw, {
      onMount: (editor) => {
        window.__CANVAS_EDITOR__ = editor;
        const init = window.__INITIAL__;
        if (init && Array.isArray(init.assets) && init.assets.length) editor.createAssets(init.assets);
        if (init && Array.isArray(init.shapes) && init.shapes.length) editor.createShapes(init.shapes);
      }
    }));
  } catch (e) {
    mount.textContent = 'canvas boot failed: ' + e.message;
  }
</script>
</body>
</html>"""


def _minimal_shell(payload: dict[str, Any]) -> str:
    init = json.dumps(payload, ensure_ascii=False)
    return _MINIMAL_SHELL.replace("__INIT_JSON__", init)


def register(ctx: Any) -> None:
    ctx.register_tool(
        name="canvas_write",
        toolset="hermes-canvas",
        schema={
            "name": "canvas_write",
            "description": (
                "Write the Hermes infinite canvas (canvas.html). Preferred: pass the demo/canvas.html "
                "with its __INITIAL__ JSON segment swapped for your board (zero-network). Fallback: a "
                "bare JSON {assets,shapes} payload gets wrapped in a minimal esm.sh shell. The Desktop "
                "canvas page picks it up on Refresh."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "html": {
                        "type": "string",
                        "description": "Full HTML document, or JSON {assets:[],shapes:[]} string",
                    }
                },
                "required": ["html"],
            },
        },
        handler=lambda args, **kw: canvas_write(html=args.get("html", "")),
        check_fn=lambda: True,
        requires_env=[],
        description="Write the Hermes infinite canvas",
        emoji="🎨",
    )

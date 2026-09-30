#!/usr/bin/env python3
"""Assemble the self-contained canvas.html (local engine, zero network).

Usage: build_canvas.py [init.json] [output.html]

Both arguments optional. init.json falls back to init.example.json
(committed starter board), then to an empty board. Default output:
$HERMES_HOME/canvas/canvas.html (~/hermes-canvas.html if HERMES_HOME
is unset — for trying the template out anywhere).

Steps before this (see canvas-template/README.md):
  npm install && npm run assets && npm run bundle

init.json format (tldraw v3 records):
  {"assets": [TLAsset], "shapes": [partial TLShape]}   — both lists may be empty
  image assets: props.src = data:image/webp;base64,... (keep < 150 KB each)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BUILD = Path(__file__).parent


def main() -> None:
    # both args optional: init defaults to init.json → init.example.json → empty;
    # output defaults to $HERMES_HOME/canvas/canvas.html
    init_path: Path | None = None
    if len(sys.argv) > 1:
        init_path = Path(sys.argv[1])
    else:
        cand = BUILD / "init.json"
        if cand.exists():
            init_path = cand
    if init_path and not init_path.exists():
        example = BUILD / "init.example.json"
        if example.exists():
            print(f"note: {init_path} not found — using init.example.json (starter board)")
            init_path = example
    if init_path is None:
        print("note: no init file — building an empty board")
    init = json.loads(init_path.read_text(encoding="utf-8")) if init_path else {"assets": [], "shapes": []}

    if len(sys.argv) > 2:
        out_path = Path(sys.argv[2])
    elif os.environ.get("HERMES_HOME"):
        out_path = Path(os.environ["HERMES_HOME"]) / "canvas" / "canvas.html"
    else:
        out_path = Path.home() / "hermes-canvas.html"

    shell = (BUILD / "shell.html").read_text(encoding="utf-8")
    js = (BUILD / "canvas-bundle.js").read_text(encoding="utf-8")
    # tldraw.css ships inside the npm package — read it from node_modules so
    # no third-party code lives in this repo
    css_path = BUILD / "node_modules" / "@tldraw" / "tldraw" / "tldraw.css"
    if not css_path.exists():
        sys.exit(f"tldraw.css not found at {css_path} — run `npm install` first")
    css = css_path.read_text(encoding="utf-8")

    # optional display font (editorial shell) — drop-in, see design-assets/
    anton = BUILD / "design-assets" / "anton.b64"
    anton_b64 = anton.read_text(encoding="utf-8").strip() if anton.exists() else ""
    if anton_b64:
        shell = shell.replace("ANTON_B64", anton_b64)
    else:
        # no custom font — degrade the @font-face to a no-op so the shell still renders
        shell = shell.replace(
            "@font-face { font-family: 'Anton'; src: url(data:font/woff2;base64,ANTON_B64) format('woff2'); font-display: swap; }",
            "/* Anton font omitted — system sans fallback */",
        )

    # tldraw.css assumes its own host sizing; force-fill the mount point
    css_patch = ".tl-container{width:100%;height:100%;}"
    inject = (
        "<style>\n" + css + "\n" + css_patch + "\n</style>\n"
        '<script>window.__CANVAS_FULL__ = true;</script>\n'
        "<script>window.__INITIAL__ = " + json.dumps(init, ensure_ascii=False) + ";</script>\n"
        "<script>\n" + js + "\n</script>"
    )
    marker = '<script src="./entry.jsx"></script>'
    assert marker in shell, "shell.html marker missing"
    html = shell.replace(marker, inject)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print(
        f"assembled {out_path} ({len(html.encode('utf-8'))} bytes), "
        f"shapes={len(init.get('shapes', []))}, assets={len(init.get('assets', []))}"
    )


if __name__ == "__main__":
    main()

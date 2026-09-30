# NOTICE

## Bundled third-party assets

This repository itself contains **no third-party runtime code or binary
assets**. The canvas engine build (`canvas-template/`) pulls the following
open packages from npm at build time:

- [`tldraw`](https://github.com/tldraw/tldraw) v3 — UI components and canvas
  engine. The `tldraw` package is **not** OSI open source; it is licensed
  under the [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
  which permits bundling it as part of another application, provided that a
  verbatim copy of the license accompanies any distribution. The built
  `canvas.html` inlines tldraw's engine, fonts, icons and translations as
  data: URLs — if you distribute a built canvas, include the tldraw license
  alongside it (see `canvas-template/licenses/`).
- [`react`](https://github.com/facebook/react) / `react-dom` — MIT.
- [`esbuild`](https://github.com/evanw/esbuild) — MIT.
- [`lucide-static`](https://github.com/lucide-icons/lucide) — ISC.

Static assets (16 fonts, 156-icon sprite, embed icons, translations) are
downloaded from `cdn.tldraw.com` by `gen_assets.py` at build time and
inlined as base64 data: URLs. They are never committed to this repository.

## Trademarks

"tldraw" is a trademark of tldraw, Inc. This project is not affiliated with
or endorsed by tldraw, Inc., Hermes Agent, or Nous Research.

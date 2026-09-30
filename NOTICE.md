# NOTICE

## Bundled third-party assets

This repository ships a pre-built canvas artifact (`demo/canvas.html`)
that bundles the following open packages:

- [`tldraw`](https://github.com/tldraw/tldraw) v3 — UI components and canvas
  engine. The `tldraw` package is **not** OSI open source; it is licensed
  under the [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
  which permits bundling it as part of another application, provided that a
  verbatim copy of the license accompanies any distribution. A copy ships
  in `licenses/tldraw-LICENSE.md` — keep it with any redistribution of the
  demo artifact.
- [`react`](https://github.com/facebook/react) / `react-dom` — MIT.
- [`lucide-static`](https://github.com/lucide-icons/lucide) — ISC.
- Anton display font — SIL OFL 1.1.

The artifact inlines tldraw's engine, fonts, icons and translations as
base64 data: URLs (that's what makes it zero-network). The "made with
tldraw" watermark and all copyright notices are preserved untouched.

## Trademarks

"tldraw" is a trademark of tldraw, Inc. This project is not affiliated with
or endorsed by tldraw, Inc., Hermes Agent, or Nous Research.

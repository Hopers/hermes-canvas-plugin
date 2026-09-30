# canvas-template — self-contained canvas builder

Builds a **single-file `canvas.html`** with the tldraw engine fully inlined
(JS bundle + CSS + 16 fonts + icon sprite + translations, all as data: URLs).
Runtime network requests: **zero**. Works inside sandboxed iframes (the
Hermes widget/plugin hosts) where external fetches are blocked anyway.

```
init.json ──► build_canvas.py ──► canvas.html (self-contained, ~3.8 MB)
                 ▲
   shell.html ───┤  (page chrome — swap for your own design)
   canvas-bundle.js ← esbuild(entry.jsx)
   tldraw.css ◄── node_modules (npm install)
   design-assets/┘
```

## Try it without building anything

`demo/canvas.html` is a **pre-built showcase board** (3.8 MB, fully
self-contained, zero network) — open it in any browser, or drop it into
your canvas page, and play with the editorial shell + annotation tools
right away. The demo carries a two-cat sample board; your real boards
are built from init.json via the pipeline below.

## Build

```bash
cd canvas-template
npm install          # react 18 + @tldraw/tldraw 3.x + esbuild
python3 gen_assets.py   # downloads tldraw assets → data-URL module (~2 MB, one-time)
npm run bundle          # esbuild entry.jsx → canvas-bundle.js (~3.7 MB minified)
python3 build_canvas.py init.json [out.html]
```

Default output path: `$HERMES_HOME/canvas/canvas.html` (or `~/hermes-canvas.html`
without HERMES_HOME) — exactly where the plugin backend serves from.
Pass an explicit path as the second argument to build anywhere.

`init.json` describes the initial board (tldraw v3 records):

```json
{
  "assets": [
    { "id": "asset:img1", "typeName": "asset", "type": "image",
      "props": { "name": "cat.webp", "src": "data:image/webp;base64,...",
                 "w": 640, "h": 640, "mimeType": "image/webp", "isAnimated": false },
      "meta": {} }
  ],
  "shapes": [
    { "id": "shape:img1", "type": "image", "x": 60, "y": 50,
      "props": { "assetId": "asset:img1", "w": 640, "h": 640 } }
  ]
}
```

Empty board: `{"assets": [], "shapes": []}`.

## Putting images on the board

Embed images as data URLs so the canvas never fetches anything:

```bash
# download / point at your image, then compress:
ffmpeg -i in.png -vf "scale='min(640,iw)':-2" -quality 80 out.webp
base64 -w0 out.webp   # → props.src = "data:image/webp;base64,..."
```

Keep each image under ~150 KB inline (a two-image board lands around
100 KB before the engine is added). WebP, not PNG — PNG base64 gets fat.

## Customizing

- **Language (important):** the stock shell ships in **Chinese** — all
  button labels, status lines and hints. If your user speaks another
  language, localize before the first build: the strings live in plain
  text in `shell.html` (hero, nav, buttons) and `entry.jsx` (status
  messages); the tldraw UI itself is locale-driven — change
  `locale: 'zh-cn'` in `entry.jsx` (and add your locale to
  `gen_assets.py` `TRANSLATIONS`). No i18n framework on purpose —
  sed-and-rebuild is the intended workflow for an agent.
- **Page chrome**: rewrite `shell.html` (the editorial look — hero, index
  row, status line, tool buttons — is just CSS around `#canvas`). Keep the
  `<script src="./entry.jsx"></script>` marker; `build_canvas.py` replaces
  it with the inlined engine.
- **Tools / behavior**: `entry.jsx` holds the annotation protocol
  (compact shape serialization + the 移动对/AI图框 scaffolds + send
  channels). See `../docs/PROTOCOL.md` for the wire format.
- **Display font**: `design-assets/anton.b64` (base64 woff2) is optional —
  delete it and the build degrades to a system-sans fallback automatically.
- **Languages**: `gen_assets.py` `TRANSLATIONS = ["en", "zh-cn"]` — add
  your locales, re-run.

## Version bumps

`gen_assets.py` derives the icon/embed-icon name lists from
`node_modules/tldraw/dist-esm`, so bumping `@tldraw/tldraw` in
package.json + `npm install` + re-running the three build steps is all it
takes. Font filenames are the only hand-kept mapping (they are stable
across tldraw 3.x — see `FONT_FILES`).

## Licensing

The built `canvas.html` embeds tldraw code. tldraw's license permits
bundling it as part of another application **provided the license text
travels with distributions** — `gen_assets.py` saves a copy to
`licenses/tldraw-LICENSE.md` automatically. See `../NOTICE.md`.

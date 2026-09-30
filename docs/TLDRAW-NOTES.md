# tldraw v3 local-engine notes (hard-won)

Everything below was verified empirically against
`@tldraw/tldraw@3.13.0` (2026-09). tldraw's docs still describe v2 in
places — where they disagree with reality, reality wins. These notes are
for anyone regenerating or rebuilding the bundled engine in
`demo/canvas.html` (or building their own zero-network tldraw artifact) —
the traps below are what it took.

## 1. Zero-network inlining (the whole point)

Sandboxed iframes (chat widget, plugin page) block external fetches — the
engine must be fully self-contained. Three layers, all required:

1. **JS**: `esbuild entry.jsx --bundle --minify --format=iife` — React,
   tldraw, your glue, one IIFE.
2. **CSS**: `tldraw.css` inlined into `<style>`. Add
   `.tl-container{width:100%;height:100%;}` — the shipped CSS assumes its
   own host sizing and the canvas mount otherwise collapses.
3. **Assets → data: URLs**, injected via **both** mechanisms:
   `setDefaultUiAssetUrls(ASSET_URLS)` + `setDefaultEditorAssetUrls({fonts})`
   at module scope, **and** the `assetUrls` prop on `<Tldraw>`. Only-prop
   is not enough: `embedIcons` / `translations` consumers read the module
   default table directly; fonts/icons resolve through context. Belt and
   braces.

Asset-table keys (wrong keys = silent 404 fallbacks):
- `fonts`: semantic names — `tldraw_sans`, `tldraw_serif_bold`,
  `tldraw_draw_italic`, … (16 total)
- `icons`: `SPRITE + "#icon-name"` — one merged SVG sprite
  (`icons/icon/0_merged.svg` from the CDN), referenced by fragment
- `embedIcons`: by embed type (`codepen`, `figma`, …)
- `translations`: by full locale (`en`, `zh-cn`)

A `data:`-URL sprite + `#fragment` works fine for CSS `mask` usage —
verified.

## 2. v3 API contracts (differ from v2 docs)

```js
// asset props live in props (v2 had them top-level)
asset.props.{src,name,w,h,mimeType}

// reading shapes — getShapes() does not exist
const shapes = [...editor.getCurrentPageShapeIds()].map(id => editor.getShape(id))

// asset lookup — getAssets is a getter, not a method
editor.getAsset(id)   // ✓
editor.getAssets      // getter → array

// text shapes: richText is a Tiptap doc, NOT an array
props.richText = { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
]}

// createShapes accepts partials; tldraw fills defaults
editor.createShapes([{ type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } }])
```

**Arrow endpoints**: writing `{ type: 'binding', boundShapeId }` into
`createShapes` makes the whole batch reject and roll back. Use plain
point-to-point `{ x, y }` deltas under `props.start` / `props.end`; treat
arrows as visual guides only and pair things by shape-id yourself.

## 3. Host quirks (Hermes-specific)

- **`window.hermes.send`** (widget host): 500-char ceiling per prompt,
  1 msg/sec — over-long payloads are **silently** truncated. Full-shape
  JSON dies around ~600 chars. Hence the compact mark format + 420-char
  fragment protocol (see PROTOCOL.md).
- **`postMessage`** (plugin host): no ceiling — always send the payload
  whole.
- **localStorage**: sealed in the widget sandbox. Board persistence =
  agent rewrites the HTML with a fresh `window.__INITIAL__`.
- **Scroll resurrection**: scrolling chat history back to an old widget
  re-executes its scripts. Any widget that auto-sends probes must
  early-return after first run, or you get zombie echoes in the session.
- **Static-render hosts**: `desktop_preview`-style side panes render HTML
  statically — inline/dynamic scripts never execute. Interactive boards
  must ship via the chat widget or the plugin page. Keep a static fallback
  line in the boot text ("stuck here = host doesn't run scripts").

## 4. Image pipeline

- Data URLs only (`props.src`) — the canvas cannot fetch.
- WebP ≤ 640 px wide, quality ~80 → ~50 KB per image inline. PNG base64
  bloats badly.
- `ffmpeg -i in.png -vf "scale='min(640,iw)':-2" -quality 80 out.webp`

## 5. Licenses

tldraw is not OSI-open-source; bundling is permitted as part of another
application if the license travels along — a verbatim copy ships in
`licenses/tldraw-LICENSE.md`. Anton (display font) is OFL 1.1. See
`../NOTICE.md`.

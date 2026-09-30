# CANVAS-V1-C — annotation round-trip protocol

The canvas is a *write-only artifact from the agent's side* and a *feedback
surface from the human's side*. This document specifies the wire format of
the human→agent direction, so any agent (not just Hermes) can consume it.

## Transport

Two channels, auto-detected in priority order (see `entry.jsx` `push()`):

| Host | Channel | Limits | Chunking |
|---|---|---|---|
| Chat widget (`::preview` iframe) | `window.hermes.send(text)` | 500 chars/prompt, 1 msg/sec — silently truncated above | `#n/m` fragments, 420 chars each, 1.2 s apart |
| Desktop plugin page (sidebar iframe) | `window.parent.postMessage({__hermesCanvas: true, text}, '*')` | none | single message, always |

The desktop half (`desktop/plugin.js`) listens for `__hermesCanvas`
messages and forwards `text` into the focused session via
`prompt.submit` — no length ceiling.

Widget fragments carry a header on every chunk:

```
CANVAS-V1-C#2/3 {"tag":"CANVAS-V1-C",...420 chars...}
```

Receiver duty: buffer by `#n/m` sequence until `n === m`, strip headers,
concatenate, then `JSON.parse`.

## Payload

```jsonc
{
  "tag": "CANVAS-V1-C",
  "sentAt": "2026-09-30T01:23:45.000Z",
  "imgs": 2,                       // image shapes on board (not serialized)
  "marks": [ /* one entry per non-image shape */ ]
}
```

### mark (common fields)

| field | meaning |
|---|---|
| `t` | tldraw shape type: `draw` / `arrow` / `text` / `geo` / `note` … |
| `id` | shape id — **prefix carries semantics** (below) |
| `x`,`y` | shape origin, canvas px, ints |
| `w`,`h` | size when the type has one |
| `label` | label text if the shape has one |
| `color` | tldraw color name (`red`, `blue`, …) |
| `pts` | `draw` only: up to 24 sampled `[x,y]` points (every 3rd, relative to shape origin) |
| `d` | `arrow` only: `[x1,y1,x2,y2]` endpoints relative to shape origin |
| `geo`,`dash` | `geo` shapes: `rectangle`/`ellipse`… and `dashed`/`solid`… |
| `text` | `text` shapes: plain text extracted from Tiptap richText |

Images are counted, not serialized — the agent already knows what it put
on the board; the marks are *deltas on top of the current board*.

### id prefixes — semantic marks

Beyond free-form annotation, three structured intents ride on shape-id
prefixes:

| prefix | shape | meaning |
|---|---|---|
| `shape:mvA:<ts>` | red dashed rect | **source region** of a move |
| `shape:mvB:<ts>` | red dashed rect | **target region** (position + size) |
| `shape:mvArrow:<ts>` | red dashed arrow | visual A→B guide (ignore when parsing) |
| `shape:aislot:<ts>` | blue dashed rect | **generation slot**: frame = output size & drop position |
| `shape:aitext:<ts>` | blue text | prompt text for the slot, format `AI: <prompt>` |

`<ts>` (base36 timestamp + counter) pairs A/B/arrow of the same move;
multiple pairs per board are valid.

**Agent-side interpretation:**

- *Move pair*: crop/derive the content under rect A (canvas px minus image
  shape offset → image-local px), re-render it into rect B's position and
  size. A(x,y,w,h) → B(x,y,w,h).
- *AI slot*: generate an image from the paired text (strip the `AI: `
  prefix), sized to the rect, dropped at the rect.
- *Free marks*: interpret text + geometry against the image(s) they
  overlap — arrows point at the thing, circles surround it, `x/y` in
  canvas px; convert to image-local by subtracting the image shape origin,
  then to percentages by dividing by image `w/h`.

## The `__INITIAL__` payload (board content format)

The board's content is the `window.__INITIAL__` JSON segment inside
`demo/canvas.html` (single occurrence; regex-swappable). tldraw v3
records:

```jsonc
{
  "assets": [
    { "id": "asset:img1", "typeName": "asset", "type": "image",
      "props": { "name": "img1.webp", "src": "data:image/webp;base64,...",
                 "w": 640, "h": 640, "mimeType": "image/webp", "isAnimated": false },
      "meta": {} }
  ],
  "shapes": [
    { "id": "shape:img1", "type": "image", "x": 60, "y": 50,
      "props": { "assetId": "asset:img1", "w": 640, "h": 640 } },
    { "id": "shape:t1", "type": "text", "x": 80, "y": 480,
      "props": { "richText": { "type": "doc", "content": [
                   { "type": "paragraph", "content": [
                     { "type": "text", "text": "caption" } ] } ] },
                 "color": "black", "size": "s" } },
    { "id": "shape:g1", "type": "geo", "x": 100, "y": 100,
      "props": { "geo": "rectangle", "w": 200, "h": 120,
                 "color": "red", "dash": "dashed", "fill": "none", "size": "s" } }
  ]
}
```

Notes:

- asset `props.src/name/w/h/mimeType` all live in `props` (v2 put them
  top-level) — see TLDRAW-NOTES §2 for the rest of the v3 API contracts
- text `richText` is a Tiptap doc (`{type:'doc',content:[...]}`) — an
  array is NOT accepted
- `createShapes` accepts partials; tldraw fills defaults
- images: WebP data URLs, ≤640 px wide (~50 KB each inline)
- empty board: `{"assets":[],"shapes":[]}`

## Round trip

1. Agent builds board (images + any scaffold) → edits the demo's
   `__INITIAL__` segment, `canvas_write` → user hits **Refresh** in the
   Desktop page.
2. User annotates (draw/arrow/text freely, or the scaffold tools) →
   **回传画布**.
3. Payload arrives in the session (fragmented on the widget channel).
4. Agent parses per above, generates/edits images, lays results out next
   to the originals (e.g. new image at `x + 700`), rebuilds the board.
5. Goto 1 — the loop converges when the user stops marking.

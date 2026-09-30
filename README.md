# hermes-canvas — infinite canvas for Hermes Desktop

An open, agent-driven infinite canvas that plugs into
[Hermes Agent](https://github.com/NousResearch/hermes-agent). The agent
builds image boards as a **single self-contained HTML file** (tldraw engine
fully inlined, zero runtime network), serves it over the plugin API, and
you annotate on it — circle things, draw arrows, drop structured
"move this here" / "generate this" marks — then send it all back into the
chat session. The agent reads the marks, edits/generates images, and the
loop repeats.

```
┌─────────────┐  canvas.html   ┌──────────────┐  annotations   ┌─────────┐
│ agent side  │ ─────────────► │ Desktop page │ ─────────────► │ session │
│ canvas_write│  (ctx.rest)    │ (sidebar)    │ (prompt.submit)│         │
└─────────────┘                └──────────────┘                └─────────┘
        ▲                                                             │
        └───────────── agent rebuilds board from marks ◄──────────────┘
```

*Same loop whether Desktop connects to a local gateway or a remote one —
the arrows are API calls (`ctx.rest`, `prompt.submit`) riding whatever
connection Desktop already has to its Hermes server.*

**Why single-file?** The canvas renders inside sandboxed iframes (chat
widget, plugin page) where external fetches are blocked — and it keeps
working fully offline, forever, on any host you copy it to.

## Features

- **Zero-network tldraw** — engine, 16 fonts, icon sprite, translations
  all inlined as data: URLs; verified zero external requests
- **Annotation round-trip** — compact `CANVAS-V1-C` JSON protocol with
  structured marks (move-pairs, AI-slots) on top of free-form drawing
  ([protocol spec](docs/PROTOCOL.md))
- **Two hosts, one file** — chat widget (`::preview`) and Desktop sidebar
  page, auto-detected send channels
- **Agent tool included** — `canvas_write` writes the board; your agent
  can push new content without touching plugin code
- **Hackable artifact** — `demo/canvas.html` is the board *and* the
  template: content is one JSON segment, chrome is plain text (below)

## Install

Requirements: a Hermes server (the agent half lives there) + Hermes
Desktop. Both connection modes work — Desktop logged into a **local**
gateway on the same machine, or into a **remote** gateway over SSH.
The install flow differs slightly:

**Single machine** (Desktop and agent on the same box — the common case):

```bash
hermes plugins install Hopers/hermes-canvas-plugin --enable
```

One command, both halves land: the package goes into `plugins/`, and the
Desktop app picks up the `desktop/` half from it automatically.

**Split topology** (agent on a server, Desktop elsewhere):

```bash
# 1. on the server (or ask your agent to run it)
hermes plugins install Hopers/hermes-canvas-plugin --enable

# 2. in Desktop (on YOUR machine), open:
hermes://plugin/install?repo=Hopers/hermes-canvas-plugin
#   tick the **desktop** component only — the agent half already lives on
#   the server, and a remote backend cannot accept plugin installs from
#   the dialog anyway; the desktop half is a local clone on this machine
```

The canvas page appears in the Desktop sidebar (the canvas / layout icon).

> **No-CLI path:** just send this repo's URL to your Hermes agent and say
> "set up my canvas" — `AGENTS.md` in the repo root tells it the whole
> flow, including the `hermes://` link to hand you. The one thing it
> cannot do is clicking that Desktop install dialog.

## Making boards — the one route

`demo/canvas.html` is a fully-built, zero-network canvas. **You never
build anything — you edit this file.** It has two editable seams:

**1. Content — the `__INITIAL__` segment.** The board's entire content is
one JSON block:

```
<script>window.__INITIAL__ = {"assets":[...],"shapes":[...]};</script>
```

Locate it (regex `<script>window\.__INITIAL__ = .*?;</script>`, single
occurrence), replace with your payload, save. Image assets are data URLs:

```bash
ffmpeg -i in.png -vf "scale='min(640,iw)':-2" -quality 80 out.webp
base64 -w0 out.webp   # → asset props.src = "data:image/webp;base64,..."
```

Asset/shape record format: [docs/PROTOCOL.md](docs/PROTOCOL.md).
Write the result to `$HERMES_HOME/canvas/canvas.html`, hit **Refresh**
in the canvas page. Loop:

1. Agent puts images on the board (WebP data URLs, ≤640 px)
2. You circle / arrow / text / drop move-pairs or AI-slots
3. Hit **回传画布** ("send back") — marks land in the session as
   `CANVAS-V1-C` JSON
4. Agent parses ([protocol](docs/PROTOCOL.md)), edits or generates, board
   updates; hit Refresh

**2. Chrome & language — plain text.** All button labels, headings and
status messages are plain strings inside the file (`sed` them): the shell
ships in Chinese — localize freely. The tldraw UI locale is the literal
`locale:"zh-cn"` in the `updateUserPreferences` calls (en/zh-cn
translations both inlined; other locales would need rebuilding, which is
out of scope for this repo).

The `canvas_write` tool accepts either the edited full HTML or a bare
`{"assets":[],"shapes":[...]}` JSON (it then wraps a minimal esm.sh shell
— needs network at view time; the demo route above never does).

## Repo layout

```
├── plugin.yaml            # unified package manifest (agent + desktop halves)
├── __init__.py            # agent half: canvas_write tool
├── demo/canvas.html       # the board AND the template — edit, never build
├── licenses/tldraw-LICENSE.md  # travels with the bundled tldraw (see NOTICE)
├── dashboard/
│   ├── manifest.json      # backend route mount
│   └── plugin_api.py      # GET /api/plugins/hermes-canvas/canvas → canvas.html
├── desktop/plugin.js      # Desktop half: sidebar page, iframe + prompt.submit relay
└── docs/
    ├── PROTOCOL.md        # CANVAS-V1-C wire format + init payload spec
    └── TLDRAW-NOTES.md    # tldraw v3 zero-network inlining field notes
```

## Updating

Two topologies — check which one you are on:

- **Single machine** (Desktop app and agent on the same box — the common
  case): one command does it all:

  ```bash
  hermes plugins update hermes-canvas
  ```

  The CLI refreshes `plugins/hermes-canvas/`, and the Desktop app re-copies
  the `desktop/` half into its plugin root (Capabilities → Plugins →
  **Rescan** if it hasn't picked it up). The `hermes://…&force=1` link also
  works but is not required here.

- **Split topology** (agent on a server, Desktop on another machine):
  - server: `hermes plugins update hermes-canvas`
  - Desktop machine: reopen
    `hermes://plugin/install?repo=Hopers/hermes-canvas-plugin&force=1` —
    the desktop half is a separate local clone there; running the CLI
    update *on the Desktop machine* does **not** touch it.

- **New board content only** — rewrite the `__INITIAL__` segment (server
  side); hit Refresh in the plugin. No reinstall, no update, nothing.

## Design decisions worth stealing

- **ctx.rest is the only data path.** The Desktop fetches the canvas over
  its existing authenticated connection to the Hermes server — no CDN, no
  public exposure, no stale cache. The day this channel fails, the plugin
  fails loudly instead of degrading to a stale fallback (deliberate).
- **The artifact is the template.** No build pipeline to maintain, no
  Node toolchain to install — an agent with `sed` and a JSON payload can
  reshape the whole board. Complexity lives in the artifact once, not in
  everyone's workflow forever.
- **The *live* board never enters git.** Your working canvas is
  server-local state (`$HERMES_HOME/canvas/canvas.html`), rewritten every
  round; only the committed `demo/canvas.html` showcase travels with the
  repo.
- **Compact marks, not shape dumps.** Full tldraw shape JSON overflows the
  widget channel at ~600 chars; the compact format (type/xy/label/pts,
  semantic id prefixes) fits in fragments and stays parseable.
- **Fail loudly over silent fallbacks.** A canvas that silently shows last
  week's board is worse than an error banner you can act on.

## License & third-party bits

Code: MIT ([LICENSE](LICENSE)). `demo/canvas.html` bundles
[tldraw](https://github.com/tldraw/tldraw) (bundling permitted with the
license attached — a verbatim copy ships in
[licenses/](licenses/tldraw-LICENSE.md), see [NOTICE](NOTICE.md)).
Anton font: OFL 1.1.

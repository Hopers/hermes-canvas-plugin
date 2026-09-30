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
- **Own the template** — `canvas-template/` is a standalone build pipeline
  (npm + esbuild + one Python script); retheme the shell, swap fonts,
  fork the whole look

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

The canvas page appears in the Desktop sidebar (🎨 / 布局 icon). First
board: ask your agent to use the `canvas_write` tool, or build one with
the template:

> **No-CLI path:** just send this repo's URL to your Hermes agent and say
> "set up my canvas" — `AGENTS.md` in the repo root tells it the full
> flow (server install, the `hermes://` link to give you, first-board
> build). The one thing it cannot do for you is clicking that Desktop
> install dialog.

```bash
git clone https://github.com/Hopers/hermes-canvas-plugin
cd hermes-canvas-plugin/canvas-template
npm install && python3 gen_assets.py && npm run bundle
python3 build_canvas.py    # init optional: init.json → init.example.json → empty
                             # → $HERMES_HOME/canvas/canvas.html
```

Hit **Refresh** in the canvas page. Loop:

1. Agent puts images on the board (WebP data URLs, ≤640 px)
2. You circle / arrow / text / drop move-pairs or AI-slots
3. **回传画布** — marks land in the session as `CANVAS-V1-C` JSON
4. Agent parses ([protocol](docs/PROTOCOL.md)), edits or generates, board
   updates; hit Refresh

## Repo layout

```
├── plugin.yaml            # unified package manifest (agent + desktop halves)
├── __init__.py            # agent half: canvas_write tool
├── dashboard/
│   ├── manifest.json      # backend route mount
│   └── plugin_api.py      # GET /api/plugins/hermes-canvas/canvas → canvas.html
├── desktop/plugin.js      # Desktop half: sidebar page, iframe + prompt.submit relay
├── canvas-template/       # standalone build pipeline for canvas.html
│   ├── shell.html         #   page chrome (editorial style — swap freely)
│   ├── entry.jsx          #   engine wiring + annotation protocol
│   ├── gen_assets.py      #   CDN → data-URL asset module (license capture too)
│   ├── build_canvas.py    #   assembler (shell + CSS + bundle + init.json)
│   └── design-assets/     #   optional Anton display font (OFL)
└── docs/
    ├── PROTOCOL.md        # CANVAS-V1-C wire format
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

- **New board content only** — the agent rewrites canvas.html (server
  side); hit Refresh in the plugin. No reinstall, no update, nothing.

## Design decisions worth stealing

- **ctx.rest is the only data path.** The Desktop fetches the canvas over
  its existing authenticated connection to the Hermes server — no CDN, no
  public exposure, no stale cache. The day this channel fails, the plugin
  fails loudly instead of degrading to a stale fallback (deliberate).
- **Canvas content never enters git.** The board is server-local state
  (`$HERMES_HOME/canvas/canvas.html`); the repo carries only the machinery.
- **Compact marks, not shape dumps.** Full tldraw shape JSON overflows the
  widget channel at ~600 chars; the compact format (type/xy/label/pts,
  semantic id prefixes) fits in fragments and stays parseable.
- **Fail loudly over silent fallbacks.** A canvas that silently shows last
  week's board is worse than an error banner you can act on.

## License & third-party bits

Code: MIT ([LICENSE](LICENSE)). The built canvas embeds
[tldraw](https://github.com/tldraw/tldraw) (bundling permitted with
license attached — see [NOTICE](NOTICE.md)); assets are fetched at build
time, never committed. Anton font: OFL 1.1.


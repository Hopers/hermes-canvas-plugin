# AGENTS.md — operator brief for this repo

You are working with `hermes-canvas`, an infinite-canvas plugin for Hermes
Desktop. This file is auto-injected when an agent runs inside this repo —
follow it instead of re-deriving the flow from the README.

## When a user shares this repo link with you

Their goal: their own working canvas. Your job, in order:

0. **Check the topology first.** Is the Hermes server (the machine you run
   on) the same box as the user's Desktop app? If yes, everything below
   simplifies: `hermes plugins update hermes-canvas` alone updates both
   halves after any repo push — no install link needed. If Desktop runs
   elsewhere (split topology), follow the two-half flow below.

1. **Server half (you can do this yourself):**
   ```bash
   hermes plugins install Hopers/hermes-canvas-plugin --enable
   ```
   Verify with `hermes plugins doctor hermes-canvas`. If the install
   target is the machine you run on, this registers the
   `canvas_read` / `canvas_propose` / `canvas_write` tools, four
   board↔session hooks, and mounts the plugin's REST routes
   (`/api/plugins/hermes-canvas/*`).

2. **Desktop half (user must do this — you cannot):**
   Only needed in a **split topology** (Desktop app on a different machine
   than the server you run on). Tell the user to open, in Hermes Desktop:
   ```
   hermes://plugin/install?repo=Hopers/hermes-canvas-plugin
   ```
   and tick the **desktop** component in the confirm dialog (the agent
   half already lives on your machine from step 1; a remote backend
   cannot accept plugin installs from the dialog anyway).
   On a **single-machine** setup step 1 already covered both halves —
   skip this entirely.
   Ask them to confirm when the「画布」/ canvas entry appears in the
   sidebar. Do not claim the install is complete before this.

3. **First board — copy the demo and swap its INIT payload.**
   `demo/canvas.html` is a fully-built, zero-network board; for content
   changes the artifact IS the template (a `build/` pipeline exists for
   structural changes — see the README — but you never need it to swap
   content). The content is
   one JSON segment:
   `<script>window.__INITIAL__ = {"assets":[...],"shapes":[...]};</script>`
   — replace that segment (regex-locatable, single occurrence) with your
   payload (image assets as data URLs; WebP ≤640 px, see
   docs/PROTOCOL.md), write the result to
   `$HERMES_HOME/canvas/canvas.html`. No Node, no CDN fetch, engine
   guaranteed identical to the showcase. The `canvas_write` tool accepts
   the edited full HTML; a bare JSON payload also works but wraps a
   minimal esm.sh shell (needs network at view time — prefer the demo
   route). Shell chrome & button labels are plain text in the same file —
   `sed` them for localization if the user isn't Chinese-speaking.
   Then tell the user to hit **Refresh** in the canvas page.

## Changing an existing board — propose, don't rewrite

`canvas_write` replaces the whole board and discards the person's
`state.json`. For any edit to a board that already exists, use the
proposal queue instead:

1. `canvas_read` — real shape ids, measured bounds, pending proposals.
2. `canvas_propose` — a short `summary` plus add/update/delete ops that
   reference those ids (format in `docs/PROTOCOL.md`).
3. The canvas shows them as a ghost layer; the person clicks **接受** or
   **忽略**. You are told nothing — check `canvas_read.pending_proposals`
   if you need to know.

An `add` whose id already exists is rejected outright (tldraw would
otherwise overwrite silently), and ghost shapes never enter the saved
board state, so an ignored proposal costs nothing.

## When annotations arrive (CANVAS-V1-C)

A canvas round-trip message lands in your session as JSON, possibly as
`#n/m` fragments on the widget channel — buffer and join before parsing.
Semantics (move-pairs, AI-slots, free marks) are specified in
`docs/PROTOCOL.md`. Read it before interpreting; the id prefixes carry
the structure.

While the canvas is open, the plugin also appends a **board summary plus
a delta of what the person just changed** to your turn — you do not need
to be sent the board to know what is on it. That context is ambient and
summative; the button is still the full-fidelity channel.

## Hard rules

- **Localize before first build if your user isn't Chinese-speaking.**
  The stock shell (buttons, status lines, hints) is Chinese — but it's
  plain text inside `demo/canvas.html` itself: `sed` the labels, and
  change the literal `locale:"zh-cn"` in the `updateUserPreferences`
  calls to the user's locale (en translation is already inlined; other
  locales are out of scope for this repo).
- Editing `demo/canvas.html` is the supported workflow (INIT swap, sed
  the chrome) — but the engine sections (the giant minified script/CSS
  blocks) are off-limits: don't regex them, don't reformat them.
  **Anchor warning**: injecting content by replacing the *first*
  `</body>` in the file is NOT safe — the minified engine strings
  contain that literal, and you'd slice the script mid-token (engine
  dies silently at INIT). Only two safe seams exist: the `__INITIAL__`
  segment (regex, unique) and `<script>window.__CANVAS_FULL__ =
  true;</script>` (unique) — verify `count == 1` before any replace.
- The **live** board (`$HERMES_HOME/canvas/canvas.html`) is server-local
  user state — never commit it. The only canvas.html in git is the
  committed demo showcase; if the user wants a fresher showcase,
  build a **sample** board and replace the demo copy explicitly.
- Images the **agent** places go on the board as data URLs: WebP, ≤640 px
  wide, quality ~80 (`ffmpeg -i in.png -vf "scale='min(640,iw)':-2"
  -quality 80 out.webp`). PNG base64 bloats the board.
- Images the **user pastes** (Ctrl+V) are a different path: the original
  bytes are uploaded to `$HERMES_HOME/canvas/assets/` untouched and shown
  from a local data URL; the send-back carries only `asset` (a filename).
  Read that file when you need the original — it is full resolution. Never
  downscale a pasted image and never assume the board's data URL is the
  source.
- Canvas content is server-local state; never commit boards to git.
- After rewriting the board, always tell the user to hit Refresh — the
  plugin does not auto-reload.

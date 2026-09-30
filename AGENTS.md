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
   target is the machine you run on, this registers the `canvas_write`
   tool and mounts `GET /api/plugins/hermes-canvas/canvas`.

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
   `demo/canvas.html` is a fully-built, zero-network board; there is no
   build step in this repo — the artifact IS the template. The content is
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

## When annotations arrive (CANVAS-V1-C)

A canvas round-trip message lands in your session as JSON, possibly as
`#n/m` fragments on the widget channel — buffer and join before parsing.
Semantics (move-pairs, AI-slots, free marks) are specified in
`docs/PROTOCOL.md`. Read it before interpreting; the id prefixes carry
the structure.

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
- The **live** board (`$HERMES_HOME/canvas/canvas.html`) is server-local
  user state — never commit it. The only canvas.html in git is the
  committed demo showcase; if the user wants a fresher showcase,
  build a **sample** board and replace the demo copy explicitly.
- Images go on the board as data URLs only: WebP, ≤640 px wide,
  quality ~80 (`ffmpeg -i in.png -vf "scale='min(640,iw)':-2" -quality
  80 out.webp`). PNG base64 bloats the board.
- Canvas content is server-local state; never commit boards to git.
- After rewriting the board, always tell the user to hit Refresh — the
  plugin does not auto-reload.

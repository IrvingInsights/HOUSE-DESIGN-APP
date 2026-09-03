# RESUME — Natural Building studio
Fresh-session brief. Rewritten 2026-09-03 (updates 233–244). Git history holds
the old status stack.

## What this is
A local-first home-design studio for Daniel (and one friend) — both total
non-coders. Live 3D / plan / wall model, one page per building system,
costs / code checks / carbon, a chat that makes changes in plain words, a
drawing reader, and permit / frame / IFC export. Node backend (zero backend
deps), React/Vite frontend, one shared current project with revision
snapshots. Public repo: github.com/IrvingInsights/HOUSE-DESIGN-APP.

Run: `node server.mjs` from this folder (or start.bat — it pulls, moves the
folder onto the main line, and self-restarts). Port 5184. **Backend `.mjs`
edits need a server restart** (module cache); the frontend hot-reloads.

## STATE (2026-09-03, update 244)
- **ONE app, not two.** `src/main.jsx` and `classic.html` — the old parallel
  build — were retired in update 242, after everything they alone could do was
  brought into the live app. `index.html` → `src/reimagine/main.jsx` →
  `src/reimagine/App.jsx` is the whole frontend now.
- **What came back from the old build** (updates 237–242): export (permit
  sheets, frame drawings, written brief, BIM data, IFC/Blender), the Layers
  panel with exploded view, fifteen one-tap fixes on the flags, the Studio
  chat, drawing reading, and the site controls (postcode, latitude, rain,
  slope) that would otherwise have gone down with the old build — the
  from-scratch audit caught that one.
- **Also new** (233–236): start.bat and the in-app updater put a folder parked
  on a side branch back onto `main` (that is why a session once ran a month
  behind); a real **Start on empty land**; the verdict tiles moved to the top
  of the left bar; one history list instead of two.
- **The 3D view can no longer open blank** (244): a pane measured before it had a width made the camera stand 8,100 ft back, past its own far plane. Fixed at three points and pinned by tools/camera_fit_test.mjs (152 checks, verified to fail when reverted).
- **All batteries green:** design_space 15,316 · op_smoke 228 · placement
  2,312 · receipts 439 · golden_numbers 189 pinned / 0 drifted · capability
  272 across 57 capabilities · studio_ask 34 · trace_flags 13 ·
  from_scratch_audit 0 gaps · deck_stair · outbuilding_roof · thermal ·
  timeline · greenhouse · face_law · floor_resize · persistence · geom_core ·
  trace_repair · camera_fit 152.
- **No AI key on this machine.** `.env.local` does not exist, so the chat's AI
  paths and the drawing reader cannot be proven end to end here. The app says
  so plainly rather than failing oddly, and the keyless paths (local room
  adds, duplicate-opening cleanup) are proven by `tools/studio_ask_test.mjs`.

## START HERE
1. **Get a Gemini key into `.env.local`**, then run one drawing through
   *+ New → Start from a drawing* and `node tools/trace_corpus_test.mjs`. That
   is the one part of the app that has not been exercised end to end since the
   port.
2. Then the depth work in the **Why can't I** list on the Notion hub: the L /
   wrap deck stair, an asymmetric gable on a structure, plywood as a wall
   covering, heat-source clearance to combustibles, and the fact that two
   joined structures are still priced as two.
3. Gate B still stands: a first-time user, an hour, no dead ends. Daniel
   cannot run it — he routes around the rough edges without noticing.

## The disciplines (hard-won — keep them)
**Ops & data**
- Every new op = THREE registrations: bim-core handler + client mirror
  (engine.js) + planner schema enum. Grep the enum when an op "doesn't work
  via chat". `tools/from_scratch_audit.mjs` catches the reverse: an op with no
  screen behind it. It follows one hop through the shared planners in
  engine.js/placement.js, so a control that calls a helper still counts.
- Zero-filled ops: 0 means "unset" (the basement is level -1 for this reason).
  `update_object` writes strings — use move_object/resize_object for numbers.
- Multi-step UI actions = ONE batched dispatch — never N calls on stale state.
- updateShell has an 18-ft minimum clamp branch: new shell fields need their
  own branch or they get clamped absurdly.
- detectIssues / normalizeRooms are deliberately DUAL-COPIED and diverged by
  layer (server-lite in bim-core, full in engine) — see the LAYERING NOTE in
  both. Run `tools/golden_numbers_test.mjs` after any house-math change.

**The app's own honesty rules**
- A dead AI is SAID, never covered over. No canned paragraph in place of an
  answer; no "read" of a drawing that was never read. `studio_ask_test.mjs`
  holds this from the command line.
- Anything hidden in the 3D view is announced on screen, with the reminder
  that the costs still cover the whole house.
- A drawing reader's doubts are ORDINARY flags in "Worth a look", not a
  separate screen, and they clear themselves when fixed (`trace_flags_test`).
- THE CLIPPING LAW: a popup that opens out of a scrolling strip must not be a
  child of it. The flags popup was invisible for weeks this way; the export
  and layers menus are portalled to the page for the same reason.

**Live-app testing**
- Daniel uses the app between sessions — never assume which design is live.
  Back up `.data/projects/reimagine/project-state.json` first (the folder's own
  convention: `project-state.BEFORE-<what>.json`).
- Never hand-edit his design data to make a symptom go away; the app has to be
  able to do it. Remove a test object through the app's own control.
- Undo does not survive a page reload — the designs shelf does.
- Kill a stuck server by CommandLine match; zombies accumulate because the
  crash guard keeps EADDRINUSE processes alive.

**Daniel**
- Plain language everywhere, no jargon in the UI or in messages to him.
- Fix the class, never the instance: it must work for ANY house, not his.
- For taste decisions offer 2–3 directions and let him choose.

## Map
- `backend/`: server.mjs (crash-guarded), routes.mjs, planner.mjs (the drawing
  pipeline), bim-core.mjs (ops + the model authority), studio.mjs (the chat's
  server half), gemini.mjs, project-store.mjs, update.mjs (self-update, and
  branch-aware since 233), trace-jobs.mjs, blender-launcher/bridge.
- `src/`: `reimagine/App.jsx` (the app, ~6k lines) + shell.css / siteTable.css,
  `studio/` (ask.js — the chat ladder as a pure function, ChatDrawer.jsx,
  attachments.js), engine.js (spec logic, tables, fetchers), threeScene.jsx,
  planView.jsx, placement.js (the LAW OF PLACEMENT), docExports.js,
  frameDrawings.js, blenderBridge.js, styles.css.
- `tools/`: the batteries. `prove_it.mjs` / PROVE-IT.bat runs the set;
  `capabilities.json` is the user-facing capability inventory.
- `.data/` (gitignored): projects + revisions, trace corpus, server-errors.log.

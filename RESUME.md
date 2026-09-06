# RESUME — Natural Building studio
Fresh-session brief. Rewritten 2026-09-03 (updates 233–247). Git history holds
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

## STATE (2026-09-05, update 250)
- **A fresh browser cannot overwrite the shared design with the sample house
  (250).** The 400 ms autosave used to run before the first server reconcile;
  on a slow first load it stamped the seed into local storage as "newer" and
  the reconcile pushed it up over the real design. Caught live on Daniel's own
  house (restored from the revisions shelf, byte-identical). `reconciledRef`
  in App.jsx now holds the autosave until the first look at the engine is
  over. Rule: a timestamp written by a browser that has not yet asked the
  engine is not evidence of anything.
- **The four "still not built" items from July are built (249).** (1) A
  structure's roof is a **shed or a gable**, with a settable pitch and a ridge
  that can sit off-centre — the asymmetric gable; one resolver
  (`resolveStructureRoof` in engine.js) feeds the 3D scene, the flags and
  `outbuilding_roof_test`. (2) **Plywood** (and OSB, board & batten) are wall
  skins: `WALL_SKINS` in bim-core is the roof list plus the wall-only ones;
  `wallCovering` reads it. (3) **Heat-source clearance to combustibles**:
  `resolveHeatClearance` measures the heater against the walls around it —
  36″ open / 12″ shielded for a stove, 4″ for an ASTM E1602 masonry heater —
  and the flag offers the real remedy (move it; or shield it and move it) or
  says honestly that it does not fit. Polycarbonate walls get their own
  sentence. `heat_clearance_test` (33) pins Daniel's 68″ workshop arithmetic.
  (4) **A shared wall is priced once — never**: the join law moved into
  bim-core (`structureGroups`), the scene draws by it and the receipts take the
  shared stretch off the wall third exactly like an open side
  (`structure_cost_test`, 17). Also: `normalizeRooms`' outline fit now runs to
  a fixed point (the fuzz found a round house that needed two passes), and the
  fuzz generator places structures and heaters so the design-space proof
  covers all of the above.
- update 248 (another session, same day): a one-click desktop shortcut
  (`create_desktop_shortcut.bat`).

## STATE (2026-09-03, update 247)
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
- **All batteries green (249):** design_space 14,890 · op_smoke 228 · placement
  2,312 · receipts 439 · golden_numbers 189/0 · capability 272 ·
  outbuilding_roof 16,215 (now with gables) · heat_clearance 33 ·
  structure_cost 17 · deck_stair 51 · camera_fit 152 · studio_ask 43.
- **All batteries green (247):** design_space 15,316 · op_smoke 228 · placement
  2,312 · receipts 439 · golden_numbers 189 pinned / 0 drifted · capability
  272 across 57 capabilities · studio_ask 34 · trace_flags 13 ·
  from_scratch_audit 0 gaps · deck_stair · outbuilding_roof · thermal ·
  timeline · greenhouse · face_law · floor_resize · persistence · geom_core ·
  trace_repair · camera_fit 152 · studio_ask 43 · deck_stair 51.
- **Deck stairs can turn a corner (247).** A third shape: along one deck edge,
  a landing at the corner, then round the next edge, tucked under and costing
  no ground. The second leg may carry on across a touching deck, because decks
  that meet are one surface. On his own house it refuses in every direction and
  names why (the east slider’s clear ground at the corner; the greenhouse under
  the main deck) — exactly what the July handoff predicted. 13 new checks in
  deck_stair_test (51 total); the load-bearing one verified to fail when reverted.
- **The AI half is proven live (245).** Daniel put a Gemini key in
  `.env.local` (gitignored, never committed). Through the running app: the
  expert answered a real question about his house in plain words naming the
  real materials; the planner changed a copy of his design with persist:false
  and the design file stayed byte-identical; the drawing reader read an image
  of his own plan back as seven correctly named and sized rooms, scored itself
  10 of 11, and its one doubt is an ordinary flag. Two things it exposed were
  fixed the same hour: the expert was never sent the walls or heating (it said
  it had no idea what the house was made of), and "make the kitchen 12 by 16"
  through the AI lost the 16 and reported "12' x 0'" — a room size is exact
  arithmetic now (`parseLocalResize` in ask.js, never the AI), the planner's
  schema says what w and d mean, and the wording never prints a 0.

## START HERE
1. Drop a real floor-plan PDF into `.data/trace-corpus/` and run
   `node tools/trace_corpus_test.mjs` — the reader is proven on an image of
   his own plan, not yet on an architect's PDF here.
2. Then the depth work on the Photion project (PRJ-911): let a deck's wrap
   stair run outside the deck's footprint (the only version that fits Daniel's
   own house); price a structure's wall skin; count furniture as a
   combustible near the heater.
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

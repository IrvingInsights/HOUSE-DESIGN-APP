# HANDOFF — for the next tool/agent taking over this app

Written 2026-07-12. The owner (Daniel) is handing this project to fresh eyes.
He and his one other user are total non-coders: plain language everywhere,
zero jargon in the UI or in messages to him.

## What this is

A local-first natural-building home-design studio. Live 3D/plan/detail model,
one design page per building system, live cost/code/carbon feedback, AI chat +
PDF drawing tracing (Gemini), permit/frame-drawing/IFC export. Node backend
(no backend deps), React/Vite frontend, one shared current project with
revision snapshots. Public repo: github.com/IrvingInsights/HOUSE-DESIGN-APP.

- Run: double-click `start.bat`, or `node server.mjs` with cwd = this folder.
  Port 5184. The Gemini key lives in `.env.local` (gitignored, present on
  Daniel's machine).
- **Backend `.mjs` edits need a server restart** (Node module cache) — the
  frontend hot-reloads, the backend does NOT. Forgetting this has burned
  every agent that worked here.

## Read these, in order

1. **STRATEGY.md** — the agreed plan (four phases). Execute it in order;
   don't freelance. Phase 1 (the app scores its own traces in production,
   auto-retries weak reads, reports the score in plain language) is next
   and is the highest-value move on the board.
2. **RESUME.md** — current state + the map of the code.
3. **TESTING.md** — how testers run it; the honest known-limitations list.

## The verification tools (use them; they are the contract)

- **`node tools/design_space_test.mjs` — THE CORRECTNESS GATE (2026-07-19).
  300 seeded random designs built as random op sequences through the real
  applier (`src/reimagine/designFuzz.js`), plus a damaged-legacy corpus,
  held to invariants that must be true for ANY house (no throw, no NaN,
  receipts sum, resolvers finite, heal converges, no unflagged floating
  openings). Every failure prints its seed — replay with `--seed <n>
  --count 1`. THE RULE: nothing ships unless this and the browser fuzz
  battery (`await window.__nbSeamAuditBattery({deep:30})` on :5199) run
  dry. When either finds a bug, fix the CLASS in engine/bim-core, never
  patch the one design; seeds that caught real bugs are permanent (the
  battery's fixed-seed fuzz set replays them every run).**
- `node tools/op_smoke_test.mjs` — 113 checks; run after ANY bim-core edit.
- `node tools/persistence_test.mjs` — the engine-side design store: atomic
  saves, revision per save, corruption set-aside, project isolation.
- `node tools/trace_repair_test.mjs` — 111 checks; run after planner edits.
- `node tools/geom_core_test.mjs` — 41 checks; run after geometry work.
- `node tools/trace_corpus_test.mjs [--only <name>]` — THE proof for the
  drawing reader: runs the full trace pipeline hands-off against every PDF in
  `.data/trace-corpus/` and scores 11 universal invariants. Needs the server
  running + the Gemini key; ~2–5 min per set, costs pennies. On failure it
  dumps `<set>.lastfail.json` (full spec + plan) beside the PDF — read that
  before theorizing. **A fix counts when the FULL corpus passes, not the one
  set that failed.** Add every misbehaving drawing to the corpus forever.

## Hard-won rules (each one cost a real bug — keep them)

- **Fix the class, never the instance.** Daniel's standing rule: features
  must work for ANY drawing/input, not his examples.
- **Never hand-edit Daniel's design data** to make a symptom go away. The APP
  must be able to do it (UI control + chat vocabulary + trace pipeline).
  Data repairs only on his explicit ask, announced plainly.
- **He uses the app while you work.** Never assume which design/revision is
  live — GET `/api/projects/current` at diagnosis time. Back up the state
  JSON before tests; tests use `persist:false`. His revisions folder mixes
  restarted lineages — trust timestamps, not revision numbers.
- Every new op = THREE registrations: bim-core handler + client mirror
  (engine.js) + planner schema enum. Grep the enum when an op "doesn't work
  via chat."
- WALL_ASSEMBLIES / WALL_SIDES / wallAssemblyKeyFromText / resolveWallSide now
  live ONCE in backend/bim-core.mjs; src/engine.js imports and re-exports them
  (the dual copy was collapsed). detectIssues / normalizeRooms are STILL in both
  files and deliberately DIVERGED by layer (server-lite vs full) — see the
  LAYERING NOTE in each. Run tools/golden_numbers_test.mjs after any change to
  the house-math; it fails loudly if a derived number moves.
- Zero-filled ops: 0 means "unset" (basement is level -1 because 0 is
  swallowed; move_object to origin uses 0.01). update_object writes strings —
  use move_object/resize_object for numbers; `field:'level'` is structural
  (raises storeys, sets elevation).
- updateShell has an 18-ft minimum clamp branch — new shell fields need their
  own branch or they get clamped absurdly.
- Multi-step UI actions = ONE batched dispatch (or chained baseSpec) — N
  separate calls race on stale state and only the last wins.
- Gemini: thinking budget is 0 on schema calls (cost + truncation), minimal
  per-pass response schemas, 8k caps on pass calls; log the raw tail of any
  unparseable reply (`.data/server-errors.log`). `gemini-flash-latest` is a
  rolling alias — quality and pricing shift under it silently.
- The trace pipeline order lives in backend/planner.mjs: staged 4-pass read →
  classic fallback → manifest (distrusted if <3 rooms) → deterministic
  rescues → completeness repair (×2) → self-audit loop (×2) → rescues again.
  Deterministic rescues run after EVERY AI stage — a subset is how bugs
  escaped.
- The 3D scene: all meshes carry `userData.roomId`; spec→mesh rebuild is the
  architecture — never mutate meshes as state. Selection/drag/explode depend
  on the roomId contract.
- Two browser tabs fight over the one shared project (autosave clobbers).
  One tab at a time; park test tabs on a JSON endpoint when done.

## State at handoff (2026-07-12)

- All three unit suites green (113 + 111 + 41).
- **Corpus at handoff: CLEAN — all 4 sets 11/11 hands-off** (columbia-rev1
  5s cached / columbia-st 241s fresh / fl0-carport 175s / fl0-v6 181s,
  full sweep 2026-07-12). This is the baseline; a change that breaks it is
  a regression. (columbia-st.pdf and columbia-rev1.pdf are byte-identical
  duplicates — safe to delete one.)
- MVP ≈ 95% by feature list; the gate is trace trustworthiness (STRATEGY.md
  Phase 1) and then 2–3 testers' first hour.
- Daniel's live design: whatever `/api/projects/current` says — see rule
  above. His Gemini key should be rotated when convenient (old ask).

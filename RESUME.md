# RESUME — Natural Building studio (house-bim-app)
Fresh-session brief. Rewritten 2026-07-12 (~2am, session end). Git history holds the old status stack.

## What this is
A local-first home-design studio for Daniel (and one friend) — both total non-coders. Live 3D/plan/detail model, per-system design pages, costs/code-checks/carbon, AI chat + drawing tracing (Gemini), permit/frame-drawing/IFC export. Node backend (zero backend deps), React/Vite frontend, one shared current project with revision snapshots. Public repo: github.com/IrvingInsights/HOUSE-DESIGN-APP — **push after every job; Daniel pulls via GitHub Desktop.**

Run: `node server.mjs` with cwd = this folder (or start.bat — it self-restarts). Port 5184. Backend `.mjs` edits need a server restart (module cache); frontend hot-reloads (and an HMR full-reload reopens the welcome card in open tabs).

## STATE (2026-07-12)
- **MVP: ~95%.** Remaining errands, in order: (1) diagnose the one open corpus item (below), (2) 20-min TESTING.md known-limitations refresh, (3) send the link to 2–3 testers. Their first hour is the MVP gate. No missing capabilities remain on the list.
- **Trace pipeline** (all shipped + corpus-verified): async background jobs w/ live progress notes (`backend/trace-jobs.mjs`, `POST /api/bim/apply {async:true}` → poll `GET /api/bim/job/<id>`); staged 4-pass read (structure/rooms/openings/elements, per-pass minimal schemas, 8k caps) with classic single-call fallback; drawing manifest (the set's own index incl. envelope dims); measurement strictness (unmeasured rooms bounce back by name); dead-op scrub; deterministic rescues (outdoor-room reclassify, basement re-level, geometry re-anchor + effective-rect shell grow + partition clamps); self-audit loop (≤2 rounds, removal-capped, converges).
- **Corpus ledger** (`node tools/trace_corpus_test.mjs`, sets in gitignored `.data/trace-corpus/`): columbia-st 9/9 ×2, fl0-carport 9/9, fl0-v6 9/9 on the classic path — **8/9 on the newly-alive staged path: KITCHEN outside the shell, evidence dumped**.
- **Costs fixed**: thinking budget 0 on planner calls + minimal pass schemas → traces cost pennies (was: a $25 prepayment in a day; dashboard smoking gun = 1.7M output vs 672k input tokens). Tier-1 paid project "Natural Design Builder"; `gemini-flash-latest` slid 2.5→3.5 Flash mid-month — rolling alias = resilience, but watch pricing.
- **Look**: Sage Studio (sage paper ground, white cards, teal=act-here, wheat highlights, wood secondaries, sepia ink), Architects Daughter hand lettering app-wide (Segoe Print offline fallback), the drawn-bent brand mark. Value-step layer at the end of styles.css; older theme layers beneath are inert but present.
- **UX**: pinned Inspector (bottom of left bar, collapsible), Fine-tune ▸ disclosure on system pages, journey rail (← prev / Next → through build order → Review), visited-system dots, House|Site plan framing + edge arrows + wheel-zoom/pan, model toolbar above the view, chat starts closed w/ unread badge, engine-offline banner + auto-recovery.

## START HERE
1. **Read `.data/trace-corpus/fl0-v6.lastfail.json`** (full failing spec+plan). Diagnose how the staged path put KITCHEN outside the shell (suspects: structure-pass set_shell/set_footprint interplay, or an audit-move id the effective-rect grow didn't match). Fix the CLASS, add a unit test, re-run `node tools/trace_corpus_test.mjs` until clean.
2. Refresh TESTING.md's known-limitations list (setup steps are current; limitations predate ~45 commits).
3. Tell Daniel to send the repo link to his testers. Resist building more first — tester surprises are the last mile.
- Queued/optional: richer staged-read notes in the planning bubble; ifc_writer.py → JS port (drop Blender entirely); light/dark toggle from the retired dark layers; rotate the Gemini key (old ask); Cloudflare tunnel is installed but NOT started (start only on Daniel's explicit word).

## The disciplines (hard-won — keep them)
**Ops & data**
- Every new op = THREE registrations: bim-core handler + client mirror (main.jsx/engine.js) + planner schema enum. Grep the enum when an op "doesn't work via chat."
- Dual copies must stay identical: WALL_ASSEMBLIES / resolveWallSide / detectIssues exist in BOTH bim-core.mjs and engine.js.
- Zero-filled ops: 0 means "unset" (the basement is level -1 precisely because 0 is swallowed). update_object writes strings — use move_object/resize_object for numbers.
- Multi-step UI actions = ONE batched dispatch or chained baseSpec — never N calls on stale state.
- updateShell has an 18-ft minimum clamp branch trap: new shell fields need their own branch.
- After bim-core edits run `node tools/op_smoke_test.mjs` (106); planner edits `node tools/trace_repair_test.mjs` (96); geometry work `node tools/geom_core_test.mjs` (41).

**LLM calls**
- Log the raw tail of every unparseable reply (see the parsePass evidence pattern) — one log line replaced three guessing rounds (the digit-loop: 33k chars of '0').
- Minimal response schemas per task; never grow the op schema's required list (truncation). Per-call maxOutputTokens via callGemini.
- thinkingConfig.thinkingBudget 0 for schema calls (GEMINI_THINKING_BUDGET overrides). Slow + expensive + truncating = check thinking FIRST.
- API refusals ≠ pipeline failures (the corpus harness SKIPs them). Pace bulk runs; estimate spend before test campaigns.

**Generalize (Daniel's standing rule)**
- "Not just my examples — ANY drawings." Fix the class via industry conventions (e.g. shell = conditioned envelope), verify with the corpus's universal invariants, add every misbehaving set to `.data/trace-corpus/`, dump evidence on failure.

**Live-app testing**
- Daniel uses the app between and during sessions — never assume which design/rev is live. Backup first: GET /api/projects/current → save the JSON; restore: park the test tab on a JSON endpoint, wait ~3s, POST the state to /api/projects/current/save. Tests use persist:false.
- Browser pane: screenshots time out (use window.__nbView + the cap-server pattern for framed 3D renders; JS geometry checks otherwise). Same-tick DOM reads after .click() see the pre-render DOM. Computed styles LIE mid-HMR — verify on a fresh load. Synthetic canvas drags MOVE ROOMS. Un-toggle persisted view state (layers) before closing test tabs.
- Server ops: kill by CommandLine match (`Get-CimInstance Win32_Process` filtered on server.mjs) — zombies accumulate because the crash guard keeps EADDRINUSE processes alive. Probe with PowerShell Invoke-WebRequest when Git-Bash curl acts dead. Never chain `&` inside run_in_background commands.

**Styling**
- Two scopes: paper (drawing surfaces + chips floating on them) vs chrome (columns/toolbar). When overriding, re-pin CUSTOM PROPERTIES at equal/higher specificity — later background rules alone lose to token scoping. QC any retheme with the luminance sweep (flag opaque backgrounds under L33) on a FRESH load. No new bare hexes — the scope law comment sits in styles.css.

**Daniel**
- Novice; plain language everywhere, no jargon in the UI or in messages to him. "The APP must be able to do it, not you" — every capability lands as UI control + chat vocabulary + trace mandate. Comprehensive, not piecemeal. For taste decisions, offer 2–3 directions via AskUserQuestion — it has worked every time.

## Map
- `backend/`: server.mjs (crash-guarded), routes.mjs (runBimApply shared by sync + async), trace-jobs.mjs, planner.mjs (trace pipeline: staged read → manifest → scrub → rescues → repair → audit loop; pure parts exported + tested), bim-core.mjs (ops, dual-copy tables), gemini.mjs (callGemini, thinking/caps), project-store.mjs (atomic chained saves), blender-launcher/bridge.
- `src/`: main.jsx (App ~4k lines), engine.js (spec logic/tables/fetchers incl. requestServerAppliedBimAsync), threeScene.jsx (viewport incl. grainTexture, meshFromTris-with-UVs, roofUnderAt, greenhouse render), planView.jsx (PlanView w/ framing + zoom, JointDetail), docExports.js, frameDrawings.js (hand-lettered F-sheets), styles.css (layered; final layers win).
- `tools/`: op_smoke_test.mjs, trace_repair_test.mjs, geom_test.mjs, trace_corpus_test.mjs, blender_headless_server.py.
- `.data/` (gitignored): projects + revisions, trace-corpus + lastfail evidence, server-errors.log (route errors + staged-pass truncation tails).

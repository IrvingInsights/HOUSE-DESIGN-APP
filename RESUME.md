# Resume / Handoff — Natural Building GC app (house-bim-app)

## FRESH SESSION — START HERE (handoff written 2026-07-10 end of day, at commit f91510a)

Daniel asked for FRESH EYES. Read this section, then the invariants, then go.
Deep provenance for everything: Claude memory `natural-building-gc-dashboard-inventory.md`.

### JOB 0 — split main.jsx (context-efficiency refactor, do it FIRST or alone)
`src/main.jsx` is ~9,500 lines — every search, read, and edit in any session
pays its size tax, and it is the #1 reason sessions chew context. Split into
modules with NO behavior change (pure moves + imports):
`src/engine.js` (deriveDesign, detectIssues, tables), `src/threeScene.jsx`
(ThreeScene + renderModel), `src/planView.jsx` (PlanView), `src/inspector.jsx`
(the editor pane), `src/systemPages.jsx` (the left-bar pages), `src/ops.js`
(client op mirror + dispatch helpers). Keep the bim-core duplicates
(resolveWallSide, WALL_ASSEMBLIES) exactly as they are — just relocated.
Verify: all three suites + Vite transform + a browser smoke. This is a
one-session mechanical job that makes every later session cheaper.

### The two jobs Daniel explicitly queued for the next session

**JOB 1 — Salvetti-grade 3D timber frame.** Daniel: "When I click frame, I
should see a frame like the ones from David Salvetti rendered in the 3D."
Today's frame render (renderModel, search `frameKey3d`) is posts + top plates
only — placeholder grade. What he wants is a REAL timber frame skeleton:
bents (posts + tie beams + knee braces), plates, and rafters, reading like a
frame-raising photo. **The geometry already exists in `src/frameDrawings.js`**
— `FRAME_MEMBERS` sizes, the F110 Typical Bent math (posts, ties, braces,
plumb-cut rafters), per-facing elevations. Port that member logic into the 3D
elements: bents at `spec.frame.baySpacingFt` along the long axis, plates
running wall lines, rafters at o.c. following roofProfile (shed raked /
gable ridge), knee braces post↔plate. Strong follow-on: a "Frame" LAYER
preset (walls translucent/hidden, skeleton solid) so clicking Frame in the
selector/page shows the raising view. All members carry
`userData.roomId = 'frame-main'` (selection glow + explode already work).

**JOB 2 — the UX-designer pass, round 2.** Daniel: "we are not done
perfecting the simplicity and ease of use." His pain points this arc, in his
words: "the workflow of editing in the model is painful", "why can't I grab
every part", "cluttered with labels", "the very top is muddled", "I cannot
reposition the storeys" (fixed, but the DISCOVERABILITY was the failure),
numeric variables must always be workable. Direction from earlier passes:
he picks a direction when offered 2-3 concrete options (AskUserQuestion with
previews worked well: "warm earthen studio", "Direction 2 one-editor").
Ideas worth proposing: click-to-edit-in-place on the model (tap wall → inline
height field at the wall), a compact always-visible "what can I do with this"
action row on selection, progressive disclosure on system pages (plain
numbers first is policy but pages have grown), a first-run guided tour.
Audit the whole left bar against "EVERYTHING it needs, NOTHING it doesn't."

### What today shipped (all committed, suites 96 op + 41 geom + 12 trace green)
One line each; details in the sections below and in Claude memory:
- Basement = 4th foundation option AND a storey (level **-1**, never 0);
  heated toggle; egress + stair checks; Basement plan tab.
- Interior partition walls (category 'partition', door via widthFt/positionFt,
  "Draw walls between rooms" auto-generate, 3D door gaps + headers).
- Real stairs (treads/risers) + stairwell VOIDS through plates (subtractRect).
- Glazed wall assembly + porch canopies (element.roofType) + chimney flues.
- Greenhouse face: per-side kneewalls (min 2ft) + sunGlazing/sunGlazingTiltDeg
  (angled glass band kneewall→eave, timber battens, engine + frame accounting).
- resize_wall_segment op: segment length + start position slide along the wall.
- Frame selectable (frame-main) w/ baySpacingFt; posts+plates 3D placeholder.
- Per-storey controls (upperStoreyHeightFt; Shell page storey blocks w/
  position/size/Match/Center); storey-organized selector menu.
- Shed drainage ("Drains to" + flat-shed flag/fix); exterior CLADDING_TYPES
  (lap/board&batten/shingle/metal/stucco/stone/brick, per side, 3D materials).
- Standard options beside natural everywhere (SIPs, marine-ply panel, ICF) +
  🌿 green marks on natural methods across every options list.
- 3D grab-everything: openings slide along walls, walls drag in/out; labels
  decluttered (element labels only when selected; assembly chip gone).
- Enclose-rooms check/fix ("shell must enclose the whole ground floor").
- 3-column opening card; welcome card survives HMR (sessionStorage).
- **Storage hardened**: atomic tmp+rename writes (w/ Windows EPERM retry +
  copy fallback), corrupt-file set-aside, API route try/catch — the server
  can no longer be killed by a request or a bad file.
- **Planner op-enum hole FIXED**: set_wall_side/set_frame/set_flooring/
  set_reclaimed/resize_wall_segment were taught in the prompt but missing
  from the schema enum — Gemini silently dropped them. This was a real
  "butchered drawings" cause.

### Invariants that will bite you (hard-won, do not relearn)
1. **Every new op = THREE registrations**: bim-core handler + main.jsx client
   mirror + planner schema ENUM (grep the enum when "chat can't do X").
2. **Zero-filled ops**: 0 means "unset" for x/y/z/level/positionFt in planner
   ops. Basement is level **-1**. positionFt 0 = "keep".
3. resolveWallSide + WALL_ASSEMBLIES are DUPLICATED in bim-core and main.jsx —
   keep both copies identical. detectIssues also has two copies (main.jsx has
   fixIds/systems; bim-core's is lighter).
4. Backend .mjs edits need a server restart; check $TEMP/nbapp_server.log for
   REAL vite errors (a 200 can be stale). **Never Force-kill the server while
   Daniel's tab is open** — restart is now write-safe (atomic), but his
   in-flight click still drops (posts a "didn't save" message, expected).
5. updateShell's generic clamp has an **18ft minimum** — every new shell field
   needs its own branch there AND in both set_shell handlers.
6. Multi-step UI actions = ONE batched dispatch (never N calls on stale spec).
7. Browser testing: synthetic canvas PointerEvent drags MOVE ROOMS (it's the
   drag pipeline); wheel-zoom is safe. Snapshot first: GET /designs → note
   file → test → POST /api/projects/current/restore {file}. Close test tabs.
8. Daniel USES the app while you work — GET /api/projects/current for the true
   rev; HMR hot-reloads his tab live; the welcome card no longer interrupts.
9. Run `node tools/op_smoke_test.mjs` (+ geom_core_test, trace_repair_test)
   after ANY bim-core/planner edit. 96+41+12 green at f91510a.
10. Model overlay rows: badge | 3D-Plan-Detail | Layers | N-compass (row 1),
    floorTabs (row 2, top:56), selection chip (row 3, top:98) — keep new
    overlays out of these lanes.

### How to run
`node server.mjs` with cwd = this dir (`.env.local` must load). App at
http://127.0.0.1:5184/. Kill stale listener on 5184 first. Tester zip:
`git archive --format=zip -o <Desktop>\natural-building-mvp.zip HEAD`
(Desktop is OneDrive-redirected: use [Environment]::GetFolderPath('Desktop')).

### Older open threads (below in this file, still valid)
Dormers; per-room ceiling heights; gutters→cistern; interactive Project Plan;
permit-set JSON refactor; custom-footprint support for sun-glazing band /
frame render / basement walls (all rect-v1); Blender/IFC still models the
bounding rect; "compare model to drawing" report button (fresh-trace is the
answer today); rotate the Gemini key.

---

## Previous session log (2026-07-10, pick-ups session)

**The 2026-07-10 pick-ups session shipped (one commit, suites 65+41+12 green, server restarted, verified live):**
1. **Reference-turn PDF speedup** (planner.mjs): attachments now ride to Gemini ONLY on
   a fresh trace or when the prompt mentions the drawing/pdf/plan/etc (`sendAttachments`).
   Follow-up edits no longer re-send an 11-page PDF every turn (was 2–3 min/reply).
2. **Rename-box debounce**: the Design Name input edits a local draft, commits on
   blur/Enter — no more one-revision-per-keystroke "Tom's Hous" stubs.
3. **Glazed wall assembly** (gap #2): 'glazed' in WALL_ASSEMBLIES (BOTH copies), R2 /
   0.35' / glass render (translucent, no plaster grain); engine treats glazed face area
   as glass (85% glass fraction: south → southGlass/solar, all → glazing-U heat leak,
   walls costed at the windowQuality glazing rate, carbon 15); wallR averages
   opaque walls only; council check (both detectIssues copies): off-south glass wall =
   warning; planner vocab updated; op suite covers it.
4. **Porch/deck canopies** (gap #4): element.roofType now RENDERS — 4 corner posts +
   shed panel (tilts down away from the house) or gable ridge; Inspector gained a
   "Canopy roof" select (None/Shed/Gable) for any non-floor/foundation element;
   $14/sf folded into cost.outdoors; planner told (add_element roofType / update_object).
   Verified live on Daniel's North Porch via set→verify→Undo. NOTE: only a rough
   visual check (camera was awkward) — eyeball a canopy from a clean angle next session.
5. **Chimney through the roof** (gap #5): thermal/chimney elements (category 'thermal'
   w/ heater-ish name, category 'chimney', or name ~ /chimney|flue/) get a 1.4'
   masonry flue + cap rising ~2.5' past the roof plane (shed/gable/flat aware,
   short stack if outside the footprint). Verified live: Daniel's real "Masonry
   Chimney" (category 'chimney' — planner-invented category, hence the name match)
   draws its flue.
**Browser-test lesson (new, real):** programmatic PointerEvent drags on the CANVAS
grab and MOVE Daniel's rooms (that's how room-drag works) — a camera-orbit attempt
moved his Stairwell (undone immediately; state verified back at rev 7). Orbit the
camera only with real user input or by setting the camera in code, never synthetic
canvas drags. Wheel-zoom via synthetic WheelEvent is safe.

**Same day, second pass — the remaining gap list (basement, interior walls, stairs) all shipped:**
1. **Basement as a real storey** (gap #3): `shell.basementHeightFt` (6–12′, 0 removes
   and re-levels stranded rooms), basement rooms/elements at **level -1 — NEVER 0**
   (zero-filled ops swallow 0; -1 passes every `level || 1` reader untouched).
   Concrete perimeter walls w/ 0.55′ stem reveal + slab in 3D (terrain exposes the
   downhill wall = walkout), Basement floor tab in Plan (quick-adds/fixtures land
   there), engine: basement supersedes foundation cost/carbon, finished basement
   rooms count toward heated sf; checks: basement-bedroom-egress (BOTH copies),
   stair-required includes basement; Foundation-page Add/height/Remove UI; planner
   vocab + the trace mandate now MODELS basements instead of warning them away.
   GOTCHA fixed en route: `updateShell`'s generic clamp has an 18-ft MINIMUM (shell
   dims) — it turned basement 8 into 18 and would have made remove (0) impossible;
   basementHeightFt now has its own branch. Watch that clamp with any new shell field.
2. **Interior partition walls** (gap #1): elements category `'partition'` —
   PARTITION_TYPES (framed/cob/adobe) in bim-core; thin-axis auto-thickness;
   full-height default; **door via the existing op fields** (widthFt=door width,
   positionFt=along the run → element.doorWFt/doorAtFt) so the Gemini schema needed
   NO new fields; min-dim clamps relaxed to 0.3′ for partitions (normalizeRooms +
   resize_object would otherwise fatten them to 1′). 3D render = wall segments +
   header over the doorway (invisible full-run drag handle); Plan renders partitions
   SOLID (not dashed); Rooms page **“Draw walls between rooms”** = derivePartitionOps
   (shared-edge detection per floor, 3′ doorway each, skips covered lines, ONE
   batched dispatch); Inspector: construction + door width/position; cost/carbon ride
   the walls line; planner vocab with a worked example.
3. **Real stairs + stairwell void** (gap #6): any element named ~stair (not ladder)
   renders treads+risers (7¾" risers from the real rise: basement height at level -1,
   storey height above; invisible full-volume handle); the upper floor PLATE —
   both the auto-plate and extent-plate elements — gets a real subtractRect VOID
   where a level-below stair overlaps; council check: “stair too short for its climb”
   (run vs 7¾"/10" needed run, only when it actually climbs somewhere); basement
   stairs ghost on the Ground plan.
Suites now 75 op + 41 geom + 12 trace, all green; everything verified LIVE in the
browser on a throwaway mutation run, then **restored via POST /api/projects/current/restore
{file} — the one-call alternative to N Undos; grab the snapshot filename from
GET /designs BEFORE testing.** Daniel's design left at rev 7 exactly as found.

**Third pass same day (Daniel's five follow-ups):**
1. **Basement IS a foundation option**: the Foundation Type select has four answers
   (rubble / stem wall / slab / basement); picking basement creates the storey,
   picking anything else removes it + sets the type in ONE dispatch
   (`setFoundationChoice`). `set_utility foundationType 'basement'` is aliased in
   bim-core to the real control so the planner's natural phrasing works. The
   Foundation page's basement block explains the dual role in plain words.
2. **Heated is a user option**: `shell.basementHeated` (default true; checkbox on
   the Foundation page; set_shell field 'basementHeated'; cleared when the
   basement is removed). Unheated basement rooms stop counting toward heated sf.
3. **Storey+foundation duality** is one source of truth — `shell.basementHeightFt`
   feeds both readings; there is no second flag to fall out of sync.
4. **Opening card is 3 columns**: intro | Start a design | **or continue**
   (continue button + previous designs). `.welcomeCard.threeCol` (only when
   something exists to resume; responsive collapse at 1100/900px).
5. **First-try trace fidelity**: the trace mandate now REQUIRES stairs (any
   multi-storey/basement plan), interior partitions (with their doorways —
   interior doors belong to partitions, add_opening is exterior-only), chimney
   elements, and basement modeling; `traceLooksIncomplete` flags a multi-storey
   takeoff with no stair → the repair pass asks for what's missing (repair may
   now also set basementHeightFt). Rationale: the dozens-of-turns rebuild was
   the user hand-adding objects the vocabulary couldn't SAY — now the drawing's
   own content (walls/stairs/chimney/basement) is in the op vocabulary, so the
   first pass can land it. Suites 78+41+12 green.

## Previous marathon session (2026-07-09/10)

**The 2026-07-09/10 session shipped, in order (all committed, suites green):**
1. **Geometry pass DONE** (`33e63dd`→`ea5fb66`): footprint polygon (L/T/U),
   move-a-wall (plan edge drag + inspector Move/Split), stepped roofs over
   partial storeys. `tools/op_smoke_test.mjs` + `geom_core_test.mjs` are the
   durable suites (63 + 41 checks) — run after ANY bim-core edit.
2. **Frame drawings** (`dbe4d6a`, `661faa5`): Export ▾ → Frame drawings —
   elevations, frame plan, Typical Bent section, member schedule.
3. **Trace verify-and-repair** (`7e80d7a`) + **trace discipline** (`87052b2`):
   full takeoff only on FRESH trace; follow-ups treat the PDF as reference
   (proven 10/10 on the real Columbia PDF: follow-up turns = exactly 1 op).
   Slim Gemini schema + 32k tokens + retry killed the unreadable-JSON turns.
4. **Topography** (`87052b2`): site.slopeFt/slopeDir/gradeFt →
   sloped terrain w/ contours, foundation steps to grade (walkout), Site page
   controls, `gradeElevationAt()` in bim-core is the single grade source.
5. **Approach switch + council opt-in** (`87052b2`): shell.designApproach
   natural|standard (Shell page) gates the passive-solar/homestead checks +
   planner bias; council flags only via the Council Loop button / Review tab.
   Selector chip lives in the BIM Inspector header now (left panel).
6. **Built-the-other-way compare** (`28859ef`): Costs tab prices the same
   design in the opposite construction (convertSpecApproach).
7. **De-clip-art pass** (`e260dba`): procedural grain materials, fill light,
   real window/door assemblies (frames, muntins, sills, knobs).
8. **Plan-first** (`d23323d`): fixtures land on the active floor; openings
   drag along walls in Plan (disabled in building/site contexts + upper floors).
9. **Foundation runs** (`5a94f13`): rubble trench / trench+stem / stem /
   grade-beam strips placed under specific wall lines (the greenhouse
   divider detail), priced per LF, drawn with trench + stem in 3D.

**Daniel's live design:** "My Natural Home" (40.5×28, 6 rooms, stem-wall
perimeter) — he works in it between sessions; ALWAYS snapshot
(POST /api/projects/current/save with current state) before UI tests and
restore after. persist:false for op tests.

**Known follow-up speedup: DONE (pick-ups session)** — attachments dropped on
reference turns unless the prompt mentions the drawing.

## BUILDING-REALITY GAPS (Daniel's "what else am I missing" audit, 2026-07-10)
Things a real build needs that the model can't yet say — the foundation-run
class of gap, prioritized:
1. **Interior partition walls — DONE (second pick-ups pass).**
2. **Glazed wall assembly — DONE (pick-ups session).**
3. **Basement as a real storey — DONE (second pick-ups pass; level -1, not 0).**
4. **Porch/covered-deck roofs — DONE (pick-ups session).**
5. **Chimney through the roof — DONE (pick-ups session).**
6. **Stairwell void + real stair runs — DONE (second pick-ups pass).**
7. **Dormers** — no roof dormers (post-MVP per geometry-pass scope).
8. **Per-room ceiling heights / vaults** — one height per storey today.
9. **Gutters → cistern link** — catchment math exists; no physical rainwater
   path (gutter/downspout/cistern placement). Cosmetic-ish.
10. **Posts under deep overhangs / porch posts** — engine warns about nothing
    here; no posts render. Small visual + a check.
All of 1–6 are DONE. Remaining from this list: 7 (dormers, post-MVP), 8 (per-room
ceiling heights), 9 (gutters→cistern), 10 (porch posts render under canopies now,
but no deep-overhang post check yet).

**State:** feature freeze mostly holds; it was bent once, on Daniel's order, for
the **drawing→model fidelity pass** (commit `7e77b1d` + Team-consult upgrade):
Gemini model was dead (retired) → now `gemini-flash-latest`; PDF takeoff
mandate added (verified on Daniel's real 11-page Columbia St PDF: shell
40.5×23, 5 rooms, 10 openings, wall height read off elevation markers);
Design chat is action-first; Team consults via the studio AI in the expert's
voice and can never touch the model; planning bubble; opening card lists all
previous designs (snapshot-grouped) + start-from-file. Daniel's active design:
**"Tom's House"** — an EXISTING conventional home being modified (not natural
build); he traces the PDF then adjusts verbally.

**Late-session additions (all committed, tree clean at `1298168`):** opening
card reordered (start-first), two-column full-visible card, colored start
choices, chat-window planning indicators (sweep bar + wheel + dots), Team =
real AI consult-only persona, previous-designs picker, 3D canvas follows its
container (chat toggle refits the model).

**Path to MVP, in order:**
1. **The geometry pass — DONE (2026-07-09, commits `33e63dd`→`ea5fb66`).**
   `spec.shell.footprint` rectilinear polygon (absent = legacy rectangle,
   exact); walls are polygon edges (`wall-e0`…, construction keyed by facing);
   ops `set_footprint` / `move_wall_edge` / `split_wall_edge` (+ planner
   vocab); Plan view drags wall edges; inspector has Move in/out + Split
   into 3; **stepped roof** over partial storeys (upper gable + low shed
   wings) and per-rectangle roof segments for L/T/U; engine + checks measure
   the real polygon. Verified live end-to-end (notch via plan drag; stepped
   roof over a west-half storey; exploded view coherent; Blender/IFC still
   works). Honest gaps in TESTING.md: no roof valleys, skylights approximate
   on stepped/L roofs, Blender/IFC + permit sheets still model the bounding
   rectangle (the payload already carries `footprint` + `wallSegments` for
   when the add-on learns the edge walk).
2. **Op smoke suite — now durable in-repo: `node tools/op_smoke_test.mjs`**
   (50 headless op round-trips; add `--http` for live-server sanity with
   persist:false). 53/53 passing at `ea5fb66`. It caught 4 real bugs on its
   first runs (empty-name target matching, split-erasing anchor, plate
   spawn position, move_object z-clobber) — run it after ANY bim-core edit.
3. Refresh the tester zip (`git archive --format=zip -o <Desktop>\natural-building-mvp.zip HEAD`)
   — the .gitattributes LF rules are load-bearing for the Mac launcher.
4. MVP when 2–3 testers' first hour produces no "wait, why can't I—."

**Small known follow-ups (post-geometry, pre-MVP polish):**
- Trace fidelity: layouts vary slightly run-to-run (schematic level) — fine;
  consider a "re-trace page N" affordance later. Basements are warned, not
  modeled. `storeys` from traces sometimes unset — harmless (defaults 1).
- Rename-box snapshot spam — FIXED (pick-ups session: commit on blur/Enter).
- Housekeeping: rotate the Gemini key in `.env.local`.

**Discipline (hard-won):** backend .mjs edits need a server restart; read
$TEMP/nbapp_server.log for REAL vite errors (200s can be stale); verify with
persist:false against the live server; never clobber the current-project
pointer; un-toggle any browser view state your tests flip (modelLayers,
nbChatOpen persist in Daniel's browser); one dispatch per user action; the two
resolveWallSide copies (main.jsx + bim-core.mjs) stay identical.

Updated 2026-07-09. Working tree clean, ~50 commits since baseline `e9c99c1`.
Recent arc: actionable metrics → Frame/Floor(+subfloor+insulation) systems →
one-editor reorg → Zen minimization → contextual plan + outbuildings →
per-storey walls + sun angles + exploded views (`230d77f`).
Live backend design: **FL-001 ~rev 151** (Daniel works in it daily — ALWAYS
GET /api/projects/current before assuming state; never clobber; persist:false
for tests). Backend .mjs edits need a server restart; check
$TEMP/nbapp_server.log for real vite errors (a 200 can be stale).
Deep provenance + every decision: Claude memory `natural-building-gc-dashboard-inventory.md`.

## Daniel's standing priority (his words)
1. **Don't break anything.** 2. **Make sure everything works** (functional/practical
   is the current focus). 3. **Beautify, polish, perfect** (aesthetics — he calls the
   current look "crude and generic"; real but lower priority than 1 & 2).
Also standing: **be comprehensive, not piecemeal** — sweep a whole capability space
in one pass, wire every consumer (render/engine/checks/chat/exports), never let an
interaction fail silently.

## How to run
- `node server.mjs` from this dir (cwd must be app dir so `.env.local` loads).
  App: http://127.0.0.1:5184/  ·  Blender add-on server: port 8000.
- **Backend `.mjs` edits need a full server restart** (Node module cache); Vite only
  hot-reloads the frontend. A restart drops in-flight UI clicks (they now post a
  "didn't save, try again" message — that's expected, not a bug).
- Verify by driving Chrome (extension) + `curl`/`POST /api/bim/apply` with
  `persist:false` for backend ops. Pure functions (parsers, layout) → quick `node -e`.

## ⚠ Multi-tab hazard — READ BEFORE TESTING
The shared backend autosaves whichever tab last changed state. Testing with `New`
overwrites the live project pointer, and a lingering test tab re-saves its state
over Daniel's design. This bit us repeatedly this session. Rules:
1. Before/after any UI test, **park every test tab**: `window.stop(); localStorage.clear();`
   then blank the body. Do this FIRST, then restore.
2. **Restore Daniel's design**: newest `.data/projects/current-project/revisions/*FL-001*.json`
   → copy to `project-state.json`. All revisions are snapshotted; nothing is ever lost,
   but the *live pointer* gets clobbered — restore it and tell Daniel to hard-reload.
3. Heavy repeated New→add churn freezes the tab's renderer (CDP timeouts). Use a fresh
   tab and prefer backend `curl` verification over hammering one tab.

## What's built (all committed, verified)
Design-by-system app, 12 system pages. Per-side walls (system/height/thickness/finish/
omit, honest raked+gable face-area math). Roof + per-side overhangs. Foundation w/
variable stem-wall height. Storeys 1/1.5/2. Full opening vocab (window/picture/awning/
clerestory/door/french/slider/dutch/barn/bay/skylight) + glazing quality, all
manipulable via per-opening rows; Windows quick-adds incl. Door/Sliding door. Outdoors
items. Site keyword geocode + real rainfall. Dark "paper→charcoal→lit-model" theme.
Model-view layers + partial-view cue. Real cost/sweat/carbon/water/power engine
(`deriveDesign`) + aiCritic council checks w/ nav dots. Gemini planner (+ PDF/doc
upload). Blender/IFC round-trip (one-click headless launch). Build mode. Welcome/New.
**Frame drawings** (`src/frameDrawings.js`, Export menu + Frame page): timber-frame
shop-drawing sheets from the live spec — per-facing frame elevations (posts/plates/
braces/rafters, raked shed plates w/ plumb cuts, gable ends, rafter-end ticks at
o.c.), bay + height dimension strings, leader callouts, hand-drafting title block,
frame plan w/ post layout, member takeoff. Member sizes follow the Frame page type;
footprint-aware (per wall run); load-bearing prints an honest no-frame sheet.

**Rooms/plan (this session's focus):**
- Rooms quick-add palette + **non-destructive add** (`planNewRoomPlacements`/`findFreeSpot`:
  new room drops into a free gap, grows the house only if needed, NEVER moves existing
  rooms). Full re-pack (`arrangeRoomsPlan`) is ONLY the explicit "auto-arrange" button.
- **Instant local chat room-adds** (`parseLocalRoomAdds`): "add a bedroom / two bedrooms
  and a bathroom" → layout engine, no 44s Gemini; falls through to planner for
  moves/walls/stacking.
- **2D plan editor** (`PlanView`, 3D|Plan toggle): renders rooms AND all placed elements
  (dashed); drag body=move, drag corners=resize (snap ½ft, setPointerCapture). Commits
  via move/resize_object.
- **Interior fixtures** (`interiorFixtures`/`placeFixture`): heater (name+size follow
  Heat page), water tank, stairs, counter, bath, storage — placed as elements, draggable
  in 2D, shown in 3D. "Add a fixture" palette on Rooms page.
- Top bar is now one compact row of small buttons.

## Open / next (Daniel picks scope)
**Functional (Job 2):**
- 2D editor v2: rubber-band DRAW a new room; drag openings along walls; snap-to-adjacent.
- Fixtures render as labeled boxes only (heater ≠ modeled stove) — richer symbols later.
- Full stem-wall/storey LIFT: walls/floors/sills re-seat on new datums (today the stem
  is a plinth but walls don't rise by it; same class as roof-not-cutting-around-a-tower).
- **Per-floor footprints (Daniel asked):** an upper storey currently shares the ground
  footprint — it can't be smaller or cantilever. Needs per-level width/depth/offset in
  the spec + the 3D wall/floor-plate/roof generator to honor it (real geometry refactor;
  do in a fresh session, not near a context limit). Stair AUTO-LINKING is DONE (+Floor
  drops a stair that shows on both floors; drag to place). True stairwell-void geometry
  (a hole through the plate, connected runs) is still open.
- Permit drawing set: refactor `HOMESTEAD/6-28-26/FL0-House-BIM-Drawings/fl0_house_spec.py`
  to take a JSON spec + real elevation projection (currently hardcoded to one house).
- L/U plan shapes.
**Aesthetics (Job 3 — "crude and generic"):** FIRST REAL PASS DONE (commit f487ad0,
  "warm earthen studio" — Daniel picked the direction: keep dark, make it feel
  hand-built). One cohesive layer at the END of styles.css re-tints the token-driven
  matte chrome from cool moss → warm umber charcoal + clay/straw/lime-sage accents;
  Fraunces heads, wide-tracked eyebrows, tactile inputs w/ clay focus rings, clay
  primary buttons, outlined danger, rounded soft-elevation cards, straw→clay cost
  bars, warmed 3D backdrop. **Extending the theme:** re-tint the tokens in that final
  `.leftPanel,.workspace,.rightPanel` block, not per-component; new hardcoded hexes
  are the enemy (a few cool-slate `#3C6472/#26424C/#7FA8B5` spots were chased down —
  grep for those if anything still looks cold). Still open for a deeper pass: spacing
  rhythm/8pt scale, empty-state craft, iconography consistency, richer 3D materials
  and lighting, motion polish.
**Explicit Daniel requests still open (asked near context limit 2026-07-08):**
- **Interactive Project Plan** (the OS/Plan console tab): it's read-only now — make
  its requirements / open-questions / task-queue / decisions editable and actionable.
- **More systems + "blow-ups":** flooring as its own system; foundation insulation
  and roof insulation as real controls; each system deserves a fuller detail view
  ("blow up") with facile controls (the per-page why/reads/feeds is a start).
- **Metric tiles fully actionable — DONE** (commit 8de8db8). Cost tile → a real
  **Costs** console tab: per-system breakdown of `derived.cost` (biggest first,
  proportional bars + %), $/sf, embodied carbon, subtotal→sweat→net, inline DIY
  toggles that re-price, loan-ceiling verdict; each row taps into that system.
  Flags in Review → a "Go to <system>" jump + a one-click **Fix** where a clean
  single-intent remedy exists (`fixId` on the issue → `fixIssue()`): add
  bathroom/mudroom, add south door/window, add stair, raise stem wall, 100 ft
  well↔septic, deepen/trim overhang, thicken a bale wall to 12:1. Fixes reuse the
  non-destructive room placement + standard dispatch. Judgment-call flags (cost
  ceiling, undersized water source) stay prose-only by design.
  Next level: cost rows could split further (materials vs labor per system);
  more flags could earn autofixes as their remedies become unambiguous.

**Housekeeping:** rotate the Gemini key (pasted in-session, in `.env.local`).

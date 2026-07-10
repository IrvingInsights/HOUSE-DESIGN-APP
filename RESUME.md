# Resume / Handoff — Natural Building GC app (house-bim-app)

## FRESH SESSION — START HERE (updated 2026-07-10, end of the marathon session)

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

**Known follow-up speedup:** reference-mode chat turns still re-send the PDF
to Gemini (2–3 min). Fix: drop attachment parts when NOT freshTrace (planner
already knows the flag) — small, safe, high-value.

## BUILDING-REALITY GAPS (Daniel's "what else am I missing" audit, 2026-07-10)
Things a real build needs that the model can't yet say — the foundation-run
class of gap, prioritized:
1. **Interior partition walls as real objects** — rooms are floor zones; there
   are no interior walls with thickness/structure, no doors BETWEEN rooms, no
   per-wall interior assemblies. The greenhouse divider was pointed at this.
   Biggest single modeling gap; medium-large build (wall elements exist as a
   category — needs openings-in-partitions + room adjacency awareness).
2. **Glazed wall assembly** — a greenhouse's south face is a GLASS WALL, not
   windows in a wall. Add a 'glazed' WALL_ASSEMBLY (thin, R≈2, glass render,
   costed at glazing rate, counts toward south solar gain). SMALL and the
   natural next step after foundation runs.
3. **Basement as a real storey** — trace sessions keep fighting this ("the
   basement should be a storey"). With topography in, a walkout basement is
   representable: shell.basement {heightFt, walkout} + rooms at level 0 +
   terrain already cuts the downhill side. Medium.
4. **Porch/covered-deck roofs** — porch elements have no roof; add_element
   carries roofType but nothing renders it. Small-medium.
5. **Chimney through the roof** — thermal elements render as boxes; a chimney
   should rise past the roof plane (visual pass-through is easy; roof
   hole-cutting is not needed at this scale). Small.
6. **Stairwell void + real stair runs** — stairs are boxes; no rise/run, no
   hole in the upper plate. Medium-large (known since storeys shipped).
7. **Dormers** — no roof dormers (post-MVP per geometry-pass scope).
8. **Per-room ceiling heights / vaults** — one height per storey today.
9. **Gutters → cistern link** — catchment math exists; no physical rainwater
   path (gutter/downspout/cistern placement). Cosmetic-ish.
10. **Posts under deep overhangs / porch posts** — engine warns about nothing
    here; no posts render. Small visual + a check.
Suggested order: 2 (glazed wall) → 4+5 (porch roof, chimney) → 3 (basement)
→ 1 (interior walls) → 6 (stairs). Each is its own clean session-sized bite
except 1 and 6.

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
- Rename-box autosaves once per keystroke → snapshot spam (the designs list
  collapses the stubs; a debounce on projectName saves would fix the source).
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

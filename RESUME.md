# Resume / Handoff — Natural Building GC app (house-bim-app)

Updated 2026-07-08. Working tree clean, ~38 commits since baseline `e9c99c1`.
Live backend design: **FL-001 rev 52** (Daniel's real work: shell/walls, 0 rooms).
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
**Aesthetics (Job 3 — "crude and generic"):** the dark theme + Fraunces headings are a
  start, but a real polish pass wants: refined spacing/rhythm, a considered type scale,
  softer/consistent control styling, better empty states, iconography consistency, and a
  more crafted 3D material/lighting look. Do this AFTER functional gaps, per Daniel.
**Explicit Daniel requests still open (asked near context limit 2026-07-08):**
- **Interactive Project Plan** (the OS/Plan console tab): it's read-only now — make
  its requirements / open-questions / task-queue / decisions editable and actionable.
- **More systems + "blow-ups":** flooring as its own system; foundation insulation
  and roof insulation as real controls; each system deserves a fuller detail view
  ("blow up") with facile controls (the per-page why/reads/feeds is a start).
- **Metric tiles clickable — DONE** (cost→Build, rooms→Rooms, flags/adds-up→Review).
  Next level he'll likely want: cost tile → a real cost *breakdown* interface (per
  system, from `derived.cost`), and flags → inline "fix it" actions (each flag already
  carries a `fix` string; wire one-click fixes where possible, e.g. add wet core,
  add south door).

**Housekeeping:** rotate the Gemini key (pasted in-session, in `.env.local`).

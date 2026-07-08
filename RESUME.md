# Resume / Handoff — Natural Building GC app (house-bim-app)

Updated 2026-07-08. Working tree clean, ~42 commits since baseline `e9c99c1`
(latest: `f487ad0` warm-earthen visual refresh; before it `aa9eabe` all-walls
assembly fix + full opening-type picker, `8de8db8` actionable metric tiles).
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

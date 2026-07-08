# Resume — Natural Building GC app (house-bim-app)

**State at handoff (2026-07-08):** working tree clean, 33 commits since baseline
`e9c99c1`. Live design in the backend is **FL-001 rev 52** (Daniel's real work).
Full provenance + decisions: Claude memory `natural-building-gc-dashboard-inventory.md`.

## How to run
- Backend + Vite: `node server.mjs` from this dir (cwd must be app dir so
  `.env.local` loads). App at http://127.0.0.1:5184/ , port 8000 = Blender.
- **Backend `.mjs` edits need a server restart** (Node module cache); Vite only
  hot-reloads the frontend. Restarts drop in-flight UI clicks (handled: they
  post a "didn't save, try again" message).
- Verify by driving the app in Chrome (extension) + `curl`/`/api/bim/apply`
  (persist:false) for backend ops. Op smoke-test pattern in scratchpad.

## Multi-tab hazard (important)
Shared backend autosaves whichever tab last changed state. When testing with a
`New` design, it overwrites the live pointer. **Restore Daniel's design after
tests:** copy the newest `.data/projects/current-project/revisions/*FL-001*rev-NN.json`
to `project-state.json`, and park the test tab (`window.stop()` + blank body).

## What's built (all committed, all verified live)
Design-by-system app: 12 system pages, per-side walls (system/height/thickness/
finish/omit), roof + per-side overhangs, foundation (+ variable stem-wall height),
storeys 1/1.5/2, all opening types incl. skylights/bay/french + glazing quality,
Outdoors items, Site keyword geocode + real rainfall, Windows per-opening, dark
"paper→charcoal→lit-model" theme, model-view layers + partial-view cue, real
cost/sweat/carbon/water/power engine (`deriveDesign`), aiCritic council checks
with nav dots, Gemini planner (PDF/doc upload), Blender/IFC round-trip (one-click
headless launch), Build mode (phases/materials/maintenance), welcome/New flow,
**Rooms quick-add palette + auto-layout (packRooms/arrangeRoomsPlan, grows shell,
no overlap), instant local chat room-adds (parseLocalRoomAdds), and a 2D plan
editor (PlanView, 3D|Plan toggle, drag-move / corner-resize)**.

## Open / next (from the hands-on build audit; Daniel picks scope)
- 2D plan editor v2: rubber-band draw a NEW room; drag openings along walls.
- Full stem-wall/storey LIFT: walls/floors/sills re-seat on new datums (today
  the stem renders as a plinth but walls don't rise by it; same class as
  roof-not-cutting-around-a-tower).
- Permit drawing set: refactor `HOMESTEAD/.../fl0_house_spec.py` generator to take
  a JSON spec + real elevation projection (currently hardcoded to one house).
- L/U plan shapes (walls become true segments with independent lengths).
- Rotate the Gemini key (pasted in-session, in `.env.local`).

## Standing guidance (memory)
Daniel: **be comprehensive, not piecemeal** — sweep whole capability spaces in one
pass, wire every consumer (render/engine/checks/chat/exports), never let an
interaction fail silently.

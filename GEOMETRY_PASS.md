# The Geometry Pass — brief for a fresh session

**Status: feature freeze as of commit `1df5789` (2026-07-09).** This pass is
the one body of work between here and MVP. Do it in a fresh context, alone.
After it: re-run the op smoke suite, hand TESTING.md to 2–3 testers, MVP.

## The goal (Daniel's asks, in his words across sessions)

1. **Stepped roof**: a second/third storey "on only one side of the building"
   must get a roof that steps — upper roof over the storey extent, lower roof
   over the single-storey remainder. Today the roof floats at full height over
   the whole footprint (flagged to Daniel as the known limitation).
2. **Move a wall / non-rectangular footprints (L/U shapes)**: offset one wall,
   jog it, make an L. His most-repeated ask.
3. Keep **move/resize semantics everywhere**: 3D drag, Plan drag, chip select,
   inspector fields.

## Design direction (recommended)

Replace the implicit rectangle with an explicit **footprint polygon** —
rectilinear (axis-aligned edges only), stored as ordered vertices in
`spec.shell.footprint` (feet, clockwise). Absent → derive from widthFt/depthFt
(EVERY legacy design keeps working — this fallback discipline is how
per-storey walls, plates, and insulation all shipped safely; copy it).

- Walls become **edges of the polygon** (id `wall-e0`, `wall-e1`, …) with the
  per-side override map keyed by edge; the four cardinal names remain as
  aliases while the footprint is a plain rectangle.
- "Move a wall" = translate an edge perpendicular to itself (plan drag or an
  inspector field). An L-shape = split an edge (add two vertices) then move
  the middle segment.
- Upper storeys already have **extent plates** (`upperPlateRect(spec, level)`,
  elements category 'floor'). The stepped roof = roof segments per region:
  upper roof over the plate at ground+lift height, lower roof over
  footprint−plate at ground height. Start with the rectangle−rectangle case
  (plate inside footprint) before general polygons.

## Where the rectangle assumption lives (the map)

All in `src/main.jsx` unless noted. Line numbers drift — search the symbol.

| Symbol | What it assumes | Notes |
|---|---|---|
| `getWallSections` | 4 cardinal sides from widthFt/depthFt; upper follows `plate2` | The template for edge-based sections |
| `resolveWallSide(spec, side, level)` | side ∈ N/S/E/W | **Duplicated in backend/bim-core.mjs — keep both identical** |
| `wallMeshSpecs` build (in ThreeScene) | 4 boxes (+ upper bands ring `plate2`) | Shed E/W are raked single meshes |
| `makeRoof` | gable/shed/flat/hip over one rectangle + overhangs | The stepped roof lands here; DoubleSide material already set |
| `makeShedSideWall` | raked trapezoid between N/S eaves | |
| `deriveDesign` | `floor = w*d`, `perimeterFt = 2*(w+d)`, wall areas from sections, roof from footprint+overhangs | Sections already carry per-storey lengths — extend, don't rewrite |
| `detectIssues` | slenderness/overhang checks per cardinal side | Iterate edges instead |
| `PlanView` | shell rect + corner resize (`resizeShellPlan` = 2 set_shell ops) | Edge drag goes here; footprint editing in the Foundation/Shell plan context |
| `packRooms` / `planNewRoomPlacements` | pack into width×depth | Clamp rooms into the polygon (or its bounding box + containment check) |
| `clampObjectPosition` (bim-core) | rectangle bounds | |
| `sitePadRect`, stem-wall ring, foundation cost | perimeter of the rectangle | Perimeter of the polygon |
| `blenderBridge.specToDashboardState` | emits 4 walls | Emit edges; the Blender add-on rebuild + IFC writer will need the same edge walk (tools/blender_headless_server.py harness to test) |
| Permit sheets (`exportSheetSet`) | rectangle elevations | Can lag one increment behind — note it honestly if so |

## Backend ops to add (bim-core — server restart needed after edits!)

- `set_footprint { vertices: [[x,y],…] }` — validate rectilinear, clamp, keep
  rooms inside (or flag).
- `move_wall_edge { edge, offsetFt }` — the primitive "move a wall".
- Keep `set_shell widthFt/depthFt` working: when footprint is a plain
  rectangle they resize it; when not, they scale the bounding box (or reject
  with a friendly message — decide, be consistent).

## Invariants (hard-won — do not regress)

- **Legacy fallback**: no footprint field → exact current behavior. Daniel's
  live designs must not shift by a cent or a foot.
- **One dispatch per user action** — multi-op bundles, never N calls on stale
  spec (the West-wall bug class).
- **Both resolveWallSide copies** (main.jsx + bim-core) stay identical.
- Backend .mjs edits ⇒ restart `node server.mjs` (module cache); check
  `$TEMP/nbapp_server.log` for the REAL vite error — an HTTP 200 can be stale.
- Verify against the live server with `persist:false`; NEVER clobber the
  current-project pointer; un-toggle any view state (explode/layers/chat) that
  tests flip — modelLayers + nbChatOpen persist in Daniel's browser.
- The one-editor architecture: model = selector, left bar = the only control
  surface, general→specific order. New edge controls follow it.

## Test recipe

1. Headless: extend the scratchpad op tests (pattern in memory) — footprint
   round-trips, edge move, L-shape split, legacy-fallback equality (deep-equal
   a legacy spec's derived numbers before/after the refactor).
2. Visual: sample homestead → move south wall out 6 ft → L-shape → add storey,
   shrink its plate to one side → CHECK THE ROOF STEPS. Exploded view still
   coherent. Plan drag still snaps.
3. Blender: push an L-shaped design through `POST /api/blender/ensure` →
   export IFC → confirm element count grows accordingly.

## Explicitly deferred (post-MVP, do not get pulled in)

Curved/angled walls, roof valleys/dormers on general polygons, permit-sheet
elevations for L-shapes (note honestly instead), multi-project store,
JS port of ifc_writer (kills the Blender dependency — good post-MVP week).

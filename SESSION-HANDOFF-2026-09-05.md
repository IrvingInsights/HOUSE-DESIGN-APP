# SESSION HANDOFF — 2026-09-05 (update 249)

Read `AGENTS.md` first (it binds you), then `RESUME.md` for where things stand.
This file is one session: Daniel asked "is it ready for me to try a new house
from scratch?", was told yes with four things still not built, and said
**"fix the remaining items."** All four are built, proven and pushed.

---

## THE ONE THING TO CARRY FORWARD

> **One law, one home, three readers.** Every item here had the same shape: a
> rule the 3D scene knew and nobody else did. The join law lived only in the
> scene, so the receipts priced a wall the drawing never built. The structure
> roof was a formula inside a render block, so a gable had nowhere to go. Now
> each law is one exported function — `structureGroups`, `resolveStructureRoof`,
> `resolveHeatClearance` — that the scene, the flags, the receipts, the card
> and the battery all call. If it is wrong it is wrong everywhere, which is
> the only way a battery can prove it right.

The July session's habit held again: **the fuzz found a bug in code I did
not touch.** Adding structures and heaters to the generator shifted the random
stream, and one round-house design needed two heal passes to settle — a
pre-existing convergence gap in `normalizeRooms`' outline fit. Fixed by running
the fit to a fixed point. Nothing ships unless design_space runs dry.

---

## WHAT LANDED (all update 249; update 248 was another session's desktop shortcut)

**1 — An asymmetric gable on a structure.** `resolveStructureRoof(spec, el,
group)` in `src/engine.js`. Fields on the structure: `roofShape` (shed |
gable), `roofPitch`, `roofFall` (a shed's low side), `roofRidge` (ew | ns,
default along the longer side), `roofRidgeFt` (feet in from the north or west
wall; blank centres it). The wall-height law: the structure's "wall height" is
its LOWEST eave — a shed's low wall, a gable's long-slope eave — and every wall
top follows the roof's underside. Gable ends are split at the ridge so the
prism has a peak. A joined building takes the gable set on ANY member, over
the whole footprint. The card says in words what the numbers do ("the south
slope is the long one and lands at 9 ft; the short side stands 10.9 ft; the
ridge peaks at 12.2 ft"). `outbuilding_roof_test` grew from ~1,700 to 16,215
checks: the resolver must match the proven shed formula exactly, and every
gable — 6 shapes × 3 ridge directions × 4 ridge positions × 3 pitches — is
checked against the REAL rotated panels, both planes, at the peak itself.
Verified in the browser on empty land: workshop → Gable → ridge 3 ft → 3D.

**2 — Plywood as a wall skin.** It was never on the list because the list was
the ROOF list. `WALL_SKINS` in `bim-core.mjs` = every roof covering (poly,
metal, cedar are real skins) plus the wall-only ones: plywood, OSB, board &
batten. Each carries `combustible`, and polycarbonate carries `softens`,
which the clearance check reads. `wallCovering` / `doorCovering` validate
against it in both appliers; the scene draws from it.

**3 — Heat-source clearance to combustibles.** `resolveHeatClearance(spec,
heat)`: finds what the heater stands in (a structure by footprint, else the
house — the shell's edges by facing, the upper plate on an upper floor —
plus interior partitions), measures the heater rect to every wall, and says
which is too close. Rule per heat source (`HEAT_CLEARANCE_IN`): stove 36″ /
12″ shielded or listed close-clearance; rocket 36″ / 12″; masonry 36″ / 4″
built to ASTM E1602; mini-split nothing. Cob, rammed earth and ICF do not
burn; everything else does. A structure's walls always do (a metal skin over
studs does not change what is behind it). Then the honest part: `fitOpen` and
`fitShielded` work out whether ANY legal spot exists in that room, so the
flag offers the remedy that is true — **move it** (`heater-clearance`), or
**shield it and move it** (`heater-shield`, one dispatch: heatShield=yes +
move_object), or no button and the sentence "even shielded, a 30″ heater
cannot stand far enough from every wall." Polycarbonate gets its own line:
it deforms below a shield's working temperature and wants a real shield
board stood off the wall. New field `heatShield` on the heater, set on its
card ("Standard — 36″ / Shielded or listed — 12″") under a live sentence
naming the nearest thing that burns. `heat_clearance_test` (33) pins
Daniel's own workshop: 68″ deep, no open spot, a shielded spot at exactly
12″, the flag says "the right stove, not any stove", the one-tap fix clears
it.

**4 — A shared wall is priced once, i.e. never.** `structureGroups`,
`structureSharedOn`, `structureSharedLf`, `keepOutsideShared` moved from the
scene into `bim-core.mjs`; the scene now calls them (its private copy is
gone). The receipts take the shared feet off the wall third exactly as an
open side comes off — `min(1, (open + shared) / perimeter) × 0.33` — so a bay
open on three sides and joined on the fourth prices no walls at all, and
`standsAlone` puts the wall and its price back. The receipt note says so.
`structure_cost_test` (17) pins the arithmetic to the cent on both sides of
the join.

**Also:** the fuzz generator now places structures (every field above, junk
included) and heaters (in the house, in a structure, in the open, shielded or
not); `normalizeRooms`' outline fit converges; `TESTING.md`'s honest list
updated (it still claimed there was no wrap stair); README gets a line on
small buildings.

## VERIFICATION

design_space 14,890 · op_smoke 228 · placement 2,312 · receipts 439 ·
golden_numbers 189 pinned / 0 drifted · capability 272 · from_scratch_audit
0 gaps · outbuilding_roof 16,215 · heat_clearance 33 · structure_cost 17 ·
deck_stair 51 · camera_fit 152 · studio_ask 43 · trace_flags 13 · geom_core
41 · persistence 11 — all green. `vite build` clean. The three new/extended
batteries are wired into PROVE-IT.

Live: the app was tested on a NEW design started from empty land (the
chooser needs `window.confirm`, which the in-app browser cannot answer, so
it was stubbed for the test); Daniel's design was auto-saved to the shelf by
"+ New" and restored afterwards; `.data/projects/reimagine/
project-state.BEFORE-update248.json` is the backup taken first.

## OPEN

- **Deck wrap stair outside the footprint** — still the only version that
  could work on Daniel's own house (greenhouse under the main deck). Ask him.
- A structure's skin is drawn, not priced (construction rate bundles walls).
- Furniture and built-ins are not counted as combustibles near a heater; the
  hearth pad in front of a stove is not modeled.
- "From north" is the drawing's north, not a surveyed bearing.
- Gate B has still never been run: a stranger, an hour, no dead ends.

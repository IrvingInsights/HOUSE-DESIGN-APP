# SESSION HANDOFF — 2026-07-28 (updates 212–219)

Read `AGENTS.md` first (it binds you), then `HANDOFF.md` for what the app *is*,
then yesterday's `SESSION-HANDOFF-2026-07-27.md`. This file is one working day,
all of it Gate A depth work driven by Daniel using the app on his own house:
one deck stair that would not sit anywhere he wanted it, a workshop that moved
from one side of the house to the other, and — at the end — a deck he could not
grab on the plan.

---

## THE ONE THING TO CARRY FORWARD

> **The app must be built to build ANY house, not his house.**

Unchanged from yesterday, and it earned its keep again today. Every fix below
was written as a law about a *class* of thing — any deck, any stair, any floor
— never as a special case for his building. The test for any new control is
still: *could it exist, unchanged and sensible, on a house nobody has designed
yet?*

---

## WHAT SHIPPED

- **212 — a deck stair can turn on a landing.** `DECK_STAIR_SHAPES` gained the
  folded run: out, along, and u. `resolveSwitchbackStair()` builds it.
- **213 — a refused choice moves the stair, it does not delete it.** Asking for
  a position that cannot work used to draw *nothing*, which reads as broken.
  Now it lands somewhere legal and reports `movedFrom: { side, at, why }`.
- **214 — the switchback, and a room is enclosed space.** The fold renders in
  3D as two runs and a landing, with the stairwell cut through the deck.
- **215 — a doorway sits where it is put.** `door<Side>At` on a structure,
  honoured by the renderer *and* by the clear-ground law, through one shared
  `structureDoorStart()`.
- **216 — a position names the stretch for every shape**, not just straight
  runs. `deckStairAt` reads the same on a fold as on a flight.
- **217 — how far out before it turns.** `deckStairSplit`.
- **218 — a guard round the landing, and a landing you can lengthen.**
  `deckStairLandingFt`, plus rails on the landing edges that are not the way on
  or off.
- **219 — a thing on another floor is visible, and reachable.** See below.

## 219, IN FULL — the plan and the floor you are not on

Daniel: *"need to be able to move/resize decks same as rooms on 2D plan."*

The move and resize code was never broken. `move_object` and `resize_object`
work on a deck exactly as they do on a room, and a deck on its own floor has
always drawn with a drag body and four resize corners. The bug was that he
could not **see** it:

> **A room on another floor ghosted. An element on another floor vanished.**

His decks are on the second storey. From the ground floor — where the plan sits
by default — they were not faint, they were *absent*. Nothing there to grab.

Three laws now, all class-level:

1. **Off-floor elements ghost, exactly as off-floor rooms do.** One
   `ghostRect()` in `planView.jsx` draws both. Floor plates are excluded — a
   plate *is* the floor, not an object on it.
2. **A ghost is a way through.** Tapping one takes the plan to that thing's
   floor and selects it. If the host passes no `onSelectFloor`, the ghost falls
   back to `pointerEvents: none` — a ghost that cannot take you anywhere must
   not swallow taps.
3. **Select a thing and the plan goes to its floor.** Tapping a second-storey
   deck in 3D used to open its card while the plan stayed on the ground floor.
   An effect in `App.jsx` now moves `activeFloor` to follow any selection that
   has a level, and `planFloor` lets a whole-building chapter follow the
   selection instead of pinning to floor 1.

**New suite: `tools/plan_floor_test.mjs` (16 checks).** It builds a plain
two-storey box from scratch — one room and one deck per floor, nothing named
after his house — bundles `PlanView` with esbuild and renders it to static
markup, then asserts what draws live, what draws as a ghost, and that a deck
gets the same four resize corners a room does. Verified to fail (5 checks) when
the fix is reverted. Added to `tools/prove_it.mjs`. If esbuild cannot load it
says so plainly and exits clean rather than reporting a false break.

---

## WHERE THINGS STAND

- **All ten batteries green** after 219: op_smoke 228, design_space 15254,
  placement 2312, receipts 439, golden_numbers pinned, thermal, capability,
  deck_stair, outbuilding_roof, floor_resize 7, from_scratch_audit 0 gaps —
  plus plan_floor 16.
- **The corpus sweeps in `PROVE-IT` are not a verdict in the cloud sandbox**:
  there are no PDFs in `.data/trace-corpus/` there and no API key, so all three
  sweeps report INCOMPLETE. That is the environment, not the code. Run
  `PROVE-IT.bat` on the PC for a real reading.
- **GitHub is behind.** The cloud sandbox cannot push (no credentials). Updates
  212–219 are on Daniel's PC as source files; `push-to-github.bat` is the one
  button that gets them to `main`.

## STILL OPEN — carried forward

- **North Window 35** (x 21.3–26.3): leave it behind the stair, drop it, or
  move it to another wall. Daniel has not decided.
- **An asymmetric gable on a structure** — roof shape (shed | gable), settable
  pitch, off-centre ridge so one slope runs longer than the other. Every
  structure roof is still one shed plane at a fixed 0.18. The joined-building
  roof, the wall tops that follow it, and `outbuilding_roof_test.mjs` all have
  to learn about a ridge.
- **Plywood as a wall covering** — not in the covering list at all.
- **The stove in the workshop** — fits only with a listed close-clearance or
  shielded unit, and the poly wall wants a real non-combustible shield. The app
  checks no heat-source clearance to combustibles anywhere. Real missing law.
- **Under-deck flights are never checked against things ON the deck.**
- **Joining changes the drawing, not the costing** — a shared wall is still
  priced twice.
- **`GEOMETRY_PASS.md`, `RESUME.md` and `TESTING.md` lag the code** (two days
  now).

## HOW TO FIND WHAT HE ASKED FOR

Every "why can't I—" in his own words is in the **Why can't I** database on the
07 — House Notion page:
<https://app.notion.com/p/6d17bcccdb4e42eab93686622e45778c>

`STRATEGY.md` rule 1b requires every session to file what it hears. A complaint
that lives only in a chat transcript gets re-litigated.

# SESSION HANDOFF — 2026-07-27 (updates 197–210)

Read `AGENTS.md` first (it is new, and it binds you), then `HANDOFF.md` for
what the app *is*. This file is one working day: a consolidation pass in the
morning and thirteen updates of Gate A work after it, all of it driven by
Daniel using the app on his own house — mostly on one deck stair and one
outbuilding, which is what depth work actually looks like.

---

## THE ONE THING TO CARRY FORWARD

> **The app must be built to build ANY house, not his house.** A control that
> names another object, or presumes a relationship only this building has, is
> the instance leaking into the product.

His words, after update 199 shipped a dropdown reading *"Part of the same
building as: <that object over there>"*. Pointing at another object is
**wiring**, and it only reads as sensible to someone who already knows the
building. Nothing else in this app works that way — the roof follows the wall
heights, outbuildings drain the way the house drains, flags re-check
themselves. Update 201 tore it out.

**The shape of the fix, worth reusing: derive the law, and let the EXCEPTION
be the control.** Twice in one afternoon that turned a house-specific control
into a law that holds anywhere:

| Was | Became |
|---|---|
| "Part of the same building as X" | Structures that **touch** are one building. `standsAlone` is the override — a fact about ONE structure, never a pointer at another. |
| "Pick the edge your upper deck's stairs run down" | A **raised walking surface needs a way down**, at any level. Height is the fact that matters, not which storey. |

**The test for any control you are about to add:** could it exist, unchanged
and sensible, on a house nobody has designed yet? If it names another object,
the answer is no.

The corollary bit me three times: **never break a tie by array order.** "The
first deck in the list", "the first member with an open edge", "try north then
south" — all of them are order-of-creation, and order of creation is not a
fact about a building. Every one got replaced by a measurement (widest open
edge, most clear ground beyond the foot).

---

## WHAT LANDED

**197 — consolidation.** Nine house-design items pulled out of Downloads into
`design-archive/` (the FreeCAD/Python BIM prototype and its design-council
prompts are worth mining). `AGENTS.md` written as the operating contract for
every AI that opens the repo; `CLAUDE.md`, `GEMINI.md` and
`.github/copilot-instructions.md` point at it. `UPDATE_STAMP` realigned — it
had drifted to 172 while commits ran to 196.

**198 — the plan paints what is underfoot first.** `planView.jsx` drew rooms,
then elements, in array order; SVG has no z-index, so a foundation slab pad
buried whatever it was poured over. Never geometry — the 3D always had it
right. Foundation now paints before the rooms, except in the Foundation
chapter where the pad is the subject you came to drag.

**198 — an outbuilding's walls rise to meet its roof.** All four walls were
built to one height and the roof tilted above them: 1.4 to 7.2 ft of open
daylight on the high side plus raking gaps down both flanks, on every
outbuilding. Walls now follow the roof plane (sloped-top prism per wall run,
doorways and headers included), tracking the panel's underside measured
VERTICALLY — a tilted 0.3 ft panel hangs lower than 0.15 beneath its
mid-plane, and a wall built to the wrong one pierces the roof.

**199 → 201 — structures that touch are one building.** One roof over the
combined footprint, one fall, one wall height, no wall on a shared edge; each
member keeps its own covering, so a poly bay and an insulated room read as
different rooms of one building. A joined carport builds as a **bay**, not a
canopy. 199 did it with `joinsId`; 201 replaced that with adjacency — see
above.

**202 — a structure that is part of a building is roofed by the building.**
Joining introduced a second roof: the canopy block roofed anything carrying a
roofType, so a joined carport got the building's roof *and* a canopy on posts
over the top. Translucent polycarbonate is exactly the covering that hides two
stacked panels.

**200 → 205 — deck stairs, four passes.**
- A raised deck at ANY level needs a way down (`needsSteps` asked `level === 1`,
  so an upstairs deck got no steps, no cost line and no flag — silence).
- Decks meeting at the same height are ONE surface (`deckGroupOf`): one stair
  serves the group, and no member is flagged stranded on its own.
- A stair may not RUN THROUGH a building. The open-edge test only knew about
  the house and other decks, so an edge clear at the deck could march its whole
  flight into a shed 20 ft out, offered without a word.
- Compass bearings are wrong for stairs. A stair off the north edge is one you
  climb heading SOUTH; he said "N" meaning the direction he would walk. A
  bearing is right for a WALL and poor for a STAIR. The control now says which
  side it hangs off *and* which way you walk.
- `DECK_STAIR_SHAPES = out | along`. An **under-deck** flight runs parallel to
  the edge and tucks beneath: no ground given up, deck as its roof. It resolves
  its own placement — 3.5 ft strip, needs 7.5 ft of headroom and enough edge
  (12.2 ft climb = 17.1 ft of run), solids cut out of the available length,
  bottom placed at the downhill end of the longest clear stretch.
- The **stairwell is cut** out of the deck surface: headroom ÷ slope, never
  longer than the run (9.4 ft on a 12.2 ft deck). A deck with a stair under it
  and no hole is a deck you cannot get off.
- Automatic prefers the flight that **costs no ground** where one fits.

**206 — a guard round the stairwell**, drawn and priced. Cutting the hole made
a 12 ft drop in the middle of a deck with nothing round it; code does not
distinguish an edge from an opening. Both long sides and the far end; the near
end stays open because that is the way down; a side on the deck's own boundary
is skipped because the perimeter rail already stands there. An under-deck
flight no longer breaks that perimeter rail — you step down through the hole,
not over the outside.

**207 — a side can be missing, and a door is made of what its wall is made of.**
Every structure got four walls whether the building had four or not: a woodshed
is open to the weather it dries in, a carport is a roof on posts. `open<Side>`
builds no wall and prices none (the open share of the perimeter comes off
OUTBUILDING_WALL_SHARE = 0.33, a coarse number named in the open because
footprint × rate is itself coarse). Separately, a door leaf was wood whatever
wall it sat in — a polycarbonate bay got a wooden barn door. It follows the
wall now, translucency and all.

**208 — a stair may not block a door.** The stair rules knew about walls and
nothing about doors, so a flight could be drawn across a ground-floor slider.
Every ground-level door you walk through keeps four feet of clear ground, the
way a wall keeps its footprint.

**209 — ask WHAT can be built before deciding WHERE it goes.** A group of
touching decks picked its carrier by widest open edge — deciding where before
asking what — so the deck with the longest edge won the stair even when nothing
could be built along it, and the surface fell back to a flight thrown into the
yard while its neighbour had clear room underneath. Feasibility first, then
width.

**210 — where along the side is a decision, not a guess.** You could pick which
SIDE a flight hangs off and not WHERE ALONG it — the app centred it silently.
Centring is a guess wearing the clothes of a rule, and it is the one thing
about a stair the plan cannot work out for you: hard against a building, lined
up with a path, clear of a window. `deckStairAt` is measured along the side
exactly the way an opening is measured along its wall.

---

## VERIFICATION

`tools/outbuilding_roof_test.mjs` is new — 3787 checks. It rebuilds the
SHIPPED roof panel with three's own rotation maths, solves its underside as a
plane, and samples every wall top against it (worst error 0.00000 ft). It also
holds the one-building-one-roof rule against the source. **Both halves were
verified to FAIL when reverted** — a battery that cannot fail is decor.

**Three pinned receipts expectations moved, deliberately**, and are marked
`CHANGED` in `tools/receipts_test.mjs` with the reasoning: the decked fixture
went 2 stairs → 1 and the stairs fixture 4 → 2, because the runs that vanished
were stairs down from a deck you could already walk off. That fixture's
*railing* rule has always treated the shared edge as a join; the stair rule now
agrees with it instead of contradicting it.

Every other battery unchanged and green throughout: op_smoke 228,
design_space 15254, placement 2312, receipts 439, golden_numbers 189 pinned /
0 drifted, thermal 39, capability 209 / 43, from_scratch_audit 0 gaps.

---

## OPEN

- **Everything above is unpushed.** Updates 198–210 are on Daniel's disk.
  `push-to-github.bat`. `main` is current only to `1f49753` (update 197).
- **Two shapes asked for and NOT built.** Both are real geometry, not tweaks:
  - **An L / wrap deck stair** — two flights and a landing at a corner, so a
    run can split between *along* and *out* where neither alone fits. The app
    already has this vocabulary for interior stairs (`STAIR_SHAPES`: straight,
    L, U); deck stairs have only straight. Note for whoever builds it: on
    Daniel's own house a wrap round the NE corner does NOT work — the turn has
    to land in y 1.5–7.5, which is a ground-floor slider. Build it for the
    shape, not for his case.
  - **An asymmetric gable on a structure** — a roof *shape* (shed | gable), a
    settable pitch, and a ridge off-centre so one slope runs longer than the
    other. Every structure roof is currently a single shed plane at a fixed
    0.18. The joined-building roof, the wall tops that follow it, and
    `outbuilding_roof_test.mjs` all have to learn about a ridge.
- **Also queued:** plywood as a wall covering for the workshop (check whether
  it is in the covering list at all); a small stove in the workshop.
- **The stove, worked out:** the workshop is 19 × 5.7 ft inside, 68″ of depth.
  22″ stove + 16″ hearth = 38″ committed. Standard 36″ rear clearance needs
  74″ — does not fit. A listed close-clearance or shielded 12″ needs 50″, which
  leaves 18″ to walk past. **It fits if he buys the right stove, not any
  stove.** And that room has polycarbonate walls: poly deforms well below the
  temperature a shield sees, so it wants a real non-combustible shield, not
  distance. The app does not check heat-source clearance to combustibles at
  all — that is a real missing law.
- **Under-deck flights are never checked for the stairwell colliding with
  anything ON the deck** (furnishings, a hot tub). Nothing does that yet.
- **Joining changes the drawing, not the costing.** The engine still prices two
  structures, so a shared wall is counted twice.
- **`GEOMETRY_PASS.md`, `RESUME.md` and `TESTING.md` were not touched today**
  and now lag the code.

## HOW TO FIND WHAT HE ASKED FOR

Every "why can't I—" from this session, in his own words, is in the **Why can't
I** database on the 07 — House Notion page:
<https://app.notion.com/p/6d17bcccdb4e42eab93686622e45778c>

`STRATEGY.md` rule 1b now requires every session to file what it hears — and
what it finds itself. A complaint that lives only in a chat transcript gets
re-litigated.

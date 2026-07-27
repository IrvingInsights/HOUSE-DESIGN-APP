# SESSION HANDOFF — 2026-07-26 (update 172)

Read `HANDOFF.md` for what the app *is*, then `SESSION-HANDOFF-2026-07-25.md`
for update 171. This file is only the chapter split that landed on 07-26.

---

## WHAT LANDED: the Rooms chapter split

**The problem, in numbers.** Before this change the Rooms chapter's panel was
171 lines and six components — nearly twice the next biggest (Roof, 95 / 3) and
five times the median. It had become the drawer everything got put in.

**The cause was structural, not cosmetic.** The chapters are a build sequence,
but Rooms is also the chapter that owns the *plan view* — so anything you could
*place* landed there regardless of what it was. A garden shed, a carport and a
garage were filed under Rooms. So were patios and decks and stairs.

**The split (Daniel chose the name "Outbuildings"):**

| | change |
|---|---|
| **Outbuildings** *(new, chapter 8)* | decks, patios, and the structures that stand apart — shed, workshop, studio, barn, garage, guest cabin, greenhouse, sauna, carport, porch |
| **Storeys** | gained stairs — the add button AND the shaping controls (StairControls) |
| **Rooms** | keeps rooms, interior walls, doorways, furnishings — what is *inside* |

Rooms' panel went from **171 lines / 6 components to 89 / 4** — no longer the
biggest. The new shape, measured the same way:

```
 89  rooms          FloorBar, CustomRoomAdd, DoorwayControls, FurnishPalette
 45  storeys        StoreysControls, StairsAndSteps
 40  walls          FloorBar, OpeningsControls, WallsControls
 34  outbuildings   FloorBar, StructurePalette
 27  frame · 15 foundation · 11 finishes · 10 shape · 9 systems
```

### What did NOT move, and why

- **Outdoor slab pads** (carport / patio / porch / walkway pads) stayed in
  **Foundation**. They are a pour, priced as foundation work; moving them would
  have shuffled the mess rather than cleared it. Outbuildings signposts across
  to Foundation for them, and Foundation was not oversized to begin with.
- **Shade devices** (awnings, trellises, trees) stayed in **Systems → Summer &
  cooling**. Each one reads back into the same panel's summer-swing and
  glass-by-face numbers; pulling the palette out would have split one thermal
  story across two chapters to save four lines.

Both are deliberate deviations from the plan sketched in chat. Say so if he
asks why the new chapter is smaller than described.

---

## THE MECHANICS (what to know before touching it again)

**1. The placers were lifted out of JSX.** `addStair`, `setStairField`,
`setDeckSteps`, `addDeck`, `addPatio`, `addStructure` are now named consts in
`App()` (just after `duplicateElement`). They were inline in the classic
panel's markup, which is exactly why the quick toolbar could never offer them —
the site look would have had to duplicate the handler. Both looks now call the
same function.

**`setStairField` still carries the turn-in-place law** (keep the stair's
CENTRE when facing/shape/turn changes, because x/y is the north-west corner and
flipping the bbox otherwise flings the stair across the site). Verified live
after the move: straight at corner (13, 11) → L-turn at (9, 13), centre held at
≈(14.7, 18.8).

**2. Flags had to move with the controls.** A flag must light the chapter that
can FIX it. Two new `system` values in `engine.js`:

- deck railing / deck steps: `rooms` → **`outdoors`** → Outbuildings
- stair flags + "Upper space has no stair": `rooms` → **`stairs`** → Storeys

`FLAG_CHAPTER` in App.jsx maps both. Confirmed live: "Upper space has no stair"
now dots **Storeys**, not Rooms.

**3. The capability manifest carried the reorg.** `tools/capabilities.json` is
now **43** capabilities (was 40). Renamed `cap-rooms-stair` →
`cap-storeys-stair`; `structures.add` was a homeless `site:"sheet"` entry and is
now `outbuildings.structures`, `site:"more"`. Three genuinely new registrations
— `storeys.stair-add`, `outbuildings.deck`, `outbuildings.patio` — because
those buttons had never carried a `data-cap` at all and the reorg was the
moment to pin them.

---

## VERIFIED

Static batteries, all green:

```
node tools/op_smoke_test.mjs        228 pass
node tools/design_space_test.mjs  15254 pass
node tools/placement_test.mjs      2312 pass
node tools/capability_test.mjs      209 checks / 43 capabilities
node tools/golden_numbers_test.mjs  189 pinned, 0 drifted
node tools/receipts_test.mjs        439 pass, 0 fail  ← the 9 known fails are GONE
node tools/from_scratch_audit.mjs   0 gaps
```

Live, driven through the real UI on his design (port 5184, built `dist/`):

- Ten chapters in the rail, Outbuildings at 8.
- Outbuildings quick row reads his real design back: "+ Deck **2 placed**",
  "4 standing apart" (Workshop, Carport, Woodshed, Garage).
- Its More panel shows all ten structure presets, `elementFromPoint` confirms
  the palette is on top (not occluded).
- Storeys quick row grew "+ Stairs"; pressing it placed a stair, the full
  StairControls appeared in Storeys' More panel, the L-turn held its centre.
- Rooms' More panel: no deck / patio / stair / structure buttons left, and it
  signposts to both new homes.
- Tapping an outbuilding on the plan in the new chapter opens the SAME card.
- 3D loads with every deck and outbuilding in the scene, no console errors
  (`__nbView.renderer.domElement.isConnected` true, 126 named nodes).

**His design was restored.** The test stair was undone; a before/after diff of
`/api/projects/current` shows 19 rooms and 29 elements identical.

**Also:** `UPDATE_STAMP` had drifted to "update 160" while commits ran to 171 —
bumped to **172** so the badge and the commit series agree.

---

## SWEPT THE SAME DAY: the dead chapter greetings

Every `CHAPTERS` entry carried a `greet` sentence for a card over the model.
**Daniel had that card removed in update 48** — commit `bac7417`, his words:
*"this card is obscuring the model, remove it"* (it covered the drawing and
repeated what the controls already said). The card went; the ten sentences
did not. They sat unread for 124 updates, and the comment above `CHAPTERS`
kept advertising a "foreman voice" the app had not spoken since spring.

Removed in update 172: the `greet` field on all ten chapters, `.rz-greeting`
and `.rz-greet-card` (+ its media query) from `shell.css`,
`.st-morepanel-greet` and the `.st-look .rz-greet-card` hide-rule from
`siteTable.css`, and the two stale comments. Nothing rendered any of it.

**Do not re-add a greeting card.** He killed it once on sight. A chapter
explains itself through its controls and the `rz-shape-note` lines under them.

---

## OPEN / NEXT

- **Still not pushed.** The branch `claude/homestead-reimagine-lcmrww` was 12
  commits ahead of origin as of 07-25, plus this change. Ask Daniel.
- `add_roof_plane` is still a lie — bim-core falls it through to the same
  handler as `set_roof_profile`. Rename or implement (carried from 07-25).
- The next natural coherence question: **Foundation** now holds four outdoor
  pad presets whose names (Carport pad, Patio pad, Porch pad) shadow real
  objects in Outbuildings. That duplication predates this change and was left
  alone on purpose — but it is the kind of thing he notices.

# SESSION HANDOFF — 2026-07-25

For the next session. Read `HANDOFF.md` first for what the app *is*; this file
is only what changed on 2026-07-24/25 and what to do next.

Committed as **`0a1d91d` — "update 171"** on branch
`claude/homestead-reimagine-lcmrww`.
**⚠ NOT PUSHED.** That branch is now **12 commits ahead** of
`origin/claude/homestead-reimagine-lcmrww`
(github.com/IrvingInsights/HOUSE-DESIGN-APP). Ask Daniel before pushing.

---

## THE FRAME FOR ALL OF IT (Daniel's words)

> "we are not done with this app — the goal. The house is proof the app can
> work — if it could be used to build the house design from scratch."

The **app is the product**; his house is the **acceptance test**. The bar is not
"the app can display his design" — that design was seeded and hand-patched over
months. The bar is: *could someone starting from an empty screen build it, using
only the UI?*

**Sequence he set, do not jump ahead:**
1. **Finish THIS house** — make the app able to build it. ← we are here
2. Then **reverse-engineer it** (rebuild from scratch as the proof).
3. Only then: read *from* drawings, and emit proper ones via FreeCAD/Blender.

He explicitly said **do not go back to the FL0 design yet.**

`node tools/from_scratch_audit.mjs` encodes this test. Current result on his
design: **20 constructs present, 0 gaps.**

---

## WHAT LANDED THIS SESSION

**Material sourcing.** `spec.sourcing[system]` = `new | salvaged | milled`
(replaced the `reclaimed` booleans; legacy specs auto-migrate, nothing to press).
Pine plank added as its own floor type ($6/sf) with hardwood relabelled.
`SOURCE_FACTORS[system][source].note` prints, under every picker, what that
discount actually buys.

**Heat repriced off a real quote.** Temp-Cast standard kit **with bake oven =
$8,980** (researched live). `HEAT_SOURCES` splits every source into `{kit,
install}` — **sweat equity applies to `install` only** (the old code let you
labour your way out of buying refractory modules). Facing is now a choice:
`HEATER_FACINGS` cob $260 → soapstone $4,800; **his is cob**.

**Stairs became a real object.** `STAIR_SHAPES` (straight/L/U), facing, run
split, priced per tread. **One `DirectionDial` compass** drives every interior
stair *and* every deck's steps. A stair that climbs to a deck now **opens that
deck's railing where it lands**.

**Roof.** Found and fixed a genuine wedge of daylight: a shed's flat low wall
was built level while the roof kept sloping across the wall's own thickness.
Deep eaves now draw their structure — **exposed rafter tails** (his choice) or a
**boarded soffit**, toggled in the Roof chapter.

**Also:** one scaled grid under every drawn view (`src/scaleGrid.jsx`); interior
doorways moved into the Rooms chapter; stairs cost money now.

---

## HARD-WON GOTCHAS — READ BEFORE TOUCHING ANYTHING

1. **`node server.mjs` (port 5184) serves the BUILT `dist/`, not live src.**
   Any src change needs `node node_modules/vite/bin/vite.js build` before it
   shows. A dev edit alone does nothing.

2. **Out-of-band writes get CLOBBERED while the app is open.** A
   `/api/bim/apply` POST can return `ok:true`, persist, and still be overwritten
   seconds later by the open client saving its own copy. **Synthetic pointer
   drags also fail** (React `setPointerCapture` ignores dispatched events).
   *The only reliable way to change his live design is a real UI control.*
   That constraint is a feature: anything you cannot do through the interface is
   something the interface is missing.

3. If you must use the API anyway: `GET /api/projects/current?project=reimagine`
   → POST `/api/bim/apply` with `{prompt, bim:spec, spec, state, plan:{operations},
   persist:true}`. **You MUST pass `state`** — `runBimApply` does
   `projectId = currentState.projectId || DEFAULT_PROJECT_ID`, so omitting it
   writes his design into the **wrong project**.

4. **Verifying 3D:** the Rooms chapter's default view is `plan`, which
   **unmounts ThreeScene** — `window.__nbView` then points at a *detached* scene
   that never updates. Always check
   `window.__nbView.renderer.domElement.isConnected` before trusting a
   measurement. `window.__nbView.scene` gives real mesh bounding boxes and is far
   better than guessing at the code.

5. **A ThreeScene crash blanks the whole app**, not just the 3D panel, and the
   console only says "An error occurred in the <ThreeScene> component". Every
   element branch must produce a `mesh` (the invisible select/drag handle).
   **Always load the 3D view when verifying.**

6. Every new op needs **three** registrations: bim-core handler + client caller
   + planner enum.

---

## THE META-LESSON (4 for 4 this session)

Every "X is not working" from Daniel was a **real defect — but never the one
named**:

- "stairs not responding" → controls fired fine; he had **two stairs both named
  "Stairs"** and was turning one while watching the other.
- "compass not working" → correct writes; the stair **pivoted around its corner**
  and flew across the site.
- "not controllable / corners / 90°" → I had **silently deleted** the ↻ button
  and the corner handles while rebuilding.

**When he says a control is broken, check what the write does *geometrically* —
measure the object's position before and after, not just the stored field.**
And when replacing a UI or a render branch, **list what the old one offered and
carry every affordance across before deleting it.**

---

## OPEN / NEXT

- **Push?** 12 commits are local-only. Ask him.
- **Furnishings receipt gap** — `receipts_test` is 272 pass / **9 fail**, all
  `<fixture>.furnishings has receipt lines`: `cost.furnishings` has no
  `costReceipts.furnishings` entry. Pre-existing, spawned as its own task.
- **`add_roof_plane` is a lie** — bim-core falls it through to the same handler
  as `set_roof_profile`, so it does not add a plane. Rename or implement.
- **His design now:** 28×32, 2 storeys, shed roof, timber frame (David's kit),
  pine floor milled locally, cob-faced Temp-Cast heater, ~**$260k**.
- **David / Square Rule Frames** is the real-world price calibration — see the
  memory file `david-square-rule-frames.md`. His **$250 planset** is still the
  cheapest, highest-value real-world next step.

## TEST SUITES (all green at `0a1d91d` except the known 9)

```
node tools/op_smoke_test.mjs        192 pass
node tools/design_space_test.mjs  15254 pass
node tools/placement_test.mjs      2312 pass
node tools/capability_test.mjs      168 pass
node tools/golden_numbers_test.mjs  locked
node tools/receipts_test.mjs        272 pass / 9 known fail
node tools/from_scratch_audit.mjs   20 constructs, 0 gaps
```

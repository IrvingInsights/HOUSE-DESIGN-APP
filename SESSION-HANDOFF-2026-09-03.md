# SESSION HANDOFF — 2026-09-03 (updates 233–243)

Read `AGENTS.md` first (it binds you), then `RESUME.md` for where things stand.
This file is one session: Daniel came back to an app he had left because it
"was definitely not working properly", and asked for it to be seen through to
the end. He chose the finish line himself: **one complete build**.

---

## THE ONE THING TO CARRY FORWARD

> **The app was two apps.** Everything a person was promised — the chat, the
> drawing reader, the exports — lived in a build nothing linked to, while the
> build that actually opened could only design. Every document described the
> other one.

That is why "it still had issues" was true and hard to pin down: the app
worked, and the app was missing half of itself, at the same time. The fix was
not a bug hunt. It was carrying five features across and deleting the second
app so the question cannot come back.

**The habit worth keeping from this session:** three times, a battery or the
browser caught something no amount of reading would have. Trust them over
inspection:

| Caught by | What it caught |
|---|---|
| The browser | The export menu drew itself inside a strip with `overflow:hidden` — invisible, exactly like the flags popup that was broken for weeks. |
| `from_scratch_audit` | Deleting the old build would have silently removed the ONLY way to set the site (postcode, latitude, rain, slope). |
| A probe against his real house | A one-tap fix emitted `set_drainage`, an op that does not exist. It would have done nothing, quietly. |

---

## WHAT LANDED

**233 — starting the app lands you on the main line.** Daniel's folder sat on
a side branch, three updates behind, for a month. `start.bat` runs a bare
`git pull`, which pulls *the branch you are on*; the in-app updater failed the
same way. New `tools/update-to-main.cmd` moves a clean folder onto `main` and
pulls; a folder with unsaved work is told so in one sentence and left alone.
It lives in its own file because cmd re-reads `start.bat` by byte offset after
a pull rewrites it — the frozen block at the top must stay byte-identical.

**234 — the July UX review reads as words.** It had been committed
base64-encoded and was gibberish on GitHub and on disk.

**235 — you can start on empty land.** "+ New" reloaded the six-room sample
house, so there was no way to begin from nothing — on an app whose whole
premise is arranging your own rooms. `emptyLandSpec()` keeps the shell (the
18-ft clamp means a shell must exist) and empties everything in it. The empty
design is now a case in the design-space battery and the live audit battery,
because "no rooms" is exactly the shape that makes renderers throw.

**236 — the money and the flags sit at the top of the left bar**, above the
ten chapters instead of below them, and the two near-identical history lists
became one.

**237 — the design can leave the app again.** Permit sheets, frame drawings, a
written brief, BIM data, IFC and Blender sync. The generators had been sitting
in `docExports.js` / `frameDrawings.js` / `blenderBridge.js` all along with
nothing rendering them: the app could design a house and then hand you nothing
to build it with.

**238 — a Layers panel.** Hide any part, hide a category, x-ray, or explode.
The renderer had understood every one of these keys for months. Anything
hidden is announced on screen, counted against the *chosen view* rather than
against everything — the default "finished house" leaves the frame out by
design, and announcing that would cry wolf on the view the app opens in.

**239 — flags that fix themselves.** Fifteen one-tap remedies ported; the app
had three. Each was probed against his real house first, which is how the
invented `set_drainage` op was caught.

**240 — the chat is back.** `src/studio/`: `ask.js` is the whole decision
ladder as a PURE function, so every rung is proven from the command line with
no browser and no key (`tools/studio_ask_test.mjs`, 34 checks). The old
version was 150 lines tangled inside a component and could only be tested by
typing at it. Three rules it holds: simple asks never touch the AI; the
planner is called with `persist:false` so the app stays the only writer of the
design file; a result lands as ONE undoable step.

**241 — read a floor plan from the front door.** "+ New → Start from a
drawing" empties the land, attaches the file and writes the ask. The
conversation survives a reload on its own clock. And the honesty fix: with no
key, the server used to reply *"I read that as a design discussion prompt.
Current model snapshot: 28' x 32'…"* — jargon, to a non-coder, shaped like an
answer to a question nothing had read. It now returns no answer at all, plus
the plain facts of the house, and the app says the AI is not set up and which
file to make.

**242 — one app instead of two.** `classic.html` and `src/main.jsx` deleted.
The gate was `from_scratch_audit` reading the same before and after; it did
not, and it was right — the site controls were only in the old build, so they
were built into Systems. Two audit probes were corrected to describe how this
build does the job (a glazed south band is a greenhouse *opening* here, not a
wall field), and the audit now follows one hop through the shared planners, so
a control that calls a helper still counts as a control.

**243 — the documents describe the app that exists.** README, TESTING,
RESUME, HANDOFF, STRATEGY, AGENTS.

---

## VERIFICATION

Two new batteries, both written to fail if the honesty rules are broken:

- `tools/studio_ask_test.mjs` (34) — the chat's ladder without a browser: a
  room is added with no AI; a drawing instruction with nothing attached is
  refused; a drawing with no instruction is not read on a guess; an
  unreachable engine is blamed on the engine, never on the request; a missing
  key says which file to make and never dumps raw error text.
- `tools/trace_flags_test.mjs` (13) — a drawing reader's doubts appear as
  ordinary flags, in the reader's own words, clear themselves when re-read,
  never nag a design that never saw a drawing, and never crash the checks on a
  malformed report.

Both are wired into `PROVE-IT`. Everything else green throughout: design_space
15,316 · op_smoke 228 · placement 2,312 · receipts 439 · golden_numbers 189
pinned / 0 drifted · capability 272 across 57 capabilities · from_scratch_audit
0 gaps.

The capability checker itself was extended twice: it reads the app **and the
modules it imports** (moving the chat into its own file would otherwise have
read as the capability vanishing), and it learned a `site: "shell"` kind for
controls that belong to the app's chrome rather than to a chapter.

---

## THE KEY WENT IN, AND THE AI HALF WAS PROVEN LIVE (update 245)

Daniel pasted a Gemini key into `.env.local` (a newer key format — it does
not start with `AIza` — and Google accepted it). Through the running app:

- **The expert** answered "what is this house made of, and what would a
  builder check first?" in plain words naming the real materials: straw bale
  with lime plaster, wood frame over an insulated earthen slab, a metal shed
  roof, the rubble foundation's moisture detailing. Before that worked, one
  fix: the question was never sent the walls, frame, heating or site — asked
  what the house was made of, the AI said it had no idea. It carries the
  whole house now, and the prompt tells it who it is talking to (no "BIM").
- **The planner** changed a copy of the design with `persist:false`; the
  design file on disk stayed byte-identical. It also exposed a bug: "make the
  kitchen 12 by 16" came back as w:12 with the 16 put in x and y, and the
  reply said "Resized Kitchen to 12' x 0'". Three fixes: a size for a room
  that exists is exact arithmetic and never goes to the AI (`parseLocalResize`
  in `src/studio/ask.js`, nine new checks); the planner's schema now says what
  w and d mean and that a size never goes in x or y; and the wording only
  says what was set, never a 0.
- **The drawing reader** was handed a PNG of Daniel's own floor plan (drawn
  from the plan view in the page and posted as a background job, so his
  design was never touched). It read back Great Room 18×19, Kitchen 10×15,
  Primary Bedroom 10×10, Mud/Laundry, ½ Bath, Pantry, Closet — names and
  sizes right — 15 openings, scored itself 10 of 11, and its one doubt
  ("rooms don't pile on each other") is exactly the kind of ordinary flag
  `trace_flags_test` holds it to.

## OPEN

- The reader is proven on an image of his own plan, not yet on an
  architect's PDF here: drop one into `.data/trace-corpus/` and run
  `node tools/trace_corpus_test.mjs` — it is in the tests forever after.
- **Still not built**, all from the Why-can't-I list: the L / wrap deck stair;
  an asymmetric gable on a structure (outbuilding roofs are one sloped plane);
  plywood as a wall covering; heat-source clearance to combustibles; two
  joined structures still priced separately, so a shared wall is counted
  twice; "from north" being the drawing's north, not a surveyed bearing.
- **Gate B has still never been run.** A stranger, an hour, no dead ends.
  Daniel cannot run it himself.

---

## LATE FIND: THE 3D VIEW COULD OPEN ON A BLANK SCREEN (update 244)

Caught in the final pass, on his own house, and it was not something the port
introduced — it was live.

`defaultCameraFraming` works out how far back to stand from the shell's own
size. It divides by the sine of the field of view, and the field of view comes
from the pane's aspect ratio. When the 3D pane mounts before the layout has
given it a width — a chapter switch, a hidden tab — `clientWidth` is 0, and a
guard turned that into an "aspect" of 0.01. Dividing by the sine of an almost
zero angle put the camera **8,100 feet** out, past its own 2,000 ft far plane.
Every mesh in the scene was drawn behind the horizon. The pane was pure white.

Three things then conspired to make it permanent rather than a flicker:

1. There was no `maxDistance` on the controls, so a few wheel turns could put
   the camera out there too.
2. The camera position is remembered between chapters — a stranded camera was
   restored faithfully, forever.
3. The view buttons (Corner / Top / Front / Side) only change the ANGLE and
   keep your distance, so the one thing a person does when they see nothing
   did not help.

Fixed at all three: an unmeasured pane falls back to an ordinary widescreen
shape and the fit is capped inside the far plane; the wheel is fenced at both
ends against the house's own fit distance; a remembered camera that can no
longer see the house is discarded rather than restored.

`tools/camera_fit_test.mjs` (152 checks) holds it: six houses from a cabin to
the largest the app allows, six pane shapes including three that have not been
measured, each held to "the whole building fits" and "inside the far plane".
**Verified to fail (34 checks) when the fix is reverted** — a battery that
cannot fail is decor.

Worth remembering: this is the third time the same *symptom* has appeared and
the third different *cause* (a hardcoded camera in 219, an unmeasured pane
now). The symptom is always "the 3D looks broken". It is worth a battery.

---

## THE DECK STAIR THAT TURNS A CORNER (update 247)

Asked for in July and again today. It is a THIRD shape, not a tweak to the
fold that already existed:

- **`out` + a turn** (already there) goes OUT from the deck, turns on a
  landing, and runs across. It costs ground — about a third of a straight
  run back — and it is what wraps the corner of a BUILDING.
- **`wrap`** (new) runs ALONG one deck edge, turns on a landing at the
  corner, and carries on round the next edge, tucked underneath. It costs no
  ground at all. It is what wraps the corner of the DECK.

Both existed as ideas in the July handoff; only the first was built. The new
one exists because on a tall deck the other two shapes can BOTH run out of
room: a storey of climb is about 17 ft of run, a straight flight needs that
much yard, and a single tucked flight needs it in one straight edge. A deck
that wraps a building has the length — bent round a corner.

**Two laws it inherits rather than invents.** Decks that touch at one height
are one walking surface, so the second leg may carry on across a neighbouring
deck — which is the whole point, since each single deck is usually too short
that way. And the corner is DERIVED: you say which edge the flight starts on
and which way you walk, and the corner is where those two facts meet. Nothing
points at another object.

**On Daniel's own house it refuses, and the refusal is the interesting part.**
Every direction is blocked, and the app now names why: the clear ground of the
east ground-floor slider sits exactly at the corner the flight would turn at,
and the greenhouse stands under the main deck where the second leg would run.
That is precisely what the July note predicted — a wrap round his NE corner
does not work, because the turn has to land in y 1.5 to 7.5, which is a
ground-floor slider. The shape is proven on a clean two-deck fixture built
from scratch, not on his design.

**Fixed along the way, both found by using it:**
- The deck card collapsed every shape that was not `along` into `out`, so the
  switchback chip never lit and its own control could not be reached at all.
- The obstruction namer only checked one axis, so it blamed a woodshed forty
  feet up the site. It now names what actually stands in the strip, nearest
  the corner — which is how "the east sliding door" surfaced as the real
  reason instead of a wrong one.

`tools/deck_stair_test.mjs` is 51 checks now (13 new). The load-bearing one —
that the second leg carries on across the deck it meets — was **verified to
fail when that law is reverted**.

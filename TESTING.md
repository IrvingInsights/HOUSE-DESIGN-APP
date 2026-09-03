# Natural Building — tester setup

A design studio for natural homes (straw bale, cob, timber) that keeps a live
building model with cost, code checks, and carbon while you design.

## Run it (2 minutes)

1. Install **Node.js 20+** (nodejs.org).
2. Double-click **start.bat** (Windows) or **Start Mac.command** (Mac — first
   time: right-click it → Open, to get past Gatekeeper). The first launch
   installs the app's components automatically and **needs an internet
   connection** (a few minutes); later launches are fast and offline. The Mac
   launcher also opens the browser.
3. Open **http://127.0.0.1:5184/** in a browser.

That's the whole app. One tab at a time, please — two tabs fight over the same
design (see the last known limitation).

## What to try

**The heart of the app is designing from scratch — start there.**

- **Start with nothing.** Open **designs** in the top bar → **+ New** →
  *Start on empty land*. You get a bare shell on the ground and place
  everything yourself. (*Start from the sample house* gives you a six-room
  house to rework instead, and *Start from a drawing* is below.)
- **Add rooms** from the Rooms page, drag them around the 2D plan, drag the
  green corners to resize, and watch the cost and the checks react to
  everything you do. Drop a room on top of another and the app says so —
  it never moves your room somewhere you did not put it.
- **Work down the left bar in build order:** Shape → Storeys → Rooms →
  Foundation → Walls & openings → Frame → Roof → Outbuildings → Systems →
  Finishes. Every page leads with plain numbers.
- **Tap anything** in the model or the plan — its controls open on the left.
- **Worth a look**, at the top of the left bar, lists anything that does not
  add up, in plain words. Most items have a button that makes the fix for you,
  and the item clears itself once the problem is gone. One undo takes back a
  fix like any other change.
- **The 3D bar** carries: what to show (finished house / with the frame / just
  the frame / no roof), **X-ray**, **Slice** (a real section cut), and
  **Layers** — hide any single part, hide a whole category, or **Exploded
  view** to pull the building apart. Whenever something is hidden the app says
  so on screen, and reminds you the costs still cover the whole house.
- **▶ Watch it build** plays the build week by week.
- **export** (top bar) writes: **permit sheets**, **frame drawings** (shop
  drawings of the structure — print at 11×17), a **written brief**, **BIM
  data** for other software, and **IFC / Blender sync** if you have Blender.
- **ask** (top bar) takes a change in your own words: "add two bedrooms and a
  bathroom", "make the south wall straw bale". It also reads a drawing —
  see the next section.

## The AI part (optional, and honest about itself)

Two things use AI: asking for a change in your own words, and reading a
drawing. Both need a free key.

- Copy `.env.example` to `.env.local` in the app folder and put a Gemini key
  in it (free at aistudio.google.com), then restart the app.
- **Without a key the app still works.** Simple asks ("add a bedroom",
  "remove the duplicate windows") are done by the app itself with no AI at
  all. Anything more says plainly that the AI is not set up and changes
  nothing. It will never invent an answer or pretend a drawing was read.
- **Reading a drawing** (+ New → *Start from a drawing*, or attach one in
  **ask**) turns a floor-plan PDF or photo into a starting model. It takes a
  minute or two and the panel keeps telling you what it is doing. It grades
  its own reading and anything it is unsure about turns up in **Worth a look**
  like any other flag — and clears itself once fixed.

## Optional: Blender (only for IFC export / Blender sync)

**export → IFC file** and **Send to Blender** rebuild the model in Blender and
write a validated IFC4 file. Everything else works without it.

- Install Blender 4.x/5.x, then set the env var `BLENDER_EXE` to its
  blender.exe path (or have `blender` on PATH). The app launches it headless
  automatically on first use (~30s cold start).
- **Bonsai/BlenderBIM is NOT required** — the bundled add-on writes IFC with
  its own pure-python writer.

## Known limitations (honest list)

- **Reading a drawing gives a strong starting point, not an exact replica.**
  What the reader *sees* can vary between runs: a room count or a size may
  differ. The app grades every reading and puts its doubts in **Worth a look**.
  If a reading comes out poor, read it again; if a traced design gets muddled
  after many edits, a fresh read beats repairing it one message at a time.
- Footprints can be L / T / U shapes (drag a wall edge in the plan, or tap a
  wall → "Split into 3" → drag the middle), a split wall's sections can each
  run their own construction, and a partial upper storey gets a real stepped
  roof. Honest gaps: roof VALLEYS are not modeled (segments just meet),
  skylights on stepped/L roofs sit approximately, and the 3D frame is not
  drawn for custom outlines.
- **Permit sheets, frame drawings and the IFC/Blender export still draw the
  bounding rectangle for a custom outline** — the app's own model, costs and
  checks use the real shape. Frame drawings simplify the roof line on L-shapes.
- Upper storeys share one ceiling-height setting — a loft and a tower cannot
  have different heights yet.
- Outbuilding roofs are a single sloped plane: no gable with a ridge, and no
  asymmetric fall, on a shed or workshop.
- Deck stairs come straight out, along the deck underneath, or as a
  switchback. There is no L-shaped wrap around a corner yet.
- Two structures that touch are treated as one building for the drawing, but
  the costing still prices them separately, so a shared wall is counted twice.
- "From north" and "from west" are the drawing's own north and west, not a
  surveyed bearing — the app does not rotate a design to a compass.
- The greenhouse renders as real timber-and-glass, but its cost is still a
  generic per-square-foot figure.
- With Slice on, hidden parts of the model can still be clicked through the cut.
- Auto-arrange packs rooms into the full rectangle around a custom outline
  (adding rooms one at a time does respect the outline).
- Costs, carbon and heat numbers are directional early-design figures, not
  stamped engineering.
- One shared design per server ("the current project") — two browser tabs will
  fight over it. One tab at a time.

## If something looks broken

- Open the app with `?no3d` on the URL — the whole app must still load in the
  Plan view with an explanation in the 3D tab, never a blank page.
- The version and its update status sit under the top bar: it says *up to
  date*, *N behind*, or *couldn't check* — never silence.
- Developers running from a terminal: `npm install` once, then
  `node server.mjs`. The regression batteries live in `tools/`;
  `node tools/prove_it.mjs` (or PROVE-IT.bat) runs the lot. `capability_test.mjs`
  checks every user-facing capability in `tools/capabilities.json` is still
  reachable, so a reorganization cannot silently drop a control, and
  `from_scratch_audit.mjs` checks every construct in a real design can still be
  built by hand rather than only by asking the assistant.

## Sharing this folder

Share via **git** (the .gitignore already excludes secrets and designs), or if
zipping manually: **delete `.env.local` (API key!) and `.data/` (the author's
designs) first.** `node_modules/` can be dropped too (npm install restores it).

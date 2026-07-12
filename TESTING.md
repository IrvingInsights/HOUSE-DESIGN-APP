# Natural Building — tester setup

A design studio for natural homes (straw bale, cob, timber) that keeps a live
building model with cost, code checks, and carbon while you design.

## Run it (2 minutes)

1. Install **Node.js 20+** (nodejs.org).
2. Double-click **start.bat** (Windows) or **Start Mac.command** (Mac —
   first time: right-click it → Open, to get past Gatekeeper). The first
   launch installs the app's components automatically and **needs an
   internet connection** (a few minutes); later launches are fast and
   offline. The Mac launcher also opens the browser.
3. Open **http://127.0.0.1:5184/** in a browser.

That's the whole app: design, 3D/plan/detail views, costs, code checks,
permit-sheet export. No other software needed.

Developers running from a terminal: `npm install` once, then
`node server.mjs` from the app folder (that's all the launchers do).

Regression check if 3D ever misbehaves: open the app with `?no3d` on the URL
— the whole app must still load in the Plan view with an explanation in the
3D tab, never a blank page.

## Optional: Blender (only for IFC export / Blender sync)

The **Export → IFC file** and **Sync to Blender** actions rebuild the model in
Blender and write a validated IFC4 file. Everything else works without it.

- Install Blender 4.x/5.x, then set the env var `BLENDER_EXE` to its
  blender.exe path (or just have `blender` on PATH). The app launches it
  headless automatically on first use (~30s cold start).
- **Bonsai/BlenderBIM is NOT required** — the bundled add-on writes IFC with
  its own pure-python writer.

## Optional: an AI key (only for the chat planner)

The Studio chat's AI planning uses Gemini. Copy `.env.example` → `.env.local`
and add a `GEMINI_API_KEY` (free at aistudio.google.com). Without a key the
chat falls back to a local parser: simple adds ("add a bedroom") still work;
complex instructions won't.

## What to try

- The opening card → start from the **sample homestead** — or **start from a
  drawing**: pick a floor-plan PDF or photo and the app traces it into a
  working model (takes a minute or two; needs the AI key).
- Pick systems on the left (Foundation → Frame → Floor → Walls → Roof…),
  set the plain numbers, watch cost/checks react. The **Next →** button at
  the foot of each page walks you through in build order.
- **Tap anything** in the model (or use the chip, top-left of the preview) —
  its controls open on the left. Try **3D | Plan | Detail** on a wall.
- Talk to it: open the chat and say "add two bedrooms and a bathroom" or
  "make the south wall straw bale".
- Review tab → take a one-tap fix.
- Layers (top-right of the model) → **Exploded view**.
- Export → Permit set.
- Export → **Frame drawings** (or the button on the Frame page): shop-drawing
  elevation sheets of the structure — posts, plates, braces, rafters — with
  dimensions, callouts, a frame plan, and a member takeoff. Print at 11×17.

## Known limitations (honest list)

- **Tracing a drawing gives a strong starting point, not an exact replica.**
  Rooms come out named and measured, but placement can land a little
  differently run to run, and a big drawing set takes a minute or two. If a
  result looks off, say "re-check the trace against the drawing" in chat —
  and if a traced design gets muddled after many edits, a fresh re-trace
  beats repairing it one message at a time.
- Footprints can be L / T / U shapes (drag a wall edge in the Plan view, or
  tap a wall → "Split into 3" → drag the middle), and a partial upper storey
  gets a real **stepped roof**. Still honest gaps: roof VALLEYS aren't
  modeled (segments just meet), skylights on stepped/L roofs sit
  approximately, and the 3D frame isn't drawn for custom outlines.
- The **Blender/IFC export and permit sheets still draw the bounding
  rectangle** for a custom outline — the app's own model, costs, and checks
  use the real shape. Frame drawings simplify the roof line on L-shapes.
- Upper storeys share one ceiling-height setting — a loft and a tower can't
  have different heights yet.
- The greenhouse renders as real timber-and-glass, but its cost is still a
  generic per-square-foot figure.
- With the Slice (section cut) on, hidden parts of the model can still be
  clicked through the cut.
- The Auto-arrange button packs rooms into the full rectangle around a
  custom outline (adding rooms one at a time does respect the outline).
- Costs/carbon/heat numbers are directional early-design figures, not
  stamped engineering.
- One shared design per server ("the current project") — two browser tabs
  will fight over it. One tab at a time.

## Sharing this folder

Share via **git** (the .gitignore already excludes secrets and designs), or
if zipping manually: **delete `.env.local` (API key!) and `.data/` (the
author's designs) first.** `node_modules/` can be dropped too (npm install
restores it).

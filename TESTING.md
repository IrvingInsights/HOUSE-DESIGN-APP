# Natural Building — tester setup

A design studio for natural homes (straw bale, cob, timber) that keeps a live
building model with cost, code checks, and carbon while you design.

## Run it (2 minutes)

1. Install **Node.js 20+** (nodejs.org).
2. Double-click **start.bat** (Windows) or **Start Mac.command** (Mac —
   first time: right-click it → Open, to get past Gatekeeper). Dependencies
   install themselves on first run; the Mac launcher also opens the browser.
3. Open **http://127.0.0.1:5184/** in a browser.

That's the whole app: design, 3D/plan/detail views, costs, code checks,
permit-sheet export. No other software needed.

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

- The opening card → start from the **sample homestead**.
- Pick systems on the left (Foundation → Frame → Floor → Walls → Roof…),
  set the plain numbers, watch cost/checks react.
- **Tap anything** in the model (or use the chip, top-left of the preview) —
  its controls open on the left. Try **3D | Plan | Detail** on a wall.
- Review tab → take a one-tap fix.
- Layers (top-right of the model) → **Exploded view**.
- Export → Permit set.

## Known limitations (honest list)

- Footprints are rectangular; a partial upper storey works, but the roof
  still spans the full footprint (stepped roofs are in progress). No L/U
  plan shapes yet.
- Costs/carbon/heat numbers are directional early-design figures, not
  stamped engineering.
- One shared design per server ("the current project") — two browser tabs
  will fight over it. One tab at a time.

## Sharing this folder

Share via **git** (the .gitignore already excludes secrets and designs), or
if zipping manually: **delete `.env.local` (API key!) and `.data/` (the
author's designs) first.** `node_modules/` can be dropped too (npm install
restores it).

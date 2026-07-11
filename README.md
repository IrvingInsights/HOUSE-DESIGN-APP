# Natural Building — a house design studio

Design a real house — straw bale, cob, timber frame, or fully conventional — and watch a live 3D model keep track of the cost, the code checks, and the carbon while you work. Draw the floor plan in 2D, flip to 3D, ask the built-in assistant for changes in plain English, and export permit-style drawings, frame drawings, or a BIM (IFC) model at the end.

**You don't need to know anything about coding to use this.** Follow the three steps below.

## Get it running (about 5 minutes, one time)

**Step 1 — Install Node** (the free program that runs the app):
Go to [nodejs.org](https://nodejs.org), click the big green **LTS** download button, open the file it gives you, and click Next through the installer. Default settings are fine.

**Step 2 — Get the app:**
On this page, click the green **`<> Code`** button near the top, choose **Download ZIP**, then unzip the downloaded file anywhere you like (right-click → Extract All on Windows).

**Step 3 — Start it:**
Open the unzipped folder and double-click **`start.bat`** (Windows) or **`Start Mac.command`** (Mac — the first time, right-click it and choose Open). A black window will open — that's the app running; leave it open. Then open your web browser and go to:

```
http://localhost:5184
```

**The very first launch needs an internet connection** — it downloads the app's components automatically (a few minutes). After that it runs entirely offline. The welcome card walks you through the rest. To stop the app, close the black window. To start it again later, double-click the same file — later starts are fast.

## Using it — the short version

- **Start a design** from the welcome card: empty land, the sample homestead, or **a photo/PDF of a floor plan** — the assistant reads the drawing and builds the model from it.
- **Everything is tappable.** Tap a wall, a room, a window — in the 3D model or the 2D plan — and its controls open on the left. Drag things to move them.
- **Design by system.** The left side is organized like a real build: Site, Foundation, Frame, Walls, Roof, Windows, Water, Power… Each page leads with plain numbers. A 🌿 leaf marks the natural/green options; standard options always sit right beside them.
- **Ask for the big moves in chat** (right side): "add two bedrooms and a bathroom", "make the shed roof drain north", "clad the west wall in cedar shingles."
- **Review** flags anything that doesn't add up — most flags have a one-tap Fix button.
- **Export** (top right): permit drawing sheets, timber-frame drawings, a build plan with materials, or an IFC model for BIM tools.

Your designs save automatically on your own computer. Nothing you design is uploaded anywhere.

## Optional extras

- **Smarter assistant:** the chat works out of the box, but it gets much smarter with a free Google Gemini key. Get one at [aistudio.google.com](https://aistudio.google.com/apikey), then create a file named `.env.local` in the app folder containing one line: `GEMINI_API_KEY=your-key-here`, and restart the app.
- **Blender** is only needed for IFC export. Everything else works without it.

## Found a problem? Have an idea?

Click **Issues** at the top of this GitHub page → **New issue** → describe what happened in your own words (a screenshot helps). No technical language needed — "I tried to move the greenhouse wall and nothing happened" is a perfect bug report.

## For AI coding sessions and developers

The technical handoff lives in [RESUME.md](RESUME.md) (state, queued jobs, hard-won invariants). Tester notes and known limitations: [TESTING.md](TESTING.md). Test suites: `node tools/op_smoke_test.mjs`, `tools/geom_core_test.mjs`, `tools/trace_repair_test.mjs`.

To run from a terminal instead of the launchers: `npm install` once, then `node server.mjs` (the launchers do exactly this). The frontend deps (vite/react/three) are real npm packages — a clean clone won't start without the install.

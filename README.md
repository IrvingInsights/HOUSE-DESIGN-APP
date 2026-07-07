# Natural Building Design Dashboard

A local 3D schematic design app for professional house concepts. It uses an interactive Three.js model for fast exploration and exports BIM-oriented JSON plus a FreeCAD Python generator that creates a grouped `.FCStd` schematic model.

## Run

```powershell
npm install
npm run dev
```

Open the local URL shown by Vite.

This build includes a local planner server. By default it runs on:

```powershell
http://127.0.0.1:5184/
```

For model-backed planning and image understanding, set `OPENAI_API_KEY` before starting the app. Without an API key, the app uses its structured local fallback planner so it can still add/edit BIM objects, roofs, levels, lofts, towers, site elements, openings, and assemblies from common plain-language commands.

## BIM Path

- Units are feet in the interface and millimeters in FreeCAD exports.
- The exported FreeCAD script creates `Site > Building > Level_01` groups, slab, walls, roof, openings, and room zones.
- Use `C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe generated-script.py` to produce the `.FCStd` model.

## Design Workflow

- Use **Studio Chat** on the left to choose **Design**, **Team**, or a specific expert, then either make model changes or ask for plain-language advice in the same conversation.
- Add drawings, sketches, or handwriting directly inside the left chat panel.
- Use **Natural Building Elements** to add historic, ancient, and natural-building components such as straw bale walls, rammed earth, cob, timber frame bays, masonry heaters, earth berms, cisterns, root cellars, greenhouses, food forest edges, dogtrots, and courtyard patterns.
- Select a room in the 3D model or space schedule, then edit name, width, depth, position, type, and shell dimensions live.
- Select added natural-building elements in the BIM schedule or 3D model, edit their dimensions and category, and consult experts about them.
- Use **Back** in the top bar to restore the previous saved revision after design chat, council, attachment, add/remove, or live-edit changes.
- In **Council of Professionals**, click an expert to target them in the left Studio Chat without changing the design.
- Run **Council Loop** after edits to check conflicts and resolve schematic blockers.

## Stamp Track

The app creates schematic BIM artifacts and quality-gate notes. PE/architect stamp readiness still requires licensed structural calculations, local code review, MEP coordination, construction detailing, and jurisdiction-specific drawing sheets.

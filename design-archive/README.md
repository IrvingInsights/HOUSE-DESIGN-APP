# design-archive

Reference material, prior explorations, and exported artifacts for the house
design app and the house it designs. **Nothing here is live code** — it is kept
so the history of the project lives in one place instead of scattered across
Downloads folders and chat attachments.

Consolidated here on **2026-07-27** from `C:\Users\danir\Downloads`.

Per [`AGENTS.md`](../AGENTS.md): if you find related material anywhere outside
this repo, move it in here, add a row to the table below saying what it is and
where it came from, and commit it.

## Contents

| Item | Dated | What it is | Came from |
|---|---|---|---|
| `Hearthtree-H01-2026-09-10/` | 2026-09-10 | First proposed Hearthtree layout: coordinated seven-sheet plan/section package, editable Blender model, scripts, parameters, neutral review stills, recovery checkpoint and source/decision record. No app-state or app-feature change. | FL0 v4/v5 local and Drive sources; v10.9-v10.12 notes and actual Blender scene; local current-project revision 681 resolved through the app engine. |
| `peakhinge-freecad-claude-3d-house-design-bim-tp3xch/` | 2026-07-01 | Earlier full prototype: a Python/FreeCAD BIM pipeline with a Flask backend, an AI "design council" (architect, structural engineer, natural-building expert, permaculture, PM), design-intent schema + validator, and geometry/heuristic check suites. Superseded by the current Node/React app, but the council prompts, `design_intent/schema.json` and the checks are worth mining. Includes its own `AGENT_GUIDE.md`, `decisions.md`, `requirements.md`. | Downloads |
| `peakhinge_ph144_homestead_model_package.zip` | 2026-07-01 | PeakHinge 144 homestead model package. | Downloads |
| `Treehearth_House___Construction_Drawings.pptx` | 2026-07-02 | Treehearth House construction drawing set. | Downloads |
| `# Natural House Designer Layout/` | 2026-07-05 | UI/layout explorations for the designer: `Design System.dc.html`, `Layout Explorations.dc.html`, `Natural House Designer.dc.html`, plus a screenshot. | Downloads |
| `Natural House Designer.html` | 2026-07-05 | Single-file HTML prototype of the designer. | Downloads |
| `Claude Design House Builder App.pdf` | 2026-07-05 | Concept/spec document for the house builder app. | Downloads |
| `# House Design App Redesign.zip` | 2026-07-19 | Redesign exploration for the app. | Downloads |
| `house_design_studio/` | 2026-07-03 (last active commit) | The evolved continuation of the prototype above, after `peakhinge-freecad`'s 2026-07-27 restructuring split it out from the PeakHinge shelter workflow: a standalone Python/FreeCAD app that turns a brief into a parametric BIM house model, runs a 6-role AI "council of experts" in a self-revising loop, and produces PE-review-ready documentation (drawings, IFC/STEP, audit trail). Its own README still says "Active project," but it hasn't been touched since 2026-07-03 while this repo has had 70+ updates in the same window — superseded in practice, not just in an old snapshot. All 96 git-tracked files, copied exactly (no local cache/venv artifacts). | `peakhinge-freecad` repo, `house_design_studio/` (Daniel: "move all into one repo rather than two, not the freeCAD peak hinge repo," 2026-08-02) |

## Cleanup log

- **2026-08-02** — consolidated `house_design_studio/` in from the separate
  `peakhinge-freecad` repo per Daniel's direct request to bring everything
  into one repo. That repo's actual PeakHinge-shelter archive
  (`archive/peakhinge/`) was explicitly excluded per his own instruction and
  is untouched — this move only concerns the *other* project that repo held.
- **2026-07-31** — the two zip/folder pairs flagged above as "safe to delete
  once verified" were actually verified (full recursive content diff, byte-
  for-byte after accounting for this repo's own `.gitattributes` CRLF/LF
  normalization) and found genuinely identical. Both zips
  (`peakhinge-freecad-claude-3d-house-design-bim-tp3xch.zip`,
  `# Natural House Designer Layout.zip`) were deleted; the extracted folders
  stay as the reference copy. Also removed two dead root launcher scripts
  found during the same pass: `start-house-bim-studio.ps1` (called
  `npm run dev -- --port 5173`, a Vite-dev-only flow that no longer exists —
  `package.json`'s `dev` script is `node server.mjs`, and the port argument
  was silently ignored) and `start-planner-server-5178.ps1` (started a second,
  orphaned server instance on a port referenced nowhere else in the repo).

## Related material and current records

- House design decisions and live financial records are maintained in Photion. The repository AGENTS.md identifies House Design App as PRJ-911; the separate house subject key must be confirmed there. The former Notion hub is historical.
- Original house drawings remain in their local and Drive source locations. The H01 source/decision record lists exact inspected paths and access gaps. Original sources were preserved.

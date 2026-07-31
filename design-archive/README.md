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
| `peakhinge-freecad-claude-3d-house-design-bim-tp3xch/` | 2026-07-01 | Earlier full prototype: a Python/FreeCAD BIM pipeline with a Flask backend, an AI "design council" (architect, structural engineer, natural-building expert, permaculture, PM), design-intent schema + validator, and geometry/heuristic check suites. Superseded by the current Node/React app, but the council prompts, `design_intent/schema.json` and the checks are worth mining. Includes its own `AGENT_GUIDE.md`, `decisions.md`, `requirements.md`. | Downloads |
| `peakhinge_ph144_homestead_model_package.zip` | 2026-07-01 | PeakHinge 144 homestead model package. | Downloads |
| `Treehearth_House___Construction_Drawings.pptx` | 2026-07-02 | Treehearth House construction drawing set. | Downloads |
| `# Natural House Designer Layout/` | 2026-07-05 | UI/layout explorations for the designer: `Design System.dc.html`, `Layout Explorations.dc.html`, `Natural House Designer.dc.html`, plus a screenshot. | Downloads |
| `Natural House Designer.html` | 2026-07-05 | Single-file HTML prototype of the designer. | Downloads |
| `Claude Design House Builder App.pdf` | 2026-07-05 | Concept/spec document for the house builder app. | Downloads |
| `# House Design App Redesign.zip` | 2026-07-19 | Redesign exploration for the app. | Downloads |

## Cleanup log

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

## Related material that lives elsewhere on purpose

- **The house design itself** — MACH House v4/v5, Hearthtree House, FL0 House,
  the Homestead Master Specification — lives in Notion under 🏡 **07 — House**.
  Notion is the source of truth for the design program and decisions; this repo
  is the source of truth for the software.
- **The House domain Drive folder** is linked from the 07 — House page.

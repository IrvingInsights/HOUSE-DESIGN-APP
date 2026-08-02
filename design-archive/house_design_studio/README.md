# House Design Studio (Phase 1)

Turn a plain-language description — or a photo, sketch, or handwritten note — into
a parametric 3D BIM house model, run a **council of expert reviewers** in a
self-revising loop, and produce a **PE-review-ready** documentation package with
drawings, IFC/STEP exports, and a full audit trail.

> **This app cannot issue a Professional Engineer stamp.** No software can. It
> produces documentation formatted for a licensed PE (and, where required, a
> licensed Architect) to review and seal. A human professional must independently
> verify every assumption before anything is built. See the disclaimer in every
> generated report.

This is an independent app living under `house_design_studio/`. It shares no code
with the PeakHinge shelter workflow elsewhere in this repository.

## How it works

```
brief (text/images)
   │  translator (Claude)            → Design Intent (versioned JSON, the contract)
   ▼
 ┌──────────────── revision loop (max 5 iterations) ────────────────┐
 │  build (FreeCAD Arch/BIM)         → GeometryFacts                 │
 │  deterministic checks             → clashes, egress, spans, …     │
 │  council of 6 experts (Claude)    → structured findings           │
 │  synthesis (Claude)               → one prioritized action list   │
 │  stop if no high/medium items OR cap reached; else propose+apply  │
 │  a targeted patch and repeat (every revision saved to disk)       │
 └──────────────────────────────────────────────────────────────────┘
   ▼
 deliverables: TechDraw sheets (plan/elevations/section/roof), IFC + STEP,
 and the "Design Basis & PE-Review Package" (Markdown).
```

The six expert perspectives are **Architect**, **Structural / PE-perspective
Engineer**, **Designer / Artist** (which absorbs the "sculptor" viewpoint),
**Natural Building Expert**, **Permaculture / Homestead-Farm Expert**, and
**Project Manager** — condensed from the nine professions in the original brief
to keep Phase 1 tractable.

## Quick start (Windows — one click)

### Step 0 — install two things first (one-time)

1. **Python 3.10+** from <https://www.python.org/downloads/>. On the first
   install screen, **tick "Add python.exe to PATH"** before clicking Install —
   this is the single most common thing people miss, and without it the app
   cannot start.
2. **FreeCAD 1.0+** from <https://www.freecad.org/downloads.php> (for the 3D
   model and drawings).
3. A **Claude API key** from <https://console.anthropic.com/>.

### Then

1. Get the code onto your PC (clone the repo, or download it as a ZIP and unzip).
2. Open the `house_design_studio` folder and **double-click `START_HERE.bat`**
   (or `run.bat` — they do the same thing).
3. The first time, it installs everything (a couple of minutes) and asks you
   to paste your API key (saved locally, never shared).
4. Your browser opens to the app. Click **Use built-in sample** to confirm it
   works, then type your own description and press **Run design**.

`run.bat` finds your FreeCAD install automatically. If it can't (unusual
install location), it says so and you can paste the path to `FreeCADCmd.exe`
into `house_design_studio\.env` as `HDS_FREECAD_CMD=...`.

**If something goes wrong:** the window now **stays open** and prints what
happened instead of closing — read the message (it usually says exactly what
to do, e.g. "Python was not found"), fix it, and double-click `run.bat` again.
If it's still unclear, take a screenshot of the window's text.

**Desktop shortcut:** the first time you run `run.bat`, it adds a **House Design
Studio** shortcut (with the house icon) to your Desktop, so afterwards you can
launch the app with a double-click from there. If you'd rather create it
yourself, double-click `create_desktop_shortcut.bat`.

### Mac / Linux

Same idea: install FreeCAD + Python, then run `./house_design_studio/run.sh`.
On first run, edit `house_design_studio/.env` to add `ANTHROPIC_API_KEY=...`
(copy it from `.env.example`).

### Running without FreeCAD or a key (offline demo)

Set either flag in `house_design_studio\.env` (or your shell):

- `HDS_DEV_MODE_SKIP_FREECAD=1` — derive geometry in pure Python instead of
  FreeCAD. Drawings/IFC/STEP are marked "skipped" in the results.
- `HDS_DEV_MODE_MOCK_CLAUDE=1` — use scripted AI responses so the whole pipeline
  runs with **no API key**. The council raises no concerns, so the run converges
  on the automated checks alone. Good for demos and CI.

### Manual setup (if you prefer not to use the scripts)

```bash
python -m venv .venv
. .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r house_design_studio/requirements.txt
cp house_design_studio/.env.example house_design_studio/.env   # then add your key
python -m house_design_studio.backend.launch
```

## Testing

```bash
cd house_design_studio && python -m pytest
```

The automated suite covers everything that does not need FreeCAD or an API key:
schema validation, all deterministic checks, patch application, the revision-loop
control flow (with mocked stages), synthesis, report generation (including that
the PE disclaimer is always present), the job store, image prep, and an offline
end-to-end run through the API. The parts that need a real FreeCAD + API key are
verified by hand — see [`tests/manual/FREECAD_MANUAL_TEST_PLAN.md`](tests/manual/FREECAD_MANUAL_TEST_PLAN.md).

## Phase 1 scope, and what's next

**Phase 1 (this):** a single-story house on a rectangular footprint; gable or
shed roof; slab-on-grade foundation; six-role council; heuristic (rule-of-thumb,
non-code) structural and habitability checks. The Design Intent schema can
*express* more than the builder implements (multi-story, L-shapes, hip roofs,
basements); those are accepted by the schema but rejected with a clear error by
the builder, keeping the contract forward-compatible.

**Phase 2+ roadmap:** multi-story; arbitrary footprints; jurisdiction-specific
code databases; real engineering load calculations; MEP design; cost estimating;
and optional photorealistic rendering / IFC-native authoring (e.g. Blender +
Bonsai) alongside FreeCAD.

## Layout

| Path | Responsibility |
| --- | --- |
| `design_intent/` | The Design Intent schema (the core contract), validator, versioning |
| `translator/` | Brief (text + images) → Design Intent, via Claude |
| `bim_builder/` | `geometry_facts.py` (FreeCAD-free contract), `runner.py` (host-side), and the FreeCAD-side `build_house.py` / `techdraw_sheets.py` / `exporters.py` |
| `checks/` | Deterministic geometry + heuristic checks over GeometryFacts |
| `council/` | Six expert personas, per-role critique, fan-out |
| `synthesis/` | Reconcile council findings into one prioritized list |
| `revision/` | Patch apply, proposer, the loop `orchestrator.py`, job storage |
| `reporting/` | The PE-review package, the disclaimer, the artifact manifest |
| `backend/` | FastAPI app, config, job manager, routes |
| `frontend/` | Single-page vanilla UI |
| `llm/` | Injectable Anthropic client + scripted test double |

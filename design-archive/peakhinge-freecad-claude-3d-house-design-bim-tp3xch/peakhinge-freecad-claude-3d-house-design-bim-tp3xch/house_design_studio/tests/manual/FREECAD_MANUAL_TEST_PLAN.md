# Manual Test Plan — Full Pipeline on a FreeCAD Machine

The automated `pytest` suite runs everything that does **not** need FreeCAD or a
live Anthropic API key (schema, checks, revision-loop control flow, reporting,
offline end-to-end). This document covers what must be verified by hand on a
machine that has FreeCAD installed and an `ANTHROPIC_API_KEY`.

## Prerequisites

1. Install **FreeCAD 1.0+** (desktop). Confirm `FreeCADCmd` runs:
   - Windows: `"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe" --version`
   - macOS: `/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd --version`
   - Linux: `freecadcmd --version`
   If it is not on your `PATH`, set `HDS_FREECAD_CMD` to its full path.
2. `python -m venv .venv && . .venv/bin/activate` (or `.venv\Scripts\activate`).
3. `pip install -r house_design_studio/requirements.txt`
4. `export ANTHROPIC_API_KEY=sk-...` (do **not** commit this).
5. Do **not** set the `HDS_DEV_MODE_*` flags — you want the real path.

## Steps

1. **Start the app:** `./house_design_studio/run.sh` (or `run.bat`). Open
   `http://localhost:8000`. The mode hint should say "live AI and FreeCAD".
2. **Sample run:** click **Use built-in sample**. Watch the progress list step
   through build → checks → council → synthesis for each revision.
3. **Text brief:** enter a description (e.g. *"single-story 2-bedroom, ~10×7 m,
   shed roof sloping south, slab on grade, big south glazing"*). Run it and
   confirm the translated Design Intent is sensible (check
   `jobs/<id>/design_intent/v1.json`).
4. **Image brief:** upload a photo/sketch/handwritten floor plan and confirm the
   translator produces a plausible Design Intent.

## What to verify

- [ ] `jobs/<id>/model/house_v*.FCStd` opens in FreeCAD and shows walls,
      openings, a slab, and a roof in roughly the right places.
- [ ] `jobs/<id>/model/geometry_facts_v*.json` reflects the built model.
- [ ] **TechDraw sheets** (`jobs/<id>/drawings/`) render as PDFs for: floor plan,
      four elevations, at least one section, roof plan. *(This is the highest-risk
      area — headless TechDraw export varies by FreeCAD version. If PDFs are
      missing, open `techdraw_sheets.py` and adjust the page/template/export API
      to match your installed version, then record the working calls here.)*
- [ ] **IFC** (`export/house.ifc`) opens in an IFC viewer; **STEP**
      (`export/house.step`) opens in a CAD viewer.
- [ ] The **council** produces real findings from all six roles; a failing role
      degrades gracefully (its error appears in the transcript, others continue).
- [ ] The **synthesis** step yields a sensible prioritized list and flags any
      genuine architect-vs-engineer conflicts.
- [ ] The **revision loop** iterates and either converges or stops at the cap,
      with one Design Intent snapshot per revision on disk (nothing overwritten).
- [ ] The final **Design Basis & PE-Review Package**
      (`report/design_basis_package.md`) is complete and contains the PE
      disclaimer at top and bottom.
- [ ] The results view lists every artifact with working download links.

## Record findings

Note the exact FreeCAD version tested and any Arch/TechDraw/IFC API adjustments
required, so they can be folded back into `bim_builder/`.

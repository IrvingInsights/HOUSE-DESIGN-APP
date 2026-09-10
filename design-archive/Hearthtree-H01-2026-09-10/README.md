# Hearthtree H01 - first layout review

Open **Hearthtree-H01-Review.pdf** first. Phone-viewable drawings and images are in `previews/` and `renders/`.

This package proposes a two-bedroom main floor, central hearth and stair, upper retreat and full deck ring. It is not an approved layout or construction set. Read `SOURCE-AND-DECISION-RECORD.md` for sources, changed assumptions and remaining conflicts.

## Editable files

- `Hearthtree-H01.blend`: named collections, meter mesh coordinates with Imperial display; +Y is north. Requires Blender 5.1 or a compatible later version.
- `geometry.json`: every generated mesh, opening, room label and sampled route, in feet.
- `parameters.json`: baseline design dimensions; see the layout-specific regeneration limitation in the source/decision record.
- `build_geometry.py`: creates common geometry, using standard Python.
- `build_blender.py`: creates the .blend and optional review frames. Uses Blender's bundled Python, no add-ons.
- `verify_blender.py`: reopens and compares the saved native meshes with the drawing source.
- `check_geometry.py`: numerical checks using standard Python.
- `make_package.py`: PDF from the common geometry; needs ReportLab. DejaVu Sans is used when available, Helvetica otherwise.

## Regenerate

Run commands from this folder, after preserving any edited .blend. Regeneration replaces the output model; direct Blender edits are not reverse-imported to the script.

```bash
python build_geometry.py
python check_geometry.py
blender --background --factory-startup --python build_blender.py -- --render
blender --background --factory-startup Hearthtree-H01.blend --python verify_blender.py
python make_package.py
```

`geometry-checks.json` contains actual results and their scope. This is a concept geometry check, not a structure, fire, accessibility or permitting approval. Native Blender readback is recorded in `blender-readback.json` when present.

The article's later material-development and video-tour steps are intentionally after the layout decision. Existing app state and archived source models remain unchanged.

GitHub destination: [IrvingInsights/HOUSE-DESIGN-APP](https://github.com/IrvingInsights/HOUSE-DESIGN-APP), verified public. Local review branch: `design/hearthtree-h01-20260910`; initial artifact commit `c96647f`. Automatic approval review rejected the push because explicit approval is required to publish these drawings and the editable house model publicly. The branch has not been pushed and no pull request exists. App update number remains 250 because this is an archived house proposal with no application changes.

After Daniel explicitly approves public publication, push from the canonical repository with `git push -u origin design/hearthtree-h01-20260910`, then open a draft pull request to main. Do not merge as part of that step.

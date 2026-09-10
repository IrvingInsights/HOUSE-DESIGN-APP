# Hearthtree H01 - source and decision record

Prepared 10 September 2026 for Daniel Irving. Concept for layout review.
No layout choice has been approved by Daniel in this session.

## What supplies each part

| Part | Source | What is carried forward |
|---|---|---|
| Overall composition | FL0 v4/v5 | South greenhouse, south-high shed, open living/kitchen, east tower and outdoor work edge. |
| Hearth and stair | FL0 v10.9 through v10.12 | Masonry-heater intent, kitchen/fire-view relationship, explicit flights and landings, floor openings, separate chimney and structure. Exact stair geometry is rebuilt. |
| Tower deck | Local current-project revision 681 | Four connected deck fields around an upper work room. Topology is retained; size and height are redesigned. |

## Files actually inspected

1. `C:\Users\danir\Downloads\House-and-App-Development-Map.html` - development map read in full relevant house/app narrative.
2. `C:\Users\danir\HOUSE-DESIGN-APP\AGENTS.md` - repository instructions. Identifies the app project as PRJ-911; this does not establish the separate house-design project key.
3. `C:\Users\danir\Documents\Codex\2026-06-21\i-was-working-in-codex-on\FL0-House-v4.0-Shed-Roof-Tower-Studio\README.md` and `fl0_house_v4_shed_roof_tower_studio.py` - README and relevant geometry constants inspected. The source script places the tower floor at 14 ft, despite older 10 ft labels elsewhere.
4. [FL0 v5 complete drawing set](https://drive.google.com/file/d/1auCON0sDzA3SVTjX8lxXquPis07vLSnQ/view) - complete extracted PDF text inspected. Main shell 24 x 28 ft; tower 10 x 8 ft; L-shaped perch; inconsistent tower-roof labels within the set. Its stove substitution and slab-only assumption are not adopted.
5. [v10.9 hearth/kitchen notes](https://drive.google.com/file/d/1aiOhr1-5Ns94ik3Ny8_SEfjJb1IcKkd8/view), [v10.10 headroom notes](https://drive.google.com/file/d/11Mj0ri0M0fSBOV8i_IHCYn1gY6lxh76k/view), [v10.11 three-flight notes](https://drive.google.com/file/d/17n76tfI9nb0co-ln3PHBy7Hsrcy73ZyU/view) - inspected as historical evidence of issues and revisions, not accepted engineering.
6. [v10.3 heater-basis notes](https://drive.google.com/file/d/1P4yX_envgYSlwCRG_K1zQu6_D3TfOxjY/view) and [v9 stair/tower/stack review](https://drive.google.com/file/d/1UhYs--3eSp0QNQehZLb-sbxu_bEuwpEH/view) - read for prior clash history. Historical product clearances and code claims were not treated as current verified requirements.
7. [v10.12 geometry JSON](https://drive.google.com/file/d/10i0FDH_OB0937ZP4fYjvnZ6aaOWNhXWk/view) - 198 exported product bounding boxes, in feet, inspected locally.
8. [Actual v10.12 Blender file](https://drive.google.com/file/d/1QPrBk_Jrh9XzP4bNZdPScHpqSuvzKKus/view) - opened read-only in Blender 5.1.2 on the PC. The scene contains 230 mesh objects; world coordinates are meters with Imperial display. Tower platform top is 3.6576 m = 12 ft. Existing perch slabs run from 12 to 12.35 ft; they remain an L, not a ring. The file was copied into a scratch review folder; the source was not saved over. This inspection was programmatic; it was not a visual inspection of every original scene object.
9. `C:\Users\danir\HOUSE-DESIGN-APP\.data\projects\current-project\project-state.json` - actual revision 681 inspected. Shell 36 x 36 ft, 3 storeys; office 18 x 18 ft at level 3; four deck fields. `storeyElevationFt` returned 0, 20, 30 ft. `resolveDeck` returned `topFt: 30.18` for all four upper deck fields despite raw `z: 16`. The new house does not inherit these storey heights.
10. [GitHub repository at 986836c](https://github.com/IrvingInsights/HOUSE-DESIGN-APP/tree/986836ce957e3bcdaf8c34ac506b8aa9c6dfab15) - complete tree and archive index read through GitHub; local `backend/bim-core.mjs` and `src/engine.js` were used for the elevation/deck evaluation. No application feature was changed.
11. User-attached *Architectural visualization with Astra* article, also [published by OpenAI](https://developers.openai.com/blog/architectural-visualization-with-astra) - read. Its editable model / render / inspect approach is the workflow reference, not a design precedent for the house's style.

Specific gaps: the early earth-sheltered illustration and March elevation were identified in Drive but not visually inspected in this turn. The v4 FreeCAD binary was located but not opened in FreeCAD. The v5 PDF was inspected as extracted text, not as a newly rendered page set. No site survey, current Photion project record or live budget was available. No claim is made that every archive model was inspected.

## H01 proposals and their consequences

| Decision | H01 recommendation | Consequence / review |
|---|---|---|
| Room program | Two main-level bedrooms, one full bath, mudroom, laundry/services, kitchen, living/dining, pantry; upper work/reading room. | v5 supports two bedrooms; r681 contains three. Household need is not settled. |
| Main footprint | 33 x 34 ft external, 12 in envelope allowance. | 1,122 sq ft vs 672 sq ft in v4/v5: 450 sq ft / about 67% larger. This is an explicit proposed increase to fit usable rooms and the stair, not an approved size. |
| Tower | 17 x 17 ft external at +16 ft, with about 143 sq ft of actual internal floor after voids. | Larger than the early tower, smaller than r681's office footprint. A useful room remains after the stair opening. |
| Stair | 27 equal 7.11 in risers, 11 in goings, three straight flights. | Two 42 in landings at +5 ft 4 in and +10 ft 8 in; no extra full middle storey. Daily life stays downstairs. |
| Deck | Four fields form a 29 x 29 ft outer ring around the 17 ft tower. | 552 sq ft of outdoor floor; nominal 6 ft depth, approximately 5 ft 8 in inside guard. The most significant complexity and scope item. |
| Roof | South-high main and tower sheds; keep deck above roof. | Main roof high 12 ft / low 9 ft 6 in. Reduced height helps modest scope. Low-slope metal system must be specified and reviewed; roof drainage is a concept, not a finished detail. |
| East-high comparison | Considered but not recommended. | Does not reduce the tower stair climb. It lowers the west part of the south glazing band and makes the greenhouse junction vary across the facade. This is a qualitative comparison, not solar simulation. |
| Hearthtree | Separate masonry-heater envelope, earthen fin, timber bearing member and chimney. | Heater/cook/bake configuration, mass, fire clearances, combustion air and foundations remain unresolved. Decorative form is an early placeholder. |
| Foundation | Support zones only; basement/walkout remains open. | No invented slope, no assumed financing rule and no claim that a basement fits a selected property. |
| Envelope | Framed infill within a 12 in allowance is the simpler starting point; straw bale remains an option. | A thicker chosen assembly requires a new dimensional pass so rooms do not shrink unnoticed. |

## Complexity record

| Element | Relative complexity | Simplification opportunity that preserves intent |
|---|---|---|
| Full ring deck over occupied rooms | High | Regular supports, repeated bays, restrained finishes; engineer waterproof interfaces before detailing. Keep ring intact while testing scope. |
| Tower/stair enclosure | Moderate-high | Three equal flights, rectangular openings and one upper room. No separate habitable intermediate loft. |
| Hearth/chimney | High until specified | Use a verified heater/oven system and a straight chimney; keep decorative work independent. |
| Main house/finishes | Moderate | One rectangular main floor, one bath, clustered wet services and a simpler infill envelope. |
| Greenhouse | Moderate | Repeated glazing modules, explicit thermal separation and independent vents. |
| Outdoor work and cooking | Low-moderate | One simple east canopy; cooking stays in open air; reserve more elaborate outbuildings. |

## Corrections made during this pass

- Moved deck posts into growing-bed / partition zones so they did not occupy greenhouse door routes or the bedroom hall. South outriggers and cantilevered side beams are explicit structural concepts.
- Broke greenhouse beds at the living and kitchen door approaches.
- Corrected entry, mudroom and bath door hands and relocated the mud bench.
- Moved the pantry onto the south wall to preserve kitchen-facing heater access.
- Made actual stair and chimney holes in both mesh model and derived drawings.
- Added consistent risers, landings and guards; retained an explicit chimney opening.
- Improved the cutaway by clipping the actual geometry in the temporary render view. The saved .blend remains intact.
- Changed the interior review camera and added labeled temporary evaluation lights after the first interior preview was too dark. These images are not daylight simulations.
- Corrected sheet overlaps after rendering the first PDF.
- Assigned unique object names and removed coincident tread/riser and outrigger faces after native readback and preview inspection. Final readback agrees for all 960 meshes; maximum coordinate difference is 0.00000155 ft.
- Ran the repository design-space gate: 14,890 passed, 0 failed. No app code, update stamp, server or live model was changed. Browser fuzz and bim-core smoke tests were not run because no app changes are being shipped.

See `geometry-checks.json` for the bounded numerical review. Final samples show no obstructions in the four tested 24 in body-envelope routes and no low stair/furniture intrusion into the reserved 4 ft hearth-front zone. These do not establish comprehensive wheelchair access, every possible furniture clearance or construction compliance.

## Model and export limits

The `.blend` is a concept model with named collections and real openings. The PDF sections and plans slice/project the same `geometry.json` used to create every Blender mesh. Furniture is dimensioned block geometry; materials are neutral review materials. No detailed joinery, completed heater design, site grading, load calculation or moisture/energy model is provided.

`parameters.json` is the baseline dimension ledger. `geometry.json` contains every editable vertex and object attribute. The regeneration script is specific to this proposed layout: it is not an automatic room-layout solver. Altering footprint, tower size, wall thickness or room coordinates requires coordinated updates to the generator and another geometry check. Roof profiles and stair values are exposed in the parameter file, but independent dimensional changes should not be assumed to resolve all dependent geometry automatically.

Detailed natural materials, landscaping, ordinary household objects and a finished eye-level walkthrough video follow layout selection, as requested. This first package contains review stills and a saved set of cameras, not that final film. No Unreal export or interactive walkthrough is claimed.

## Next decision

Daniel should review the proposed two-bedroom main floor and the amount of tower/deck area. If three bedrooms are necessary, resolve that requirement before detailing finishes or producing the walkthrough. Then develop the selected layout, roof/deck interfaces and heater system in the same model.

## Photion

Photion tools were not exposed in this session, including after the @PHOTION mention. No `system_health`, `orient`, vocabulary, write or `record_snapshot` call was possible. The app repository identifies PRJ-911; the separate house-design project key must be confirmed from orient output. No financial records were retrieved or copied. See `PHOTION-HANDOFF.md`.

## GitHub publication status

The reviewed artifact files were committed locally on `design/hearthtree-h01-20260910` (initial commit `c96647f`). All 31 staged artifact files matched the reviewed bytes. The destination was verified as Daniel's specified `IrvingInsights/HOUSE-DESIGN-APP` repository, which is public. Automatic approval review rejected the push, stating that publishing the drawings and editable Blender model needs explicit public-publication authorization. No push or pull request has been made. The complete package remains available locally and as the delivered files. Publication is pending Daniel's approval; original model files and the app's current state were not changed.

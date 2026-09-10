# Hearthtree H03 — tower forward over the southeast corner

Daniel's decision, 10 September 2026: **“offset tower yes. Set forward, over the SE corner.”** H03 implements that placement. H02's northeast position is superseded; H01 remains rejected and recoverable.

The tower's south wall now aligns with the main south wall, and its east wall aligns with the main east wall. Relative to H02, the tower moves 13 ft south and 2 ft west. North is +Y; east is +X. Coordinates start at the main house's southwest exterior corner. Parameters use feet; Blender mesh coordinates use meters.

## Placement and consequences

| Item | H03 study geometry | Status |
|---|---|---|
| Tower location | Southwest corner at X=14, Y=0; northeast corner X=30, Y=14 | Forward southeast placement selected by Daniel; exact dimensions remain proposed |
| Main enclosure | 30 × 32 ft external; 960 sq ft gross footprint | H02 study size retained; not an approved room program |
| Tower enclosure | 16 × 14 ft external; 224 sq ft gross footprint | H02 study size retained; usable floor area not established |
| Full deck ring | Nominal 6 ft on all four sides; outer rectangle 28 × 26 ft; 504 sq ft | Full ring retained; guards reduce clear width slightly |
| Deck elevation | +19 ft from main floor | Raised 18 in from H02 to clear the forward shed roof; longer stair climb unresolved |
| Main shed roof | +16 ft south, +10 ft north; south eave +16.1875 ft | South-high direction retained |
| Lowest modeled deck beam | Underside +17.33 ft | Provisional framing depth; about 13.7 in above the highest main roof beneath the deck |
| Upper south glazing | Sill +10.6 ft; head +13.7 ft | Physical separation remains; seasonal shading and energy performance not evaluated |
| Greenhouse | 24 × 8 ft; roof +9.25 ft rear / +7.25 ft front | Full deck projects above its eastern portion |
| Greenhouse support penetration | One nominal 6 in deck post through a 0.9 ft square roof opening | Actual glass opening and curb modeled; flashing, loads and column stability unresolved |

The southwest deck post now occupies the edge of a greenhouse bench, not the main aisle. That bench is shortened by 6 in, leaving a modeled 3 in horizontal separation from the post. The greenhouse roof glass is split around the post; the curb is an inspectable concept, not a weatherproof detail. The repeated greenhouse sash includes a rafter at this location: the rafter/post joint remains a structural detail to resolve.

The existing heater planning box stays near the center of the main house, behind the forward tower. The straight chimney envelope remains separate and extends to +31 ft; the main roof has a modeled penetration. Heater sizing, clearances, maintenance space, timber separation, roof flashing, chimney bracing and foundation loads remain unverified. No chimney-rule or clearance compliance is asserted.

## What this deliverable establishes

H03 is an **exterior placement study**, with three views rendered from the saved editable Blender scene. It is not the replacement coordinated floor-plan package. It does not have main-floor partitions, a resolved stair or an upper interior floor. The empty upper floor reservation is identified in the model's review collection. Do not infer a usable access route from the exterior door.

The next plan must resolve the actual stair climb and upper usable room together with the main-floor kitchen, hearth, bedrooms, bath and service spaces. Revision 681's three-bedroom evidence still matters. No new bedroom count, basement arrangement, stair form or household program has been selected. The H02/H03 envelope dimensions cannot be treated as fixed if those requirements do not fit.

Qualitative complexity: the full ring is substantial outdoor space, and the forward location adds greenhouse overlap, a roof penetration and a taller climb. The south-high shed remains legible on the west and north sides. Structural sizing, bracing and complete support routes need development. Reducing tower elevation would require a coordinated reduction/reworking of the main roof and upper glazing; moving the tower back would contradict Daniel's latest placement decision.

## Source lineage

| Reference | Retained | Changed or unresolved |
|---|---|---|
| FL0 v4/v5 | Compact distinct tower, southeast emphasis, attached greenhouse, south-high shed and timber expression | Historical tower/roof intersections were not verified as buildable; exact sizes not adopted |
| FL0 v9/v10–v10.12 | Central heater/chimney/stair relationship and headroom studies remain the core reference | H03 has not resolved a new hearth/stair layout at this location |
| Local current-project r681 | Four deck sections forming a full ring | 36 × 36 ft shell and 18 × 18 ft office not adopted; source deck top resolved through the engine to 30.18 ft, not its raw z=16 |

Inspected source paths and identifiers:

- `C:\Users\danir\Documents\Codex\2026-06-21\i-was-working-in-codex-on\FL0-House-v4.0-Shed-Roof-Tower-Studio\preview\FL0-HOUSE-v4.0-A202-exterior-character-elevations.png`
- [FL0 v5 complete drawing set](https://drive.google.com/file/d/1auCON0sDzA3SVTjX8lxXquPis07vLSnQ/view), actual PDF downloaded and ground plan/section visually inspected.
- [FL0 v10.12 Blender source](https://drive.google.com/file/d/1QPrBk_Jrh9XzP4bNZdPScHpqSuvzKKus/view), actual scene inspected programmatically; no claim that its rendered appearance was reviewed.
- `C:\Users\danir\HOUSE-DESIGN-APP\.data\projects\current-project\project-state.json`, actual r681 source inspected and deck elevation conversion verified during H01 investigation.
- [March south elevation](https://drive.google.com/file/d/13pILsU8CvAlt_PTNbj6ndJfJu3zMZlsi/view) and [archived greenhouse section](https://drive.google.com/file/d/17FDspEl7LHAgSohQTjZWUzYezof9CoP6/view), actual images inspected. Historical site captions are not adopted as a selected property.
- Full preceding inspection/change record: `C:\Users\danir\HOUSE-DESIGN-APP\design-archive\Hearthtree-H01-2026-09-10\SOURCE-AND-DECISION-RECORD.md`.

## Edit and regenerate

Open `Hearthtree-H03-Form-Study.blend` directly. For regeneration with Blender 5.1, keep `H03_form_study.py` beside `parameters.json` and run:

```sh
blender --background --factory-startup --python-exit-code 1 --python H03_form_study.py
```

The script rebuilds this study in its own output folder. Primary dimensions are parameters; sash, furniture and some detail coordinates remain scripted. Copy the folder before creating H04 so this version stays recoverable. No external assets or add-ons are required. The named collections separate site, foundation, frame, envelope, greenhouse, hearth/chimney, stairs, tower, decks, openings, furniture, services and review items.

`verify_h03.py` reopens the saved native file and checks the four deck levels and beam underside within 0.00001 ft. `geometry-checks.json` records measurements and limitations. The initial strict equality check failed on Blender's approximately 0.00000053 ft floating-point representation error; it was corrected to a stated tolerance after inspecting the actual native coordinates. The geometry was unchanged. The three rendered views were visually inspected.

The app's current project and app features were not edited. H02 and H03 are preserved in the canonical repository on the local design branch. Public GitHub publication remains blocked by automatic approval review because the repository is public and explicit permission to publish the house files was not provided. No public push was retried for this placement change. Photion contains the live financial records; none were copied.


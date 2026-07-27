"""FreeCAD-side script: generate dimensioned TechDraw sheets and export to PDF.

    FreeCADCmd -c techdraw_sheets.py <house.FCStd> <out_dir>

Emits a final JSON line mapping sheet name -> output path (or null).

HIGHEST-RISK AREA: generating and exporting TechDraw pages headless (no GUI)
differs across FreeCAD versions and can require the technical-drawing template
to be resolved explicitly. Verify against the installed version per
tests/manual/FREECAD_MANUAL_TEST_PLAN.md. Each sheet is wrapped so that one
failing view does not prevent the others.
"""

import json
import os
import sys

# (view name, projection direction vector, is_section)
_SHEETS = [
    ("floor_plan", (0, 0, 1), False),
    ("roof_plan", (0, 0, 1), False),
    ("elevation_north", (0, 1, 0), False),
    ("elevation_south", (0, -1, 0), False),
    ("elevation_east", (1, 0, 0), False),
    ("elevation_west", (-1, 0, 0), False),
    ("section_a", (0, -1, 0), True),
]


def main(argv):
    fcstd_path, out_dir = argv[0], argv[1]
    os.makedirs(out_dir, exist_ok=True)

    import FreeCAD
    import Draft  # noqa: F401
    import TechDraw

    doc = FreeCAD.openDocument(fcstd_path)
    shapes = [o for o in doc.Objects if hasattr(o, "Shape") and o.Shape]

    results = {}
    for name, direction, is_section in _SHEETS:
        path = os.path.join(out_dir, name + ".pdf")
        try:
            page = doc.addObject("TechDraw::DrawPage", "page_" + name)
            template = doc.addObject("TechDraw::DrawSVGTemplate", "tmpl_" + name)
            page.Template = template
            if is_section:
                view = doc.addObject("TechDraw::DrawViewSection", "view_" + name)
            else:
                view = doc.addObject("TechDraw::DrawViewPart", "view_" + name)
            view.Source = shapes
            view.Direction = FreeCAD.Vector(*direction)
            page.addView(view)
            doc.recompute()
            TechDraw.writePageAsPdf(page, path) if hasattr(
                TechDraw, "writePageAsPdf"
            ) else page.exportPdf(path)
            results[name] = path if os.path.exists(path) else None
        except Exception as exc:  # noqa: BLE001
            FreeCAD.Console.PrintWarning("Sheet %s failed: %s\n" % (name, exc))
            results[name] = None

    print(json.dumps(results))


if __name__ == "__main__":
    main(sys.argv[1:])

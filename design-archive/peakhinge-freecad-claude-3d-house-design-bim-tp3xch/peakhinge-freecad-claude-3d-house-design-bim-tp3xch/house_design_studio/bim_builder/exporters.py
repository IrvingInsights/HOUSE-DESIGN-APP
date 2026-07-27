"""FreeCAD-side script: export the model to IFC and STEP.

    FreeCADCmd -c exporters.py <house.FCStd> <out_dir>

Emits a final JSON line: {"ifc": path|null, "step": path|null}.
"""

import json
import os
import sys


def main(argv):
    fcstd_path, out_dir = argv[0], argv[1]
    os.makedirs(out_dir, exist_ok=True)

    import FreeCAD
    import Part

    doc = FreeCAD.openDocument(fcstd_path)
    objects = list(doc.Objects)
    results = {"ifc": None, "step": None}

    # --- IFC (Arch/BIM native exporter) ----------------------------------- #
    ifc_path = os.path.join(out_dir, "house.ifc")
    try:
        try:
            import exportIFC  # FreeCAD >= 0.19
        except ImportError:
            from importers import exportIFC  # older layouts
        exportIFC.export(objects, ifc_path)
        results["ifc"] = ifc_path if os.path.exists(ifc_path) else None
    except Exception as exc:  # noqa: BLE001
        FreeCAD.Console.PrintWarning("IFC export failed: %s\n" % exc)

    # --- STEP -------------------------------------------------------------- #
    step_path = os.path.join(out_dir, "house.step")
    try:
        shapes = [o for o in objects if hasattr(o, "Shape") and o.Shape]
        Part.export(shapes, step_path)
        results["step"] = step_path if os.path.exists(step_path) else None
    except Exception as exc:  # noqa: BLE001
        FreeCAD.Console.PrintWarning("STEP export failed: %s\n" % exc)

    print(json.dumps(results))


if __name__ == "__main__":
    main(sys.argv[1:])

"""FreeCAD-side script: build a parametric BIM house from a Design Intent.

Runs ONLY inside FreeCADCmd:  FreeCADCmd -c build_house.py <intent.json>
<out.FCStd> <facts.json>

It is intentionally self-contained — stdlib + the FreeCAD API only — because
FreeCAD's bundled Python does not have this project's third-party packages
(pydantic etc.). It reads the Design Intent as a plain dict and writes a
GeometryFacts-shaped dict, so the host-side pipeline consumes identical facts
whether they came from here or from the pure-Python dev builder.

Units: the Design Intent is in metres; FreeCAD Arch works in millimetres, so
lengths are multiplied by 1000 on the way in.

NOTE: Arch/BIM and especially headless TechDraw APIs vary between FreeCAD
versions. Verify against the installed version (see tests/manual/
FREECAD_MANUAL_TEST_PLAN.md); this is the highest-risk integration area.
"""

import json
import sys

M = 1000.0  # metres -> millimetres


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _roof_faces(intent):
    fp = intent["footprint"]
    w, d = fp["width_m"], fp["depth_m"]
    o = intent["roof"].get("overhang_m", 0.0)
    x0, y0, x1, y1 = -o, -o, w + o, d + o

    def rect(a, b, c, e):
        return [[a, b], [c, b], [c, e], [a, e]]

    if intent["roof"]["roof_type"] == "gable":
        if intent["roof"].get("ridge_orientation") == "parallel_to_width":
            ymid = d / 2.0
            return [
                {"id": "roof_face_1", "projected_polygon": rect(x0, y0, x1, ymid),
                 "projected_area_m2": (x1 - x0) * (ymid - y0)},
                {"id": "roof_face_2", "projected_polygon": rect(x0, ymid, x1, y1),
                 "projected_area_m2": (x1 - x0) * (y1 - ymid)},
            ]
        xmid = w / 2.0
        return [
            {"id": "roof_face_1", "projected_polygon": rect(x0, y0, xmid, y1),
             "projected_area_m2": (xmid - x0) * (y1 - y0)},
            {"id": "roof_face_2", "projected_polygon": rect(xmid, y0, x1, y1),
             "projected_area_m2": (x1 - xmid) * (y1 - y0)},
        ]
    return [{"id": "roof_face_1", "projected_polygon": rect(x0, y0, x1, y1),
             "projected_area_m2": (x1 - x0) * (y1 - y0)}]


def _facts_from_intent(intent):
    fp = intent["footprint"]
    return {
        "source_revision": intent.get("revision", 1),
        "footprint_width_m": fp["width_m"],
        "footprint_depth_m": fp["depth_m"],
        "ceiling_height_m": fp["wall_height_m"],
        "walls": [
            {"id": w["id"], "start": w["start"], "end": w["end"],
             "height_m": w["height_m"], "thickness_m": w["thickness_m"],
             "wall_type": w.get("wall_type", "exterior_bearing")}
            for w in intent.get("walls", [])
        ],
        "openings": [
            {"id": o["id"], "host_wall_id": o["host_wall_id"],
             "opening_type": o.get("opening_type", "window"),
             "width_m": o["width_m"], "height_m": o["height_m"],
             "sill_height_m": o.get("sill_height_m", 0.0),
             "position_along_wall_m": o.get("position_along_wall_m", 0.0),
             "egress_rated": o.get("egress_rated", False)}
            for o in intent.get("openings", [])
        ],
        "rooms": [
            {"id": r["id"], "name": r.get("name", ""),
             "room_type": r.get("room_type", "other"),
             "polygon": r.get("polygon", []),
             "min_ceiling_height_m": r.get("min_ceiling_height_m", 2.4)}
            for r in intent.get("rooms", [])
        ],
        "roof_faces": _roof_faces(intent),
        "slabs": [{"id": "slab_1",
                   "polygon": [[0, 0], [fp["width_m"], 0],
                               [fp["width_m"], fp["depth_m"]], [0, fp["depth_m"]]],
                   "thickness_m": intent["foundation"].get("slab_thickness_m", 0.1)}],
        "produced_by": "freecad",
        "notes": [],
    }


def build_model(intent, fcstd_path):
    """Construct the Arch/BIM model and save it. Returns the FreeCAD document."""
    import FreeCAD
    import Arch
    import Draft
    import Part  # noqa: F401

    doc = FreeCAD.newDocument("house")
    fp = intent["footprint"]

    # --- Slab ------------------------------------------------------------- #
    slab = Arch.makeStructure(
        length=fp["width_m"] * M,
        width=fp["depth_m"] * M,
        height=intent["foundation"].get("slab_thickness_m", 0.1) * M,
    )
    slab.Placement.Base = FreeCAD.Vector(
        fp["width_m"] * M / 2.0, fp["depth_m"] * M / 2.0,
        -intent["foundation"].get("slab_thickness_m", 0.1) * M,
    )

    # --- Walls ------------------------------------------------------------ #
    wall_objs = {}
    for w in intent.get("walls", []):
        p0 = FreeCAD.Vector(w["start"][0] * M, w["start"][1] * M, 0)
        p1 = FreeCAD.Vector(w["end"][0] * M, w["end"][1] * M, 0)
        line = Draft.makeLine(p0, p1)
        wall = Arch.makeWall(
            line, width=w["thickness_m"] * M, height=w["height_m"] * M
        )
        wall.Label = w["id"]
        wall_objs[w["id"]] = wall
    doc.recompute()

    # --- Openings (best-effort; see module note on API variance) ---------- #
    for o in intent.get("openings", []):
        host = wall_objs.get(o["host_wall_id"])
        if host is None:
            continue
        try:
            win = Arch.makeWindowPreset(
                "Fixed" if o.get("opening_type") == "window" else "Simple door",
                width=o["width_m"] * M,
                height=o["height_m"] * M,
                h1=100, h2=100, h3=100, w1=100, w2=100, o1=0, o2=100,
                placement=None,
            )
            win.Hosts = [host]
            win.Label = o["id"]
        except Exception as exc:  # noqa: BLE001
            FreeCAD.Console.PrintWarning(
                "Opening %s could not be created: %s\n" % (o["id"], exc)
            )
    doc.recompute()

    # --- Roof ------------------------------------------------------------- #
    try:
        base = Draft.makeRectangle(fp["width_m"] * M, fp["depth_m"] * M)
        doc.recompute()
        roof = Arch.makeRoof(base)
        roof.Label = "roof"
    except Exception as exc:  # noqa: BLE001
        FreeCAD.Console.PrintWarning("Roof could not be created: %s\n" % exc)
    doc.recompute()

    doc.saveAs(fcstd_path)
    return doc


def main(argv):
    intent_path, fcstd_path, facts_path = argv[0], argv[1], argv[2]
    intent = _load(intent_path)

    facts = _facts_from_intent(intent)
    try:
        build_model(intent, fcstd_path)
    except Exception as exc:  # noqa: BLE001
        # Emit facts anyway so the pipeline can proceed and report the failure.
        import FreeCAD  # type: ignore
        FreeCAD.Console.PrintError("build_model failed: %s\n" % exc)
        facts["notes"].append("FreeCAD build raised: %s" % exc)

    with open(facts_path, "w", encoding="utf-8") as f:
        json.dump(facts, f, indent=2)
    print(json.dumps({"ok": True, "facts": facts_path, "fcstd": fcstd_path}))


if __name__ == "__main__":
    main(sys.argv[1:])

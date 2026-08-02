"""Derive GeometryFacts from a Design Intent in pure Python — no FreeCAD.

This is the geometry the dev-mode builder produces so the whole pipeline
(checks, council, synthesis, revision, reporting) can run without FreeCAD
installed. On a real machine the FreeCAD-side ``build_house.py`` produces the
equivalent facts by walking the Arch model it actually built; both emit the same
:class:`GeometryFacts` contract, so downstream code is identical.
"""

from __future__ import annotations

from ..design_intent.schema import DesignIntent, RidgeOrientation, RoofType
from .geometry_facts import (
    FloorSlabFact,
    GeometryFacts,
    OpeningFact,
    RoofFaceFact,
    RoomFact,
    WallFact,
)


def _rect(x0: float, y0: float, x1: float, y1: float):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _roof_faces(intent: DesignIntent) -> list[RoofFaceFact]:
    w = intent.footprint.width_m
    d = intent.footprint.depth_m
    o = intent.roof.overhang_m
    x0, y0, x1, y1 = -o, -o, w + o, d + o
    full_area = (x1 - x0) * (y1 - y0)

    if intent.roof.roof_type == RoofType.gable:
        if intent.roof.ridge_orientation == RidgeOrientation.parallel_to_width:
            ymid = d / 2.0
            return [
                RoofFaceFact(id="roof_face_1", projected_polygon=_rect(x0, y0, x1, ymid),
                             projected_area_m2=(x1 - x0) * (ymid - y0)),
                RoofFaceFact(id="roof_face_2", projected_polygon=_rect(x0, ymid, x1, y1),
                             projected_area_m2=(x1 - x0) * (y1 - ymid)),
            ]
        xmid = w / 2.0
        return [
            RoofFaceFact(id="roof_face_1", projected_polygon=_rect(x0, y0, xmid, y1),
                         projected_area_m2=(xmid - x0) * (y1 - y0)),
            RoofFaceFact(id="roof_face_2", projected_polygon=_rect(xmid, y0, x1, y1),
                         projected_area_m2=(x1 - xmid) * (y1 - y0)),
        ]

    # Shed (and any other single-plane case handled here) — one face.
    return [
        RoofFaceFact(
            id="roof_face_1",
            projected_polygon=_rect(x0, y0, x1, y1),
            projected_area_m2=full_area,
        )
    ]


def design_intent_to_facts(intent: DesignIntent) -> GeometryFacts:
    walls = [
        WallFact(
            id=w.id, start=w.start, end=w.end, height_m=w.height_m,
            thickness_m=w.thickness_m, wall_type=w.wall_type.value,
        )
        for w in intent.walls
    ]
    openings = [
        OpeningFact(
            id=o.id, host_wall_id=o.host_wall_id, opening_type=o.opening_type.value,
            width_m=o.width_m, height_m=o.height_m, sill_height_m=o.sill_height_m,
            position_along_wall_m=o.position_along_wall_m, egress_rated=o.egress_rated,
        )
        for o in intent.openings
    ]
    rooms = [
        RoomFact(
            id=r.id, name=r.name, room_type=r.room_type.value,
            polygon=list(r.polygon), min_ceiling_height_m=r.min_ceiling_height_m,
        )
        for r in intent.rooms
    ]
    slab = FloorSlabFact(
        id="slab_1",
        polygon=_rect(0.0, 0.0, intent.footprint.width_m, intent.footprint.depth_m),
        thickness_m=intent.foundation.slab_thickness_m,
    )
    return GeometryFacts(
        source_revision=intent.revision,
        footprint_width_m=intent.footprint.width_m,
        footprint_depth_m=intent.footprint.depth_m,
        ceiling_height_m=intent.footprint.wall_height_m,
        walls=walls,
        openings=openings,
        rooms=rooms,
        roof_faces=_roof_faces(intent),
        slabs=[slab],
        produced_by="dev_mode",
        notes=["Geometry derived in pure Python (dev mode); not a FreeCAD build."],
    )

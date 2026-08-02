"""Hand-built GeometryFacts fixtures for the deterministic-check tests.

A clean rectangular house plus one variant per defect the checks must catch.
Nothing here touches FreeCAD.
"""

from __future__ import annotations

from house_design_studio.bim_builder.geometry_facts import (
    FloorSlabFact,
    GeometryFacts,
    OpeningFact,
    RoofFaceFact,
    RoomFact,
    WallFact,
)

W, D, H, T = 8.0, 6.0, 2.7, 0.15


def _perimeter_walls() -> list[WallFact]:
    return [
        WallFact(id="wall_south", start=(0, 0), end=(W, 0), height_m=H, thickness_m=T),
        WallFact(id="wall_east", start=(W, 0), end=(W, D), height_m=H, thickness_m=T),
        WallFact(id="wall_north", start=(W, D), end=(0, D), height_m=H, thickness_m=T),
        WallFact(id="wall_west", start=(0, D), end=(0, 0), height_m=H, thickness_m=T),
    ]


def _roof_faces() -> list[RoofFaceFact]:
    # Two gable faces covering the footprint (plus a little overhang -> ratio > 1).
    return [
        RoofFaceFact(id="rf1", projected_area_m2=W * D / 2 + 4),
        RoofFaceFact(id="rf2", projected_area_m2=W * D / 2 + 4),
    ]


def clean_house() -> GeometryFacts:
    walls = _perimeter_walls()
    rooms = [
        RoomFact(
            id="room_bed", name="Bedroom", room_type="bedroom",
            polygon=[(0, 0), (W, 0), (W, D), (0, D)], min_ceiling_height_m=2.55,
        )
    ]
    openings = [
        OpeningFact(
            id="op_egress", host_wall_id="wall_east", opening_type="window",
            width_m=0.9, height_m=1.2, sill_height_m=0.6, position_along_wall_m=3.0,
            egress_rated=True,
        )
    ]
    return GeometryFacts(
        footprint_width_m=W, footprint_depth_m=D, ceiling_height_m=H,
        walls=walls, openings=openings, rooms=rooms,
        roof_faces=_roof_faces(),
        slabs=[FloorSlabFact(id="slab", polygon=[(0, 0), (W, 0), (W, D), (0, D)])],
    )


def overlapping_walls() -> GeometryFacts:
    facts = clean_house()
    # A stray wall sitting on top of the south wall, sharing no endpoint with it.
    facts.walls.append(
        WallFact(id="wall_bad", start=(2, 0), end=(6, 0), height_m=H, thickness_m=T)
    )
    return facts


def opening_outside_wall() -> GeometryFacts:
    facts = clean_house()
    # Window pushed past the end of an 8 m wall.
    facts.openings[0] = OpeningFact(
        id="op_egress", host_wall_id="wall_east", opening_type="window",
        width_m=2.0, height_m=1.2, sill_height_m=0.6, position_along_wall_m=5.5,
        egress_rated=True,
    )
    return facts


def roof_undercoverage() -> GeometryFacts:
    facts = clean_house()
    facts.roof_faces = [RoofFaceFact(id="rf1", projected_area_m2=W * D * 0.5)]
    return facts


def bedroom_no_egress() -> GeometryFacts:
    facts = clean_house()
    facts.openings[0].egress_rated = False
    return facts


def low_ceiling() -> GeometryFacts:
    facts = clean_house()
    facts.rooms[0].min_ceiling_height_m = 1.9
    return facts

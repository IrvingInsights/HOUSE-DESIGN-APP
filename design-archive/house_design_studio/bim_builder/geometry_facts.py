"""GeometryFacts — the FreeCAD-free bridge between the model and the checks.

This module has **zero dependency on FreeCAD at import time**. It defines a
plain, serializable description of the geometry that was built:

- The FreeCAD-side ``build_house.py`` populates these objects by walking the
  Arch document it created, then writes ``geometry_facts.json``.
- The dev-mode builder constructs the same objects directly in pure Python.
- The ``checks/`` package consumes only these objects, never live FreeCAD
  objects — which is exactly what lets the checks be unit-tested in an
  environment with no FreeCAD installed.

Keeping this contract narrow (2D centrelines, scalar heights, 2D polygons) is a
deliberate choice: the deterministic checks we run in Phase 1 are all resolvable
from these facts without a solid-modelling kernel.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from pydantic import BaseModel, Field

Point2D = Tuple[float, float]


class WallFact(BaseModel):
    id: str
    start: Point2D
    end: Point2D
    height_m: float
    thickness_m: float
    wall_type: str = "exterior_bearing"

    @property
    def length_m(self) -> float:
        (x0, y0), (x1, y1) = self.start, self.end
        return ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5


class OpeningFact(BaseModel):
    id: str
    host_wall_id: str
    opening_type: str = "window"
    width_m: float
    height_m: float
    sill_height_m: float = 0.0
    position_along_wall_m: float = 0.0
    egress_rated: bool = False


class RoomFact(BaseModel):
    id: str
    name: str = ""
    room_type: str = "other"
    polygon: List[Point2D] = Field(default_factory=list)
    min_ceiling_height_m: float = 2.4


class RoofFaceFact(BaseModel):
    id: str
    # 2D projection (footprint) of this roof face, used for coverage checks.
    projected_polygon: List[Point2D] = Field(default_factory=list)
    projected_area_m2: float = 0.0


class FloorSlabFact(BaseModel):
    id: str
    polygon: List[Point2D] = Field(default_factory=list)
    thickness_m: float = 0.1


class GeometryFacts(BaseModel):
    """Everything the deterministic checks need to know about the built model."""

    source_revision: int = 1
    footprint_width_m: float = 0.0
    footprint_depth_m: float = 0.0
    ceiling_height_m: float = 0.0
    walls: List[WallFact] = Field(default_factory=list)
    openings: List[OpeningFact] = Field(default_factory=list)
    rooms: List[RoomFact] = Field(default_factory=list)
    roof_faces: List[RoofFaceFact] = Field(default_factory=list)
    slabs: List[FloorSlabFact] = Field(default_factory=list)
    # Set by the builder that produced these facts: "freecad" or "dev_mode".
    produced_by: str = "unknown"
    notes: List[str] = Field(default_factory=list)

    @property
    def footprint_area_m2(self) -> float:
        return self.footprint_width_m * self.footprint_depth_m

    def wall_by_id(self, wall_id: str) -> Optional[WallFact]:
        for wall in self.walls:
            if wall.id == wall_id:
                return wall
        return None

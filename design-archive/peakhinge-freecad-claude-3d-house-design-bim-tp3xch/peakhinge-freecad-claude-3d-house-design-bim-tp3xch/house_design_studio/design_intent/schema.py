"""Design Intent — the single source of truth for a house design.

This Pydantic model is *the* contract of House Design Studio. Every other stage
(BIM builder, deterministic checks, council critique, revision proposer,
reporting) reads and writes this shape. It is deliberately forward-compatible:
the schema can express more than the Phase 1 builder implements (multi-story,
non-rectangular footprints, hip roofs, basements). Those extra values pass
schema validation but are rejected *loudly* by the builder with a clear
"not implemented in Phase 1" error rather than being silently ignored.

Design choices:
- Geometry is 2D coordinates plus scalar heights. Phase 1 is single-story, so a
  full 3D point everywhere would be needless complexity; walls extrude up from a
  2D footprint by `height_m`.
- Every cross-reference is by a stable string ``id`` (never an array index) so a
  targeted revision patch can add/remove elements without renumbering breaking
  references.
- Units are SI: metres for length, degrees for angles. This is stated once here
  and assumed everywhere downstream.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional, Tuple

from pydantic import BaseModel, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0"

# A 2D point in the footprint's local coordinate frame, metres.
Point2D = Tuple[float, float]


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------- #
# Enumerations
# --------------------------------------------------------------------------- #


class LotShape(str, Enum):
    rectangular = "rectangular"
    irregular = "irregular"


class FootprintShape(str, Enum):
    rectangle = "rectangle"
    l_shape = "l_shape"
    rectangle_with_bump = "rectangle_with_bump"


class RoomType(str, Enum):
    bedroom = "bedroom"
    bathroom = "bathroom"
    kitchen = "kitchen"
    living = "living"
    dining = "dining"
    utility = "utility"
    hallway = "hallway"
    closet = "closet"
    garage = "garage"
    other = "other"


class WallType(str, Enum):
    exterior_bearing = "exterior_bearing"
    exterior_nonbearing = "exterior_nonbearing"
    interior_bearing = "interior_bearing"
    interior_partition = "interior_partition"


class OpeningType(str, Enum):
    door = "door"
    window = "window"


class RoofType(str, Enum):
    gable = "gable"
    shed = "shed"
    hip = "hip"
    flat = "flat"


class RidgeOrientation(str, Enum):
    parallel_to_width = "parallel_to_width"
    parallel_to_depth = "parallel_to_depth"


class FoundationType(str, Enum):
    slab_on_grade = "slab_on_grade"
    crawlspace = "crawlspace"
    basement = "basement"


# Values the Phase 1 builder actually implements. Everything else is schema-valid
# but rejected by the builder. Kept here so the builder and tests share one source.
BUILDER_SUPPORTED = {
    "footprint_shape": {FootprintShape.rectangle},
    "roof_type": {RoofType.gable, RoofType.shed},
    "foundation_type": {FoundationType.slab_on_grade},
    "stories": {1},
}


# --------------------------------------------------------------------------- #
# Sub-models
# --------------------------------------------------------------------------- #


class Setbacks(BaseModel):
    front: float = 0.0
    rear: float = 0.0
    left: float = 0.0
    right: float = 0.0


class Site(BaseModel):
    address_or_description: str = ""
    orientation_deg_from_north: float = Field(
        0.0,
        ge=0.0,
        le=360.0,
        description="Rotation of the building's local +Y axis clockwise from true "
        "north. 0 means the local frame is north-up.",
    )
    lot_shape: LotShape = LotShape.rectangular
    lot_width_m: float = Field(0.0, ge=0.0)
    lot_depth_m: float = Field(0.0, ge=0.0)
    setbacks_m: Setbacks = Field(default_factory=Setbacks)
    climate_notes: str = ""


class Footprint(BaseModel):
    shape: FootprintShape = FootprintShape.rectangle
    width_m: float = Field(..., gt=0.0)
    depth_m: float = Field(..., gt=0.0)
    wall_height_m: float = Field(..., gt=0.0, description="Eave height (single story).")


class Room(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("room"))
    name: str = ""
    polygon: List[Point2D] = Field(
        default_factory=list,
        description="Axis-aligned rectangle (4 points) in the footprint's local "
        "frame for Phase 1.",
    )
    area_m2: float = Field(0.0, ge=0.0)
    room_type: RoomType = RoomType.other
    min_ceiling_height_m: float = Field(2.4, gt=0.0)


class Wall(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("wall"))
    start: Point2D
    end: Point2D
    height_m: float = Field(..., gt=0.0)
    thickness_m: float = Field(..., gt=0.0)
    wall_type: WallType = WallType.exterior_bearing
    material: str = ""

    @property
    def length_m(self) -> float:
        (x0, y0), (x1, y1) = self.start, self.end
        return ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5


class Opening(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("opening"))
    host_wall_id: str
    opening_type: OpeningType = OpeningType.window
    width_m: float = Field(..., gt=0.0)
    height_m: float = Field(..., gt=0.0)
    sill_height_m: float = Field(0.0, ge=0.0)
    position_along_wall_m: float = Field(
        ..., ge=0.0, description="Distance from host wall.start to opening centreline."
    )
    egress_rated: bool = False
    swing_or_operation: str = ""


class Roof(BaseModel):
    roof_type: RoofType = RoofType.gable
    pitch_ratio: float = Field(0.33, ge=0.0, description="Rise over run, e.g. 0.33 = 4:12.")
    overhang_m: float = Field(0.3, ge=0.0)
    ridge_orientation: RidgeOrientation = RidgeOrientation.parallel_to_width
    material_notes: str = ""


class Foundation(BaseModel):
    foundation_type: FoundationType = FoundationType.slab_on_grade
    slab_thickness_m: float = Field(0.1, gt=0.0)
    notes: str = ""


class StructuralFramingAssumptions(BaseModel):
    floor_joist_or_slab: str = ""
    roof_rafter_or_truss: str = ""
    wall_stud_spec: str = ""
    disclaimer: str = (
        "Heuristic assumptions only. Not engineered. A licensed Professional "
        "Engineer must independently review and size all structural members."
    )


class Source(BaseModel):
    input_text: Optional[str] = None
    input_image_refs: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Top-level model
# --------------------------------------------------------------------------- #


class DesignIntent(BaseModel):
    schema_version: str = SCHEMA_VERSION
    intent_id: str = Field(default_factory=lambda: _new_id("intent"))
    revision: int = Field(1, ge=1)
    created_at: str = Field(default_factory=_utcnow_iso)
    updated_at: str = Field(default_factory=_utcnow_iso)

    source: Source = Field(default_factory=Source)
    site: Site = Field(default_factory=Site)
    stories: int = Field(1, ge=1)
    footprint: Footprint
    rooms: List[Room] = Field(default_factory=list)
    walls: List[Wall] = Field(default_factory=list)
    openings: List[Opening] = Field(default_factory=list)
    roof: Roof = Field(default_factory=Roof)
    foundation: Foundation = Field(default_factory=Foundation)
    structural_framing_assumptions: StructuralFramingAssumptions = Field(
        default_factory=StructuralFramingAssumptions
    )
    materials_notes: str = ""
    open_questions: List[str] = Field(default_factory=list)

    # --- structural integrity of the document itself ---------------------- #

    @field_validator("walls")
    @classmethod
    def _unique_wall_ids(cls, walls: List[Wall]) -> List[Wall]:
        ids = [w.id for w in walls]
        if len(ids) != len(set(ids)):
            raise ValueError("Wall ids must be unique.")
        return walls

    @field_validator("rooms")
    @classmethod
    def _unique_room_ids(cls, rooms: List[Room]) -> List[Room]:
        ids = [r.id for r in rooms]
        if len(ids) != len(set(ids)):
            raise ValueError("Room ids must be unique.")
        return rooms

    @model_validator(mode="after")
    def _openings_reference_existing_walls(self) -> "DesignIntent":
        wall_ids = {w.id for w in self.walls}
        opening_ids = [o.id for o in self.openings]
        if len(opening_ids) != len(set(opening_ids)):
            raise ValueError("Opening ids must be unique.")
        for opening in self.openings:
            if opening.host_wall_id not in wall_ids:
                raise ValueError(
                    f"Opening '{opening.id}' references unknown host_wall_id "
                    f"'{opening.host_wall_id}'."
                )
        return self


def new_design_intent(**kwargs) -> DesignIntent:
    """Convenience constructor used by samples/tests."""
    return DesignIntent(**kwargs)

"""BIM builder: GeometryFacts contract + host-side FreeCAD runner.

The FreeCAD-side scripts (build_house.py, techdraw_sheets.py, exporters.py) are
NOT imported here — they only ever run inside FreeCADCmd and import FreeCAD.
"""

from .dev_geometry import design_intent_to_facts
from .geometry_facts import (
    FloorSlabFact,
    GeometryFacts,
    OpeningFact,
    RoofFaceFact,
    RoomFact,
    WallFact,
)
from .runner import (
    DevModeBuilder,
    FreeCADBuilder,
    probe_freecad_cmd,
    select_builder,
)

__all__ = [
    "design_intent_to_facts",
    "FloorSlabFact",
    "GeometryFacts",
    "OpeningFact",
    "RoofFaceFact",
    "RoomFact",
    "WallFact",
    "DevModeBuilder",
    "FreeCADBuilder",
    "probe_freecad_cmd",
    "select_builder",
]

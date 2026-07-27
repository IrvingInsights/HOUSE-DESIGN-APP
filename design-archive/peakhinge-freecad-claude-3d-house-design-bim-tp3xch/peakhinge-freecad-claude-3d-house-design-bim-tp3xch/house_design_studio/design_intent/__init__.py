"""Design Intent — the core contract of House Design Studio."""

from .schema import (
    SCHEMA_VERSION,
    DesignIntent,
    Footprint,
    Foundation,
    Opening,
    Roof,
    Room,
    Site,
    Wall,
    new_design_intent,
)
from .validator import (
    Phase1UnsupportedError,
    dump_design_intent,
    load_design_intent,
    phase1_unsupported_reasons,
    validate_phase1_buildable,
)
from .versioning import bump_revision, diff_summary

__all__ = [
    "SCHEMA_VERSION",
    "DesignIntent",
    "Footprint",
    "Foundation",
    "Opening",
    "Roof",
    "Room",
    "Site",
    "Wall",
    "new_design_intent",
    "Phase1UnsupportedError",
    "dump_design_intent",
    "load_design_intent",
    "phase1_unsupported_reasons",
    "validate_phase1_buildable",
    "bump_revision",
    "diff_summary",
]

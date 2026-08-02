"""Load, validate and Phase-1 gate a Design Intent document.

Two layers of validation:

1. ``load_design_intent`` / ``DesignIntent`` — structural validity (types,
   required fields, unique ids, openings referencing real walls). Enforced by
   the Pydantic model itself.

2. ``validate_phase1_buildable`` — *semantic* gating for what the Phase 1
   FreeCAD builder can actually construct. The schema is intentionally broader
   than the builder, so this is where an l-shaped footprint or a second story
   gets rejected with a clear, actionable message instead of silently producing
   a wrong model.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Union

from .schema import BUILDER_SUPPORTED, DesignIntent


class Phase1UnsupportedError(ValueError):
    """Raised when a Design Intent is structurally valid but uses a feature the
    Phase 1 builder does not implement."""


def load_design_intent(path: Union[str, Path]) -> DesignIntent:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return DesignIntent.model_validate(data)


def dump_design_intent(intent: DesignIntent, path: Union[str, Path]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        intent.model_dump_json(indent=2, round_trip=True), encoding="utf-8"
    )


def phase1_unsupported_reasons(intent: DesignIntent) -> List[str]:
    """Return a list of human-readable reasons the Design Intent cannot be built
    by the Phase 1 FreeCAD builder. Empty list means it is buildable."""
    reasons: List[str] = []

    if intent.stories not in BUILDER_SUPPORTED["stories"]:
        reasons.append(
            f"Phase 1 supports single-story houses only (stories={intent.stories})."
        )
    if intent.footprint.shape not in BUILDER_SUPPORTED["footprint_shape"]:
        reasons.append(
            f"Phase 1 builder implements a rectangular footprint only "
            f"(shape='{intent.footprint.shape.value}')."
        )
    if intent.roof.roof_type not in BUILDER_SUPPORTED["roof_type"]:
        reasons.append(
            f"Phase 1 builder implements gable and shed roofs only "
            f"(roof_type='{intent.roof.roof_type.value}')."
        )
    if intent.foundation.foundation_type not in BUILDER_SUPPORTED["foundation_type"]:
        reasons.append(
            f"Phase 1 builder implements slab-on-grade foundations only "
            f"(foundation_type='{intent.foundation.foundation_type.value}')."
        )
    return reasons


def validate_phase1_buildable(intent: DesignIntent) -> None:
    """Raise :class:`Phase1UnsupportedError` if the intent cannot be built."""
    reasons = phase1_unsupported_reasons(intent)
    if reasons:
        raise Phase1UnsupportedError(
            "Design Intent uses features not implemented in Phase 1:\n  - "
            + "\n  - ".join(reasons)
        )

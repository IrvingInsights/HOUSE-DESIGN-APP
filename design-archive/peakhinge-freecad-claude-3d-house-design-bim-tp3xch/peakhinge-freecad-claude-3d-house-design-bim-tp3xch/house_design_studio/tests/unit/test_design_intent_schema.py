"""Design Intent schema: valid samples pass, invalid ones fail clearly."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from house_design_studio.design_intent import (
    DesignIntent,
    Phase1UnsupportedError,
    load_design_intent,
    validate_phase1_buildable,
)

SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "design_intent" / "samples" / "simple_rectangle_1br.json"
)


def test_sample_loads_and_roundtrips():
    intent = load_design_intent(SAMPLE)
    assert intent.stories == 1
    # Round-trip stability.
    again = DesignIntent.model_validate_json(intent.model_dump_json(round_trip=True))
    assert again.model_dump() == intent.model_dump()


def test_sample_is_phase1_buildable():
    validate_phase1_buildable(load_design_intent(SAMPLE))


def test_missing_required_field_fails():
    with pytest.raises(ValidationError):
        DesignIntent.model_validate({"footprint": {"width_m": 8}})  # no depth/height


def test_opening_referencing_unknown_wall_fails():
    with pytest.raises(ValidationError):
        DesignIntent.model_validate(
            {
                "footprint": {"width_m": 8, "depth_m": 6, "wall_height_m": 2.7},
                "walls": [
                    {"id": "w1", "start": [0, 0], "end": [8, 0],
                     "height_m": 2.7, "thickness_m": 0.15}
                ],
                "openings": [
                    {"id": "o1", "host_wall_id": "does_not_exist",
                     "width_m": 1, "height_m": 1, "position_along_wall_m": 1}
                ],
            }
        )


def test_duplicate_wall_ids_fail():
    with pytest.raises(ValidationError):
        DesignIntent.model_validate(
            {
                "footprint": {"width_m": 8, "depth_m": 6, "wall_height_m": 2.7},
                "walls": [
                    {"id": "w1", "start": [0, 0], "end": [8, 0],
                     "height_m": 2.7, "thickness_m": 0.15},
                    {"id": "w1", "start": [8, 0], "end": [8, 6],
                     "height_m": 2.7, "thickness_m": 0.15},
                ],
            }
        )


def test_bad_enum_value_fails():
    with pytest.raises(ValidationError):
        DesignIntent.model_validate(
            {
                "footprint": {"width_m": 8, "depth_m": 6, "wall_height_m": 2.7},
                "roof": {"roof_type": "dome"},
            }
        )


def test_unsupported_feature_is_schema_valid_but_rejected_by_builder():
    # A hip roof is representable (forward-compatible) ...
    intent = DesignIntent.model_validate(
        {
            "footprint": {"width_m": 8, "depth_m": 6, "wall_height_m": 2.7},
            "roof": {"roof_type": "hip"},
        }
    )
    # ... but the Phase 1 builder must reject it, loudly.
    with pytest.raises(Phase1UnsupportedError):
        validate_phase1_buildable(intent)


def test_two_stories_rejected_by_builder():
    intent = DesignIntent.model_validate(
        {
            "footprint": {"width_m": 8, "depth_m": 6, "wall_height_m": 2.7},
            "stories": 2,
        }
    )
    with pytest.raises(Phase1UnsupportedError):
        validate_phase1_buildable(intent)

"""Patch application: set/add/remove, validation, and failure handling."""

import pytest

from house_design_studio.design_intent import load_design_intent
from house_design_studio.revision.apply_patch import PatchError, PatchOp, apply_patch
from pathlib import Path

SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "design_intent" / "samples" / "simple_rectangle_1br.json"
)


def _intent():
    return load_design_intent(SAMPLE)


def test_set_nested_scalar():
    intent = _intent()
    out = apply_patch(intent, [PatchOp(path="footprint.wall_height_m", op="set", value=3.0)])
    assert out.footprint.wall_height_m == 3.0


def test_set_list_element_field():
    intent = _intent()
    out = apply_patch(
        intent, [PatchOp(path="walls[4].thickness_m", op="set", value=0.2)]
    )
    assert out.walls[4].thickness_m == 0.2


def test_add_to_list():
    intent = _intent()
    n = len(intent.openings)
    new_op = {
        "id": "op_new", "host_wall_id": "wall_north", "opening_type": "window",
        "width_m": 1.0, "height_m": 1.0, "sill_height_m": 0.9,
        "position_along_wall_m": 2.0,
    }
    out = apply_patch(intent, [PatchOp(path="openings", op="add", value=new_op)])
    assert len(out.openings) == n + 1


def test_remove_list_element():
    intent = _intent()
    n = len(intent.openings)
    out = apply_patch(intent, [PatchOp(path="openings[0]", op="remove")])
    assert len(out.openings) == n - 1


def test_invalid_path_raises():
    with pytest.raises(PatchError):
        apply_patch(_intent(), [PatchOp(path="walls[99].thickness_m", op="set", value=1)])


def test_patch_producing_invalid_document_raises():
    # Adding an opening that references a non-existent wall must fail validation.
    bad = {"id": "x", "host_wall_id": "ghost", "width_m": 1, "height_m": 1,
           "position_along_wall_m": 1}
    with pytest.raises(Exception):
        apply_patch(_intent(), [PatchOp(path="openings", op="add", value=bad)])

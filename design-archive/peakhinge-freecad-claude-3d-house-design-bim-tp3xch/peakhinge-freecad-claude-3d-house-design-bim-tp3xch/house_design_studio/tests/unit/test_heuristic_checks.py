"""Heuristic checks: ceiling, egress, stairs stub, span-to-depth."""

from house_design_studio.checks.heuristic_checks import (
    check_ceiling_heights,
    check_egress,
    check_span_to_depth,
    check_stairs,
    run_heuristic_checks,
)
from house_design_studio.design_intent import load_design_intent
from house_design_studio.tests.fixtures import geometry_facts_examples as ex
from pathlib import Path

SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "design_intent" / "samples" / "simple_rectangle_1br.json"
)


def _codes(issues):
    return {i.code for i in issues}


def test_low_ceiling_flagged_as_heuristic():
    issues = check_ceiling_heights(ex.low_ceiling())
    assert issues and issues[0].code == "ceiling_too_low"
    assert all(i.heuristic for i in issues)


def test_clean_house_ceiling_ok():
    assert check_ceiling_heights(ex.clean_house()) == []


def test_bedroom_without_egress_flagged():
    assert "bedroom_no_egress" in _codes(check_egress(ex.bedroom_no_egress()))


def test_bedroom_with_egress_ok():
    assert check_egress(ex.clean_house()) == []


def test_stairs_check_is_informational_noop():
    issues = check_stairs(ex.clean_house())
    assert len(issues) == 1 and issues[0].severity.value == "info"


def test_span_to_depth_flags_excessive_rafter():
    intent = load_design_intent(SAMPLE)
    # Force a shallow rafter over a wide span.
    intent.structural_framing_assumptions.roof_rafter_or_truss = "2x4 rafters"
    intent.footprint.depth_m = 12.0
    codes = _codes(check_span_to_depth(ex.clean_house(), intent))
    assert "rafter_span_to_depth" in codes


def test_run_heuristics_marks_everything_heuristic():
    intent = load_design_intent(SAMPLE)
    for issue in run_heuristic_checks(ex.clean_house(), intent):
        assert issue.heuristic is True

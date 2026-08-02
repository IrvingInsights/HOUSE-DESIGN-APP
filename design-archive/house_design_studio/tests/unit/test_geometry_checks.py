"""Geometry checks fire on defects and stay quiet on a clean house."""

from house_design_studio.checks.geometry_checks import run_geometry_checks
from house_design_studio.tests.fixtures import geometry_facts_examples as ex


def _codes(facts):
    return {i.code for i in run_geometry_checks(facts)}


def test_clean_house_has_no_geometry_issues():
    assert run_geometry_checks(ex.clean_house()) == []


def test_overlapping_walls_flagged():
    assert "wall_overlap" in _codes(ex.overlapping_walls())


def test_opening_outside_wall_flagged():
    assert "opening_exceeds_wall_length" in _codes(ex.opening_outside_wall())


def test_roof_undercoverage_flagged():
    assert "roof_undercoverage" in _codes(ex.roof_undercoverage())


def test_orphaned_opening_flagged():
    facts = ex.clean_house()
    facts.openings[0].host_wall_id = "nope"
    assert "opening_orphaned" in _codes(facts)

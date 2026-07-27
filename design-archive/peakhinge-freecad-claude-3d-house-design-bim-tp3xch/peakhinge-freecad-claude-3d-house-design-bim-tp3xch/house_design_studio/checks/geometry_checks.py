"""Exact geometric checks against GeometryFacts.

These are not heuristics — they detect definite modelling errors: walls that
occupy the same space, openings that don't fit their host wall, rooms that
aren't enclosed, and roofs that don't cover the building. All operate purely on
:class:`GeometryFacts`, so they run with no FreeCAD present.
"""

from __future__ import annotations

from itertools import combinations
from typing import List

from ..bim_builder.geometry_facts import GeometryFacts
from . import geom2d
from .constants import (
    POSITION_TOLERANCE_M,
    ROOF_MIN_COVERAGE_RATIO,
    WALL_OVERLAP_MIN_AREA_M2,
)
from .report_types import CheckIssue, Severity


def check_wall_overlaps(facts: GeometryFacts) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    for wall_a, wall_b in combinations(facts.walls, 2):
        if geom2d.segments_share_endpoint(
            (wall_a.start, wall_a.end),
            (wall_b.start, wall_b.end),
            tol=max(wall_a.thickness_m, wall_b.thickness_m),
        ):
            # Adjacent walls meeting at a corner legitimately overlap a little.
            continue
        rect_a = geom2d.wall_rectangle(wall_a.start, wall_a.end, wall_a.thickness_m)
        rect_b = geom2d.wall_rectangle(wall_b.start, wall_b.end, wall_b.thickness_m)
        overlap = geom2d.convex_intersection_area(rect_a, rect_b)
        if overlap > WALL_OVERLAP_MIN_AREA_M2:
            issues.append(
                CheckIssue(
                    severity=Severity.high,
                    code="wall_overlap",
                    element_ref=wall_a.id,
                    rule_id="geometry_checks.check_wall_overlaps",
                    message=(
                        f"Walls '{wall_a.id}' and '{wall_b.id}' overlap by "
                        f"{overlap:.3f} m^2 without meeting at a corner. This is a "
                        f"modelling clash that must be resolved."
                    ),
                )
            )
    return issues


def check_openings_within_walls(facts: GeometryFacts) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    for opening in facts.openings:
        wall = facts.wall_by_id(opening.host_wall_id)
        if wall is None:
            issues.append(
                CheckIssue(
                    severity=Severity.high,
                    code="opening_orphaned",
                    element_ref=opening.id,
                    rule_id="geometry_checks.check_openings_within_walls",
                    message=(
                        f"Opening '{opening.id}' references host wall "
                        f"'{opening.host_wall_id}', which does not exist in the model."
                    ),
                )
            )
            continue

        half = opening.width_m / 2.0
        left = opening.position_along_wall_m - half
        right = opening.position_along_wall_m + half
        if left < -POSITION_TOLERANCE_M or right > wall.length_m + POSITION_TOLERANCE_M:
            issues.append(
                CheckIssue(
                    severity=Severity.high,
                    code="opening_exceeds_wall_length",
                    element_ref=opening.id,
                    rule_id="geometry_checks.check_openings_within_walls",
                    message=(
                        f"Opening '{opening.id}' spans {left:.2f}-{right:.2f} m along "
                        f"wall '{wall.id}' (length {wall.length_m:.2f} m). It does not "
                        f"fit within the wall."
                    ),
                )
            )
        top = opening.sill_height_m + opening.height_m
        if top > wall.height_m + POSITION_TOLERANCE_M:
            issues.append(
                CheckIssue(
                    severity=Severity.high,
                    code="opening_exceeds_wall_height",
                    element_ref=opening.id,
                    rule_id="geometry_checks.check_openings_within_walls",
                    message=(
                        f"Opening '{opening.id}' reaches {top:.2f} m but host wall "
                        f"'{wall.id}' is only {wall.height_m:.2f} m tall."
                    ),
                )
            )
    return issues


def check_room_enclosure(facts: GeometryFacts) -> List[CheckIssue]:
    """Each edge of a room polygon should be covered by a wall centreline. An
    uncovered edge means the room isn't enclosed on that side."""
    issues: List[CheckIssue] = []
    for room in facts.rooms:
        poly = room.polygon
        if len(poly) < 3:
            continue
        uncovered = 0
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            covered = any(
                geom2d.point_to_segment_distance(mid, w.start, w.end)
                <= w.thickness_m / 2.0 + POSITION_TOLERANCE_M
                for w in facts.walls
            )
            if not covered:
                uncovered += 1
        if uncovered:
            issues.append(
                CheckIssue(
                    severity=Severity.medium,
                    code="room_not_enclosed",
                    element_ref=room.id,
                    rule_id="geometry_checks.check_room_enclosure",
                    message=(
                        f"Room '{room.name or room.id}' has {uncovered} polygon "
                        f"edge(s) with no wall along them; the room may not be "
                        f"fully enclosed."
                    ),
                )
            )
    return issues


def check_roof_coverage(facts: GeometryFacts) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    footprint_area = facts.footprint_area_m2
    if footprint_area <= 0:
        return issues
    roof_area = sum(face.projected_area_m2 for face in facts.roof_faces)
    if roof_area <= 0:
        issues.append(
            CheckIssue(
                severity=Severity.high,
                code="roof_missing",
                element_ref="roof",
                rule_id="geometry_checks.check_roof_coverage",
                message="No roof geometry was produced for the building.",
            )
        )
        return issues
    ratio = roof_area / footprint_area
    if ratio < ROOF_MIN_COVERAGE_RATIO:
        issues.append(
            CheckIssue(
                severity=Severity.high,
                code="roof_undercoverage",
                element_ref="roof",
                rule_id="geometry_checks.check_roof_coverage",
                message=(
                    f"Roof covers only {ratio * 100:.0f}% of the building footprint "
                    f"({roof_area:.1f} of {footprint_area:.1f} m^2). Some of the "
                    f"building is left unroofed."
                ),
            )
        )
    return issues


def run_geometry_checks(facts: GeometryFacts) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    issues.extend(check_wall_overlaps(facts))
    issues.extend(check_openings_within_walls(facts))
    issues.extend(check_room_enclosure(facts))
    issues.extend(check_roof_coverage(facts))
    return issues

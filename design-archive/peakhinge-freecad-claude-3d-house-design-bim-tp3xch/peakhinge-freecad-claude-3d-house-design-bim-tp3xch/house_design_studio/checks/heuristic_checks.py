"""Rule-of-thumb sanity checks. Every finding here is ``heuristic=True``.

These catch designs that are *probably* wrong (too-low ceilings, a bedroom with
no egress window, a wildly under-depth rafter) so the council and the user get an
early warning. They are explicitly NOT code compliance and NOT engineering.
"""

from __future__ import annotations

from typing import List

from ..bim_builder.geometry_facts import GeometryFacts, RoomFact, WallFact
from ..design_intent.schema import DesignIntent, RidgeOrientation
from . import geom2d, framing_parse
from .constants import (
    MAX_EGRESS_SILL_HEIGHT_M,
    MAX_SPAN_TO_DEPTH_RATIO,
    MIN_EGRESS_CLEAR_AREA_M2,
    MIN_EGRESS_CLEAR_HEIGHT_M,
    MIN_EGRESS_CLEAR_WIDTH_M,
    MIN_HABITABLE_CEILING_HEIGHT_M,
    POSITION_TOLERANCE_M,
)
from .report_types import CheckIssue, Severity


def check_ceiling_heights(facts: GeometryFacts) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    for room in facts.rooms:
        if room.min_ceiling_height_m < MIN_HABITABLE_CEILING_HEIGHT_M:
            issues.append(
                CheckIssue(
                    severity=Severity.medium,
                    code="ceiling_too_low",
                    element_ref=room.id,
                    rule_id="heuristic_checks.check_ceiling_heights",
                    heuristic=True,
                    message=(
                        f"Room '{room.name or room.id}' ceiling height "
                        f"{room.min_ceiling_height_m:.2f} m is below the "
                        f"{MIN_HABITABLE_CEILING_HEIGHT_M:.2f} m rule-of-thumb minimum "
                        f"for habitable space. Verify against local code."
                    ),
                )
            )
    return issues


def _walls_enclosing_room(room: RoomFact, walls: List[WallFact]) -> List[WallFact]:
    """Walls whose centreline runs along an edge of the room polygon."""
    enclosing: List[WallFact] = []
    poly = room.polygon
    n = len(poly)
    for wall in walls:
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            if (
                geom2d.point_to_segment_distance(mid, wall.start, wall.end)
                <= wall.thickness_m / 2.0 + POSITION_TOLERANCE_M
            ):
                enclosing.append(wall)
                break
    return enclosing


def check_egress(facts: GeometryFacts) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    for room in facts.rooms:
        if room.room_type != "bedroom":
            continue
        enclosing_ids = {w.id for w in _walls_enclosing_room(room, facts.walls)}
        room_openings = [
            o for o in facts.openings if o.host_wall_id in enclosing_ids
        ]
        egress_candidates = [o for o in room_openings if o.egress_rated]

        if not egress_candidates:
            issues.append(
                CheckIssue(
                    severity=Severity.high,
                    code="bedroom_no_egress",
                    element_ref=room.id,
                    rule_id="heuristic_checks.check_egress",
                    heuristic=True,
                    message=(
                        f"Bedroom '{room.name or room.id}' has no egress-rated "
                        f"window or door on an enclosing wall. Sleeping rooms "
                        f"typically require an emergency egress opening."
                    ),
                )
            )
            continue

        # An egress opening exists — sanity-check its clear dimensions.
        adequate = False
        for o in egress_candidates:
            area = o.width_m * o.height_m
            if (
                o.width_m >= MIN_EGRESS_CLEAR_WIDTH_M
                and o.height_m >= MIN_EGRESS_CLEAR_HEIGHT_M
                and area >= MIN_EGRESS_CLEAR_AREA_M2
                and o.sill_height_m <= MAX_EGRESS_SILL_HEIGHT_M
            ):
                adequate = True
                break
        if not adequate:
            issues.append(
                CheckIssue(
                    severity=Severity.medium,
                    code="egress_undersized",
                    element_ref=room.id,
                    rule_id="heuristic_checks.check_egress",
                    heuristic=True,
                    message=(
                        f"Bedroom '{room.name or room.id}' has an egress-flagged "
                        f"opening, but its clear dimensions/sill height fall below "
                        f"common egress rules of thumb. Verify against local code."
                    ),
                )
            )
    return issues


def check_stairs(facts: GeometryFacts) -> List[CheckIssue]:
    """Phase 1 is single-story; documented as an explicit informational no-op so
    the gap is visible rather than silent, and so Phase 2 has a clear home."""
    return [
        CheckIssue(
            severity=Severity.info,
            code="stairs_out_of_scope",
            element_ref="general",
            rule_id="heuristic_checks.check_stairs",
            heuristic=True,
            message="Single-story Phase 1 model; stair checks are out of scope.",
        )
    ]


def check_span_to_depth(facts: GeometryFacts, intent: DesignIntent) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    framing = intent.structural_framing_assumptions

    # --- Roof rafters: run from eave to ridge ------------------------------ #
    if intent.roof.ridge_orientation == RidgeOrientation.parallel_to_width:
        rafter_run = intent.footprint.depth_m / 2.0
    else:
        rafter_run = intent.footprint.width_m / 2.0
    # Account for pitch: sloped length is longer than the horizontal run.
    slope_factor = (1.0 + intent.roof.pitch_ratio ** 2) ** 0.5
    rafter_span = rafter_run * slope_factor
    depth, parsed = framing_parse.parse_member_depth_or_fallback(
        framing.roof_rafter_or_truss
    )
    if depth > 0:
        ratio = rafter_span / depth
        if ratio > MAX_SPAN_TO_DEPTH_RATIO:
            conf = "" if parsed else " (member depth assumed; framing note unparsed)"
            issues.append(
                CheckIssue(
                    severity=Severity.medium,
                    code="rafter_span_to_depth",
                    element_ref="roof",
                    rule_id="heuristic_checks.check_span_to_depth",
                    heuristic=True,
                    message=(
                        f"Roof rafter span ~{rafter_span:.1f} m against assumed depth "
                        f"{depth * 1000:.0f} mm gives span/depth {ratio:.0f}, above the "
                        f"~{MAX_SPAN_TO_DEPTH_RATIO:.0f} rule of thumb. Likely needs "
                        f"deeper members or intermediate support{conf}."
                    ),
                )
            )

    # --- Floor: only meaningful if framed (a slab-on-grade has no span) ----- #
    if not framing_parse.mentions_slab(framing.floor_joist_or_slab):
        floor_span = min(intent.footprint.width_m, intent.footprint.depth_m)
        fdepth, fparsed = framing_parse.parse_member_depth_or_fallback(
            framing.floor_joist_or_slab
        )
        if fdepth > 0:
            fratio = floor_span / fdepth
            if fratio > MAX_SPAN_TO_DEPTH_RATIO:
                conf = "" if fparsed else " (member depth assumed; framing note unparsed)"
                issues.append(
                    CheckIssue(
                        severity=Severity.medium,
                        code="floor_span_to_depth",
                        element_ref="general",
                        rule_id="heuristic_checks.check_span_to_depth",
                        heuristic=True,
                        message=(
                            f"Floor joist span ~{floor_span:.1f} m against assumed depth "
                            f"{fdepth * 1000:.0f} mm gives span/depth {fratio:.0f}, above "
                            f"the ~{MAX_SPAN_TO_DEPTH_RATIO:.0f} rule of thumb{conf}."
                        ),
                    )
                )
    return issues


def run_heuristic_checks(
    facts: GeometryFacts, intent: DesignIntent
) -> List[CheckIssue]:
    issues: List[CheckIssue] = []
    issues.extend(check_ceiling_heights(facts))
    issues.extend(check_egress(facts))
    issues.extend(check_stairs(facts))
    issues.extend(check_span_to_depth(facts, intent))
    return issues

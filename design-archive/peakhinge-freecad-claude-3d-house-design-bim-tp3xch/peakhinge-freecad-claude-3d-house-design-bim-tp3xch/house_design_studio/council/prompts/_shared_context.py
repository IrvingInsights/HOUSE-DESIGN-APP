"""Build the common context block injected into every role's prompt.

This lives in exactly one place so the six roles all see the same serialized
Design Intent + geometry + deterministic issues, and so the serialization logic
isn't copy-pasted six times.
"""

from __future__ import annotations

from ...bim_builder.geometry_facts import GeometryFacts
from ...checks.report_types import CheckReport
from ...design_intent.schema import DesignIntent

OUTPUT_CONTRACT = (
    "Respond with findings only. Each finding needs a severity "
    "(high/medium/low), an element_ref (the id of the wall/room/opening/site it "
    "concerns, or 'general'), a clear description of the concern, and a concrete "
    "recommended_fix. Report only issues within your professional lane. If the "
    "design is sound from your perspective, return an empty findings list. Do "
    "not invent code citations or claim to certify anything."
)


def _summarize_intent(intent: DesignIntent) -> str:
    fp = intent.footprint
    lines = [
        f"Footprint: {fp.shape.value} {fp.width_m:.1f} x {fp.depth_m:.1f} m, "
        f"eave height {fp.wall_height_m:.1f} m; stories {intent.stories}.",
        f"Roof: {intent.roof.roof_type.value}, pitch {intent.roof.pitch_ratio}, "
        f"overhang {intent.roof.overhang_m} m, ridge "
        f"{intent.roof.ridge_orientation.value}.",
        f"Foundation: {intent.foundation.foundation_type.value}.",
        f"Site: orientation {intent.site.orientation_deg_from_north} deg from north; "
        f"climate: {intent.site.climate_notes or 'unspecified'}.",
        "Framing (heuristic assumptions, not engineered): "
        f"floor='{intent.structural_framing_assumptions.floor_joist_or_slab}', "
        f"roof='{intent.structural_framing_assumptions.roof_rafter_or_truss}', "
        f"walls='{intent.structural_framing_assumptions.wall_stud_spec}'.",
    ]
    lines.append("Rooms:")
    for r in intent.rooms:
        lines.append(
            f"  - {r.id} '{r.name}' ({r.room_type.value}), "
            f"~{r.area_m2:.1f} m2, min ceiling {r.min_ceiling_height_m:.2f} m."
        )
    lines.append("Walls:")
    for w in intent.walls:
        lines.append(
            f"  - {w.id} ({w.wall_type.value}) {w.start}->{w.end}, "
            f"h {w.height_m:.1f} m, t {w.thickness_m * 1000:.0f} mm, {w.material}."
        )
    lines.append("Openings:")
    for o in intent.openings:
        lines.append(
            f"  - {o.id} {o.opening_type.value} on {o.host_wall_id}, "
            f"{o.width_m:.2f}x{o.height_m:.2f} m, sill {o.sill_height_m:.2f} m, "
            f"egress={o.egress_rated}."
        )
    if intent.open_questions:
        lines.append("Open questions flagged so far:")
        for q in intent.open_questions:
            lines.append(f"  - {q}")
    return "\n".join(lines)


def _summarize_checks(report: CheckReport) -> str:
    if not report.issues:
        return "Deterministic checks: no issues reported."
    lines = ["Deterministic check findings (already detected automatically):"]
    for i in report.issues:
        tag = " [heuristic]" if i.heuristic else ""
        lines.append(f"  - [{i.severity.value}] {i.code} ({i.element_ref}){tag}: {i.message}")
    return "\n".join(lines)


def build_shared_context(
    intent: DesignIntent, facts: GeometryFacts, report: CheckReport
) -> str:
    return (
        "You are reviewing a single-story house design (revision "
        f"{intent.revision}). Here is the current design and what automated "
        "checks have already found.\n\n"
        f"=== DESIGN INTENT ===\n{_summarize_intent(intent)}\n\n"
        f"=== AUTOMATED CHECKS ===\n{_summarize_checks(report)}\n\n"
        f"=== YOUR TASK ===\n{OUTPUT_CONTRACT}"
    )

"""Render the final "Design Basis & PE-Review Package" as Markdown.

Pure string templating over a :class:`JobResult` — no FreeCAD, no LLM — so it is
fully unit-testable. The PE disclaimer is emitted at both the top and bottom of
every report; a test asserts its presence so it can never regress.
"""

from __future__ import annotations

from typing import Optional

from ..council.roles import ROLE_TITLES, Role
from ..design_intent.schema import DesignIntent
from ..revision.orchestrator import IterationRecord, JobResult, JobStatus
from .disclaimer import DISCLAIMER_TITLE, PE_DISCLAIMER

_STATUS_TEXT = {
    JobStatus.complete_clean: (
        "Converged: no unresolved high/medium issues remained."
    ),
    JobStatus.complete_max_iterations_reached: (
        "Stopped at the iteration limit with open items remaining (listed below)."
    ),
    JobStatus.build_failed: "Stopped: the model could not be built.",
    JobStatus.revision_failed: "Stopped: an automated revision could not be applied.",
}


def _role_title(role_value: str) -> str:
    try:
        return ROLE_TITLES[Role(role_value)]
    except ValueError:
        return role_value


def _design_summary(intent: DesignIntent) -> str:
    fp = intent.footprint
    lines = [
        "## Design Summary",
        "",
        f"- **Footprint:** {fp.shape.value}, {fp.width_m:.1f} × {fp.depth_m:.1f} m "
        f"(eave height {fp.wall_height_m:.1f} m)",
        f"- **Stories:** {intent.stories}",
        f"- **Roof:** {intent.roof.roof_type.value}, pitch {intent.roof.pitch_ratio} "
        f"(rise/run), {intent.roof.overhang_m:.2f} m overhang",
        f"- **Foundation:** {intent.foundation.foundation_type.value} "
        f"({intent.foundation.slab_thickness_m * 1000:.0f} mm)",
        f"- **Rooms:** {len(intent.rooms)}, **Walls:** {len(intent.walls)}, "
        f"**Openings:** {len(intent.openings)}",
        "",
        "### Rooms",
        "",
        "| Room | Type | Area (m²) | Min ceiling (m) |",
        "| --- | --- | --- | --- |",
    ]
    for r in intent.rooms:
        lines.append(
            f"| {r.name or r.id} | {r.room_type.value} | {r.area_m2:.1f} | "
            f"{r.min_ceiling_height_m:.2f} |"
        )
    return "\n".join(lines)


def _assumptions(intent: DesignIntent) -> str:
    fa = intent.structural_framing_assumptions
    lines = [
        "## Assumptions & Design Basis",
        "",
        f"- **Floor / slab:** {fa.floor_joist_or_slab or 'unspecified'}",
        f"- **Roof framing:** {fa.roof_rafter_or_truss or 'unspecified'}",
        f"- **Wall studs:** {fa.wall_stud_spec or 'unspecified'}",
        f"- **Materials:** {intent.materials_notes or 'unspecified'}",
        f"- **Site / climate:** {intent.site.climate_notes or 'unspecified'}",
        "",
        f"> {fa.disclaimer}",
    ]
    if intent.open_questions:
        lines += ["", "### Open Questions (require human decision)", ""]
        lines += [f"- {q}" for q in intent.open_questions]
    return "\n".join(lines)


def _iteration_section(record: IterationRecord) -> str:
    lines = [f"### Revision {record.revision}", ""]

    # Deterministic checks
    lines.append("**Automated checks:**")
    lines.append("")
    if not record.check_report.issues:
        lines.append("- No issues found.")
    else:
        for i in record.check_report.issues:
            tag = " _(heuristic)_" if i.heuristic else ""
            lines.append(f"- `{i.severity.value}` **{i.code}** ({i.element_ref}){tag}: {i.message}")
    lines.append("")

    # Council findings
    lines.append("**Council of experts:**")
    lines.append("")
    any_findings = False
    for rf in record.role_findings:
        title = _role_title(rf.role)
        if rf.error:
            lines.append(f"- _{title}_: ⚠️ {rf.error}")
            any_findings = True
            continue
        for f in rf.findings:
            any_findings = True
            lines.append(
                f"- _{title}_ `{f.severity.value}` ({f.element_ref}): "
                f"{f.description} → **fix:** {f.recommended_fix}"
            )
    if not any_findings:
        lines.append("- No expert concerns raised.")
    lines.append("")

    # Synthesis
    lines.append("**Synthesis — prioritized action list:**")
    lines.append("")
    if record.synthesis.summary:
        lines.append(f"_{record.synthesis.summary}_")
        lines.append("")
    if not record.synthesis.action_items:
        lines.append("- (none)")
    else:
        for a in sorted(record.synthesis.action_items, key=lambda x: x.priority):
            conflict = " **[conflict resolved]**" if a.is_conflict else ""
            roles = ", ".join(_role_title(r) for r in a.contributing_roles)
            lines.append(
                f"{a.priority}. `{a.severity.value}`{conflict} **{a.title}** — "
                f"{a.rationale}" + (f" _(from: {roles})_" if roles else "")
            )
    lines.append("")

    # Revision action taken
    if record.revision_rationale or record.revision_error:
        lines.append("**Revision applied for next iteration:**")
        lines.append("")
        if record.revision_applied:
            lines.append(f"- ✅ {record.revision_rationale}")
        else:
            lines.append(
                f"- ❌ Not applied: {record.revision_error or 'no change'}"
            )
        lines.append("")
    return "\n".join(lines)


def _open_items(result: JobResult) -> str:
    lines = ["## Remaining Open Items", ""]
    unresolved = result.unresolved_items
    if not unresolved:
        lines.append(
            "No unresolved high/medium items remain from the automated review. "
            "A licensed professional must still perform the final review (see below)."
        )
    else:
        lines.append(
            "The following items were still open when the review loop stopped and "
            "must be resolved by the design team:"
        )
        lines.append("")
        for a in sorted(unresolved, key=lambda x: x.priority):
            lines.append(f"- `{a.severity.value}` **{a.title}** — {a.rationale}")
    return "\n".join(lines)


def _artifacts_section(manifest: Optional[dict]) -> str:
    lines = ["## Generated Artifacts", ""]
    if not manifest or not manifest.get("artifacts"):
        lines.append("- (no artifact manifest available)")
        return "\n".join(lines)
    lines.append("| Artifact | Status | Path |")
    lines.append("| --- | --- | --- |")
    for a in manifest["artifacts"]:
        lines.append(
            f"| {a.get('label', '')} | {a.get('status', '')} | "
            f"`{a.get('path', '') or '—'}` |"
        )
    return "\n".join(lines)


def render_report(
    result: JobResult,
    job_meta: Optional[dict] = None,
    manifest: Optional[dict] = None,
) -> str:
    intent = result.final_intent
    parts = [
        "# Design Basis & PE-Review Package",
        "",
        f"> **{DISCLAIMER_TITLE}**",
        "",
        PE_DISCLAIMER,
        "",
        "---",
        "",
        f"**Job status:** {_STATUS_TEXT.get(result.status, result.status.value)}",
        f"**Revisions produced:** {len(result.iterations)} "
        f"(final revision v{intent.revision})",
        "",
    ]
    if result.status == JobStatus.build_failed and result.build_error:
        parts += [f"**Build error:** {result.build_error}", ""]

    parts.append(_design_summary(intent))
    parts.append("")
    parts.append(_assumptions(intent))
    parts.append("")
    parts.append("## Review History")
    parts.append("")
    parts.append(
        "Each revision below records the automated checks, the six-role expert "
        "council, the synthesized action list, and the change made before the next "
        "iteration."
    )
    parts.append("")
    for record in result.iterations:
        parts.append(_iteration_section(record))
    parts.append(_open_items(result))
    parts.append("")
    parts.append(_artifacts_section(manifest))
    parts.append("")
    parts.append("---")
    parts.append("")
    parts.append(f"## {DISCLAIMER_TITLE}")
    parts.append("")
    parts.append(PE_DISCLAIMER)
    parts.append("")
    return "\n".join(parts)

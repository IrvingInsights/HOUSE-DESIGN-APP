"""Reconcile the six roles' findings + the deterministic checks into one list.

The reconciliation reasoning (dedup across roles, flagging genuine conflicts,
prioritizing) is done by the LLM — that's the judgment call. This module adds
only a thin, testable non-LLM pre-processing step: group findings by
``element_ref`` so the model receives a compact, organized input, and provide a
deterministic fallback if the LLM call fails.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from ..checks.report_types import CheckReport
from ..council.finding_types import RoleFindings
from ..llm.client import LLMClient
from .synthesis_types import ActionItem, SynthesisReport, synthesis_output_schema


def group_findings_by_element(
    role_findings: List[RoleFindings],
) -> Dict[str, List[dict]]:
    """Group every role's findings by the element they concern. Pure, testable,
    no LLM. Used both to build the synthesizer prompt and by tests."""
    grouped: Dict[str, List[dict]] = defaultdict(list)
    for rf in role_findings:
        for f in rf.findings:
            grouped[f.element_ref].append(
                {
                    "role": rf.role,
                    "severity": f.severity.value,
                    "description": f.description,
                    "recommended_fix": f.recommended_fix,
                }
            )
    return dict(grouped)


def _build_prompt(
    grouped: Dict[str, List[dict]], report: CheckReport
) -> str:
    lines = ["Expert findings grouped by the element each concerns:"]
    if not grouped:
        lines.append("  (no expert findings)")
    for element, items in grouped.items():
        lines.append(f"\nElement '{element}':")
        for it in items:
            lines.append(
                f"  - [{it['severity']}] {it['role']}: {it['description']} "
                f"=> fix: {it['recommended_fix']}"
            )
    lines.append("\nAutomated deterministic check findings:")
    if not report.issues:
        lines.append("  (none)")
    for i in report.issues:
        lines.append(f"  - [{i.severity.value}] {i.code} ({i.element_ref}): {i.message}")
    lines.append(
        "\nProduce a single prioritized, de-duplicated action list. Merge findings "
        "that say the same thing. Where experts directly conflict on the same "
        "element (e.g. one wants a large opening, another needs that wall solid "
        "for shear), create ONE action item with is_conflict=true that states the "
        "tradeoff and recommends a resolution. Order by priority (1 first), "
        "roughly following severity. Keep every high/medium deterministic check "
        "issue represented."
    )
    return "\n".join(lines)


_SYSTEM = (
    "You are the design lead chairing a review council. You receive findings from "
    "six specialists plus automated checks, and you reconcile them into one clear, "
    "prioritized action list for the next revision. You resolve conflicts "
    "explicitly rather than dropping either side. You never certify or stamp the "
    "design."
)


def _fallback_report(
    grouped: Dict[str, List[dict]], report: CheckReport
) -> SynthesisReport:
    """Deterministic synthesis used if the LLM call fails — keeps the loop alive
    and auditable rather than crashing."""
    items: List[ActionItem] = []
    priority = 1
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    flat = []
    for element, entries in grouped.items():
        for e in entries:
            flat.append((element, e))
    flat.sort(key=lambda pair: sev_rank.get(pair[1]["severity"], 3))
    for element, e in flat:
        items.append(
            ActionItem(
                priority=priority,
                severity=e["severity"],
                title=e["description"][:80],
                rationale=e["recommended_fix"],
                contributing_roles=[e["role"]],
                element_refs=[element],
            )
        )
        priority += 1
    return SynthesisReport(
        summary="Automated fallback synthesis (LLM synthesis unavailable).",
        action_items=items,
    )


def synthesize(
    role_findings: List[RoleFindings],
    report: CheckReport,
    client: LLMClient,
) -> SynthesisReport:
    grouped = group_findings_by_element(role_findings)
    try:
        result = client.complete_json(
            system=_SYSTEM,
            content=_build_prompt(grouped, report),
            schema=synthesis_output_schema(),
            schema_name="synthesis_report",
        )
        return SynthesisReport.model_validate(result)
    except Exception:  # noqa: BLE001 - degrade to deterministic synthesis
        return _fallback_report(grouped, report)

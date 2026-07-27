"""Report rendering: required sections present and disclaimer never missing."""

from house_design_studio.checks.report_types import CheckIssue, CheckReport, Severity
from house_design_studio.council.finding_types import Finding, RoleFindings
from house_design_studio.design_intent import load_design_intent
from house_design_studio.reporting.disclaimer import PE_DISCLAIMER
from house_design_studio.reporting.markdown_report import render_report
from house_design_studio.revision.orchestrator import (
    IterationRecord,
    JobResult,
    JobStatus,
)
from house_design_studio.synthesis.synthesis_types import ActionItem, SynthesisReport
from pathlib import Path

SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "design_intent" / "samples" / "simple_rectangle_1br.json"
)


def _result(status=JobStatus.complete_clean):
    intent = load_design_intent(SAMPLE)
    report = CheckReport(revision=1, issues=[
        CheckIssue(severity=Severity.medium, code="ceiling_too_low",
                   element_ref="room_bed", message="low", heuristic=True)
    ])
    rec = IterationRecord(
        revision=1, check_report=report,
        role_findings=[RoleFindings(role="architect", findings=[
            Finding(severity="medium", element_ref="room_bed",
                    description="tight", recommended_fix="widen")])],
        synthesis=SynthesisReport(summary="s", action_items=[
            ActionItem(priority=1, severity="medium", title="Widen",
                       rationale="tight")]),
        revision_rationale="widened", revision_applied=True,
    )
    return JobResult(status=status, final_intent=intent, iterations=[rec])


def test_report_has_all_sections():
    md = render_report(_result())
    for section in ("# Design Basis & PE-Review Package", "## Design Summary",
                    "## Assumptions & Design Basis", "## Review History",
                    "## Remaining Open Items", "### Revision 1"):
        assert section in md


def test_disclaimer_always_present():
    for status in JobStatus:
        md = render_report(_result(status))
        assert PE_DISCLAIMER in md, f"disclaimer missing for status {status}"


def test_report_shows_council_and_synthesis():
    md = render_report(_result())
    assert "Architect" in md
    assert "Widen" in md

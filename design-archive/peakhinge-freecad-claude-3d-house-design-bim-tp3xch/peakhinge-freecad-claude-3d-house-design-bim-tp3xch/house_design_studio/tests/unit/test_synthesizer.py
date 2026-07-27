"""Synthesizer grouping/fallback + council fan-out isolation."""

from house_design_studio.checks.report_types import CheckReport
from house_design_studio.council.finding_types import Finding, RoleFindings
from house_design_studio.llm.client import ScriptedClient
from house_design_studio.synthesis.synthesizer import (
    group_findings_by_element,
    synthesize,
)


def _role_findings():
    return [
        RoleFindings(role="architect", findings=[
            Finding(severity="high", element_ref="wall_south",
                    description="a", recommended_fix="fix a")]),
        RoleFindings(role="structural_engineer", findings=[
            Finding(severity="high", element_ref="wall_south",
                    description="b", recommended_fix="fix b")]),
        RoleFindings(role="project_manager", findings=[
            Finding(severity="low", element_ref="general",
                    description="c", recommended_fix="fix c")]),
    ]


def test_group_by_element():
    grouped = group_findings_by_element(_role_findings())
    assert set(grouped) == {"wall_south", "general"}
    assert len(grouped["wall_south"]) == 2  # two roles, same element


def test_synthesize_uses_llm_result():
    client = ScriptedClient(by_schema={
        "synthesis_report": {
            "summary": "ok",
            "action_items": [
                {"priority": 1, "severity": "high", "title": "Resolve shear vs window",
                 "rationale": "conflict", "is_conflict": True,
                 "element_refs": ["wall_south"]}
            ],
        }
    })
    report = synthesize(_role_findings(), CheckReport(), client)
    assert report.action_items[0].is_conflict is True
    assert report.unresolved_blocking  # high severity, unresolved


def test_synthesize_falls_back_when_llm_fails():
    # ScriptedClient with no scripted synthesis response -> raises -> fallback.
    client = ScriptedClient(responses=[])
    report = synthesize(_role_findings(), CheckReport(), client)
    assert "fallback" in report.summary.lower()
    # Fallback still surfaces the high-severity findings as action items.
    assert any(a.severity.value == "high" for a in report.action_items)

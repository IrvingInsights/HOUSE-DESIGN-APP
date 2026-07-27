"""Canned Claude responses + a ScriptedClient factory for pipeline tests."""

from __future__ import annotations

from house_design_studio.llm.client import ScriptedClient


def council_finding(severity="medium", element="room_bed"):
    return {
        "findings": [
            {
                "severity": severity,
                "element_ref": element,
                "description": "The bedroom feels cramped.",
                "recommended_fix": "Increase the bedroom's dimensions.",
            }
        ]
    }


def empty_findings():
    return {"findings": []}


def synthesis_with_item():
    return {
        "summary": "One issue to address.",
        "action_items": [
            {
                "priority": 1,
                "severity": "medium",
                "title": "Enlarge bedroom",
                "rationale": "Multiple experts noted it is tight.",
                "contributing_roles": ["architect"],
                "element_refs": ["room_bed"],
            }
        ],
    }


def synthesis_clean():
    return {"summary": "No blocking issues.", "action_items": []}


def proposal_set_ceiling(value=2.6):
    return {
        "rationale": "Adjust bedroom to resolve the flagged item.",
        "patch": [
            {"path": "rooms[0].min_ceiling_height_m", "op": "set", "value": value}
        ],
    }


def converging_client() -> ScriptedClient:
    """Council flags an issue on iteration 1, then everything is clean on
    iteration 2 — exercises exactly one revision."""
    state = {"i": 0}

    def expert(_c):
        return council_finding() if state["i"] == 0 else empty_findings()

    def synth(_c):
        return synthesis_with_item() if state["i"] == 0 else synthesis_clean()

    def propose(_c):
        state["i"] += 1
        return proposal_set_ceiling()

    return ScriptedClient(
        by_schema={
            "expert_findings": expert,
            "synthesis_report": synth,
            "revision_proposal": propose,
        }
    )

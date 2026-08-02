"""Structured output of the synthesis stage."""

from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class Severity(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class ActionItem(BaseModel):
    priority: int = Field(..., description="1 = address first.")
    severity: Severity
    title: str
    rationale: str
    contributing_roles: List[str] = Field(default_factory=list)
    element_refs: List[str] = Field(default_factory=list)
    is_conflict: bool = Field(
        False,
        description="True when this item reconciles directly conflicting expert "
        "recommendations (e.g. architect vs engineer on the same element).",
    )
    resolved: bool = Field(
        False,
        description="Whether this action item is considered addressed. Starts "
        "false; a later revision can mark it resolved.",
    )


class SynthesisReport(BaseModel):
    summary: str = ""
    action_items: List[ActionItem] = Field(default_factory=list)

    @property
    def unresolved_blocking(self) -> List[ActionItem]:
        return [
            a
            for a in self.action_items
            if a.severity in (Severity.high, Severity.medium) and not a.resolved
        ]


def synthesis_output_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "action_items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "priority": {"type": "integer"},
                        "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                        "title": {"type": "string"},
                        "rationale": {"type": "string"},
                        "contributing_roles": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "element_refs": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "is_conflict": {"type": "boolean"},
                    },
                    "required": ["priority", "severity", "title", "rationale"],
                },
            },
        },
        "required": ["summary", "action_items"],
    }

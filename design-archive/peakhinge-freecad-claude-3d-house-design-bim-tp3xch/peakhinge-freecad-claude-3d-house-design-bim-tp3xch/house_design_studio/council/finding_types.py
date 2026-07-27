"""Structured outputs of the council critique stage."""

from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Severity(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class Finding(BaseModel):
    severity: Severity
    element_ref: str = Field(
        "general",
        description="id of the wall/room/opening/site the finding concerns, or "
        "'general'.",
    )
    description: str = Field(..., description="What the concern is.")
    recommended_fix: str = Field(..., description="Concrete suggested change.")


class RoleFindings(BaseModel):
    role: str
    findings: List[Finding] = Field(default_factory=list)
    # Populated instead of findings when a role's API call failed, so one broken
    # role degrades gracefully rather than aborting the whole council.
    error: Optional[str] = None


# JSON schema handed to the LLM for a single role's structured output.
def role_output_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                        "element_ref": {"type": "string"},
                        "description": {"type": "string"},
                        "recommended_fix": {"type": "string"},
                    },
                    "required": ["severity", "description", "recommended_fix"],
                },
            }
        },
        "required": ["findings"],
    }

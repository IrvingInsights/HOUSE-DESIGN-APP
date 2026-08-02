"""Shared result types for the deterministic checks."""

from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class Severity(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


# Severities that the revision loop treats as "must try to resolve".
BLOCKING_SEVERITIES = {Severity.high, Severity.medium}


class CheckIssue(BaseModel):
    severity: Severity
    code: str = Field(..., description="Stable machine code, e.g. 'wall_overlap'.")
    message: str
    element_ref: str = Field(
        "general",
        description="id of the wall/room/opening involved, or 'site'/'general'.",
    )
    rule_id: str = Field(
        "",
        description="Which heuristic/constant produced this, for traceability.",
    )
    heuristic: bool = Field(
        False,
        description="True if this is a rule-of-thumb sanity check, not an exact "
        "geometric fact. Surfaced in the report so nothing reads as certified.",
    )


class CheckReport(BaseModel):
    revision: int = 1
    issues: List[CheckIssue] = Field(default_factory=list)

    def by_severity(self, severity: Severity) -> List[CheckIssue]:
        return [i for i in self.issues if i.severity == severity]

    @property
    def blocking_issues(self) -> List[CheckIssue]:
        return [i for i in self.issues if i.severity in BLOCKING_SEVERITIES]

    @property
    def is_clean(self) -> bool:
        return len(self.blocking_issues) == 0

    def extend(self, issues: List[CheckIssue]) -> None:
        self.issues.extend(issues)

"""Fan out the critique to all six roles and collect their findings."""

from __future__ import annotations

from typing import List

from ..bim_builder.geometry_facts import GeometryFacts
from ..checks.report_types import CheckReport
from ..design_intent.schema import DesignIntent
from ..llm.client import LLMClient
from .critique import run_role_critique
from .finding_types import RoleFindings
from .roles import all_roles


def run_council(
    intent: DesignIntent,
    facts: GeometryFacts,
    report: CheckReport,
    client: LLMClient,
) -> List[RoleFindings]:
    """Sequential fan-out (deterministic ordering for a clean audit trail). Each
    role is isolated, so one failing role does not abort the council."""
    return [
        run_role_critique(role, intent, facts, report, client)
        for role in all_roles()
    ]

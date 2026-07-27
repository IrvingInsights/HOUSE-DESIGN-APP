"""Run a single expert role's critique via the injectable LLM client."""

from __future__ import annotations

from ..bim_builder.geometry_facts import GeometryFacts
from ..checks.report_types import CheckReport
from ..design_intent.schema import DesignIntent
from ..llm.client import LLMClient
from .finding_types import Finding, RoleFindings, role_output_schema
from .prompts import ROLE_SYSTEM_PROMPTS, build_shared_context
from .roles import ROLE_TITLES, Role


def run_role_critique(
    role: Role,
    intent: DesignIntent,
    facts: GeometryFacts,
    report: CheckReport,
    client: LLMClient,
) -> RoleFindings:
    """Ask one role for structured findings. Never raises: an API/parse failure
    is captured on the returned object so the council as a whole degrades
    gracefully."""
    system = ROLE_SYSTEM_PROMPTS[role]
    context = build_shared_context(intent, facts, report)
    try:
        result = client.complete_json(
            system=system,
            content=context,
            schema=role_output_schema(),
            schema_name="expert_findings",
        )
        findings = [Finding.model_validate(f) for f in result.get("findings", [])]
        return RoleFindings(role=role.value, findings=findings)
    except Exception as exc:  # noqa: BLE001 - intentional: isolate role failures
        return RoleFindings(
            role=role.value,
            findings=[],
            error=f"{ROLE_TITLES[role]} critique failed: {exc}",
        )

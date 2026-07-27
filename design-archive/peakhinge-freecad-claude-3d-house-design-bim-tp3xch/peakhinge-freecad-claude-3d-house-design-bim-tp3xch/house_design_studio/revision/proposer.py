"""Ask the LLM to propose a targeted patch addressing the top action items."""

from __future__ import annotations

from typing import List

from ..design_intent.schema import DesignIntent
from ..design_intent.versioning import bump_revision
from ..llm.client import LLMClient
from ..synthesis.synthesis_types import SynthesisReport
from .apply_patch import PatchError, PatchOp, apply_patch


def _proposal_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "rationale": {"type": "string"},
            "patch": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "op": {"type": "string", "enum": ["set", "add", "remove"]},
                        "value": {},
                    },
                    "required": ["path", "op"],
                },
            },
        },
        "required": ["patch"],
    }


_SYSTEM = (
    "You revise a house Design Intent to resolve the highest-priority review "
    "items. You emit a minimal JSON patch (set/add/remove operations against the "
    "Design Intent) — not a whole new document. Change only what is needed. Keep "
    "every element's stable 'id'. Do not silently resolve items listed as open "
    "questions; leave those for the human. Stay within Phase 1 limits: single "
    "story, rectangular footprint, gable or shed roof, slab-on-grade foundation."
)


class RevisionResult:
    """Outcome of a proposal+apply attempt."""

    def __init__(
        self,
        intent: DesignIntent,
        rationale: str,
        ops: List[PatchOp],
        applied: bool,
        error: str = "",
    ):
        self.intent = intent
        self.rationale = rationale
        self.ops = ops
        self.applied = applied
        self.error = error


def _build_prompt(intent: DesignIntent, report: SynthesisReport) -> str:
    lines = [
        f"Current Design Intent (revision {intent.revision}):",
        intent.model_dump_json(indent=2),
        "\nUnresolved priority action items to address:",
    ]
    for a in report.unresolved_blocking:
        lines.append(
            f"  - (priority {a.priority}, {a.severity.value}) {a.title}: {a.rationale} "
            f"[elements: {', '.join(a.element_refs) or 'general'}]"
        )
    lines.append(
        "\nEmit a minimal patch that addresses as many of these as you safely can."
    )
    return "\n".join(lines)


def propose_and_apply(
    intent: DesignIntent,
    report: SynthesisReport,
    client: LLMClient,
) -> RevisionResult:
    """Get a patch from the LLM, apply and re-validate it, and return a bumped
    Design Intent. On any failure the original intent is returned with
    ``applied=False`` so the orchestrator can stop cleanly."""
    try:
        result = client.complete_json(
            system=_SYSTEM,
            content=_build_prompt(intent, report),
            schema=_proposal_schema(),
            schema_name="revision_proposal",
        )
    except Exception as exc:  # noqa: BLE001
        return RevisionResult(intent, "", [], applied=False, error=str(exc))

    rationale = result.get("rationale", "")
    try:
        ops = [PatchOp.model_validate(o) for o in result.get("patch", [])]
    except Exception as exc:  # noqa: BLE001
        return RevisionResult(intent, rationale, [], applied=False, error=str(exc))

    if not ops:
        return RevisionResult(
            intent, rationale, [], applied=False, error="Proposal contained no operations."
        )

    try:
        revised = apply_patch(intent, ops)
    except (PatchError, ValueError) as exc:
        return RevisionResult(intent, rationale, ops, applied=False, error=str(exc))

    revised = bump_revision(revised)
    return RevisionResult(revised, rationale, ops, applied=True)

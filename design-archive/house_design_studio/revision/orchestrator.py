"""The revision loop: build -> check -> council -> synthesize -> revise -> repeat.

The orchestrator is deliberately pure control flow over a bundle of injectable
stage callables (:class:`PipelineStages`). Production wiring supplies real
FreeCAD/Claude-backed stages; unit tests supply mocks. This is what lets the
entire loop — iteration counting, stopping conditions, snapshot persistence — be
tested with no FreeCAD and no API key.

Every iteration writes its Design Intent snapshot and all review artifacts to the
JobStore before deciding whether to continue, so the on-disk record is complete
even if a later stage fails.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, List, Optional

from ..bim_builder.geometry_facts import GeometryFacts
from ..checks.report_types import CheckReport
from ..council.finding_types import RoleFindings
from ..design_intent.schema import DesignIntent
from ..synthesis.synthesis_types import SynthesisReport
from .job_store import JobStore
from .proposer import RevisionResult


class JobStatus(str, Enum):
    complete_clean = "complete_clean"
    complete_max_iterations_reached = "complete_max_iterations_reached"
    build_failed = "build_failed"
    revision_failed = "revision_failed"


@dataclass
class BuildOutput:
    ok: bool
    facts: Optional[GeometryFacts] = None
    error: str = ""
    artifacts: dict = field(default_factory=dict)


@dataclass
class PipelineStages:
    build: Callable[[DesignIntent], BuildOutput]
    check: Callable[[GeometryFacts, DesignIntent], CheckReport]
    council: Callable[[DesignIntent, GeometryFacts, CheckReport], List[RoleFindings]]
    synthesize: Callable[[List[RoleFindings], CheckReport], SynthesisReport]
    propose: Callable[[DesignIntent, SynthesisReport], RevisionResult]


@dataclass
class IterationRecord:
    revision: int
    check_report: CheckReport
    role_findings: List[RoleFindings]
    synthesis: SynthesisReport
    build_artifacts: dict = field(default_factory=dict)
    revision_rationale: str = ""
    revision_applied: bool = False
    revision_error: str = ""


@dataclass
class JobResult:
    status: JobStatus
    final_intent: DesignIntent
    iterations: List[IterationRecord] = field(default_factory=list)
    build_error: str = ""

    @property
    def unresolved_items(self):
        if not self.iterations:
            return []
        return self.iterations[-1].synthesis.unresolved_blocking


ProgressCallback = Callable[[int, str], None]


def run_loop(
    intent: DesignIntent,
    store: JobStore,
    stages: PipelineStages,
    max_iterations: int = 5,
    progress: Optional[ProgressCallback] = None,
) -> JobResult:
    store.ensure()

    def _notify(rev: int, msg: str) -> None:
        if progress is not None:
            progress(rev, msg)

    current = intent
    records: List[IterationRecord] = []

    for iteration in range(1, max_iterations + 1):
        rev = current.revision
        store.write_snapshot(current)
        _notify(rev, f"Iteration {iteration}: building model")

        build = stages.build(current)
        if not build.ok or build.facts is None:
            store.write_review(rev, "build", {"ok": False, "error": build.error})
            return JobResult(
                status=JobStatus.build_failed,
                final_intent=current,
                iterations=records,
                build_error=build.error,
            )
        store.write_geometry_facts(rev, build.facts)
        store.write_review(rev, "build", {"ok": True, "artifacts": build.artifacts})

        _notify(rev, f"Iteration {iteration}: running checks")
        report = stages.check(build.facts, current)
        store.write_review(rev, "checks", report)

        _notify(rev, f"Iteration {iteration}: convening council")
        council = stages.council(current, build.facts, report)
        store.write_review(
            rev, "council", {"roles": [c.model_dump() for c in council]}
        )

        _notify(rev, f"Iteration {iteration}: synthesizing")
        synthesis = stages.synthesize(council, report)
        store.write_review(rev, "synthesis", synthesis)

        record = IterationRecord(
            revision=rev,
            check_report=report,
            role_findings=council,
            synthesis=synthesis,
            build_artifacts=build.artifacts,
        )
        records.append(record)

        unresolved = synthesis.unresolved_blocking
        if not unresolved:
            return JobResult(JobStatus.complete_clean, current, records)
        if iteration >= max_iterations:
            return JobResult(
                JobStatus.complete_max_iterations_reached, current, records
            )

        _notify(rev, f"Iteration {iteration}: proposing revision")
        revision = stages.propose(current, synthesis)
        record.revision_rationale = revision.rationale
        record.revision_applied = revision.applied
        record.revision_error = revision.error
        store.write_review(
            rev,
            "revision",
            {
                "rationale": revision.rationale,
                "applied": revision.applied,
                "error": revision.error,
                "ops": [o.model_dump() for o in revision.ops],
            },
        )
        if not revision.applied:
            return JobResult(JobStatus.revision_failed, current, records)

        current = revision.intent

    # Unreachable in practice (the max-iterations branch returns above), but keep
    # a definite terminal result for safety.
    return JobResult(JobStatus.complete_max_iterations_reached, current, records)

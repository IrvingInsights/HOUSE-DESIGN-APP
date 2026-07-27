"""Revision-loop control flow, driven entirely by mocked stages (no FreeCAD/LLM)."""

from pathlib import Path

from house_design_studio.bim_builder.dev_geometry import design_intent_to_facts
from house_design_studio.checks.report_types import CheckReport
from house_design_studio.council.finding_types import RoleFindings
from house_design_studio.design_intent import load_design_intent
from house_design_studio.design_intent.versioning import bump_revision
from house_design_studio.revision.job_store import JobStore
from house_design_studio.revision.orchestrator import (
    BuildOutput,
    JobStatus,
    PipelineStages,
    run_loop,
)
from house_design_studio.revision.proposer import RevisionResult
from house_design_studio.synthesis.synthesis_types import ActionItem, SynthesisReport

SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "design_intent" / "samples" / "simple_rectangle_1br.json"
)


def _intent():
    return load_design_intent(SAMPLE)


def _build_ok(di):
    return BuildOutput(ok=True, facts=design_intent_to_facts(di), artifacts={})


def _no_checks(facts, di):
    return CheckReport(revision=di.revision)


def _no_council(di, facts, rep):
    return [RoleFindings(role="architect", findings=[])]


def _blocking_item():
    return SynthesisReport(
        action_items=[ActionItem(priority=1, severity="medium", title="x", rationale="y")]
    )


def test_converges_when_synthesis_clean(tmp_path):
    store = JobStore(tmp_path / "job")
    stages = PipelineStages(
        build=_build_ok, check=_no_checks, council=_no_council,
        synthesize=lambda cf, rep: SynthesisReport(action_items=[]),
        propose=lambda di, syn: RevisionResult(di, "", [], applied=True),
    )
    result = run_loop(_intent(), store, stages, max_iterations=5)
    assert result.status == JobStatus.complete_clean
    assert len(result.iterations) == 1
    assert store.list_revisions() == [1]


def test_stops_at_max_iterations_with_open_items(tmp_path):
    store = JobStore(tmp_path / "job")

    def propose(di, syn):
        return RevisionResult(bump_revision(di), "tweak", [], applied=True)

    stages = PipelineStages(
        build=_build_ok, check=_no_checks, council=_no_council,
        synthesize=lambda cf, rep: _blocking_item(),  # never clean
        propose=propose,
    )
    result = run_loop(_intent(), store, stages, max_iterations=3)
    assert result.status == JobStatus.complete_max_iterations_reached
    assert len(result.iterations) == 3
    assert store.list_revisions() == [1, 2, 3]  # a snapshot per iteration
    assert result.unresolved_items  # open items reported


def test_build_failure_stops_cleanly(tmp_path):
    store = JobStore(tmp_path / "job")
    stages = PipelineStages(
        build=lambda di: BuildOutput(ok=False, error="unsupported footprint"),
        check=_no_checks, council=_no_council,
        synthesize=lambda cf, rep: SynthesisReport(action_items=[]),
        propose=lambda di, syn: RevisionResult(di, "", [], applied=True),
    )
    result = run_loop(_intent(), store, stages, max_iterations=5)
    assert result.status == JobStatus.build_failed
    assert "unsupported" in result.build_error
    assert result.iterations == []


def test_revision_failure_stops_cleanly(tmp_path):
    store = JobStore(tmp_path / "job")
    stages = PipelineStages(
        build=_build_ok, check=_no_checks, council=_no_council,
        synthesize=lambda cf, rep: _blocking_item(),
        propose=lambda di, syn: RevisionResult(di, "bad", [], applied=False,
                                               error="patch invalid"),
    )
    result = run_loop(_intent(), store, stages, max_iterations=5)
    assert result.status == JobStatus.revision_failed
    assert len(result.iterations) == 1


def test_progress_callback_invoked(tmp_path):
    store = JobStore(tmp_path / "job")
    seen = []
    stages = PipelineStages(
        build=_build_ok, check=_no_checks, council=_no_council,
        synthesize=lambda cf, rep: SynthesisReport(action_items=[]),
        propose=lambda di, syn: RevisionResult(di, "", [], applied=True),
    )
    run_loop(_intent(), store, stages, max_iterations=5,
             progress=lambda rev, msg: seen.append(msg))
    assert seen  # progress messages were emitted

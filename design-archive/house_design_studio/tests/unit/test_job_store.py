"""JobStore filesystem operations."""

from house_design_studio.design_intent import load_design_intent
from house_design_studio.design_intent.versioning import bump_revision
from house_design_studio.revision.job_store import JobStore
from pathlib import Path

SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "design_intent" / "samples" / "simple_rectangle_1br.json"
)


def test_ensure_creates_layout(tmp_path):
    store = JobStore(tmp_path / "job").ensure()
    for d in (store.design_intent_dir, store.reviews_dir, store.model_dir,
              store.drawings_dir, store.export_dir, store.report_dir):
        assert d.exists()


def test_snapshots_are_numbered_and_not_overwritten(tmp_path):
    store = JobStore(tmp_path / "job").ensure()
    intent = load_design_intent(SAMPLE)
    store.write_snapshot(intent)
    store.write_snapshot(bump_revision(intent))
    assert store.list_revisions() == [1, 2]
    assert store.load_snapshot(2).revision == 2


def test_job_meta_roundtrip(tmp_path):
    store = JobStore(tmp_path / "job").ensure()
    store.write_job_meta({"job_id": "j1", "status": "running"})
    meta = store.read_job_meta()
    assert meta["status"] == "running"
    assert "updated_at" in meta


def test_write_review(tmp_path):
    store = JobStore(tmp_path / "job").ensure()
    store.write_review(1, "checks", {"issues": []})
    assert (store.reviews_dir / "v1_checks.json").exists()

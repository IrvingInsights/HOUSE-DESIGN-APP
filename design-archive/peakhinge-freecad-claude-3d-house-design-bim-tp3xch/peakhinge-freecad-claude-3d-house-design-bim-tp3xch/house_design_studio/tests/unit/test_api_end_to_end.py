"""Offline end-to-end run through the FastAPI app (dev mode + mock Claude).

Exercises the entire pipeline — create job, run the loop, produce report and
manifest — with no FreeCAD and no API key.
"""

import time

import pytest

from house_design_studio.backend.app import create_app
from house_design_studio.backend.config import Config

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


def _client(tmp_path):
    config = Config(
        data_dir=tmp_path,
        max_iterations=5,
        force_dev_mode=True,
        mock_claude=True,
        freecad_cmd=None,
        anthropic_api_key=None,
    )
    return TestClient(create_app(config))


def _run_to_done(client, job_id, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = client.get(f"/api/jobs/{job_id}").json()
        if s["status"] in ("done", "error"):
            return s
        time.sleep(0.05)
    raise AssertionError("job did not finish in time")


def test_health(tmp_path):
    resp = _client(tmp_path).get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["mock_claude"] is True


def test_sample_job_runs_end_to_end(tmp_path):
    client = _client(tmp_path)
    resp = client.post("/api/jobs", data={"use_sample": "true"})
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]

    status = _run_to_done(client, job_id)
    assert status["status"] == "done", status
    assert status["result_status"] == "complete_clean"

    report = client.get(f"/api/jobs/{job_id}/report")
    assert report.status_code == 200
    assert "NOT A STAMPED ENGINEERING DOCUMENT" in report.text

    manifest = client.get(f"/api/jobs/{job_id}/manifest").json()
    assert manifest["status"] == "complete_clean"
    # In dev mode, FreeCAD artifacts are explicitly marked skipped, not omitted.
    labels = {a["label"]: a["status"] for a in manifest["artifacts"]}
    assert any("dev mode" in s for s in labels.values())


def test_empty_request_rejected(tmp_path):
    client = _client(tmp_path)
    resp = client.post("/api/jobs", data={})
    assert resp.status_code == 400


def test_unknown_job_404(tmp_path):
    assert _client(tmp_path).get("/api/jobs/nope").status_code == 404


def test_artifact_path_traversal_blocked(tmp_path):
    client = _client(tmp_path)
    job_id = client.post("/api/jobs", data={"use_sample": "true"}).json()["job_id"]
    _run_to_done(client, job_id)
    resp = client.get(f"/api/jobs/{job_id}/artifacts/../../../../etc/passwd")
    assert resp.status_code in (400, 404)

"""Routes: query job status, fetch the report/manifest, download artifacts."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse

from ..schemas_api import JobStatusResponse

router = APIRouter()


def _store(request: Request, job_id: str):
    store = request.app.state.job_manager.job_store(job_id)
    if not store.root.exists():
        raise HTTPException(status_code=404, detail=f"Unknown job '{job_id}'.")
    return store


@router.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_status(request: Request, job_id: str) -> JobStatusResponse:
    store = _store(request, job_id)
    meta = store.read_job_meta()
    return JobStatusResponse(
        job_id=job_id,
        status=meta.get("status", "unknown"),
        progress=meta.get("progress", []),
        current_revision=meta.get("current_revision"),
        result_status=meta.get("result_status"),
        iterations=meta.get("iterations"),
        final_revision=meta.get("final_revision"),
        dev_mode=meta.get("dev_mode"),
        error=meta.get("error"),
    )


@router.get("/api/jobs/{job_id}/manifest")
async def get_manifest(request: Request, job_id: str):
    store = _store(request, job_id)
    path = store.root / "manifest.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Manifest not ready yet.")
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/api/jobs/{job_id}/report", response_class=PlainTextResponse)
async def get_report(request: Request, job_id: str) -> str:
    store = _store(request, job_id)
    path = store.report_dir / "design_basis_package.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Report not ready yet.")
    return path.read_text(encoding="utf-8")


@router.get("/api/jobs/{job_id}/council-transcript")
async def get_transcript(request: Request, job_id: str):
    """Return every review artifact on disk, keyed by filename, for full audit."""
    store = _store(request, job_id)
    out = {}
    for p in sorted(store.reviews_dir.glob("*.json")):
        out[p.name] = json.loads(p.read_text(encoding="utf-8"))
    return out


@router.get("/api/jobs/{job_id}/artifacts/{artifact_path:path}")
async def download_artifact(request: Request, job_id: str, artifact_path: str):
    store = _store(request, job_id)
    # Resolve within the job root and reject any path traversal.
    target = (store.root / artifact_path).resolve()
    root = store.root.resolve()
    if root not in target.parents and target != root:
        raise HTTPException(status_code=400, detail="Invalid artifact path.")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found.")
    return FileResponse(str(target), filename=Path(artifact_path).name)

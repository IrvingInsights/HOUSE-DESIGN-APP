"""Route: create and launch a design job from a brief (text and/or images)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from ...design_intent.schema import DesignIntent
from ...translator.image_prep import ImagePrepError, prepare_image_bytes
from ..schemas_api import CreateJobResponse

router = APIRouter()

_SAMPLE_PATH = (
    Path(__file__).resolve().parents[2]
    / "design_intent"
    / "samples"
    / "simple_rectangle_1br.json"
)


@router.post("/api/jobs", response_model=CreateJobResponse)
async def create_job(
    request: Request,
    text: Optional[str] = Form(None),
    use_sample: bool = Form(False),
    images: List[UploadFile] = File(default_factory=list),
) -> CreateJobResponse:
    manager = request.app.state.job_manager

    intent: Optional[DesignIntent] = None
    image_blocks: List[dict] = []

    if use_sample:
        intent = DesignIntent.model_validate_json(
            _SAMPLE_PATH.read_text(encoding="utf-8")
        )
    else:
        for upload in images:
            raw = await upload.read()
            if not raw:
                continue
            try:
                image_blocks.append(prepare_image_bytes(raw))
            except ImagePrepError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
        if not text and not image_blocks:
            raise HTTPException(
                status_code=400,
                detail="Provide a description, upload an image, or use the sample.",
            )

    job_id = manager.create_job(text=text, image_blocks=image_blocks, intent=intent)
    manager.start_job(job_id)
    return CreateJobResponse(job_id=job_id)

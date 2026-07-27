"""Transport (request/response) models for the HTTP API.

Distinct from design_intent/schema.py — these describe the wire shapes, not the
design itself.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class CreateJobResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: List[str] = []
    current_revision: Optional[int] = None
    result_status: Optional[str] = None
    iterations: Optional[int] = None
    final_revision: Optional[int] = None
    dev_mode: Optional[bool] = None
    error: Optional[str] = None

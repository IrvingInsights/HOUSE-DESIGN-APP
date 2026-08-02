"""On-disk layout for a single design run ("job").

Every iteration's Design Intent snapshot and full review report is written here
and never overwritten — this directory *is* the audit trail. Layout:

    <root>/<job_id>/
        inputs/                 uploaded images, original brief
        design_intent/v{n}.json
        reviews/v{n}_checks.json, v{n}_council.json, v{n}_synthesis.json,
                v{n}_revision.json
        model/                  FCStd + geometry_facts.json per revision
        drawings/               TechDraw PDFs/SVGs
        export/                 IFC / STEP
        report/                 design_basis_package.md
        manifest.json           artifact index for the UI
        job.json                live job metadata (status, current iteration)
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List

from ..design_intent.schema import DesignIntent


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file + os.replace so a concurrent reader never sees a
    half-written file (the status poller reads job.json while the worker writes)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


class JobStore:
    def __init__(self, root: Path | str):
        self.root = Path(root)

    @property
    def inputs_dir(self) -> Path:
        return self.root / "inputs"

    @property
    def design_intent_dir(self) -> Path:
        return self.root / "design_intent"

    @property
    def reviews_dir(self) -> Path:
        return self.root / "reviews"

    @property
    def model_dir(self) -> Path:
        return self.root / "model"

    @property
    def drawings_dir(self) -> Path:
        return self.root / "drawings"

    @property
    def export_dir(self) -> Path:
        return self.root / "export"

    @property
    def report_dir(self) -> Path:
        return self.root / "report"

    def ensure(self) -> "JobStore":
        for d in (
            self.inputs_dir,
            self.design_intent_dir,
            self.reviews_dir,
            self.model_dir,
            self.drawings_dir,
            self.export_dir,
            self.report_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)
        return self

    # --- writers ----------------------------------------------------------- #

    def write_snapshot(self, intent: DesignIntent) -> Path:
        path = self.design_intent_dir / f"v{intent.revision}.json"
        path.write_text(
            intent.model_dump_json(indent=2, round_trip=True), encoding="utf-8"
        )
        return path

    def write_review(self, revision: int, kind: str, payload: Any) -> Path:
        """kind in {checks, council, synthesis, revision}."""
        path = self.reviews_dir / f"v{revision}_{kind}.json"
        text = (
            payload.model_dump_json(indent=2)
            if hasattr(payload, "model_dump_json")
            else json.dumps(payload, indent=2, default=str)
        )
        path.write_text(text, encoding="utf-8")
        return path

    def write_geometry_facts(self, revision: int, facts: Any) -> Path:
        path = self.model_dir / f"geometry_facts_v{revision}.json"
        text = (
            facts.model_dump_json(indent=2)
            if hasattr(facts, "model_dump_json")
            else json.dumps(facts, indent=2, default=str)
        )
        path.write_text(text, encoding="utf-8")
        return path

    def write_job_meta(self, meta: dict) -> Path:
        meta = {**meta, "updated_at": datetime.now(timezone.utc).isoformat()}
        path = self.root / "job.json"
        _atomic_write(path, json.dumps(meta, indent=2, default=str))
        return path

    def read_job_meta(self) -> dict:
        path = self.root / "job.json"
        if not path.exists():
            return {}
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            return {}
        return json.loads(text)

    def write_manifest(self, manifest: dict) -> Path:
        path = self.root / "manifest.json"
        _atomic_write(path, json.dumps(manifest, indent=2, default=str))
        return path

    # --- readers ----------------------------------------------------------- #

    def list_revisions(self) -> List[int]:
        revs = []
        for p in self.design_intent_dir.glob("v*.json"):
            try:
                revs.append(int(p.stem[1:]))
            except ValueError:
                continue
        return sorted(revs)

    def load_snapshot(self, revision: int) -> DesignIntent:
        path = self.design_intent_dir / f"v{revision}.json"
        return DesignIntent.model_validate_json(path.read_text(encoding="utf-8"))

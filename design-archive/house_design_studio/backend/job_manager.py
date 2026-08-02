"""Coordinate a full design run in the background and track its state.

This is the production wiring of :class:`PipelineStages`: it translates the
brief, runs the revision loop, and (on a real FreeCAD machine) generates the
drawing/export deliverables, then renders the report and manifest. A single
background thread per job is sufficient for a local desktop tool.

Job state is both held in memory (for fast status polling) and mirrored to
``job.json`` in the job directory (so it survives and is inspectable).
"""

from __future__ import annotations

import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from ..bim_builder.runner import FreeCADBuilder, select_builder
from ..checks.run_all_checks import run_all_checks
from ..council.run_council import run_council
from ..design_intent.schema import DesignIntent
from ..llm.client import LLMClient
from ..reporting.manifest import build_manifest, manifest_relative
from ..reporting.markdown_report import render_report
from ..revision.job_store import JobStore
from ..revision.orchestrator import (
    JobStatus,
    PipelineStages,
    run_loop,
)
from ..revision.proposer import propose_and_apply
from ..synthesis.synthesizer import synthesize
from ..translator.translate import translate_brief
from .config import Config


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobManager:
    def __init__(self, config: Config, client: LLMClient):
        self.config = config
        self.client = client
        self.config.data_dir.mkdir(parents=True, exist_ok=True)
        self._threads: Dict[str, threading.Thread] = {}
        self._pending: Dict[str, dict] = {}

    # --- job lifecycle ----------------------------------------------------- #

    def create_job(
        self,
        text: Optional[str] = None,
        image_blocks: Optional[List[dict]] = None,
        intent: Optional[DesignIntent] = None,
    ) -> str:
        job_id = f"job_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}_{uuid.uuid4().hex[:6]}"
        store = JobStore(self.config.data_dir / job_id).ensure()
        store.write_job_meta(
            {
                "job_id": job_id,
                "status": "created",
                "created_at": _now(),
                "current_revision": None,
                "progress": ["Job created."],
                "brief": text,
                "has_images": bool(image_blocks),
            }
        )
        # Stash inputs for the background thread (kept in memory, not persisted raw).
        self._pending[job_id] = {
            "text": text,
            "image_blocks": image_blocks or [],
            "intent": intent,
        }
        return job_id

    def start_job(self, job_id: str) -> None:
        thread = threading.Thread(target=self._run, args=(job_id,), daemon=True)
        self._threads[job_id] = thread
        thread.start()

    def get_meta(self, job_id: str) -> dict:
        return JobStore(self.config.data_dir / job_id).read_job_meta()

    def job_store(self, job_id: str) -> JobStore:
        return JobStore(self.config.data_dir / job_id)

    # --- the run ----------------------------------------------------------- #

    def _run(self, job_id: str) -> None:
        store = self.job_store(job_id)
        meta = store.read_job_meta()
        progress: List[str] = meta.get("progress", [])

        def _update(status: str, **extra) -> None:
            meta.update({"status": status, "progress": progress, **extra})
            store.write_job_meta(meta)

        def _progress(rev: int, msg: str) -> None:
            progress.append(msg)
            meta["current_revision"] = rev
            _update("running")

        try:
            pending = self._pending.pop(job_id, {})
            intent: Optional[DesignIntent] = pending.get("intent")

            if intent is None:
                _update("translating")
                progress.append("Translating brief into a Design Intent...")
                intent = translate_brief(
                    pending.get("text"), pending.get("image_blocks"), self.client
                )
            # Persist original inputs alongside the design.
            store.write_snapshot(intent)

            builder, is_dev = select_builder(
                force_dev_mode=self.config.force_dev_mode,
                freecad_cmd=self.config.freecad_cmd,
            )
            progress.append(
                "Building with " + ("dev-mode geometry (no FreeCAD)." if is_dev
                                    else "FreeCAD.")
            )
            _update("running")

            stages = PipelineStages(
                build=lambda di: builder.build(di, store),
                check=lambda facts, di: run_all_checks(facts, di),
                council=lambda di, facts, rep: run_council(di, facts, rep, self.client),
                synthesize=lambda cf, rep: synthesize(cf, rep, self.client),
                propose=lambda di, syn: propose_and_apply(di, syn, self.client),
            )

            result = run_loop(
                intent, store, stages,
                max_iterations=self.config.max_iterations,
                progress=_progress,
            )

            # --- deliverables -------------------------------------------- #
            drawings: dict = {}
            exports: dict = {}
            model_path = None
            final_rev = result.final_intent.revision
            if (
                isinstance(builder, FreeCADBuilder)
                and result.status in (
                    JobStatus.complete_clean,
                    JobStatus.complete_max_iterations_reached,
                )
            ):
                progress.append("Generating drawings and exports...")
                _update("finalizing")
                drawings = builder.generate_drawings(final_rev, store)
                exports = builder.export_models(final_rev, store)
                fcstd = store.model_dir / f"house_v{final_rev}.FCStd"
                model_path = str(fcstd) if fcstd.exists() else None

            report_path = store.report_dir / "design_basis_package.md"
            manifest = build_manifest(
                job_id=job_id,
                status=result.status.value,
                report_path=manifest_relative(report_path, store.root),
                drawings={k: manifest_relative(Path(v), store.root) if v else None
                          for k, v in drawings.items()},
                exports={k: manifest_relative(Path(v), store.root) if v else None
                         for k, v in exports.items()},
                model_path=manifest_relative(Path(model_path), store.root)
                if model_path else None,
                dev_mode=is_dev,
            )
            report_md = render_report(result, job_meta=meta, manifest=manifest)
            report_path.write_text(report_md, encoding="utf-8")
            store.write_manifest(manifest)

            progress.append(f"Done: {result.status.value}.")
            _update(
                "done",
                result_status=result.status.value,
                iterations=len(result.iterations),
                final_revision=final_rev,
                dev_mode=is_dev,
            )
        except Exception as exc:  # noqa: BLE001
            progress.append(f"Error: {exc}")
            meta["progress"] = progress
            meta["error"] = str(exc)
            meta["traceback"] = traceback.format_exc()
            store.write_job_meta({**meta, "status": "error"})

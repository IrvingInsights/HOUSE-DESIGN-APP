"""Build the artifact manifest consumed by the frontend results view.

Each artifact has a label, a status ("generated" / "skipped: ..."), and a path
relative to the job directory (or null). Skipped artifacts (e.g. FreeCAD outputs
in dev mode) are listed explicitly so the UI and report state what was NOT
produced rather than silently omitting them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional


def build_manifest(
    job_id: str,
    status: str,
    report_path: Optional[str],
    drawings: Optional[Dict[str, Optional[str]]] = None,
    exports: Optional[Dict[str, Optional[str]]] = None,
    model_path: Optional[str] = None,
    dev_mode: bool = False,
) -> dict:
    artifacts: List[dict] = []

    def _add(label: str, path: Optional[str]) -> None:
        if path:
            artifacts.append({"label": label, "status": "generated", "path": path})
        else:
            reason = "skipped: dev mode (FreeCAD not run)" if dev_mode else "not produced"
            artifacts.append({"label": label, "status": reason, "path": None})

    _add("Design Basis & PE-Review Package (Markdown)", report_path)
    _add("BIM model (FreeCAD .FCStd)", model_path)

    drawings = drawings or {}
    for name in ("floor_plan", "elevation_north", "elevation_south",
                 "elevation_east", "elevation_west", "section_a", "roof_plan"):
        _add(f"Drawing: {name.replace('_', ' ').title()}", drawings.get(name))

    exports = exports or {}
    _add("IFC export", exports.get("ifc"))
    _add("STEP export", exports.get("step"))

    return {"job_id": job_id, "status": status, "artifacts": artifacts}


def manifest_relative(path: Optional[Path], job_root: Path) -> Optional[str]:
    """Best-effort relative path for the manifest; falls back to str(path)."""
    if path is None:
        return None
    try:
        return str(Path(path).relative_to(job_root))
    except ValueError:
        return str(path)

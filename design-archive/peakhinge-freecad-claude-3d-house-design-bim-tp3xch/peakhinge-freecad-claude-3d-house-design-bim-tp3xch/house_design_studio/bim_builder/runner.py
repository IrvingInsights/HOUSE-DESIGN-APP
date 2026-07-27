"""Host-side build orchestration. Never imports FreeCAD.

Two builders share one interface (``build(intent, store) -> BuildOutput``):

- :class:`DevModeBuilder` — derives GeometryFacts in pure Python. Runs anywhere,
  including this sandbox; used when FreeCAD is absent or dev mode is forced.
- :class:`FreeCADBuilder` — invokes ``FreeCADCmd`` as a subprocess to run the
  FreeCAD-side scripts (``build_house.py`` etc.), then reads back the
  ``geometry_facts.json`` they emit.

The probe for a FreeCAD executable mirrors the technique used elsewhere in the
repo (env var → PATH → common install locations), written fresh here.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from ..design_intent.schema import DesignIntent
from ..design_intent.validator import phase1_unsupported_reasons
from ..revision.job_store import JobStore
from ..revision.orchestrator import BuildOutput
from .dev_geometry import design_intent_to_facts
from .geometry_facts import GeometryFacts

_SCRIPT_DIR = Path(__file__).resolve().parent

_COMMON_FREECAD_PATHS = [
    r"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe",
    r"C:\Program Files\FreeCAD 1.1\bin\FreeCADCmd.exe",
    r"C:\Program Files\FreeCAD\bin\FreeCADCmd.exe",
    "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd",
    "/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd",
    "/usr/bin/freecadcmd",
    "/usr/local/bin/freecadcmd",
]


def probe_freecad_cmd(explicit: Optional[str] = None) -> Optional[str]:
    candidates = [
        explicit,
        os.getenv("HDS_FREECAD_CMD"),
        shutil.which("FreeCADCmd"),
        shutil.which("freecadcmd"),
        shutil.which("FreeCADCmd.exe"),
    ]
    candidates.extend(_COMMON_FREECAD_PATHS)
    for c in candidates:
        if c and Path(c).exists():
            return c
    return None


class DevModeBuilder:
    """Pure-Python geometry; no FreeCAD, no artifacts. Marks skipped outputs."""

    produced_by = "dev_mode"

    def build(self, intent: DesignIntent, store: JobStore) -> BuildOutput:
        reasons = phase1_unsupported_reasons(intent)
        if reasons:
            return BuildOutput(ok=False, error="; ".join(reasons))
        facts = design_intent_to_facts(intent)
        return BuildOutput(
            ok=True,
            facts=facts,
            artifacts={
                "mode": "dev_mode",
                "fcstd": None,
                "note": "FreeCAD not run; geometry derived in Python.",
            },
        )


class FreeCADBuilder:
    """Invoke FreeCADCmd to build a real Arch/BIM model and extract facts."""

    produced_by = "freecad"

    def __init__(self, freecad_cmd: str, timeout_s: int = 180):
        self.freecad_cmd = freecad_cmd
        self.timeout_s = timeout_s

    def _run_script(self, script: str, args: list[str]) -> subprocess.CompletedProcess:
        cmd = [self.freecad_cmd, "-c", str(_SCRIPT_DIR / script), *args]
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=self.timeout_s, check=False
        )

    def build(self, intent: DesignIntent, store: JobStore) -> BuildOutput:
        reasons = phase1_unsupported_reasons(intent)
        if reasons:
            return BuildOutput(ok=False, error="; ".join(reasons))

        store.ensure()
        intent_path = store.model_dir / f"intent_v{intent.revision}.json"
        intent_path.write_text(
            intent.model_dump_json(indent=2, round_trip=True), encoding="utf-8"
        )
        facts_path = store.model_dir / f"geometry_facts_v{intent.revision}.json"
        fcstd_path = store.model_dir / f"house_v{intent.revision}.FCStd"

        proc = self._run_script(
            "build_house.py",
            [str(intent_path), str(fcstd_path), str(facts_path)],
        )
        if proc.returncode != 0 or not facts_path.exists():
            return BuildOutput(
                ok=False,
                error=(
                    "FreeCAD build failed (rc="
                    f"{proc.returncode}). stderr tail: {proc.stderr[-800:]}"
                ),
            )
        try:
            facts = GeometryFacts.model_validate_json(
                facts_path.read_text(encoding="utf-8")
            )
        except Exception as exc:  # noqa: BLE001
            return BuildOutput(ok=False, error=f"Could not read geometry facts: {exc}")

        return BuildOutput(
            ok=True,
            facts=facts,
            artifacts={
                "mode": "freecad",
                "fcstd": str(fcstd_path),
                "intent": str(intent_path),
            },
        )

    def generate_drawings(self, revision: int, store: JobStore) -> dict:
        """Run TechDraw sheet generation. Returns {name: path|None}."""
        fcstd_path = store.model_dir / f"house_v{revision}.FCStd"
        proc = self._run_script(
            "techdraw_sheets.py", [str(fcstd_path), str(store.drawings_dir)]
        )
        try:
            return json.loads(proc.stdout.strip().splitlines()[-1])
        except Exception:  # noqa: BLE001
            return {}

    def export_models(self, revision: int, store: JobStore) -> dict:
        fcstd_path = store.model_dir / f"house_v{revision}.FCStd"
        proc = self._run_script(
            "exporters.py", [str(fcstd_path), str(store.export_dir)]
        )
        try:
            return json.loads(proc.stdout.strip().splitlines()[-1])
        except Exception:  # noqa: BLE001
            return {}


def select_builder(
    force_dev_mode: bool = False, freecad_cmd: Optional[str] = None
):
    """Return (builder, is_dev_mode). Falls back to dev mode when FreeCAD is not
    found, so the app is always runnable."""
    if force_dev_mode:
        return DevModeBuilder(), True
    cmd = probe_freecad_cmd(freecad_cmd)
    if cmd is None:
        return DevModeBuilder(), True
    return FreeCADBuilder(cmd), False

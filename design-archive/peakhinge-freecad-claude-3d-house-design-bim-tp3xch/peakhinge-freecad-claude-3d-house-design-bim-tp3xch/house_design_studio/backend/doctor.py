"""First-run configuration helpers: `.env` handling + FreeCAD auto-detection.

Pure-Python and unit-testable (the FreeCAD probe is injectable). Used by the
friendly launcher (``launch.py``) so a non-technical user does not have to
hand-edit files or hunt for their FreeCAD install path.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Callable, Dict, Optional

from ..bim_builder.runner import probe_freecad_cmd

# Package root: house_design_studio/
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_PATH = PACKAGE_ROOT / ".env"
ENV_EXAMPLE_PATH = PACKAGE_ROOT / ".env.example"


def parse_env_file(path: Path | str) -> Dict[str, str]:
    """Read a `.env` file into a dict. Ignores blank lines and `#` comments.
    Values are taken verbatim (surrounding quotes stripped)."""
    result: Dict[str, str] = {}
    path = Path(path)
    if not path.exists():
        return result
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            result[key] = value
    return result


def set_env_value(path: Path | str, key: str, value: str) -> None:
    """Add or update ``key=value`` in a `.env` file, preserving other lines.

    If an *active* (non-comment) line for ``key`` exists it is replaced; if only
    a commented template line exists (e.g. ``# HDS_FREECAD_CMD=...``) a new
    active line is appended; otherwise the pair is appended at the end.
    """
    path = Path(path)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    new_line = f"{key}={value}"
    replaced = False
    out = []
    for raw in lines:
        stripped = raw.strip()
        if (
            not replaced
            and not stripped.startswith("#")
            and stripped.split("=", 1)[0].strip() == key
        ):
            out.append(new_line)
            replaced = True
        else:
            out.append(raw)
    if not replaced:
        out.append(new_line)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def ensure_env_file(env_path: Path | str = DEFAULT_ENV_PATH) -> Path:
    """Create `.env` from `.env.example` if it does not exist yet."""
    env_path = Path(env_path)
    if not env_path.exists():
        if ENV_EXAMPLE_PATH.exists():
            shutil.copyfile(ENV_EXAMPLE_PATH, env_path)
        else:
            env_path.write_text("", encoding="utf-8")
    return env_path


def load_env_into_environ(env_path: Path | str = DEFAULT_ENV_PATH) -> Dict[str, str]:
    """Load `.env` values into ``os.environ`` (without clobbering values already
    set in the real environment, which take precedence)."""
    values = parse_env_file(env_path)
    for key, value in values.items():
        os.environ.setdefault(key, value)
    return values


def detect_and_persist_freecad(
    env_path: Path | str = DEFAULT_ENV_PATH,
    probe: Callable[[Optional[str]], Optional[str]] = probe_freecad_cmd,
) -> Optional[str]:
    """Find FreeCADCmd and persist its path to `.env` for future runs.

    Skips detection if ``HDS_FREECAD_CMD`` is already set (env or file). Returns
    the resolved path, or ``None`` if FreeCAD could not be found.
    """
    existing = os.environ.get("HDS_FREECAD_CMD") or parse_env_file(env_path).get(
        "HDS_FREECAD_CMD"
    )
    if existing and Path(existing).exists():
        os.environ["HDS_FREECAD_CMD"] = existing
        return existing

    found = probe(None)
    if found:
        set_env_value(env_path, "HDS_FREECAD_CMD", found)
        os.environ["HDS_FREECAD_CMD"] = found
    return found


def readiness_report(env_path: Path | str = DEFAULT_ENV_PATH) -> dict:
    """A friendly summary of whether the app is ready for a full run. Reads both
    the process environment and the `.env` file."""
    file_values = parse_env_file(env_path)

    def _value(key: str) -> str:
        return os.environ.get(key) or file_values.get(key, "")

    # Prefer an explicit path (must exist on disk); fall back to PATH lookup.
    explicit = _value("HDS_FREECAD_CMD")
    if explicit and Path(explicit).exists():
        freecad_path: Optional[str] = explicit
    else:
        freecad_path = shutil.which("FreeCADCmd") or shutil.which("freecadcmd")

    api_key = _value("ANTHROPIC_API_KEY")
    mock_claude = _value("HDS_DEV_MODE_MOCK_CLAUDE").lower() in ("1", "true", "yes", "on")
    return {
        "freecad_found": bool(freecad_path),
        "freecad_path": freecad_path,
        "api_key_set": bool(api_key),
        "mock_claude": mock_claude,
        "data_dir": _value("HDS_DATA_DIR") or str(PACKAGE_ROOT / "jobs"),
    }

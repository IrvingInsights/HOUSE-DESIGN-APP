"""Friendly one-command entrypoint: `python -m house_design_studio.backend.launch`.

Does the small conveniences a non-technical user shouldn't have to do by hand:
loads `.env`, auto-detects and remembers the FreeCAD path, prints a plain-English
readiness summary, opens the browser once the server is up, and starts the app.

Import order matters: `.env` is loaded into the environment *before* the app is
built, so `Config.from_env()` sees the right values.
"""

from __future__ import annotations

import socket
import sys
import threading
import time
import webbrowser

from . import doctor

HOST = "127.0.0.1"
PORT = 8000
URL = f"http://{HOST}:{PORT}"


def _print_readiness() -> dict:
    report = doctor.readiness_report()
    print("-" * 60)
    print("House Design Studio")
    print("-" * 60)
    if report["freecad_found"]:
        print(f"  FreeCAD:        found  ({report['freecad_path']})")
    else:
        print("  FreeCAD:        NOT found — will use dev mode (no drawings/IFC/STEP).")
        print("                  Set HDS_FREECAD_CMD in house_design_studio/.env to fix.")
    if report["mock_claude"]:
        print("  Claude API:     offline demo mode (mock responses).")
    elif report["api_key_set"]:
        print("  Claude API key: set.")
    else:
        print("  Claude API key: MISSING — set ANTHROPIC_API_KEY in "
              "house_design_studio/.env,")
        print("                  or set HDS_DEV_MODE_MOCK_CLAUDE=1 for an offline demo.")
    print(f"  Opening:        {URL}")
    print("-" * 60)
    return report


def _open_browser_when_ready(timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((HOST, PORT), timeout=0.5):
                webbrowser.open(URL)
                return
        except OSError:
            time.sleep(0.3)


def main() -> int:
    # 1. Configuration conveniences (must happen before building the app).
    doctor.ensure_env_file()
    doctor.load_env_into_environ()
    doctor.detect_and_persist_freecad()
    report = _print_readiness()

    if not report["api_key_set"] and not report["mock_claude"]:
        print("\nRefusing to start: no Claude API key and not in demo mode.")
        print("Add ANTHROPIC_API_KEY to house_design_studio/.env and re-run.")
        return 2

    # 2. Build the app now that the environment is populated.
    import uvicorn

    from .app import create_app
    from .config import Config

    app = create_app(Config.from_env())

    # 3. Open the browser once the port is accepting connections.
    threading.Thread(target=_open_browser_when_ready, daemon=True).start()

    # 4. Serve.
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())

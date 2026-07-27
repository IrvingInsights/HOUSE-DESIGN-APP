#!/usr/bin/env bash
# Start House Design Studio (Mac/Linux). A browser window opens automatically.
set -e
cd "$(dirname "$0")/.."

# Prefer a local virtual environment if one exists.
if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
else
  PY="python3"
fi

# The launcher loads house_design_studio/.env, auto-detects FreeCAD, opens the
# browser, and starts the server.
exec "$PY" -m house_design_studio.backend.launch

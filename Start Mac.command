#!/bin/sh
# Natural Building — double-click to start (macOS).
# First time only: right-click this file -> Open (to get past Gatekeeper).
# Keep this window open while you design. If the engine ever stops,
# it restarts by itself (Ctrl+C twice to quit).
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || {
  echo "Node.js is not installed yet — get it from https://nodejs.org (LTS), then double-click this again."
  read -r _
  exit 1
}
[ -d node_modules ] || { echo "First run: installing dependencies..."; npm install; }
echo "Opening http://127.0.0.1:5184 ..."
(sleep 3 && open "http://127.0.0.1:5184") &
while :; do
  node server.mjs
  echo
  echo "The design engine stopped (details above). Restarting in 3 seconds... (Ctrl+C to quit)"
  sleep 3
done

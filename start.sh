#!/bin/sh
# Natural Building — start the design studio (http://127.0.0.1:5184/)
# Keep this window open while you design. If the engine ever stops,
# it restarts by itself (Ctrl+C twice to quit).
cd "$(dirname "$0")"
[ -d node_modules ] || { echo "First run: installing dependencies..."; npm install; }
while :; do
  node server.mjs
  echo
  echo "The design engine stopped (details above). Restarting in 3 seconds... (Ctrl+C to quit)"
  sleep 3
done

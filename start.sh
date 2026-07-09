#!/bin/sh
# Natural Building — start the design studio (http://127.0.0.1:5184/)
cd "$(dirname "$0")"
[ -d node_modules ] || { echo "First run: installing dependencies..."; npm install; }
node server.mjs

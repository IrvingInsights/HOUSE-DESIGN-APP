@echo off
rem Natural Building — start the design studio (http://127.0.0.1:5184/)
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
)
node server.mjs
pause

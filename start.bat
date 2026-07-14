@echo off
rem Natural Building — start the design studio (http://127.0.0.1:5184/)
rem Keep this window open while you design. If the engine ever stops,
rem this window restarts it by itself.
cd /d "%~dp0"
rem Grab the latest work from GitHub before starting (skips quietly if git
rem isn't installed or there's no connection — the app still starts).
where git >nul 2>nul && (
  echo Checking for updates...
  git pull --ff-only
)
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
)
:run
node server.mjs
echo(
echo The design engine stopped ^(details above^). Restarting in 3 seconds...
echo Close this window if you meant to quit.
timeout /t 3 /nobreak >nul
goto run

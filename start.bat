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
rem NOTE: everything above this line must stay byte-identical between
rem versions — cmd resumes reading THIS file right here after the pull
rem rewrites it. New logic goes below this point only.
rem Clear any copy of the engine that's already running (old folders too),
rem so this one always gets the address. Fixes "port already in use".
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
)
rem Open the design studio in the browser once the engine is up.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:5184/"
:run
node server.mjs
echo(
echo The design engine stopped ^(details above^). Restarting in 3 seconds...
echo Close this window if you meant to quit.
timeout /t 3 /nobreak >nul
goto run

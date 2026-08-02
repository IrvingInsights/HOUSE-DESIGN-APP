@echo off
REM One-click launcher for House Design Studio.
REM First run: sets up the environment and asks for your Claude API key.
REM Every run: auto-detects FreeCAD, starts the app, and opens your browser.
REM This window stays open on any error so you can read what went wrong.
setlocal enabledelayedexpansion
cd /d "%~dp0.."

REM 1. Ensure the virtual environment + dependencies exist.
if not exist ".venv\Scripts\python.exe" (
  echo First-time setup needed. Running setup ...
  call "house_design_studio\setup.bat"
  if errorlevel 1 (
    echo.
    echo ============================================================
    echo   Setup did not finish, so House Design Studio can't start yet.
    echo   See the message above for what went wrong, fix it, then
    echo   double-click run.bat again.
    echo ============================================================
    pause
    exit /b 1
  )
)

REM Safety net: if setup reported success but the venv still isn't there,
REM say so plainly instead of failing mysteriously later.
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo ============================================================
  echo   Something is wrong: the Python environment ^(.venv^) is still
  echo   missing after setup. Try deleting the ".venv" folder next to
  echo   this one and running run.bat again.
  echo ============================================================
  pause
  exit /b 1
)

REM 2. Ensure a .env file exists (copied from the template).
if not exist "house_design_studio\.env" (
  if exist "house_design_studio\.env.example" (
    copy "house_design_studio\.env.example" "house_design_studio\.env" >nul
  ) else (
    type nul > "house_design_studio\.env"
  )
)

REM 3. If the API key is missing, ask for it once and save it.
set "HAS_KEY="
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("house_design_studio\.env") do (
  if /i "%%A"=="ANTHROPIC_API_KEY" if not "%%B"=="" set "HAS_KEY=1"
)
if not defined HAS_KEY (
  echo.
  echo Paste your Claude API key ^(from https://console.anthropic.com/ ^).
  echo It will be saved locally in house_design_studio\.env and not shared.
  set /p "APIKEY=API key: "
  if defined APIKEY (
    >>"house_design_studio\.env" echo ANTHROPIC_API_KEY=!APIKEY!
  ) else (
    echo No key entered. You can add ANTHROPIC_API_KEY to house_design_studio\.env later.
  )
)

REM 4. Create a Desktop shortcut on first run (once; resolves the real Desktop
REM    path via Windows, so it works even with OneDrive-redirected Desktops).
if not exist "%~dp0.shortcut_created" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws=New-Object -ComObject WScript.Shell;" ^
    "$l=$ws.CreateShortcut((Join-Path $ws.SpecialFolders('Desktop') 'House Design Studio.lnk'));" ^
    "$l.TargetPath='%~dp0run.bat';" ^
    "$l.WorkingDirectory='%~dp0';" ^
    "$l.IconLocation='%~dp0frontend\house.ico';" ^
    "$l.Description='House Design Studio';" ^
    "$l.Save()" >nul 2>&1
  >"%~dp0.shortcut_created" echo created
  echo A "House Design Studio" shortcut has been added to your Desktop.
)

REM 5. Launch (auto-detects FreeCAD, opens the browser, starts the server).
echo.
echo Starting House Design Studio ... a browser window will open shortly.
echo (Keep this window open while you use the app. Press Ctrl+C to stop.)
".venv\Scripts\python.exe" -m house_design_studio.backend.launch
set "LAUNCH_RC=%errorlevel%"

if not "%LAUNCH_RC%"=="0" (
  echo.
  echo ============================================================
  echo   House Design Studio stopped with an error ^(code %LAUNCH_RC%^).
  echo   Scroll up to see the message from the app - it usually says
  echo   exactly what went wrong ^(e.g. a missing API key^).
  echo ============================================================
)

echo.
echo Press any key to close this window.
pause >nul
endlocal

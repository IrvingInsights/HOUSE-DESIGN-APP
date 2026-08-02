@echo off
REM One-time setup: create a Python virtual environment and install dependencies.
REM Safe to re-run; it skips work that's already done.
REM This window stays open on any error so you can read what went wrong.
setlocal
cd /d "%~dp0.."

REM Find a Python launcher (prefer the 'py' launcher, then 'python').
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo.
  echo ============================================================
  echo   Python was not found on this computer.
  echo ============================================================
  echo.
  echo   House Design Studio needs Python 3.10 or newer to run.
  echo   This is separate from FreeCAD - both are required.
  echo.
  echo   1. Go to: https://www.python.org/downloads/
  echo   2. Click the yellow "Download Python" button and run it.
  echo   3. IMPORTANT: on the first install screen, tick the box
  echo      that says "Add python.exe to PATH" before clicking Install.
  echo   4. When it finishes, double-click run.bat again.
  echo.
  echo   Opening the download page for you now ...
  start "" "https://www.python.org/downloads/"
  echo.
  echo ============================================================
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment ^(.venv^) ...
  %PY% -m venv .venv
)

if not exist ".venv\Scripts\python.exe" (
  echo.
  echo ============================================================
  echo   Could not create the Python environment ^(.venv^).
  echo ============================================================
  echo.
  echo   This usually means Python did not install correctly, or this
  echo   folder is on a drive/location Windows won't let it write to.
  echo   Try reinstalling Python from https://www.python.org/downloads/
  echo   or moving this folder somewhere like your Desktop or Documents.
  echo.
  echo ============================================================
  pause
  exit /b 1
)

echo Installing dependencies (this can take a couple of minutes the first time) ...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r house_design_studio\requirements.txt
if errorlevel 1 (
  echo.
  echo ============================================================
  echo   Installing dependencies failed.
  echo ============================================================
  echo.
  echo   Common causes: no internet connection, or a firewall/antivirus
  echo   blocking pip. Check your connection and re-run run.bat.
  echo   If it keeps failing, copy the error text above and share it.
  echo.
  echo ============================================================
  pause
  exit /b 1
)

echo.
echo Setup complete.
endlocal

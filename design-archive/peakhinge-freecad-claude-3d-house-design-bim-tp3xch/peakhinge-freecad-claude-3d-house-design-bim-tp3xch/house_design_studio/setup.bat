@echo off
REM One-time setup: create a Python virtual environment and install dependencies.
REM Safe to re-run; it skips work that's already done.
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
  echo ERROR: Python was not found. Install Python 3.10+ from https://www.python.org/downloads/
  echo and be sure to check "Add Python to PATH" during installation.
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment (.venv) ...
  %PY% -m venv .venv
)

echo Installing dependencies (this can take a couple of minutes the first time) ...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r house_design_studio\requirements.txt

echo.
echo Setup complete.
endlocal

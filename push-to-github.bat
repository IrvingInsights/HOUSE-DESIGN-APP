@echo off
setlocal enabledelayedexpansion
REM ---------------------------------------------------------------
REM  Commit everything in this folder and push it to GitHub.
REM  Just double-click this file. It is safe to run any time.
REM  See AGENTS.md - GitHub should never be behind this folder.
REM ---------------------------------------------------------------
cd /d "%~dp0"

if exist ".git\index.lock" del ".git\index.lock"

for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b

echo.
echo You are on branch: !BRANCH!
echo.
echo === What is about to be saved ===
git status --short
echo.

set /p MSG="One sentence describing what changed (or press Enter for a default): "
if "!MSG!"=="" set MSG=update: saving the current state of the app

git add -A
git commit -m "!MSG!"
git push origin HEAD

echo.
echo === Done. Current state ===
git status --short --branch
echo.

if /i not "!BRANCH!"=="main" (
  echo -----------------------------------------------------------
  echo  This went to the branch "!BRANCH!", not the main line.
  echo  To put it on main, open this link and click the green
  echo  button twice - Create pull request, then Merge:
  echo.
  echo  https://github.com/IrvingInsights/HOUSE-DESIGN-APP/compare/main...!BRANCH!?expand=1
  echo.
  echo  Afterwards, run switch-to-main.bat to line this folder up.
  echo -----------------------------------------------------------
  echo.
  choice /c YN /n /m "Open that link in your browser now? [Y/N] "
  if !errorlevel!==1 start "" "https://github.com/IrvingInsights/HOUSE-DESIGN-APP/compare/main...!BRANCH!?expand=1"
)

echo.
pause

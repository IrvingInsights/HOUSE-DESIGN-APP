@echo off
setlocal enabledelayedexpansion
REM ---------------------------------------------------------------
REM  SAVE MY WORK. One button. Double-click it, press Enter, done.
REM  It puts the folder on the main line if it can, pulls anything
REM  new, saves everything here, and sends it to GitHub.
REM  See AGENTS.md - GitHub should never be behind this folder.
REM ---------------------------------------------------------------
cd /d "%~dp0"
if exist ".git\index.lock" del ".git\index.lock"

for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b

REM On a side branch? Try to carry the work over to main first. Git
REM refuses by itself if that would lose anything, and then we just
REM save on the branch instead - nothing is ever left unsaved.
if /i not "!BRANCH!"=="main" (
  echo Moving from "!BRANCH!" to the main line...
  git checkout main >nul 2>&1
  if errorlevel 1 (
    echo   ...not this time - saving on "!BRANCH!" instead.
  ) else (
    for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
    echo   ...done.
  )
  echo.
)

git pull --ff-only origin !BRANCH! >nul 2>&1

echo === What is about to be saved ===
git status --short
echo.
git diff --shortstat
echo.

set /p MSG="One sentence describing what changed (or press Enter for a default): "
if "!MSG!"=="" set MSG=update: saving the current state of the app

git add -A
git commit -m "!MSG!"
git push origin HEAD

echo.
echo === Done ===
git status --short --branch
git log --oneline -1
echo.

if /i not "!BRANCH!"=="main" (
  echo  Saved on the branch "!BRANCH!". To put it on the main line,
  echo  open this and click the green button twice:
  echo    https://github.com/IrvingInsights/HOUSE-DESIGN-APP/compare/main...!BRANCH!?expand=1
  echo.
  choice /c YN /n /m "Open it now? [Y/N] "
  if !errorlevel!==1 start "" "https://github.com/IrvingInsights/HOUSE-DESIGN-APP/compare/main...!BRANCH!?expand=1"
  echo.
)
pause

@echo off
REM ---------------------------------------------------------------
REM  Commit everything in this folder and push it to GitHub.
REM  Just double-click this file. It is safe to run any time.
REM  See AGENTS.md - GitHub should never be behind this folder.
REM ---------------------------------------------------------------
cd /d "%~dp0"

if exist ".git\index.lock" del ".git\index.lock"

echo.
echo === What is about to be saved ===
git status --short
echo.

set /p MSG="One sentence describing what changed (or press Enter for a default): "
if "%MSG%"=="" set MSG=update: saving the current state of the app

git add -A
git commit -m "%MSG%"
git push origin HEAD

echo.
echo === Done. Current state ===
git status --short --branch
echo.
pause

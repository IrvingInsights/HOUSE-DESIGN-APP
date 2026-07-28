@echo off
REM ---------------------------------------------------------------
REM  Puts this folder back on the main line of the project and
REM  pulls down the latest. Run this after a merge on GitHub.
REM  Safe: it stops if you have unsaved work.
REM ---------------------------------------------------------------
cd /d "%~dp0"

if exist ".git\index.lock" del ".git\index.lock"

for /f %%i in ('git status --porcelain') do (
  echo.
  echo You have unsaved changes in this folder.
  echo Run push-to-github.bat first, then run this again.
  echo.
  git status --short
  pause
  exit /b 1
)

git checkout main
git pull origin main

echo.
echo === Where you are now ===
git status --short --branch
git log --oneline -1
echo.
pause

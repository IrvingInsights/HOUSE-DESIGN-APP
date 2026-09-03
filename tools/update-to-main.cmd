@echo off
rem Puts this folder on the main line and pulls the newest work from GitHub.
rem A folder parked on a side branch never sees main's updates otherwise -
rem that is exactly how a session once ran three updates behind for a month.
rem start.bat calls this after its own pull; it is also safe to double-click.
cd /d "%~dp0\.."
where git >nul 2>nul || exit /b 0
rem Long file names in design-archive\ must not stop a pull on Windows.
git config core.longpaths true >nul 2>nul
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if "%BRANCH%"=="" exit /b 0
if /i "%BRANCH%"=="main" goto pull
set "DIRTY="
for /f "delims=" %%s in ('git status --porcelain -uno 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  echo This folder is on the side branch "%BRANCH%" and has unsaved changes, so it was left alone.
  echo Run push-to-github.bat to save them, then start again to get the newest work.
  exit /b 0
)
echo Moving from the side branch "%BRANCH%" to the main line...
git checkout main >nul 2>nul || (
  echo Could not switch to the main line - starting on "%BRANCH%" instead.
  exit /b 0
)
:pull
git pull --ff-only origin main
exit /b 0

@echo off
rem One click = the whole proof battery. Leave it running (overnight is
rem perfect) and read PROOF-REPORT.md when it finishes.
cd /d "%~dp0"
node tools\prove_it.mjs %*
echo.
echo Done - the report is in PROOF-REPORT.md
pause

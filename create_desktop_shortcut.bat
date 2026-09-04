@echo off
rem Creates a "House Design Studio" shortcut on your Desktop that starts the
rem app. Double-click this ONCE; from then on, launch from the Desktop icon
rem instead of finding this folder every time.
setlocal
set "APPDIR=%~dp0"
set "TARGET=%APPDIR%start.bat"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$desktop = $ws.SpecialFolders('Desktop');" ^
  "$lnk = $ws.CreateShortcut((Join-Path $desktop 'House Design Studio.lnk'));" ^
  "$lnk.TargetPath = '%TARGET%';" ^
  "$lnk.WorkingDirectory = '%APPDIR%';" ^
  "$lnk.Description = 'House Design Studio — natural-building home design';" ^
  "$lnk.Save()"

if errorlevel 1 (
  echo.
  echo Sorry, the shortcut could not be created automatically.
  echo You can still start the app any time by double-clicking start.bat in this folder.
) else (
  echo.
  echo Done. Look for "House Design Studio" on your Desktop — double-click it
  echo any time you want to open the app, no need to find this folder again.
)
echo.
pause
endlocal

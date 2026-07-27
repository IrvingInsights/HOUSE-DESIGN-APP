@echo off
REM Creates a "House Design Studio" shortcut on your Desktop with the house icon.
REM Double-click this once; then launch the app from your Desktop from now on.
setlocal
set "APPDIR=%~dp0"
set "TARGET=%APPDIR%run.bat"
set "ICON=%APPDIR%frontend\house.ico"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$desktop = $ws.SpecialFolders('Desktop');" ^
  "$lnk = $ws.CreateShortcut(Join-Path $desktop 'House Design Studio.lnk');" ^
  "$lnk.TargetPath = '%TARGET%';" ^
  "$lnk.WorkingDirectory = '%APPDIR%';" ^
  "$lnk.IconLocation = '%ICON%';" ^
  "$lnk.Description = 'House Design Studio';" ^
  "$lnk.Save()"

if errorlevel 1 (
  echo.
  echo Sorry, the shortcut could not be created automatically.
  echo You can still run the app by double-clicking run.bat in this folder.
) else (
  echo.
  echo Done. Look for "House Design Studio" on your Desktop.
)
echo.
pause
endlocal

param(
  [Parameter(Mandatory = $true)]
  [string]$ScriptPath,

  [string]$FreeCADCmd = "C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FreeCADCmd)) {
  throw "FreeCADCmd was not found at $FreeCADCmd"
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Generated FreeCAD script was not found at $ScriptPath"
}

& $FreeCADCmd $ScriptPath

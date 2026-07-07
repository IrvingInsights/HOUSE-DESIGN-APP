$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $appRoot

if (-not (Test-Path (Join-Path $appRoot "node_modules"))) {
  npm install
}

npm run dev -- --port 5173

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PORT = "5178"
node server.mjs *> planner-server-5178.log

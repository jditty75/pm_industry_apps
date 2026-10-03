# Download live *_DM Deployment Health workbooks (read-only Google APIs).
#Requires -Version 5.1
param(
    [string]$App,
    [switch]$WhatIf,
    [switch]$Force,
    [switch]$List,
    [switch]$Help,
    [switch]$Authorize
)

$ErrorActionPreference = "Stop"
$ToolsDir = $PSScriptRoot
$Engine = Join-Path $ToolsDir "snapshot_dm_workbooks.py"

if (-not (Test-Path $Engine)) {
    Write-Error "Engine not found: $Engine"
    exit 1
}

$argsList = @()
if ($List) { $argsList += "--list" }
if ($WhatIf) { $argsList += "--what-if" }
if ($Force) { $argsList += "--force" }
if ($Help) { $argsList += "--help" }
if ($Authorize) { $argsList += "--authorize" }
if ($App) { $argsList += "--app"; $argsList += $App }

& python $Engine @argsList
exit $LASTEXITCODE

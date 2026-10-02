# Local UI preview for GAS solutions (no clasp, no production).
# Usage:  .\preview.ps1 SLG_DM
#         .\preview.ps1 --list
#         .\preview.ps1 --folder solutions\PS_SPA\src

param(
    [Parameter(Position = 0)]
    [string]$App,
    [switch]$List,
    [switch]$NoOpen,
    [string]$Out,
    [string]$Folder
)

$Engine = Join-Path $PSScriptRoot "skills\gas-monorepo-engineer\scripts\preview_engine.py"
if (-not (Test-Path $Engine)) {
    Write-Error "Preview engine not found: $Engine"
    exit 1
}

$argsList = @()
if ($List) { $argsList += "--list" }
if ($NoOpen) { $argsList += "--no-open" }
if ($Out) { $argsList += "--out"; $argsList += $Out }
if ($Folder) { $argsList += "--folder"; $argsList += $Folder }
if ($App) { $argsList += $App }

& python $Engine @argsList
exit $LASTEXITCODE

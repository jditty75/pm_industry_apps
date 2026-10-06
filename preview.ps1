# Local UI preview for GAS solutions (no clasp, no production).
# Usage:  .\preview.ps1 SLG_DM
#         .\preview.ps1 --list
#         .\preview.ps1 --folder solutions\PS_SPA\src

param(
    [Parameter(Position = 0)]
    [string]$App,
    [switch]$List,
    [switch]$NoOpen,
    [switch]$Stop,
    [string]$Out,
    [string]$Folder,
    [string]$Scenario = "mixed-health"
)

$Engine = Join-Path $PSScriptRoot "skills\gas-monorepo-engineer\scripts\preview_engine.py"
$DmUx = Join-Path $PSScriptRoot "skills\gas-monorepo-engineer\dm-ux-concept\preview_dm_ux.py"
if (-not (Test-Path $Engine)) {
    Write-Error "Preview engine not found: $Engine"
    exit 1
}

$argsList = @()
if ($List) { $argsList += "--list" }
if ($Stop) { $argsList += "--stop" }
if ($NoOpen) { $argsList += "--no-open" }
if ($Out) { $argsList += "--out"; $argsList += $Out }
if ($Folder) { $argsList += "--folder"; $argsList += $Folder }
if ($App) { $argsList += $App }
if ($Scenario) { $argsList += "--scenario"; $argsList += $Scenario }

if ($App -eq "DM_UX" -or $App -eq "UX") {
    if (-not (Test-Path $DmUx)) {
        Write-Error "DM UX preview not found: $DmUx"
        exit 1
    }
    $uxArgs = @()
    if ($NoOpen) { $uxArgs += "--no-open" }
    if ($Stop) { $uxArgs += "--stop" }
    & python $DmUx @uxArgs
    exit $LASTEXITCODE
}

& python $Engine @argsList
exit $LASTEXITCODE

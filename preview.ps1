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
$DmUxCsat = Join-Path $PSScriptRoot "skills\gas-monorepo-engineer\dm-ux-csat-overview\preview_dm_ux_csat.py"
$DmUxCsatV2 = Join-Path $PSScriptRoot "skills\gas-monorepo-engineer\dm-ux-csat-overview-v2\preview_csat_overview_v2.py"
$DmUxCsatV3 = Join-Path $PSScriptRoot "skills\gas-monorepo-engineer\dm-ux-csat-overview-v3\preview_csat_overview_v3.py"
$DmUxCsatSurveys = Join-Path $PSScriptRoot "skills\gas-monorepo-engineer\dm-ux-csat-surveys\preview_csat_surveys.py"
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

if ($App -eq "DM_UX_CSAT" -or $App -eq "CSAT_OVERVIEW") {
    if (-not (Test-Path $DmUxCsat)) {
        Write-Error "CSAT Overview preview not found: $DmUxCsat"
        exit 1
    }
    $csatArgs = @()
    if ($NoOpen) { $csatArgs += "--no-open" }
    if ($Stop) { $csatArgs += "--stop" }
    & python $DmUxCsat @csatArgs
    exit $LASTEXITCODE
}

if ($App -eq "CSAT_OVERVIEW_V2") {
    if (-not (Test-Path $DmUxCsatV2)) {
        Write-Error "CSAT Overview V2 preview not found: $DmUxCsatV2"
        exit 1
    }
    $v2Args = @()
    if ($NoOpen) { $v2Args += "--no-open" }
    if ($Stop) { $v2Args += "--stop" }
    & python $DmUxCsatV2 @v2Args
    exit $LASTEXITCODE
}

if ($App -eq "CSAT_OVERVIEW_V3") {
    if (-not (Test-Path $DmUxCsatV3)) {
        Write-Error "CSAT Overview V3 preview not found: $DmUxCsatV3"
        exit 1
    }
    $v3Args = @()
    if ($NoOpen) { $v3Args += "--no-open" }
    if ($Stop) { $v3Args += "--stop" }
    & python $DmUxCsatV3 @v3Args
    exit $LASTEXITCODE
}

if ($App -eq "CSAT_SURVEYS") {
    if (-not (Test-Path $DmUxCsatSurveys)) {
        Write-Error "CSAT Surveys preview not found: $DmUxCsatSurveys"
        exit 1
    }
    $svArgs = @()
    if ($NoOpen) { $svArgs += "--no-open" }
    if ($Stop) { $svArgs += "--stop" }
    & python $DmUxCsatSurveys @svArgs
    exit $LASTEXITCODE
}

& python $Engine @argsList
exit $LASTEXITCODE

# Read-only drift guard for DM CoreLib 139 baseline migration consumers.
# Usage: .\scripts\Invoke-DmCorelib139DriftPreflight.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$pushScript = Join-Path $PSScriptRoot 'Push-ConsumerManifestOnly.ps1'

foreach ($c in @('SLG_DM', 'EVI_DM', 'PDX_DM', 'HS_DM')) {
    & $pushScript -Consumer $c -PreflightDrift
    Write-Host ""
}

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "If any consumer shows non-manifest drift, do NOT clasp push from local Git for that migration."
Write-Host "Use Push-ConsumerManifestOnly.ps1 -ConfirmPush with the Git-edited manifest after authorization."

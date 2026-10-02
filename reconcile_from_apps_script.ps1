# ============================================================================
# EMERGENCY ONLY: pull from Apps Script when browser-side edits must be recovered.
# Git/local source is authoritative for routine development — do NOT use this
# for normal sync. Agents should not run this without explicit user instruction.
#
# Usage:
#   .\reconcile_from_apps_script.ps1 -ConfirmReconciliation
# ============================================================================

param(
    [switch]$ConfirmReconciliation
)

if (-not $ConfirmReconciliation) {
    Write-Host "BLOCKED: bulk clasp pull is not routine sync." -ForegroundColor Red
    Write-Host "Local/Git source is authoritative. To recover emergency Apps Script edits," -ForegroundColor Yellow
    Write-Host "re-run with:  .\reconcile_from_apps_script.ps1 -ConfirmReconciliation" -ForegroundColor Yellow
    exit 1
}

$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot

function Get-ClaspProjects {
    $paths = @()
    foreach ($base in @("libraries", "solutions")) {
        $parent = Join-Path $Root $base
        if (-not (Test-Path $parent)) { continue }
        Get-ChildItem $parent -Directory | ForEach-Object {
            $clasp = Join-Path $_.FullName ".clasp.json"
            if (Test-Path $clasp) { $paths += $_.FullName.Replace($Root + "\", "").Replace("\", "/") }
        }
    }
    return $paths | Sort-Object -Unique
}

$Projects = Get-ClaspProjects
$Success = @()
$Skipped = @()
$Failed = @()

foreach ($p in $Projects) {
    $path = Join-Path $Root ($p -replace "/", "\")
    Write-Host ""
    Write-Host "=== $p ===" -ForegroundColor Cyan
    Push-Location $path
    try {
        clasp pull
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  OK" -ForegroundColor Green
            $Success += $p
        } else {
            Write-Host "  FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
            $Failed += $p
        }
    } catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
        $Failed += $p
    }
    Pop-Location
}

Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "Pulled OK: $($Success.Count)" -ForegroundColor Green
Write-Host "Failed:    $($Failed.Count)" -ForegroundColor Red

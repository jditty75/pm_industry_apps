# ============================================================================
# Pull HEAD from Apps Script for every project in the monorepo
# Run from: anywhere
# ============================================================================

$ErrorActionPreference = "Continue"

$Projects = @(
    "libraries\DepMngr",
    "libraries\GoLives",
    "solutions\HC_DM",
    "solutions\SLG_DM",
    "solutions\HENP_DM",
    "solutions\SLG_GoLives",
    "solutions\HC_GoLives",
    "solutions\HENP_GoLives",
    "solutions\SLG_ConsultingHub",
    "solutions\SLG_Capacity",
    "solutions\HC_Wellness"
)

$Root = "C:\JD"
$Success = @()
$Skipped = @()
$Failed  = @()

foreach ($p in $Projects) {
    $path = Join-Path $Root $p
    $claspFile = Join-Path $path ".clasp.json"

    Write-Host ""
    Write-Host "=== $p ===" -ForegroundColor Cyan

    if (-not (Test-Path $claspFile)) {
        Write-Host "  SKIP: no .clasp.json found" -ForegroundColor DarkYellow
        $Skipped += $p
        continue
    }

    $scriptId = (Get-Content $claspFile | ConvertFrom-Json).scriptId
    if ([string]::IsNullOrWhiteSpace($scriptId)) {
        Write-Host "  SKIP: scriptId is empty (project not yet created in Apps Script)" -ForegroundColor DarkYellow
        $Skipped += $p
        continue
    }

    Push-Location $path
    try {
        clasp pull
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  OK" -ForegroundColor Green
            $Success += $p
        } else {
            Write-Host "  FAILED (exit code $LASTEXITCODE)" -ForegroundColor Red
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
$Success | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
Write-Host "Skipped:   $($Skipped.Count)" -ForegroundColor DarkYellow
$Skipped | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
Write-Host "Failed:    $($Failed.Count)" -ForegroundColor Red
$Failed | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
Write-Host ""
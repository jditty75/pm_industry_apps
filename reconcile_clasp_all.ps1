# ============================================================================
# EMERGENCY / MANUAL ONLY — bulk clasp pull from Apps Script
# ============================================================================
# Git/local source is authoritative for normal development. A bulk pull can
# overwrite uncommitted local work. Agents must NOT run this routinely.
#
# Use only when Jeff explicitly needs to recover remote browser-side edits.
# Prefer the per-project emergency flow in skills/gas-monorepo-engineer/references/deployment.md
#
# Example (human operator):
#   .\reconcile_clasp_all.ps1 -ConfirmOverwritesLocalSource
# ============================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true, HelpMessage = 'Required acknowledgement that this may overwrite local source')]
    [switch]$ConfirmOverwritesLocalSource
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'scripts\Get-GasClaspProjects.ps1')

if (-not $ConfirmOverwritesLocalSource) {
    Write-Host 'Aborted: pass -ConfirmOverwritesLocalSource to run bulk clasp pull.' -ForegroundColor Red
    exit 1
}

$repoRoot = if ($env:JD_REPO_ROOT) { $env:JD_REPO_ROOT } else { Get-MonorepoRoot -StartPath $PSScriptRoot }
$projects = Get-GasClaspProjectPaths -RepoRoot $repoRoot

Write-Host ''
Write-Host '*** WARNING: bulk clasp pull may overwrite authoritative local/Git source ***' -ForegroundColor Red
Write-Host "Projects: $($projects.Count)" -ForegroundColor Yellow
Write-Host ''

$Success = @()
$Skipped = @()
$Failed  = @()

foreach ($p in $projects) {
    $path = Join-Path $repoRoot ($p.Replace('/', '\'))
    Write-Host "=== $p ===" -ForegroundColor Cyan

    if (-not (Test-GasClaspProjectReady -ProjectRelativePath $p -RepoRoot $repoRoot)) {
        Write-Host '  SKIP: missing or empty scriptId in .clasp.json' -ForegroundColor DarkYellow
        $Skipped += $p
        continue
    }

    Push-Location $path
    try {
        if ($PSCmdlet.ShouldProcess($p, 'clasp pull (overwrite local from Apps Script HEAD)')) {
            clasp pull
            if ($LASTEXITCODE -eq 0) {
                Write-Host '  OK' -ForegroundColor Green
                $Success += $p
            } else {
                Write-Host "  FAILED (exit code $LASTEXITCODE)" -ForegroundColor Red
                $Failed += $p
            }
        }
    } catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
        $Failed += $p
    }
    Pop-Location
}

Write-Host ''
Write-Host '=== SUMMARY ===' -ForegroundColor Cyan
Write-Host "Pulled OK: $($Success.Count)" -ForegroundColor Green
$Success | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
Write-Host "Skipped:   $($Skipped.Count)" -ForegroundColor DarkYellow
$Skipped | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
Write-Host "Failed:    $($Failed.Count)" -ForegroundColor Red
$Failed | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
Write-Host ''

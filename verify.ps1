# Read-only clasp status for every local CLASP project (discovered via .clasp.json).
# Does not modify Apps Script or local source.

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'scripts\Get-GasClaspProjects.ps1')

$repoRoot = if ($env:JD_REPO_ROOT) { $env:JD_REPO_ROOT } else { Get-MonorepoRoot -StartPath $PSScriptRoot }
$projects = Get-GasClaspProjectPaths -RepoRoot $repoRoot

if ($projects.Count -eq 0) {
    Write-Host 'No CLASP projects found (no .clasp.json under libraries/ or solutions/).' -ForegroundColor Yellow
    exit 0
}

Write-Host "Discovered $($projects.Count) CLASP project(s) under $repoRoot" -ForegroundColor Cyan

foreach ($p in $projects) {
    $path = Join-Path $repoRoot ($p.Replace('/', '\'))
    Write-Host "`n=== $p ===" -ForegroundColor Cyan

    if (-not (Test-GasClaspProjectReady -ProjectRelativePath $p -RepoRoot $repoRoot)) {
        Write-Host '  SKIP: missing or empty scriptId in .clasp.json' -ForegroundColor DarkYellow
        continue
    }

    Push-Location $path
    try {
        clasp status
    } catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
    Pop-Location
}

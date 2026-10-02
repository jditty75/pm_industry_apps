# Runs clasp status for every local CLASP project (dynamic discovery).
$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot

function Get-ClaspProjectPaths {
    $paths = @()
    foreach ($base in @("libraries", "solutions")) {
        $parent = Join-Path $Root $base
        if (-not (Test-Path $parent)) { continue }
        Get-ChildItem $parent -Directory | ForEach-Object {
            if (Test-Path (Join-Path $_.FullName ".clasp.json")) {
                $paths += $_.FullName.Replace($Root + "\", "")
            }
        }
    }
    return $paths | Sort-Object
}

foreach ($p in Get-ClaspProjectPaths) {
    Write-Host "`n=== $p ===" -ForegroundColor Cyan
    Push-Location (Join-Path $Root $p)
    try {
        clasp status
    } catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
    Pop-Location
}

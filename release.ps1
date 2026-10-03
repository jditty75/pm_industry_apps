# Shared GAS library release planning and (future) execution.
# READ-ONLY planning — no clasp mutation unless explicitly extended with -Execute and authorization.
#
# Usage:
#   .\release.ps1 DepMngr -Plan
#   .\release.ps1 GoLives -Plan
#   .\release.ps1 DepMngr -Plan -Json
#   .\release.ps1 DepMngr -Plan -Description "Notable hardening" -Feature notable

param(
    [Parameter(Position = 0, Mandatory = $true)]
    [string]$Library,

    [switch]$Plan,
    [switch]$Json,
    [string]$Description,
    [string[]]$Feature = @()
)

$ErrorActionPreference = 'Stop'
$Engine = Join-Path $PSScriptRoot 'skills\gas-monorepo-engineer\scripts\library_release_plan.py'

if (-not $Plan) {
    Write-Host 'Shared library release tooling currently supports -Plan (read-only).' -ForegroundColor Yellow
    Write-Host 'Example: .\release.ps1 DepMngr -Plan' -ForegroundColor Cyan
    exit 1
}

if (-not (Test-Path $Engine)) {
    Write-Error "Release planner not found: $Engine"
    exit 1
}

$argsList = @($Library)
if ($Json) { $argsList += '--json' }
if ($Description) { $argsList += '--description'; $argsList += $Description }
foreach ($f in $Feature) {
    if ($f) { $argsList += '--feature'; $argsList += $f }
}

& python $Engine @argsList
exit $LASTEXITCODE

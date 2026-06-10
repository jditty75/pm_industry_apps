# Runs clasp status against every project to confirm wiring
$ErrorActionPreference = "Continue"
$Projects = @(
    "libraries\DepMngr",
    "libraries\GoLives",
    "solutions\HC_DM",
    "solutions\SLG_DM",
    "solutions\HENP_DM",
    "solutions\SLG_GoLives",
    "solutions\HC_GoLives",
    "solutions\SLG_ConsultingHub",
    "solutions\SLG_Capacity",
    "solutions\HC_Wellness"
)
# Note: HENP_GoLives skipped because scriptId is empty until you create it

foreach ($p in $Projects) {
    $path = "C:\JD\$p"
    Write-Host "`n=== $p ===" -ForegroundColor Cyan
    Push-Location $path
    try {
        clasp status
    } catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
    Pop-Location
}
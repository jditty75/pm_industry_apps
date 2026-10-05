# Manifest-only clasp push: upload target appsscript.json on top of current Apps Script HEAD
# source (not local Git). Preserves accepted local Git work that is not yet on GAS.
#
# READ-ONLY:
#   .\scripts\Push-ConsumerManifestOnly.ps1 -Consumer SLG_DM -PreflightDrift
#
# EXECUTE (requires explicit authorization in the current agent session):
#   .\scripts\Push-ConsumerManifestOnly.ps1 -Consumer SLG_DM -ManifestPath C:\JD\solutions\SLG_DM\src\appsscript.json -ConfirmPush
#
param(
    [Parameter(Mandatory = $true)]
    [string]$Consumer,

    [switch]$PreflightDrift,

    [string]$ManifestPath,

    [switch]$ConfirmPush,

    [string]$VerifyPattern = '_debugNotableDataPipeline'
)

$ErrorActionPreference = 'Stop'
$repoRoot = if ($env:JD_REPO_ROOT) { $env:JD_REPO_ROOT } else { Split-Path $PSScriptRoot -Parent }

$projectRel = "solutions/$Consumer"
$projectDir = Join-Path $repoRoot ($projectRel.Replace('/', '\'))
$localSrc = Join-Path $projectDir 'src'
$claspJson = Join-Path $projectDir '.clasp.json'

if (-not (Test-Path $claspJson)) {
    Write-Error "Missing .clasp.json for $Consumer at $projectDir"
}

function New-DriftWorkdir {
    param([string]$Label)
    $dir = Join-Path $repoRoot (".ai\manifest-push-staging\$Label-$(Get-Date -Format 'yyyyMMdd-HHmmss')")
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    return $dir
}

function Copy-ClaspProjectSkeleton {
    param([string]$DestRoot)
    Copy-Item $claspJson (Join-Path $DestRoot '.clasp.json')
    $ignore = Join-Path $projectDir '.claspignore'
    if (Test-Path $ignore) { Copy-Item $ignore (Join-Path $DestRoot '.claspignore') }
    New-Item -ItemType Directory -Path (Join-Path $DestRoot 'src') -Force | Out-Null
}

function Invoke-ClaspPullTo {
    param([string]$DestRoot)
    Push-Location $DestRoot
    try {
        $out = clasp pull 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "clasp pull failed: $out" }
    } finally {
        Pop-Location
    }
}

function Get-FileDriftReport {
    param(
        [string]$RemoteSrc,
        [string]$LocalSrcDir
    )
    $report = @()
    $localFiles = Get-ChildItem $LocalSrcDir -File -Recurse
    foreach ($lf in $localFiles) {
        $rel = $lf.FullName.Substring($LocalSrcDir.Length).TrimStart('\')
        $rf = Join-Path $RemoteSrc $rel
        if (-not (Test-Path $rf)) {
            $report += [pscustomobject]@{ File = $rel; Status = 'local_only'; WouldPush = $true }
            continue
        }
        $lh = (Get-FileHash $lf.FullName -Algorithm SHA256).Hash
        $rh = (Get-FileHash $rf -Algorithm SHA256).Hash
        if ($lh -ne $rh) {
            $report += [pscustomobject]@{ File = $rel; Status = 'differs'; WouldPush = $true }
        }
    }
    return $report
}

if ($PreflightDrift) {
    Write-Host "=== Drift preflight: $Consumer ===" -ForegroundColor Cyan
    Write-Host "Baseline: Apps Script HEAD (clasp pull), compared to local Git: $localSrc"

    $work = New-DriftWorkdir -Label "$Consumer-remote"
    Copy-ClaspProjectSkeleton -DestRoot $work
    Invoke-ClaspPullTo -DestRoot $work
    $remoteSrc = Join-Path $work 'src'

    $drift = Get-FileDriftReport -RemoteSrc $remoteSrc -LocalSrcDir $localSrc
    $manifestOnly = $drift | Where-Object { $_.File -eq 'appsscript.json' }
    $nonManifest = $drift | Where-Object { $_.File -ne 'appsscript.json' }

    Write-Host ""
    if ($nonManifest.Count -eq 0) {
        Write-Host "Non-manifest drift: NONE (normal clasp push from Git is manifest-safe)" -ForegroundColor Green
    } else {
        Write-Host "Non-manifest drift: $($nonManifest.Count) file(s) would ride along with a normal Git clasp push:" -ForegroundColor Yellow
        $nonManifest | ForEach-Object { Write-Host "  - $($_.File) ($($_.Status))" }
        Write-Host ""
        Write-Host "Use staged manifest-only push (this script with -ConfirmPush) starting from remote HEAD." -ForegroundColor Cyan
    }

    if ($VerifyPattern -and (Test-Path (Join-Path $localSrc 'Code.js'))) {
        $localHas = Select-String -Path (Join-Path $localSrc 'Code.js') -Pattern $VerifyPattern -Quiet
        $remoteHas = Select-String -Path (Join-Path $remoteSrc 'Code.js') -Pattern $VerifyPattern -Quiet
        Write-Host ""
        Write-Host "Pattern '$VerifyPattern' in Code.js: local=$localHas remote(GAS HEAD)=$remoteHas"
        if ($localHas -and -not $remoteHas) {
            Write-Host "BLOCK: normal push from Git would upload Notable debug helper." -ForegroundColor Red
        }
    }

    Write-Host ""
    Write-Host "Remote snapshot: $remoteSrc" -ForegroundColor DarkGray
    exit 0
}

if (-not $ConfirmPush) {
    Write-Host "BLOCKED: manifest-only push requires -ConfirmPush and explicit user authorization." -ForegroundColor Red
    exit 1
}

if (-not $ManifestPath -or -not (Test-Path $ManifestPath)) {
    Write-Error "Provide -ManifestPath to the target appsscript.json (e.g. after Git manifest edit)."
}

$stage = New-DriftWorkdir -Label "$Consumer-push"
Copy-ClaspProjectSkeleton -DestRoot $stage
Invoke-ClaspPullTo -DestRoot $stage
Copy-Item -Force $ManifestPath (Join-Path $stage 'src\appsscript.json')

Push-Location $stage
try {
    clasp push -f 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "clasp push failed with exit $LASTEXITCODE" }
} finally {
    Pop-Location
}

$verify = New-DriftWorkdir -Label "$Consumer-verify"
Copy-ClaspProjectSkeleton -DestRoot $verify
Invoke-ClaspPullTo -DestRoot $verify
$verifyCode = Join-Path $verify 'src\Code.js'
if (Test-Path $verifyCode) {
    $bad = Select-String -Path $verifyCode -Pattern $VerifyPattern -Quiet
    if ($bad) {
        Write-Error "Post-push verification FAILED: $VerifyPattern still present on Apps Script HEAD Code.js"
    }
    Write-Host "Post-push verification: Code.js does not contain '$VerifyPattern'." -ForegroundColor Green
}

Write-Host "Manifest-only push complete for $Consumer. Staging: $stage" -ForegroundColor Green

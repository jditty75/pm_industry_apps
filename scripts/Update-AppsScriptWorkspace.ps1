# Regenerate apps-script.code-workspace from local .clasp.json discovery.
# Safe to run when a new CLASP project is added under libraries/ or solutions/.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Get-GasClaspProjects.ps1')

$repoRoot = Get-MonorepoRoot
$projects = Get-GasClaspProjectPaths -RepoRoot $repoRoot

$folders = @()
foreach ($p in $projects) {
    $folders += @{ path = $p }
}
$folders += @{ path = '.'; name = 'ROOT' }

$workspace = @{
    folders  = $folders
    settings = @{
        'editor.formatOnSave' = $true
        'files.exclude'       = @{
            '**/.clasp.json'   = $false
            '**/.claspignore'  = $false
            '**/.cursorrules'  = $false
        }
    }
}

$outPath = Join-Path $repoRoot 'apps-script.code-workspace'
$json = $workspace | ConvertTo-Json -Depth 6
# ConvertTo-Json uses CRLF-friendly output; workspace is JSON — normalize to LF for git
$json = $json -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($outPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "Wrote $outPath with $($projects.Count) CLASP project folder(s)." -ForegroundColor Green
$projects | ForEach-Object { Write-Host "  $_" }

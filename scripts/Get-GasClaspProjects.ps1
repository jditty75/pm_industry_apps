# Shared discovery for CLASP-backed GAS projects in this monorepo.
# .clasp.json is authoritative locally (gitignored). Non-GAS dirs (e.g. GS_Kit) are excluded.

function Get-MonorepoRoot {
    param([string]$StartPath = $PSScriptRoot)
    return (Resolve-Path (Join-Path $StartPath '..')).Path
}

function Get-GasClaspProjectPaths {
    <#
    .SYNOPSIS
      Returns relative project paths (e.g. solutions/SLG_DM) that have a local .clasp.json.
    #>
    param(
        [string]$RepoRoot = (Get-MonorepoRoot)
    )

    $excludeDirNames = @('GS_Kit')
    $searchRoots = @('libraries', 'solutions')
    $found = New-Object System.Collections.Generic.List[string]

    foreach ($rootName in $searchRoots) {
        $base = Join-Path $RepoRoot $rootName
        if (-not (Test-Path $base)) { continue }

        Get-ChildItem -Path $base -Directory | ForEach-Object {
            if ($excludeDirNames -contains $_.Name) { return }
            $claspFile = Join-Path $_.FullName '.clasp.json'
            if (-not (Test-Path $claspFile)) { return }

            $rel = $_.FullName.Substring($RepoRoot.Length).TrimStart('\', '/')
            $found.Add($rel.Replace('\', '/'))
        }
    }

    return ($found | Sort-Object)
}

function Test-GasClaspProjectReady {
    param(
        [string]$ProjectRelativePath,
        [string]$RepoRoot = (Get-MonorepoRoot)
    )

    $claspFile = Join-Path $RepoRoot (Join-Path $ProjectRelativePath '.clasp.json')
    if (-not (Test-Path $claspFile)) { return $false }

    try {
        $scriptId = (Get-Content $claspFile -Raw | ConvertFrom-Json).scriptId
        return -not [string]::IsNullOrWhiteSpace($scriptId)
    } catch {
        return $false
    }
}

# ============================================================================
# Apps Script Monorepo Bootstrap
# Run from: C:\JD\
# Plain ASCII only - safe for all Windows PowerShell encodings
# ============================================================================

$ErrorActionPreference = "Stop"
$Root = "C:\JD"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = "C:\JD_backup_$Timestamp"

Write-Host ""
Write-Host "=== Apps Script Monorepo Bootstrap ===" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host "Backup: $BackupRoot"
Write-Host ""

# ----------------------------------------------------------------------------
# STEP 1: Full backup
# ----------------------------------------------------------------------------
Write-Host "[1/8] Creating full backup at $BackupRoot..." -ForegroundColor Yellow
Copy-Item -Path $Root -Destination $BackupRoot -Recurse -Force
Write-Host "      Backup complete." -ForegroundColor Green
Write-Host ""

# ----------------------------------------------------------------------------
# STEP 2: Project definitions
# ----------------------------------------------------------------------------
$Libraries = @(
    @{ Name = "DepMngr";  ScriptId = "1qIBm-m342W-uJVhnWu0iGZQu-ovnI2qaTuKCKoZej94lsvjalQViAhi3" }
    @{ Name = "GoLives";  ScriptId = "1mBYVGMsM4qdJh4dfrmm4gQNdec9N9pYakmkd_UA8jkQFHMXVm7p2aPpm" }
)

$Solutions = @(
    @{ Name = "HC_DM";              ScriptId = "14SAOjIrrxdR9U5s3JTEPLNHNc-flQvqJ5DHphy7W6YUxBGegaAJHxVwU"; Library = "DepMngr" }
    @{ Name = "SLG_DM";             ScriptId = "1sdGkmdjfQ643UX_7YtT1KpYYvwuD4waSqufeL3jTUjNzWzHgkBJ-ico-"; Library = "DepMngr" }
    @{ Name = "HENP_DM";            ScriptId = "14KMgt7SEX24JS9ggeDb74oz2Af2k3tqiwMuPf5w_XpCVSMgUnlsU-K_6"; Library = "DepMngr" }
    @{ Name = "SLG_GoLives";        ScriptId = "1q2znQz69stA06z-cJxhPBtYuc0bH0RAT5Wt2VTYRLTvBuqle5vGTe2Tw"; Library = "GoLives" }
    @{ Name = "HC_GoLives";         ScriptId = "14RwP52Be4c-PVT2oefeI8Yl--rUCcJNyXzS-YC1y70yQZI4l26bstF-k"; Library = "GoLives" }
    @{ Name = "HENP_GoLives";       ScriptId = "";                                                            Library = "GoLives" }
    @{ Name = "SLG_ConsultingHub";  ScriptId = "1D7sz5wk91qXHlaEc4IPkjPwobbJuOgQCcXw--IQorkxpzExpkPZ6qWFH"; Library = $null }
    @{ Name = "SLG_Capacity";       ScriptId = "1fQg-kMAepkzMDO5063SSORpQvwnfYI-PTTL2FhMHKz-4xl9nVzDKvPPH"; Library = $null }
    @{ Name = "HC_Wellness";        ScriptId = "15Uz2C2fQOflU74AiFume0fAEIjOKBdGoQ2h6U-Su6YxTRuDCLvLWItBb"; Library = $null }
)

# ----------------------------------------------------------------------------
# STEP 3: Remove stray root files
# ----------------------------------------------------------------------------
Write-Host "[2/8] Removing stray root files..." -ForegroundColor Yellow
$StrayItems = @(
    "SANA",
    "Sana_Txt.ps1",
    "WD_GAS.code-workspace",
    ".clasp.json",
    ".claspignore.json",
    "appsscript.json",
    "ChangeLog.js",
    "Code.js",
    "Config_HC.js",
    "WebApp.html",
    "WebAppCode.js"
)
foreach ($item in $StrayItems) {
    $path = Join-Path $Root $item
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force
        Write-Host "      Removed: $item" -ForegroundColor Gray
    }
}
Write-Host ""

# ----------------------------------------------------------------------------
# STEP 4: Create libraries/ and solutions/ folders
# ----------------------------------------------------------------------------
Write-Host "[3/8] Creating libraries and solutions folders..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path "$Root\libraries" -Force | Out-Null
New-Item -ItemType Directory -Path "$Root\solutions" -Force | Out-Null
Write-Host ""

# ----------------------------------------------------------------------------
# STEP 5: Reorganize each project
# ----------------------------------------------------------------------------
function Reorganize-Project {
    param(
        [string]$ProjectName,
        [string]$ScriptId,
        [string]$LibraryDep,
        [string]$TargetParent
    )

    $oldPath = Join-Path $Root $ProjectName
    $newPath = Join-Path $Root "$TargetParent\$ProjectName"

    Write-Host "      Processing: $ProjectName" -ForegroundColor Cyan

    if (Test-Path $oldPath) {
        Move-Item -Path $oldPath -Destination $newPath -Force
    } else {
        New-Item -ItemType Directory -Path $newPath -Force | Out-Null
        Write-Host "        (created empty placeholder)" -ForegroundColor DarkGray
    }

    $srcPath = Join-Path $newPath "src"
    New-Item -ItemType Directory -Path $srcPath -Force | Out-Null

    Get-ChildItem -Path $newPath -File | Where-Object {
        $_.Extension -in @(".js", ".gs", ".html") -or $_.Name -eq "appsscript.json"
    } | ForEach-Object {
        Move-Item -Path $_.FullName -Destination $srcPath -Force
    }

    $oldIgnore = Join-Path $newPath ".claspignore.json"
    if (Test-Path $oldIgnore) {
        Remove-Item -Path $oldIgnore -Force
    }

    $oldClasp = Join-Path $newPath ".clasp.json"
    if (Test-Path $oldClasp) {
        Remove-Item -Path $oldClasp -Force
    }

    $claspJson = @{
        scriptId = $ScriptId
        rootDir  = "./src"
    } | ConvertTo-Json
    Set-Content -Path (Join-Path $newPath ".clasp.json") -Value $claspJson -Encoding UTF8

    $claspIgnore = @"
**/**
!src/**
!src/appsscript.json
"@
    Set-Content -Path (Join-Path $newPath ".claspignore") -Value $claspIgnore -Encoding UTF8

    $packageJson = @"
{
  "name": "$($ProjectName.ToLower())",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "push": "clasp push",
    "pull": "clasp pull",
    "open": "clasp open",
    "status": "clasp status",
    "deploy": "clasp push && clasp deploy",
    "version": "clasp version",
    "logs": "clasp logs"
  }
}
"@
    Set-Content -Path (Join-Path $newPath "package.json") -Value $packageJson -Encoding UTF8

    if ($LibraryDep) {
        $depNote = "This project depends on the $LibraryDep shared library (see src/appsscript.json for pinned version)."
    } else {
        $depNote = "This project is standalone. No library dependency."
    }

    $cursorRules = @"
# Project: $ProjectName

$depNote

## Conventions
- V8 runtime: use let/const, arrow functions, classes, template literals.
- Every public function needs JSDoc with @param and @return.
- Wrap external service calls (UrlFetchApp, SpreadsheetApp batch ops) in try/catch.
- Use PropertiesService.getScriptProperties() for secrets. Never hardcode.
- Prefer batch operations (getValues/setValues) over per-cell reads.
- All Logger.log calls should prefix with the function name.

## File layout
- All source files live in ./src
- src/appsscript.json is the project manifest pushed to Apps Script
- Never reference scriptIds in code. They live only in .clasp.json

## Workflow reminders
- 'npm run push' pushes ./src to Apps Script HEAD. This is DEV.
- 'npm run deploy' creates a new immutable deployment version. This is PROD.
- Library version bumps happen in src/appsscript.json under dependencies.libraries.
"@
    Set-Content -Path (Join-Path $newPath ".cursorrules") -Value $cursorRules -Encoding UTF8

    Write-Host "        Reorganized." -ForegroundColor Green
}

Write-Host "[4/8] Reorganizing libraries..." -ForegroundColor Yellow
foreach ($lib in $Libraries) {
    Reorganize-Project -ProjectName $lib.Name -ScriptId $lib.ScriptId -LibraryDep $null -TargetParent "libraries"
}
Write-Host ""

Write-Host "[5/8] Reorganizing solutions..." -ForegroundColor Yellow
foreach ($sol in $Solutions) {
    Reorganize-Project -ProjectName $sol.Name -ScriptId $sol.ScriptId -LibraryDep $sol.Library -TargetParent "solutions"
}
Write-Host ""

# ----------------------------------------------------------------------------
# STEP 6: Write VERSIONS.md for each library
# ----------------------------------------------------------------------------
Write-Host "[6/8] Creating VERSIONS.md for libraries..." -ForegroundColor Yellow
foreach ($lib in $Libraries) {
    $versionsPath = Join-Path $Root "libraries\$($lib.Name)\VERSIONS.md"
    $versionsContent = @"
# $($lib.Name) Version History

Track every immutable version cut from this library here.

| Version | Date | Changes | Cut By |
|---|---|---|---|
| 1 | (initial) | Initial version | Jeff |

## How to cut a new version
1. Make changes in src/
2. npm run push (pushes to HEAD for testing)
3. Test by temporarily pointing a consumer solution at HEAD
4. npm run version -- "Description of changes"
5. Add a row to this file with the new version number
6. Commit to Git
"@
    Set-Content -Path $versionsPath -Value $versionsContent -Encoding UTF8
}
Write-Host ""

# ----------------------------------------------------------------------------
# STEP 7: Write root-level files
# ----------------------------------------------------------------------------
Write-Host "[7/8] Writing root-level files..." -ForegroundColor Yellow

$gitignore = @"
node_modules/
.DS_Store
*.log
.env
.env.local
*_backup_*/
"@
Set-Content -Path "$Root\.gitignore" -Value $gitignore -Encoding UTF8

$rootPackageJson = @"
{
  "name": "wd-apps-script-monorepo",
  "version": "1.0.0",
  "private": true,
  "description": "Workday Apps Script solutions monorepo",
  "devDependencies": {
    "shx": "^0.3.4"
  }
}
"@
Set-Content -Path "$Root\package.json" -Value $rootPackageJson -Encoding UTF8

$globalCursorRules = @"
# Workday Apps Script Monorepo

Single developer: Jeff Ditty (jeffrey.ditty@workday.com)
Source of truth: this monorepo at C:\JD
Deployment: via Clasp to Google Apps Script

## Structure
- libraries/  Shared Apps Script libraries (DepMngr, GoLives)
- solutions/  Container-bound Apps Script projects attached to Google Sheets

## Dependency map
- DepMngr is used by: HC_DM, SLG_DM, HENP_DM
- GoLives is used by: SLG_GoLives, HC_GoLives, HENP_GoLives
- Standalone (no library): SLG_ConsultingHub, SLG_Capacity, HC_Wellness

## Per-project layout
Each project has:
- src/                all .js, .gs, .html, appsscript.json files
- .clasp.json         pins the Google scriptId
- .claspignore        pushes only src/
- package.json        npm scripts for push/pull/deploy/version
- .cursorrules        project-specific AI conventions

## Workflow conventions
- HEAD is DEV. 'npm run push' deploys to HEAD.
- Deployed versions are PROD. 'npm run deploy' creates immutable versions.
- Library testing: temporarily flip a consumer solution's appsscript.json to point at library HEAD ("0"), test, then revert to a numbered version.
- Library version cutting: run 'npm run version' inside the library, then bump consumer solutions' appsscript.json to reference the new number.

## Global coding rules
- V8 runtime always
- JSDoc on all public functions
- Logger.log prefixed with function name
- No hardcoded scriptIds, sheet IDs, or secrets. Use PropertiesService.
- Batch SpreadsheetApp reads/writes
- try/catch around UrlFetchApp and other external calls
"@
Set-Content -Path "$Root\.cursorrules" -Value $globalCursorRules -Encoding UTF8

$readme = @"
# Workday Apps Script Monorepo

Maintained by Jeff Ditty.

## Quick start
1. cd into any project under libraries/ or solutions/
2. npm run pull    (sync from Apps Script HEAD)
3. Edit files in src/
4. npm run push    (push HEAD = DEV)
5. npm run deploy  (create new immutable version = PROD)

## Projects

### Libraries
- libraries/DepMngr  used by HC_DM, SLG_DM, HENP_DM
- libraries/GoLives  used by SLG_GoLives, HC_GoLives, HENP_GoLives

### Solutions (container-bound to Google Sheets)
- solutions/HC_DM
- solutions/SLG_DM
- solutions/HENP_DM
- solutions/SLG_GoLives
- solutions/HC_GoLives
- solutions/HENP_GoLives
- solutions/SLG_ConsultingHub (standalone)
- solutions/SLG_Capacity (standalone)
- solutions/HC_Wellness (standalone)

## Daily workflow

### Editing a solution
cd solutions\HC_DM
npm run pull
(edit in src/ via Cursor)
npm run push
npm run open
npm run deploy

### Editing a library
cd libraries\DepMngr
npm run pull
(edit in src/)
npm run push
(flip a consumer to HEAD "0" temporarily to test, then:)
npm run version -- "Description"
(update VERSIONS.md)
(bump src/appsscript.json in each consumer that needs the upgrade)

## Backup
Pre-bootstrap state is preserved at C:\JD_backup_<timestamp>\.
Keep until you have verified everything works.
"@
Set-Content -Path "$Root\README.md" -Value $readme -Encoding UTF8

$workspace = @"
{
  "folders": [
    { "path": "libraries/DepMngr" },
    { "path": "libraries/GoLives" },
    { "path": "solutions/HC_DM" },
    { "path": "solutions/SLG_DM" },
    { "path": "solutions/HENP_DM" },
    { "path": "solutions/SLG_GoLives" },
    { "path": "solutions/HC_GoLives" },
    { "path": "solutions/HENP_GoLives" },
    { "path": "solutions/SLG_ConsultingHub" },
    { "path": "solutions/SLG_Capacity" },
    { "path": "solutions/HC_Wellness" },
    { "path": ".", "name": "ROOT" }
  ],
  "settings": {
    "editor.formatOnSave": true,
    "files.exclude": {
      "**/.clasp.json": false,
      "**/.claspignore": false,
      "**/.cursorrules": false
    }
  }
}
"@
Set-Content -Path "$Root\apps-script.code-workspace" -Value $workspace -Encoding UTF8

Write-Host ""

# ----------------------------------------------------------------------------
# STEP 8: Install shx
# ----------------------------------------------------------------------------
Write-Host "[8/8] Installing shx (one-time)..." -ForegroundColor Yellow
Set-Location $Root
npm install --save-dev shx
Write-Host ""

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
Write-Host "=== BOOTSTRAP COMPLETE ===" -ForegroundColor Green
Write-Host ""
Write-Host "New structure:"
Write-Host "  C:\JD\libraries\DepMngr"
Write-Host "  C:\JD\libraries\GoLives"
Write-Host "  C:\JD\solutions\<9 solutions>"
Write-Host ""
Write-Host "Backup preserved at: $BackupRoot"
Write-Host ""
Write-Host "NEXT STEPS:"
Write-Host "  1. Open Cursor: File > Open Workspace from File > C:\JD\apps-script.code-workspace"
Write-Host "  2. Run verify.ps1 to confirm Clasp wiring"
Write-Host "  3. Test one solution end-to-end before trusting the rest"
Write-Host ""
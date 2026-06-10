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

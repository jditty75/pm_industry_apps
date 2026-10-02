# Workday Apps Script Monorepo

Maintained by Jeff Ditty.

**Agents:** start at [AGENTS.md](AGENTS.md) → [GAS skill](skills/gas-monorepo-engineer/SKILL.md) → [monorepo reference](docs/agent/monorepo-reference.md) / [app catalog](config/apps.json) when needed.

## Quick start
1. cd into any project under libraries/ or solutions/
2. npm run pull    (sync from Apps Script HEAD)
3. Edit files in src/
4. npm run push    (push HEAD = DEV)
5. npm run deploy  (create new immutable version = PROD)

## Projects

See [config/apps.json](config/apps.json) for PS Portal–listed applications (paths, teams, descriptions). Additional CLASP projects may exist under `solutions/` and `libraries/` with per-app `gas.config.json` for production deployment.

### Libraries
- libraries/DepMngr (CoreLib)
- libraries/GoLives

Historical `snapshots/` and `DHLibrary_v52/` copies were removed; use Git history for older versions.

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

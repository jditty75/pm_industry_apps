# Workday Apps Script Monorepo

Maintained by Jeff Ditty.

**Agents:** start at [AGENTS.md](AGENTS.md) → [GAS skill](skills/gas-monorepo-engineer/SKILL.md) → [monorepo reference](docs/agent/monorepo-reference.md) / [app catalog](config/apps.json) when needed.

## Quick start
1. cd into any project under `libraries/` or `solutions/`
2. Edit files in `src/` (Git/local source is authoritative — do not routinely `clasp pull`)
3. For UI work: `.\preview.ps1 <AppId>` — see [docs/agent/ui-preview.md](docs/agent/ui-preview.md)
4. `npm run push` from the project folder (HEAD = DEV) when ready to sync to Apps Script
5. `npm run deploy` only with explicit production authorization (immutable PROD version)

## Projects

See [config/apps.json](config/apps.json) for PS Portal–listed applications (paths, teams, descriptions). Additional CLASP projects may exist under `solutions/` and `libraries/` with per-app `gas.config.json` for production deployment.

### Libraries
- libraries/DepMngr (CoreLib)
- libraries/GoLives

DepMngr and GoLives are **function libraries** (no standalone UI). Use Git history for removed snapshot trees.

## Daily workflow

### Editing a solution
cd solutions\HC_DM
(edit in src/ via Cursor; optional `.\preview.ps1 HC_DM` for web UI)
npm run push
npm run open
npm run deploy

### Editing a library
cd libraries\DepMngr
(edit in src/; assess all `*_DM` consumers before push)
npm run push
(flip a consumer to HEAD "0" temporarily to test, then:)
npm run version -- "Description"
(update VERSIONS.md)
(bump src/appsscript.json in each consumer that needs the upgrade)

## Backup
Pre-bootstrap state is preserved at C:\JD_backup_<timestamp>\.
Keep until you have verified everything works.

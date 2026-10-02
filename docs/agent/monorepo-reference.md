# Workday GAS monorepo — agent reference

Progressive-load detail for agents working in `C:\JD`. For production safety and CLASP workflow, follow [`skills/gas-monorepo-engineer/SKILL.md`](../../skills/gas-monorepo-engineer/SKILL.md). For Workday-specific hazards, see [`skills/gas-monorepo-engineer/references/workday-monorepo.md`](../../skills/gas-monorepo-engineer/references/workday-monorepo.md).

## What this repo is

Google Apps Script monorepo: shared libraries under `libraries/`, deployable solutions under `solutions/`. Most solutions are container-bound to Google Sheets with HtmlService web apps. Source is plain `.js`/`.gs`/`.html` in each project's CLASP `rootDir` (usually `src/`). No bundler, no root test runner.

**Git is authoritative** for routine development. Do not routinely `clasp pull`. Per-app production deployment IDs and URLs live in `gas.config.json`. Portal business metadata lives in [`config/apps.json`](../../config/apps.json).

## Layout

```
C:\JD
├── libraries/DepMngr     → CoreLib function library (*_DM consumers; no standalone UI)
├── libraries/GoLives     → GoLives function library (*_GoLives consumers; no standalone UI)
├── solutions/*           → CLASP projects (see config/apps.json for portal-listed apps)
├── config/apps.json      → discovery metadata (not deployment authority)
├── config/ui-preview.json → local UI preview profiles
├── skills/gas-monorepo-engineer/
├── docs/agent/           → this file, ui-preview.md, other progressive references
├── preview.ps1, verify.ps1
└── package.json          → inert at root; per-project npm scripts wrap clasp
```

Per project: `src/` (or CLASP `rootDir`), local `.clasp.json` (gitignored), `gas.config.json`, often `package.json`.

Historical `snapshots/` and `DHLibrary_v52/` were removed from the tree; use Git history for old versions.

## Application map (summary)

| Family | Projects | Library |
|--------|----------|---------|
| Deployment Health `*_DM` | SLG, HC, HENP, EVI, PDX, HS (+ product-mode variants as present) | DepMngr / CoreLib |
| Go Lives | SLG, HC, HENP GoLives | GoLives |
| Standalone | SLG_Capacity, SLG_ConsultingHub, HC_Wellness, SLED_Marketing, SLED_Pipeline, PS_SPA | none |

Full portal-mapped list: `config/apps.json`. DepMngr module map: start with `libraries/DepMngr/src/CoreConfig.js`.

**DepMngr HEAD risk:** consumers that pin CoreLib at version `"0"` with `developmentMode: true` pick up library pushes immediately. Inspect current `appsscript.json` pins before any `libraries/DepMngr` push; treat as production-impacting when HEAD consumers exist.

## Commands

Run from inside a project directory (when `package.json` exists):

| Script | Meaning |
|--------|---------|
| `npm run pull` | clasp pull (reconciliation only when needed) |
| `npm run push` | clasp push → Apps Script HEAD (dev) |
| `npm run deploy` | push + new deployment (production only with authorization) |
| `npm run version` | libraries: cut immutable version |

Repo helpers: `C:\JD\preview.ps1` (local UI), `C:\JD\verify.ps1` (clasp status; discovers CLASP projects).

**Do not** use bulk Apps Script pull as routine sync — see `reconcile_from_apps_script.ps1` if present. Historical `Build.ps1` was removed; use Git history for bootstrap artifacts.

## Architecture patterns (DM family)

- **Config injection:** `APP_CONFIG` in `Config_<APP>.js` → passed into every CoreLib call. App differences belong in config, not `if (appId)` in the library.
- **Thin wrappers:** Sheet menus and `google.script.run` require container-bound functions in `Code.js`.
- **Sheet-as-database:** tab names and column indices from config.

## Coding rules

V8 runtime; JSDoc on public functions; `Logger.log` prefixed with function name; batch `getValues`/`setValues`; try/catch on external calls; no committed scriptIds (`.clasp.json` stays local); private helpers use trailing `_`.

## Testing (manual)

- `SLED_Marketing`: `runSelfTest()` in Apps Script editor.
- `SLG_Capacity`: `Diagnostics.js` helpers.
- `*_DM`: Debug menu items in `onOpen()`.
- Otherwise: exercise web app / menu, `npm run logs`.

## Known structural exceptions

- **PS_SPA:** may use `rootDir: ""` with deployable files at project root; confirm `.clasp.json` before edit/push.
- **Root tooling** (`README.md`, workspace file) may lag newer solutions; `config/apps.json` and directory listing are more complete for discovery.
- **GoLives consumers** may pin different library versions — read each `appsscript.json`.

## Entry points

| Pattern | Typical entry |
|---------|----------------|
| `*_DM` | `onOpen()` (`Code.js`), `doGet` (`WebAppCode.js`) |
| Go Lives | `doGet`, `onOpen`, `onEdit` |
| Standalone web apps | `doGet` in main server file |

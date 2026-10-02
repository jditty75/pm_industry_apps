# CLAUDE.md — Workday Apps Script Monorepo

Guidance for Claude Code when working in this repository.

Owner: Jeff Ditty (jeffrey.ditty@workday.com) — single developer.
Root: `C:\JD` (Windows, PowerShell primary shell).
Source of truth: this repo. Runtime target: Google Apps Script, deployed via `clasp`.

---

## 1. What this repo is

A **Google Apps Script (GAS) monorepo** holding 2 shared GAS libraries and 14 GAS
solutions for Workday Professional Services delivery teams. Most solutions are
container-bound to a Google Sheet and expose an HtmlService web app; the Sheet is
both the datastore and the admin surface.

This is **not** a typical Node monorepo:

- **No workspace manager.** No pnpm/yarn workspaces, no turborepo, no lerna, no `-w` flags.
- Root [package.json](package.json) declares only `shx` as a devDependency and is otherwise inert.
- Each project has its own `package.json` whose scripts are thin `clasp` wrappers.
- **No bundler, no transpiler, no TypeScript, no test runner, no linter.** Source in
  `src/` is pushed to Apps Script verbatim.
- Dependencies between projects are **GAS library references** in `src/appsscript.json`
  (by `libraryId` + `version`), not npm packages.

---

## 2. Repository layout

```
C:\JD
├── libraries/              Shared GAS libraries (published, versioned)
│   ├── DepMngr/            → consumed as "CoreLib"
│   └── GoLives/            → consumed as "GoLives"
├── solutions/              14 GAS projects (mostly container-bound to Sheets)
├── snapshots/              Read-only historical copies of library/solution versions
├── DHLibrary_v52/          Legacy standalone snapshot of DepMngr @ v52
├── mockups/                Untracked HTML design mockups (portfolio health)
├── Build.ps1               One-time bootstrap/reorg script — already run, do not re-run
├── pull_all.ps1            clasp pull across projects
├── verify.ps1              clasp status across projects
├── apps-script.code-workspace
├── .cursorrules            Global coding rules (mirrored in §7 below)
└── package.json            Inert root manifest
```

### Per-project layout (the standard shape)

```
<project>/
├── src/                 all .js / .gs / .html + appsscript.json (the clasp rootDir)
├── .clasp.json          pins scriptId + rootDir — GITIGNORED, local only
├── .claspignore         restricts push to src/
├── package.json         clasp npm scripts
└── .cursorrules         project-specific AI conventions
```

**`.clasp.json` is gitignored** (`**/.clasp.json`, commit `f111db3`). The scriptId
bindings exist only on this machine. Never commit them; never print scriptIds into
source files.

---

## 3. Application map

### Libraries

| Project | Consumed as | Size | Purpose |
|---|---|---|---|
| [libraries/DepMngr](libraries/DepMngr) | `CoreLib` | ~35.9k LOC, 21 modules | Deployment-health engine: data access, analytics, reporting, web UI, notifications, Salesforce ingest |
| [libraries/GoLives](libraries/GoLives) | `GoLives` | ~2.2k LOC, 1 module | Go-live tracker engine: sheet builders, customer logo resolution, Slides/CSV export |

**DepMngr module map** (`libraries/DepMngr/src/`) — each file exposes one IIFE namespace
(`var CoreX = (function () { ... })()`), except `CoreHistory`, `CoreSalesforce`, and
`CoreTrends` which are plain object literals:

| Module | Role |
|---|---|
| [CoreConfig.js](libraries/DepMngr/src/CoreConfig.js) | `AppConfig` typedefs + config validation/defaults. **Read this first** — it documents the whole config contract and the phase history |
| [CoreData.js](libraries/DepMngr/src/CoreData.js) (9.5k LOC) | All sheet reads/writes, deployment + go-live shaping, overrides, product-mode union |
| [CoreUI_Js.js](libraries/DepMngr/src/CoreUI_Js.js) (6.9k) / [CoreUI_Css.js](libraries/DepMngr/src/CoreUI_Css.js) (3.0k) / [CoreUI_Markup.js](libraries/DepMngr/src/CoreUI_Markup.js) (2.3k) | Web app front-end delivered as strings from the library; design tokens live in `CoreUI_Css` |
| [CoreUI.js](libraries/DepMngr/src/CoreUI.js) | Assembles the three UI parts |
| [CoreReport.js](libraries/DepMngr/src/CoreReport.js) (2.8k) | HTML report builders (inline, Outlook-safe, V2) |
| [CorePortfolioMomentum.js](libraries/DepMngr/src/CorePortfolioMomentum.js) (1.7k) / [CorePortfolioHealth.js](libraries/DepMngr/src/CorePortfolioHealth.js) | Portfolio health + momentum analytics |
| [CoreNotify.js](libraries/DepMngr/src/CoreNotify.js) (1.6k) | Notification config sheet, digests, reminders |
| [CoreTrends.js](libraries/DepMngr/src/CoreTrends.js) / [CoreHistory.js](libraries/DepMngr/src/CoreHistory.js) | Trend series + snapshot history |
| [CoreSalesforce.js](libraries/DepMngr/src/CoreSalesforce.js) | SFDC-sourced sheet handling |
| [CoreFreshnessMonitor.js](libraries/DepMngr/src/CoreFreshnessMonitor.js) | Data-staleness detection |
| [CoreAnalytics.js](libraries/DepMngr/src/CoreAnalytics.js), [CoreExecSummary.js](libraries/DepMngr/src/CoreExecSummary.js), [CoreNotable.js](libraries/DepMngr/src/CoreNotable.js), [CoreDistribute.js](libraries/DepMngr/src/CoreDistribute.js), [CoreSurveySchedule.js](libraries/DepMngr/src/CoreSurveySchedule.js), [CoreUsers.js](libraries/DepMngr/src/CoreUsers.js), [CoreUtils.js](libraries/DepMngr/src/CoreUtils.js) | Supporting modules |

### Solutions — Deployment Health family ("`*_DM`", consumes `CoreLib`)

Five near-identical shells over DepMngr. Each has `Code.js` (menu + thin wrappers),
`Config_<APP>.js` (the `APP_CONFIG` global), `WebAppCode.js` (`doGet` + web endpoints),
`WebApp.html`, `ChangeLog.js`.

| Project | `appId` | Domain | CoreLib pin |
|---|---|---|---|
| [solutions/SLG_DM](solutions/SLG_DM) | `SLG` | State & Local Government | `"0"` + devMode (HEAD) |
| [solutions/HC_DM](solutions/HC_DM) | `HC` | Healthcare | `"0"` + devMode (HEAD) |
| [solutions/HENP_DM](solutions/HENP_DM) | `HENP` | Higher Ed / Nonprofit | `"0"` + devMode (HEAD) |
| [solutions/AI_DM](solutions/AI_DM) | `AI` | Product-mode portfolio (AI) | `"0"` + devMode (HEAD) |
| [solutions/EVI_DM](solutions/EVI_DM) | `EVI` | Product-mode portfolio (EVI) | `"0"` + devMode (HEAD) |

`SLG_DM` additionally carries `DataFreshnessMonitorHost.js`.

`AI_DM` / `EVI_DM` are the newer **product-mode** apps — they set a `productMode*`
config block (`productModeUnionEnabled`, `productModeSourceMode: 'pfOnly'`,
`productModeDisplayGrain`, `productModeDataSource: 'productFunction'`, …) so the same
CoreLib engine pivots on product/product-function instead of industry. Recent work in
this area: DHP (deployment health plan) indicators, and the mockups in [mockups/](mockups/).

### Solutions — Go Lives family (consumes `GoLives`)

Thin wrappers; each is `Code.js` + `Index.html`. `Code.js` re-exports library functions
because GAS menus and `google.script.run` can only call container-bound functions.

| Project | GoLives pin | Notes |
|---|---|---|
| [solutions/SLG_GoLives](solutions/SLG_GoLives) | `34` | |
| [solutions/HC_GoLives](solutions/HC_GoLives) | `33` | hardcoded `EXPORT_FOLDER_ID` |
| [solutions/HENP_GoLives](solutions/HENP_GoLives) | `35` | |

⚠️ The three consumers sit on **three different library versions**. Confirm the pin
before assuming a GoLives function exists in a given app.

### Solutions — Standalone (no GAS library dependency)

| Project | Size | Purpose / structure |
|---|---|---|
| [solutions/SLG_Capacity](solutions/SLG_Capacity) | ~47.7k LOC — **largest app** | Consulting capacity & staffing forecast. Server: `Api.js` (6.2k, all `google.script.run` endpoints + `doGet`), `Engine.js` (calc), `Ingest.js`, `Diagnostics.js` (6.4k), `Constants.js` (sheet/config names), plus `Assignments`/`Commitments`/`Overrides`/`Scenarios`/`OnLeave`/`CapacityAdjustments`/`ProjectIndex`/`TeamsConfig`/`AccessControl`/`Bootstrap`/`EnrichedData`/`Util`. Front-end: `JavaScript.html` (16.6k), `Stylesheet.html` (7.8k), `Index.html` + canvas/drawer partials. Also `pipeline/transform.py`, `pipeline/wow_transform.py` (offline Python data prep, not deployed) |
| [solutions/SLG_ConsultingHub](solutions/SLG_ConsultingHub) | ~5.8k | Topic submission / voting / agenda for consulting meetings. Sheet-backed (`Topics`, `Votes`, `Meetings`, `Config`, `Users`), self-migrating schema via `migrateTopicsSchema_()` |
| [solutions/HC_Wellness](solutions/HC_Wellness) | ~5.5k | Healthcare Wellness leadership agenda web app + Gmail agenda/reminder/closeout emails, WPS health HTML export |
| [solutions/SLED_Marketing](solutions/SLED_Marketing) | ~2.0k | Upcoming core go-live timeline for SLED marketing + Excel export. `.gs` files, `FIELD_REGISTRY` in `Config.gs` drives columns. **Has its own [README](solutions/SLED_Marketing/README.md) and the repo's only test entry point, `runSelfTest()` in `Tests.gs`** |
| [solutions/SLED_Pipeline](solutions/SLED_Pipeline) | ~1.3k | SLED pipeline analysis web app. `.gs` files, `APP_CONFIG` in `Config.gs`, `include_()` partial helper |
| [solutions/PS_SPA](solutions/PS_SPA) | ~0.5k | US Industry Tool Portal (app launcher + announcements). Reads a *external* config Sheet by hardcoded ID |

---

## 4. Dependency graph

```
libraries/DepMngr  (CoreLib, libraryId 1qIBm-…)
   └── SLG_DM, HC_DM, HENP_DM, AI_DM, EVI_DM      [all pinned to "0" = HEAD, developmentMode:true]

libraries/GoLives  (libraryId 1mBYV…)
   └── SLG_GoLives (v34), HC_GoLives (v33), HENP_GoLives (v35)

standalone: SLG_Capacity, SLG_ConsultingHub, HC_Wellness,
            SLED_Marketing, SLED_Pipeline, PS_SPA
```

**Critical operating fact:** every `*_DM` solution references CoreLib at
`version: "0", developmentMode: true` — i.e. **library HEAD**. A `clasp push` inside
`libraries/DepMngr` therefore lands in all five production DM apps immediately. There is
no staging buffer. Treat every DepMngr push as a production change and say so when
proposing one.

---

## 5. Commands

There is **no root-level dev/build/test/lint**. All commands run from inside a project
directory. Every project's `package.json` exposes the identical script set:

| Command | Runs | Meaning |
|---|---|---|
| `npm run pull` | `clasp pull` | Sync local `src/` from Apps Script HEAD |
| `npm run push` | `clasp push` | Push `src/` to Apps Script HEAD — **HEAD is DEV** |
| `npm run open` | `clasp open` | Open the project in the Apps Script editor |
| `npm run status` | `clasp status` | Show which files would be pushed |
| `npm run deploy` | `clasp push && clasp deploy` | Push then cut an immutable deployment — **PROD** |
| `npm run version` | `clasp version` | Cut a new library version (libraries only) |
| `npm run logs` | `clasp logs` | Stackdriver execution logs |

Repo-wide PowerShell helpers (run from anywhere):

```powershell
C:\JD\pull_all.ps1    # clasp pull across projects, with skip/fail summary
C:\JD\verify.ps1      # clasp status across projects, to confirm wiring
```

`Build.ps1` is the **one-time bootstrap** that created this structure. It has already
run and it *deletes and rewrites* root files (`.cursorrules`, `README.md`,
`package.json`, `apps-script.code-workspace`) plus every project's `package.json`,
`.clasp.json`, `.claspignore`, `.cursorrules`. **Never run it.**

### Testing / verification

There is no test framework. Verification is manual:

- `SLED_Marketing` — run `runSelfTest()` from `Tests.gs` in the Apps Script editor.
- `SLG_Capacity` — use `Diagnostics.js` helpers.
- `*_DM` — the `Debug:` menu items registered in `onOpen()` (e.g.
  `debugShowTableRanges`, `debugShowCellValues`).
- Otherwise: push to HEAD, exercise the web app / sheet menu, read `npm run logs`.

Do not claim a change is tested unless one of the above was actually run.

---

## 6. Workflow rules

### Editing a solution
```powershell
cd C:\JD\solutions\<APP>
npm run pull          # reconcile first — the Apps Script editor may be ahead
# edit files in src/
npm run push          # DEV
npm run deploy        # PROD (new immutable version)
```

Always `npm run pull` before editing. Jeff edits in the Apps Script web editor too, so
local `src/` can be stale and a blind push silently discards that work.

### Editing a library
```powershell
cd C:\JD\libraries\<LIB>
npm run pull
# edit files in src/
npm run push                        # lands in every developmentMode consumer NOW
npm run version -- "Description"    # cut immutable version
# then bump dependencies.libraries[].version in each consumer's src/appsscript.json
# and record the new version in VERSIONS.md
```

`VERSIONS.md` in both libraries is still at the bootstrap stub (only row `1`) even though
DepMngr HEAD is past v71 and GoLives past v35. The real history is in `snapshots/` and
git. If you cut a version, add the row.

### Library version testing
To test a library change against a consumer, temporarily set that consumer's
`dependencies.libraries[].version` to `"0"` (HEAD), test, then revert to a numbered
version. The `*_DM` apps are already permanently on `"0"`.

### Git
- See [AGENTS.md](AGENTS.md) for vendor-neutral agent rules (Git ownership, production authorization, secrets).
- Branch is `main`; feature branches follow `feature/<name>` (e.g. `feature/productmode-pf-source`).
- Commits use Conventional Commits with an app/area scope: `feat(dhp):`, `fix(wellness):`, `chore(ui):`.
- Agents own routine Git operations (status, branch, stage, commit, pull/rebase when safe, push). Do not ask Jeff to run routine Git commands. Never force-push `main` or rewrite shared history.

---

## 7. Coding rules (from `.cursorrules` — enforce these)

- **V8 runtime always.** `let`/`const`, arrow functions, classes, template literals are fine.
  (Legacy files use `var` + `function` — match the surrounding file's style rather than
  mixed-modernizing it.)
- **JSDoc on every public function**, with `@param` and `@return`.
- `Logger.log` calls prefixed with the function name, e.g. `Logger.log('doGet: …')`.
- **Batch SpreadsheetApp reads/writes** — `getValues()`/`setValues()`, never per-cell loops.
- **`try`/`catch` around `UrlFetchApp`** and other external calls.
- **No hardcoded scriptIds, sheet IDs, or secrets** — use `PropertiesService.getScriptProperties()`.
- Private helpers use the GAS trailing-underscore convention: `parseDateValue_()`.
- All source lives in `src/`; `src/appsscript.json` is the pushed manifest.
- Line endings: LF for `.js`/`.gs`/`.html`/`.json`/`.md`, CRLF for `.ps1`/`.bat`/`.cmd`
  (enforced by [.gitattributes](.gitattributes)). Several files carry a UTF-8 BOM — leave it alone.

---

## 8. Architectural patterns

**Config-injection library pattern (the DM family).** Each solution declares a global
`APP_CONFIG` object in `Config_<APP>.js` conforming to the `AppConfig` typedef in
`CoreConfig.js`, then passes it into every CoreLib call:
`CoreLib.CoreData.getNotificationKeysForMenu(APP_CONFIG)`. All app-specific knowledge —
sheet tab names, 1-based column indices, report titles/logos, feature toggles, UI blocks —
lives in that config. **Behavior differences between DM apps belong in `APP_CONFIG`, not
in `if (appId === …)` branches in the library.**

**Thin container-bound wrappers.** GAS cannot invoke library functions from a Sheet menu
or `google.script.run`. So `Code.js` in every consumer is a wrapper layer that re-exports
library functions one-for-one. Adding a library function that the UI must reach means
adding a wrapper in each consumer. `SLG_GoLives/src/Code.js` keeps an explicit
"FUNCTION INVENTORY" comment for exactly this reason — keep it current.

**Sheet-as-database.** Google Sheets tabs are the datastore. Tab names are centralized
(`APP_CONFIG.sheets`, or `Constants.js` in SLG_Capacity, or `Config.gs` in the SLED apps).
Named ranges (`HealthTotal`, `ExecSummary_Tbl`, …) locate report tables. Some apps
self-heal schema on run (`migrateTopicsSchema_()`, `bootstrap()`).

**Server-rendered HtmlService web apps.** `doGet()` builds an `HtmlService` template,
`include()` / `include_()` inlines partials, `setXFrameOptionsMode(ALLOWALL)` allows
embedding. No client framework, no build step — hand-written HTML/CSS/JS in `.html` files.
In DepMngr the front-end is instead *generated as strings* by the `CoreUI_*` modules.

**Registry-driven columns.** `FIELD_REGISTRY` (SLED_Marketing) and `APP_CONFIG.columns`
(DM family) mean adding a display/export column is a one-row config change.

**Phase-annotated evolution.** `CoreConfig.js` and each `Config_*.js` carry a "Phase
history" header (Phase 0/1/2/3a/3i, S1, D1, T1, MGM/PGL, V2.6, WFM.25, WP2.0). When adding
config, follow the convention: annotate the new key with its phase/feature tag.

**Version snapshots.** `snapshots/` holds 20 tracked point-in-time copies
(`DHLibrary_v58`–`v71`, `HENP_v60`–`v63`, `SLG_v58`, `SLG_v64`); `DHLibrary_v52/` is an
older one at root. These are **read-only history for diffing** — never edit them, never
push them (`DHLibrary_v52/.clasp.json` points at the live DepMngr scriptId, so a stray
`clasp push` from that directory would overwrite the library with v52 code).

---

## 9. Configuration & environment

- **No `.env` files, no npm-level env vars.** `.gitignore` covers `.env*` defensively only.
- **Runtime config lives in three places:**
  1. `src/appsscript.json` — runtime (`V8`), `timeZone: America/New_York`,
     `exceptionLogging: STACKDRIVER`, oauth scopes, advanced services (Gmail v1, Drive v2/v3),
     library pins, and `webapp: { executeAs: USER_DEPLOYING, access: DOMAIN }`.
  2. `Config_<APP>.js` / `Config.gs` / `Constants.js` — the `APP_CONFIG` object.
  3. Google Sheet config tabs — e.g. SLG_Capacity's `Config_ICP`, `Config_Roles`,
     `Config_Calendar`, `Config_ColumnAliases`, `Config_Teams`, `Config_Ingest_Filters`,
     `Config_SLG_Managers`, `Config_Settings` (key/value settings read via `readSettings_()`).
- **`PropertiesService` is barely used.** The only script property in source is
  `SOURCE_SPREADSHEET_ID` (SLED_Marketing standalone mode). SLG_Capacity uses script
  properties for cache telemetry (`enriched_cache_version`, `enriched_hits`,
  `enriched_misses`, `enriched_last_payload_kb`, `enriched_cache_last_invalidated`).
- **Known rule violations** — hardcoded IDs/URLs that contradict §7. Don't add more; flag
  them if you touch the file, but don't refactor them unasked:
  - `PS_SPA/src/Code.js` → `APPS_CONFIG_SHEET_ID`
  - `HC_GoLives/src/Code.js` → `EXPORT_FOLDER_ID`
  - `SLG_DM/src/Code.js` → `WEB_APP_URL` (deployed web app URL)
  - `Config_*.js` → `headerLogoUrl` / `sanaLogoUrl` CDN URLs

### Entry points by app

| App | Entry points |
|---|---|
| `*_DM` | `onOpen()` (Code.js), `doGet(e)` (WebAppCode.js) |
| `*_GoLives` | `doGet()`, `onOpen()`, `onEdit(e)` (Code.js) |
| `HC_Wellness` | `doGet()`, `onOpen()`, `include(filename)` (Code.js) |
| `SLG_Capacity` | `doGet()`, `onOpen()`, `include(filename)` (Api.js) |
| `SLG_ConsultingHub` | `doGet(e)`, `include(filename)` (Code.js) |
| `SLED_Marketing` | `doGet(e)`, `include(name)` (Code.gs) |
| `SLED_Pipeline` | `doGet(e)`, `include_(filename)` (Code.gs) |
| `PS_SPA` | `doGet(e)` (Code.js) |
| `GoLives` lib | `onEditHandler(e)`, `buildMenu(label)` |

---

## 10. Known drift and gotchas

Repo hygiene issues to be aware of — do not "fix" these unprompted, but account for them:

1. **Root tooling knows only 9–11 of the 14 solutions.** [README.md](README.md),
   [.cursorrules](.cursorrules), [apps-script.code-workspace](apps-script.code-workspace),
   [pull_all.ps1](pull_all.ps1) and [verify.ps1](verify.ps1) all predate `AI_DM`, `EVI_DM`,
   `PS_SPA`, `SLED_Marketing`, `SLED_Pipeline`. `pull_all.ps1` will silently skip them.
   Also: `verify.ps1` still omits `HENP_GoLives` with a stale "scriptId is empty" comment —
   it has a scriptId now.
2. **Missing per-project scaffolding.** `AI_DM`, `EVI_DM`, `PS_SPA`, `SLED_Marketing` have
   **no `package.json`** — `npm run push` does not work there; call `clasp push` directly.
   `AI_DM`, `EVI_DM`, `PS_SPA`, `SLED_Marketing`, `SLED_Pipeline` have no `.cursorrules`;
   `AI_DM`, `EVI_DM`, `HC_DM`, `HENP_DM`, `PS_SPA`, `SLED_Marketing` have no `.claspignore`.
3. **`PS_SPA` is misconfigured.** Its `.clasp.json` sets `rootDir: ""` and `Code.js`,
   `Index.html`, `appsscript.json` sit at the project root while `src/` holds *duplicate*
   `Code.js` and `Index.html`. Edits to `src/` there are **not** what gets pushed.
4. **`SLED_Marketing`** uses `rootDir: "src"` (others use `"./src"`) — harmless but inconsistent.
5. **File extension split.** `.js` in most projects, `.gs` in `SLED_Marketing` and
   `SLED_Pipeline`. Match the project you are in.
6. **`libraries/DepMngr` has no `.claspignore`** despite `rootDir: ./src` — pushes still
   scope to `src/`, but there is no belt-and-braces guard.
7. **DepMngr HEAD is ahead of `snapshots/DHLibrary_v71`**, and has three modules no
   snapshot has (`CoreDistribute.js`, `CoreFreshnessMonitor.js`, `CoreNotify.js`).
8. **`mockups/` is untracked** (currently the only dirty path in git status).

---

## 11. Working agreements for Claude

- **Pull before you edit.** Local `src/` may be behind the Apps Script editor.
- **Treat a DepMngr push as a five-app production deploy** (§4). Call that out before doing it.
- **Put app differences in `APP_CONFIG`, not in library conditionals** (§8).
- **Adding a library function the UI calls?** Add the container-bound wrapper in each
  consumer's `Code.js` too, and update the FUNCTION INVENTORY comment where one exists.
- **Never edit `snapshots/` or `DHLibrary_v52/`**, and never `clasp push` from them.
- **Never run `Build.ps1`.**
- **Never commit `.clasp.json`** or write scriptIds into source.
- When adding config keys, annotate them with the phase/feature tag in the file's header
  convention (§8).
- State plainly what was and was not verified — there is no test suite to hide behind.

# Application families (DepMngr and GoLives)

Progressive reference for agents working in the Workday GAS monorepo. Production safety and CLASP rules remain in the GAS skill and `references/deployment.md`.

## Shared libraries are not web apps

| Path | Role | Standalone UI |
|------|------|----------------|
| `libraries/DepMngr` | Shared **function library** (Deployment Health / CoreLib) | **No** — UI is assembled in consumers |
| `libraries/GoLives` | Shared **function library** (Go Lives sheet + web helpers) | **No** |

Local UI preview always targets a **consuming solution** under `solutions/`, optionally inlining library-generated HTML/CSS/JS from the family library on disk. There is no library-only browser preview.

## DepMngr family (`*_DM`)

**Consumers:** `solutions/*_DM` (e.g. SLG_DM, HC_DM, HENP_DM, EVI_DM, PDX_DM, HS_DM).

**Relationship:**

- Thin shell: `Code.js` (menus, sheet triggers, `google.script.run` endpoints), `Config_<APP>.js` (`APP_CONFIG`), `WebAppCode.js` (`doGet`, delegates to CoreLib).
- Shared UI: `WebApp.html` template + `libraries/DepMngr` (`CoreUI_*`, client bundle, server logic).

**When changing a `*_DM` app:**

1. Decide whether the change belongs in **app config/shell** vs **shared DepMngr** behavior.
2. Read the consumer `appsscript.json` library pin and `developmentMode`.
3. Identify **all** DepMngr consumers (every `*_DM` manifest referencing CoreLib).
4. Never assume a library change affects only the app named in the task.

**HEAD / version `"0"` risk:** see `references/workday-monorepo.md`.

## GoLives family (`*_GoLives`)

**Consumers:** `solutions/SLG_GoLives`, `HC_GoLives`, `HENP_GoLives`.

**Relationship:**

- Solutions hold `Index.html` (large client UI) and thin `Code.js` wrappers around `GoLives` library functions.
- Library: `libraries/GoLives/src/GoLives.js` — server/sheet logic, not a standalone HtmlService entry.

Apply the same family-aware reasoning as DepMngr: assess all GoLives consumers before changing shared behavior.

**Release planning:** `.\release.ps1 DepMngr -Plan` / `.\release.ps1 GoLives -Plan` — see `references/shared-library-release.md`.

## Standalone solutions

No DepMngr/GoLives family library (examples): `SLG_Capacity`, `SLG_ConsultingHub`, `HC_Wellness`, `SLED_Marketing`, `SLED_Pipeline`, `PS_SPA`, `GS_Kit` (design assets only).

## UI preview

See `docs/agent/ui-preview.md`. Preview is served on **127.0.0.1** with structural HTML validation; inspect the browser when possible. It does not replace Apps Script execution or production verification.

# DM Family Rationalization Analysis

**Scope:** Six live Deployment Health workbooks (`SLG_DM`, `HC_DM`, `HENP_DM`, `EVI_DM`, `PDX_DM`, `HS_DM`), structural snapshots under `docs/migrations/live/` (gitignored XLSX; read-only inputs), sanitized structure JSON in this folder, `libraries/DepMngr`, all `*_DM` shells, `Config_*.js`, `google.script.run` contracts, manifests, and specs under `docs/specs/`.

**Analysis git SHA (snapshots):** `953068a698d9d13da5b3a0520d2174c5326c789a` (per `*.meta.json` / `*.structure.json`).

**Constraints honored:** No customer cell values, OAuth tokens, Script IDs, or spreadsheet file IDs in tracked output. No code/workbook refactors, no CLASP mutation. Existing DepMngr and `SLG_DM` WIP left untouched.

## Deliverables in this folder

| Artifact | Purpose |
|----------|---------|
| [workbook-consistency-matrix.md](./workbook-consistency-matrix.md) | Six-way sheet/header/named-range comparison + classifications |
| [workbook-consistency-matrix.json](./workbook-consistency-matrix.json) | Machine-readable matrix |
| [cross-layer-dependency-graph.md](./cross-layer-dependency-graph.md) | Workbook ↔ config ↔ shell ↔ DepMngr ↔ UI |
| [classification-inventory.md](./classification-inventory.md) | Per-sheet and per-config-key findings |
| [depmngr-usage-analysis.md](./depmngr-usage-analysis.md) | CoreLib surface vs six consumers |
| [depmngr-consumer-usage.json](./depmngr-consumer-usage.json) | CoreLib call graph + manifest pins |
| [google-script-run-contracts.md](./google-script-run-contracts.md) | Interactive UI server API + data sources |
| [google-script-run-contracts.json](./google-script-run-contracts.json) | Wrapper presence by app |
| [preview-fixture-design.md](./preview-fixture-design.md) | Canonical sanitized preview workbook + scenarios |
| [cleanup-plan.md](./cleanup-plan.md) | Ordered cleanup (workbook + code), risk-ranked |
| [preview-data-plan.md](./preview-data-plan.md) | Minimum work to make `preview.ps1` realistically interactive |
| [corelib-pin-strategy.md](./corelib-pin-strategy.md) | DepMngr pin evidence and recommended migration sequence |
| [tools/rationalization_analyze.py](./tools/rationalization_analyze.py) | Regenerate JSON artifacts |

Regenerate structure from live snapshots: `.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -Force`  
Regenerate JSON analysis: `python docs/analysis/dm-family/tools/rationalization_analyze.py`

## Executive summary

### Architecture (stable pattern)

All six apps share the same **thin-server / fat-library** shape:

1. **Workbook** — Salesforce connector tabs (`SFDC_*`), override/meta sheets, legacy report tables (`Dashboard`, `*_TBL`), ops sheets (`NotificationConfig`, `ReportDistributionLog`, `AppUsers`).
2. **`APP_CONFIG`** (`Config_*.js`) — Tab names, ProductMode vs IndustryMode rules, UI tabs, report/distribution, notifications, trends/momentum.
3. **App shell** — `WebApp.html` + `WebAppCode.js` exposes `google.script.run` entry points; `Code.js` menu/triggers.
4. **DepMngr (`CoreLib`)** — Data merge, UI markup/JS/CSS, reports, notify, trends, portfolio modules.
5. **Client** — Inlined `CoreUI_Js` bundle calls only `WebAppCode.js` wrappers (no direct CoreLib from browser).

Behavioral differences are **intended** to be config-driven. Residual `cfg.appId` branches in CoreLib (e.g. EVI diagnostics, HENP student) are exceptions to reconcile over time.

### Workbook family shape

- **23 sheets present in all six workbooks** — the operational “spine” (SFDC ingest, overrides, dashboard/report tables, CSAT, notifications). See matrix doc.
- **Sheet count drift:** 29 (`HC_DM`, `HENP_DM`) → 37–41 (others). Extra tabs are mostly **DNU_** archives, **ProductMode** artifacts (`AI_*`, escalations on PDX/SLG), or **HENP-only** `StudentDeploymentData`.
- **Critical legacy coupling:** `DNU_Go Lives` and `DNU_ActiveDeployments` remain **formula data sources** for `RecentGL_TBL`, `FutureGL_TBL`, and `Dashboard` in every snapshot (sample cross-refs captured in `*.structure.json`). Renaming or deleting DNU tabs without rewiring formulas would break legacy report tables even though runtime UI reads SFDC/enrichment paths.

### Config vs workbook drift (intentional + stale)

- **`sheets.activeDeployments` / `sheets.goLives`** still appear in configs but **no live workbook** exposes `ActiveDeployments` or `Go Lives` tabs (except lone `ActiveDeployments` on `HC_DM` only). Runtime active/go-live paths use **SFDC + ProductMode union** (or industry filters), not those legacy tab names. Treat as **POSSIBLY_LEGACY config keys** — verify before deleting.
- **`sheets.ddAssignment`:** `DD` tab (`HC_DM`, `HENP_DM`) vs `DD Assignment` (others). Workbooks match config; CoreConfig default `'DD Assignment'` is misleading for HC/HENP.
- **Header drift** on wide SFDC tabs (`SFDC_Deployments`, `SFDC_DeploymentHistory`, etc.) — connector export evolution, not necessarily app logic drift. Classify as **UNKNOWN_RUNTIME_DEPENDENCY** until header resolver logs are checked per app.

### DepMngr / consumer alignment

- **Library pins are inconsistent by design (WIP):** `SLG_DM` HEAD (`139` + `developmentMode`); `HC_DM`/`HENP_DM` pinned `139`; `EVI_DM` pinned `113`; `PDX_DM`/`HS_DM` HEAD (`0`). Any DepMngr push affects HEAD consumers immediately.
- **Wrapper surface:** All UI `google.script.run` methods are implemented on at least one consumer; several apps carry large **debug-only** wrapper sets (`HS_DM`/`PDX_DM` ~2k lines vs `HC_DM` ~900).
- **App-specific server endpoints:** `getStudentTabData` / `saveStudentDeploymentFields` (HENP); `getEscalationsDashboardData` (PDX); portfolio Slides helpers on EVI/PDX/HS; SLG-only momentum debug cluster.

### Specs cross-reference

- [`docs/specs/dhm-config-inventory.md`](../../specs/dhm-config-inventory.md) — Config contract (pre-HS/PDX; still valid for config semantics).
- [`docs/specs/productmode-hs-pdx-split.md`](../../specs/productmode-hs-pdx-split.md) — Mechanism A/B leakage gaps for ProductMode (still relevant for HS/PDX + shared CoreLib fixes).
- [`docs/specs/henp-student-reintegration.md`](../../specs/henp-student-reintegration.md) — HENP student tab workbook + API expectations.

### Hardcoded production URLs (elimination candidates)

Configs embed **brand/logo CDN URLs** and **`ui.personalization.viewAsReadOnly.baseUrl`** web app deployment URLs (per-app). These are not secrets but are **environment-specific**; prefer PropertiesService or deploy-time injection for non-prod previews. Do not copy URL literals into further tracked docs.

## Next steps

1. **Cleanup Plan** — [cleanup-plan.md](./cleanup-plan.md)  
2. **Preview Data Plan** — [preview-data-plan.md](./preview-data-plan.md)

# Cleanup plan (ordered, analysis-only — not executed)

Prioritized by confidence, blast radius, and dependency order. Complete workbook formula audit before any tab deletion.

## Phase 0 — Inventory gates (no user-visible change)

1. **Align library pins** — Document target: all six on same numbered CoreLib after SLG WIP lands; until then, treat HEAD pushes as production-impacting for SLG/PDX/HS.  
   *Depends:* Jeff release schedule. *Risk:* behavioral drift across apps.

2. **Run per-app diagnostics** (menu): `_validateEffectiveDeployments` (HC/HENP), ProductMode debug suite (EVI/HS/PDX), `_debugSfdcColumns` where headers drift flagged.  
   *Output:* confirm header resolver maps for `SFDC_*` tabs.

3. **Export formula dependency map** from live XLSX (tooling extension to `snapshot_dm_workbooks.py`) — full graph for `Dashboard` / `*_TBL` → DNU sheets.  
   *Blocks:* DNU tab removal.

## Phase 1 — High-confidence, low-risk

| # | Item | Type | Dependency | Risk |
|---|------|------|------------|------|
| 1.1 | Remove duplicate `DNU__PerfCache` (SLG) after confirming cache keys | Workbook | None | Low |
| 1.2 | Delete EVI `Contact1`/`Contact2` if connector confirms unused | Workbook | SFDC connector config | Low |
| 1.3 | Prune `columns.goLives` from configs + typedef | Config/code | None | Low (unused) |
| 1.4 | Normalize `ddAssignment` tab name HC/HENP → `DD Assignment` **or** document `DD` as canonical | Workbook+config | User habit | Medium (links/macros) |
| 1.5 | Trim duplicate debug functions from HS/PDX `WebAppCode.js` into shared debug module | Code | None | Low if menu-only |

## Phase 2 — Legacy workbook/config reconciliation

| # | Item | Type | Dependency | Risk |
|---|------|------|------------|------|
| 2.1 | Rewire `RecentGL_TBL` / `FutureGL_TBL` / `Dashboard` formulas off `DNU_Go Lives` & `DNU_ActiveDeployments` to SFDC-based ranges or static stubs | Workbook | 0.3 formula map | **High** (monthly report) |
| 2.2 | Remove `sheets.activeDeployments` / `sheets.goLives` config keys after 2.1 + code grep | Config | 2.1 | Medium |
| 2.3 | Rename `DNU_ChangeLog` → `ChangeLog` or update config to DNU name | Workbook+config | Report menus | Medium |
| 2.4 | Drop `ActiveDeployments` tab (HC) if no readers | Workbook | 2.1 | Medium |
| 2.5 | Hide/unify `OverrideAudit` — present only on 4/6 apps | Workbook | CoreData audit writer | Medium |

## Phase 3 — CoreLib / ProductMode (cross-app)

Per [productmode-hs-pdx-split.md](../../specs/productmode-hs-pdx-split.md):

| # | Item | Dependency | Risk |
|---|------|------------|------|
| 3.1 | Fix Mechanism A gaps on overrides, analytics snapshot, notifications | CoreLib | **High** — all consumers on HEAD |
| 3.2 | Replace `cfg.appId === 'EVI_DM'` gates with config flags | CoreLib | Medium |
| 3.3 | Align `report.productScope` with `activeDeployments.productMode*` | Config | Medium |

## Phase 4 — Hardcoded URL / ID hygiene

| # | Item | Notes |
|---|------|-------|
| 4.1 | Move `ui.personalization.viewAsReadOnly.baseUrl` to Script Properties per deploy | Config |
| 4.2 | Keep brand CDN URLs in config (cosmetic) or centralize in `CoreConfig` defaults | Low priority |

## Phase 5 — Aggressive (only after Phases 2–3)

- Delete hidden **DNU_*** sheets en masse.
- Remove Go Lives legacy UI branch (`ui.goLivesTab.mode === 'legacy'`).
- Remove Trends legacy per-chart loaders if v1 dashboard mandatory everywhere.

## Explicit non-goals (this cleanup pass)

- No customer data migration.
- No CLASP deploy without explicit authorization.
- No changes to in-flight DepMngr / SLG_DM WIP files unless part of a approved fix tranche.

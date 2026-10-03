# DepMngr function and config usage (six consumers)

Machine-readable graph: [depmngr-consumer-usage.json](./depmngr-consumer-usage.json).

## Manifest / library pins (as of analysis)

| App | CoreLib version | developmentMode | Notable scopes |
|-----|-----------------|-----------------|----------------|
| SLG_DM | 139 | true (HEAD) | `script.send_mail` |
| HC_DM | 139 | false | — |
| HENP_DM | 139 | false | — |
| EVI_DM | 113 | false | `presentations` (Slides export) |
| PDX_DM | 0 | true (HEAD) | `presentations` |
| HS_DM | 0 | true (HEAD) | `presentations` |

**Risk:** Three apps on HEAD + three on pinned versions → production behavior can diverge without a coordinated `npm run version` / manifest bump. SLG WIP on HEAD amplifies blast radius for all HEAD consumers.

## CoreLib calls — shared across all six

Includes: `CoreConfig.withDefaults`, `CoreData.getAllDeployments`, `getRecentGoLives`, `getUpcomingGoLives`, `getGoLivesExplorerData`, `getOverviewSnapshot`, override CRUD, `getCsatTabDataForUI`, `CoreNotify.*`, `CoreDistribute.*`, `CoreReport.build*`, `CoreAnalytics.update`, `CorePortfolioHealth.getSnapshot`, `CorePortfolioMomentum.getMomentumSnapshot`, `CoreTrends.getTrendsDashboardData`, `CoreNotable.*`, `CoreFreshnessMonitor.getFreshnessForUI`, `flushAppCaches`.

## CoreLib calls — partial consumers (thin-wrapper drift)

| Symbol | Apps | Interpretation |
|--------|------|----------------|
| `CoreData._validateEffectiveDeployments` | HC, HENP | Menu diagnostic; not on ProductMode apps |
| `CoreData.debugMdsPglRowsForUI` | HC | HC-only debug wrapper |
| `CoreData.debugDdDigestAssignmentsForUI` | HC | Notification debug |
| `CoreData.debugHenpStudent*` | HENP | Student tab diagnostics |
| `CoreData.buildStudentTabData_` | HENP | Student tab payload |
| `CoreEscalations.*` | PDX (via WebAppCode) | Escalations dashboard |
| `CoreData._debugProductMode*` / `_debugWellnessData` | EVI, PDX, HS | ProductMode debug cluster |
| `CoreData._perfCache*` | SLG, EVI, PDX, HS | SLG cache smoke tests in WebAppCode |
| `CoreData.getAllDeploymentsForUI` direct in Code | EVI only | EVI menu/debug path (UI still uses wrapper) |
| `CorePortfolioHealth` Slides helpers | EVI, PDX, HS | `createPortfolioHealthSlides` UI button |

**Wrapper size drift:** `WebAppCode.js` line counts — HC ~907, HENP ~998, SLG ~1261, EVI ~1383, HS ~2024, PDX ~2087. HS/PDX carry large copied debug blocks; long-term, consolidate debug behind shared `DebugMenu.js` or trim from production deploy bundles.

## Config `sheets.*` keys vs DepMngr readers

DepMngr references (non-exhaustive): `deployments`, `sfdcDeploymentProductFunctions`, `deploymentContacts`, `sfdcContacts`, `deploymentOverrides`, `goLivesOverrides`, `deploymentsMeta`, `wellness`, `csatInFlight`, `deploymentHistory`, `ddAssignment`, `appUsers`, plus report tabs via `CoreReport`.

Keys in **every** `Config_*.js` but **missing or DNU-only** in workbooks:

- `activeDeployments`, `goLives` — legacy tab names
- `changeLog` — use `DNU_ChangeLog` in practice
- `healthMonthlySummary` — often `DNU_HealthMonthlySummary` or absent

Do not remove config keys until workbook + formula audit completes ([cleanup-plan.md](./cleanup-plan.md)).

## Likely dead or low-value library surface

| Item | Confidence | Notes |
|------|------------|-------|
| `columns.goLives` defaults | High | No readers (per specs inventory) |
| `CoreSalesforce._test_phase3a` | High | Dev-only entry |
| Go Lives **legacy** UI branch | Medium | When `ui.goLivesTab.mode === 'legacy'` only |
| Trends **legacy** tab markup | Medium | When v1 dashboard disabled |
| `getActiveDeployments` UI path | Medium | Replaced by `getAllDeploymentsForUI` for Deployments tab; menus may still call |

## App-specific logic inside DepMngr (leakage candidates)

| Location | Pattern | Recommendation |
|----------|---------|----------------|
| `CoreData.js` | `cfg.appId === 'EVI_DM' \|\| 'EVI'` debug gates | Move to config flag `diagnostics.productModeVerbose` |
| HENP student | `buildStudentTabData_`, student caches | Keep module-isolated; ensure guarded by `cfg.student.enabled` only |
| `CoreEscalations` | PDX-first | Gate with `cfg.escalations.enabled` (if not already) |

No `if (HC)`-style branches found at scale; appId checks are the main exception.

## Obsolete workbook candidates (do not delete in this pass)

1. **DNU_*** hidden sheets — after rewiring `Dashboard` / `*_TBL` formulas off `DNU_Go Lives` and `DNU_ActiveDeployments`.
2. **`ActiveDeployments`** (HC) — if confirmed zero menu/report readers.
3. **EVI `Contact1`/`Contact2`** — if connector no longer writes them.
4. **`DNU__PerfCache`** (typo duplicate, SLG only) — merge with `DNU_PerfCache` after cache key audit.

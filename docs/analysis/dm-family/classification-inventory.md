# Classification inventory

Method: static cross-reference of structure JSON, `APP_CONFIG.sheets`, DepMngr readers (`cfg.sheets.*`), `CoreUI_Markup` tab gates, and `google.script.run` usage. Absence of a string reference alone does **not** imply unused (formulas, named ranges, dynamic `callTrends`, menu wrappers).

## Workbook sheets

| Sheet | Classification | Rationale |
|-------|----------------|-----------|
| `SFDC_Deployments`, `SFDC_DeploymentProductFunctions`, `SFDC_DeploymentContacts`, `SFDC_DeploymentHistory`, `SFDC_Wellness`, `SFDC_DHP` | ACTIVE_SHARED | Core ingest + enrichment; all six apps |
| `DeploymentOverrides`, `GoLivesOverrides`, `DeploymentsMeta` | ACTIVE_SHARED | CoreData override/meta maps |
| `AppUsers` | ACTIVE_SHARED | CoreUsers RBAC |
| `CSAT_InFlight` | ACTIVE_SHARED | CSAT tab upload/read |
| `NotificationConfig`, `ReportDistributionLog` | ACTIVE_SHARED | CoreNotify / CoreDistribute |
| `ExecSummary` | ACTIVE_SHARED | Executive summary tab |
| `Dashboard`, `RedYellow_TBL`, `RecentGL_TBL`, `FutureGL_TBL`, `HealthReportSnapshots` | ACTIVE_SHARED | Legacy report + CoreAnalytics snapshot pipeline |
| `Auto Refresh Execution Log` | ACTIVE_SHARED | Connector ops; not UI-critical |
| `DNU_Go Lives` | POSSIBLY_LEGACY | Hidden DNU; **still referenced by formulas** (`RecentGL_TBL` sample refs in all six) |
| `DNU_ActiveDeployments` | POSSIBLY_LEGACY | Hidden DNU; **Dashboard / FutureGL_TBL** formula refs in five apps |
| `DNU_ChangeLog`, `DNU_DeploymentHealth_Snapshot`, `DNU_PerfCache`, `DNU_*` misc | HIGH_CONFIDENCE_UNUSED to POSSIBLY_LEGACY | Hidden; no config keys; delete only after formula audit |
| `ActiveDeployments` (HC only) | POSSIBLY_LEGACY | Config key exists; UI path uses SFDC |
| `StudentDeploymentData` | ACTIVE_APP_SPECIFIC | HENP only; `student.*` config |
| `AI_Deployments`, `AI_ProductFunction` | ACTIVE_APP_SPECIFIC | HS/PDX workbooks (ProductMode siblings) |
| `Escalation_Configuration`, `Current Escalation State`, `Escalation Update History`, `Channel Registry`, `Processing Log` | ACTIVE_APP_SPECIFIC | PDX/SLG/HS escalations feature slice |
| `OverrideAudit` | UNKNOWN_RUNTIME_DEPENDENCY | Present SLG/EVI/PDX/HS; absent HC/HENP — CoreData may still write audit elsewhere |
| `HealthYtdSummary` / `DNU_HealthYtdSummary` | UNKNOWN_RUNTIME_DEPENDENCY | Split naming; report paths may still read via config default |
| `Contact1`/`Contact2`/`Contacts*` | POSSIBLY_LEGACY | EVI-only fragments; likely superseded by `SFDC_DeploymentContacts` |
| `DD` vs `DD Assignment` | ACTIVE_SHARED | Same role; tab title drift HC/HENP vs others |

## Config keys (`APP_CONFIG`)

| Key / block | Classification | Notes |
|-------------|----------------|-------|
| `sheets.deployments`, `sfdcDeploymentProductFunctions`, … | ACTIVE_SHARED | Must match live SFDC tab names |
| `sheets.activeDeployments`, `sheets.goLives` | POSSIBLY_LEGACY | Tabs largely removed; keys retained |
| `sheets.changeLog`, `healthMonthlySummary` | POSSIBLY_LEGACY | Point at non-existent visible tabs |
| `columns.goLives` | CLEANED (configs) / DEFERRED (`CoreConfig` default) | Removed from all `Config_*.js` (2026-10-03); library default block remains until Notable WIP lands |
| `columns.*` (flat deployment map) | POSSIBLY_LEGACY | Fallback for header resolver only |
| `activeDeployments.productMode*` | ACTIVE_APP_SPECIFIC | HS, PDX, EVI (ProductMode family) |
| `activeDeployments` (industry / status filters) | ACTIVE_APP_SPECIFIC | SLG, HC, HENP IndustryMode |
| `student.*` | ACTIVE_APP_SPECIFIC | HENP |
| `ui.tabs.*`, `ui.roleVisibility` | ACTIVE_SHARED | Rendered via CoreUI_Markup |
| `notable.*` | ACTIVE_SHARED | Peer sheet integration (where enabled) |
| `escalations.*` / UI tab | ACTIVE_APP_SPECIFIC | PDX (and markup support for SLG/HS) |
| `report.*`, `notify.*`, `trends.*`, `momentum.*` | ACTIVE_SHARED | Module-specific defaults differ by app |

## `google.script.run` server functions

See [google-script-run-contracts.md](./google-script-run-contracts.md). All curated UI methods have wrappers on **at least one** app; production parity requires each app to implement the subset for **enabled tabs** (e.g. skip `getStudentTabData` when `student.enabled` is false).

## DepMngr symbols (library)

| Area | Classification | Notes |
|------|----------------|-------|
| `CoreData.getAllDeployments`, `getOverviewSnapshot`, notify/report entry points | ACTIVE_SHARED | Called from all shells |
| `CoreData.buildStudentTabData_` | ACTIVE_APP_SPECIFIC | HENP WebAppCode only |
| `CoreEscalations.*` | ACTIVE_APP_SPECIFIC | PDX path |
| `CoreData._debugProductMode*` | ACTIVE_APP_SPECIFIC | EVI/PDX/HS debug menus |
| `CoreData._validateEffectiveDeployments` | ACTIVE_APP_SPECIFIC | HC/HENP menu diagnostics |
| `CoreUI_Markup_buildGoLivesTabLegacy_` | POSSIBLY_LEGACY | Gated by `ui.goLivesTab.mode` |
| `CoreUI_Markup_buildTrendsTabLegacy_` | POSSIBLY_LEGACY | Superseded by `getTrendsDashboardData` when enabled |
| `_test_phase3a` (CoreSalesforce) | HIGH_CONFIDENCE_UNUSED | Test harness |

Full CoreLib call → app mapping: [depmngr-consumer-usage.json](./depmngr-consumer-usage.json).

# Workbook consistency matrix (six DM apps)

Source: sanitized `*_DM.structure.json` derived from `docs/migrations/live/*.xlsx` (no cell values).  
Classifications: `ACTIVE_SHARED` | `ACTIVE_APP_SPECIFIC` | `POSSIBLY_LEGACY` | `HIGH_CONFIDENCE_UNUSED` | `UNKNOWN_RUNTIME_DEPENDENCY`

## Summary

| Metric | Value |
|--------|------|
| Distinct sheet names (union) | 53 |
| Sheets in **all 6** apps | 23 |
| Named ranges (each app) | 4 (`HealthTotal`, `ApproachTotal`, `RedYellow`, `PartnerTotal`) |
| Apps by sheet count | HC/HENP 29; EVI/HS 36; SLG 37; PDX 41 |

### Sheets in all six workbooks (`ACTIVE_SHARED` spine)

`AppUsers`, `Auto Refresh Execution Log`, `CSAT_InFlight`, `Dashboard`, `DeploymentOverrides`, `DeploymentsMeta`, `ExecSummary`, `FutureGL_TBL`, `GoLivesOverrides`, `HealthReportSnapshots`, `NotificationConfig`, `RecentGL_TBL`, `RedYellow_TBL`, `ReportDistributionLog`, `SFDC_DHP`, `SFDC_DeploymentContacts`, `SFDC_DeploymentHistory`, `SFDC_DeploymentProductFunctions`, `SFDC_Deployments`, `SFDC_Wellness`, plus DNU archives `DNU_ChangeLog`, `DNU_DeploymentHealth_Snapshot`, `DNU_Go Lives`.

> **Note:** `DNU_Go Lives` / `DNU_ActiveDeployments` are hidden and labeled DNU, but formula samples still reference them from report tables — see [classification-inventory.md](./classification-inventory.md).

## Presence matrix (abbreviated)

Legend: ● = visible or hidden tab present; — = absent.

| Sheet | SLG | HC | HENP | EVI | PDX | HS | Class |
|-------|:---:|:--:|:----:|:---:|:---:|:---:|-------|
| SFDC_Deployments | ● | ● | ● | ● | ● | ● | ACTIVE_SHARED |
| SFDC_DeploymentProductFunctions | ● | ● | ● | ● | ● | ● | ACTIVE_SHARED |
| DeploymentOverrides | ● | ● | ● | ● | ● | ● | ACTIVE_SHARED |
| Dashboard / *_TBL report tables | ● | ● | ● | ● | ● | ● | ACTIVE_SHARED |
| DNU_Go Lives | ● | ● | ● | ● | ● | ● | POSSIBLY_LEGACY (formula-linked) |
| DNU_ActiveDeployments | ● | — | ● | ● | ● | ● | POSSIBLY_LEGACY (formula-linked) |
| ActiveDeployments (legacy) | — | ● | — | — | — | — | POSSIBLY_LEGACY |
| StudentDeploymentData | — | — | ● | — | — | — | ACTIVE_APP_SPECIFIC |
| AI_Deployments / AI_ProductFunction | — | — | — | — | ● | ● | ACTIVE_APP_SPECIFIC |
| Escalation_* / Channel Registry | ● | — | — | — | ● | ● | ACTIVE_APP_SPECIFIC |
| OverrideAudit | ● | — | — | ● | ● | ● | UNKNOWN_RUNTIME_DEPENDENCY |
| HealthYtdSummary (non-DNU) | ● | ● | — | ● | ● | ● | UNKNOWN_RUNTIME_DEPENDENCY |
| DD vs DD Assignment | DD Assign | DD | DD | DD Assign | DD Assign | DD Assign | ACTIVE_SHARED (name drift) |

Full per-sheet presence, header-drift flags, and formula sample targets: **[workbook-consistency-matrix.json](./workbook-consistency-matrix.json)**.

## Named ranges (identical across six)

| Name | Ref (structure metadata) | Consumers |
|------|--------------------------|-----------|
| `HealthTotal` | `Dashboard!$A$2:$L$5` | CoreReport legacy bar tables via `namedRanges.healthTotal` |
| `ApproachTotal` | `Dashboard!$A$8:$D$13` | Legacy dashboard / analytics |
| `RedYellow` | `RedYellow_TBL!$A$2:$G$…` | Report + dashboard rollups |
| `PartnerTotal` | `Dashboard!$A$16:$E$47` | Legacy dashboard |

## Config `sheets.*` vs live tab names

| Config key | Issue |
|------------|--------|
| `activeDeployments`, `goLives` | Point at tabs **missing** from 5/6 workbooks (legacy; HC still has `ActiveDeployments` tab only) |
| `changeLog` | `ChangeLog` tab absent; `DNU_ChangeLog` present everywhere |
| `healthMonthlySummary` | Tab absent; `DNU_HealthMonthlySummary` or `HealthMonthlySummary` varies |
| `ddAssignment` | Matches `DD` or `DD Assignment` per app — **only intentional six-way drift** in `configSheetKeyDrift` |

Mapped in [depmngr-consumer-usage.json](./depmngr-consumer-usage.json) → `configSheetsByApp`, `configSheetKeyDrift`.

## Header drift (same sheet name, different row-1 headers)

Flagged in JSON for: `CSAT_InFlight`, `GoLivesOverrides`, `ReportDistributionLog`, `SFDC_DeploymentContacts`, `SFDC_DeploymentHistory`, `SFDC_DeploymentProductFunctions`, `SFDC_Deployments`, `SFDC_Wellness`, and some DNU sheets.  
DepMngr uses **header-first resolvers** for SFDC tabs; drift is often benign if required logical columns still resolve. Treat as **UNKNOWN_RUNTIME_DEPENDENCY** until validated with `_debugSfdcColumns` / freshness UI per app.

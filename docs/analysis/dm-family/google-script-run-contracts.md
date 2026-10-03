# `google.script.run` contracts (DM UI)

**Client source:** `libraries/DepMngr/src/CoreUI_Js.js` (inlined into each `WebApp.html`).  
**Server source:** `solutions/<APP>_DM/src/WebAppCode.js` → `CoreLib.*(APP_CONFIG, …)`.

Curated UI methods: [google-script-run-contracts.json](./google-script-run-contracts.json) → `clientMethodsInCoreUI_Js`.  
All curated methods are implemented on at least one consumer (`clientNotInAnyWebAppCode` is empty).

## Bootstrap (every page load)

| Method | CoreLib / sheet source | Response shape (summary) |
|--------|------------------------|---------------------------|
| `getIdentityBoot` | `CoreUsers.getCurrentUser`, `getActiveUsers`, `getCurrentUserAccess` | `{ user, activeUsers, access }` — `access.role`, `canViewApp`, email |
| `getDataFreshnessForUI` | `CoreFreshnessMonitor` + SFDC refresh metadata | `{ status, ageHours, lastRefresh, … }` for badge |

## Deployments / portfolio

| Method | Data source | Response shape (summary) |
|--------|-------------|---------------------------|
| `getAllDeploymentsForUI` | SFDC deployments + PF union + overrides + meta + DD map | `{ rows: [...], kpis?: {...} }` — rows are UI display grain (filters client-side) |
| `getPortfolioHealthData` | `CorePortfolioHealth.getSnapshot` | Snapshot object for portfolio health tab/cards |
| `getPortfolioMomentumData` | `CorePortfolioMomentum.getMomentumSnapshot` | Chart series + metadata |
| `createPortfolioHealthSlides` | Slides API + snapshot | URL or status object (EVI/PDX/HS) |

Workbook: `SFDC_Deployments`, `SFDC_DeploymentProductFunctions`, `DeploymentOverrides`, `DeploymentsMeta`, `SFDC_DeploymentContacts`, `AppUsers` / DD sheet.

## Go Lives

| Method | Data source | Response shape |
|--------|-------------|----------------|
| `getRecentGoLivesData` | ProductMode/Industry go-live events | Array of go-live row DTOs |
| `getUpcomingGoLivesData` | Same pipeline, forward window | Array |
| `getGoLivesExplorerDataForUI` / `getGoLivesExplorerData` | Explorer aggregation | `{ groups, filters, … }` per explorer state |
| `getGoLivesForNotablePicker` | Recent + upcoming picker merge | Array for notable add modal |

Legacy workbook tables `RecentGL_TBL` / `FutureGL_TBL` still formula-tied to DNU sheets; **UI path does not call those tabs directly**.

## Overview

| Method | Data source | Response shape |
|--------|-------------|----------------|
| `getOverviewData` | `CoreData.getOverviewSnapshot` | KPI blocks, lists (at-risk, upcoming GL, etc.) |

## Overrides / audit

| Method | Data source |
|--------|-------------|
| `getAllActiveOverridesForUI` | Override maps + deployment join |
| `getOverrideAuditLogForUI` | `OverrideAudit` sheet (where present) |
| `getDeploymentAuditSummaryForUI` | Per-deployment audit trail |
| `updateDeploymentWithMetaAndOverride` | Writes meta + override sheets |
| `updateGoLivesOverride` | `GoLivesOverrides` |
| `setOverrideClassificationForUI`, `clearSingleOverrideForUI`, `bulkClear*` | Override sheets |

## Executive summary / reporting

| Method | Data source |
|--------|-------------|
| `getExecutiveSummaryHtml` / `saveExecutiveSummaryHtml` | `ExecSummary` sheet |
| `getGmailReportPreview` | `CoreReport` + analytics |
| `getReportSendConfigForUI` | `report.distribution` + notify config |
| `sendMonthlyReportFromUI` / `sendMonthlyReportTestFromUI` | `CoreDistribute` |
| `getReportSendLogForUI` | `ReportDistributionLog` |

Named ranges on `Dashboard` / `RedYellow_TBL` feed **legacy** report HTML, not these JSON endpoints directly.

## CSAT / MGM-PGL

| Method | Data source |
|--------|-------------|
| `getCsatTabDataForUI` | CSAT in-flight sheet + go-live batch logic |
| `uploadCsatInFlightCsvForUI` | Writes `CSAT_InFlight` |

## Notifications (Reporting tab)

| Method | Data source |
|--------|-------------|
| `upsertNotificationRuleForUI` | `NotificationConfig` |
| `sendTestNotificationForUI` | `CoreNotify` |
| `getDistributionLogDataForUI` | `ReportDistributionLog` |

## Notable deployments

| Method | Data source |
|--------|-------------|
| `getNotableData` | `CoreNotable` + peer sheet config |
| `addNotable` / `updateNotable` | Notable peer sheet API |

## Trends

| Method | Notes |
|--------|-------|
| `getTrendsDashboardData` | Primary v1 dashboard (single call) |
| `getTrendsTimeInRedData`, `getTrendsHealthTrajectoryData`, `getTrendsHealthByPartnerData`, `getTrendsHealthByDeliveryDirectorData`, `getTrendsTimeInStageData`, `getTrendsTimeToGoLiveData`, `getTrendsGoLiveOutcomeData` | Legacy per-chart loaders via `callTrends(name, …)` |

Workbook: `SFDC_DeploymentHistory`, analytics snapshots on `HealthReportSnapshots` / dashboard pipeline.

## HENP student

| Method | Data source |
|--------|-------------|
| `getStudentTabData` | `StudentDeploymentData` + `buildStudentTabData_` |
| `saveStudentDeploymentFields` | Student sheet writes |

## PDX escalations

| Method | Data source |
|--------|-------------|
| `getEscalationsDashboardData` | `Escalation_*` sheets + `CoreEscalations` |

## Preview mock priority (minimum interactive shell)

Phase 1 mocks (unlock layout): `getIdentityBoot`, `getDataFreshnessForUI`, `getAllDeploymentsForUI`, `getOverviewData`.  
Phase 2: go-lives trio + overrides read.  
Phase 3: trends dashboard, CSAT, notable, reporting modals.

Detail: [preview-data-plan.md](./preview-data-plan.md).

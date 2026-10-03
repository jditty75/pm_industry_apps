# Canonical sanitized DM preview fixture

**Goal:** One **fake** workbook + JSON mock payloads that exercise the **real** DepMngr UI (all major tabs) without cloning a production workbook or embedding customer data.

**Not stored in Git:** Full XLSX fixture should live under `.preview-fixtures/` (gitignored) or pure JSON mocks in `skills/gas-monorepo-engineer/scripts/fixtures/dm/` (sanitized only).

## Design principles

1. **Union of ACTIVE_SHARED spine** (23 sheets present in all six live workbooks) plus **optional modules** toggled by preview profile:
   - `+student` → `StudentDeploymentData` (HENP profile)
   - `+escalations` → escalation sheets (PDX profile)
   - `+productMode` → use ProductMode-style `APP_CONFIG` from `Config_HS.js` or `Config_PDX.js` (not Industry `Config_SLG.js`)
2. **Omit** DNU formula feeders initially — preview UI does not read `DNU_Go Lives` / `DNU_ActiveDeployments`; legacy report preview is out of scope for v1 interactive mock.
3. **Row counts:** 35–50 deployment parents (ProductMode) or 25–40 industry deployments; 8–12 go-live events; 5 CSAT rows; 3 notification rules; 2 distribution log entries.
4. **Stable fake identifiers:** Prefix all IDs with `PREVIEW_` (deployment ids, account names like `Preview Account Alpha`).

## Canonical sheet set (v1 — SLG/HC/HENP Industry preview)

| Sheet | Columns (minimal) | Purpose |
|-------|-------------------|---------|
| `SFDC_Deployments` | Standard connector header subset: Id, Name, Account, Status, Health, Phase, dates, owners | `getAllDeploymentsForUI` |
| `SFDC_DeploymentProductFunctions` | Id, Deployment__c, Product_Area__c, Function__c, production dates | ProductMode apps only |
| `SFDC_DeploymentContacts` | Deployment, contact, role | DD / EM resolution |
| `SFDC_DeploymentHistory` | Deployment, health, stage, timestamps | Trends |
| `SFDC_Wellness` | Deployment, wellness fields | Executive watch |
| `SFDC_DHP` | DHP plan fields | DHP modal |
| `DeploymentOverrides` | deployment id, override columns | Overrides tab |
| `GoLivesOverrides` | account, override fields | Go-live overrides |
| `DeploymentsMeta` | deployment id, notes/meta | Meta modal |
| `AppUsers` | email, role, display name | `getIdentityBoot` |
| `DD Assignment` or `DD` | DD mapping | View-as-DD mode |
| `CSAT_InFlight` | standard CSAT headers (see structure JSON) | CSAT tab |
| `NotificationConfig` | rule rows | Reporting notifications UI |
| `ReportDistributionLog` | log headers | Send log panel |
| `ExecSummary` | single cell / HTML blob | Exec summary tab |
| `Dashboard`, `RedYellow_TBL`, `RecentGL_TBL`, `FutureGL_TBL`, `HealthReportSnapshots` | **Empty or 1-row stub** | Optional report HTML preview only |

## Scenario packs (same fixture, different mock responses)

| Scenario | Deployments | Go-lives | Notes |
|----------|-------------|----------|-------|
| `mixed-health` | 60% green, 25% yellow, 15% red | 4 recent, 4 upcoming | Default |
| `at-risk` | 40% red/yellow | 2 overdue upcoming | Stress KPI styling |
| `empty` | `rows: []` | `[]` | Empty states, zero KPIs |
| `go-live-window` | unchanged | 6 in next 30d, 3 last 14d | Calendar clusters |
| `edge-values` | null dates, blank EM, long account names, duplicate phases | missing partner | Responsive table + ellipsis |
| `volume` | 50 rows | 20 events | Filter / scroll performance |

Implement scenarios as **preview profile query** (`?scenario=at-risk`) switching mock JSON, not mutating XLSX.

## `APP_CONFIG` for preview

- **Default engine profile:** `SLG_DM` with `Config_SLG.js` evaluated in Node (`preview_engine.py` / `gas_bundle_extract.mjs`).
- **Family reuse:** Parameterize `configScript` in `config/ui-preview.json` (already per app); share one mock dataset keyed by `appId` with ProductMode filter applied client-side to simulate HS vs PDX.

## Identity boot fixture

```json
{
  "user": { "email": "preview.user@workday.com", "displayName": "Preview User", "role": "ADMIN" },
  "activeUsers": [
    { "email": "preview.dd@workday.com", "displayName": "Preview DD", "role": "DD" }
  ],
  "access": { "role": "ADMIN", "canViewApp": true, "email": "preview.user@workday.com" }
}
```

## Deployment row fixture (minimal DTO fields)

Include fields referenced by `ui.deploymentsTable.columns` defaults: `deploymentId`, `accountName`, `deploymentName`, `health`, `phase`, `wdEngManager`, `deliveryDirector`, `partnerName`, `goLiveDate`, `productArea`, flags for meta/override indicators.

## Mapping mocks → workbook

| Mock handler | Would read (in GAS) |
|--------------|---------------------|
| `getAllDeploymentsForUI` | SFDC + overrides + meta + users |
| `getOverviewData` | Derived from same effective set |
| `getRecentGoLivesData` / `getUpcomingGoLivesData` | PF/go-live pipeline |
| `getPortfolioHealthData` | Aggregated health buckets |
| `getTrendsDashboardData` | History sheet + in-memory metrics |

Preview **v1** can skip physical XLSX entirely and serve JSON from `preview_engine.py` handlers once added.

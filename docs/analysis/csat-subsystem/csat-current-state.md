# Current CSAT Implementation — Traced Inventory (as of 2026-10-05)

Paths: `LIB` = `libraries/DepMngr/src`, `SOL` = `solutions`. Snapshot pins: EDM→CoreLib 145; HC/SLG/HENP→144; EVI/PDX/HS→139. Classification: **K**eep, **R**efactor-later, **L**egacy-compatibility, **X** retire-eventually.

## Data flow
Qualtrics InFlight CSV → EDM (`External Data/Qualtrics/Inbox`, ~15-min trigger) → `EdmIngestAdapter.ingestNormalizedRows` → `CoreLib.CoreData.ingestCsatInFlight(cfg, rows, {source,jobId,backupCsvText}, {spreadsheetId})` → `CSAT_InFlight` (16 columns, **full replace**, safe-replace with rollback) → `getCsatTabDataForUI` → CSAT tab. Manual fallback: Upload sub-tab → `uploadCsatInFlightCsvForUI` → same ingest with `rowFormat:'parsed_csv'`.

## Components
| Component | Where | Class |
|---|---|---|
| `CSAT_INFLIGHT_COLUMNS` (deployment_id, account_name, deployment_name, survey_type, tracking_status, response_received, contact_name/email/role, engagement_manager, partner_name, sent/opened/started/finished dates, survey_expires); mapping/filter/matrix/header-verify/trailing-clear helpers | `LIB/CoreCsatIngest.js` (pure, Node-testable) | K |
| `ingestCsatInFlight`, `_replaceCsatInFlightSafely_`, `_backupCsatImport_` (Drive `DHM_CSAT_Imports`), `_setCsatLastImportAt_` (Script Property `CSAT_LAST_IMPORT:<app>`) | `LIB/CoreData.js` ~11613–11957 | K |
| `_csatAllowedDeploymentIds_` — Active-only for `HC`/`HC_DM`, all effective deployments otherwise (hard-coded app check) | CoreData ~11696 | R (config-drive) — **wrong universe for historical responses** |
| `getCsatTabDataForUI` (full-sheet read of CSAT_InFlight + deployment master; KPIs: total sent, open rate, completion rate, bounced, coverage % vs SFDC master; header summary of upcoming batches / notification status) | CoreData ~12142 | K |
| MDS/PGL batch engine `getMdsPglBatchView` (+ `CoreSurveySchedule`): MDS ≈ ⅓ of duration after start, PGL = go-live + 2 months, go-live clustering, exceptions | CoreData ~10068–11258, `LIB/CoreSurveySchedule.js` | K (name: R) |
| Survey notification rules + `ReportDistributionLog` (`getDistributionLogDataForUI`), `CoreNotify` | CoreData ~12098, CoreNotify | K |
| `uploadCsatInFlightCsvForUI` — no server-side `requirePowerUser_` (tab hidden only for READ_ONLY) | CoreData ~11957 | R (add guard) |
| Tab markup: sub-tabs Batches / In-Flight / Notifications / Upload; `mgmpgl-*` DOM ids | `LIB/CoreUI_Markup.js` ~803–1010 | K / ids R |
| Client: `loadCsatTab`, `switchCsatSubTab`, KPI + table render, client-side CSV export, `setMgmPglFilterType('MGM'…)`; `loadMgmPglTab` alias | `LIB/CoreUI_Js.js` ~8438–9085 | K / names L |
| Config: tab id `mgmPgl` auto-migrated to `csat`; `ui.csatTab` aliased to `ui.mgmPglTab`; `mgmPglTab.goLiveEventClusterDays`; dead `defaultHorizon/horizonOptions`; dual `csat`+`mgmPgl` in `roleVisibility` | `LIB/CoreConfig.js` ~1015–1157, 1348 | L (alias), X (dead keys) |
| Survey-type token `MGM`→`MDS` mapping; cache keys `mdsPglBatchView:<app>:<horizon>`; `getMdsPglBatchViewForUI`, `debugMdsPglRowsForUI` | CoreData / consumer wrappers | L |
| Consumer wrappers `getCsatTabDataForUI`, `uploadCsatInFlightCsvForUI`, notification endpoints (boilerplate ×6) | `SOL/{HC,SLG,HENP,HS,PDX,EVI}_DM/WebAppCode.js` | K / dedupe R |
| `_normalizeCsatInFlightRowForUI_` (reads old column names; appears uncalled) and the "legacy upcoming surveys" section marker | CoreData ~11771, ~12242 | X (verify) |
| Tests: only `libraries/DepMngr/test/csat-ingest.test.js` (4 tests on CoreCsatIngest) | – | R (no tests for KPIs, batch view, parse, markup) |
| Preview: `preview.ps1 <APP> [-Scenario …]`; fixture design: 5 CSAT rows + 3 rules + 2 log entries; `getCsatTabDataForUI` listed but not interactively mocked | `config/ui-preview.json`, `docs/analysis/dm-family/preview-fixture-design.md` | K / extend |

## Per-app state
HC_DM, HENP_DM, SLG_DM: CSAT tab enabled (tab id still `mgmPgl`; SLG label migrated). EVI/PDX/HS: `mgmPglTab.enabled:false`, tab absent, wrappers and `CSAT_InFlight` sheet still present. `docs/specs/dhm-config-inventory.md` §2.12 and `henp-student-reintegration.md` claim HENP has CSAT disabled — **stale**.

## Access / sensitivity (today)
Roles from `AppUsers` (PM→ADMIN; DD, VP→POWER_USER; unlisted→READ_ONLY). CSAT hidden from READ_ONLY by `roleVisibility` (markup). `?viewAs=READ_ONLY` available to ADMIN/POWER_USER. `requirePowerUser_` guards some write endpoints. The only "restricted data" mechanism is Notable's `restrictedHideEnabled` (region-restricted notable items) — nothing CSAT-specific. Contact name/email/role already flow to POWER_USER/ADMIN through the in-flight table and a client-side CSV export. In-flight rows are (to be verified) not filtered by personalization view mode. All sheet reads are full-sheet `getValues()` with no cap; the batch view has a 6-hour CacheService tier that is effectively per-execution when called through the library.

## Consequences for Responses
- Add alongside, never inside, `CSAT_InFlight`; keep `ingestCsatInFlight` untouched.
- Do not inherit the Active-only HC universe or the replace semantics.
- Every new endpoint needs a server-side role + feature-gate check (do not rely on hidden markup).
- New feature gates should follow the existing `ui.<feature>.enabled` + `roleVisibility` convention and treat `ui.mgmPglTab` as the master CSAT switch.

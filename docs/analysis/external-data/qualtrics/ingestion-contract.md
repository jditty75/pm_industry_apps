# Ingestion contract — SLG_DM & HENP_DM

## UI → client → server

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Markup | `libraries/DepMngr/src/CoreUI_Markup.js` | CSAT tab, dropzone, `survey_normalized_*.csv` hint |
| Client JS | `libraries/DepMngr/src/CoreUI_Js.js` | `initCsatDropzone_`, `FileReader.readAsText`, `google.script.run.uploadCsatInFlightCsvForUI` |
| Container wrapper | `solutions/SLG_DM/src/WebAppCode.js`, `solutions/HENP_DM/src/WebAppCode.js` | `CoreLib.CoreConfig.withDefaults(APP_CONFIG)` → `CoreLib.CoreData.uploadCsatInFlightCsvForUI(cfg, csvText)` |
| Canonical ingest | `libraries/DepMngr/src/CoreData.js` | `uploadCsatInFlightCsvForUI`, `_parseCsatInFlightCsv_`, tenant filter, sheet write, backup, cache clear |

`viewModeOpts` is passed from the client but **not used** inside `uploadCsatInFlightCsvForUI` (only in `getCsatTabDataForUI`).

## Payload shape

- Browser sends **UTF-8 CSV text** (entire file as string).
- GAS does **not** receive bytes/base64 from this UI path.
- Server parses with `Utilities.parseCsv`.

## Expected transformed input

- File type: `.csv` only (client rejects non-csv).
- Headers: normalized snake_case; parser lowercases and replaces spaces with `_`.
- Ingest mapping uses fields such as: `deployment_id`, `account_name`, `deployment_name`, `survey_type`, `tracking_status`, `response_received`, `contact_email`, `contact_role`, `engagement_manager`, `partner_name`, `ts_email_sent`, `ts_email_opened`, `ts_survey_started`, `ts_survey_finished`, `survey_expires`, plus name fields (`full_name` or `first_name`/`last_name`).

## Validation

| Stage | What |
|-------|------|
| Client | Extension `.csv` |
| Parse | Skip blank rows; require some non-empty cells; canonicalize `deployment_id` |
| Tenant | Row kept only if `deployment_id` ∈ deployments allowed for this workbook (`getAllEffectiveDeployments` or HC-specific path — see note below) |
| Schema | No strict column guard in GAS; missing fields become empty/`—` |

**Config note:** `_csatAllowedDeploymentIds_` checks `cfg.appId === 'HC_DM'`, but `Config_HC.js` uses `appId: 'HC'`. SLG/HENP use `appId: 'SLG'` / `'HENP'`. HC branch may be dead code until aligned.

## Workbook mutation strategy

- **Replace:** `_writeCsatInFlightSheet_` resets headers to `_CSAT_INFLIGHT_COLUMNS_`, clears row 2+, writes matched rows.
- **Not append/merge/upsert** at row level; full replace of in-flight table per upload.
- **Not atomic:** clear then write; failure between steps could leave empty sheet.
- **Backup:** Raw uploaded CSV to Drive folder `DHM_CSAT_Imports` as `CSAT_Import_<appId>_<yyyy-MM-dd>.csv` (same-day re-upload overwrites backup filename).
- **Audit timestamp:** `PropertiesService` key `CSAT_LAST_IMPORT:<appId>` ISO string.
- **Cache:** `_clearCache(cfg)` — full tier-1 + tier-2 perf cache invalidation for the app.

## Destination sheet: `CSAT_InFlight`

Storage schema (16 columns):

`deployment_id`, `account_name`, `deployment_name`, `survey_type`, `tracking_status`, `response_received`, `contact_name`, `contact_email`, `contact_role`, `engagement_manager`, `partner_name`, `sent_date`, `opened_date`, `started_date`, `finished_date`, `survey_expires`

Structural analysis:

- `SLG_DM.structure.json` — headers match storage schema.
- `HENP_DM.structure.json` — sheet metadata shows **37-column** normalized headers (workbook drift vs current writer). Re-ingest via UI should rewrite to 16-column schema.

## Downstream dependencies

- **CSAT tab UI** — `getCsatTabDataForUI` reads `CSAT_InFlight`, computes KPIs/coverage vs deployment master, merges with `getMdsPglBatchView` (upcoming MDS/PGL batches from SFDC-derived logic, not Qualtrics sheet).
- **Formulas** — structure JSON reports **zero** formula cells on `CSAT_InFlight` for SLG; no formula inbound edges. Replacement does not break formula chains on that sheet.
- **Reports** — no direct `google-script-run` path from Qualtrics sheet to monthly report HTML; CSAT is tab-scoped plus notification features.
- **Notifications** — CSAT tab uses `CoreNotify` validation/rules; sending notifications is separate from ingest.

## Success / error contract (UI)

```javascript
// success object (always success: true if no throw)
{
  success: true,
  imported: number,      // matched rows written
  discarded: number,     // parsed - matched
  totalInput: number,
  count: number,         // same as imported
  message: string
}
```

- Zero matches: `success: true` with warning toast in UI.
- Parse/permission errors: `google.script.run` failure handler.

## SLG vs HENP: shared vs duplicated

| Area | Shared? |
|------|---------|
| Ingest implementation | **Identical** DepMngr `uploadCsatInFlightCsvForUI` |
| Container wrapper | **Duplicated** thin one-liners in each `WebAppCode.js` |
| Tenant filter | **Shared** logic; different deployment universes per workbook |
| Destination schema | **Same** 16-column contract when writer runs |
| UI / library | **Shared** CoreUI |

## Canonical ingestion boundary (recommended)

**Today:** `CoreData.uploadCsatInFlightCsvForUI(config, csvText)` — mixes parse, filter, map, backup, sheet I/O, cache.

**Target decomposition:**

1. `parseSurveyNormalizedCsv(csvText)` — pure parse
2. `transformQualtricsExport(rawRows)` — future; mirrors Python when automation added
3. `ingestCsatInFlight(config, parsedRows, metadata)` — tenant filter, map to storage schema, write, audit (callable from UI and Drive job)
4. `acquireSpreadsheet(config)` — **required for automation**; today hard-coded `SpreadsheetApp.getActiveSpreadsheet()` blocks a central orchestrator unless each job runs in bound context or code accepts `Spreadsheet` / id parameter.

## Mixed concerns blocking shared UI + automation entry

| Concern | Today |
|---------|--------|
| File acquisition | UI only (FileReader) |
| Transform | External Python |
| Parse | Inside ingest function |
| Tenant filter | Inside ingest |
| Workbook I/O | Active spreadsheet only |
| Verification | Implicit (row counts in return); no post-write checksum |
| UI behavior | Client toast + tab reload |

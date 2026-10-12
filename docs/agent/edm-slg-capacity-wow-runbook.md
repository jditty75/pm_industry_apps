# EDM → SLG Capacity Planner — WoW four-file runbook

**Status: DEVELOPMENT COMPLETE** (GAS runtime validated 2026-10-12). Orchestration: `solutions/External_Data_Manager`. Ingest: container-bound `solutions/SLG_Capacity`.

Pipeline id: `slg_capacity_wow_v4`. Transformer: `slg-capacity-wow-v4`.

## End-to-end flow

```text
Workday four CSV exports
  → Drive SLG Capacity Inbox (complete batch only)
  → EDM processSlgCapacityInboxNow / runQualtricsInboxScheduled (capacity leg)
  → transform + audit ledger (pipeline-scoped checksum / duplicate guard)
  → consolidated Google Sheet in Handoff folder
  → SLG_Capacity processEdmCapacityHandoffNow (scheduled or manual)
  → planner workbook ingest (same preflight/write path as manual .xlsx upload)
  → handoff file trashed after success
```

**Manual fallback (unchanged):** Admin consolidated `.xlsx` upload via `api_uploadConsolidatedWorkbook` → `uploadConsolidatedWorkbook`. EDM handoff uses `ingestConsolidatedWorkbookFromSpreadsheetId` (same preflight and `writeConsolidatedWorkbook_`).

## Source batch (Inbox)

All four files must be present in **SLG Capacity → Inbox** (folder id in `SLG_CAPACITY_INBOX_FOLDER_ID`). Canonical names:

| Slot | Typical filename |
|------|------------------|
| forecast | `Forecast.csv` |
| actualsPrevCurrent | `WoW_Export_SLG_Actuals_PrevQ_Current.csv` |
| actualsHistorical | `WoW_Export_SLG_Actuals_Historical.csv` |
| utilization | `SLG Utilization Export_Quarter.csv` |

Ambiguous duplicates (e.g. two `Forecast*.csv`) fail batch resolution safely.

## Script properties

### EDM (`External_Data_Manager`)

| Property | Purpose |
|----------|---------|
| `SLG_CAPACITY_INBOX_FOLDER_ID` | Four-file drop folder |
| `SLG_CAPACITY_FAILED_FOLDER_ID` | Failed sources (when move succeeds) |
| `SLG_CAPACITY_ARCHIVE_FOLDER_ID` | Successful sources (default; see delete flag) |
| `SLG_CAPACITY_HANDOFF_FOLDER_ID` | Consolidated spreadsheet output for planner pickup |
| `EDM_SLG_CAPACITY_INGEST_ENABLED` | Must be `true` for non–dry-run transform + handoff write |
| `EDM_DELETE_SUCCESSFUL_SLG_CAPACITY_SOURCE` | When `true` **and** run requests delete, remove Inbox files instead of archive |

Shares the Qualtrics audit ledger (`EDM_AUDIT_LEDGER_SPREADSHEET_ID`). Duplicate guard is **pipeline-scoped** (`slg_capacity_wow_v4`); Qualtrics jobs do not block Capacity checksums.

### SLG Capacity Planner (container-bound)

| Property | Purpose |
|----------|---------|
| `SLG_CAPACITY_HANDOFF_INBOX_FOLDER_ID` | Folder to poll for handoff spreadsheets (same Drive folder as EDM `SLG_CAPACITY_HANDOFF_FOLDER_ID`) |
| `EDM_SLG_CAPACITY_HANDOFF_FOLDER_ID` | Optional alias read by `processEdmCapacityHandoffNow` |

## Scheduling (smallest configuration)

### Stage 1 — EDM four-file Inbox

**No additional EDM trigger.** Capacity runs as the third isolated leg of the existing production schedule:

- Handler: `runQualtricsInboxScheduled` (~15 minutes via `runEdmInstallQualtricsInboxScheduleTrigger`)
- Order: Qualtrics InFlight → Qualtrics Responses → SLG Capacity (`EdmQualtricsScheduledRunner`, each leg in its own try/catch)
- Capacity entry: `processSlgCapacityInboxNow({ dryRun: false, ingestEnabled: true, … })` only when `EDM_SLG_CAPACITY_INGEST_ENABLED=true`

Lock: `EDM_SLG_CAPACITY_INGEST` (separate from Qualtrics ingest lock).

Manual equivalent (EDM editor): `processSlgCapacityInboxNow({ dryRun: false, ingestEnabled: true, deleteSuccessfulSource: false })` (adjust delete flag as needed).

### Stage 2 — Planner handoff pickup

**One container-bound time-driven trigger** on the **SLG_Capacity** project (not EDM):

- Function: `processEdmCapacityHandoffNow`
- Cadence: **every 15 minutes** (align with EDM so handoff usually appears within one EDM cycle)

There is no idempotent installer in-repo yet (unlike `setupCapacityAdjustmentAuditTrigger`). Install once from the planner Apps Script editor:

1. Triggers → Add trigger → `processEdmCapacityHandoffNow` → Time-driven → Minutes timer → **Every 15 minutes**.
2. Confirm only one handoff processor trigger exists.

Manual equivalent: `processEdmCapacityHandoffNow()` or authorized `api_processEdmCapacityHandoffNow()` from the planner UI layer.

## Disposition and failure behavior

| Outcome | EDM Inbox sources | Handoff file | Planner data |
|---------|-------------------|--------------|--------------|
| Duplicate successful checksum | Stay in Inbox (`DUPLICATE_SUCCESS_CHECKSUM`; not moved to Failed) | N/A | Unchanged |
| Validation / transform failure | Moved to **Failed** when folder configured | N/A | Unchanged |
| Success + ingest on | **Archive** (or **delete** when delete flag + option) | New `WoW_Consolidated_<jobId>` in Handoff folder | Unchanged until stage 2 |
| Handoff ingest success | N/A | **Trashed** (`trashHandoffAfterSuccess` default true) | WoW sheets updated; `Normalization_Log` / freshness on **planner** workbook |
| Handoff preflight failure | N/A | Left in folder (not trashed) | Unchanged |
| Ingest disabled (`EDM_SLG_CAPACITY_INGEST_ENABLED` not true) | Remain in Inbox after dry transform skip | Not written | Unchanged |

Scheduled runner: a Capacity exception does **not** prevent Qualtrics InFlight/Responses from running; aggregate `ok` on the scheduled result may still be `false` if Capacity fails—check per-leg objects in logs.

## Controlled activation checklist (requires explicit authorization)

Do **not** run in automation without Jeff’s authorization in the current interaction:

1. **Git / HEAD:** `main` includes SLG Capacity EDM commits; `clasp push` EDM + SLG_Capacity (dev HEAD).
2. **Properties:** Set folder ids; set `EDM_SLG_CAPACITY_INGEST_ENABLED=true`; set planner `SLG_CAPACITY_HANDOFF_INBOX_FOLDER_ID` to the handoff folder.
3. **EDM schedule:** Existing `runQualtricsInboxScheduled` trigger already covers stage 1 when ingest flag is on (no second EDM trigger).
4. **Planner schedule:** Install the 15-minute `processEdmCapacityHandoffNow` trigger on SLG_Capacity.
5. **Production deploy (optional):** Repoint SLG_Capacity production deployment per `solutions/SLG_Capacity/gas.config.json` only after explicit deploy authorization.
6. **Smoke:** Drop a test batch or use editor `processSlgCapacityInboxNow` dry-run first; confirm ledger row, handoff sheet, then handoff ingest and WoW freshness in Admin.

## Local tests

```powershell
cd solutions/External_Data_Manager; npm test
cd solutions/SLG_Capacity; npm test
```

## Related

- [external-data-manager.md](./external-data-manager.md) — EDM platform overview
- [edm-qualtrics-v1-runbook.md](./edm-qualtrics-v1-runbook.md) — shared schedule handler and activation patterns

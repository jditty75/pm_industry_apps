# EDM Qualtrics V1 — operations runbook

Standalone orchestration project: `solutions/External_Data_Manager`. Destinations: **HC_DM**, **SLG_DM**, **HENP_DM** (CoreLib **144**). **EVI_DM / PDX_DM / HS_DM** stay on CoreLib **139** and are not Qualtrics V1 destinations.

## Normal user workflow (post–V1 activation)

1. In Qualtrics, export the **PGL and MDS Survey Dashboard** as **CSV** (full dashboard export, not a filtered sub-region slice).
2. Upload the CSV to **Google Drive → External Data → Qualtrics → Inbox** (single active candidate; oldest unprocessed file wins unless `sourceFileName` is specified).
3. Wait for the scheduled job (or ask an operator to run **Process Now** once if triggers are not yet installed).

Users do **not** need Python, transformed CSVs, Deployment Manager upload screens, Apps Script, Cursor, Git, or CLASP.

### Failure behavior

- Invalid or partial jobs move the source to **External Data → Qualtrics → Failed** when ingest is enabled and the job fails (not on dry-run).
- With **ingest disabled**, sources stay in **Inbox**.
- The **Job Ledger** spreadsheet records job id, status, counts, checksum, per-destination status, and error category — **no row-level PII**.
- Operators use the ledger and destination `CSAT_InFlight` backups under **`DHM_CSAT_Imports`** for recovery.

## Pre–first-ingestion checklist (operator)

| Control | Required state |
|--------|----------------|
| EDM `appsscript.json` | CoreLib **144**, `developmentMode: false` |
| `EDM_QUALTRICS_INGEST_ENABLED` | **unset** or not `true` |
| `EDM_DELETE_SUCCESSFUL_QUALTRICS_SOURCE` | **unset** or not `true` |
| Time-driven trigger | **none** (`runQualtricsInboxScheduled`) |
| Qualtrics Inbox | Intended **full-dashboard** CSV present |
| Audit ledger | Configured and append-only |
| Destinations | `EDM_DEST_*_SPREADSHEET_ID` set for HC / SLG / HENP |

Local validation before upload:

```powershell
node solutions/External_Data_Manager/scripts/validate-qualtrics-csv.js "C:\path\to\export.csv"
```

Expect `jobStatus: READY_FOR_INGESTION`, routing ok, and destination `inputRows` matching healthcare/sled counts.

## First real ingestion (authorization required)

**Do not** set ingest enabled or run non–dry-run ingest without explicit authorization in the current session.

### Minimal steps after authorization

1. Confirm the canonical source file is in **Qualtrics → Inbox** (recommended name pattern: `PGLandMDSSurveyDashboard-…-UR_….csv` full export).
2. In the EDM Apps Script project, set Script Property `EDM_QUALTRICS_INGEST_ENABLED` = `true`.
3. Run **`processQualtricsInboxNow({ dryRun: false, ingestEnabled: true })`** (or equivalent clasp-run with those options).
4. Verify success criteria below; capture baselines if not already done via `runEdmDestinationCsatBaselineSummary()`.
5. Set `EDM_QUALTRICS_INGEST_ENABLED` back to `false` until V1 activation (trigger + optional delete) is authorized.

### Exact authorization phrase (Jeff)

> **Authorize EDM Qualtrics V1 first real ingestion:** run production ingest for the full-dashboard CSV in Qualtrics Inbox into HC_DM, SLG_DM, and HENP_DM with ingest enabled, deletion off, and trigger off.

## First-ingestion success criteria

- Source validates (`QualtricsPipeline.validateSource` ok).
- Normalization counts match dry-run (source rows, canonical rows, healthcare, sled).
- **HC_DM**, **SLG_DM**, and **HENP_DM** ingest each succeed (no `PARTIAL_FAILURE` / `FAILED` overall).
- DepMngr deployment-universe filtering applied per destination workbook.
- `CSAT_InFlight` headers match canonical 16-column schema; written data row counts match returned eligible counts per destination.
- Backup CSV created under **`DHM_CSAT_Imports`** per destination ingest.
- Caches cleared only after successful replacement (CoreLib behavior).
- Audit ledger row appended with all three destination outcomes and checksum.
- Source remains in **Inbox** (delete property still off).
- No EDM schedule trigger installed.

If **any** destination fails, overall job must be **PARTIAL_FAILURE** or **FAILED**; source must remain available in Inbox/Failed for recovery; do not enable source deletion.

## Recovery / rollback

### Data-ingestion rollback

1. Identify the pre-ingestion backup in **`DHM_CSAT_Imports`** (filename includes app id and timestamp) or use Sheet version history on `CSAT_InFlight`.
2. Restore prior `CSAT_InFlight` content for affected workbook(s) using the canonical safe-replace recovery path (operator restores sheet data; do not re-run ingest until root cause is understood).
3. Record the incident in the job ledger notes / operator log.

### CoreLib rollback (only if ingest implementation is defective)

Re-pin consumers **144 → 143** and repoint production deployments only with explicit deploy authorization:

| App | Rollback GAS version |
|-----|----------------------|
| SLG_DM | @194 |
| HC_DM | @86 |
| HENP_DM | @106 |

Do not roll back CoreLib for bad source data or a single failed destination—use data rollback first.

## Post–first-ingestion V1 activation (after verified success)

Execute only after the first real job is verified end-to-end:

1. Mark first real ingestion verified in operator log / ledger annotation.
2. Set `EDM_DELETE_SUCCESSFUL_QUALTRICS_SOURCE` = `true`.
3. Test deletion on a **controlled** safe file (or next authorized export) — confirm Inbox file removed only on full success.
4. Install **one** time-driven trigger on `runQualtricsInboxScheduled`.
5. **Recommended cadence:** every **15 minutes** (balance of latency vs. avoiding redundant runs when uploads are manual). Alternative: **30 minutes** if exports are weekly batch.
6. Confirm exactly **one** EDM Qualtrics trigger exists.
7. Communicate the [normal user workflow](#normal-user-workflow-postv1-activation) to PMO.
8. Close V1: update this runbook status, archive bootstrap artifacts, keep ledger.

## GAS read-only helpers (editor or API when enabled)

| Function | Purpose |
|----------|---------|
| `runEdmVerifyOperationalState()` | Properties, destinations resolved, ingest/delete flags, trigger count |
| `runEdmDestinationCsatBaselineSummary()` | Pre/post `CSAT_InFlight` row counts and header check |
| `runEdmQualtricsInboxDryRunSummary()` | Drive Inbox dry-run summary (no PII) |
| `runEdmQualtricsDryRunTwice()` | Synthetic duplicate-behavior check |

## Local / CI tests

```powershell
cd solutions/External_Data_Manager; npm test
cd libraries/DepMngr; npm test
python skills/gas-monorepo-engineer/scripts/preview_selftest.py
```

## Architecture (unchanged)

Qualtrics CSV → canonical normalized model → **QualtricsRoutingConfig** populations → destination registry → `CoreLib.CoreData.ingestCsatInFlight`. Normalization does not hard-code HC/SLG/HENP; Capacity remains a future adapter under the same EDM framework.

# EDM Qualtrics V1 — operations runbook

**Status: PRODUCTION ACTIVE** (activated 2026-10-05). Standalone orchestration: `solutions/External_Data_Manager` (CoreLib **145**). Qualtrics destinations: **HC_DM**, **SLG_DM**, **HENP_DM** (CoreLib **144**). **EVI_DM / PDX_DM / HS_DM** remain CoreLib **139** — not Qualtrics V1 destinations.

## Normal user workflow

1. In Qualtrics, export the **PGL and MDS Survey Dashboard** as **CSV** (full dashboard export — the supported V1 source).
2. Upload the CSV to **Google Drive → GOV PS PMO → GAS_apps → External Data → Qualtrics → Inbox**.
3. **Done.** No Python, transformed Healthcare/SLED CSVs, Deployment Manager File Upload tabs, Apps Script, Cursor, Git, or CLASP required.

### What happens automatically

| Topic | Behavior |
|--------|----------|
| Processing latency | Approximately **15 minutes** (time-driven trigger on `runQualtricsInboxScheduled`) |
| Successful files | Removed from Inbox after validated transform, all destination ingests, verification, and audit persistence (`EDM_DELETE_SUCCESSFUL_QUALTRICS_SOURCE=true`) |
| Failed files | Remain in **Inbox** or move to **Qualtrics → Failed** for investigation (ingest enabled, non–dry-run failures) |
| Job status | **Audit ledger** spreadsheet (counts, checksum, per-destination status — **no row-level PII**) |
| Supported input | Full-dashboard Qualtrics CSV only |
| Unsupported input | Shorter exports with extra/unexpected **Sub Region** values (not the V1 contract) |
| Emergency fallback | Existing DM **manual CSAT upload** on HC/SLG/HENP workbooks |

Operators may run **Process Now** once via the EDM project (`processQualtricsInboxNow`) if a file must land before the next scheduled pass — same processor, locks, checksum, stale, audit, and deletion rules as the trigger.

## Architecture (production)

```text
Qualtrics full-dashboard CSV
  → Drive Inbox
  → EDM scheduled processor (runQualtricsInboxScheduled / processQualtricsInboxNow)
  → schema validation (source contract)
  → canonical normalization
  → QualtricsRoutingConfig (configuration-driven routing)
  → CoreLib 145 ingestCsatInFlight (destination adapter)
  → HC / SLG / HENP filtering per workbook
  → safe CSAT_InFlight replacement + verification
  → audit ledger
  → successful source deletion (when enabled)
```

Separation preserved for future pipelines (e.g. **SLG_Capacity** as another EDM adapter): **source contract → canonical model → routing config → destination adapter**.

## Production controls (normal state)

| Control | Value |
|--------|--------|
| `EDM_QUALTRICS_INGEST_ENABLED` | `true` |
| `EDM_DELETE_SUCCESSFUL_QUALTRICS_SOURCE` | `true` |
| EDM CoreLib pin | **145** (`developmentMode: false`) |
| Schedule | **One** time-driven trigger: `runQualtricsInboxScheduled`, ~**15** minutes |
| DM CoreLib pins | SLG / HC / HENP **144**; EVI / PDX / HS **139** (unchanged for Qualtrics V1) |

Activation entry point (one-time, **Apps Script editor**): `runEdmQualtricsV1ProductionActivationNow()`. Remote Execution API / `clasp run` is not used in this environment—see [gas-runtime-execution.md](../../skills/gas-monorepo-engineer/references/gas-runtime-execution.md).

## Failure / recovery (no intentional prod failures)

- **Duplicate successful checksum** → job rejected (`DUPLICATE_SUCCESS_CHECKSUM`); source stays in Inbox (not moved to Failed).
- **Invalid source** → failed job; source available for recovery (Failed folder when move succeeds).
- **Partial destination failure** → overall **PARTIAL_FAILURE**; source **not** deleted.
- **Lock** → concurrent scheduled/manual runs serialize on `EDM_QUALTRICS_INGEST`.
- **Stale guard** → active when a trustworthy export timestamp exists on the source/ledger.
- **Failed folder move** → shared-drive safe fallback; move failure cannot mask the original processing failure (logged; source may remain in Inbox).
- **Ledger / logs** → metadata only; no row-level PII in operational records.

### Data rollback

1. Use pre-ingestion backup under **`DHM_CSAT_Imports`** or Sheet version history on `CSAT_InFlight`.
2. Restore prior sheet content before re-running ingest.

## GAS read-only helpers (Apps Script editor)

Run in the EDM project editor. Return **sanitized** JSON/logs to agents (counts and flags only—no IDs, PII, or row payloads). Do not rely on `clasp run` / `scripts.run` from automation.

| Function | Purpose |
|----------|---------|
| `runEdmVerifyOperationalState()` | Properties, destinations, ingest/delete flags, trigger inventory |
| `runEdmDestinationCsatBaselineSummary()` | `CSAT_InFlight` row counts and header check |
| `runEdmQualtricsInboxDryRunSummary()` | Inbox dry-run (no PII) |
| `runEdmQualtricsInboxInventory()` | Inbox CSV count/names only |
| `runEdmAuditLedgerTailSummary(n)` | Last ledger rows (sanitized) |

## Local / CI tests

```powershell
cd solutions/External_Data_Manager; npm test
cd libraries/DepMngr; npm test
python skills/gas-monorepo-engineer/scripts/preview_selftest.py
```

## First real ingestion (historical — completed 2026-10-05)

Verified production job (full-dashboard export): **596** source rows → **220** normalized populations (**86** healthcare / **134** SLED); **HC_DM** 40 written, **SLG_DM** 19, **HENP_DM** 37; overall **SUCCESS**; checksum prefix `8545dbf0510b0d55`. HENP CSAT tab enabled and visually verified separately.

Pre–activation checklist items (ingest off, delete off, no trigger) applied only to the controlled first ingest; normal production state is documented above.

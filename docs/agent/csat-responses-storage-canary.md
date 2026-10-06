# CSAT Responses — controlled storage/pipeline canary (plan)

Status: **AUTHORIZED** — runtime steps complete in **GAS editor** when local/agent preflight is green. See [gas-runtime-execution.md](../../skills/gas-monorepo-engineer/references/gas-runtime-execution.md).

## Validation split (agents vs editor)

| Who | Responsibility |
|-----|----------------|
| **Cursor / agent** | Local EDM/DepMngr tests; real-source local dry-run; read-only `clasp status` / deployments / Script API where permitted; authorized `clasp push` / deploy per explicit production authorization; Git and ledger bookkeeping |
| **Jeff (GAS editor)** | Any step that needs Apps Script runtime against live Drive/Properties/Sheets/SFDC eligibility |

**Do not** use `scripts.run` or `clasp run` as the default path—they repeatedly return `403 PERMISSION_DENIED` in this environment while editor and triggers work. On 403, record once and use the editor handoff below.

### GAS editor handoff (template)

```text
GAS EDITOR ACTION REQUIRED

Project: External Data Manager
Run: <function>(<args>)

Expected sanitized output:
- counts / statuses / booleans only

Do not paste: IDs, PII, comments, or source rows.
```

### All-in-one orchestrator (optional)

After the validated Responses CSV is in **Responses/Inbox** and EDM HEAD includes canary helpers:

`runEdmCsatResponsesSlgStorageCanaryNow()`

Dry-run / eligibility only (no ingest): `runEdmCsatResponsesSlgStorageCanaryNow({ skipIngest: true })`

Authorization boundaries (SLG-only first write, no HC/HENP, no scheduling, no source delete) are unchanged—the orchestrator encodes them; do not weaken for tooling convenience.

## Current release/runtime graph (reference)

| Component | Typical pin | Notes |
|-----------|-------------|--------|
| **DepMngr / CoreLib** | **146** (immutable cut) | CSAT Responses storage APIs |
| **External Data Manager** | CoreLib **146** | HEAD includes InFlight classifier + Responses pipeline |
| **SLG_DM** | CoreLib per manifest | EDM invokes CoreLib **from EDM** for ingest; SLG pin bump optional until R3 UI |

## InFlight production regression gate (local — re-run before EDM push)

- `solutions/External_Data_Manager`: full `npm test` (cross-feed + oracle).
- Real Responses → InFlight: **rejected** (local validator).
- Real InFlight → Responses: **rejected** (local).
- Valid narrow InFlight synthetic: **accepted** (tests).

## Responses infrastructure (additive)

**Drive layout (idempotent):**

- `External Data/Qualtrics/Inbox` + `Failed` — **unchanged**
- `External Data/Qualtrics/Responses/Inbox` + `Responses/Failed` — **new**

**Setup (editor, after authorization):**

1. `runEdmEnsureQualtricsResponsesDriveFromProperties()` — when `EXTERNAL_DATA_PARENT_FOLDER_ID` is already set, or  
2. `runEdmSetupQualtricsResponsesDrive(externalDataParentFolderId)` — one-time parent id argument (never commit id to Git).

Persists `QUALTRICS_RESPONSES_INBOX_FOLDER_ID`, `QUALTRICS_RESPONSES_FAILED_FOLDER_ID` only.

**Flags (default OFF):**

- `EDM_QUALTRICS_RESPONSES_INGEST_ENABLED` — unset / not `true` until controlled ingest
- `EDM_DELETE_SUCCESSFUL_QUALTRICS_RESPONSES_SOURCE` — unset for first write

## SLG canary sequence

| Step | Agent (local/read-only/authorized push) | Editor (GAS runtime) |
|------|----------------------------------------|----------------------|
| A | — | Responses Drive setup (functions above) |
| B | — | Place validated Responses CSV in **Responses/Inbox** only |
| C | Local dry-run on same file (`responses-dry-run-local.js`) | `processQualtricsResponsesInboxNow({ dryRun: true })` |
| D | — | `runEdmPreviewCsatResponsesEligibility('SLG_DM')` |
| E | — | `runEdmBootstrapCsatResponsesStorage('SLG_DM')` |
| F | — | Enable ingest: `runEdmSetQualtricsResponsesIngestEnabled(true)` then `processQualtricsResponsesInboxNow({ dryRun: false, ingestEnabled: true, limitDestinationAppIds: ['SLG_DM'], deleteSuccessfulSource: false })` |
| G | — | `runEdmVerifyCsatResponsesStorage('SLG_DM')` |
| H | — | Repeat F with `allowDuplicateOverride: true` for idempotency; then `runEdmSetQualtricsResponsesIngestEnabled(false)` |

**First-write success criteria (SLG, 28 Government rows):**

- `inserted + updated + unchanged + excluded + rejected` reconcile to routed input **28**
- `excluded` explained by deployment universe (counts only)
- Sheet: headers = `CoreCsatResponses.CSAT_RESPONSES_COLUMNS`, `contract_version` property set
- No duplicate `response_id`; revisions = 1 for new rows
- No ingest to HC/HENP workbooks

**Idempotency (second run, same file):**

- `inserted = 0`, `updated = 0`, `unchanged = eligible count from first run`
- Source file still in Inbox (cleanup disabled)

## GAS dry-run expectations (step C)

- Classifier `QUALTRICS_RESPONSES`, source/canonical **177**
- Routes: HC **77**, SLG **28**, HENP **72**
- No destination writes, no source delete, ledger `pipeline=qualtrics_responses`
- InFlight trigger unchanged (still `runQualtricsInboxScheduled` only)

**Editor — expected sanitized dry-run fields:** `ok`, `dryRun: true`, destination `inputRows` per app (77/28/72), `sourceRowCount` 177.

**Editor — eligibility preview:** `routedCandidateRows: 28`, `eligible + excluded + rejected = 28`, `deploymentUniverseSize > 0`, `eligible > 0` unless clearly explained by data.

## Rollback references

| Layer | Rollback |
|-------|----------|
| CoreLib | Repoint consumers to prior immutable; EDM pin match |
| EDM HEAD | Redeploy prior GAS version from clasp history (pre-classifier) — requires recorded pre-push version |
| SLG sheet | Delete `CSAT_Responses` tab or restore from pre-canary copy (manual) |
| Drive | Responses folders optional; InFlight unaffected |

## HC / HENP extension (after SLG proof)

1. Repeat preview → bootstrap → scoped ingest for `HC_DM` (77) and `HENP_DM` (72) with separate authorization.
2. Do not enable Responses scheduler until R3 read APIs exist.

## Authorization phrases (repository semantics)

- **DepMngr immutable cut:** `Execute the DepMngr release plan.` (after `.\release.ps1 DepMngr -Plan` fingerprint matches)
- **EDM production push:** explicit production authorization for External Data Manager in the **current** interaction (classifier is production-impacting)
- **SLG first write:** explicit authorization for SLG `CSAT_Responses` bootstrap + first historical ingest in the **current** interaction

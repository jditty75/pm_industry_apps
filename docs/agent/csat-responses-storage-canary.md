# CSAT Responses — controlled storage/pipeline canary

Status: **SLG STORAGE CANARY VERIFIED** (production editor runtime, October 2026). Local/agent hardening committed on Git `main`; CoreLib immutable cut **pending** (plan only — see release plan below).

## Verified production outcomes (counts only)

| Metric | Value |
|--------|------:|
| Real Qualtrics Responses source (canonical) | 177 |
| HC routed candidates | 77 |
| SLG routed candidates | 28 |
| HENP routed candidates | 72 |
| SLG deployment universe (Active + Complete, merged) | 637 |
| SLG first ingest — input | 28 |
| SLG first ingest — eligible/stored | 26 |
| SLG first ingest — excluded | 2 |
| SLG first ingest — inserted / updated | 26 / 0 |
| SLG second ingest — inserted / updated | 0 / 0 |
| SLG stored row count after second pass | 26 (derived from storage verification; not a separate job metric) |
| Duplicate response IDs after second pass | none observed |

Both production Responses jobs: **SUCCESS**. `CSAT_Responses` exists in SLG workbook. Source deletion: **OFF**. Responses scheduling: **OFF**. HC/HENP historical storage: **not ingested**. InFlight scheduler: **unchanged**.

**Exclusion interpretation (SLG):** canonical transform had **no row rejects**; **2** exclusions are **consistent with** `excluded_deployment_not_in_universe` (deployment IDs not in SLG Active+Complete universe). Do not weaken eligibility to force 28/28.

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

### Post-canary read-only acceptance (optional, after CoreLib 147 pin to EDM)

`runEdmVerifyCsatResponsesSlgCanaryAcceptance('SLG_DM')`

Expected when storage matches verified canary: `ok: true`, `checks.storedRows`, `checks.uniqueResponseIds`, `checks.noDuplicateResponseIds`, `checks.revisionsStillOne`, header/contract flags. Field `coreLibStorageQualityRequired: true` until EDM runs a CoreLib build that includes `storageQuality` on `verifyCsatResponsesStorage` (planned next immutable after Git hardening).

Sanitized exclusion breakdown from live inbox (read-only): `runEdmSummarizeCsatResponsesExclusionReasons('SLG_DM')` → `exclusionReasonCounts` counts only.

### All-in-one orchestrator (historical; do not re-run ingest without authorization)

`runEdmCsatResponsesSlgStorageCanaryNow()`

Dry-run / eligibility only (no ingest): `runEdmCsatResponsesSlgStorageCanaryNow({ skipIngest: true })`

## Current release/runtime graph (reference)

| Component | Typical pin | Notes |
|-----------|-------------|--------|
| **DepMngr / CoreLib** | **146** (live immutable) | Responses storage APIs; **147** planned for workbook-context + sanitized diagnostics (not cut in this close-out) |
| **External Data Manager** | CoreLib **146** | HEAD includes InFlight classifier + Responses pipeline + canary helpers |
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

## SLG canary sequence (completed)

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

- `inserted = 0`, `updated = 0` (directly logged)
- Stored row count **26** unchanged (verified via storage read / acceptance helper; `unchanged` column not asserted from production job payload in this close-out)

## GAS dry-run expectations (step C)

- Classifier `QUALTRICS_RESPONSES`, source/canonical **177**
- Routes: HC **77**, SLG **28**, HENP **72**
- No destination writes, no source delete, ledger `pipeline=qualtrics_responses`
- InFlight trigger unchanged (still `runQualtricsInboxScheduled` only)

## Rollback references

| Layer | Rollback |
|-------|----------|
| CoreLib | Repoint consumers to prior immutable; EDM pin match |
| EDM HEAD | Redeploy prior GAS version from clasp history (pre-classifier) — requires recorded pre-push version |
| SLG sheet | Delete `CSAT_Responses` tab or restore from pre-canary copy (manual) |
| Drive | Responses folders optional; InFlight unaffected |

## HC + HENP combined expansion (plan only — not authorized in close-out)

After **CoreLib next immutable** is cut and **EDM** `appsscript.json` pins that version:

1. Local: full Responses + classifier regression (`External_Data_Manager` + DepMngr CSAT tests).
2. Editor read-only: `runEdmPreviewCsatResponsesEligibility('HC_DM')` then `HENP_DM` — report `eligible`, `excluded`, `exclusionReasonCounts` only; **stop** if counts implausible vs routed **77** / **72**.
3. `runEdmBootstrapCsatResponsesStorage('HC_DM')` → scoped ingest `limitDestinationAppIds: ['HC_DM']` → `runEdmVerifyCsatResponsesStorage('HC_DM')`.
4. Repeat bootstrap → ingest → verify for `HENP_DM` only.
5. Optional second scoped ingest per destination to prove idempotency (same source, `deleteSuccessfulSource: false`).
6. Keep source deletion **OFF**, Responses scheduling **OFF**, InFlight scheduler **untouched**.

Requires explicit Jeff authorization in the **current** interaction at execution time.

## Authorization phrases (repository semantics)

- **DepMngr immutable cut:** `Execute the DepMngr release plan.` (after `.\release.ps1 DepMngr -Plan` fingerprint matches)
- **EDM production push:** explicit production authorization for External Data Manager in the **current** interaction (classifier is production-impacting)
- **HC/HENP first write:** explicit authorization for combined or per-destination historical ingest in the **current** interaction

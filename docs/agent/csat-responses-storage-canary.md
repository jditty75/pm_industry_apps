# CSAT Responses — controlled storage/pipeline canary (plan)

Status: **READY FOR AUTHORIZATION** (no production mutations performed by this document).

## Current release/runtime graph (Git + ledger; live GAS read-only partial)

| Component | Git `main` | Tracked pin / prod | Live immutable library (ledger) | Notes |
|-----------|------------|--------------------|----------------------------------|-------|
| **DepMngr / CoreLib** | `25fc14d` includes R2 `ingestCsatResponses` | DM fleet **144**; EDM **145** | Last cut **145** (`73f37fb` EDM ingest fix) | R2 storage **not** in immutable **144/145**; next proposed **146** (`release.ps1 DepMngr -Plan`) |
| **External Data Manager** | `5b374a2`+ (R2 transformer + **R1.5 InFlight classifier**) | CoreLib **145** | HEAD unknown (clasp versions blocked: credential store EPERM) | **Any `clasp push` updates HEAD executed by `runQualtricsInboxScheduled`** |
| **SLG_DM** (canary) | CoreLib **144** | Prod deployment per `gas.config.json` | Unchanged for canary phase 1 | EDM calls CoreLib **from EDM project** for ingest; SLG pin bump optional until R3 |

**Library delta (R2 vs immutable 145):** `CoreCsatResponses.js`, `ingestCsatResponses`, eligibility (Notable Active+Complete), upsert/hash/revision, bootstrap/preview/verify APIs.

**Unrelated DepMngr since 145:** R2 commits `5b374a2`/`25fc14d` only (CSAT Responses); no other library commits on `main` after ledger 145 besides those.

## InFlight production regression gate (local — must re-run before EDM push)

- `solutions/External_Data_Manager`: **62/62** tests (includes cross-feed + legacy InFlight synthetic + oracle).
- Real Responses → InFlight: **rejected** (validated locally).
- Real InFlight → Responses: **rejected** (validated locally).
- Valid narrow InFlight synthetic: **accepted**.

## Responses infrastructure (additive)

**Drive layout (idempotent):**

- `External Data/Qualtrics/Inbox` + `Failed` — **unchanged**
- `External Data/Qualtrics/Responses/Inbox` + `Responses/Failed` — **new**

**Setup (GAS, after authorization):**

1. `runEdmSetupQualtricsResponsesDrive(externalDataParentFolderId)`  
   Persists `QUALTRICS_RESPONSES_INBOX_FOLDER_ID`, `QUALTRICS_RESPONSES_FAILED_FOLDER_ID` only (never Git).

**Flags (default OFF):**

- `EDM_QUALTRICS_RESPONSES_INGEST_ENABLED` — unset / not `true`
- `EDM_DELETE_SUCCESSFUL_QUALTRICS_RESPONSES_SOURCE` — unset for first write

## Minimal CoreLib / pin graph (preferred immutable)

Single immutable **CoreLib 146** containing cumulative R2 Responses storage (and any EDM-required fixes already on 145):

1. **DepMngr:** `clasp push` + `clasp version` → **146** (authorized plan execution).
2. **EDM:** bump `appsscript.json` CoreLib **145 → 146**; `clasp push` (separate explicit EDM production authorization — **also ships R1.5 InFlight classifier on HEAD**).
3. **SLG_DM:** **no pin bump required** for EDM-driven ingest/bootstrap (CoreLib runs in EDM). Optional pin to 146 later for R3 UI.

HC / HENP / EVI / PDX / HS: **no change** in canary phase.

## SLG canary sequence (authorized steps)

| Step | Action | Authorization |
|------|--------|----------------|
| A | Responses Drive setup | EDM infrastructure |
| B | Place validated Responses CSV in **Responses/Inbox** only | Operator |
| C | `processQualtricsResponsesInboxNow({ dryRun: true })` | EDM GAS |
| D | `runEdmPreviewCsatResponsesEligibility('SLG_DM')` | Read-only GAS |
| E | `runEdmBootstrapCsatResponsesStorage('SLG_DM')` | SLG sheet create |
| F | `processQualtricsResponsesInboxNow({ dryRun: false, ingestEnabled: true })` scoped to SLG only* | First write |
| G | `verifyCsatResponsesStorage` via CoreLib / controlled wrapper | Verify |
| H | Repeat F → idempotency (unchanged = eligible count) | Acceptance |

\*First write: keep `deleteSuccessfulSource: false`; Responses scheduling remains manual.

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

## Rollback references

| Layer | Rollback |
|-------|----------|
| CoreLib | Repoint consumers to **145**; EDM pin 145 |
| EDM HEAD | Redeploy prior GAS version from clasp history (pre-classifier) — requires recorded pre-push version |
| SLG sheet | Delete `CSAT_Responses` tab or restore from pre-canary copy (manual) |
| Drive | Responses folders optional; InFlight unaffected |

Ledger: prior immutable **145**; DM prod deployments **SLG@195**, **HC@87**, **HENP@107** (from library ledger).

## HC / HENP extension (after SLG proof)

1. Repeat steps D–H for `HC_DM` (77) and `HENP_DM` (72) with same Responses file (single EDM job routes all).
2. Authorize ingest flags and cleanup policy separately.
3. Do not enable scheduler until R3 read APIs exist.

## Authorization phrases (repository semantics)

- **DepMngr immutable cut:** `Execute the DepMngr release plan.` (after `.\release.ps1 DepMngr -Plan` fingerprint matches)
- **EDM production push:** explicit production authorization for External Data Manager in the **current** interaction (classifier is production-impacting)
- **SLG first write:** explicit authorization for SLG `CSAT_Responses` bootstrap + first historical ingest in the **current** interaction

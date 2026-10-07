# SLG Deployment Signal persistence (deployment-signal-v1)

**Scope:** SLG Deployment Manager production workbook only. Other `*_DM` apps keep `deploymentSignal.persistenceEnabled` default **false**.

## Architecture

```text
Deterministic SLG evidence → Sana reasoning → normalization/validation
  → persistApprovedSlgSignalRun → lifecycle → workbook storage
  → Deployment Manager UI / weekly email (future) / reporting
```

| Layer | Responsibility |
|-------|----------------|
| Sana | Strategic interpretation (substantive fields only) |
| GAS (`CoreDeploymentSignal*`) | IDs, timestamps, validation, lifecycle, persistence, reads |

## Workbook sheets (exact names)

| Sheet | Purpose |
|-------|---------|
| `Deployment_Signals` | Latest approved **active** Signal state (upserted each run; not append-only) |
| `Deployment_Signal_History` | Append-only approved history and lifecycle transitions |
| `Deployment_Signal_Runs` | One row per weekly run (audit, idempotency, counts, versions) |

Configured via `cfg.deploymentSignal.signalsSheetName` (defaults above). SLG enables persistence in `Config_SLG.js`.

## Headers

### `Deployment_Signals` (current)

`schema_version`, `signal_id`, `deployment_id`, `signal_run_id`, `signal_as_of`, `lifecycle_state`, `attention`, `signal_type`, `observation`, `interpretation`, `why_it_matters`, `leadership_question`, `confidence`, `evidence_limitations`, `current_health`, `stage`, `signal_status`, `context_ref`, `source_reasoning_run_ref`, `prior_signal_id`, `normalization_version`, `reasoning_prose_original`, `first_active_at`, `last_updated_at`, `persisted_at`

### `Deployment_Signal_History`

Same as current, plus: `history_event_at`, `history_event_type` (`APPROVED_RUN`, `RESOLUTION`).

### `Deployment_Signal_Runs`

`signal_run_id`, `signal_as_of`, `started_at`, `received_at`, `persisted_at`, `deployments_evaluated`, `signals_proposed`, `signals_persisted`, `no_signal_count`, `lifecycle_new_count`, `lifecycle_continuing_count`, `lifecycle_escalated_count`, `lifecycle_de_escalated_count`, `lifecycle_resolved_count`, `run_status`, `persistence_status`, `context_schema_version`, `signal_schema_version`, `normalization_version`, `agent_reference`, `source_reasoning_run_ref`, `error_message`, `email_status`

## Sana-facing substantive contract (minimum)

Sana supplies **one record per surfaced deployment** (structured or parseable prose). GAS adds all system fields.

| Field | Required | Notes |
|-------|----------|-------|
| `deployment_id` | Yes | Must resolve to active SLG deployment population |
| `attention` | Yes | `HIGH`, `WATCH`, `INFORMATIONAL`, `POSITIVE` (portfolio-relative) |
| `signal_type` | Yes | e.g. `COMPOUND`, `INTERVENTION`, `SCHEDULE`; unknown labels normalized safely |
| `observation` | Yes* | *Or `interpretation` if observation omitted |
| `interpretation` | Yes* | |
| `why_it_matters` | Recommended | |
| `leadership_question` | Recommended | |
| `confidence` | Recommended | `HIGH` / `MEDIUM` / `LOW` |
| `evidence_limitations` | Recommended | |
| `context_ref` | Optional | Link to `deployment-signal-context-v1` packet |
| `reasoning_prose_original` | Optional | Audit-only full block |

GAS supplies: `schema_version`, `signal_id`, `signal_run_id`, timestamps, `lifecycle_state`, `signal_status`, health/stage snapshots when provided, normalization version, persistence metadata.

Optional alternate input: `sana_batch_text` (verbatim Sana portfolio blocks) on the approved run payload — parsed and normalized by `CoreDeploymentSignalNormalize` (same field rules as structured `records`).

## Normalization policy

- Trim/collapse whitespace on prose; preserve meaning.
- Enum casing for attention/confidence; known signal-type aliases; unknown types → uppercase token (not discarded).
- Fail validation on missing deployment, missing attention/type, missing observation+interpretation, or unknown deployment ID.
- Does **not** infer escalation from prose tone.

## Signal identity

Stable key: `deployment_id` + normalized `signal_type` (`CoreDeploymentSignalNormalize.identityKey`).

- Continuing weekly Signals **reuse** `signal_id`.
- Ambiguous continuity → prefer **NEW** (new type on same deployment creates a new Signal).
- Identity does **not** use AI prose.

## Lifecycle semantics

| `lifecycle_state` | Meaning |
|-------------------|---------|
| `NEW` | No prior active Signal for this identity key |
| `CONTINUING` | Active prior; same attention rank |
| `ESCALATED` | Attention rank increased (`WATCH`→`HIGH`, etc.) |
| `DE_ESCALATED` | Attention rank decreased while still active |
| `RESOLVED` | Was active; absent from newly approved set |

**POSITIVE:** modeled as **`attention`** (`POSITIVE`), not a lifecycle state. Weekly email “improving” sections use attention + lifecycle (`DE_ESCALATED`, etc.), not a sixth lifecycle enum.

## Approved write transaction

**Function:** `CoreDeploymentSignalPersistence.persistApprovedSlgSignalRun(appConfig, runInput)`

SLG menu/editor wrappers: `persistApprovedSlgSignalRun(runInput)` in `SLG_DM/Code.js`.

**Required:** `signal_run_id` (idempotency key). Replays with `run_status=COMPLETE` return existing outcome without duplicating history.

**Steps:** lock → validate → normalize → deployment identity check → lifecycle plan → append history → replace current active rows → finalize run row.

**Failure:** run marked `FAILED`; prior `Deployment_Signals` body not replaced on validation failure; partial write attempts record `FAILED` run diagnostic.

## Read APIs

| API | Purpose |
|-----|---------|
| `getCurrentSlgDeploymentSignals(appConfig, { deploymentId?, activeOnly? })` | Portfolio / deployment current state |
| `getSlgDeploymentSignalHistory(appConfig, { deploymentId?, signalRunId?, limit? })` | Longitudinal / run history |
| `getLatestApprovedSlgSignalRun(appConfig)` | Freshness, continuity context, email idempotency |

## Workbook initialization

`CoreDeploymentSignalPersistence.initializeSignalSheets(appConfig)` — idempotent header provisioning; does not clear unrelated sheets.

SLG wrapper: `initializeSlgDeploymentSignalSheets()`.

## Weekly email handoff (renderer not implemented)

Consume **persisted** `Deployment_Signals` + `Deployment_Signal_History` + latest run from `Deployment_Signal_Runs`. Section by `lifecycle_state` and `attention` (`POSITIVE`). No second AI pass.

## Deployment Manager UI handoff (UI not in this milestone)

Same persisted reads: latest run metadata, active Signals, lifecycle, attention, type, concise reasoning fields, `deployment_id` join key, `signal_as_of` / `persisted_at` freshness.

## Data Stewardship boundary

Stewardship conditions remain in the deterministic stewardship lane (`CoreDeploymentDataStewardship`). Signals may reference `context_ref`; stewardship worklists are not written into `Deployment_Signals`.

## Code map

| Module | Role |
|--------|------|
| `CoreDeploymentSignals.js` | Context assembler + substantive normalization (`CoreDeploymentSignalContext`, `CoreDeploymentSignalNormalize`) |
| `CoreDeploymentSignalStore.js` | Headers / versions, Spreadsheet IO, in-memory test store |
| `CoreDeploymentSignalLifecycle.js` | Pure lifecycle plan |
| `CoreDeploymentSignalPersistence.js` | Orchestration + public API |

Tests: `libraries/DepMngr/test/deployment-signal-persistence.test.js`.

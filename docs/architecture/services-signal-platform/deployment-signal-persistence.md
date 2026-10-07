# SLG Deployment Signal persistence (deployment-signal-v1)

**Scope:** SLG Deployment Manager production workbook only. Other `*_DM` apps keep `deploymentSignal.persistenceEnabled` default **false**.

## Architecture

```text
SFDC connector → Auto Refresh Execution Log
  → source-aware trajectory refresh (GAS)
  → Sana Monday analysis → SUBMITTED rows in workbook
  → processSubmittedSlgSignalRuns → normalization/lifecycle/history/current
  → notification eligibility → Deployment Manager UI / leadership email (template TBD)
```

Legacy editor path `persistApprovedSlgSignalRun(runInput)` remains supported for sanitized tests; production handoff is **Sana direct-write + SUBMITTED processor**.

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

## Source-aware deterministic evidence refresh

- **Freshness authority:** `Auto Refresh Execution Log` (column contract: Refresh Time, Sheet, Status=Success).
- **SLG required sources** (`Config_SLG.js` → `deploymentSignal.signalEvidenceSourceSheets`):  
  `SFDC_Deployments`, `SFDC_DeploymentHistory`, `SFDC_DeploymentProductFunctions`,  
  `SFDC_DeploymentProductFunctionHistory`, `SFDC_DHP`, `SFDC_DHPActionHistory`.
- **Consumed markers:** Script property `deploymentSignal_sourceMarkers_v1_SLG` (per-sheet ISO timestamp after successful trajectory build).
- **Entry point:** `refreshSlgDeploymentSignalEvidenceIfNeeded()` → `CoreDeploymentTrajectory.refreshSignalEvidenceIfNeeded`.
- **Outcomes:** `SIGNAL_REFRESH_NO_OP`, `SIGNAL_REFRESH_COMPLETE` (+ `sources_changed`, `build_timestamp`), `SIGNAL_REFRESH_BLOCKED` (+ `source_not_ready`).
- **Trigger:** `tickSlgDeploymentSignalEvidenceRefresh` every **30 minutes** (install via `installSlgDeploymentSignalOperatingLoopTriggers()`).

## Sana direct-write handoff (production)

Sana writes `run_status=SUBMITTED` and `persistence_status=SUBMITTED` on `Deployment_Signal_Runs`, and `signal_status=SUBMITTED` on `Deployment_Signals`. GAS does **not** use inbox sheets, CSV, or onEdit.

**Processor:** `processSubmittedSlgDeploymentSignalRuns()` → `CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns`.

Validation includes run/signal count reconciliation, active deployment population, identity uniqueness, and substantive field normalization. Failures set `run_status=FAILED` without falsely completing. Retries are safe when history for the run already exists (no duplicate history append).

**Trigger:** `tickSlgDeploymentSignalSubmittedProcessor` every **30 minutes**.

## Notification eligibility (post-COMPLETE)

Rule: `lifecycle_new_count > 0` **OR** `lifecycle_escalated_count > 0`.  
CONTINUING / DE_ESCALATED / RESOLVED alone → `email_status=NOT_REQUIRED`.  
Eligible runs → payload via `CoreNotify.buildDeploymentSignalNotificationPayload` (`email_status=PENDING` until template wired in NotificationConfig).

## Approved write transaction (legacy / tests)

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

## Deployment Intelligence (deployment-intelligence-v1)

Shared platform capability (config: `cfg.deploymentIntelligence.enabled` + `deploymentSignal.persistenceEnabled`). SLG is the first consumer (`Config_SLG.js`).

**Principle:** Source evidence is app-specific. Deployment Intelligence is shared. Google Sheets is the durable boundary for GAS email and Sana Slack.

### Workbook sheet

| Sheet | Purpose |
|-------|---------|
| `Deployment_Intelligence_Runs` | One row per finalized weekly intelligence run (`cfg.deploymentIntelligence.intelligenceRunsSheetName`) |

Headers: `intelligence_run_id`, `app_id`, `signal_run_id`, `as_of_date`, `is_baseline`, `intelligence_status`, `artifact_schema_version`, `artifact_json`, `email_status`, `email_sent_at`, `slack_status`, `slack_sent_at`, `finalized_at`, `updated_at`.

`artifact_json` holds the canonical read model (`portfolioPulse`, `portfolioMovement`, `signalMovement`, `talkingPoints`, `dataConfidence`, `editorial`, `links`, `distributionState`). The `editorial` block carries leadership-ready copy (what changed, quiet/improving week semantics, data requiring attention) so GAS email and Sana Slack can render the same intelligence without re-deriving facts. Sana and email consumers read this column — not raw SFDC/trajectory sheets.

Data Stewardship in production uses `CoreDeploymentSignalContext.buildDeploymentSignalContext` (trajectory-backed) when `getContextPacketForDeployment` is not supplied.

### Finalization

`CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(appConfig, options)` requires a **COMPLETE** Signal run (not `SUBMITTED`). Idempotent by `intelligence_run_id` (`INT-{signal_run_id}`) or `signal_run_id`. Baseline run: no prior `READY` row for the same `app_id` — leadership NEW counts suppressed in `signalMovement.leadership` and baseline talking-point rules.

### Distribution state

| Field | Owner |
|-------|--------|
| `email_status` / `email_sent_at` | GAS (`CoreNotify.sendDeploymentIntelligenceEmail`) |
| `slack_status` / `slack_sent_at` | Sana (external) |

Channels are independent: email success does not imply Slack success.

### Sana Slack contract (no GAS Slack code)

Sana Deployment Intelligence distribution agent:

1. Read `Deployment_Intelligence_Runs` in the app workbook.
2. Select the latest row for the app where `intelligence_status = READY`.
3. Parse `artifact_json` for portfolio pulse, movement, signal movement, talking points, data confidence, and `links.exploreDeploymentIntelligenceUrl`.
4. Distribute when `slack_status = PENDING` (set `slack_sent_at` / `slack_status` after post via Sana-owned process).
5. Do not recalculate KPIs, lifecycle, or stewardship — render from the artifact only.

### APIs

| API | Role |
|-----|------|
| `initializeDeploymentIntelligenceSheets` | Header provisioning |
| `buildDeploymentIntelligenceReadModel` | Pure artifact builder (tests/previews) |
| `finalizeDeploymentIntelligenceRun` | Persist READY row |
| `getLatestReadyDeploymentIntelligence` | Latest READY row per app |
| `parseArtifactFromRunRow` | Parse `artifact_json` |
| `CorePortfolioHealth.buildDeploymentIntelligencePortfolioPulse` | Deterministic KPIs |
| `CoreNotify.buildDeploymentIntelligenceEmailHtml` | Leadership email HTML |
| `CoreConfig.buildDeploymentManagerInvestigationUrl` | DM deep links |

## Weekly Signal email handoff (leadership Signals)

Consume **persisted** `Deployment_Signals` + `Deployment_Signal_History` + latest run from `Deployment_Signal_Runs`. Section by `lifecycle_state` and `attention` (`POSITIVE`). No second AI pass.

Deployment Intelligence weekly email is a separate notification key (`deployment_intelligence_weekly`).

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
| `CoreDeploymentSignalPersistence.js` | Orchestration, SUBMITTED run processor, public API |
| `CoreDeploymentTrajectory.js` | Trajectory build + source-aware Signal evidence refresh |
| `CoreFreshnessMonitor.js` | Auto Refresh Execution Log reader (`getLatestSuccessRefreshBySheet`) |
| `CoreNotify.js` | Signal notification eligibility + payload handoff |
| `SLG_DM/Code.js` | SLG wrappers + operating-loop trigger install |

Tests: `libraries/DepMngr/test/deployment-signal-persistence.test.js`.

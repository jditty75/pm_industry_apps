# EDM ↔ DepMngr Boundary for CSAT Responses

Principle: **DepMngr owns the canonical model; EDM owns Qualtrics' 288-column world.** EDM never decides presentation; DepMngr never sees a raw Qualtrics header.

## 1. Contract
EDM calls (new, additive): `CoreLib.CoreData.ingestCsatResponses(config, canonicalRows, metadata, context)`.

- `canonicalRows`: array of objects with **exactly** the `canonical-response-model.md` field names (#1–#49, #57–#60 plus `product_area_groups`, `respondent_key`, `score_scale_version`). Types: strings, ints or `null`; dates as ISO strings; `product_areas`/`*_parent_topics` already `|`-joined; `qx_analytics_json` as a JSON string. EDM does **not** set `row_hash`, `revision`, `first_*`, `updated_*` — DepMngr computes them (single hashing implementation, so UI/API/EDM can never disagree).
- `metadata`: `{ source:'edm', contractVersion:'csat-response-v1', jobId, transformerVersion, sourceRowCount, warningCounts:{…}, skipBackup:true }`.
- `context`: `{ spreadsheetId }` (same mechanism as InFlight).
- DepMngr rejects the whole call if `contractVersion` ≠ its own, if any row lacks `response_id`/`deployment_id`/`survey_type`/`response_ts_utc`, or if numeric fields are out of range (range failures on *optional* scores become null+warning inside EDM, so DepMngr re-checks defensively).
- Return: `{ success, contractVersion, inserted, updated, unchanged, rejected, excluded, totalInput, verification:{ok,headerOk,rowCount}, warnings:{…}, message }`. Counts only.
- Universe: DepMngr filters by "deployment exists in the workbook's deployment master (any status)". Out-of-universe rows → `excluded` (count), never an error.

## 2. EDM transformer (`QualtricsResponses*` modules, new)
Stages: parse (`QualtricsCsv` reuse) → **source validation** → canonical normalization → routing → DTO list per destination.

Source validation (job fails, nothing ingested):
1. Header set equals expected 288 (positional signature check by index/name pair, not name set alone).
2. `_sourceType` is `survey` on 100% of rows, col 0 matches `^R_` on 100%, `Program_Type` ∈ {PGL, MDS}.
3. Rejects InFlight-shaped files (any `_sourceType = des-qds` or `SV_` in col 0).
4. `response_id` unique after dedupe rule; `Test Data Flag` ≠ truthy.
Row-level rejects (counted, not logged): missing deployment/account id, bad timestamp, unknown `Program_Type`.

Normalization rules: position-aware reader that **coalesces duplicated headers** (first non-empty occurrence); product-area alias map and group map come from a routing/normalization config object, not code literals; text sanitization per canonical model §6; scores range-checked; scale-version flag computed.

Routing config (`QualtricsResponsesRoutingConfig`, same shape as V1 `routes[]`): `Sub Region` equals `US Healthcare` → HC_DM; `Government` → SLG_DM; `Higher Ed & Student` → HENP_DM; each with `ingestKind:'csat_responses'`. Unmapped value → source validation failure (as V1). Dispatch on `ingestKind` in `EdmIngestAdapter` (today it calls `ingestCsatInFlight` unconditionally).

## 3. Pipeline reuse vs change
| Aspect | V1 today | Change for Responses |
|---|---|---|
| Job id/checksum/dup guard | `qualtrics_<ts>_<sum12>`; duplicate = same checksum previously SUCCESS | Reuse; pipeline id `qualtrics_responses` |
| Prior-job lookup | `toPriorJobRefs` not filtered by pipeline → stale/duplicate checks would cross-contaminate | **Filter by pipeline column** |
| Stale guard | effectively inert (no export timestamp supplied) | Responses supplies watermark = max `_cachedDate` in file |
| Lock | single global script lock, 1 s wait | Reuse; second pipeline skipping a tick when busy is benign |
| Ledger | `EdmJobLedger`, 18 base + 6 ext columns, fixed `healthcare_count`/`sled_count`/`hc_/slg_/henp_` | Add generic columns (`pipeline_detail_json`, inserted/updated/unchanged/rejected counts); old rows stay readable. `pipeline` = `qualtrics_responses` distinguishes rows |
| Orchestrator | `EdmQualtricsProcessor` calls `QualtricsPipeline` directly | Introduce a pipeline descriptor `{pipelineId, validate, transform, route, ingestKind, folderKeys}`; V1 becomes descriptor #1 without behavior change |
| Source cleanup/Failed | delete on SUCCESS if flag; Failed on error; partial failure keeps source | Same rules, own folders and own delete flag |
| Dry-run/ingest flags | `EDM_QUALTRICS_INGEST_ENABLED`, `EDM_DELETE_SUCCESSFUL_QUALTRICS_SOURCE` | Parallel `EDM_QUALTRICS_RESPONSES_*` flags (default off) |

## 4. Drive layout
Leave V1 untouched: `External Data/Qualtrics/Inbox`, `…/Failed`. Add siblings under the same `Qualtrics` folder: `External Data/Qualtrics/Responses/Inbox` and `…/Responses/Failed` (`Responses` is a sibling of `Inbox`, so V1's `findCandidateCsv` — direct `.csv` children of `Inbox` — can never see it). Folder ids in new Script Properties (`QUALTRICS_RESPONSES_INBOX_FOLDER_ID`, `…_FAILED_FOLDER_ID`); ids never in Git. A later rename to `Qualtrics/InFlight/…` is optional and not needed.

## 5. Safety hole in V1 to close (separately authorized change)
V1 `validateSchema` only checks missing columns; the two dashboard exports share all 288 columns. A Responses file placed in the InFlight Inbox would be dedupe'd by `(survey_id, contact_id)`, routed (`Government`/`Higher Ed & Student` are not in V1's route table, so those rows should fail validation; whether the whole file then fails or `US Healthcare` rows alone proceed was not verified) and could **full-replace `CSAT_InFlight`** with response-derived rows. Add to V1 validation: all rows `_sourceType = des-qds` and `Survey_ID` starts `SV_`. This is a V1 change → needs Jeff's explicit authorization and its own release; until then, operator discipline + separate folders.

## 6. Operator procedure (two independent files)
1. Export InFlight CSV → drop in `Qualtrics/Inbox`. 2. Export Responses CSV → drop in `Qualtrics/Responses/Inbox`. Either, either order, either alone. Each pipeline succeeds/fails/cleans up independently; failures land in their own `Failed`. No batch correlation required; the ledger's timestamps are sufficient for audit.

## 7. Scheduling
Stage 1 (R2): keep V1 trigger untouched; run Responses by manual/controlled-ops entry point (`runEdmQualtricsResponsesInboxNow`) for validation. Stage 2: replace the single trigger handler with a generic `runEdmPipelinesScheduled` that loops configured pipeline descriptors, each in its own try/catch (V1 first, so a Responses failure can never starve InFlight). The "exactly one trigger / disallowed handlers" guard in `EdmControlledOps` must be updated in the same release. Capacity registers as the third descriptor. Triggers are production mutations — each swap needs explicit authorization.

## 8. Failure isolation
A Responses failure never touches `CSAT_InFlight`, V1 flags, or V1 Failed folder. A DepMngr ingest failure restores the prior `CSAT_Responses` content (snapshot/verify/rollback as in the safe replace).

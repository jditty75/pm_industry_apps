# Production deployment log

Append-only release records. Deployment IDs match per-app `gas.config.json` (not Script IDs).

### 2026-10-07 — External_Data_Manager — Qualtrics Responses operating loop (HEAD push)

- Authorization: user (VOC Responses automation fix, 2026-10-07)
- Git source: (pending commit on `main`)
- GAS: `clasp push` to EDM HEAD — shared scheduler runs InFlight then Responses; Responses run policy/logging; `runEdmSetQualtricsResponsesDeleteSuccessfulSource`
- Local verification: EDM **84/84** tests
- Production runtime verification: not performed (Execution API / `clasp run` **403**); editor handoff for property enable + one-shot ingest
- Result: partial (HEAD updated; production ingest/properties not verified from agent)

### 2026-10-07 — DepMngr CoreLib 161 — shared VoC platform (library cut)

- Authorization: user (Shared VoC Platform PRODUCTION RELEASE, 2026-10-07)
- Git source: `408c99c`
- Library: CoreLib **161** — `feat(voc): shared cohort-aware Voice of the Customer platform`
- Previous immutable library version: **160**
- Rollback library version: **160**
- Consumer pin updates (this release): SLG_DM **160 → 161**; HC_DM **146 → 161**; HENP_DM **146 → 161**
- Unchanged at CoreLib **146**: EVI_DM, PDX_DM, HS_DM (VoC hidden; no push/deploy)
- Verification: DepMngr **221/221** local tests; library release selftest PASS; SLG/HC/HENP preview structural PASS; `clasp push` library + consumers; immutable **161** verified via `clasp versions`
- Result: success (library cut; consumer deploys below)

### 2026-10-07 — SLG_DM — deploy (shared VoC platform CoreLib 161)

- Authorization: user (Shared VoC Platform PRODUCTION RELEASE, 2026-10-07)
- Git source: `408c99c` (manifest pin; library **161**)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: **206**
- Live GAS version: **207**
- CoreLib: **161**
- Description: feat(voc): shared VoC platform; canonical exposed label VoC; Deployment Intelligence unchanged
- Verification: structural preview PASS; production browser SSO smoke not automated (Workday domain)
- Result: success

### 2026-10-07 — HC_DM — deploy (shared VoC platform CoreLib 161)

- Authorization: user (Shared VoC Platform PRODUCTION RELEASE, 2026-10-07)
- Git source: `408c99c` (manifest pin; library **161**)
- Deployment ID: `AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA`
- Previous GAS version: **88**
- Live GAS version: **89**
- CoreLib: **161**
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA/exec
- Description: feat(voc): Healthcare VoC exposure (Upcoming / In-Flight / Responses / Administration)
- Verification: structural preview PASS; production interactive VoC RPC smoke requires Jeff browser (SSO)
- Result: success

### 2026-10-07 — HENP_DM — deploy (shared VoC platform CoreLib 161)

- Authorization: user (Shared VoC Platform PRODUCTION RELEASE, 2026-10-07)
- Git source: `408c99c` (manifest pin; library **161**)
- Deployment ID: `AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ`
- Previous GAS version: **109**
- Live GAS version: **110**
- CoreLib: **161**
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ/exec
- Description: feat(voc): HENP VoC exposure (four subtabs)
- Verification: structural preview PASS; production browser SSO smoke not automated
- Result: success

### 2026-10-07 — SLG_DM — deploy (Signals GAS transport DTO)

- Authorization: user (Signals UI FINAL proven GAS serialization fix, 2026-10-07)
- Git source: `c6c976c`
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: **204**
- Live GAS version: **206**
- CoreLib: **160** (`fix(signals): normalize landing UI DTO dates for GAS transport`)
- Description: fix(signals): ISO-string normalize Signal landing/run UI DTO dates at transport boundary
- Verification: DepMngr **204/204** local tests; SLG preview structural PASS; library release selftest PASS; production browser RPC smoke pending Jeff
- Result: success

### 2026-10-07 — SLG_DM — deploy (Deployment Intelligence v1)

- Authorization: user (DI v1 bounded implementation — Signals scope + scheduled notification engine, 2026-10-07)
- Git source: `4d6bf0b`
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: **203**
- Live GAS version: **204**
- CoreLib: **159** (`DI v1: Signals unscoped RPC + scheduled notification dispatch`)
- Description: feat(di-v1): unscoped Signals landing RPC; CoreNotify.runScheduledNotificationDispatch; SLG hourly dispatcher trigger installer
- Verification: DepMngr **203/203** local tests; SLG preview structural PASS; GAS triggers not installed; no email/Slack sent
- Result: success

### 2026-10-07 — SLG_DM — deploy (Signals UI client binding)

- Authorization: user (Deployment Signals UI client data-binding regression, 2026-10-07)
- Git source: `97348a6` (CoreLib client binding) / SLG pin to CoreLib **158**
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: **201**
- Live GAS version: **203**
- CoreLib: **158** (`Signals UI client landing normalization`, git 97348a6)
- Description: fix(signals): bind Deployment Signals UI to server landing payload
- Verification: DepMngr **184/184** local tests; SLG preview structural PASS; production browser smoke pending Jeff
- Result: success

### 2026-10-07 — SLG_DM — deploy

- Authorization: user (Deployment Signals UI worklist regression pass, 2026-10-07)
- Git source: `86e0536` (SLG pin) / `e8f5024` (CoreLib fix)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: **200**
- Live GAS version: **201**
- CoreLib: **157** (`Signals UI scope matching`, git e8f5024)
- Description: fix(signals): restore UI worklist via canonical deployment scope matching
- Verification: DepMngr **179/179** local tests; production browser smoke not run (Execution API unavailable)
- Result: success

### 2026-10-05 — CSAT Responses SLG storage canary — **VERIFIED (editor runtime)**

- Authorization: prior SLG first-write authorization (2026-10-05)
- Production evidence (counts only): source **177**; SLG routed **28**; stored **26**; excluded **2**; first ingest inserted **26** / updated **0**; second ingest inserted **0** / updated **0**; `CSAT_Responses` present in SLG; both jobs **SUCCESS**
- Idempotency: second pass produced no inserts/updates; stored row count **26** unchanged (storage verification; `unchanged` not logged on job)
- Exclusions: consistent with deployment-not-in-universe (**2**); eligibility not weakened
- Git hardening (separate commit on `main`): workbook context for DD contacts; sanitized eligibility/storage audit APIs; SLG acceptance helper; tests/docs — **no** CoreLib 147 cut, **no** EDM push in close-out
- Still OFF: source deletion; Responses scheduling; HC/HENP ingest; InFlight scheduler unchanged
- See `docs/agent/csat-responses-storage-canary.md`

### 2026-10-05 — CSAT Responses SLG storage canary — **STOPPED (runtime blocked)**

- Authorization: user (CSAT Responses SLG storage canary, 2026-10-05; includes EDM HEAD push)
- Pre-push gates (local): EDM **63/63**; cross-feed classifier **4/4**; validated 177-row Responses CSV dry-run **177 / 77 / 28 / 72**
- EDM GAS: `clasp push` (HEAD) — Responses SLG-scoped ingest (`limitDestinationAppIds`), Responses ledger append, verify/bootstrap helpers, `runEdmCsatResponsesSlgStorageCanaryNow`
- API executable deployment **@4** (orchestrator); CoreLib pin **146** `developmentMode: false` (unchanged)
- Remote execution: **blocked** — `scripts.run` / `clasp run` → **403 PERMISSION_DENIED** (GCP project / Execution API alignment; same as Qualtrics V1 activation)
- Not performed in GAS: Responses Drive property setup; Responses Inbox CSV placement; real dry-run; SLG eligibility; `CSAT_Responses` bootstrap; first ingest; idempotency; production InFlight trigger verify
- Editor unblock: run `runEdmCsatResponsesSlgStorageCanaryNow()` after placing validated Responses CSV in Responses/Inbox (or stepwise helpers in `docs/agent/csat-responses-storage-canary.md`)
- Git: pending commit for EDM canary helpers
- HC/HENP ingest, Responses scheduling, source deletion: **not performed** (per authorization)

### 2026-10-05 — DepMngr CoreLib 146 — fleet pin + DM production deploy

- Authorization: user (`Execute the DepMngr release plan`, 2026-10-05)
- Git source: `ff86b23` (library) + manifest pin bumps (pending commit)
- Library: DepMngr immutable **146** — CSAT Responses storage (`ingestCsatResponses`, bootstrap, Active+Complete eligibility)
- Rollback library version: **145**
- Consumer pins: all `*_DM` **139/144 → 146**; External_Data_Manager **145 → 146**
- Production deployments (Deployment IDs unchanged): SLG_DM **@196**, HC_DM **@88**, HENP_DM **@109**, EVI_DM **@30**, PDX_DM **@4**, HS_DM **@21**
- EDM: `clasp push --force` to HEAD (includes Qualtrics R1.5 InFlight classifier + Responses pipeline source); **no** new clasp deploy entry
- Verification: DepMngr `npm test` 11/11; production browser smoke not performed
- Result: success (library cut + DM deploys; EDM HEAD updated)
- Not performed: Responses Drive setup; CSAT_Responses sheet bootstrap; Responses ingest

### 2026-10-05 — External_Data_Manager — Qualtrics V1 production activation (partial)

- Authorization: user (EDM Qualtrics V1 final production activation, 2026-10-05)
- Git source: pending commit (activation helpers + duplicate Failed-folder guard + runbook)
- GAS: `clasp push --force` to EDM HEAD (CoreLib **145** pin unchanged)
- Entry point: `runEdmQualtricsV1ProductionActivationNow()` — sets ingest + delete properties, idempotent 15-minute trigger, verified first-source cleanup, synthetic fixture removal, empty-Inbox no-op
- Remote execution: **not completed** — Apps Script `scripts.run` and `clasp run` return **403 PERMISSION_DENIED** (API executable / Execution API not usable from automation)
- Drive preflight (read-only): Qualtrics Inbox contains the verified full-dashboard export plus `synthetic-qualtrics-dryrun.csv` (activation removes both after duplicate guard)
- First real ingest + HENP CSAT: user-verified in prior session (596→220 populations; HC 40 / SLG 19 / HENP 37 written)
- Production script properties / trigger / post-activation Inbox empty: **requires one GAS editor run** of activation entry point
- Result: **partial** (source pushed; runtime activation pending editor)
- Not performed: CoreLib 146; DM pin bump to 145; second real Qualtrics ingest; EVI/PDX/HS changes

### 2026-10-05 — HENP_DM — deploy

- Git source: `aa22987` (HENP CSAT tab UI config only; CoreLib pin unchanged @144)
- Deployment ID: `AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ`
- Previous GAS version: 107
- Live GAS version: 108
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ/exec
- Description: HENP CSAT tab enablement (git aa22987)
- Verification: `preview_selftest.py` PASS pre-deploy; production CSAT tab browser smoke not performed from agent
- Result: success
- Authorized by: User (Authorize HENP_DM production deployment for CSAT enablement at git aa22987, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com
- Not performed: Qualtrics re-ingest; CoreLib change; EDM automation activation

### 2026-10-05 — DepMngr CoreLib 145 (EDM external CSAT ingest) — library cut

- Library: CoreLib **145** — tenant filter + sheet replace run under `spreadsheetId` override; script lock when EDM opens destination workbook
- Consumer pin: **External_Data_Manager only** @145; **HC/SLG/HENP DM remain @144** (no DM deploy)
- Root cause of failed first ingest @144: `_buildCsatStorageFromParsed_` ran before override (`getActiveSpreadsheet()` null); `getDocumentLock()` invalid from standalone EDM
- EDM: shared-drive safe `moveToFailed` + keep source in Inbox when move fails
- Result: pushed library + EDM HEAD; **re-run** `runEdmAuthorizedFirstRealIngestionNow()` in editor after pull

### 2026-10-05 — External_Data_Manager — first real Qualtrics ingest (attempt; editor)

- Authorization: user (Authorize EDM Qualtrics V1 first real ingestion, 2026-10-05)
- GAS: `clasp push --force` (HEAD); API executable deployment **@2** repointed (not a DM/CoreLib release)
- Entry point: `runEdmAuthorizedFirstRealIngestionNow()` (preflight + single ingest + ingest flag off in `finally`)
- Remote `scripts.run` / `clasp run`: still **blocked** (403 / permission) from automation
- Local preflight (Inbox `PGLandMDS…de647ecf…` CSV): validate ok; checksum prefix `8545dbf0510b0d55`; pipeline **597** source rows → **220** normalized populations (**86** HC / **134** SLED); destinations dry-run **86 / 134 / 134**
- Editor execution: user reports **failed** (`ok:false`); Inbox source **still present** (deletion off); awaiting pasted execution JSON for root cause
- Production CSAT mutation: **not verified** from this environment
- Ingest property / delete flag / trigger: **not verified** post-run (needs pasted result or GAS verify helpers)

### 2026-10-05 — External_Data_Manager — CLASP push (non-production)

- Git source: (EDM Qualtrics V1 pre-ingestion pass)
- Change: pin CoreLib **144** immutable; operational verify helpers; qualtrics CSV local validator
- GAS: `clasp push --force` to existing EDM standalone project (no new deployment)
- Production impact: none (ingest property remains off; no trigger)
- Apps Script Execution API: remote `scripts.run` still **403 PERMISSION_DENIED** from automation; use GAS editor for `runEdmVerifyOperationalState` / `runEdmDestinationCsatBaselineSummary` until API access is granted
- Result: success (HEAD updated)

### 2026-10-05 — HENP_DM — deploy

- Git source: `73f37fb` (CoreLib 144 CSAT pin + push; clasp push `--force` after skip)
- Deployment ID: `AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ`
- Previous GAS version: 106
- Live GAS version: 107
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ/exec
- Description: CoreLib 144 CSAT canonical ingestCsatInFlight (git 73f37fb)
- Verification: DepMngr `npm test` pass; `preview_selftest.py` pass; production browser smoke not performed
- Result: success
- Authorized by: User (Execute DepMngr CoreLib 144 release scoped to SLG/HC/HENP, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — HC_DM — deploy

- Git source: `73f37fb` (CoreLib 144 CSAT pin + push; clasp push `--force` after skip)
- Deployment ID: `AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA`
- Previous GAS version: 86
- Live GAS version: 87
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA/exec
- Description: CoreLib 144 CSAT canonical ingestCsatInFlight (git 73f37fb)
- Verification: DepMngr `npm test` pass; `preview_selftest.py` pass; production browser smoke not performed
- Result: success
- Authorized by: User (Execute DepMngr CoreLib 144 release scoped to SLG/HC/HENP, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — SLG_DM — deploy

- Git source: `73f37fb` (CoreLib 144 CSAT pin + push; clasp push `--force` after skip)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 194
- Live GAS version: 195
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: CoreLib 144 CSAT canonical ingestCsatInFlight (git 73f37fb)
- Verification: DepMngr `npm test` pass; `preview_selftest.py` pass; production browser smoke not performed
- Result: success
- Authorized by: User (Execute DepMngr CoreLib 144 release scoped to SLG/HC/HENP, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — DepMngr CoreLib 144 (CSAT canonical ingest) — library cut

- Library: CoreLib **144** (git `73f37fb` / feature `2f8f8e6`)
- Consumers deployed: **SLG_DM @195**, **HC_DM @87**, **HENP_DM @107**
- Unchanged pins: **EVI_DM @139**, **PDX_DM @139**, **HS_DM @139**
- Ledger: `.ai/library-releases/depmngr.jsonl`
- Result: success

### 2026-10-05 — DepMngr CoreLib 143 (Notable Active+Complete) — production verification

- Library: CoreLib **143** (git `9c429a0`)
- Consumers verified in production: **SLG_DM @194**, **HC_DM @86**, **HENP_DM @106**
- Verification: **PRODUCTION VERIFIED** — Notable Active+Complete release (user attestation, 2026-10-05)
- Result: success
- Ledger: appended `production_verified` to `.ai/library-releases/depmngr.jsonl`

### 2026-10-05 — HENP_DM — deploy

- Git source: `9c429a0` (CoreLib 143 Notable Active+Complete pin + push; clasp push `--force` after skip)
- Deployment ID: `AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ`
- Previous GAS version: 105
- Live GAS version: 106
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ/exec
- Description: Notable Active+Complete CoreLib 143 (git 9c429a0)
- Verification: pre-release automated Notable + visual acceptance; **production verification passed** (Notable Active+Complete, user attestation 2026-10-05)
- Result: success
- Authorized by: User (Execute notable active plus complete release plan CoreLib 143, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — HC_DM — deploy

- Git source: `9c429a0` (CoreLib 143 Notable Active+Complete pin + push; clasp push `--force` after skip)
- Deployment ID: `AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA`
- Previous GAS version: 85
- Live GAS version: 86
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA/exec
- Description: Notable Active+Complete CoreLib 143 (git 9c429a0)
- Verification: pre-release automated Notable + visual acceptance; **production verification passed** (Notable Active+Complete, user attestation 2026-10-05)
- Result: success
- Authorized by: User (Execute notable active plus complete release plan CoreLib 143, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — SLG_DM — deploy

- Git source: `9c429a0` (CoreLib 143 Notable Active+Complete pin + push; clasp push `--force` after skip)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 193
- Live GAS version: 194
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: Notable Active+Complete CoreLib 143 (git 9c429a0)
- Verification: pre-release automated Notable + visual acceptance; **production verification passed** (Notable Active+Complete, user attestation 2026-10-05)
- Result: success
- Authorized by: User (Execute notable active plus complete release plan CoreLib 143, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — HENP_DM — deploy

- Git source: `0fff3c6` (CoreLib 142 cumulative consumer pin + push)
- Deployment ID: `AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ`
- Previous GAS version: 104
- Live GAS version: 105
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbz8eIK0zeEGStLFbs7m_juC_0kf_IDswxLP1SSPZizk_SWP3S8fnTGPhv9M-ahhDBXqAQ/exec
- Description: CoreLib 142 cumulative HENP (git 0fff3c6)
- Verification: `preview_selftest.py` PASS; live Notable/Escalations browser smoke not performed
- Result: success
- Authorized by: User (Execute DepMngr release plan CoreLib 142 cumulative, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — HC_DM — deploy

- Git source: `0fff3c6` (CoreLib 142 cumulative consumer pin + push)
- Deployment ID: `AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA`
- Previous GAS version: 84
- Live GAS version: 85
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbzPyDHuZsIe5-CB3guXVU57Ow0NfjhuEKZK8TZMi4UzG3_nyVtJI1fjBX53aBf57XZKVA/exec
- Description: CoreLib 142 cumulative HC (git 0fff3c6)
- Verification: `preview_selftest.py` PASS; live Notable/Escalations browser smoke not performed
- Result: success
- Authorized by: User (Execute DepMngr release plan CoreLib 142 cumulative, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — SLG_DM — deploy

- Git source: `0fff3c6` (CoreLib 142 cumulative consumer pin + push; SLG consumer push used `--force` after clasp skip)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 192
- Live GAS version: 193
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: CoreLib 142 cumulative SLG (git 0fff3c6)
- Verification: `preview_selftest.py` PASS; live Notable/Escalations browser smoke not performed
- Result: success
- Authorized by: User (Execute DepMngr release plan CoreLib 142 cumulative, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — SLG_DM — deploy

- Git source: `c96847d` (CoreLib v139 consumer pin baseline; staged manifest-only clasp push)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 191
- Live GAS version: 192
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: CoreLib v139 baseline pin normalization (immutable 139, exit developmentMode HEAD)
- Verification: staged push verified SLG Code.js without `_debugNotableDataPipeline`; production deploy completed
- Result: success
- Authorized by: User (execute DM CoreLib 139 baseline migration, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — EVI_DM — deploy

- Git source: `c96847d` (CoreLib v139 consumer pin baseline; staged manifest-only clasp push)
- Deployment ID: `AKfycbw1I6aXuRrWblrCnyMOMvpTULaDs_Ib_gPVwxiP4slmddTGXflY5BWqgMoZhaC3ltUfeA`
- Previous GAS version: 28
- Live GAS version: 29
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbw1I6aXuRrWblrCnyMOMvpTULaDs_Ib_gPVwxiP4slmddTGXflY5BWqgMoZhaC3ltUfeA/exec
- Description: CoreLib v139 baseline pin normalization (EVI rollback CoreLib pin baseline remains 113)
- Verification: staged manifest-only push; production deploy completed
- Result: success
- Authorized by: User (execute DM CoreLib 139 baseline migration, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-02 — SLED_Marketing — deploy

- Git source: `f9fe0aa` (`docs(sled-marketing): clarify runSelfTest is editor-only`)
- Deployment ID: `AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun`
- Previous GAS version: 4
- Live GAS version: 5
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun/exec
- Description: Production: docs(sled-marketing) runSelfTest JSDoc (git f9fe0aa)
- Verification: per user-authorized production deploy workflow
- Result: success
- Authorized by: User (explicit deploy request, 2026-10-02)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-02 — SLED_Marketing — rollback

- Git source: `f9fe0aa` (unchanged on `main`; rollback did not revert Git)
- Deployment ID: `AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun`
- Previous GAS version: 5 (production had served git `f9fe0aa` source at deployment @5)
- Live GAS version: 4
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun/exec
- Description: Rollback: restore Apps Script version 4 (pre git f9fe0aa prod @5)
- Verification: per user-authorized rollback workflow
- Result: success
- Note: Apps Script **HEAD** / development source was not reverted by this rollback; only the configured production deployment was repointed.
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-07 — SLG_DM — deploy

- Git source: `d270121` (+ CoreNotify NotificationConfig seed for Deployment Intelligence weekly rule; GAS CoreLib 154)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 197
- Live GAS version: 198
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: Deployment Intelligence v1 activation — CoreLib pin 154 (scoped SLG only)
- Verification: DepMngr 165/165 local; SLG clasp push; production deploy @198; workbook baseline finalization deferred to bound-script editor (container requires active spreadsheet)
- Result: partial (deploy complete; intelligence workbook steps pending editor)
- Authorized by: User (Deployment Intelligence v1 production activation task, 2026-10-07)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-07 — SLG_DM — deploy

- Git source: `2854777` (Deployment Intelligence reconciliation — CoreLib 155)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 198
- Live GAS version: 199
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: Intelligence reconciliation (MTP/stewardship/context batch), auto-finalize, repair + test-email helpers; CoreLib pin 155 (scoped SLG only)
- Verification: DepMngr 170/170 local; library release self-test OK; SLG clasp push + production deploy @199; baseline repair deferred to bound editor
- Result: partial (deploy complete; workbook baseline repair + test email pending editor)
- Authorized by: User (Deployment Intelligence v1 production activation task, 2026-10-07)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-07 — SLG_DM — deploy

- Git source: `771b4ea` (Signals web app JS parse + investigation deep links — CoreLib 156)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 199
- Live GAS version: 200
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: Fix CoreUI Signals detail HTML string break; honor `tab=signals` deep links; CoreLib pin 156 (scoped SLG only)
- Verification: DepMngr 175/175 local; SLG preview structural PASS; clasp push + production deploy @200
- Result: success (deploy complete; browser smoke pending)
- Authorized by: User (SLG DM production regression fix, 2026-10-07)
- CLASP user: jeffrey.ditty@workday.com

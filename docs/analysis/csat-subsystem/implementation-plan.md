# Implementation Plan, Decisions, Risks

## Sequence (contract-first vertical slices)
| Phase | Scope | Exit evidence | Production impact |
|---|---|---|---|
| **R1 Contract approval** | Approve grain/key, 60-field model, score rules, upsert, routing, universe rule (D5), identity (D3), backup (D4). Produce machine-readable `csat-response-v1.schema.json` + synthetic golden fixtures (≥12 rows incl. dup headers, legacy scale, multi-area, blanks, injection strings) | Jeff sign-off | none |
| **R2 EDM transformer + DepMngr storage** | `QualtricsResponses*` EDM modules (pure, Node-tested against synthetic fixtures + a local-only real-file harness reporting counts), pipeline descriptor refactor with V1 behavior-identical, `CoreCsatResponses.js` (pure) + `ingestCsatResponses`, `CSAT_Responses` sheet bootstrap helper, ledger columns, pipeline-filtered prior jobs, Drive folders + properties via controlled-ops, dry-run on one real file → one destination (HENP first, smallest blast radius) | dry-run counts match source (177 in, per-destination 77/28/72, 0 unexpected rejects); idempotent re-run = all `unchanged`; rollback test | needs releases of CoreLib + EDM, pins, Drive/Script-Property/sheet creation — **each requires explicit Jeff authorization at the time** |
| **R3 Server API + preview** | DTO functions §8, wrappers, preview scenarios, tests | preview scenarios render DTOs; READ_ONLY gets nothing | CoreLib release |
| **R4 First UI** | Overview + Responses sub-tabs, deployment timeline component, gates default off, enable for one app | gated rollout | per-app config change |
| **R5 Customer Feedback + analytics** | comments, themes, trends, suppression rules | – | gated |
| **R6 AI insights** | `CSAT_AI_Insights`, agent | – | decision D6 first |
| Parallel/after | generic scheduler (single trigger → pipeline loop), V1 content guard (edm-responses-boundary §5), `uploadCsatInFlightCsvForUI` server guard | – | each separately authorized |

R1 is sufficiently resolved to start **R2 after Jeff answers D1–D5**; D3/D4/D5 change field lists/behavior, the rest are refinements.

## Decisions required from Jeff (product/business only)
| # | Decision | Options | Recommendation | Consequence |
|---|---|---|---|---|
| D1 | Which satisfaction is "the" headline when Overall ≠ PGL/MDS-specific (≈4%) | Overall / survey-specific | Overall for cross-survey KPI, survey-specific on survey tabs | Defines KPI tiles |
| D2 | Overlapping product areas (Financials vs Financial Management, Planning vs Adaptive, Core HCM vs HCM, Talent Optimization vs Talent Management, Prism vs Analytics & Reporting): merge into groups? | merge / keep distinct | merge via editable alias map, keep raw list | Area charts comparable vs literal |
| D3 | Store respondent identity (name/email/contact id)? | none / role+hash / full | role + hash only; add identity later behind ADMIN gate if needed | Privacy surface; "who said it" unavailable in V1 |
| D4 | Retain raw Responses CSV backup in Drive? | none / restricted folder | none (EDM deletes source on success; sheet is the record) | Lose file-level restore |
| D5 | Out-of-universe responses (deployment not in SFDC master) | drop / quarantine sheet | drop + count | Orphan history lost |
| D6 | Permission for comments (T2) and AI use of comments | all power users / ADMIN+own portfolio; approved model only | own-portfolio for DD/VP, ADMIN all; internal model only | Who sees raw customer words |
| D7 | Enable order across apps | HENP→HC→SLG; EVI/PDX/HS later | HENP first | Rollout risk |

## Risks / unresolved technical questions
1. Export window rule of the Responses dashboard filter is unknown (oldest row 2025-11); a narrower filter later is harmless (retention), a wider one back-fills.
2. Header `Survey_ID` semantics differ by export; file-type confusion risk (§5 of edm boundary).
3. Column positions/duplicates in the dashboard can change; positional signature check will fail closed.
4. Text-analytics duplicate blocks: which twin is populated may flip; coalescing handles it.
5. No row version → corrected responses/text re-analysis detected only by `row_hash` diff.
6. Qualtrics topic strings contain commas; raw string retained, only parent topics split.
7. HC universe rule differs (Active-only) — new function must not reuse `_csatAllowedDeploymentIds_`.
8. DM apps on CoreLib 139 (EVI/PDX/HS) cannot get Responses until re-pinned; HC/SLG/HENP are on 144 and need a new release.
9. Ledger widening touches the shared audit sheet; additive columns only.
10. `Alert_type` semantics and 7 blank Overall values need a Qualtrics-owner answer (nice-to-have).
11. Verify in R3: whether in-flight/personalization view-mode filtering applies server-side; what the deployment detail host is.
12. Sample is a single export; schema drift checks should run on every file.

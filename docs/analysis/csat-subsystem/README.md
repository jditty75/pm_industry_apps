# CSAT Subsystem — Architecture Discovery (Responses)

Status: **design only, 2026-10-05.** No runtime code, config, workbook, Drive, trigger or deployment was changed.
Evidence basis: one real Qualtrics Responses export (schema + aggregate counts only), one InFlight export of the same dashboard, current `libraries/DepMngr` and `solutions/External_Data_Manager` source. **No production values (names, emails, accounts, comments, IDs) appear in these documents.**

Design order (deliberate): Qualtrics source analysis → DepMngr canonical Responses model → EDM transformation contract → storage/upsert → server APIs → preview → UI → automation.

| Doc | Purpose |
|---|---|
| [qualtrics-responses-contract.md](qualtrics-responses-contract.md) | What the source file is: grain, keys, export semantics, scores, product areas, free text, analytics, routing, InFlight join |
| [source-field-classification.json](source-field-classification.json) | All 288 source columns classified (positional, schema + counts only) |
| [canonical-response-model.md](canonical-response-model.md) | The `CSAT_Responses` contract: fields, types, semantics, upsert, storage |
| [csat-current-state.md](csat-current-state.md) | Traced inventory of today's CSAT + keep/refactor classification |
| [csat-ui-architecture.md](csat-ui-architecture.md) | Subsystem IA, portfolio/deployment/feedback UX, gates, access, preview, scale |
| [edm-responses-boundary.md](edm-responses-boundary.md) | EDM↔DepMngr contract, pipeline, Drive, scheduling, audit |
| [csat-ai-future.md](csat-ai-future.md) | Separate AI-derived store (`CSAT_AI_Insights`), provenance rules |
| [implementation-plan.md](implementation-plan.md) | R1–R6 sequence, decisions for Jeff, risks |

Headline findings (details in the docs):
1. Responses grain = **one completed Qualtrics response**. Key = the `R_…` Qualtrics ResponseID, which sits in the column headed **`Survey_ID`** in this export (the header is misleading; the InFlight export uses the same header for the real `SV_…` survey id).
2. Both exports are the *same 288-column dashboard export* with different filters. A Responses file dropped into the V1 InFlight Inbox would pass V1's column check and **replace `CSAT_InFlight` with completed responses** — a content guard is needed (see edm-responses-boundary.md).
3. Joins to InFlight: ResponseID is reliable where InFlight has it (67/67), Contact_ID is unsafe (0/67 equal), deployment+survey type is deployment-level only.
4. Current `ingestCsatInFlight` is clear-and-replace and tenant-filters to *Active* deployments for HC; Responses need historical upsert and a different universe rule.

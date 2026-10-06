# CSAT Subsystem — Information Architecture, UX, Access, Gates, Preview, Scale

> **Status 2026-10-06:** §1 (sub-area shape) is superseded by the navigation in [../dm-ux/csat-reconciled-architecture/navigation-and-overview.md](../dm-ux/csat-reconciled-architecture/navigation-and-overview.md). §3–§9 (deployment experience, feedback, access tiers, gates, preview, API, scale) remain authoritative.

## 1. Shape
CSAT becomes a small subsystem with one shared data-access layer and four sub-areas (labels not final):

| Sub-area | Source | Status |
|---|---|---|
| **Overview** | Responses aggregates + InFlight KPIs side by side | new (R4) |
| **Upcoming** (today's *Batches*) | batch engine | keep as is |
| **Survey Tracking** (today's *In-Flight* + *Upload*) | `CSAT_InFlight` | keep; relabel/regroup only |
| **Responses** | `CSAT_Responses` scores + filters, drill-in | new (R4) |
| **Customer Feedback** | comments + Qualtrics themes | new (R5), separately gated |
| **Notifications** (rules + log) | existing | keep; later moves under a settings affordance |

InFlight stays coherent as "did the survey go out and get answered?"; Responses answers "what did they say?". They never share a sheet or a row.

## 2. Portfolio experience
**Useful now (R4):** KPI strip — responses (n), Overall Satisfaction mean + % favorable (4–5), NPS (PGL, with n and low-n flag), MDS vs PGL side-by-side tiles; monthly trend (response count + mean Overall); filters: survey type, date range, industry/app (implicit), product-area group, services approach, deployment type/stage-at-response, partner type; table of responses (scores only, no comments). Response rate only inside InFlight's window and only where `response_id` links (RELIABLE join) — otherwise show "n/a", never a fabricated denominator.
**Later (R5+):** aspect/team heat-grid, sentiment mix and top parent topics, theme trends, correlation to deployment health/risk, detractor watch-list, partner/services-approach comparisons with minimum-n suppression.
Rules: never blend PGL and MDS satisfaction; per-product-area counts are non-additive (label them "responses touching area"); suppress cells with n < 5.

## 3. Deployment-level experience
Shared component `csatResponseTimeline(deploymentId)`: chronological MDS→PGL events, Overall/NPS/aspects as compact score chips, product areas, stage at response, role (not identity), sentiment/theme chips, expandable comments (permission-gated), and a "Survey tracking" line from InFlight at deployment level (latest status for that deployment+survey type; no pretend one-to-one). Hosted in **both** places: full view in CSAT › Responses (drill-in) and a compact "CSAT" section in the deployment detail surface (confirm host in R3), same component, same DTO. Deep link from deployment → CSAT filtered to that deployment.

## 4. Customer Feedback UX (R5)
Comment cards grouped by question (reasons, improve, working well, additional), with sentiment chip, parent-topic chips, account/deployment link; filters by sentiment, topic, survey, product area, date; "show more" expands beyond ~140 chars; AI summary slot (empty until R6) rendered above, visibly labelled *AI-generated* with generated-at/model; Qualtrics themes labelled *Qualtrics analysis*; verbatim labelled *Customer comment*. Three provenance badges, never merged.

## 5. Access (recommendation; no permission changes made)
Tiers, all enforced **server-side** (existing code hides UI only, and `uploadCsatInFlightCsvForUI` has no server guard):
- **T1 aggregates** (scores, counts, trends): POWER_USER and ADMIN, as CSAT today; READ_ONLY and `?viewAs=READ_ONLY` see none.
- **T2 comments & per-response detail**: new gate `csat.feedback.enabled` + role ≥ POWER_USER; consider limiting DD/VP to their portfolio (the personalization view-mode filter must be applied server-side; today in-flight rows may not be).
- **T3 respondent identity** (name/email/contact id): not stored in V1 (decision D3); if stored, ADMIN-only and excluded from CSV export.
- Cache aggregates only; never put comment text in CacheService or in notification payloads.
- Client CSV export of comments requires T2 and is audited by count.

## 6. Feature gates (existing convention: `ui.<feature>.enabled`, tab id in `ui.tabs`, `roleVisibility`)
```
ui.csat = { enabled, tracking:{enabled}, responses:{enabled}, feedback:{enabled}, aiInsights:{enabled} }
```
- Back-compat: effective `csat.enabled = ui.csatTab.enabled ?? ui.mgmPglTab.enabled` (existing alias; `mgmPglTab` keeps working, tab id `mgmPgl`→`csat` migration unchanged).
- Defaults: `tracking.enabled = enabled`; `responses`, `feedback`, `aiInsights` = **false**. Per-app flips ("enable Responses for EVI") are one-line config edits plus a deployment — and for EVI/PDX/HS the workbook needs `CSAT_Responses` plus an EDM destination first (data gate ≠ UI gate).
- Defense in depth: server endpoints check the gate; EDM only ingests to destinations enabled in the destination registry.

## 7. Preview architecture (before any UI)
Extend the existing `preview.ps1` scenario mechanism (profile `dm-depmngr-webapp`): add synthetic `CSAT_Responses` fixtures + mock handlers for `getCsatResponsesOverviewForUI`, `getCsatResponsesPageForUI`, `getCsatResponseDetailForUI`, `getCsatDeploymentResponsesForUI`, `getCsatFeedbackPageForUI`, `getCsatAiInsightsForUI` (placeholder). Scenarios: `responses-none`, `mixed-mds-pgl`, `high-sat`, `low-sat`, `mixed-sentiment`, `multi-history` (one deployment, 4 responses), `multi-product-area`, `missing-optional-scores`, `with-comments`, `with-topics`, `high-volume` (2,000 generated rows), `ai-placeholder`. All text generated from fixed lorem-style templates ("Synthetic comment 12 about scheduling"); no production-derived string; a repo check greps fixtures for `@` and for any token from the real export (done locally, not committed).

## 8. Server API contracts (google.script.run, via thin per-app wrappers → `CoreLib.CoreData`)
| Function | Returns | Gate |
|---|---|---|
| `getCsatResponsesOverviewForUI(viewOpts, filters)` | KPI strip, trend series, per-area counts (no text) | T1 |
| `getCsatResponsesPageForUI(viewOpts, filters, cursor, limit)` | rows: id, date, deployment, survey, scores, flags, sentiment chips | T1 |
| `getCsatResponseDetailForUI(viewOpts, responseId)` | one response incl. comments + analytics | T2 |
| `getCsatDeploymentResponsesForUI(viewOpts, deploymentId)` | timeline DTO (+ InFlight deployment-level status) | T1 (comments omitted unless T2) |
| `getCsatFeedbackPageForUI(viewOpts, filters, cursor, limit)` | comment cards (truncated) | T2 |
| `getCsatAiInsightsForUI(viewOpts, scope)` | latest ACTIVE insight(s) | T2 + `aiInsights` |
DTO rule: ids, enums, ints, ISO dates; no sheet row arrays; versioned `dtoVersion`.

## 9. Performance and scale
Volume: ≈177 responses over ≈11 months (≈190/yr now; plan for 300/yr). 5 years ≈ 1,000–1,500 rows across **all** apps combined; per workbook less. Row ≈ 60 cols; comments avg ≈ 0.5 KB, max ≈ 4 KB (cell limit 50k chars) → ≈ 1–3 MB per workbook at year 5. Full read of numeric columns for 1,500 rows is trivially fast; comments read lazily by `response_id`. A single sheet is appropriate until any of: > 5,000 rows, overview > 3 s cold, payload > 1 MB, or sheet > 20% of the 10M-cell workbook budget. Then: (1) add a PK→row index property/hidden sheet, (2) pre-aggregated `CSAT_Responses_Rollup`, (3) yearly archive sheets, (4) only then consider an external store. Upsert reads 2 columns only. Writes batched under lock.

# CSAT Product Model — Customer Satisfaction information architecture reset (2026-10-05)

> **Status update 2026-10-06: partially superseded** by [../csat-reconciled-architecture/](../csat-reconciled-architecture/README.md), which reconciles this model with the VoC *PGL and MDS Deployment Surveys Guidebook*. Still authoritative where [decision-reconciliation.md](../csat-reconciled-architecture/decision-reconciliation.md) marks **KEEP**: metric semantics, small-n rules, journey semantics, Product Area, T1/T2/T3, feedback placement, deployment CSAT history. **Superseded or invalidated:** P1 mean headline (→ Top-2 Box, pending J1), P2/R1/R2 risk thresholds (→ Detractor = DSAT ≤3 or NPS ≤6), P3 weighting, P9 (→ follow-up expectation shown), P10 and the `Overview | Responses | Survey Operations` navigation (→ `Overview | Surveys | Responses`), the secondary placement of Upcoming, and [visual-design-handoff.md](visual-design-handoff.md).

Status: **approved by Jeff as the basis for CSAT design (2026-10-06)**, with decisions P1–P10 resolved as recorded in [../csat-overview-v2/README.md](../csat-overview-v2/README.md#resolved-decisions-applied). Where a resolved decision differs from a recommendation below (notably P1 mean headline, P3 deployment-aware aggregation, P4 Workday-led default lens), the resolved decision wins. The one Overview design built from this model is [../csat-overview-v2/](../csat-overview-v2/README.md). Documentation only. No UI, CSS, markup, JS, prototype, API, EDM, workbook, CLASP or deployment change was made.

CSAT = **Customer Satisfaction**. The top-level DM feature stays **CSAT**. This folder defines *what CSAT should tell a Deployment Manager user* before any further visual design.

Supersedes for direction: the focused Overview compositions in [../csat-overview-design/](../csat-overview-design/README.md) (A/B/C) — **rejected for visual/information design — superseded by approved product model.** They are retained, not deleted.

## Evidence basis

- Data contracts: [canonical-response-model.md](../../csat-subsystem/canonical-response-model.md) (`csat-response-v1`), [qualtrics-responses-contract.md](../../csat-subsystem/qualtrics-responses-contract.md) (one real export, aggregates only), [csat-current-state.md](../../csat-subsystem/csat-current-state.md).
- Current source: `libraries/DepMngr/src/CoreData.js` (`getCsatTabDataForUI`, `_buildCsatInFlightKPIs_`, `_buildCsatHeaderSummary_`, `_normalizeCsatTrackingStatus_`, Responses ingest/upsert), `CoreCsatResponses.js` (column contract), `CoreUI_Markup.js` `_buildCsatTab_` (today's four CSAT sub-tabs).
- Prior architecture: [csat-ui-architecture.md](../../csat-subsystem/csat-ui-architecture.md), [csat-ai-future.md](../../csat-subsystem/csat-ai-future.md), [../csat-ux-requirements.md](../csat-ux-requirements.md), [../information-architecture.md](../information-architecture.md).
- No production values (names, accounts, comments, IDs) appear here. Counts are aggregates from the single analysed export (177 responses, 2025-11 → 2026-09) and the SLG storage canary.

## Executive product model

> **CSAT tells a Deployment Manager user what customers have said about our delivery at each survey point in the deployment lifecycle, how much of the portfolio that represents, and which customers' verdicts need follow-up.**

Five commitments follow from the data:

1. **CSAT is a small-numbers product.** Each DM app receives tens of responses a year, not thousands (sample: HC 77, HENP 72, SLG 28 over ~11 months; MDS 47 of 177 overall). At that volume each low score is an *event* about a named deployment. Most monthly trends are noise. The product should centre on evidence (individual verdicts in deployment context), with honest aggregates as summaries. It should not be built as a scoreboard.
2. **Satisfaction is always shown with its evidence base.** A satisfaction figure always comes with how many responses it rests on, how many deployments they came from, and how many deployments were due to be heard from. Coverage qualifies satisfaction. It is never blended into it or presented as an equal-weight KPI.
3. **MDS and PGL are two survey points on one journey.** Overall Satisfaction is the one cross-stage measure. Comparing stages at portfolio level compares *different deployments* (a cohort comparison). Only deployments surveyed at both points show a true journey, and those pairs are still sparse.
4. **Three kinds of attention are kept separate:** *satisfaction risk* (a customer told us something bad), *evidence gap* (we have not heard from a deployment that was due), and *survey operation issue* (the asking process is failing). One undifferentiated "Needs Attention" bucket would hide the difference.
5. **Customer words are the explanation layer, not a separate destination.** Comments answer "why" for a specific signal, deployment or slice. They are reached from those signals and browsed within Responses under T2. Qualtrics-derived sentiment and topics help users navigate the comments. They never stand in for them. AI output, when it exists, is a separate labelled layer.

Resulting CSAT navigation: **Overview | Responses | Survey Operations**, plus a shared **deployment CSAT history** that appears wherever a deployment is opened. See [navigation-model.md](navigation-model.md).

## Documents

| Doc | Content |
|---|---|
| [product-questions.md](product-questions.md) | The core question hierarchy and a Question → Evidence → Interpretation → Action model for each question |
| [metric-semantics.md](metric-semantics.md) | Outcome and driver classification, MDS→PGL semantics (observable/inferred/unsupported), Product Area, time, sample size, coverage vs satisfaction, analytical vocabulary |
| [data-to-insight-map.md](data-to-insight-map.md) | Data domains and their product roles, insight catalog by derivation class, attention-signal taxonomy, comments, Qualtrics analytics, AI role, future-data ideas |
| [information-hierarchy.md](information-hierarchy.md) | Monitor / Investigate / Operate, primary→detail hierarchy, portfolio vs deployment, T1/T2 per question, what NOT to show prominently |
| [navigation-model.md](navigation-model.md) | Derived section structure, alternatives rejected, semantic definitions of Overview, Responses, Survey Operations, Customer Feedback placement |
| [user-workflows.md](user-workflows.md) | Realistic analytical and operational flows through CSAT |
| [visual-design-handoff.md](visual-design-handoff.md) | What the next visual-design task should design, and with what inputs and acceptance criteria |

## Decisions required from Jeff

**Resolved 2026-10-06.** The table below keeps the original recommendations for traceability. The resolved outcomes, plus the new Workday-led management-lens requirement, are in [../csat-overview-v2/README.md](../csat-overview-v2/README.md#resolved-decisions-applied). On Overview, "drivers" are labelled **Delivery ratings**.

These are business and product decisions only. Each one has a recommendation. Earlier decisions D1–D7 in [implementation-plan.md](../../csat-subsystem/implementation-plan.md) still stand; this model settles D1 (Overall is the headline) and depends on D2 (Product Area groups) and D6 (T2 audience).

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| P1 | **Headline expression of satisfaction:** mean (1–5) or % satisfied (4–5) | **% satisfied with band counts** ("21 of 26 satisfied, 2 dissatisfied"), mean secondary. Override if the organization's official CSAT scorecard uses the mean | At small n, counts are more honest and readable than a two-decimal mean. Should match how the org already reports CSAT |
| P2 | **What counts as a satisfaction risk:** Overall ≤2 only, or also neutral 3; is an NPS detractor (0–6) a risk on its own? | Overall ≤2 = risk. 3 = visible in history but not flagged. NPS detractor = secondary signal, flagged only when Overall is not already ≤2 | Sets the size of the attention list. Too broad and the list becomes noise |
| P3 | **Weighting:** response-weighted or deployment-weighted portfolio figures (33 of 132 deployments have more than one response) | Response-weighted headline (matches Qualtrics). Deployment counts always shown; attention and journey work per deployment | A deployment with 4 stakeholders otherwise counts 4× |
| P4 | **Portfolio scope:** include partner-led deployments (PGL only) in the headline, or Workday-led only | Include all in-universe responses; priming partner type is a standing segment; MDS-vs-PGL cohort comparisons use **Workday-led only** | All MDS responses are Workday-led (47/0). Mixed-scope stage comparisons are confounded |
| P5 | **Direction rule:** when may CSAT say "improving/declining"? | Only when both compared windows have ≥10 responses for that survey stage; otherwise say "not enough responses to call a direction". Interim window 6 vs 6 months until 24 months of history exist | Prevents over-reading small movements |
| P6 | **T1 visibility of comment-derived signals** (sentiment flag, parent-topic counts) | T1 may see a "negative feedback present" flag and n-suppressed parent-topic counts; comment text stays T2 | Determines whether aggregate-only users can see theme patterns |
| P7 | **Respondent re-identification:** Survey Operations already shows contact name/email to POWER_USER. For a deployment with one respondent, that plus a Responses score reveals who gave the score | Accept for internal DM staff in V1, but **never** join InFlight contacts to `response_id` in the UI without a T3 decision | T3 "identity not stored" is not equivalent to "identity not inferable" |
| P8 | **Segmentation by engagement manager / partner name** | Allowed only in Responses and deployment context (not on Overview, no rankings), with n≥5 suppression | These comparisons evaluate named individuals and partners on very small n |
| P9 | **Follow-up tracking:** should CSAT record that someone followed up on a risk? | Not in V1; route action through existing Notable / Executive Watch. Revisit as `FUTURE_DATA_REQUIRED` | Without it, the attention list cannot distinguish handled from unhandled |
| P10 | Section label for the survey-process area | **Survey Operations** (alternative: Survey Tracking) | Low-stakes naming; the scope covers scheduling, tracking, reminders and import, not only tracking |

## Verification stance

Static reading of documents and source only. No data was queried for this pass. All counts come from the earlier analysis documents. Thresholds (n≥5, n≥10) are product rules, not statistical significance tests. Derived metrics marked `SAFE_DERIVATION` (notably *deployment coverage*) still need validation against real data before use.

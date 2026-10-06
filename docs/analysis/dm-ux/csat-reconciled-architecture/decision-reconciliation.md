# Decision reconciliation

Every decision in [../csat-product-model/](../csat-product-model/README.md) and [../csat-overview-v2/](../csat-overview-v2/README.md), with selected items from [../../csat-subsystem/](../../csat-subsystem/README.md), classified against the guidebook and the four objectives.

`KEEP` = still authoritative · `REFINE` = kept with a stated change · `SUPERSEDE` = replaced by this architecture · `INVALIDATED_BY_GUIDEBOOK` = conflicts with the VoC operating model. Where a decision needed Jeff (J#), the new position was the **recommendation** until he confirmed it. **Update 2026-10-06:** J1–J6 are approved (J5 with a refinement, J6 as a V1.1 priority; see [README](README.md#decisions-required-from-jeff)). Every "pending J#" position below is now authoritative.

## 1. Product-model commitments

| Item | Class | Authoritative position now |
|---|---|---|
| C1 CSAT is a small-numbers product; evidence over scoreboard | KEEP | Unchanged |
| C2 Satisfaction always with its evidence base | KEEP | Unchanged; coverage labelled "estimated due" until DG-10 |
| C3 MDS and PGL are two points on one journey; cohort comparison is not a journey | REFINE | Cohorts also differ by **eligibility** (>16 wks, Launch Now), not only leadership ([measurement §4](measurement-and-thresholds.md#4-cohort-comparability-mds-vs-pgl-workday-led-vs-partner-led)) |
| C4 Three kinds of attention (risk / evidence gap / survey operation issue) kept separate | REFINE | Five kinds, still never summed: **customer concern**, **follow-up expected**, **prepare now**, **chase now**, **evidence gap**. "Survey operation issue" splits into prepare/chase (EM-actionable) and settings issues (notification rules, stale import → Survey settings) |
| C5 Comments are the explanation layer, not a destination | KEEP | Unchanged |
| Executive statement "what customers have said … which verdicts need follow-up" | REFINE | Becomes the CSAT definition in [README](README.md), adding the pre-launch horizon and deployment-centric framing |

## 2. Product-model decisions P1–P10 (as resolved in V2)

| # | Resolved decision | Class | Authoritative position now |
|---|---|---|---|
| P1 | Headline = **mean** Overall (1–5) | **INVALIDATED_BY_GUIDEBOOK** (pending **J1**) | Programme measure is **Top-2 Box** (GB-41/47/57). Recommend Top-2 Box with counts as the headline; mean available in detail. Reverses Jeff's P1 → needs his confirmation |
| P2 | Risk triggers: Overall ≤2; deterioration; low rating; negative feedback | **INVALIDATED_BY_GUIDEBOOK** | Customer concern = **Detractor** response (DSAT ≤3 or NPS ≤6, GB-30) + MDS → PGL decline. Low delivery rating (≤2 with DSAT ≥4) and negative-sentiment flags move to **Responses lenses** (early-warning reading), not Overview attention |
| P3 | Deployment-weighted means | SUPERSEDE (pending **J2**) | Programme measure response-weighted (reconciles with Qualtrics) **plus** deployment state counts ([portfolio §1](portfolio-csat-model.md#1-two-kinds-of-portfolio-figure-never-confused)) |
| P4 | Include partner-led; default lens Workday-led | KEEP | Corroborated by Qualtrics Key Metrics default (GB-48) |
| P5 | Direction ≥10 per window | KEEP | Magnitude (V5) restated in Top-2 Box points if J1 accepted |
| P6 | T1 flag + suppressed topic counts; Overview T1-safe | REFINE | Overview carries **no** comment-derived flag (negative-feedback trigger removed with P2). T1 flag remains available in Responses |
| P7 | No respondent identity; no InFlight ↔ response join | KEEP | Lifecycle needs deployment-level linking only ([lifecycle §4](survey-lifecycle.md#4-csat_inflight-and-csat_responses-as-one-lifecycle)) |
| P8 | EM/partner segmentation only in Responses, n≥5 | KEEP | Note: "my deployments" scope for an EM is personalization, not segmentation, and is allowed |
| P9 | No follow-up tracking / case management in V1 | REFINE | Still no case management in DM. **New:** show the derived follow-up **expectation**, expected owner role and "tracked in Qualtrics" (GB-29–33). Status via CLFU export in V1.1 |
| P10 | Section label "Survey Operations" | **SUPERSEDE** (pending **J3**) | Section **Surveys**; admin content → Survey settings |

## 3. Product-model structures

| Item | Class | Position now |
|---|---|---|
| Navigation `Overview | Responses | Survey Operations` | SUPERSEDE (J3) | `Overview | Surveys | Responses` ([navigation](navigation-and-overview.md)) |
| Monitor / Investigate / Operate modes | REFINE | Still valid as reading modes; **Operate** is now EM-led Prepare + Monitor, homed in Surveys |
| Information hierarchy primary = satisfaction + risk | REFINE | Primary = Level 1 message (customer outcome + concern count + one-line horizon); Level 2 attention includes **Prepare** ([navigation §4](navigation-and-overview.md#4-executive-vs-operational-hierarchy-progressive-disclosure)) |
| "Upcoming" as a Survey Operations sub-tab, secondary priority | **INVALIDATED_BY_GUIDEBOOK** | Prepare is the primary operational use case (GB-15–18; Jeff) |
| Bands satisfied 4–5 / neutral 3 / dissatisfied 1–2 | KEEP (display) | Display bands (M2). A 3 is still a **Detractor** for follow-up (M5) |
| NPS promoter/passive/detractor, n≥10 | KEEP | Unchanged |
| R1 Overall ≤2 | INVALIDATED_BY_GUIDEBOOK | → Detractor (DSAT ≤3) |
| R2 NPS detractor "secondary", only when Overall not ≤2 | INVALIDATED_BY_GUIDEBOOK | NPS ≤6 makes a PGL response a Detractor in its own right |
| R3 decline across stages | KEEP (as customer concern) | – |
| R4 low delivery rating | REFINE | Responses lens, not Overview attention |
| R5 stakeholder divergence | KEEP (Responses) | – |
| R6 negative feedback on non-low score | REFINE | Responses lens only |
| RP segment pattern | KEEP (Responses) | – |
| G1 due without response; G2 low stage coverage | REFINE | Evidence gaps = estimated-due without response, `CLOSED_NO_RESPONSE`, `LAUNCH_NOT_SEEN`, `CANNOT_FORECAST` |
| O1–O6 survey operation issues | REFINE | O1 bounce, O2 expiring → **Chase now**; O3 due but not invited → `LAUNCH_NOT_SEEN`; O4 missing dates → `CANNOT_FORECAST`/**Prepare now**; O5 rule invalid, O6 stale → Survey settings / freshness |
| Coverage = heard from ÷ due per stage | KEEP | Due computed on programme rules (DG-01–03); "estimated" until DG-10 |
| Retire today's `coveragePct` | KEEP | – |
| Time windows (rolling 12; 6 vs 6) | KEEP | – |
| Driver classification | REFINE | Labels per survey; `aspect_value` not comparable across stages; PGL `agree_sales_expectations` is a delivery-team item (validate DG-15); business case = ES-only outcome |
| Product Area as lens, non-additive | KEEP | – |
| T1/T2/T3 tiers | KEEP | – |
| Customer feedback hybrid placement (contextual + Responses feedback view) | KEEP | – |
| Deployment CSAT history shared, not a section | KEEP | Content extended with forecasts and follow-up expectation ([deployment model §2](deployment-csat-model.md#2-deployment-csat-history-semantic-record)) |
| Vocabulary: "survey" = instrument only | REFINE | Survey = one deployment's MDS or PGL (guidebook usage); terms Detractor, Passive or Promoter, Top-2 Box, acknowledgement, follow-up added |
| Product-model `visual-design-handoff.md` | SUPERSEDE | [visual-design-handoff.md](visual-design-handoff.md) here |

## 4. CSAT Overview V2

| Item | Class | Position now |
|---|---|---|
| One Overview, not alternatives | KEEP | – |
| OV-0 scope bar: delivery leadership default Workday-led; window; freshness | KEEP | Content decision only; layout to be redesigned |
| OV-1 deployment-weighted mean headline | SUPERSEDE (J1, J2) | Top-2 Box programme measure + counts |
| OV-1 band counts, no % | REFINE | Top-2 Box *is* a % by programme definition; always shown with "x of n" |
| OV-1 Heard from per stage | KEEP | "estimated due" wording |
| Weighting note | SUPERSEDE | Not needed once deployment counts are a separate figure |
| Direction ≥0.3 mean (V5) | REFINE | Reopen in Top-2 Box points |
| Partner-led PGL reference row; no deltas; safe/unsafe language | KEEP | – |
| Copy "partner-led deployments aren't surveyed at mid-deployment" | REFINE | "No partner-led MDS responses on record" until VoC confirms (DG-13) |
| Contradiction 1 assumption "batch engine defaults to Workday-led scope" | INVALIDATED (source reading) | No leadership filter observed in `getMdsPglBatchView`. V2 validation item still holds for the due rule |
| OV-2 risk triggers (Dissatisfied ≤2, Declined, Low rating, Negative feedback) | INVALIDATED_BY_GUIDEBOOK | Customer concern = Detractor + decline |
| OV-3 Delivery ratings (lowest/highest, n≥5, "stands out" ≥0.3) | REFINE | Level 3 on Overview; Top-2 Box per rating if J1; per-survey labels |
| OV-4 MDS → PGL journey counts | KEEP | Level 3 |
| OV-5 Survey Operations strip as tertiary | **INVALIDATED_BY_GUIDEBOOK** | Prepare/chase are Level-2 management attention, not a footer strip |
| Evidence-qualifier thresholds 70/50 (V10) | KEEP (proposal) | Still for Jeff to confirm |
| Seven states (state-model.md) | SUPERSEDE | New state set in the next visual task |
| Drill-down map | REFINE | Targets renamed (Survey Operations → Surveys); new drill-downs for prepare/chase/follow-up |
| 1440×900 composition, regions, visual language | SUPERSEDE | Not authoritative. The next visual task re-derives layout; DM visual language guidance (tokens, pills, a11y) remains a useful reference |
| V1–V10 validation requirements | REFINE | V1/V2 merged into DG-01/02/03/10; V3 kept; V4 kept; V5 reopened; V6 retired; V7 retired (no R6 on Overview); V8 kept; V9 kept; V10 kept |
| V2 prototype (`dm-ux-csat-overview-v2/`) | SUPERSEDE (historical) | Retained, not deleted. Not a visual baseline for the next task |

## 5. CSAT subsystem (data) decisions

| Item | Class | Note |
|---|---|---|
| `csat-response-v1` contract, upsert, universe, text handling | KEEP | Legacy-row handling matches VoC's retroactive restatement (GB-42) |
| D1 Overall is the headline field | KEEP | Overall = DSAT |
| D3 no identity stored | KEEP | – |
| `Alert_type` UNRESOLVED | REFINE | Likely CLFU-related; clarify with VoC as part of DG-12 before any use |
| `csat-ui-architecture.md` sub-areas (Overview, Upcoming, Survey Tracking, Responses, Customer Feedback, Notifications) | SUPERSEDE (IA only) | Gates, access tiers, API and preview sections stay authoritative |

## Contradiction check

After this reconciliation, no earlier document remains authoritative on: headline metric, attention thresholds, navigation, Overview hierarchy, or follow-up. The status banners added to the product-model and V2 READMEs point here.

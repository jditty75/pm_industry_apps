# CSAT Overview v2 — one Overview designed from the approved product model (2026-10-06)

> **Status 2026-10-06: superseded for visual design by the reconciled architecture / V3** ([../csat-overview-v3/](../csat-overview-v3/README.md)). Retained for history. Jeff's review of the V2 prototype: "getting better, but still feels a little busy"; see [V2 visual diagnosis](../csat-overview-v3/v2-visual-diagnosis.md).
>
> **Earlier status update 2026-10-06: historical — superseded** by [../csat-reconciled-architecture/](../csat-reconciled-architecture/README.md). Its structure, risk triggers (OV-2), deployment-weighted mean headline (OV-1), tertiary Survey Operations strip (OV-5) and seven states are superseded or invalidated by the VoC guidebook (see [decision-reconciliation.md §4](../csat-reconciled-architecture/decision-reconciliation.md#4-csat-overview-v2)). Still useful: the Workday-led default lens and partner-led reference rules, safe/unsafe comparison language, and the visual-language/accessibility guidance in [overview-information-design.md §6–8](overview-information-design.md). The prototype is retained and is not a baseline for the next visual task.

Status: **design specification + localhost visual prototype for Jeff's review.** Production DepMngr UI/CSS/JS is unchanged. The V2 prototype lives under `skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/` and builds to gitignored `.preview-out/CSAT_OVERVIEW_*.html`.

This folder specifies **one** CSAT → Overview for Deployment Manager. It is not a set of alternatives. It is derived from the approved [Customer Satisfaction product model](../csat-product-model/README.md) and Jeff's resolved decisions P1–P10. It adds one new authoritative requirement: **Workday-led CSAT is the primary management lens.** Partner-led CSAT provides comparative and portfolio context.

Supersedes: the Overview A/B/C compositions in [../csat-overview-design/](../csat-overview-design/README.md), now marked **rejected for visual/information design — superseded by approved product model** (retained, not deleted).

## What Overview is for

> **What is Customer Satisfaction telling me about the portfolio, how strong is the evidence, and where should I investigate?**

CSAT navigation: **Overview | Responses | Survey Operations**. Overview is MONITOR. Responses (INVESTIGATE), Survey Operations (OPERATE) and the shared deployment CSAT history appear here only as drill-down destinations.

## Documents

| Doc | Content |
|---|---|
| [reading-narrative.md](reading-narrative.md) | The exact reading sequence that drives the hierarchy |
| [overview-information-design.md](overview-information-design.md) | Metric definitions, regions, hierarchy, 1440×900 composition, typography/surfaces, accessibility, T1/T2, exclusions |
| [workday-partner-comparison.md](workday-partner-comparison.md) | Scope model (Workday-led / Partner-led / All deployments), comparison treatment, MDS/PGL leadership constraint |
| [state-model.md](state-model.md) | The seven required states with synthetic values, all on one composition |
| [drilldown-map.md](drilldown-map.md) | Every Overview signal → its destination and pre-applied filter |
| [composer-preview-spec.md](composer-preview-spec.md) | Narrow handoff: one design, seven static pages, visual acceptance questions |

## Visual review (localhost)

Launch:

```powershell
.\preview.ps1 CSAT_OVERVIEW_V2
```

Opens **Healthy** first. Use the bottom-right badge link **All states** or `CSAT_OVERVIEW_V2_INDEX.html` for the full list. No scenario toolbar — each state is its own page.

**Review order:** Healthy → Low Evidence → Concerning (`CSAT_OVERVIEW_RISK.html`) → Decline → Partner-led → All deployments → SLG-like Low Volume → return to Healthy.

First question: *Does Healthy finally tell a coherent Customer Satisfaction story and feel like Deployment Manager?*

Approval phrase for this stage: **CSAT OVERVIEW VISUALLY APPROVED** (see [composer-preview-spec.md §8](composer-preview-spec.md)).

## Resolved decisions applied

Where Jeff's decision differs from the product model's original recommendation, the decision wins. The rest of the product model stands.

| # | Product-model recommendation | Resolved decision used here | Effect on Overview |
|---|---|---|---|
| P1 | % satisfied with band counts as headline | **Mean Overall Satisfaction (1–5)** is the headline | Mean (one decimal) leads. Band counts remain, as the raw response evidence beside it. No % satisfied on Overview (§ below) |
| P2 | R1 primary; R2 NPS detractor secondary | Explicit, explainable triggers: Overall ≤2; meaningful deterioration; very low delivery rating; negative feedback where permitted | Risk list uses R1, R3, R4, R6. R2 (NPS detractor) and R5 (stakeholder divergence) are left to Responses |
| P3 | Response-weighted headline | **Deployment-aware aggregation**, keep both concepts | All Overview means are deployment-weighted. Response counts, deployment counts and raw band counts are always visible |
| P4 | Include all in headline | Include partner-led; **default lens Workday-led** | Delivery-leadership scope control, default Workday-led |
| P5 | ≥10 per window, 6 vs 6 months | Approved | Direction rule as specified |
| P6 | T1 flag + suppressed topic counts | Approved; Overview primarily T1-safe | Only a non-content "negative feedback" risk trigger reaches Overview. No topic counts |
| P7 | Accept for internal staff | R3 security/API requirement; out of scope | No respondent identity on Overview. Respondent role is left off too (see information design §7) |
| P8 | Responses only, n≥5 | Approved | No EM/partner content on Overview |
| P9 | Route through Notable/Executive Watch | No case management in V1 | No owner/status/follow-up controls |
| P10 | Survey Operations | Approved | Sub-nav label |

Terminology change: the product model's "Drivers" become **Delivery ratings** on Overview (rationale in [overview-information-design.md §4 R4](overview-information-design.md)). Nothing on Overview uses "driver".

## Contradictions found (and how they are resolved)

1. **Partner-led coverage may not be computable.** The product model notes that the batch engine defaults to Workday-led scope. If the survey-due schedule omits partner-led deployments, then "heard from X of Y due" has no denominator in the Partner-led and All scopes. The design specifies a fallback cell ("Due schedule not available for partner-led deployments") and makes this a validation requirement (V2 below). This does not change the product model. It limits what Partner-led and All scopes can claim.
2. **Product-model states vs the states required here.** [visual-design-handoff.md](../csat-product-model/visual-design-handoff.md) listed seven states that predate the Workday-led requirement. [state-model.md](state-model.md) replaces them for this task. The older edge states (no responses in window, stale data, no risks) are covered as behaviour rules within the new seven.

No contradiction requires revisiting the product model's hierarchy, navigation or attention taxonomy.

## Production-data validation requirements

These must be validated against real data before the corresponding element ships. The prototype uses synthetic values.

| # | Requirement | Why | Blocks |
|---|---|---|---|
| V1 | **Coverage denominator: survey-due rule** (MDS ≈ ⅓ of duration after start; PGL = go-live + 2 months) compared against real invitation history per app | The current `coveragePct` in `CoreData.getCsatTabDataForUI` is distinct in-flight deployments ÷ *all* master deployments. That is not coverage and must not be reused. `headerSummary.coveragePct` is "invited of upcoming batch", an operations measure | "Heard from" column; evidence qualifier; evidence-gap count |
| V2 | Whether partner-led deployments have a survey-due schedule (batch engine scope) | See contradiction 1 | Coverage in Partner-led and All scopes |
| V3 | `priming_partner_type` populated and limited to Workday/Partner for every in-window response; blank handling | Scope control relies on it | Scope control |
| V4 | Pairing rule for journey (same `deployment_id`, MDS and PGL, PGL in window) gives credible counts per app | Pairs may be very sparse | Journey region |
| V5 | Direction magnitude threshold (proposed: deployment-weighted mean changes by ≥0.3) is acceptable to Jeff | Approved P5 sets the n rule but no magnitude | Direction words |
| V6 | Deployment-weighted vs response-weighted means: how often they differ by ≥0.2 in real data | Determines how often the weighting note appears | Weighting note |
| V7 | R6 negative-feedback flag: Qualtrics sentiment reliability on real comments, and P6 T1 exposure confirmed | Machine label | Early-warning trigger |
| V8 | Freshness thresholds for Responses import (proposed: fresh ≤7 days, aging ≤14, stale >14) | Stale-data behaviour | Freshness pill, O6 |
| V9 | Whether `CSAT_InFlight` / batch rows can be scoped by delivery leadership | Survey Operations counts should follow the active scope | OV-5 scoping (falls back to "all deployments" label) |
| V10 | Evidence-qualifier thresholds (proposed: ≥70% "most", 50–69% "some", <50% "read with caution") and the delivery-rating "stands out" gap (≥0.3 below median) are acceptable to Jeff | Product rules, not statistics | Qualifier wording; OV-3 selection |

## Verification stance

Static reading of the product-model documents, the CSAT subsystem analysis and current DepMngr source (`CoreData.js` coverage/header summary, `CoreUI_Markup.js` `_CoreUI_Markup_buildCsatTab_`, `CoreUI_Css.js` tokens, `.seg-control`, `.csat-subtab-*`, `.trends-section`, `.info-banner`). No data was queried, no browser was opened and nothing was rendered. Synthetic values are sized to the per-app volumes in the source analysis (SLG ~25–30, HENP ~70, HC ~75 responses/year; MDS 47/0 Workday-/partner-led; PGL 76/54). The band colours were run through the dataviz palette validator: green↔red deutan ΔE 8.1, which passes with secondary encoding, and the contrast warning makes visible text counts mandatory. That is not a WCAG certification.

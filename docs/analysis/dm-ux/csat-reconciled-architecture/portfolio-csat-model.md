# Portfolio CSAT model

> The portfolio is the collective view of deployments. Every portfolio CSAT statement must resolve, in at most two steps, to the deployments (and responses) beneath it.

Portfolio = one DM app (industry: HC, SLG, HENP), optionally narrowed by DM's existing scope (personalization "my deployments", product mode) and by **delivery leadership** (Workday-led default).

## 1. Two kinds of portfolio figure, never confused

| Kind | Definition | Weighting | Why it exists | Label |
|---|---|---|---|---|
| **Programme measure** | Top-2 Box DSAT and NPS over responses in scope and window, computed exactly as the VoC programme does | **Response-weighted** (like Qualtrics Key Metrics) | Leadership must be able to reconcile DM with the Qualtrics dashboard. Two different "satisfaction" numbers for the same scope would destroy trust | "Deployment Satisfaction (Top-2 Box) · 26 responses · 21 deployments" |
| **Deployment state counts** | Counts of deployments by their CSAT facets (latest verdict class, survey state, follow-up expected, evidence recency) | **Per deployment** (each counts once) | Deployment-centric reading: "how many of my deployments have a customer telling us something?" | "4 deployments with a Detractor response in the last 6 months" |

This replaces the resolved P3 "deployment-weighted mean" with a cleaner split. The programme number stays the programme's number. The deployment-centric view is a set of **counts of deployments**, not a re-weighted version of the same satisfaction figure. Weighting disagreement (stakeholder count inflating a deployment) then becomes visible as "3 responses from 1 deployment" in the evidence line, with no second mean. **Decision J2.**

## 2. Portfolio questions and derivation

| # | Question | Derivation (from deployments) | Class | Objective |
|---|---|---|---|---|
| PQ1 | How many deployments are approaching a survey, and are they ready? | Deployments in `UPCOMING` for the next round(s); with readiness facets; prepare-by date | CURRENT_STATE | O1 |
| PQ2 | How many surveys are in motion right now, and how are they going? | Deployments in `IN_FLIGHT`: responded / awaiting / all-bounced; closes on | PROCESS_STATE | O2 |
| PQ3 | Which responses require follow-up? | Responses with follow-up expected (all MDS; Detractors), by expected owner role; status *tracked in Qualtrics* | ACTION_REQUIRED | O2, O4 |
| PQ4 | What is Workday-led customer satisfaction? | Programme measure over Workday-led responses in window, per survey, with n and d | CUSTOMER_OUTCOME | O4 |
| PQ5 | What is the evidence base? | Deployments due (forecast rule) vs heard from, per survey; closed-without-response count while known | CURRENT_STATE | O4 |
| PQ6 | Which customers have told us something leadership should know? | Deployments with a Detractor response in window (plus declined trajectory) | CUSTOMER_OUTCOME | O4 |
| PQ7 | Which delivery ratings recur as weak? | Top-2 Box per delivery rating, per survey (question-mapping rules applied), n-gated | PORTFOLIO_INSIGHT | O3 |
| PQ8 | How do partner-led results compare? | PGL programme measure, partner-led as reference beside Workday-led | PORTFOLIO_INSIGHT | O4 |
| PQ9 | Where are the evidence gaps? | Deployments due without response; surveys `CLOSED_NO_RESPONSE`; `LAUNCH_NOT_SEEN`; `CANNOT_FORECAST` | CURRENT_STATE | O1, O4 |
| PQ10 | What do customers keep saying? | Comments + Qualtrics themes for the slice (T2); future CLFU reasons | PRACTICE_LEARNING | O3 |

Every item above has a deployment list behind it, and that list is the drill-down.

## 3. Workday-led / partner-led model

Requirement (approved, kept): **Workday-led CSAT is the primary management lens. Partner-led CSAT provides comparison and portfolio context.** Product copy explains this only in delivery terms.

The guidebook supports the default: the Qualtrics Key Metrics page defaults to Priming Partner = Workday and shows Workday- and partner-primed results side by side (GB-48).

| Survey | Workday-led | Partner-led | Like-for-like? |
|---|---|---|---|
| MDS | In scope (subject to >16 wks, services approach, name rules) | **Not stated by the guidebook.** 0 responses observed. Treat as "not observed; confirm with VoC" (GB-05) | No partner MDS comparison possible today |
| PGL | In scope | In scope since Jan 2025 | DSAT and NPS: **yes**, same questions. Team ratings: *different teams rated* ("Workday and/or Partner project team"). Other ratings: same wording |
| Stage comparison | Workday-led only, MDS-eligible PGLs only ([measurement §4](measurement-and-thresholds.md#4-cohort-comparability-mds-vs-pgl-workday-led-vs-partner-led)) | n/a | Only with both filters |
| Journey | Workday-led | n/a | Same deployment |

Kept from V2: scope control default Workday-led; partner-led PGL as a muted **reference** in the same structure; no deltas, gaps or rankings; composition notes in All scope. Refined: wording "partner-led deployments aren't surveyed at MDS" becomes "No partner-led MDS responses on record". It stays a statement of fact until the VoC team confirms the rule.

Upcoming and In-flight follow the same scope. Partner-led PGL **is** forecast and in flight, and the partner-led EM/partner owns preparation there. The guidebook's EM checklist is written for Workday EMs. CLFU is ProServ-only (GB section header), so **follow-up expectations apply to Workday-led deployments only**. For partner-led Detractors, DM shows the verdict without a ProServ follow-up expectation. Confirm with VoC who owns partner-led Detractor follow-up (DG-13).

## 4. Historical Responses: evidence, insight, learning

| | `DEPLOYMENT_EVIDENCE` | `PORTFOLIO_INSIGHT` | `PRACTICE_LEARNING` |
|---|---|---|---|
| Question | What did *this* customer say? | What is the state of the portfolio? | What should delivery do differently? |
| Unit | Responses of one deployment | Aggregates over a scope + window | Patterns across deployments and time |
| Supports | Deployment health (facets); follow-up context; QBR prep; MDS → PGL journey of one customer | Workday-led satisfaction; evidence base; Detractor count; partner reference | Weak delivery ratings; recurring themes; journey patterns; future CLFU root causes |
| Suppression | None (records) | n<5 cells | n<5 cells; themes n-gated |
| Tier | T1 scores; T2 comments | T1 | T1 ratings; T2 comments/themes |
| Home | Deployment CSAT history | Overview (summary), Responses | Responses (lenses, feedback view) |
| Qualtrics-derived themes/sentiment | Labelled chips on comments | Not on Overview (V2 decision kept) | Navigation/filter in feedback view |
| Future | AI deployment summary | – | AI theme summaries; CLFU reasons/outcomes (highest value: human root cause) |

Delivery ratings are `PORTFOLIO_INSIGHT` when summarised and `PRACTICE_LEARNING` when compared across survey, leadership or time. The question-mapping corrections in [measurement §3](measurement-and-thresholds.md#3-question-mapping-corrections-affect-delivery-ratings-and-stage-comparison) apply to both.

## 5. Portfolio health from the customer's perspective

The portfolio-level counterpart of the deployment facets. These are counts of deployments, each traceable:

| Portfolio facet | Counted from | Example wording |
|---|---|---|
| Customer verdicts | Latest verdict class per deployment with a response in window | "Of 21 deployments heard from: 17 Passive or Promoter · 4 with a Detractor response" |
| Customer attention | Detractor responses (+ declined trajectory) | "4 deployments: customers raised concerns" |
| Follow-up | Responses with follow-up expected (Workday-led) | "6 responses expect follow-up (tracked in Qualtrics)" |
| Process | Upcoming next round; in flight | "Next round 4 Nov: 9 deployments · 2 missing an Executive Sponsor contact" |
| Evidence | Due vs heard from | "Heard from 21 of 27 deployments due" |

The programme measure (Top-2 Box, NPS) summarises **verdicts**. These facets show **where they came from and what is still open**. Together they answer "what is the customer telling us about this portfolio?" without a composite score.

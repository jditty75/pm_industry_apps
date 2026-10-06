# CSAT reconciled architecture: deployment-centric Customer Satisfaction (2026-10-06)

Status: **proposed — ready for Jeff's product review.** Business-requirements, product and information architecture only. No screens, wireframes, layout, UI/CSS/JS, prototype, API, EDM, workbook, CLASP or deployment change was made.

**Authority:** once approved, this folder is the authoritative CSAT architecture. It reconciles the VoC *PGL and MDS Deployment Surveys Guidebook* (Aug 2026) with the CSAT data foundation ([../../csat-subsystem/](../../csat-subsystem/README.md)) and DM's purpose. Where it differs from [../csat-product-model/](../csat-product-model/README.md) or [../csat-overview-v2/](../csat-overview-v2/README.md), this folder wins. Item-by-item status: [decision-reconciliation.md](decision-reconciliation.md).

## Executive conclusion

**CSAT is the customer's view of each deployment, collected at two moments (MDS and PGL), and the portfolio picture is the sum of those deployment views.** The earlier design treated CSAT mainly as historical analytics. The guidebook shows that most of the work, and most of DM's unique value, comes **before and around** each survey:

- knowing which deployments will be surveyed and when;
- fixing dates and contacts in SFDC before an irreversible launch;
- chasing responses while the survey is open;
- knowing which responses require acknowledgement or a Detractor conversation.

Historical responses then become the customer's evidence about a deployment and the raw material for learning.

DM should not become a second Qualtrics. Qualtrics owns invitations, responses, programme reporting and closed-loop tickets. SFDC owns dates and contacts. DM owns two things nobody else combines: the **pre-launch horizon across a portfolio** and **customer evidence in deployment context**.

## What CSAT is, in one page

| Question | Answer |
|---|---|
| What is CSAT inside DM? | The customer-perspective lens on each deployment and its portfolio: what the customer said, when they will next be asked, and what that requires of us |
| What lifecycle does it represent? | Per deployment × survey: `NOT_IN_SCOPE` / `CANNOT_FORECAST` → `UPCOMING` (prepare by open − 14 d) → `IN_FLIGHT` → `RESPONDED` or `CLOSED_NO_RESPONSE` (+ `LAUNCH_NOT_SEEN`), then follow-up expectations and history ([survey-lifecycle.md](survey-lifecycle.md)) |
| Sections | **Overview · Surveys · Responses**, plus a shared deployment CSAT history ([navigation-and-overview.md](navigation-and-overview.md)) |
| What does Overview communicate? | Level 1: Workday-led customer satisfaction with its evidence, how many customers raised concerns, and the next round. Level 2: concern, follow-up, prepare, chase and evidence gaps as named deployments. Level 3: breakdowns |
| What does the EM do? | Prepares each upcoming survey in SFDC before the deadline, informs the customer, confirms delivery and chases, acknowledges every MDS response, and handles assigned Detractors **in Qualtrics** ([role-needs.md](role-needs.md)) |
| What does leadership learn? | Workday-led programme satisfaction reconcilable with Qualtrics, how representative it is, which customers raised concerns, recurring weak delivery ratings, and the partner-led PGL reference |
| What belongs to Qualtrics? | Invitations, reminders, resends/exclusions (via VoC), responses, programme dashboards, every CLFU action and its status ([system-boundaries.md](system-boundaries.md)) |
| How does CSAT contribute to deployment health? | Six facets beside internal health, with no composite score: latest verdict, trajectory, follow-up expected, survey in motion, next survey, evidence recency ([deployment-csat-model.md](deployment-csat-model.md)) |
| How does portfolio CSAT derive from deployments? | A programme measure (Top-2 Box, NPS, response-weighted, reconcilable with Qualtrics) plus counts of deployments by facet. Every figure drills to its deployments ([portfolio-csat-model.md](portfolio-csat-model.md)) |

## Jeff's four objectives, reconciled

| Objective | Guidebook support | Home | V1 feasibility |
|---|---|---|---|
| **O1 Prepare** (primary operational) | Strongest: irreversible launch, two-week deadline, monthly re-check, contacts by role, customer informed (GB-15–22) | Surveys (upcoming); Overview Level 2 "Prepare now"; deployment history | Derivable, **but DM's current forecast diverges from the programme rule** (per-product dates, Active-only, no eligibility exclusions). Fixing that is V1's first job |
| **O2 Monitor** | Confirm delivery, chase, close date, acknowledgement (GB-24–33) | Surveys (in flight, responded); Overview "Chase now" / "Follow-up expected" | Available now from `CSAT_InFlight` + Responses. Follow-up *status* is Qualtrics-only |
| **O3 Learn** | Questions, Top-2 Box, Driver Questions, Close Loop Outcomes (GB-40–48) | Responses; deployment history | Available now. CLFU root causes (the best learning data) need a Qualtrics export |
| **O4 Deployment / portfolio health** | Detractor/Promoter classes; Workday-primed default; partner comparison (GB-30, 48) | Overview; deployment history beside internal health | Available now. Perspective divergence is V1.1 |

## Documents

| Doc | Content |
|---|---|
| [guidebook-requirements.md](guidebook-requirements.md) | 51 guidebook rules, each classified (`DM_MUST_SURFACE` … `NOT_RELEVANT_TO_DM`), plus what the guidebook does *not* say |
| [measurement-and-thresholds.md](measurement-and-thresholds.md) | **Authoritative** metric/threshold/terminology table; historical scale rules; question-mapping corrections; cohort comparability |
| [survey-lifecycle.md](survey-lifecycle.md) | Corrected lifecycle, stage table, canonical states and facets, InFlight ↔ Responses as one lifecycle |
| [deployment-csat-model.md](deployment-csat-model.md) | Deployment CSAT health facets; deployment CSAT history record; evidence vs insight vs learning |
| [portfolio-csat-model.md](portfolio-csat-model.md) | Programme measure vs deployment counts; portfolio questions; Workday-led / partner-led model; historical learning; portfolio health facets |
| [role-needs.md](role-needs.md) | EM, Deployment Sponsor / DD, industry leadership; shared vs role-specific; why one Overview |
| [system-boundaries.md](system-boundaries.md) | SFDC / Qualtrics / EDM / DM matrix; CLFU boundary; existing DM behaviour to reconcile |
| [data-gaps.md](data-gaps.md) | DG-01…DG-21 with availability class and next step |
| [navigation-and-overview.md](navigation-and-overview.md) | Re-derived navigation; Overview's semantic job; Level 1/2/3 hierarchy |
| [v1-scope.md](v1-scope.md) | V1, V1.1 and Future, with prerequisites |
| [dm-design-principles.md](dm-design-principles.md) | Portable DM principles, whole-app review map, overlap classification (no redesign) |
| [decision-reconciliation.md](decision-reconciliation.md) | Every prior decision: KEEP / REFINE / SUPERSEDE / INVALIDATED_BY_GUIDEBOOK |
| [visual-design-handoff.md](visual-design-handoff.md) | Brief for the next task: one CSAT Overview |

## Decisions required from Jeff

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| J1 | Headline satisfaction expression: reverse P1 (mean) in favour of the programme's **Top-2 Box**? | **Yes.** Top-2 Box with "x of n", mean in detail | The guidebook defines Top-2 Box as the measure. A different DM headline would not reconcile with Qualtrics Key Metrics |
| J2 | Replace deployment-weighted means (P3) with **response-weighted programme measure + deployment state counts**? | **Yes** | Keeps one satisfaction number that matches the programme, and makes the deployment-centric view explicit as counts |
| J3 | Navigation **Overview · Surveys · Responses** (Survey Operations retired; notification rules/import → Survey settings)? | **Yes** | Puts Prepare and Monitor, Jeff's primary use cases, in one first-class section |
| J4 | Should DM's Upcoming follow the **VoC programme rule** (one MDS on First Target MTP, one PGL on First MTP Actual, eligibility exclusions, any deployment status), replacing today's per-product events? | **Yes**, with later go-lives shown as context | EMs prepare for what will actually launch. Changes existing behaviour → its own authorized release later |
| J5 | Show **follow-up expectations** (all MDS; Detractors) with expected owner role and "tracked in Qualtrics", Workday-led only, without status, in V1? | **Yes** | Truthful about programme obligations without creating a second ticket system |
| J6 | Prioritise a **Qualtrics CLFU ticket export** (and append-only invitation history) as V1.1? | **Yes**: ticket export first | Only source of follow-up completion and human root causes |

Confirmations to request from the VoC team (facts, not product decisions): partner-led MDS scope and partner Detractor ownership (DG-13); mapping of "Launch Now / Ad Hoc / Customer-Led" to SFDC values (DG-14); MDS calendar column label and FY27 window boundaries (GB-12, DG-21); `Alert_type` meaning; whether later phase go-lives generate additional PGLs.

## Verification stance

Static reading only:
- the guidebook PDF, as supplied in this session;
- prior CSAT docs;
- current DepMngr source (`CoreSurveySchedule.js`, `CoreData.js` batch engine `getMdsPglBatchView` / `_buildGoLiveEvents_` / `_resolveMdsPglActiveRows_`, InFlight KPIs/status, `readSfdcDeploymentsRaw_` fields, `CoreNotify.js` reminder rules);
- the source-field classification.

No data was queried, no Apps Script was run, nothing was rendered. The observations about DM behaviour come from reading code and are unverified at runtime. The guidebook's own internal inconsistencies are flagged, not resolved.

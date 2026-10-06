# Core CSAT product questions

Derived from the available evidence (`CSAT_Responses`, `CSAT_InFlight`, the batch schedule engine, deployment master), not from prior screen sections.

## 1. Challenge of the candidate structure

The candidate was *Reach → Satisfaction → Journey → Drivers → Customer Voice → Attention*. Changes made and why:

| Candidate | Outcome | Reason |
|---|---|---|
| Reach as a peer of Satisfaction | **Split in two.** *Coverage* (are we hearing from the deployments we should?) becomes the evidence base for Satisfaction. *Survey operations* (is the asking process working?) becomes its own operational question | "Reach" mixed two things. One qualifies results: 26 responses from 20 of 31 due deployments. The other is a process with actions: bounced, expiring, not invited. Putting either beside satisfaction as an equal KPI was the main weakness of the earlier prototypes |
| Satisfaction | **Kept, made stage-aware and directional.** Direction is part of the satisfaction question, not a separate question | Trend on its own is not a user question; "is it getting better?" only makes sense about satisfaction. Survey stage is always a split, never an optional filter |
| Journey | **Kept** as its own question | "Does the experience hold through go-live?" is a distinct business question. Its evidence (cohorts and pairs) and limitations differ from headline satisfaction |
| Drivers | **Kept, renamed in meaning** to "which delivery dimensions are rated weakest/strongest" | The data supports *what is rated low* directly. It supports *what is associated with low satisfaction* only weakly at this n, and *what causes it* not at all |
| Customer Voice | **Kept as "Customer feedback"** — the explanation layer | "Voice" invites a separate destination. The data says comments explain specific signals (see navigation model) |
| Attention | **Kept and sharpened** to satisfaction risk only; evidence gaps and operation issues are named separately | Different causes, different owners, different actions |
| *(missing)* | **Added: the deployment lens** | Low volume makes the single deployment's history the most frequently useful CSAT object. Every portfolio signal ends there |

Product Area, partner type, services approach and time are **lenses** applied to the questions, not questions in their own right.

## 2. The question hierarchy

| # | Question | Plain form | Mode |
|---|---|---|---|
| **Q1** | **Satisfaction** | How satisfied are customers with our delivery at each survey stage, and is it changing? | MONITOR |
| **Q2** | **Coverage** | How much of the portfolio is that based on — are we hearing from the deployments we should? | MONITOR (qualifies Q1) |
| **Q3** | **Satisfaction risk** | Which deployments have a customer verdict that needs follow-up? | MONITOR → INVESTIGATE |
| **Q4** | **Journey** | Does satisfaction hold from mid-deployment to after go-live? | INVESTIGATE |
| **Q5** | **Drivers** | Which delivery dimensions do customers rate weakest and strongest? | INVESTIGATE |
| **Q6** | **Customer feedback** | What are customers telling us in their own words, and why did they score as they did? | INVESTIGATE (T2) |
| **QD** | **Deployment CSAT history** | What has this deployment's customer said across its lifecycle, and is anything outstanding? | INVESTIGATE (deployment) |
| **O1** | **Survey operations** | Is the survey process reaching the right customers at the right time? | OPERATE |

There are no redundant questions. Q1/Q2 are state, Q3 is exceptions, Q4–Q6 are explanation, QD is the unit of investigation, and O1 is process.

## 3. Question → Evidence → Interpretation → Action

### Q1 Satisfaction
| Dimension | Definition |
|---|---|
| Business question | How satisfied are customers with our delivery right now, at MDS and at PGL, and is that changing? |
| Evidence | `overall_satisfaction`, `survey_type`, `response_ts_utc`, `deployment_id` (CSAT_Responses) |
| Metric/analysis | For the window (default rolling 12 months): band counts and % (satisfied 4–5 / neutral 3 / dissatisfied 1–2), mean as secondary, n responses, d deployments; **always split by survey stage**, with an all-stage figure allowed because Overall is the same item in both surveys. Direction = current vs prior equal window, only under rule P5 |
| Segmentation | Survey stage (always); priming partner type; services approach; deployment type; Product Area group (non-additive); respondent role; window |
| Interpretation | "Of N responses received in the window, X were satisfied." Describes **respondents**, not all customers. Direction statements only when n allows |
| Limitations | Non-response bias unknown; portfolio composition shifts between windows; stage mix shifts the all-stage figure; 7 of 177 rows lack Overall (stage-specific score only) and do not count; response-weighted (P3) |
| Drill-down evidence | Responses filtered to the window/segment, sorted by score → deployment CSAT history → comments (T2) |
| User action | No action at aggregate level; a weak or declining figure leads to investigation (Q4–Q6) |

### Q2 Coverage
| Dimension | Definition |
|---|---|
| Business question | Is the satisfaction figure based on most of the deployments that were due to be surveyed, or a few? |
| Evidence | CSAT_Responses (`deployment_id`, `survey_type`, `response_ts_utc`); deployment master; survey-due estimate from the batch engine (MDS ≈ ⅓ of duration after start; PGL = go-live + 2 months); last import time; CSAT_InFlight statuses (current window only) |
| Metric/analysis | **Deployment coverage** = deployments with ≥1 response for a stage ÷ deployments whose survey for that stage fell due in the window (`SAFE_DERIVATION`, needs validation). **Invitation response rate** = completed ÷ (sent − bounced) for the current InFlight window only. **Freshness** = last successful Responses import |
| Segmentation | Survey stage; priming partner type (the batch engine defaults to Workday-led scope); services approach |
| Interpretation | High coverage → satisfaction is representative of the portfolio. Low coverage → it describes a minority, whatever its value. Coverage says nothing about satisfaction itself |
| Limitations | The due date is a schedule rule, not proof of invitation. InFlight is replaced on each import and has no history, so there is no response-rate trend. HC InFlight is Active-only. Several respondents per deployment means respondent coverage ≠ deployment coverage |
| Drill-down evidence | List of due deployments with no response (evidence gaps) → Survey Operations for those deployments |
| User action | Chase non-responders through Survey Operations, or accept the gap and read Q1 with that caveat |

### Q3 Satisfaction risk
| Dimension | Definition |
|---|---|
| Business question | Which deployments have a customer verdict that someone should look at? |
| Evidence | Per-response `overall_satisfaction`, `nps_score`, driver scores, prior responses for the same deployment, comment sentiment (QD), deployment context (current DM health, stage, EM) |
| Metric/analysis | Rule-based signals R1–R6 ([data-to-insight-map.md §4](data-to-insight-map.md)) evaluated per response, rolled up per deployment, ordered by severity then recency, within the window |
| Segmentation | Signal type; survey stage; priming partner type; Product Area; EM/partner (P8) |
| Interpretation | Each signal is a **fact about what a customer said**, not a judgement of the deployment's overall health |
| Limitations | One respondent may not speak for the customer. Sentiment is machine-labelled. No follow-up state exists (P9), so handled and unhandled risks look the same |
| Drill-down evidence | Deployment CSAT history → response detail and comments (T2) → DM deployment context |
| User action | Open the deployment; read the feedback; follow up with the EM/DD; use existing DM tools (Notable, Executive Watch, Deployment Health Plan) |

### Q4 Journey
| Dimension | Definition |
|---|---|
| Business question | Does customer satisfaction hold, improve or deteriorate between mid-deployment and post-go-live? |
| Evidence | `overall_satisfaction` by `survey_type`; `deployment_id` pairs; `respondent_key` pairs; `priming_partner_type` |
| Metric/analysis | (a) **Stage cohort comparison** — MDS cohort vs PGL cohort Overall, Workday-led only (P4). (b) **Paired journey** — for deployments with both, the count that improved / held / declined, with change in Overall. (c) Same-respondent pairs via `respondent_key` (strongest, sparsest) |
| Segmentation | Priming partner type (mandatory for cohorts); services approach; Product Area group |
| Interpretation | (a) describes different deployments at different moments; (b) describes the same deployment, possibly through different stakeholders; (c) is the closest thing to a true change in one person's view |
| Limitations | Pairs are rare: in the sample, only 33 deployments have more than one response, including same-stage multi-stakeholder responses. MDS and PGL responses for one deployment are often months or more apart, so many pairs span windows. The question context differs by stage. See [metric-semantics.md §3](metric-semantics.md) |
| Drill-down evidence | Deployments with paired decline → deployment CSAT history |
| User action | Investigate deteriorating deployments; feed observed patterns into delivery practice discussions |

### Q5 Drivers
| Dimension | Definition |
|---|---|
| Business question | Which parts of our delivery do customers rate weakest and strongest, and do dissatisfied customers rate something especially low? |
| Evidence | `team_*`, `aspect_*`, `agree_*` (classification in [metric-semantics.md §2](metric-semantics.md)) |
| Metric/analysis | **Driver profile**: per driver, % rated 1–2 and mean, with its own n, by survey stage. **Weakest dimensions** = lowest-rated relative to the others. **Dissatisfied-response profile** = driver ratings within dissatisfied responses vs the rest (n-gated) |
| Segmentation | Survey stage (mandatory: several drivers are stage-specific); priming partner type; services approach; Product Area group |
| Interpretation | "Schedule management is our lowest-rated dimension" (`DIRECT_METRIC`). "Dissatisfied respondents rate communications lowest" (`SAFE_DERIVATION`). "Communications drives satisfaction" (`UNSUPPORTED`) |
| Limitations | n differs by driver (aspects on ~55% of rows). Halo effect: driver ratings move together with Overall. Sales-related agreement items are partly outside delivery's control |
| Drill-down evidence | Responses with a low rating on that driver → related comments (T2) |
| User action | Practice-level learning; investigate the deployments behind a weak dimension |

### Q6 Customer feedback
| Dimension | Definition |
|---|---|
| Business question | In customers' own words, why did they score as they did, and what keeps recurring? |
| Evidence | `comment_reasons`, `comment_improve`, `comment_working_well`, `comment_additional` (CUSTOMER_SOURCE); `*_sentiment`, `*_parent_topics`, `qx_analytics_json` (QUALTRICS_DERIVED) |
| Metric/analysis | Comments shown **in the context of a signal, slice or deployment**; parent-topic frequency among commenters (n-gated); sentiment as a navigation filter |
| Segmentation | Question; survey stage; satisfaction band; parent topic; sentiment; Product Area; deployment |
| Interpretation | A comment explains one customer's verdict. Topic counts show recurrence among the customers who commented |
| Limitations | Only ~68% of responses carry a reasons comment. The questions differ by stage (MDS has improve/working-well; PGL has additional). Topics and sentiment are machine-assigned and recomputable. Each app's corpus is small (tens of comments a year) |
| Drill-down evidence | Full response → deployment CSAT history |
| User action | Understand the cause; follow up; take the lesson to the delivery team. Later: AI summary of a slice |

### QD Deployment CSAT history
| Dimension | Definition |
|---|---|
| Business question | What has this deployment's customer told us so far, and is a survey outstanding? |
| Evidence | All CSAT_Responses for `deployment_id`; CSAT_InFlight status for deployment + survey type (deployment level only); survey-due estimate; current DM deployment context |
| Metric/analysis | Chronological sequence of responses (MDS → PGL): survey stage, date, respondent role, Overall, NPS, low driver ratings, active signals; survey state per stage (not due / due / invited / completed / no response) |
| Segmentation | None. This is the unit of investigation |
| Interpretation | The customer's account of this deployment over time, from the stakeholders who answered |
| Limitations | Role, not identity. Several stakeholders can disagree. Deployment stage is a snapshot at response time. InFlight links at deployment level only |
| Drill-down evidence | Comments (T2); full response detail (T2) |
| User action | Follow up; mark Notable / Executive Watch; brief the EM; prepare a customer review |

### O1 Survey operations
| Dimension | Definition |
|---|---|
| Business question | Are surveys going to the right customers at the right time, and is anything blocked? |
| Evidence | Batch engine (upcoming MDS/PGL by month, exceptions for missing target dates); CSAT_InFlight (sent/opened/started/finished dates, status, expiry, contact role); notification rules and distribution log; import freshness |
| Metric/analysis | Upcoming by month; invited / opened / completed / bounced counts; expiring without completion; due but not invited; invalid rules; last import |
| Segmentation | Survey stage; month; partner scope; status |
| Interpretation | Process health only. It says nothing about satisfaction |
| Limitations | InFlight holds only the current window. `Started` is folded into `Opened` by `_normalizeCsatTrackingStatus_`. Contact identity is shown (P7) |
| Drill-down evidence | The invitation row; the deployment's history |
| User action | Correct contact data at source; fix missing target dates; adjust or test notification rules; upload a file manually |

## 4. Coverage by level and access tier

| Question | Level | Fully answerable at T1? |
|---|---|---|
| Q1 Satisfaction | Portfolio signal with deployment evidence | Yes |
| Q2 Coverage | Portfolio signal with deployment evidence | Yes |
| Q3 Satisfaction risk | Portfolio list of deployment-level facts | Yes for score signals; the *meaning* of a feedback signal needs T2; the T1 flag depends on P6 |
| Q4 Journey | Both (cohort = portfolio; pairs = deployment) | Yes |
| Q5 Drivers | Portfolio with deployment evidence | Yes |
| Q6 Customer feedback | Both | **No — T2.** Theme counts possibly T1 (P6) |
| QD Deployment history | Deployment only | Scores, roles and signals at T1; comments T2 |
| O1 Survey operations | Both | Yes (includes contact identity today — P7) |

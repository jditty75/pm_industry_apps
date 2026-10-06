# Data → insight → action map

## 1. Data domains and their product roles

| Domain | Store | Grain / semantics | Product role |
|---|---|---|---|
| **A. Survey process** | `CSAT_InFlight` (16 cols, full replace per import, ~3-month invitation window, HC Active-only) + batch engine (upcoming MDS/PGL, missing-date exceptions) + notification rules/log + import freshness | One invitation per contact; current state only; no history | **The asking process.** It feeds *Survey Operations* (operate) and part of *Coverage* (in the current window only). It never feeds satisfaction |
| **B. Customer verdicts** | `CSAT_Responses` (`csat-response-v1`, historical upsert, retained) | One completed response; historical; multi-response per deployment | **What customers told us.** It feeds Satisfaction, Journey, Drivers, Risk, Feedback, Deployment history and the historical half of Coverage |
| C. Deployment context | DM deployment master (SFDC), current health, Notable/Executive Watch | One deployment; current state | Lets each verdict be read in context, and supplies the denominator for "due" |
| D. AI insights (future) | `CSAT_AI_Insights` (design only) | Scoped summaries; append-only | An optional synthesis layer (§6) |

Corrected framing of the brief's working phrases: Domain A answers *"Are we asking the right customers at the right time, and is it working?"*. On its own it does **not** answer "are we hearing from customers"; that also needs Domain B plus the due-schedule (Coverage). Domain B answers *"What verdict did each customer give, at which point in the deployment, and why?"*

Joins (from the source contract): Responses ↔ InFlight only at **deployment + survey stage** level; `Contact_ID` and dates are unsafe; `response_id` ↔ InFlight `Response ID` is reliable but not stored, and must stay unstored unless a T3 decision is made (P7).

## 2. Insight catalog by derivation class

| Insight | Class | Question | Tier |
|---|---|---|---|
| Satisfied / neutral / dissatisfied counts and %, by survey stage, with n | DIRECT_METRIC | Q1 | T1 |
| Mean Overall by stage | DIRECT_METRIC | Q1 | T1 |
| NPS (PGL, n≥10) | DIRECT_METRIC | Q1 | T1 |
| Direction vs prior window (P5) | SAFE_DERIVATION | Q1 | T1 |
| Composition shift note between windows | SAFE_DERIVATION | Q1 | T1 |
| Deployment coverage per stage | SAFE_DERIVATION (needs validation of the due rule) | Q2 | T1 |
| Invitation response rate (current window) | DIRECT_METRIC | Q2/O1 | T1 |
| Satisfaction-risk signals R1–R2 | DIRECT_METRIC | Q3 | T1 |
| R3–R5 (paired decline, low driver, stakeholder divergence) | SAFE_DERIVATION | Q3/QD | T1 |
| R6 negative feedback on non-low score | INTERPRETIVE (machine sentiment) | Q3 | flag T1 per P6; content T2 |
| Stage comparison (Workday-led) | SAFE_DERIVATION, INTERPRETIVE reading | Q4 | T1 |
| Paired change counts | SAFE_DERIVATION (sparse) | Q4 | T1 |
| Same-respondent change (`respondent_key`) | SAFE_DERIVATION (very sparse) | Q4/QD | T1 |
| Driver profile, weakest dimensions | DIRECT_METRIC | Q5 | T1 |
| Driver ratings among dissatisfied vs others | SAFE_DERIVATION (n-gated) | Q5 | T1 |
| "Driver X explains satisfaction" / importance ranking | **UNSUPPORTED** at current n | – | – |
| Satisfaction by Product Area ("responses touching area") | SAFE_DERIVATION | lens | T1 |
| Scope breadth (number of areas) vs satisfaction | INTERPRETIVE | lens | T1 |
| Parent-topic frequency, by satisfaction band | SAFE_DERIVATION over QUALTRICS_DERIVED data | Q6 | T1 counts per P6, T2 text |
| Sentiment mix | QUALTRICS_DERIVED, navigation only | Q6 | T2 (or T1 counts per P6) |
| "Why satisfaction is declining" in words | FUTURE_AI | Q1/Q6 | T2 + aiInsights |
| Recurring themes summarised across comments | FUTURE_AI | Q6 | T2 |
| Deployment feedback-history summary | FUTURE_AI | QD | T2 |
| Causal claims ("go-live readiness causes PGL drop") | **UNSUPPORTED** | – | – |
| Response-rate trend | FUTURE_DATA_REQUIRED (InFlight history) | Q2 | – |
| "Risk" as a predicted score | **UNSUPPORTED** | – | – |

## 3. Customer comments — information role

- **Answers what scores cannot:** the reason for a verdict, the specific incident, what to keep doing, what the customer expects next.
- **When a user should see them:** when explaining a signal (a low response, a declining slice, a weak driver, a theme), and when reviewing one deployment. Browsing all comments without a question is legitimate but secondary: practice review, quarterly learning.
- **Relation to scores:** a comment is attached to its response and read *with* its Overall, stage and role. A "negative" sentiment on a satisfied response is itself informative (R6).
- **Relation to deployment context:** every comment is reachable from, and links back to, the deployment CSAT history.
- **Browse vs reach:** primarily **reached through a signal or slice**; independent browsing lives inside Responses as a T2 feedback view that shares Responses' filters (navigation model §4).
- Comments are CUSTOMER_SOURCE and authoritative. Nothing derived replaces them.

## 4. Attention-signal taxonomy

Three classes, never summed into one count.

### CUSTOMER_SATISFACTION_RISK — "a customer told us something we must look at"
| Id | Signal | Rule (defaults, see P2) | Class | Level | Prominence |
|---|---|---|---|---|---|
| R1 | Dissatisfied response | Overall ≤2 | DIRECT | Deployment | **Primary** |
| R2 | PGL detractor | NPS 0–6 and Overall not ≤2 | DIRECT | Deployment | Secondary |
| R3 | Satisfaction decline across stages | Same deployment: later Overall lower by ≥1 and into neutral/dissatisfied | SAFE | Deployment | Primary |
| R4 | Low delivery dimension | Any DRIVER ≤2 while Overall ≥3 (an early warning, valuable at MDS) | SAFE | Deployment | Secondary |
| R5 | Stakeholder divergence | Two responses, same deployment and stage, Overall differs by ≥2 | SAFE | Deployment | Investigate only |
| R6 | Negative feedback on non-low score | Qualtrics sentiment negative on any comment while Overall ≥4 | INTERPRETIVE | Deployment | Supporting |
| RP | Segment pattern | A stage/segment's satisfaction is lower than the rest, or declined, with n≥10 on both sides | INTERPRETIVE | Portfolio | Investigate (not a deployment alert) |

### EVIDENCE_GAP — "we do not know"
| Id | Signal | Class | Level |
|---|---|---|---|
| G1 | Deployment past its MDS/PGL survey due point with no response | SAFE (due-rule validation pending) | Deployment |
| G2 | Stage coverage low for the window | SAFE | Portfolio |

Silence is not satisfaction, and it is not dissatisfaction either. A gap is a reason to chase, not a risk score.

### SURVEY_OPERATION_ISSUE — "the asking process is failing"
| Id | Signal | Class | Source |
|---|---|---|---|
| O1 | Bounced / undeliverable invitation | DIRECT | InFlight |
| O2 | Invitation expiring without completion | DIRECT | InFlight `survey_expires` |
| O3 | Due but not invited | SAFE | batch engine × InFlight |
| O4 | Cannot be scheduled — missing target dates | DIRECT | batch exceptions |
| O5 | Notification rule invalid / send failures | DIRECT | CoreNotify, distribution log |
| O6 | Responses or InFlight data stale | DIRECT | import timestamps |

Ownership differs: R-class sits with delivery leadership (DD/VP/EM), G-class with CSAT program owners plus the EM, and O-class with whoever runs the survey process (PM/admin).

## 5. Qualtrics-derived analytics

All are **QUALTRICS_DERIVED**: machine-labelled, recomputable between exports, never presented as the customer's own statement.

| Item | Classification | Rationale |
|---|---|---|
| Sentiment label (per question) | NAVIGATION/FILTER; ATTENTION_SIGNAL only as R6 (supporting) | Useful for finding comments; one label on a short comment is coarse |
| Sentiment score (−2…+2) | NAVIGATION/FILTER; aggregates **NOT_RELIABLE_ENOUGH_FOR_DECISION** | Averages of machine scores over tens of comments are not decision-grade |
| Parent topics | **EXPLANATORY** (theme counts) + NAVIGATION/FILTER | Cleanest taxonomy; comma-safe; supports "what recurs among dissatisfied" |
| Topics (raw), hierarchy L1/L2 | DETAIL_ONLY | Raw strings contain commas; granular |
| Topic sentiment label/score | DETAIL_ONLY | Per-topic machine sentiment |
| Actionability (`response needed`, `suggestions`, `other`) | NAVIGATION/FILTER (candidate ATTENTION_SIGNAL after validation) | "Response needed" is attractive but unvalidated |
| Effort (+numeric), emotion (+intensity) | NOT_RELIABLE_ENOUGH_FOR_DECISION / DETAIL_ONLY | Not validated; low interpretability for DM users |
| Sentiment polarity | Dropped | Constant in source |

## 6. Future AI — where it fits in the model

AI is never a dependency of today's product. Possible future contributions, all `AI_DERIVED`, stored in `CSAT_AI_Insights`, linked to source responses by fingerprint, and labelled *AI-generated*:

| Model slot | AI contribution | Why it needs AI |
|---|---|---|
| Q6 for a slice (window / stage / area / dissatisfied responses) | Summarise recurring reasons in plain language | Parent-topic counts are too sparse per app to tell the story |
| Q1 direction | "What dissatisfied customers in this window talked about" | Scores show *that* something moved, not *why* |
| QD | Summary of one deployment's feedback history | Several stakeholders and long comments |
| Q5 | Map comments to drivers ("comments about schedule") | Bridges words and ratings |
| R6 | Better detection of score–comment mismatch | Machine sentiment is coarse |

Rules carried over: raw comments stay authoritative and one click away; AI output is never written into `CSAT_Responses`; it is stale when the source fingerprint changes; egress only through an approved internal model (D6).

## 7. Unsupported and future-data ideas

| Idea | Status | What would be needed |
|---|---|---|
| Response-rate trend over time | FUTURE_DATA_REQUIRED | InFlight history (snapshots or an append log) |
| True go-live timing of PGL responses | FUTURE_DATA_REQUIRED | Actual go-live date in the Responses context (only the first target MTP exists today) |
| Satisfaction vs deployment health at time of response | FUTURE_DATA_REQUIRED (verify whether Trends/Momentum snapshots can supply historical health) | Health history keyed by date. Current health is usable as *context* only |
| Cross-app benchmark | FUTURE_DATA_REQUIRED | Each workbook holds only its own responses |
| Key-driver importance modelling | UNSUPPORTED at current n | Pooled multi-year data and a defined statistical method |
| Follow-up / closed-loop status on risks | FUTURE_DATA_REQUIRED (P9) | A follow-up record |
| Respondent identity ("who said it") | Gated by D3/T3 | Identity storage decision |
| Predicted satisfaction risk score | UNSUPPORTED | – |
| Effort/emotion as KPIs | NOT_RELIABLE | Validation of Qualtrics models |

# Metric semantics

Binding on all later UI, API and documentation work. Builds on [canonical-response-model.md §2](../../csat-subsystem/canonical-response-model.md) and [qualtrics-responses-contract.md §3](../../csat-subsystem/qualtrics-responses-contract.md); does not restate the storage rules.

## 1. Outcomes

| Field | Role | Semantics |
|---|---|---|
| `overall_satisfaction` (1–5) | **PRIMARY_OUTCOME** | The one cross-survey satisfaction measure. Present on 170/177 rows, in both surveys. Bands: satisfied 4–5, neutral 3, dissatisfied 1–2 |
| `nps_score` (0–10) | **PRIMARY_OUTCOME (secondary rank)**, PGL only | Advocacy, not satisfaction. A different construct on a different scale. NPS = %promoters (9–10) − %detractors (0–6), shown only at n≥10 PGL responses. Never combined with 1–5 values |
| `pgl_satisfaction`, `mds_satisfaction` | **DIAGNOSTIC_DETAIL** | Equal to Overall in 110/115 (PGL) and 40/42 (MDS) rows. As separate KPIs they mostly repeat "Overall split by stage". Keep them for the mismatch flag and for the 7 rows without Overall. Never average them together or into Overall |
| `score_scale_version` | Guard | Legacy 0–10 values are not stored; the current 1–5 fields are authoritative |

**Consequence:** "MDS satisfaction" and "PGL satisfaction" in product language mean **Overall Satisfaction for MDS responses / PGL responses**. They do not mean the survey-specific fields. This removes a source of three near-identical numbers.

Blank = null, never zero, everywhere. A response with null Overall contributes to n for the metrics it does answer, and not to satisfaction.

## 2. Satisfaction drivers and context

Population from the sample (rows populated / 177). "Both" = asked in MDS and PGL.

| Field | Population | Stage | Classification | Note |
|---|---|---|---|---|
| `team_understanding` | ~159 | both | **DRIVER** | Delivery-team behaviour; comparable across stages |
| `team_collaboration` | ~159 | both | **DRIVER** | |
| `team_responsiveness` | ~159 | both | **DRIVER** | |
| `team_technical_competence` | ~159 | both | **DRIVER** | |
| `team_guidance` | ~55 | mostly MDS | **DRIVER (MDS)** / DIAGNOSTIC_DETAIL for PGL | Mostly absent on PGL (older version) |
| `aspect_methodology` | ~98 | both | **DRIVER** | Current survey version only (~55% of rows) — always show own n |
| `aspect_schedule` | ~98 | both | **DRIVER** | |
| `aspect_communications` | ~98 | both | **DRIVER** | |
| `aspect_value` | ~98 | both | **DRIVER** | Closest to an outcome; treat as a driver with a note |
| `agree_prepared_go_live` | ~117 | PGL | **DRIVER (PGL)** | Readiness; the most delivery-specific PGL item |
| `agree_met_business_case` | ~48 | PGL | **UNRESOLVED** | Value-realisation outcome or driver? Partial population. Show in detail; decide after more data |
| `agree_sales_expectations` | ~159 | both | **CONTEXT** | Mostly about the sales cycle rather than delivery; explains low scores but is not a delivery lever |
| `agree_sales_transition` | ~42 | MDS | **CONTEXT** | Sales→delivery hand-off |
| Budget aspect, Deployment Journey aspect, `Historical - …` | sparse / none | – | **LOW_VALUE_FOR_PORTFOLIO** (not stored) | Excluded by contract |

Context dimensions (not scores):

| Field | Classification | Use |
|---|---|---|
| `survey_type` | **Structural dimension** | Always applied (stage) |
| `priming_partner_type` | **CONTEXT (critical)** | Workday- vs partner-led; MDS is Workday-led only |
| `services_approach`, `deployment_type` | CONTEXT | Segments |
| `product_areas`, `product_area_groups` | CONTEXT (§4) | Lens, non-additive |
| `respondent_role` | CONTEXT | Stakeholder perspective (customer PM vs executive sponsor) |
| `deployment_stage_at_response` | DIAGNOSTIC_DETAIL | Snapshot; 9 deployments show more than one value |
| `engagement_manager`, `partner_name` | CONTEXT (sensitive) | Segmentation only under P8 |
| `deployment_start_date`, `target_go_live_date` | CONTEXT | Lifecycle timing (§5) |
| `sub_region`, `account_*`, `survey_id` | LOW_VALUE_FOR_PORTFOLIO | Routing or identity; constant per app |

**Driver language rule.** Drivers are *rated delivery dimensions*. Allowed: "lowest-rated", "rated lower among dissatisfied responses". Not allowed without a statistical model and much larger n: "drives", "causes", "impact of", "key driver". Ratings move together (halo), so a low Overall usually comes with low drivers across the board. The informative case is a driver that is low *relative to the respondent's other ratings*.

## 3. MDS → PGL semantics

| Claim | Class | Basis |
|---|---|---|
| Each response belongs to exactly one survey stage (MDS or PGL) | OBSERVABLE | `survey_type` mandatory |
| Overall Satisfaction is the same item in both surveys and is comparable across stages | OBSERVABLE (item), **INFERRED** (equivalence) | Same field. The respondent answers mid-delivery in one case and after go-live in the other, so the frame of reference differs |
| The MDS cohort and PGL cohort in a window are different deployments | OBSERVABLE | Survey timing: MDS ≈ ⅓ through delivery, PGL ≈ go-live + 2 months |
| A portfolio "MDS vs PGL" gap shows that satisfaction falls after go-live | **UNSUPPORTED** | Cohort difference. Composition (Workday- vs partner-led, services approach, scope) differs |
| Like-for-like cohort comparison | INFERRED, acceptable with care | Restrict to Workday-led (all MDS is Workday-led: 47/0) and state n |
| The same deployment can have several responses over time | OBSERVABLE | 33 of 132 deployments have more than one (multi-stakeholder and/or multi-stage) |
| A deployment's PGL Overall minus MDS Overall = change in that customer's satisfaction | **INFERRED** | Often different stakeholders. Strongest when the same `respondent_key` answered both |
| Portfolio share of deployments that held / improved / declined | SAFE_DERIVATION, sparse | Count pairs only; currently too few per app for percentages (suppress under n≥5 pairs) |
| Why satisfaction changed between stages | **UNSUPPORTED** from scores; partially addressable by comments (T2) and future AI | |
| Deployment with MDS only | OBSERVABLE: "not yet at PGL" or "PGL not received" — distinguish using the survey-due estimate | |
| Deployment with PGL only | OBSERVABLE: "partner-led (no MDS)", or "MDS predates history" (data starts 2025-11), or "MDS not received" | |

Product meaning: **the journey is a deployment-level story with a thin portfolio summary.** At portfolio level, show stage cohorts side by side (Workday-led) and a paired-change count once pairs exist in numbers. At deployment level, show the sequence.

## 4. Product Area

`product_areas` is **Workday-sourced deployment scope captured at survey time** (provenance WD). It is not something the respondent chose, and it is not the topic of their feedback.

| Question | Supported? | Class |
|---|---|---|
| Are responses from deployments that include Area X less satisfied? | Yes, with n≥5 and "responses touching area" labelling | SAFE_DERIVATION |
| Are particular drivers weak among deployments including Area X? | Rarely at per-app n (22 tokens, ~10 groups, 28–77 responses/yr per app) | INTERPRETIVE, usually suppressed |
| Are negative comments concentrated in Area X? | Only as "comments from deployments including X". To find what a comment is *about*, use parent topics | INTERPRETIVE |
| Did Area X cause dissatisfaction? | No | UNSUPPORTED |
| Are broad-scope deployments (many areas) less satisfied? | Possibly; 94/177 responses are multi-area (up to 9) | INTERPRETIVE (derived "scope breadth") |

Roles: **filter** (yes), **segmentation lens** (yes, with suppression and non-additive labelling), **context** in deployment history (yes), **standalone headline or ranking** (no). Per-area totals never sum to the portfolio total, and are never shown as if they did. Grouping depends on decision D2 (alias map).

## 5. Time

| Time perspective | Field | Role |
|---|---|---|
| Response date | `response_ts_utc` | Primary time axis for all portfolio metrics |
| Survey stage | `survey_type` | Lifecycle position, categorical, always split |
| Lifecycle timing | days since `deployment_start_date`; days from `target_go_live_date` | INTERPRETIVE context only. The target is the *first* target MTP, not the actual go-live |
| Deployment stage at response | `deployment_stage_at_response` | Detail only |
| Invitation time | InFlight `sent_date` etc. | Operations only. Differs from response date by 3–22 days |

Windows:

- **Default portfolio window: rolling 12 months.** At per-app volume this is the smallest window that usually gives MDS and PGL each n≥10.
- **Comparison:** rolling 12 vs prior 12 needs 24 months of history (available from ~2027-11). Until then: last 6 vs prior 6 months, subject to P5.
- **Quarter:** allowed for counts and, where n≥10 per stage, for Overall. Monthly grain only for volume counts, never for satisfaction lines.
- **Deployment level:** all history, no window.
- **"Current period"** in operations means the InFlight import window, a different meaning from satisfaction windows. Label it accordingly.

## 6. Sample size and statistical humility

| Rule | Applies to |
|---|---|
| **n<5 → shown as "n<5"**, never blank or zero | Every T1 aggregate cell (segment, Product Area, driver, period, topic count) |
| **NPS requires n≥10 PGL responses** | NPS everywhere |
| **Direction requires ≥10 responses in each compared window, per stage** (P5) | Q1 change statements |
| Suppression does **not** apply to a single deployment's own responses | QD shows records, not aggregates |
| Every aggregate carries its n (and deployments d where it differs) | Everywhere |
| No significance testing | The model does not support it. Words like "significant" are banned. Use "change of x on n=..." |
| Composition note when the stage or partner mix shifts noticeably between compared windows | Q1 direction |

What the product should communicate: *"Based on 26 responses from 20 deployments."* *"Not enough responses to call a direction."* *"Includes partner-led PGL responses."* The intended reaction to a small movement is "read the responses", not "the number changed".

## 7. Coverage vs satisfaction

- **Two separate questions, always shown together, never combined.** No blended "health score", no weighting of satisfaction by response rate.
- Satisfaction (Q1) is a statement about respondents. Coverage (Q2) says how representative that statement is.
- Four readings the product must make possible:

| | High coverage | Low coverage |
|---|---|---|
| **High satisfaction** | Reliable good news | Good news from a minority. Check who has not responded |
| **Low satisfaction** | Reliable bad news. Investigate | Bad news from a minority. Investigate those responses, and chase the gaps |

- Coverage is expressed per stage: "PGL: heard from 14 of 19 deployments due".
- The current `coveragePct` in `getCsatTabDataForUI` (distinct in-flight deployments ÷ all master deployments) mixes deployments that are not due. It should **not** be presented as coverage in the new model. Its sibling `headerSummary` coverage (upcoming batch rows already invited) is an *operations* measure ("invited of due") and belongs in Survey Operations.

## 8. Analytical vocabulary

One meaning per term. Proposed for UI labels, API names and documentation.

| Term | Meaning | Avoid |
|---|---|---|
| **CSAT** | The feature: Customer Satisfaction | Renaming |
| **Satisfaction** | Overall Satisfaction (1–5) of responses | "Score" without qualifier; "CSAT score" for MDS/PGL-specific fields |
| **Satisfied / Neutral / Dissatisfied** | Bands 4–5 / 3 / 1–2 of Overall | "Happy", "at risk" |
| **NPS** | PGL net promoter score; promoter / passive / detractor | Calling NPS "satisfaction" |
| **Survey** | An instrument: the MDS survey or the PGL survey | Using "survey" for one invitation or one response |
| **Survey stage** | MDS (Mid-Deployment) or PGL (Post Go-Live) | Bare "stage" (collides with deployment stage); legacy "MGM" |
| **Deployment stage** | SFDC deployment stage (snapshot at response) | |
| **Invitation** | One survey sent to one contact (CSAT_InFlight row) | "Response", "in-flight survey" in UI copy |
| **Response** | One completed survey submission (CSAT_Responses row) | "Survey" |
| **Respondent role** | Customer PM, executive sponsor, … | Respondent name |
| **Coverage** | Deployments heard from ÷ deployments due, per survey stage | Today's `coveragePct` |
| **Response rate** | Completed ÷ delivered invitations, current InFlight window | Coverage |
| **Window** | The response-date range of a portfolio view | "Period" for the InFlight import window |
| **Direction** | Improving / stable / declining / insufficient responses | "Trend" for a single delta |
| **Driver** | A rated delivery dimension (team, aspect, readiness) | "Key driver", "impact" |
| **Customer feedback** | Free-text comments (CUSTOMER_SOURCE) | "Voice", "insights" |
| **Theme** | A Qualtrics parent topic (QUALTRICS_DERIVED) | "Topic" for parent topic; AI themes (those are AI_DERIVED) |
| **Sentiment** | Qualtrics sentiment label/score (QUALTRICS_DERIVED) | Treating it as the customer's own rating |
| **Satisfaction risk** | A rule-based customer-verdict signal (R-class) | "Needs attention" for everything |
| **Evidence gap** | A deployment due to be heard from with no response (G-class) | |
| **Survey operation issue** | A failure in the asking process (O-class) | |
| **Product Area** / **Product Area group** | Deployment scope token / configured grouping | Area "score" implying causation |
| **Satisfaction journey** | One deployment's sequence of responses across survey stages | Portfolio cohort comparison (call that **stage comparison**) |
| **Deployment CSAT history** | The deployment-level view of all of the above | |
| **Provenance labels** | *Customer comment* · *Qualtrics analysis* · *AI-generated* | Merging them |

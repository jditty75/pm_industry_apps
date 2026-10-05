# Qualtrics Responses Export — Source Contract (observed)

Sample: 177 data rows × 288 columns (45 header names occur twice → 243 distinct names), 142 columns populated, 146 never populated. Dashboard name stem `PGLandMDSSurveyDashboard-<date>-<guid>-…csv`. Counts below are aggregates from that single export.

## 1. Grain and identifiers

One row = **one completed Qualtrics survey response** (source type `survey`).

| Candidate | Observation | Verdict |
|---|---|---|
| Column 0, header `Survey_ID` | 177/177 populated, 177 unique, all `R_…` (Qualtrics ResponseID). 67/67 of the InFlight export's `Response ID` values equal it | **Canonical `response_id`**. Globally unique, immutable, source-system issued. *Header is misleading.* |
| `_recordId` | 177 unique `R_…`; equals col 0 in 176/177; the 1 mismatch is *not* the value InFlight reports | Dashboard record id; do not use as key (diverges once) |
| `_sourceId` | 2 values (one per survey: PGL, MDS) | Real `survey_id` (`SV_…`); stable per survey type |
| `_sourceMapId` | 2 values, 1:1 with `_sourceId` | Technical; ignore |
| `Response ID`, `Response ID (Text Set)`, `Distribution ID`, `Recipient ID`, `Transaction ID` | 0 populated | Unavailable in this export |
| `Deployment_ID` | 177/177, 18 chars, 132 distinct | Context key (not response identity) |
| `Account_ID` | 177/177, 18 chars, 122 distinct | Context key |
| `Contact_ID` | 174/177, 15-char; 160 distinct. In InFlight the same field is 19-char and **never equal** for the same response | **Unsafe as a key and as a join**; blank in 3 |
| Email | 177/177; mutable personal data | Not a key |
| `Responsedate (+00:00 GMT)` | 177/177, UTC `YYYY-MM-DD HH:MM:SS`; not unique (1 collision) | Event time, not key |

Recommendation: `response_id` (single column) is the identity. A synthesized composite is **not** needed. Do not reuse InFlight's `(survey_id, contact_id)`.

Cardinalities: responses per deployment 1→99, 2→24, 3→6, 4→3; per account up to 4; 13 respondents answered more than once. Same deployment appears with up to 4 responses (MDS + PGL + multiple stakeholders) — history per deployment is real.

## 2. Export / history semantics

- Response dates span **2025-11 → 2026-09** (≈11 months, 3–31/month). InFlight export covers only invitations from ≈2026-07 on.
- All 67 responses dated ≥ 2026-07-01 also appear (by ResponseID) in the InFlight export; the 110 older ones cannot (outside its window).
- Conclusion: Responses export is **a long, filter-defined window, effectively cumulative-to-date, but the window rule is not visible in the file** → treat as *unclear/rolling*. Never assume rows persist or that older exports are dominated by newer ones.
- Rows can change between exports in principle (Qualtrics text analytics and dashboard-joined attributes are recomputed). No per-response "last modified" field exists. `_cachedDate` (4 distinct values here) is the dashboard cache time — usable as an **export watermark**, not a row version.
- Deployment attributes differ per response of the same deployment (9 deployments show >1 `Deployment_Stage`) → stage is a **snapshot at response/survey time**, not current state.

Persistence semantics (ours, independent of the above): idempotent historical upsert keyed on `response_id`; never clear-and-replace; absent rows are retained.

## 3. Survey types and score semantics

`Program_Type`: `Post Go-Live Survey` 130 (PGL), `Mid-Deployment Survey` 47 (MDS). `Program Type X Priming Partner` additionally distinguishes Workday- vs Partner-led (PGL 76/54, MDS 47/0). Survey brand: 173 Workday, 3 VNDLY, 1 blank.

All current scales are **1–5, higher is better** except NPS (0–10).

| Metric (source header) | PGL pop | MDS pop | Scale | Notes |
|---|---|---|---|---|
| `Overall Satisfaction` (== `#Overall Satisfaction`, 177/177) | 125 | 45 | 1–5 | Cross-survey comparable headline; 7 rows blank (those rows carry only #PGL/#MDS) |
| `#PGL Satisfaction` | 115 | 0 | 1–5 | Equals Overall in 110/115; differs in 5 → keep both, flag mismatch |
| `#MDS Satisfaction` | 0 | 42 | 1–5 | Equals Overall in 40/42; 5 MDS rows have Overall but no #MDS |
| `Post_Go-Live_NPS` | 120 | 0 | 0–10 | PGL only; 10 PGL rows blank. Categories derived: 9–10 promoter, 7–8 passive, 0–6 detractor |
| Aspect: Methodology / Schedule / Communications / Value | 68 | 30 | 1–5 | Present only on rows using the current survey version |
| Aspect: Budget Management | 8 | 3 | 1–5 | Legacy; too sparse → excluded |
| Aspect: Deployment Journey | 0 | 0 | – | Never populated |
| Team: Understanding / Collaboration / Responsiveness / Technical Competence | 117 | 42 | 1–5 | Comparable across surveys |
| Team: Guidance | 13 | 42 | 1–5 | PGL mostly absent (older version) |
| Agreement: Set Appropriate Expectations in Sales | 117 | 42 | 1–5 | Agreement-style (disagree→agree) |
| Agreement: Prepared to Go Live | 117 | 0 | 1–5 | PGL only |
| Agreement: Met Objectives of Business Case | 48 | 0 | 1–5 | PGL only, partial |
| Agreement: Transition from Sales | 0 | 42 | 1–5 | MDS only |
| `Historical - …` (≈24 columns) | ≤15 | ≤5 | 0–10 | Legacy survey version; only 20 rows (2025-11→2026-01), all of which also carry current 1–5 fields → treated as redundant. A `score_scale_version` flag marks them |

Rules: blank = not asked / not answered (never zero). Do not average across different metrics or blend NPS with 1–5. Never compare 0–10 legacy values with 1–5 values.

Recommended roles: **Top-level KPI** — Overall Satisfaction (mean + % favorable 4–5, with n), NPS (PGL only), response count. **Portfolio analytics** — PGL and MDS satisfaction shown side by side; aspects/team/agreements as small-multiples. **Deployment detail** — everything chronologically. **Filter/dimension** — survey type, scale-version. **Future only** — alert type, legacy values, budget.

## 4. Product Area (first-class dimension)

- `Product Area` (col 282): 177/177, comma-delimited, 22 distinct tokens, no commas inside tokens, no repeats within a row; 83 rows single-valued, 94 multi-valued (up to 9).
- `Product_Areas` (col 41): only 87 populated, differs from col 282 in 10 rows, one row repeats a token → use col 282; col 41 is redundant.
- Aliases that overlap conceptually: Financials/Financial Management, Planning/Adaptive Planning, Talent Optimization/Talent Management, Core HCM/Human Capital Management, Prism Analytics/Analytics and Reporting.
- Relationship to DM concepts: unrelated to `ProductMode` (an app-level mode that swaps Industry grouping for Region). Product Area is a response-level dimension.
- Canonical form: ordered, de-duplicated list stored as `|`-joined `product_areas` **plus** a config-driven alias map to `product_area_groups` (e.g., HCM, FINANCIALS, SPEND, PLANNING, ANALYTICS, TALENT, WORKFORCE, PAYROLL, PLATFORM, SPECIALTY). A response contributes to **each** of its groups in per-area views; per-area counts are therefore non-additive and the UI must show "responses touching area", with portfolio totals computed from the unexploded rows.

## 5. Free-text questions

| Canonical | Header | PGL | MDS | Len avg/max | Newline rows |
|---|---|---|---|---|---|
| comment_reasons | `What_are_the_main_reasons_for_your_score?` | 85/130 | 35/47 | 342 / 2,357 | 17 |
| comment_improve | `What_could_we_improve_moving_forward?` | 0 | 34/47 | 205 / 591 | 2 |
| comment_working_well | `What_is_working_well_that_you_would_like_to_continue?` | 0 | 33/47 | 107 / 287 | 0 |
| comment_additional | `Is there anything else you'd like to share with us?` | 64/130 | 0 | 406 / 3,991 | 7 |

Null = not answered. Text and its Qualtrics analytics are always present together (text pop == analytics pop for all four). No URLs/HTML/formula-leading text in this sample — defenses are still mandatory (see canonical model §6).

## 6. Qualtrics-derived analytics (per question)

Per question the export carries: Topics, Parent Topics, Sentiment (label), Sentiment Score (−2…+2), Sentiment Polarity (constant 0 where populated → useless), Topic Sentiment Label/Score (per-topic, delimited), Actionability (`other`/`suggestions`/`response needed`), Effort (+ numeric), Emotion (+ intensity), Topic Hierarchy L1/L2.

Structural gotchas:
- **Duplicated headers.** The first three questions' analytics blocks appear twice (cols 54–94 and 95–135); only the **second** is populated here (125 rows), the first is empty. Also `Email`, `Survey Metadata - User Language`, `Email Sent`, `Distribution ID` repeat. Parsing by header name alone loses data or picks the empty twin → transformer must be position-aware and *coalesce* duplicates.
- **Comma-delimited topics contain commas** (e.g., a taxonomy name with an internal comma, 34 rows). Do not split `Topics` on commas. `Parent Topics` and hierarchy L1/L2 are cleaner.
- Sentiment is machine-labelled and may be recomputed by Qualtrics; treat as mutable `QUALTRICS_DERIVED`.

Persistence verdict: sentiment label, sentiment score, parent topics → stable & useful now. Topics, hierarchy, actionability, effort, emotion, intensity, per-topic sentiment → keep, but packed in one JSON column (rich, low cost, not UI-critical). Polarity → drop.

## 7. Routing evidence

`Sub Region` (Responses): US Healthcare 77 → HC_DM; Government 28 → SLG_DM; Higher Ed & Student 72 → HENP_DM; no blanks; every deployment has exactly one sub-region. Note: InFlight reports the same population as `US SLED`; the Responses export already carries the SLED split, so no fan-out is needed. Rows for a deployment can be validated against the destination's deployment universe in DepMngr (see canonical model §8 — the universe must include **non-Active** deployments).

## 8. Data-quality observations (for validation rules)

3 blank Contact_ID; 1 blank Survey Brand; 1 row where `_recordId` ≠ col 0; 1 duplicate timestamp; `Delivery_Assurance_Type` is a placeholder in 119/129 populated; `Alert_type` blank in 9 rows and mislabelled in 1; 7 rows lack Overall Satisfaction; `Test Data Flag` never populated (reject rows if ever "yes").

## 9. Relationship to InFlight (same dashboard, different filter)

Both files have identical headers. InFlight: `Survey_ID` = `SV_…` (2 values), `_sourceType` = `des-qds`, 597 distribution rows, `Response ID` populated in 67. Responses: `Survey_ID` = `R_…` unique, `_sourceType` = `survey`.

| Join | Evidence | Class |
|---|---|---|
| Responses.response_id ↔ InFlight `Response ID` | 67/67 match (66 by `_recordId`) | **RELIABLE** where InFlight has it (≈ last 3 months), but CSAT_InFlight does not store it today |
| deployment_id (+ survey_type) | Account/Deployment/Program equal on 66–67/67 | **USE_AT_DEPLOYMENT_LEVEL_ONLY** (many-to-many) |
| Contact_ID | 0/67 equal, different formats | **UNSAFE** |
| Email | 67/67 equal | UNSAFE as key (PII, mutable); fine for human review only |
| Dates | Responsedate differs on 67/67 (InFlight = invitation time; −3…−22 days) | **UNSAFE** |
| Sub Region / Product / Stage / Alert | differ on 40 / 32 / – / – of 67 | Never join on attributes |

CSAT must render Responses without any InFlight row.

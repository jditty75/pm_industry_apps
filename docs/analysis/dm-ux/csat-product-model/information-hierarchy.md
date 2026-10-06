# Information hierarchy (layout-independent)

## 1. Monitor / Investigate / Operate

This distinction is more useful than any list of sections. Each mode has a different user intent, cadence, data domain and owner.

| Mode | User intent | Cadence | Data | Primary home |
|---|---|---|---|---|
| **MONITOR** | "Tell me the state of customer satisfaction across my portfolio, and whether anything needs me." | Weekly, or on arrival | Responses aggregates + coverage + risk/gap/issue counts | **Overview** |
| **INVESTIGATE** | "Explain this signal: which deployments, which dimensions, what did customers say?" | When a signal or question arises | Responses records, drivers, segments, comments (T2) | **Responses** and **Deployment CSAT history** |
| **OPERATE** | "Make sure surveys go out, arrive, and get answered." | Daily / per batch | InFlight, batch engine, notifications, imports | **Survey Operations** |

Movement goes Monitor → Investigate → (DM action), and separately Operate ⇄ Evidence gaps. Operations data never sits inside satisfaction analysis. It appears only as counts linking across.

## 2. Hierarchy

**PRIMARY** — what CSAT is for. Every monitoring visit sees it.

1. **Satisfaction by survey stage, with its evidence base.**
   One inseparable unit: satisfied/neutral/dissatisfied for MDS and PGL in the window, with n responses, d deployments, coverage of due deployments, and data freshness.
2. **Satisfaction risks.**
   The deployments with active R-class signals in the window (primarily R1 and R3), each with its triggering fact.

**SECONDARY** — qualifies or explains the primary information. Shown in summary form when monitoring.

3. **Direction.** Improving / stable / declining / insufficient responses, per stage, under rule P5.
4. **Journey summary.** Workday-led stage comparison; paired-change counts once there are enough pairs.
5. **Weakest and strongest delivery dimensions.** A pointer to the one or two drivers that stand out, not the full profile.
6. **NPS (PGL).** Advocacy, n≥10.
7. **Evidence gaps and survey operation issues: counts only**, each linking to its own destination.

**SUPPORTING** — used during investigation.

8. Full driver profile by stage; dissatisfied-response driver profile.
9. Segment lenses: priming partner type, services approach, deployment type, Product Area group, respondent role.
10. Customer feedback: comments in context (T2), themes (parent topics), sentiment as a filter.
11. Response list for any slice; deployment CSAT history.

**DETAIL-ONLY** — available on a single response or deployment, never summarised.

12. Survey-specific satisfaction fields and mismatch flag; deployment stage at response; lifecycle timing; raw topics, hierarchy, actionability, effort, emotion, topic sentiment; lineage (revision, import job); `score_scale_version`.

## 3. Portfolio vs deployment

| Content | Portfolio only | Deployment only | Both | Portfolio signal → deployment evidence |
|---|---|---|---|---|
| Satisfaction by stage | | | | ✔ |
| Coverage | | | | ✔ (gap list) |
| Direction | ✔ | | | |
| Satisfaction risks | | | | ✔ |
| Stage comparison | ✔ | | | |
| Satisfaction journey | | ✔ | | |
| Driver profile | | | ✔ | |
| Segment lenses | ✔ | | | |
| Customer feedback | | | ✔ | |
| Themes | ✔ (counts) | | | ✔ (comments) |
| Survey state per stage | | ✔ | | |
| Survey operation issues | | | ✔ | |
| NPS | ✔ (score) | ✔ (category) | | |

Rule: **every portfolio statement must be traceable to the deployments and responses behind it in at most two steps.**

## 4. T1 / T2 / T3

| | T1 aggregate-safe | T2 response detail and comments | T3 respondent identity |
|---|---|---|---|
| Fully answers | Q1, Q2, Q3 (score signals), Q4, Q5, QD (scores/roles/signals), O1 | Q6; the meaning of R6; full response detail | Not stored in Responses V1 |
| Data | Counts, bands, means, NPS, coverage, driver ratings, deployment + role + score per response | Comment text, per-question sentiment and topics, `qx_analytics_json` | Name/email/contact id |
| Contested (decisions) | Comment-derived flags and theme counts (P6) | – | Inferable via Survey Operations contacts on single-respondent deployments (P7) |

Notes:
- A T1 user gets a complete, honest CSAT product, because scores, risks, journey and drivers are all T1. T2 adds the *why*, not the *what*.
- T2 is a server-side boundary: comment content is absent from T1 payloads, and is fetched by a separate permission-checked call.
- Per-response rows at T1 combine deployment, role and score. That is standard for DM's internal audience, but it is quasi-identifying for single-respondent deployments (P7).

## 5. What NOT to show prominently

These are valid data that should not become first-class portfolio signals:

| Item | Why not prominent | Where it belongs |
|---|---|---|
| PGL Satisfaction and MDS Satisfaction **as separate fields/KPIs** | ~95% identical to Overall on their own stage; three near-identical numbers | Detail (mismatch flag) |
| Satisfaction mean to two decimals | False precision at n of tens | Use bands and counts; at most one decimal for the mean |
| Monthly satisfaction trend lines per app | 2–7 responses a month per app; noise | Quarterly or rolling only, n-gated |
| NPS as a co-headline | PGL-only, different construct, needs n≥10 | Secondary |
| Invitation open rate | Email mechanics | Survey Operations |
| Today's `coveragePct` (in-flight deployments ÷ all deployments) | Denominator includes deployments that are not due | Retire / replace with coverage |
| Product Area rankings or bars | Non-additive, scope ≠ cause, most cells n<5 per app | Lens in Responses |
| Full 13-driver grid | Overload; halo-correlated | Responses |
| Sentiment averages / trends; emotion; effort; actionability | Machine-derived, not decision-grade | Filters or detail |
| Raw topic counts | Granular, comma-contaminated | Detail |
| Partner or EM league tables | Small n; evaluates individuals | Responses lens under P8, never ranked |
| Respondent-role split as a KPI | Context, not outcome | Lens |
| Total responses ever / response-count growth | Vanity; measures survey volume, not satisfaction | Evidence base n only |
| Deployment stage at response, deployment type, services approach as headline | Context dimensions | Lenses / detail |
| Legacy 0–10 and budget aspect | Not stored / sparse | Nowhere |

# Navigation model

Derived from the hierarchy in [information-hierarchy.md](information-hierarchy.md), not from earlier prototypes. CSAT stays one top-level DM tab.

## 1. Recommendation

```
CSAT
├── Overview            MONITOR      Responses + coverage + counts     T1
├── Responses           INVESTIGATE  CSAT_Responses                    T1, feedback view T2
└── Survey Operations   OPERATE      CSAT_InFlight, batches, rules     T1 (+ operational contact data)

Deployment CSAT history — shared, deployment-level; opened from Overview, Responses,
Survey Operations and DM deployment detail. Not a section.
```

Three sections replace the earlier four (Overview | Survey Tracking | Responses | Customer Feedback).

## 2. Why each section deserves to exist

| Section | Purpose | Primary questions | Data | Tier | Drill-down | Why it exists |
|---|---|---|---|---|---|---|
| **Overview** | Summarise the CSAT product model: state, evidence base, and what needs a person | Q1, Q2, Q3 summary; Q4/Q5 pointers; counts for G/O | Responses aggregates; coverage; counts from InFlight/batches | T1 | → Responses (pre-filtered), → deployment history, → Survey Operations (pre-filtered) | MONITOR is a distinct intent and needs both domains summarised in one place |
| **Responses** | Investigate what customers said: any slice, any dimension, down to individual responses and their words | Q1 detail, Q3 full, Q4, Q5, Q6 | CSAT_Responses (+ deployment context) | T1; feedback view T2 | → deployment history, → response detail (T2) | INVESTIGATE needs records, lenses and evidence together, with shared filters |
| **Survey Operations** | Run the survey process | O1, plus G-class gap lists | InFlight, batch engine, notifications, import | T1 (+ contacts, P7) | → invitation, → deployment history | OPERATE has different users, actions and data; keeping it separate prevents confusion with satisfaction results |

Survey Operations keeps today's working sub-areas (Upcoming, In-Flight, Notifications, Import). That is the one place where a second navigation level is justified, and it already exists.

## 3. Alternatives considered

| Alternative | Verdict | Reason |
|---|---|---|
| Four sections incl. standalone **Customer Feedback** | Rejected | Comments answer "why" relative to a signal or slice. Per-app corpus is tens of comments a year; a standalone destination would be thin and disconnected from scores. T2 isolation does not need its own tab (§4) |
| Two sections (Overview folded into Responses) | Rejected | Monitoring must combine both domains (coverage uses InFlight and batches); a record-centric landing buries the state |
| Survey Operations moved out of CSAT (settings/admin) | Rejected | The same CSAT owners run it daily; coverage gaps link into it |
| **Journey** as a section | Rejected | It is a lens of Responses at portfolio level and a sequence in deployment history |
| **Drivers** / **Product Area** sections | Rejected | Lenses within Responses |
| AI Insights section or disabled placeholder | Rejected | Future AI is a slot within Responses/deployment history, labelled, when it exists |
| Rename Responses to "Results"/"Satisfaction" | Not recommended | "Responses" matches the data object and DM's record-plus-analysis idiom (as on Deployments). "CSAT › Satisfaction" is redundant |

## 4. Customer feedback placement — decision: hybrid (C + B)

- **Primarily contextual (C):** every signal, slice and deployment history offers "read what customers said" for exactly the responses behind it.
- **Integrated into Responses (B):** a **feedback view** of Responses (comments for the current filter set, grouped by question, with theme and sentiment filters) for practice-level browsing.
- **Not a dedicated section (not A).**
- Security is unchanged: the feedback view and any comment reveal are separate server calls checked at T2, and are absent (not hidden) for T1 users and when `ui.csat.feedback.enabled` is off. This meets the requirement in [csat-ux-requirements.md](../csat-ux-requirements.md) that comments come from a distinct permission-checked surface, without spending a top-level CSAT section on it.

## 5. Semantic definition — CSAT Overview

**Job:** answer, in under a minute, *"Is customer satisfaction across my portfolio sound, how much should I trust that, and which customers need me?"*

**Answers:**
- Satisfaction by survey stage for the window, as bands with counts (P1), with n, deployments and coverage attached.
- Direction per stage, or an explicit statement that responses are too few.
- Satisfaction risks: which deployments, and the one fact that triggered each.
- One-line journey reading (Workday-led stage comparison; paired declines count when available).
- The weakest delivery dimension(s), as a pointer into Responses.
- NPS (PGL) at n≥10.
- Counts of evidence gaps and survey operation issues, each pointing to its destination.
- Window, scope (partner inclusion, P4) and data freshness, stated.

**Intentionally does not answer:** why (comments, themes), any segment breakdown (Product Area, partner, services approach), full driver profile, the invitation pipeline, individual response detail, historical charts beyond the direction statement.

**Minimum information:** stage-split satisfaction with evidence base; satisfaction-risk list; G/O counts. If only these render, Overview has still done its job.

**Drill-down destinations:** Responses (pre-filtered to the window/stage/signal/driver); Deployment CSAT history; Survey Operations (pre-filtered to gaps or issues).

**Information overload would be:** more than one representation of the same satisfaction number; separate MDS-/PGL-specific satisfaction fields beside Overall; equal-weight tiles for coverage, response rate and satisfaction; monthly lines; Product Area charts; comment text or sentiment summaries; more than ~2 driver mentions; mixing O-class issues into the risk list; any figure without its n.

**Empty/reduced states (semantic):** no responses in window; responses below thresholds (show records, not aggregates); `responses.enabled` off (CSAT opens on Survey Operations and Overview is absent); T1-only user (no change to Overview, which is T1 by design).

## 6. Semantic definition — Responses

**Is both** a historical record browser and the analytical investigation surface. Records and analysis are one thing here: every aggregate is a summary of the records listed under the same filters.

- **Arrive from:** an Overview signal (pre-filtered); a question with no signal ("how are partner-led PGLs doing?"); practice review; a link from deployment detail.
- **Questions that belong here, not on Overview:** segment comparisons; full driver profile; stage comparison detail and paired journeys; Product Area lens; the complete risk list incl. R4–R6 and stakeholder divergence; feedback and themes (T2); any custom window.
- **Contents (semantic):** shared filters (window, stage, partner type, services approach, deployment type, Product Area group, role, signal, satisfaction band, driver threshold); aggregates for the filter set (with n and suppression); the response list (T1 columns: date, deployment, stage, role, Overall, NPS, low drivers, signals, "has feedback" per P6); feedback view (T2).
- **Not here:** invitation pipeline; notification management.

## 7. Semantic definition — Survey Operations

Recommended name **Survey Operations** (P10; "Survey Tracking" acceptable).

- **Purpose:** ensure every deployment is surveyed at MDS and PGL, that invitations arrive, and that non-responses are chased.
- **Users:** CSAT program owners / PMs (ADMIN), DD/VP for oversight (POWER_USER).
- **Questions:** What is due in the next 3–6 months? What has been sent, opened, completed, or bounced? What is expiring? Which deployments are due but not invited, or due and not heard from? Are notification rules valid and sending? Is data fresh?
- **Actions:** fix contacts or target dates at source; manage and test notification rules; manual upload; export the invitation list.
- **Relation to Overview:** supplies the coverage context and the G/O counts; Overview links in, pre-filtered.
- **Relation to Responses:** none directly. A completed invitation points to the deployment's history, not to a response row (no `response_id` join; P7).

## 8. Deployment CSAT history (shared, not a section)

The investigation unit. Semantic content: survey state per stage, the response sequence with scores/role/signals, comments (T2), and current DM context. Hosted in Responses drill-in and in DM deployment detail. Its host surface is decided in the separate deployment-detail work and is not designed here.

## 9. Per-app reduction

| Condition | CSAT shows |
|---|---|
| `csat.enabled` off (EVI, PDX, HS today) | No CSAT tab |
| Responses not enabled / no `CSAT_Responses` | Survey Operations only |
| Responses enabled, feedback off or role < T2 | Overview, Responses (no feedback view), Survey Operations |
| All enabled, T2 role | Full model |
| READ_ONLY / `viewAs=READ_ONLY` | No CSAT (unchanged) |

# UI data-needs inventory (prototype phase)

Prototype uses synthetic fixtures only. When moving to R3/production UI, the following data shapes will be required. **Not API designs** — endpoint naming and server enforcement are out of scope for Phase 1.

## T1 aggregate needs

- Portfolio response count for filter scope (date, survey type, Product Area, deployment/account).
- Overall Satisfaction mean and % favorable (4–5), with cell-level n&lt;5 suppression.
- MDS Satisfaction and PGL Satisfaction as separate aggregates (never blended).
- NPS (PGL-only, n≥10 gate; otherwise low-n treatment).
- Product Area breakdown labeled non-additive (“responses touching area”).
- Trend series for Overall and survey-specific satisfaction.
- Attention/risk signal list (deployments with low recent scores or declining trend).
- Survey Tracking operational KPIs (sent, opened, started, completed, bounced) and in-flight rows.

## T2 response-detail needs

- Historical response rows: deployment/account, survey type, dates, Overall + survey-specific satisfaction, NPS (PGL), Product Areas, attention cues (no full comments in dense table).
- Response detail: full score breakdown, Product Areas, link to feedback.
- Customer Feedback: verbatim comments by question group, deployment/survey context, Qualtrics sentiment/topics (explicitly labeled, never merged with customer text).
- T1 must not receive comment bodies; T2 must receive them with server-side enforcement (prototype simulates via tier toggle).

## Deployment-detail needs (Concept B)

- Summary: account, stage, partner, services approach, dates, health status strip.
- Timeline: go-live, overrides, CSAT send/response markers on one chronology (MDS vs PGL distinct).
- CSAT section: per-deployment response list; T2 comments in drawer.
- Notable / Escalations / Student / Overrides sections when enabled per app config.
- Same drawer content regardless of entry point (Deployments, CSAT, Notable, etc.).

## Survey Tracking needs

- In-flight and upcoming batch rows with lifecycle metrics.
- Notification management status (errors badge).
- Manual upload as admin action metadata (not dominant UX).

## Access tier evaluation

- Extend current role/visibility to T1 vs T2 comment access for Customer Feedback and drawer CSAT comments.
- Restricted states must be coherent (not empty/broken panels).

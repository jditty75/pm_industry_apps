# V1 / V1.1 / Future scope

Rule: the ideal future must not block a useful V1. V1 uses existing DM data, current `CSAT_InFlight`, current `CSAT_Responses` (canary-proven on SLG), and safe derivations only. Every V1 item names its data class from [data-gaps.md](data-gaps.md).

## CSAT redesign V1

| # | Capability | Objective | Data | Notes |
|---|---|---|---|---|
| V1-1 | **Upcoming on programme rules**: MDS ⅓ of Start → First Target MTP; PGL First MTP Actual + 2 months, any status; eligibility exclusions; one MDS and one PGL per deployment; subsequent go-lives as context | O1 | DERIVABLE (DG-01/02/03) | Requires confirmations DG-14 and `firstMtpDate` meaning. Changes existing Upcoming behaviour → separately authorized CoreLib release |
| V1-2 | **Preparation facets**: prepare-by (open − 14 d), exclusion-request deadline (open − 4 d), dates present, contacts present by role, MDS/PGL MM-YY for the customer slide | O1 | AVAILABLE_NOW / DERIVABLE (DG-07) | "Present", never "confirmed" or "ready" |
| V1-3 | **Lifecycle state per deployment × survey** (`NOT_IN_SCOPE`, `CANNOT_FORECAST`, `UPCOMING`, `IN_FLIGHT`, `RESPONDED`, `CLOSED_NO_RESPONSE`, `LAUNCH_NOT_SEEN`) computed at read time from batch engine + InFlight + Responses | O1, O2 | DERIVABLE | No new storage |
| V1-4 | **In-flight detail**: per-contact awaiting / opened / bounced / responded; closes in N; all-bounced; EM mismatch | O2 | AVAILABLE_NOW / DERIVABLE (DG-09) | Contacts POWER_USER+ only (unchanged) |
| V1-5 | **Alert class and follow-up expectation** per response (current VoC rules), expected owner role, "tracked in Qualtrics"; Workday-led only | O2, O4 | DERIVABLE | Never "overdue", never owner/status controls |
| V1-6 | **Programme measure**: Workday-led Top-2 Box DSAT per survey, NPS (PGL, n≥10), with responses, deployments and estimated coverage; partner-led PGL reference | O4 | AVAILABLE_NOW | Subject to J1/J2; reconcile with Qualtrics Key Metrics on one app before release |
| V1-7 | **Customer concern list**: deployments with Detractor responses (and MDS → PGL declines) in window | O4 | AVAILABLE_NOW | Replaces R1/R3/R4/R6 triggers (see reconciliation) |
| V1-8 | **Responses**: records + lenses + delivery ratings (question-mapping rules, per-survey labels); feedback view T2 (as product model) | O3 | AVAILABLE_NOW | DG-15 caveat on two fields |
| V1-9 | **Deployment CSAT history** (forecast, invitations, responses, follow-up expectation, trajectory) | O4 | AVAILABLE_NOW / DERIVABLE | Host: CSAT drill-in; deployment-detail host decided in whole-app work |
| V1-10 | **Navigation** `Overview | Surveys | Responses` (+ Survey settings) | all | – | Subject to J3 |
| V1-11 | Evidence gaps: due (estimated) without response; closed without response while in window; launch not seen; cannot forecast | O1, O4 | DERIVABLE | "Estimated due" wording until DG-10 |

**Explicitly not in V1:** follow-up status/owner/outcome; invitation history beyond the InFlight window; AI; theme/sentiment on Overview; case management; DM-side edits to SFDC/Qualtrics; perspective divergence; EM/partner rankings.

**V1 prerequisites (questions, not builds):** DG-13 (partner MDS scope; partner Detractor ownership), DG-14 (services-approach vocabulary), `firstMtpDate` meaning, DG-15 (two field mappings), DG-21 (calendar defects), and one reconciliation of DM's programme measure against Qualtrics Key Metrics for one app/month.

## V1.1 / next (small integrations, material workflow gains)

| # | Capability | Needs | Value |
|---|---|---|---|
| N1 | **CLFU ticket export** → follow-up status, actual owner, closed date, main reason, outcome | Qualtrics export via EDM (new pipeline descriptor, same pattern as Responses) | Closes the loop in DM's view; adds root-cause learning (PRACTICE_LEARNING) |
| N2 | **Invitation history** (append-only state snapshots, no contact PII) | DM/EDM change | Durable non-response and bounce history; response-rate trend |
| N3 | **Preparation reminders anchored to prepare-by** (re-anchor or add rule type) | `CoreNotify` change (after verifying current intent, DG-06) | Proactive Objective 1 delivery to EMs |
| N4 | **Perspective divergence** (internal health vs latest customer verdict, with dates) | Logic only | Deployment-health insight across lenses |
| N5 | **Like-for-like stage comparison** with eligibility-matched PGL cohort | DG-14 resolved | Defensible MDS vs PGL reading |
| N6 | Forecast reconciliation against the SFDC estimator, as a data-quality indicator | DG-04 | Trust |

## Future

| Capability | Requires |
|---|---|
| Exact survey-due population per round (true coverage) | Qualtrics round-population export |
| AI summaries (deployment feedback history; slice themes; CLFU reason synthesis) | `CSAT_AI_Insights` design (exists), D6 approval, approved model |
| Cross-app (industry) benchmarks | Shared store across workbooks |
| CSAT contribution to a DM-wide deployment-detail surface and cross-lens attention | Whole-app review ([dm-design-principles.md](dm-design-principles.md)) |
| Historical internal health at response time | Health snapshots (verify Trends/Momentum) |
| Respondent-level linking | T3 decision (not recommended) |

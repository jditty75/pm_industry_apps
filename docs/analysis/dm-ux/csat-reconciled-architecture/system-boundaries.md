# System-of-record / system-of-action boundaries

## 1. Boundary matrix

| Concern | SFDC | Qualtrics | EDM | Deployment Manager |
|---|---|---|---|---|
| Deployment dates (Start, First Target MTP, First MTP Actual), status, services approach, priming partner, EM, sponsor/DD | **SOURCE_OF_TRUTH**, **ACTION** (EM edits) | Receives via automated feed (copy at launch) | – | VISIBILITY (SFDC export sheets); TRANSFORMATION (eligibility + forecast) |
| Scorecard customer contacts (PM, Exec Sponsor, email) | **SOURCE_OF_TRUTH**, **ACTION** (EM; Services Care case) | Copy at launch | – | VISIBILITY; TRANSFORMATION (contact readiness) |
| Eligibility and survey month | Inputs | **SOURCE_OF_TRUTH** for who is actually invited (the feed's rule) | – | TRANSFORMATION (forecast that must agree with the VoC rule and SFDC estimator); VISIBILITY |
| Survey calendar (open, reminders, close) | – | **SOURCE_OF_TRUTH** (VoC publishes) | – | Encoded copy (`CoreSurveySchedule` FY27 verbatim + projection) |
| Exclusions / resends / reassignment | – | **ACTION** by VoC team (Slack request, 24 h SLA) | – | VISIBILITY of deadlines and conditions only |
| Invitations, delivery, bounce, open, finish, expiry | – | **SOURCE_OF_TRUTH** | TRANSFORMATION (InFlight CSV → canonical rows; route by sub-region) | VISIBILITY (`CSAT_InFlight`, current window); TRANSFORMATION (lifecycle state) |
| Responses: scores, comments, themes, sentiment | – | **SOURCE_OF_TRUTH** (customer + Qualtrics-derived) | TRANSFORMATION (288 cols → `csat-response-v1`; routing) | Stores canonical copy (`CSAT_Responses`, upsert, retained); VISIBILITY; TRANSFORMATION (alert class, aggregates) |
| CLFU alerts / tickets: owner, status, emails, reason, outcome | – | **SOURCE_OF_TRUTH**, **ACTION** | (future: ticket export pipeline) | VISIBILITY of *expectation* (derived) in V1; of *status* only after integration |
| Programme reporting (Key Metrics, Driver Questions, Partner Results, Response Rates, Close Loop Outcomes) | – | **SOURCE_OF_TRUTH** for official programme figures | – | Reconcilable **subset** in deployment context. Not a replacement |
| Deployment context: internal health, go-lives, Notable, Executive Watch, Health Plan, overrides, escalations | Partly (health/status) | – | – | **SOURCE_OF_TRUTH** for DM-owned constructs; **ACTION** (Notable, Executive Watch, Health Plan) |
| EM pre-survey reminders and DD digest | – | – | – | **ACTION** (DM-owned `CoreNotify` `em_reminder_*`, `dd_digest`) |

Principles:

1. **DM never edits SFDC or Qualtrics data.** Every CSAT fix happens at source. DM states *what* to fix, *where*, and *by when*.
2. **DM owns the pre-launch horizon.** No other system combines forecast, readiness and deployment context in one place for a portfolio. The SFDC estimator is per-report, and Qualtrics only knows a survey after launch. This is DM's distinctive contribution to Objective 1.
3. **DM owns deployment context for customer evidence.** Qualtrics knows the response. DM knows the deployment's health, history and other lenses. This is DM's distinctive contribution to Objective 4.
4. **DM reduces navigation to Qualtrics for understanding, not for action.** Reading a response, a deployment's history or a portfolio state should not require Qualtrics. Sending an acknowledgement, reassigning or closing a ticket always happens in Qualtrics.
5. **Programme figures must reconcile.** For the same scope and window, DM's Top-2 Box and NPS must equal Qualtrics Key Metrics, apart from documented differences: universe (DM excludes deployments not in its SFDC master), import timing, and restated history. Any unavoidable difference is labelled.

## 2. Closed-loop follow-up (CLFU) boundary

Proposed model, now **validated with one refinement**: *DM provides visibility and context. Qualtrics remains the system of action for CLFU.* The refinement: DM can derive the **expectation** of follow-up, but not its **completion**. It must not present derived expectations as overdue or open work.

| CLFU element | What DM should know | Class | V1 treatment |
|---|---|---|---|
| Acknowledgement required | Every MDS response (any score) | `CURRENT_DATA_AVAILABLE` (derivable from Responses) | "Acknowledgement expected · in Qualtrics" |
| Detractor follow-up required | DSAT ≤3 or NPS ≤6 (MDS or PGL) | `CURRENT_DATA_AVAILABLE` (derivable) | "Detractor follow-up expected · in Qualtrics" |
| No action required | PGL Passive/Promoter | `CURRENT_DATA_AVAILABLE` (derivable) | "No follow-up required" (prevents false attention) |
| Responsible role | Detractor → Deployment Sponsor (else DD), may reassign to EM; MDS P/P → EM | `CURRENT_DATA_AVAILABLE` for the *expected* role and names (DM contacts) | "Owner per programme: Deployment Sponsor" |
| Actual owner (after reassignment) | Ticket owner | `QUALTRICS_ONLY` → `FUTURE_INTEGRATION_CANDIDATE` | Not shown |
| Expected timing | 5 business days **of ticket assignment** | Approximate (`CURRENT_DATA_AVAILABLE` from response date; assignment time is `QUALTRICS_ONLY`) | "Expected within ~5 business days of the response". Never "overdue" |
| Alert / ticket state | Open, In Progress, Overdue, Escalated, Closed | `QUALTRICS_ONLY` → `FUTURE_INTEGRATION_CANDIDATE` | Not shown. Link to the Qualtrics ticket view (no deep link per ticket: ticket key is not in our data) |
| Completed follow-up, reason, outcome | Main reason, root cause, outcome, "Customer Not Reached" | `QUALTRICS_ONLY` → `FUTURE_INTEGRATION_CANDIDATE` (**highest value**: practice learning) | Not shown in V1 |
| Sending acknowledgement / detractor emails; reassigning; closing | – | `DM_SHOULD_NOT_OWN` | Never in DM |
| DM-side case management (owner, status, notes, reminders on follow-up) | – | `DM_SHOULD_NOT_OWN` | Rejected: it would create a second, unsynchronised ticket system. Resolved P9 ("no case management") is **kept** |
| Escalation of a customer concern into DM's own constructs (Notable, Executive Watch, Health Plan) | – | DM-owned action (already exists) | Allowed. Unchanged from the product model |

**Why not more in DM:** the guidebook makes Qualtrics the place where the email is sent, where the reassignment happens and where the root cause is recorded (GB-31–36). Every one of those is an action with an audit trail in Qualtrics. A DM copy would drift, and leaders would see two statuses.

**Why not less:** without the expectation, a DM user reading a Detractor in deployment context cannot tell whether anything is supposed to happen. The guidebook's 100% MDS / 100% PGL-Detractor goal (GB-29) is a programme rule, so DM can state it truthfully.

**Partner-led:** CLFU is labelled *ProServ only* in the guidebook. V1 shows follow-up expectations for Workday-led deployments only (DG-13).

## 3. Existing DM behaviour to reconcile (no change made here)

| Behaviour | Observation (static source reading) | Implication |
|---|---|---|
| `getMdsPglBatchView` | Active-only; Student excluded; MDS per product target date (fallback current MTP); PGL per product actual date (fallback current MTP); no >16-week, services-approach or name exclusions; no priming-partner filter | DM's Upcoming diverges from the VoC rule (DG-01/02/03). The V2 assumption "batch engine defaults to Workday-led scope" is **not supported** by the code read: no leadership filter was observed. Partner-led deployments appear in Upcoming |
| `CoreNotify` `em_reminder_first/final` | Fires `leadDays` (default 10) / `finalDays` (default 3) before the batch row's `eventDate`. For MDS that is the **target go-live date**. For PGL it is the **go-live date**. Neither is the survey open date or the prepare-by date | Reminders may not align with the guidebook's preparation deadline. Verify intended behaviour before relying on them for Objective 1 (DG-06) |
| `CoreSurveySchedule` FY27 windows | Encoded verbatim from an internal spec; MDS ⅓ window = prior month; some boundaries shifted (e.g. Jun 5/1–5/31 and Jul 5/31–6/30 overlap on 5/31) | Reconcile with the guidebook calendar (open/reminder/close match the guidebook table) |
| `_csatAllowedDeploymentIds_` | HC InFlight keeps Active deployments only | PGL invitations for deployments already *Complete* may be dropped for HC (DG-02) |
| `headerSummary.coveragePct` | "Upcoming batch rows already invited" | Operations measure. Its successor is the `LAUNCH_NOT_SEEN` / in-flight counts |

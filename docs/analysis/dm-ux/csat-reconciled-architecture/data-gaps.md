# Data gaps

Everything the reconciled CSAT needs that current DM/EDM data does not reliably provide. Classes: `AVAILABLE_NOW` · `DERIVABLE` · `NEW_SOURCE_REQUIRED` · `QUALTRICS_INTEGRATION_REQUIRED` · `SFDC_INTEGRATION_REQUIRED` · `NOT_NEEDED_V1`.

"Derivable" means DM already reads the inputs and needs only new logic. No logic was written in this task.

| ID | Need | Today | Class | Blocks | Next step |
|---|---|---|---|---|---|
| DG-01 | **MDS forecast on the programme rule**: ⅓ of SFDC Start → **First Target MTP** (one MDS per deployment) | Batch engine uses each product-area target date (several MDS events possible) or current MTP | `DERIVABLE` (fields `deploymentStartDate`, `firstMtpDate` read; confirm `firstMtpDate` = *first target*, not baseline/current) | Upcoming accuracy (O1) | Compare DM forecast vs SFDC estimator for one month |
| DG-02 | **PGL forecast on the programme rule**: **First MTP Date – Actual** + 2 months, **any deployment status** | Per product actual go-live; fallback current MTP; Active-only; HC InFlight Active-only | `DERIVABLE` (`firstMtpDateActual` read; master includes non-Active) | Upcoming + In-flight completeness for PGL | Same comparison; check how many PGL-due deployments are already *Complete* |
| DG-03 | **Eligibility exclusions**: >16 weeks (MDS); services approach Launch Now (MDS), Ad Hoc, Customer-Led (both); "Advisory"/"Indirect" in name (both) | Not applied | `DERIVABLE` (dates, name; services approach probably `phase` — **validate**) | Upcoming false positives | Confirm field + value mapping (DG-14) |
| DG-04 | Agreement with the **SFDC Survey Timeline Estimator & Contact Validation** report and the MDS calculator | Unknown logic | `SFDC_INTEGRATION_REQUIRED` (read the report definition) or VoC confirmation | Trust in forecast | Obtain report logic; one-month reconciliation |
| DG-05 | **Date readiness** beyond "missing": whether target/actual dates are current | Exceptions list covers missing dates only | `NEW_SOURCE_REQUIRED` (SFDC field history) / `NOT_NEEDED_V1` | "Dates confirmed" facet | V1 shows "dates present" only and never "confirmed" |
| DG-06 | **EM preparation reminders** anchored to the prepare-by date (open − 14 d) | `em_reminder_*` anchored to go-live/target date | `DERIVABLE` (calendar exists) | O1 notifications | Verify intended behaviour first (no change in this task) |
| DG-07 | **Contact readiness**: ≥1 customer PM or Executive Sponsor with email, *active* | Contacts map has `projectManagers`, `execSponsors` | `DERIVABLE` (validate role mapping = "Project Manager [Customer]" / "Executive Sponsor", and Contact State Active) | Readiness facet | Validate on one app |
| DG-08 | **Invitation history** (bounces, closed without response) beyond the ~3-month InFlight window | Full replace per import | `NEW_SOURCE_REQUIRED` (append-only InFlight history / snapshot) | Durable `CLOSED_NO_RESPONSE`; response-rate trend; evidence-gap precision | V1.1: append-only `CSAT_InFlight_History` (counts + states, no contact PII) — needs its own design and authorization |
| DG-09 | **Survey reassignment** (EM changed) | InFlight `engagement_manager` vs SFDC EM comparable | `DERIVABLE` while in flight; pre-launch EM change history `NEW_SOURCE_REQUIRED` | Reassignment facet | V1: in-flight mismatch only |
| DG-10 | **Authoritative survey-due denominator** (who was actually due, per round) | DM forecast only | `DERIVABLE` (approximate, once DG-01/02/03 land) → exact needs `QUALTRICS_INTEGRATION_REQUIRED` (round population export) | Coverage ("heard from n of due") | V1: forecast-based, labelled "estimated due"; V2 validation item V1 stays open |
| DG-11 | **Invitation expiration** | InFlight `survey_expires`; calendar close | `AVAILABLE_NOW` | – | – |
| DG-12 | **CLFU ticket state, owner, reason, outcome** | Not exported. `Alert_owner` empty; `Alert_type` populated (168/177), semantics opaque | `QUALTRICS_INTEGRATION_REQUIRED` (ticket export or API) | Follow-up completion; practice learning from root causes | V1.1: ask VoC for a ticket export (ticket key, response ID or deployment ID, status, owner role, main reason, outcome, closed date). Clarify `Alert_type` first |
| DG-13 | **Partner-led programme rules**: MDS scope; who owns partner-led Detractor follow-up | Guidebook silent | `NEW_SOURCE_REQUIRED` (VoC confirmation) | Partner-led wording; follow-up expectations | Ask VoC |
| DG-14 | **Services Approach vocabulary**: guidebook "Launch Now", "Ad Hoc", "Customer-Led" vs SFDC/Responses values (`Launch`, `Launch Express`, `Launch Flex`, `Your Way`, `Specialized`) | Unmapped | `NEW_SOURCE_REQUIRED` (VoC/SFDC confirmation) | DG-03; like-for-like stage comparison | Ask VoC |
| DG-15 | **Question → field mapping per survey** for `aspect_value` and `agree_sales_expectations` (different wording at MDS vs PGL) | Treated as one field each | `NEW_SOURCE_REQUIRED` (Qualtrics survey definition) | Delivery-rating labels; stage comparisons | Ask Qualtrics owner; until then label per survey and never pool |
| DG-16 | **Exclusion / resend / exception requests** made via Slack | Not recorded anywhere DM can read | `NOT_NEEDED_V1` | Explaining `LAUNCH_NOT_SEEN` | Guidance text only |
| DG-17 | **Launch confirmation** (round population at launch) | Inferred from InFlight rows after import | `DERIVABLE` (`LAUNCH_NOT_SEEN` after grace) | – | – |
| DG-18 | **Respondent ↔ invitation link** | ResponseID available in source, not stored | `NOT_NEEDED_V1` (P7: do not store) | – | – |
| DG-19 | **Historical internal health at response time** | Current health only; Trends/Momentum snapshots unverified | `DERIVABLE`? (verify snapshots) / `NOT_NEEDED_V1` | Perspective divergence over time | V1.1 uses current health with dates shown |
| DG-20 | **Ticket assignment time** (for the 5-business-day goal) | – | `QUALTRICS_INTEGRATION_REQUIRED` | Exact due date | V1 shows approximate expectation only |
| DG-21 | Guidebook defects: MDS calendar column mislabelled; FY27 window boundary overlaps in `CoreSurveySchedule` | – | `NEW_SOURCE_REQUIRED` (VoC confirmation) | Forecast edge cases | Ask VoC; reconcile |

## Summary

- **V1 can proceed** with `AVAILABLE_NOW` + `DERIVABLE` items (DG-01, 02, 03, 07, 09, 11, 17), provided DG-14 and the `firstMtpDate` meaning are confirmed. Those confirmations are questions to answer, not integration work.
- **The single highest-value integration** is the CLFU ticket export (DG-12). It closes the follow-up loop and adds human root-cause data for learning.
- **The second** is invitation history (DG-08). Without it, non-response is forgotten after about three months.

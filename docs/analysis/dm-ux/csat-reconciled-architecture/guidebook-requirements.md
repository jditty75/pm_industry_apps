# Guidebook requirements extraction

Source: *PGL and MDS Deployment Surveys Guidebook* (Workday CX / VoC, updated August 2026; 58 pages), supplied by Jeff on 2026-10-06. Referenced as **GB p.N**. The guidebook describes the VoC operating process. It does not describe Deployment Manager (DM). Every DM implication below is our inference, and it is classified so that it can be challenged.

No names, links, passcodes or customer examples from the guidebook are reproduced here. The guidebook's terms are kept where they matter (Engagement Manager, Deployment Sponsor, Delivery Director, scorecard, Detractor, Passive/Promoter, Top-2 Box, CLFU, Active Invitation list, ticket).

Classification:

| Class | Meaning |
|---|---|
| `DM_MUST_SURFACE` | DM fails one of Jeff's four objectives if it does not show this |
| `DM_SHOULD_SURFACE` | High value, supported by data now or soon |
| `DM_MAY_SURFACE` | Useful context or guidance; not essential |
| `QUALTRICS_ACTION_REMAINS_EXTERNAL` | The action happens in Qualtrics (or Slack / SFDC). DM may point to it but must not reproduce it |
| `SOURCE_DATA_REQUIRED` | DM would surface it, but no current feed carries it |
| `NOT_RELEVANT_TO_DM` | Training, access or customer-facing material with no product implication |

Objectives: **O1 Prepare · O2 Monitor · O3 Learn · O4 Understand deployment/portfolio health**.

## 1. Programme scope and eligibility

| ID | Guidebook rule | GB | Class | Obj | DM implication |
|---|---|---|---|---|---|
| GB-01 | MDS goes to the customer **Project Manager(s) and Executive Sponsor(s)** named on the deployment scorecard | p.4, 17 | `DM_MUST_SURFACE` | O1 | Contact readiness is checked against these two roles only |
| GB-02 | PGL goes to the same two roles | p.5 | `DM_MUST_SURFACE` | O1 | Same |
| GB-03 | MDS scope: projects **> 16 weeks** (Start Date → First Target MTP). Out of scope: Services Approach **Launch Now, Ad Hoc, Customer-Led**, and project names containing **"Advisory"** or **"Indirect"** | p.4, 39 | `DM_MUST_SURFACE` | O1 | DM's Upcoming must not forecast an MDS for ineligible deployments. **Today it does** ([data-gaps.md](data-gaps.md) DG-03) |
| GB-04 | PGL scope: **Workday-primed and partner-primed** deployments (full partner rollout Jan 2025). Out of scope: Services Approach **Ad Hoc, Customer-Led**, and names containing "Advisory"/"Indirect". **Launch Now is in scope for PGL** | p.5 | `DM_MUST_SURFACE` | O1, O4 | PGL forecast includes partner-led. MDS and PGL cohorts differ by more than leadership (§[measurement](measurement-and-thresholds.md#4)) |
| GB-05 | The guidebook **does not state** that partner-led deployments are excluded from MDS. The data shows 0 partner-led MDS responses (47/0) | p.4 (silence) | `SOURCE_DATA_REQUIRED` | O4 | Treat "MDS is Workday-led only" as an **observation to confirm with the VoC team**, not a programme rule. Prior copy that states it as a rule is refined ([decision-reconciliation.md](decision-reconciliation.md)) |
| GB-06 | Specialized (acquisition) products — Peakon, HiredScore, Evisort, Paradox, Sana Learn, VNDLY — need a specialized scorecard requested by Service Care case; Ad Hoc–Other scorecards are for advisory work with no product deployment | p.13–14 | `DM_MAY_SURFACE` | O1 | Ad Hoc → out of scope for both surveys. Services Approach "Specialized" exists in data (canonical model #12). Whether specialized deployments are surveyed is not stated beyond the Ad Hoc exclusion → validation |
| GB-07 | Exception: exclusion from a round is possible for **MDS too early after ⅓**, or **MSP Indirect** deployments, if requested **≥ 4 days before the round starts**; an excluded survey is **not resent** | p.50 | `QUALTRICS_ACTION_REMAINS_EXTERNAL` (request via VoC Slack channel) | O1 | DM can show the exclusion-request deadline (open − 4 days) as guidance |

## 2. Timing

| ID | Guidebook rule | GB | Class | Obj | DM implication |
|---|---|---|---|---|---|
| GB-08 | Surveys are sent on the **first Wednesday of the month** (with published exceptions, e.g. Jul 2026 = 7/8) | p.4, 5, 40, 45 | `DM_MUST_SURFACE` | O1, O2 | `CoreSurveySchedule` already encodes the FY27 calendar verbatim and projects FY28+ |
| GB-09 | **MDS:** sent to deployments that reached the **one-third point** between **SFDC Start Date** and **First Target MTP date** in the **prior month** | p.4, 39 | `DM_MUST_SURFACE` | O1 | DM computes ⅓ against **each product-area target date** (or current MTP), not the First Target MTP → DM may forecast several MDS events per deployment, and a different month (DG-01) |
| GB-10 | **PGL:** sent to deployments whose **First MTP Date – Actual** fell **two calendar months prior** | p.5, 44 | `DM_MUST_SURFACE` | O1 | DM anchors PGL to **each product actual go-live** (fallback current MTP) and reads **Active** deployments only. The guidebook's own example is a deployment with status *Complete* (DG-02) |
| GB-11 | Surveys are open **21 calendar days**; reminders at **+7** and **+19** days; close date published | p.17, 38, 40, 43 | `DM_MUST_SURFACE` | O2 | Calendar supplies open/reminder/close; InFlight supplies per-invitation `survey_expires` |
| GB-12 | The MDS schedule table's last column is labelled "First MTP Actual Period" and repeats the PGL windows | p.40 | `SOURCE_DATA_REQUIRED` (clarify) | O1 | Contradicts the MDS text rule (⅓ in prior month). DM follows the text rule. Confirm with VoC; record as a guidebook defect, not a DM rule |
| GB-13 | Example: 60-week deployment → MDS at ~week 21 | p.39 | `DM_MAY_SURFACE` | O1 | "Expected survey month and why" explanation |
| GB-14 | MDS calculator and SFDC report *PGL/MDS Survey Timeline Estimator & Contact Validation* are the sanctioned estimation tools | p.8, 11 | `SOURCE_DATA_REQUIRED` | O1 | DM's forecast should **agree with** the SFDC estimator. Validation: compare one month (DG-04) |

## 3. Preparation (Engagement Manager before launch)

| ID | Guidebook rule | GB | Class | Obj | DM implication |
|---|---|---|---|---|---|
| GB-15 | **Key principle:** once the SFDC → Qualtrics feed triggers and the survey launches, it **cannot be redirected or excluded**; **all data hygiene in SFDC must happen before launch** | p.8 | `DM_MUST_SURFACE` | O1 | The single strongest product requirement: Prepare is time-boxed and irreversible. DM must show the deadline, not only the month |
| GB-16 | Check which month each deployment is slated for a survey **as soon as it starts; re-check monthly** | p.8 | `DM_MUST_SURFACE` | O1 | Upcoming horizon ≥ 3 months; the deployment history shows its forecast MDS/PGL from day one |
| GB-17 | Confirm/update MTP dates (esp. **First MTP** and **Target MTP**) **ideally weekly, at least 2 weeks before launch** | p.8 | `DM_MUST_SURFACE` | O1 | Preparation deadline = **survey open − 14 days**. DM can flag missing dates (existing exceptions) but not "stale" dates (DG-05) |
| GB-18 | Verify contact roles and email addresses (Customer Sponsor + Customer PM) **at least 2 weeks before launch** | p.9 | `DM_MUST_SURFACE` | O1 | Contact readiness: ≥1 customer PM or Executive Sponsor with an email on the scorecard. DM reads these contacts already (`getDeploymentContactsMap_`). Email validity is not knowable before a bounce |
| GB-19 | Missing contacts → EM opens a **Services Care case** (Systems and Tools → Scorecard) with a template | p.6, 12 | `QUALTRICS_ACTION_REMAINS_EXTERNAL` (SFDC action) | O1 | DM states the action and the deadline. It does not file cases |
| GB-20 | **Reassigned deployment** → ping the VoC Slack channel **immediately** so the survey goes to the new EM | p.9 | `DM_SHOULD_SURFACE` | O1, O2 | Derivable signal: the EM on an in-flight invitation differs from the current SFDC EM (DG-09) |
| GB-21 | **PTO coverage:** ensure account coverage and confirm contacts before leave | p.9 | `DM_MAY_SURFACE` | O1 | Guidance only; DM has no PTO data |
| GB-22 | **Inform the customer** in advance; customer-facing slide template needs the expected **MDS MM-YY** and **PGL MM-YY** | p.15–17 | `DM_SHOULD_SURFACE` | O1 | DM can supply exactly these two values per deployment. The slides themselves are `NOT_RELEVANT_TO_DM` |
| GB-23 | Customer expectation: sender, subject line, 21 days, < 3 minutes | p.17 | `DM_MAY_SURFACE` | O1 | Static guidance text |

## 4. Survey in flight

| ID | Guidebook rule | GB | Class | Obj | DM implication |
|---|---|---|---|---|---|
| GB-24 | **Confirm delivery right after launch** via the Active Invitation list: Finished N/A + Bounce N/A = received, not yet responded; Finished ≠ N/A = responded; Bounce ≠ N/A = delivery failed (contact VoC) | p.10 | `DM_MUST_SURFACE` | O2 | These three states map directly onto `CSAT_InFlight` (`tracking_status`, `finished_date`). "Delivered" is inferred from no bounce, exactly as the guidebook does |
| GB-25 | **Follow up for a response** until the close date; chase actively in the final days | p.7, 10 | `DM_MUST_SURFACE` | O2 | "Awaiting response, closes in N days" per deployment |
| GB-26 | VoC sends "surveys close today" Slack/email reminders | p.10 | `QUALTRICS_ACTION_REMAINS_EXTERNAL` | O2 | DM need not duplicate. DM's own EM reminder rules exist (`CoreNotify` `em_reminder_*`, `dd_digest`) |
| GB-27 | Resend allowed only in the **current round**: contacts changed before the week of launch **and** only one contact; or customer trashed link / hard bounce **and** no other contact on the scorecard; or clear customer error. SLA 24 h via Slack | p.50 | `QUALTRICS_ACTION_REMAINS_EXTERNAL` | O2 | DM may say "resend may be possible this round" when a bounce leaves a deployment with no delivered invitation |
| GB-28 | Invitations and reminders are sent by Qualtrics (initial, +7, +19) | p.38, 43 | `NOT_RELEVANT_TO_DM` (beyond calendar dates) | – | – |

## 5. Response, acknowledgement and closed-loop follow-up (CLFU, ProServ only)

| ID | Guidebook rule | GB | Class | Obj | DM implication |
|---|---|---|---|---|---|
| GB-29 | **ProServ goal:** follow up on **100% of MDS responses (regardless of score)** and **100% of PGL Detractor responses** within **5 business days of ticket assignment** | p.26, 56 | `DM_MUST_SURFACE` (expectation) | O2, O4 | Every MDS response creates an acknowledgement expectation; every PGL Detractor creates a follow-up expectation |
| GB-30 | Alert classes: **Detractor** = DSAT ≤ 3 **or** NPS ≤ 6; **Passive or Promoter** = DSAT ≥ 4 **and** NPS ≥ 7 (NPS only on PGL) | p.28–31, 47 | `DM_MUST_SURFACE` | O2, O4 | Replaces the prior model's risk thresholds ([measurement-and-thresholds.md](measurement-and-thresholds.md)) |
| GB-31 | **MDS Passive/Promoter:** EM owns; send "MDS Thank You" from Qualtrics; alert auto-closes when sent; optional discussion at next meeting | p.28, 31, 34 | `QUALTRICS_ACTION_REMAINS_EXTERNAL`; expectation `DM_SHOULD_SURFACE` | O2 | DM shows "acknowledgement expected (in Qualtrics)". DM cannot see that it was sent |
| GB-32 | **MDS / PGL Detractor:** alert goes to **Deployment Sponsor (or Delivery Director if no sponsor)**; may reassign to EM; send "MDS Detractor"/"PGL Detractor" template; hold a customer conversation; **manually close** with notes in the Alert Case Form, or after **two outreach attempts with no reply** ("Customer Not Reached") | p.28–30, 34–35 | `QUALTRICS_ACTION_REMAINS_EXTERNAL`; expectation `DM_MUST_SURFACE` | O2, O4 | DM shows the expected owner role per programme rules and that follow-up is expected. Actual owner and ticket status are Qualtrics-only |
| GB-33 | **PGL Passive/Promoter:** no outreach required; auto-closes within 2 business days | p.29, 31 | `DM_SHOULD_SURFACE` | O2 | DM can state "no action required" by rule. Avoids false attention |
| GB-34 | Email subject indicates whether action is required ("Action Required" vs "No Action Req") | p.30–31 | `NOT_RELEVANT_TO_DM` | – | Notification copy is Qualtrics' |
| GB-35 | Ticket statuses: Open, In Progress, Overdue, Escalated, Closed; ticket list by owner | p.32 | `SOURCE_DATA_REQUIRED` | O2, O4 | Not in any current feed (`Alert_owner` is empty in the Responses export; `Alert_type` populated but opaque) |
| GB-36 | Follow-up form: **Main reason** (e.g. Expectations Set at Sales, Product Expectations, Project Budget/Communication/Schedule Management, Project Team Best Practice Guidance, Project Team Collaboration), root-cause text, **Outcomes** (Change Request, Additional Support Provided, Meeting with Product / Sales / Delivery Assurance, Customer Not Reached, Other) | p.34 | `SOURCE_DATA_REQUIRED` | **O3**, O4 | The richest practice-learning data in the process: a human root-cause classification. Highest-value future integration (DG-12) |
| GB-37 | Best practice: response-focused, not score-focused, outreach | p.27 | `DM_MAY_SURFACE` | O2 | Guidance text near any follow-up expectation; never show score-shaming language |
| GB-38 | Sending email from the ticket; CC yourself; email history in ticket | p.33 | `QUALTRICS_ACTION_REMAINS_EXTERNAL` | – | – |
| GB-39 | PDF export of a single response for the extended team (since Jul 2025) | p.30–31 | `QUALTRICS_ACTION_REMAINS_EXTERNAL` | – | DM's deployment history covers the internal-reading need without a PDF |

## 6. Measurement and questions

| ID | Guidebook rule | GB | Class | Obj | DM implication |
|---|---|---|---|---|---|
| GB-40 | Satisfaction items on **1–5** (Extremely Dissatisfied … Extremely Satisfied / Strongly Disagree … Strongly Agree); NPS **0–10** | p.18–19, 37, 42, 47 | `DM_MUST_SURFACE` | O3, O4 | Matches `csat-response-v1` |
| GB-41 | **Top-2 Box** = % of responses scoring 4–5; it is the programme's satisfaction measure. NPS = % promoters (9–10) − % detractors (0–6), range −100…+100 | p.47, 57 | `DM_MUST_SURFACE` | O4 | Conflicts with resolved P1 (mean headline) → decision for Jeff ([decision-reconciliation.md](decision-reconciliation.md)) |
| GB-42 | **Feb 2026 scale update:** satisfaction moved from 0–10 to 1–5; Top-2 Box was 9–10, now 4–5; NPS unchanged; **historical data retroactively updated** to the new logic for QoQ reporting | p.47 | `DM_SHOULD_SURFACE` (as a note) | O3 | DM stores only current 1–5 fields (canonical model). Historical Qualtrics dashboard figures before the change may not reconcile with DM |
| GB-43 | Current MDS questions: Overall; reasons; agreement (Sales→Deployment transition; meeting expectations set in sales); aspects (Methodology Plan/Architect-Configure, Schedule, Communications, **Scope as defined by SOW**); team (understanding, collaboration, responsiveness, technical competence, Workday recommended guidance); improve; working well | p.37 | `DM_MUST_SURFACE` (as delivery ratings) | O3 | See measurement §3 for mapping corrections |
| GB-44 | Current PGL questions: Overall; NPS; agreement (**project team set appropriate expectations for the effort required**; prepared to go live; *ES only* met business-case objectives); reasons; aspects (Methodology incl. Test/Deploy, Schedule, Communications, **Value delivered considering the defined scope**); team ("Workday and/or Partner project team": same five); anything else | p.42 | `DM_MUST_SURFACE` | O3 | Same |
| GB-45 | FY26 (pre-update) questions included **Budget Management**; aspect block **required for PM only** | p.48–49 | `DM_MAY_SURFACE` (explains sparsity) | O3 | Explains why aspects populate ~55% and budget is sparse |
| GB-46 | Customer-facing explanation of the 1–5 colour bands (1–2 red, 3 yellow, 4–5 green) and NPS bands | p.18–19 | `DM_SHOULD_SURFACE` | O4 | Display bands; distinct from the CLFU Detractor rule (3 = neutral for display, Detractor for follow-up) |

## 7. Reporting, roles and platform

| ID | Guidebook rule | GB | Class | Obj | DM implication |
|---|---|---|---|---|---|
| GB-47 | Qualtrics is the system for "all aspects of survey management, from invite to reporting" (replaced Medallia May 2025) | p.21, 52 | `QUALTRICS_ACTION_REMAINS_EXTERNAL` | – | DM is not a second Qualtrics. DM adds deployment context and the pre-launch horizon, which Qualtrics does not have |
| GB-48 | Qualtrics dashboard pages: Key Metrics (DSAT, NPS by region/type/approach; Workday- vs Partner-primed side by side), Driver Questions, Partner Results, Active Invitations, Alerts (ticket view), Close Loop Outcomes (Directors+), Response Rates | p.24 | `DM_SHOULD_SURFACE` (selectively) | O3, O4 | Key Metrics defaults to Priming Partner = Workday → **corroborates Workday-led as the default management lens**. DM must reconcile its headline with Key Metrics (same metric, same scope) |
| GB-49 | Roles: **EM** (prepare, chase, acknowledge, hold detractor conversations when assigned); **Deployment Sponsor / Delivery Director** (receive detractor alerts, review, reassign, may own); **Directors and above** see Close Loop Outcomes; VoC team (Slack channel) handles exceptions, reassignment and access | p.7–11, 26–35 | `DM_MUST_SURFACE` | all | Grounds [role-needs.md](role-needs.md) |
| GB-50 | Okta access, first-login profile setup, office hours, platform-change notes | p.22, 51–58 | `NOT_RELEVANT_TO_DM` | – | – |
| GB-51 | Translations (JA, FR, DE); text models derive themes | p.52 | `DM_MAY_SURFACE` | O3 | Comment language may vary; Qualtrics themes are QUALTRICS_DERIVED |

## 8. What the guidebook does *not* say (do not invent)

- No rule that partner-led deployments are excluded from MDS (GB-05).
- No coverage/response-rate target, no satisfaction target.
- No rule about multiple go-lives (phases) generating multiple PGLs. It names **First** MTP Actual only.
- No rule linking CSAT to deployment health status, Notable, or Executive Watch.
- No "neutral is a risk" rule for display; 3 is a Detractor **only for CLFU alert purposes**.
- No direction/trend method beyond QoQ reporting.

## Summary counts

51 rules. Rules tagged with each class (a rule can carry two, e.g. an external action plus a DM-visible expectation): `DM_MUST_SURFACE` 22 · `DM_SHOULD_SURFACE` 7 · `DM_MAY_SURFACE` 7 · `QUALTRICS_ACTION_REMAINS_EXTERNAL` 9 · `SOURCE_DATA_REQUIRED` 5 · `NOT_RELEVANT_TO_DM` 3.

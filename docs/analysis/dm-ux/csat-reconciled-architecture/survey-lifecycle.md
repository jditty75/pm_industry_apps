# The deployment-survey lifecycle

One lifecycle per **deployment × survey (MDS or PGL)**. A deployment normally has at most one MDS and one PGL. Each survey fans out into one invitation per eligible contact and can produce several responses (customer PM and Executive Sponsor).

## 1. Corrected sequence (from the guidebook)

The brief's starting sequence is right in outline. Five corrections from the guidebook:

1. **Eligibility comes before timing.** Duration (> 16 weeks), services approach and name rules decide whether an MDS or PGL will happen at all (GB-03/04). Partner-led is in PGL scope. Its MDS scope is unconfirmed (GB-05).
2. **Preparation has a hard deadline, and launch is irreversible** (GB-15/17/18). The real milestone is *survey open − 14 days*, not the survey month.
3. **"Delivered" is inferred**: no bounce and no finish = received and awaiting (GB-24).
4. **The survey closes after 21 days.** Non-response is a terminal state for that round, and a resend is possible only under narrow exceptions (GB-11, 27).
5. **Follow-up differs by survey and class**: every MDS response needs an acknowledgement; Detractors (MDS or PGL) need a conversation and a manual close; PGL Passive/Promoter needs nothing (GB-29–33).

```
Deployment starts (SFDC Start Date)
 ├─ MDS eligibility determined (>16 wks, services approach, name)        ── DM derives
 ├─ MDS forecast: ⅓ point (Start → First Target MTP) → batch month       ── DM derives
 ├─ PREPARE until open − 14 d: dates, contacts, customer informed         ── EM in SFDC / with customer
 ├─ MDS launches (first Wednesday)                                       ── Qualtrics
 ├─ Invitations: awaiting / opened / bounced / responded (21 days, +7, +19 reminders)
 ├─ Survey closes: responded | closed without response
 ├─ Each response → alert class → acknowledgement (all MDS) / Detractor follow-up
 ├─ Deployment continues …
 ├─ Go-live (First MTP Date – Actual)
 ├─ PGL forecast: go-live month + 2 → batch month                         ── DM derives
 ├─ PREPARE until open − 14 d
 ├─ PGL launches → invitations → close
 ├─ Each response → Detractor follow-up | Passive/Promoter: no action
 └─ Historical evidence: deployment CSAT history; portfolio learning
```

## 2. Stage table

| # | Stage | Deployment milestone | Survey state | User question | Responsibility | DM data available | Qualtrics data available (to DM) | Action | Where | Historical evidence left |
|---|---|---|---|---|---|---|---|---|---|---|
| L1 | Eligibility | Start Date, First Target MTP, services approach, name; go-live for PGL | `NOT_IN_SCOPE` or eligible | "Will this deployment be surveyed?" | VoC rules; EM checks | Start, `firstMtpDate`, `phase`/services approach (validate), name, priming partner — all in SFDC master | – | Request exclusion (MDS too early, MSP Indirect) ≥ 4 days before round | Slack (VoC) | Eligibility reason (derived; not stored) |
| L2 | Forecast | ⅓ point (MDS); First MTP Actual (PGL) | `UPCOMING` | "When will it be surveyed and why?" | EM | Batch engine (rules differ from guidebook: DG-01/02/03), `CoreSurveySchedule` calendar | – | Re-check monthly; tell customer the MDS/PGL month | DM (view), customer conversation | Forecast month (not stored historically) |
| L3 | Preparation | Survey open − 14 d deadline | `UPCOMING` with readiness facets: dates, contacts | "Is everything correct in SFDC before the feed fires?" | EM (DD oversight) | Contacts by role (PM / Exec Sponsor) with email; missing-date exceptions; EM on deployment | – | Fix MTP dates; add contacts (Services Care case if needed); confirm EM assignment; inform customer | **SFDC**, Service Care, customer | None today. Readiness at launch is not recorded (not a V1 need) |
| L4 | Launch | First Wednesday | `IN_FLIGHT` | "Did it go out, to whom?" | EM | `CSAT_InFlight` rows after next import (~15-min EDM cadence once exported) | Active Invitation list | Confirm delivery right after launch | Qualtrics dashboard (source), DM (view) | Invitation rows (rolling ~3-month window, replaced each import) |
| L5 | Awaiting response | Open → close (21 d) | `IN_FLIGHT · AWAITING` (sub-state *opened/started* where present) | "Who still needs to respond, how long is left?" | EM | `tracking_status`, `opened/started/finished_date`, `survey_expires` | Same | Remind customer; chase in final days | Customer conversation | – |
| L6 | Delivery failure | Any time after send | `IN_FLIGHT · BOUNCED` | "Did it fail to arrive?" | EM → VoC | `tracking_status` = Bounced | Bounce Type | Correct the email in SFDC; request a resend if exception rules allow (current round only) | SFDC + Slack (VoC) | Bounce (lost when InFlight window rolls) |
| L7 | Response received | Finish date | `RESPONDED` | "What did they say?" | EM; DS/DD for Detractor | InFlight `Completed` immediately; `CSAT_Responses` after the Responses import | Full response | Read the response | DM (deployment history), Qualtrics | **Response record (retained)** |
| L8 | Close without response | `survey_expires` passed, no finish | `CLOSED_NO_RESPONSE` | "Did we miss this customer's voice?" | EM, DD | Derivable from InFlight while the row is in the window | – | None for this round. It becomes an evidence gap | – | Lost after InFlight rolls (DG-08) |
| L9 | Acknowledgement / follow-up | Response + 5 business days of assignment | `FOLLOW_UP_EXPECTED` (Detractor or MDS acknowledgement), or `NO_ACTION_REQUIRED` (PGL Passive/Promoter) | "Does this response need me, and who owns it?" | MDS P/P: EM. Detractor: Deployment Sponsor (or DD), optionally reassigned to EM | Alert class derivable from scores; expected owner derivable from DM contacts (sponsor, DD, EM) | Ticket owner/status/outcome: **not in feed** | Send template email; hold conversation; close ticket with reason/outcome | **Qualtrics** | Ticket reason + outcome live in Qualtrics only (DG-12) |
| L10 | Historical learning | Any later time | `RECORDED` | "What does this customer's history tell us; what do we learn across deployments?" | Leadership, practice | Responses; deployment context | Themes, sentiment (in Responses export) | Review; act through DM (Notable, Executive Watch, Health Plan) | DM | Deployment CSAT history; portfolio aggregates |

## 3. Canonical lifecycle states

Only states DM can determine. One state per **deployment × survey**, derived from the invitations and responses below it. The per-invitation status remains visible as detail.

| State | Meaning | Source | Entry | Exit | User action | System of action |
|---|---|---|---|---|---|---|
| `NOT_IN_SCOPE` | Programme rules say this survey will not be sent | SFDC fields + guidebook rules (DM-derived) | Eligibility rule fails | Data changes make it eligible | None (or check the reason is right) | – |
| `CANNOT_FORECAST` | Required dates missing, so the month cannot be computed | Batch-engine exceptions (exists) | Missing Start / First Target MTP (MDS) or First MTP Actual after go-live (PGL) | Dates entered | Fix dates in SFDC | SFDC |
| `UPCOMING` | Forecast to launch in a known batch month within the horizon | Batch engine + calendar | Forecast month within horizon (3 or 6 months) | Survey open date reached (→ `IN_FLIGHT` once invitations import, or `LAUNCH_NOT_SEEN`) | Prepare (facets below) | SFDC, customer |
| `IN_FLIGHT` | Invitations exist and the survey is open | `CSAT_InFlight` | First invitation row for deployment+survey | Every invitation finished, bounced or expired | Confirm delivery; chase | Customer conversation; Qualtrics |
| `RESPONDED` | ≥1 response received for this survey | InFlight `Completed` or a `CSAT_Responses` row | First finish | – (terminal for collection; follow-up continues) | Read; acknowledge / follow up | Qualtrics (CLFU) |
| `CLOSED_NO_RESPONSE` | Survey closed with no response from any contact | InFlight (`survey_expires` < today, none finished) | Close date passes | – (terminal) | None this round; becomes an evidence gap | – |
| `LAUNCH_NOT_SEEN` | Forecast said it should have launched, but no invitation appears after the open date + import grace period | Batch engine × InFlight | Open date + N days (proposed 3), no InFlight row | Invitation appears, or data corrected | Ask the VoC team why (wrong forecast, ineligible, data issue) | Slack (VoC) |

**Facets, not states** (shown alongside a state; several can apply at once):

| Facet | Applies to | Derivation | Availability |
|---|---|---|---|
| Preparation deadline | `UPCOMING` | Calendar open − 14 days | AVAILABLE_NOW |
| Exclusion-request deadline | `UPCOMING` (MDS) | Open − 4 days | AVAILABLE_NOW |
| Contacts ready | `UPCOMING` | ≥1 customer PM **or** Executive Sponsor contact with an email on the scorecard | DERIVABLE (contacts map exists; validate role mapping and Contact State) |
| Dates present | `UPCOMING` | Not in exceptions | AVAILABLE_NOW |
| EM reassignment | `UPCOMING`, `IN_FLIGHT` | InFlight `engagement_manager` ≠ current SFDC EM; or EM changed since forecast | DERIVABLE (in flight); NEW_SOURCE for pre-launch change history |
| Awaiting / opened / started | `IN_FLIGHT` invitations | InFlight dates | AVAILABLE_NOW |
| Bounced | `IN_FLIGHT` invitations | InFlight status | AVAILABLE_NOW |
| Closes in N days | `IN_FLIGHT` | `survey_expires` or calendar close | AVAILABLE_NOW |
| All invitations bounced | `IN_FLIGHT` | Every invitation bounced | AVAILABLE_NOW (urgent: no customer voice possible without resend) |
| Alert class | `RESPONDED` (per response) | M5 | AVAILABLE_NOW (Responses) |
| Follow-up expected / No action required | `RESPONDED` (per response) | M6 | DERIVABLE (expectation only) |
| Follow-up complete | `RESPONDED` | Qualtrics ticket closed | **QUALTRICS_ONLY** (future integration) |
| Response details pending | `RESPONDED` | InFlight Completed, no `CSAT_Responses` row yet | AVAILABLE_NOW |

States intentionally **not** used: `READY` (DM cannot verify email validity or date accuracy, only presence; "ready" would overclaim), `DELIVERED` (not observable; inferred only), `FOLLOW_UP_COMPLETE` / `CLOSED` (Qualtrics-only), `PREPARATION_REQUIRED` as a state (it is a facet of every `UPCOMING` survey inside its preparation window).

## 4. CSAT_InFlight and CSAT_Responses as one lifecycle

| | `CSAT_InFlight` | `CSAT_Responses` |
|---|---|---|
| Represents | The **current survey process** (invitations of the recent rounds) | **Historical customer evidence** |
| Grain | Invitation (deployment × survey × contact) | Response |
| Persistence | Full replace per import; ~3-month window; HC Active-only | Upsert; retained |
| Contact data | Name, email, role (operational) | Role + hashed key only |
| Lifecycle states fed | `IN_FLIGHT`, sub-states, `RESPONDED` (early), `CLOSED_NO_RESPONSE` (while in window), `LAUNCH_NOT_SEEN` | `RESPONDED` (durable), alert class, follow-up expectation, `RECORDED` |

**Overlap:** a completed invitation in the current window appears in both (67/67 matched by ResponseID in the analysed exports).

**Link:** at **deployment + survey** level only (reliable for state). Per-invitation ↔ per-response linking via ResponseID is reliable in the source, but storing it re-identifies respondents (P7). **Recommendation: keep it unstored.** The lifecycle needs only "this survey has ≥1 response" and "how many invitations are unanswered", and both are deployment-level facts.

**Transition when an in-flight survey receives a response:** InFlight flips the invitation to `Completed` at the next InFlight import. The deployment × survey becomes `RESPONDED` immediately, with the facet "response details pending" until the Responses import brings the scores. When they arrive, the alert class and follow-up expectation appear. The user experiences **one survey moving through states**, even though two stores supply it. No data is duplicated. The lifecycle state is computed at read time from both stores and never written back.

**When InFlight rolls the invitation out of its window:** `RESPONDED` persists through Responses. `CLOSED_NO_RESPONSE` and bounces are **lost** (DG-08). Until an InFlight history exists, "closed without response" beyond ~3 months is inferred as *evidence gap*: due by forecast, with no response on record.

## 5. Deployment-level roll-up of a survey with several contacts

| Invitations | Survey state shown | Facet |
|---|---|---|
| ≥1 responded | `RESPONDED` | "1 of 2 contacts responded"; others still awaiting while open |
| None responded, ≥1 delivered, open | `IN_FLIGHT` | Awaiting; closes in N |
| All bounced, open | `IN_FLIGHT` | **All invitations bounced** |
| None responded, closed | `CLOSED_NO_RESPONSE` | – |

A survey is answered for the deployment when anyone responds. Each response is still its own piece of evidence with its own alert class. A Sponsor Detractor and a PM Promoter on the same survey are both shown. They are never averaged into one verdict.

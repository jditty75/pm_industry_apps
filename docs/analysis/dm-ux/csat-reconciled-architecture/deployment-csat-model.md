# Deployment CSAT model

> The deployment is the fundamental object. CSAT contributes the **customer's evidence** about that deployment, alongside DM's internal view (status, health, go-live, overrides, Notable, escalations).

## 1. What "Customer Satisfaction health" means for one deployment

There is **no single CSAT health score**. A composite would blend things that cannot be added together: a customer verdict, whether we asked, whether we followed up, and how old the evidence is. Each of these has a different owner and a different action. Customer Satisfaction health is a small, fixed set of **facets**, read together:

| Facet | Question | Class | Values (examples) | Source |
|---|---|---|---|---|
| **Latest customer verdict** | What did the customer most recently tell us? | `CUSTOMER_OUTCOME` | "PGL · Aug 2026 · Detractor (DSAT 3, NPS 8)"; "MDS · Mar 2026 · Passive or Promoter (DSAT 5)"; per respondent role if they differ | Responses |
| **Customer trajectory** | Did the verdict hold between MDS and PGL? | `HISTORICAL_EVIDENCE` | "MDS 5 → PGL 3"; "MDS only, PGL forecast Jan 2027" | Responses + forecast |
| **Follow-up expected** | Does a response require acknowledgement or a Detractor conversation? | `ACTION_REQUIRED` | "Detractor follow-up expected · owner role: Deployment Sponsor · tracked in Qualtrics"; "MDS acknowledgement expected"; "No action required (PGL Passive/Promoter)" | Responses + rules (status Qualtrics-only) |
| **Survey in motion** | Is a survey open now, and has the customer answered? | `PROCESS_STATE` | "PGL open · 1 of 2 contacts responded · closes 28 Oct"; "MDS: all invitations bounced" | InFlight |
| **Next survey** | When is the next customer checkpoint, and are we ready for it? | `CURRENT_STATE` | "PGL forecast Dec 2026 · prepare by 18 Nov · contacts: no Executive Sponsor" | Batch engine + contacts |
| **Evidence recency** | How current is the customer's voice? | `CURRENT_STATE` | "Last heard: 7 months ago (MDS)"; "Never surveyed (not in MDS scope)"; "MDS closed without response" | Responses + lifecycle |

Reading rules:

1. **Verdict and evidence recency are always read together.** A Promoter from 9 months ago on a deployment now Red internally is not current reassurance.
2. **Several respondents keep separate verdicts.** Sponsor and PM verdicts are listed separately and never averaged at deployment level.
3. **Silence is a state, not a verdict.** "Closed without response" and "never surveyed" are stated plainly. They are neither good nor bad.
4. **Customer view next to internal view.** When the deployment is shown with DM's internal health, CSAT adds the customer facet beside it. A **perspective divergence**, such as internal health Green and latest verdict Detractor, or internal Red and latest verdict Promoter, is a useful observation. It is `INTERPRETIVE` because the dates differ: health is current, the verdict is as of its response date. V1.1 candidate, see [v1-scope.md](v1-scope.md).

### What the facets contribute, by objective

| Objective | Facets |
|---|---|
| O1 Prepare | Next survey (incl. readiness), Evidence recency |
| O2 Monitor | Survey in motion, Follow-up expected |
| O3 Learn | Customer trajectory, Latest verdict (with comments, T2) |
| O4 Health | All six, read together, beside internal health |

## 2. Deployment CSAT history (semantic record)

One chronological record per deployment. It is the investigation unit and the target of every portfolio drill-down. It is hosted wherever the deployment is opened (CSAT drill-in today; the future shared deployment-detail surface). It is a record, not a section of CSAT.

| # | Event | Date / milestone | State | Score / evidence | Action | Provenance |
|---|---|---|---|---|---|---|
| E1 | Deployment start | SFDC Start Date | – | Services approach, priming partner, duration → MDS eligibility | – | SFDC (via DM master) |
| E2 | MDS forecast | ⅓ point → batch month; prepare-by date | `UPCOMING` / `NOT_IN_SCOPE` / `CANNOT_FORECAST` | Eligibility reason; readiness facets | Prepare in SFDC; tell customer "MDS MM-YY" | DM-derived (forecast rule labelled) |
| E3 | MDS launched | Survey open date | `IN_FLIGHT` | Invitations by role: awaiting / opened / bounced | Confirm delivery; chase | Qualtrics → InFlight |
| E4 | MDS closed | Close date | `RESPONDED` / `CLOSED_NO_RESPONSE` | Contacts responded n of m | – | InFlight (lost after window, DG-08) |
| E5 | MDS response(s) | Response date | `RECORDED` | DSAT, alert class, delivery ratings, role; comments (T2); Qualtrics themes (labelled) | Acknowledge (all MDS); Detractor conversation | Customer (Responses); Qualtrics-derived |
| E6 | MDS follow-up | Within 5 business days of assignment | Expected (DM) / actual (Qualtrics) | Future: main reason, outcome | Close ticket in Qualtrics | Qualtrics (future feed) |
| E7 | Go-live | First MTP Date – Actual (later go-lives listed as context) | – | – | – | SFDC |
| E8 | PGL forecast | Go-live month + 2 → batch month; prepare-by date | `UPCOMING` / … | Readiness facets | Prepare; tell customer "PGL MM-YY" | DM-derived |
| E9 | PGL launched / closed | Open / close dates | `IN_FLIGHT` → `RESPONDED` / `CLOSED_NO_RESPONSE` | As E3–E4 | As E3 | InFlight |
| E10 | PGL response(s) | Response date | `RECORDED` | DSAT, NPS, alert class, delivery ratings, prepared-to-go-live, ES business case; comments (T2) | Detractor → conversation; Passive/Promoter → none | Responses |
| E11 | PGL follow-up | – | Expected / Qualtrics | Future: reason, outcome | Qualtrics | Qualtrics |
| E12 | Learning | – | – | Trajectory MDS → PGL (same respondent where `respondent_key` matches); AI summary (future, labelled AI-generated) | Act in DM: Notable, Executive Watch, Health Plan | DM-derived / AI_DERIVED (future) |

Rules carried over (unchanged): role shown, identity never; comments T2 and fetched separately; provenance labels *Customer comment · Qualtrics analysis · AI-generated* are never merged; blank ≠ 0.

New rules from the guidebook:

- **Forecast events are labelled as forecasts** and carry the rule that produced them ("⅓ of Start → First Target MTP, reached in September"). When DM's forecast and the actual launch disagree, the actual launch wins and the forecast is shown as superseded. This helps diagnose data hygiene.
- **Subsequent go-lives** (phases) appear as context events. They do not generate extra PGL forecasts unless the VoC team confirms otherwise (DG-01).
- **Follow-up events show the expected owner role** derived from programme rules (Detractor → Deployment Sponsor, else Delivery Director). Owner names come from DM's existing contact data. The actual owner stays in Qualtrics.

## 3. Deployment-level evidence vs other uses of Responses

| Use | Class | Where | Example |
|---|---|---|---|
| This customer's verdicts, ratings and words | `DEPLOYMENT_EVIDENCE` | Deployment CSAT history | "Sponsor: Detractor at PGL, prepared-to-go-live 2" |
| Aggregates across deployments in a scope | `PORTFOLIO_INSIGHT` | Overview, Responses | "Workday-led PGL Top-2 Box 81% (26 responses, 21 deployments)" |
| Patterns that teach delivery practice | `PRACTICE_LEARNING` | Responses (lenses, feedback view); future CLFU reasons | "Schedule management is the lowest-rated item at MDS across two quarters" |

See [portfolio-csat-model.md §4](portfolio-csat-model.md) for the full separation.

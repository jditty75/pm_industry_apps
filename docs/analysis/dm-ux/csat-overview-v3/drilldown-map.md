# Drill-down map and what left Overview

## 1. Every signal resolves to deployments

Principle: *every CSAT portfolio statement must be explainable through the deployments beneath it.* Each Overview signal names **(a)** the deployment set behind it and **(b)** where the reader goes to work with that set. The destination pages are not designed here. Filters are stated as intent.

| Signal (where) | Deployments behind it | Destination | Pre-applied intent |
|---|---|---|---|
| Anchor figure / sentence A (R1) | Deployments with in-scope responses in the window (d) | **Responses** | Scope + window; grouped by deployment |
| "{k} deployments raised customer concerns" (R1 C) | The R2 set | Scrolls/focuses **R2** (same page) | – |
| Each R2 row | That deployment | **Deployment CSAT history** | Opens at the Detractor response event |
| "+k more in the last 90 days" / "View all concerns" (R2) | All concern deployments | **Responses** | Alert class = Detractor, last 90 days, scope |
| Follow-up footer (R2) | Deployments with responses in the last 30 days that expect follow-up | **Surveys** › Responded | Facet "Follow-up expected", last 30 days; each row says "act in Qualtrics" (no per-ticket deep link: no ticket key) |
| "Next survey round 4 Nov: 9 deployments" (R1 C / R3) | `UPCOMING` in that round | **Surveys** › Upcoming | Round = Nov 2026 |
| "{r} with readiness issues" + named rows (R3) | `UPCOMING` with a readiness facet | Name → **Deployment CSAT history** (next-survey facet). "+k more" → **Surveys** › Upcoming | Readiness issue = any |
| Following round (R3) | `UPCOMING`, next round + 1 | **Surveys** › Upcoming | Round = Dec 2026 |
| "can't be forecast" (R3) | `CANNOT_FORECAST` | **Surveys** › Upcoming | State = cannot forecast (missing dates) |
| In-flight counts (R3) | `IN_FLIGHT` / `RESPONDED` in the open round | **Surveys** › In flight | Round = current |
| "{c} to chase" (R3 / R1 C) | Chase-now surveys | **Surveys** › In flight | Chase = all bounced or closing ≤ 7 days with no response |
| "Open Surveys →" (R3) | – | **Surveys** | Default view |
| Lowest delivery rating (R4) | Deployments whose responses rated that item | **Responses** › Delivery ratings | Rating = item, survey = MDS/PGL, scope |
| NPS (R4) | PGL responses in scope | **Responses** | Survey = PGL, scope |
| Partner-led context (R4) | Partner-led PGL deployments | **Overview** in Partner-led scope (the scope menu changes) | – |
| "{k} deployments with Detractor responses in 12 months" (R4) | All 12-month concern deployments | **Responses** | Alert class = Detractor, window |
| "{g} surveys closed without a response" (R4 / R1 B) | `CLOSED_NO_RESPONSE` + `LAUNCH_NOT_SEEN` | **Surveys** | State = closed without response / launch not seen |
| Journey counts (disclosure) | Paired deployments | **Responses** | Paired MDS → PGL, change class |
| Freshness, import (disclosure) | – | **Surveys** › Survey settings (ADMIN) | – |

At most two steps from any Overview figure to a named deployment. Most are one step.

## 2. What left the V2 Overview, and where it went

Simplification is deliberate, not deletion. Destinations: `SURVEYS` · `RESPONSES` · `DEPLOYMENT_DETAIL` (deployment CSAT history) · `SUPPORTING_DISCLOSURE` (R4 + *Breakdown and method* on Overview).

| V2 element | V3 destination | Note |
|---|---|---|
| CSAT `.info-banner` definition | SUPPORTING_DISCLOSURE | First method note. Sentence A now does the banner's job |
| Full-width scope bar (segmented control, window select, date range) | SUPPORTING_DISCLOSURE (scope menu) | One quiet text button. The window range moves into R1 B |
| "Responses imported" green pill | SUPPORTING_DISCLOSURE | Freshness line; a stale import surfaces in R1 B |
| Refresh button | SURVEYS (Survey settings, ADMIN) | Maintenance, not monitoring |
| Mean "4.3 / 5" headline | SUPPORTING_DISCLOSURE · RESPONSES | Superseded by Top-2 Box (J1). Mean is detail only |
| Seven-column stage table | SUPPORTING_DISCLOSURE (compact table) · RESPONSES | One table, collapsed |
| Band bars | RESPONSES | Band **counts** stay in the disclosure |
| Per-stage "Evidence" (responses · deployments) | SUPPORTING_DISCLOSURE | Combined n and d stay in R1 B |
| "Heard from x of y due" + meter | SUPPORTING_DISCLOSURE (after DG-10) | The meter is dropped. The untrusted denominator is not shown in V1 |
| Per-stage direction with values and half counts | SUPPORTING_DISCLOSURE | One direction word in R1 A |
| NPS column | SUPPORTING_DISCLOSURE (R4 fact) · RESPONSES | Secondary |
| Partner-led PGL reference row | SUPPORTING_DISCLOSURE (R4 fact) · RESPONSES | One quiet value |
| Stage note "MDS and PGL rows are different deployments" | SUPPORTING_DISCLOSURE | Method note |
| Evidence qualifier (70/50 coverage thresholds) | SUPPORTING_DISCLOSURE (after DG-10) | V1 shows counts of closed-without-response instead |
| ⓘ "how calculated" button | SUPPORTING_DISCLOSURE | Method notes |
| "Customer Satisfaction risk" card, "low verdict / early warning" summary | **Kept, transformed** → R2 Customer concerns | Detractor rule (guidebook) replaces the invented classes |
| Risk triggers "Low rating", "Negative feedback" | RESPONSES (lenses) | Not Overview attention (architecture P2/P6) |
| Delivery ratings card (2 lowest + 1 highest) | SUPPORTING_DISCLOSURE (one lowest) · RESPONSES (profile) | – |
| "Compare by delivery leadership" link | RESPONSES | – |
| MDS → PGL journey card | SUPPORTING_DISCLOSURE (counts) · DEPLOYMENT_DETAIL (per-deployment trajectory) | Declines also surface as a tag on R2 rows |
| Survey Operations strip (bounced, expiring) | **Kept, transformed** → R3 chase line · SURVEYS | Promoted from footer to Level 2 |
| "Invitations imported" | SUPPORTING_DISCLOSURE | Freshness line |
| Region subtitles repeating scope/window | Removed | Scope stated once, in R1 A and the scope menu |

Added in V3 (missing in V2): the executive message (R1), the survey horizon with prepare-by and readiness (R3), follow-up expectations (R2), and lifecycle eyebrows.

# User workflows (conceptual, no screens)

Roles follow `AppUsers`: PM → ADMIN, DD/VP → POWER_USER. T2 audience per decision D6.

## W1 — Weekly portfolio check (DD/VP, MONITOR)
1. Open CSAT → Overview.
2. Read satisfaction by stage with its evidence base: "PGL: 18 of 21 satisfied, 1 dissatisfied; 21 responses from 17 of 22 deployments due."
3. Direction: "MDS: not enough responses to call a direction."
4. Satisfaction risks: two deployments, one R1 (PGL Overall 2) and one R3 (MDS 4 → PGL 2).
5. Open the R3 deployment's CSAT history; see both responses, roles and low drivers (readiness 1).
6. (T2) Read the PGL reasons comment.
7. Act in DM: add to Notable / Executive Watch; message the EM.
**Ends in:** a DM action on a named deployment. No chart reading was needed.

## W2 — Investigate a decline (DD/VP, INVESTIGATE)
1. Overview shows "PGL declining: 4.3 → 3.8 on n=24 / n=19" with a composition note (partner-led share rose).
2. Go to Responses, pre-filtered to PGL and both windows.
3. Apply the priming-partner lens: the Workday-led figure is stable and the partner-led figure fell, so the movement is mainly composition plus partner-led PGLs.
4. Driver profile for partner-led PGL: "prepared to go live" is the weakest.
5. (T2) Feedback view for partner-led dissatisfied responses: themes cluster on testing/cutover.
6. Conclude: the issue is partner-led readiness, not portfolio-wide. Take it to partner management.
**Key behaviour:** composition is checked before believing the movement.

## W3 — MDS early warning (EM/DD, INVESTIGATE → act before go-live)
1. A new MDS response arrives: Overall 3 (neutral, not a risk), communications 2 → R4.
2. The Overview risk list shows it as secondary.
3. Deployment CSAT history: first response for this deployment; PGL due in ~5 months.
4. (T2) The "what could we improve" comment explains it.
5. Act: raise in the delivery check-in; optionally use the Deployment Health Plan.
**Value:** MDS exists to catch problems while they are still correctable.

## W4 — Customer review / QBR preparation (EM/DD, deployment level)
1. From the DM Deployments tab, open deployment detail → CSAT section (deployment CSAT history).
2. See the MDS response, the PGL response, NPS category, stakeholder roles, and survey state ("PGL completed").
3. (T2) Read "working well" and "additional" comments for talking points.
4. (Future) AI summary of the deployment's feedback history, labelled AI-generated.

## W5 — Run the survey process (PM/ADMIN, OPERATE)
1. CSAT → Survey Operations → Upcoming: next month's MDS/PGL batches; exceptions for missing target dates.
2. In-Flight: 3 bounced invitations, 4 expiring in 7 days.
3. Fix contacts and target dates at source; check notification rules (one invalid); send a test.
4. Confirm freshness after the next import.
**Never touches** satisfaction results.

## W6 — Close evidence gaps (CSAT owner/DD, MONITOR → OPERATE)
1. Overview coverage: "PGL heard from 9 of 16 deployments due."
2. Follow the evidence-gap link → Survey Operations, filtered to G1 deployments (due, no response).
3. For each: invited? bounced? expired? Re-engage via the EM or the reminder rule.
4. Read Q1 with that caveat until coverage improves.

## W7 — Quarterly practice learning (practice lead, INVESTIGATE, T2)
1. Responses → window = last two quarters; driver profile by stage.
2. The weakest dimension is schedule management at MDS.
3. Feedback view filtered to MDS + parent topic(s) about schedule/planning; read the comments.
4. Optional Product Area lens (suppressed where n<5) to see whether it concentrates in deployments including particular areas. It does not show cause.
5. (Future) AI theme summary for the slice.

## W8 — Respond to stakeholder disagreement (DD, deployment level)
1. Responses list shows R5: the executive sponsor rated 2 and the customer PM rated 5 at the same PGL.
2. Deployment history shows both; the comments (T2) reveal different concerns (value vs day-to-day team).
3. Act: an executive-level conversation, not a delivery-team fix.

## Common shape

```
MONITOR (Overview)           detect: risk · direction · gap · issue
   │                                     │              │
INVESTIGATE (Responses)      slice → lens → drivers → feedback(T2)
   │                                     │
DEPLOYMENT CSAT HISTORY      sequence · roles · comments(T2) · DM context
   │
ACT in DM                    Notable · Executive Watch · Health Plan · EM follow-up

OPERATE (Survey Operations)  due → invited → delivered → completed  (fed by gaps/issues)
```

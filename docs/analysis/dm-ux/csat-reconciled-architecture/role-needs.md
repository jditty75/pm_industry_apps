# Role perspectives

Grounded in the guidebook's role definitions (GB-49). DM role mapping is unchanged: PM → ADMIN; DD, VP → POWER_USER; READ_ONLY sees no CSAT. The guidebook's roles are **business roles** on a deployment (EM, Deployment Sponsor, Delivery Director). DM resolves them from SFDC contacts and DeploymentsMeta (`_resolveMdsPglDeliveryDirector_`, `wdSponsor`, `engagementManagers`). DM's access roles and the guidebook's business roles are different axes. A POWER_USER may be the Deployment Sponsor on some deployments and not on others.

## Engagement Manager

| Need | Guidebook basis | Lifecycle | DM supplies | Action happens in |
|---|---|---|---|---|
| Which of my deployments have an MDS/PGL coming, and when? | Check survey month as soon as the deployment starts; monthly (GB-16) | `UPCOMING` | Forecast month, rule, prepare-by date | – |
| Are dates and contacts right **before** the feed fires? | 2 weeks before launch (GB-17/18); irreversible launch (GB-15) | `UPCOMING` facets | Missing dates; customer PM / Exec Sponsor presence with email | SFDC; Services Care case |
| What MM-YY do I tell the customer? | Customer-facing slide (GB-22) | `UPCOMING` | MDS MM-YY, PGL MM-YY | Customer meeting |
| Did it arrive; who hasn't answered; how long is left? | Confirm delivery; chase until close (GB-24/25) | `IN_FLIGHT` | Per-contact status, closes-in | Customer conversation |
| Did something bounce or get reassigned? | Bounce → VoC; reassignment → Slack (GB-20/24) | `IN_FLIGHT` | Bounced; EM mismatch | SFDC + Slack |
| Does a response need me? | MDS: acknowledge all; Detractor if reassigned (GB-29/31/32) | `RESPONDED` | Alert class; follow-up expected; expected owner | **Qualtrics** |
| What has this customer said over time? | (implied by follow-up and QBR use) | `RECORDED` | Deployment CSAT history | DM |

**EM emphasis:** the operational horizon of *their* deployments, plus "needs me" items. Mostly deployment-level.

## Deployment Sponsor / Delivery Director

| Need | Guidebook basis | DM supplies | Action in |
|---|---|---|---|
| Which customers responded as Detractors on deployments I sponsor or direct? | Detractor alerts go to Sponsor (or DD if none) (GB-32) | Detractor responses in scope, with expected owner role | Qualtrics (review, reassign, own) |
| Is follow-up happening? | 5-business-day goal (GB-29) | **Expectation only** in V1; status after CLFU integration | Qualtrics |
| Are my EMs ready for the next round? | DD shares the monthly checklist (GB p.7 "Monthly Checklist for EMs and DDs") | Upcoming readiness across their deployments | SFDC (via EMs) |
| Which deployments carry customer risk alongside internal risk? | (DM purpose; not in guidebook) | Customer verdict beside internal health; perspective divergence (V1.1) | DM (Notable, Executive Watch, Health Plan) |
| What patterns recur across my deployments? | Close Loop Outcomes page is for Directors+ (GB-48) | Delivery ratings, themes (T2); future CLFU reasons | DM Responses; Qualtrics |

**DS/DD emphasis:** Detractors and follow-up across their deployments; readiness oversight; customer risk in deployment context.

## Industry leadership (VP / practice / Jeff's portfolio audience)

| Need | Basis | DM supplies |
|---|---|---|
| Workday-led customer satisfaction for the industry | Key Metrics default to Workday-primed (GB-48) | Programme measure (Top-2 Box, NPS) reconcilable with Qualtrics |
| How much should I trust it? | (DM model commitment) | Evidence base: heard from n of due; closed without response |
| Which customer concerns need leadership awareness? | Detractor process (GB-29/32) | Deployments with Detractor responses / declining trajectory |
| Recurring delivery issues | Driver Questions; Close Loop Outcomes (GB-48) | Delivery ratings (Top-2 Box); themes; future CLFU reasons |
| Partner comparison | Partner Results page (GB-48) | Partner-led PGL reference |
| Is the process working? | Response Rates page (GB-48) | Surveys in motion; evidence gaps; launch-not-seen |

**Leadership emphasis:** programme measure + evidence base + named customer concerns. Rarely the operational lists, but always able to drill into them.

## Shared vs role-specific

| Shared by all three (same facts, same words) | Role-specific emphasis |
|---|---|
| Lifecycle states and counts; programme measure; Detractor responses; evidence base; deployment CSAT history | **EM:** my deployments' upcoming/in-flight and "needs me". **DS/DD:** Detractors and follow-up for deployments they own; readiness oversight. **Leadership:** measure + evidence + recurring issues + partner reference |

**Conclusion: one Overview, not three dashboards.** The same Overview answers all three because each role's emphasis is a **scope** (DM's existing "my deployments" personalization, plus delivery leadership) and a **reading depth** (Level 1 → 3), not a different set of facts. Role-specific dashboards would duplicate the lifecycle and drift. What changes per role is the default scope: personalization already defaults EMs and DDs to their own deployments where configured. Validate per app, since personalization is off for HC and HENP.

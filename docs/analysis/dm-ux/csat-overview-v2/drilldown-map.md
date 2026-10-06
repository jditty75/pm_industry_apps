# Drill-down map

Every Overview signal ends in a destination that shows the deployments and responses behind it, within two steps ([information-hierarchy.md §3](../csat-product-model/information-hierarchy.md)). Destinations are named here, not designed. Every link carries the active **scope** (delivery leadership) and **window**.

| Overview signal | Element | Destination | Pre-applied filter / focus | Tier at destination |
|---|---|---|---|---|
| Scope headline | "View responses →" (OV-1 footer) | **Responses** | scope, window | T1 list; feedback view T2 |
| Stage row (MDS / PGL) | stage label link | **Responses** | scope, window, survey stage | T1 / T2 |
| Band count (e.g. "1" dissatisfied) | each count is a link | **Responses** | scope, window, stage, satisfaction band | T1 / T2 |
| Direction | direction text | **Responses** | scope, stage, *both 6-month halves* shown as a comparison | T1 / T2 |
| Composition note (All scope) | note link | **Responses** | stage, both halves, split by delivery leadership | T1 |
| Partner reference row | row label link | **Responses** | partner-led (or Workday-led in Partner scope), PGL, window | T1 / T2 |
| Heard from / evidence-gap link | "View N evidence gaps →" | **Survey Operations** | deployments due in window with no response (G1), scope, stage | T1 (+ contact data per P7, governed there) |
| Customer Satisfaction risk row | deployment name | **Deployment CSAT history** | that deployment; triggering response highlighted | Scores T1; comments T2 |
| Risk list | "View all N in Responses →" | **Responses** | scope, window, signal = R1/R3/R4/R6 | T1 / T2 |
| Delivery rating item | rating name | **Responses** | scope, window, that rating ≤2 | T1 / T2 |
| Delivery ratings | "All delivery ratings →" | **Responses** (rating profile) | scope, window | T1 |
| Delivery ratings | "Compare by delivery leadership →" | **Responses** (rating profile) | window, split by delivery leadership | T1 |
| Journey counts (Held / Higher / Lower) | each count | **Responses** (paired deployments) | Workday-led, paired, change class | T1 |
| Journey too-few state | "View their histories →" | **Deployment CSAT history** (each pair, via Responses list of the pairs) | paired deployments | T1 / T2 |
| Survey Operations issue (bounced, expiring, invalid rule, can't schedule) | each item | **Survey Operations** | the matching operational view, pre-filtered | T1 |
| Stale data | stale item / pill | **Survey Operations** (import) | import status | T1 (admin actions gated by role) |
| `n<5` cell | none (explanation only) | — | — | — |

Rules:
- A link never goes to a destination the user's tier cannot open. At T1, Responses opens without the feedback view. Overview itself never changes by tier.
- Evidence gaps and operation issues **always** go to Survey Operations. Satisfaction signals **always** go to Responses or deployment history. The two never cross, which keeps the three attention classes separate even after the click.
- No Overview link opens a comment directly. Comments are reached inside the destination under T2.
- In the prototype, links are inert and show a "Destination not built in this prototype" tooltip.

# Next visual-design handoff (after Jeff approves this architecture)

> **Status 2026-10-06: executed.** The architecture and J1–J6 are approved. The resulting design is [../csat-overview-v3/](../csat-overview-v3/README.md). Its state set follows Jeff's V3 brief (healthy, concerns, heavy upcoming, chase, weak evidence, SLG-like, partner-led, no actions). The EM-scope, Responses-disabled and All-scope cases below are covered there as behaviour rules.

**Do not start until Jeff approves this architecture and answers J1–J3.** If J1/J2 are not answered, design with the recommendations and mark the headline treatment as provisional.

## Task

Design **one CSAT Overview** for Deployment Manager, using the reconciled architecture. It is one design, not alternatives, and it is localhost-prototype only. Production DM UI/CSS/JS stays untouched.

## Inputs (authoritative, in this order)

1. [navigation-and-overview.md](navigation-and-overview.md): Overview's job, the three bodies of information, Level 1/2/3.
2. [measurement-and-thresholds.md](measurement-and-thresholds.md): metrics, Detractor rule, terminology.
3. [survey-lifecycle.md](survey-lifecycle.md): states and facets that appear in Level 2.
4. [portfolio-csat-model.md](portfolio-csat-model.md): programme measure vs deployment counts; partner reference.
5. [role-needs.md](role-needs.md): the same Overview read by EM, DS/DD and leadership.
6. Visual language reference only (not structure): [../csat-overview-v2/overview-information-design.md §6–8](../csat-overview-v2/overview-information-design.md) (DM tokens, pills, accessibility intent), [../current-design-system.md](../current-design-system.md).

## What the design must communicate

| Level | Must show | Must not |
|---|---|---|
| **1 Executive message** | Workday-led customer satisfaction now (programme measure, n, d, estimated coverage) · count of deployments with customer concerns · one-line horizon (next round date, deployments launching, surveys in flight) | Lists, tables, more than three statements, any number without its n |
| **2 Management attention** | Five kinds, never summed: Customer concern (named deployments) · Follow-up expected (count by owner role, "in Qualtrics") · Prepare now (next round, readiness issues, prepare-by date) · Chase now (all bounced, closing ≤7 days without response) · Evidence gaps. Each names where the action happens | Action controls; "overdue"; owner/status widgets; mixing kinds |
| **3 Supporting evidence** | Per-survey breakdown with band counts; direction or "too few"; delivery ratings lowest/highest; journey counts; partner-led PGL reference; freshness; method note | Comments, themes, sentiment, Product Area, monthly lines, EM/partner rankings |

## States to design (synthetic data, sized to real per-app volumes)

1. **Normal round week**: next round in 3 weeks, 9 deployments, 2 readiness issues; 3 surveys in flight; satisfaction healthy; 1 Detractor.
2. **Prepare deadline imminent**: prepare-by in 2 days, several readiness issues (Level 2 leads with Prepare).
3. **Round in flight**: survey open, mix of responded/awaiting/all-bounced, closing in 5 days.
4. **Customer concern**: several Detractors, including an MDS → PGL decline; follow-up expected.
5. **Low evidence**: few responses, coverage < 50%; aggregates suppressed where n<5.
6. **EM scope**: "my deployments": 2 deployments, nothing aggregated beyond records.
7. **Responses not enabled**: Overview shows horizon + in flight only.
8. **Partner-led / All scope**: reference behaviour per [portfolio §3](portfolio-csat-model.md#3-workday-led--partner-led-model).

## Acceptance questions for Jeff

1. Can a leader state the portfolio's customer-satisfaction position, with its evidence, within about 5 seconds?
2. Can an EM see, without scrolling, whether anything must be fixed in SFDC before the next launch, and by when?
3. Is every attention item a named deployment with its system of action?
4. Are concern, follow-up, preparation, chase and evidence gaps visibly different kinds of thing?
5. Does it feel like Deployment Manager, and less busy than V2?

## Out of scope for that task

Surveys and Responses section designs; deployment-detail host; any production change; API implementation; CLFU integration; AI.

Follow-on tasks, in order: Surveys section (lifecycle by state), deployment CSAT history, Responses.

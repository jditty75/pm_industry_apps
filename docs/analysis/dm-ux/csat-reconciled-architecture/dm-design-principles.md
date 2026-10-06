# Portable Deployment Manager design principles (from CSAT)

**Scope: principles and a review map only. Nothing outside CSAT is redesigned here.** The whole-app observations come from [../information-architecture.md](../information-architecture.md) and the tab inventory. Most classifications below are hypotheses to test, not findings.

## 1. Principles

| # | Principle | What CSAT taught | Test for any feature |
|---|---|---|---|
| P-1 | **The deployment is the object.** Features are lenses on it | CSAT health is a set of facets of one deployment, read beside internal health | Can every row/item this feature shows be opened as "this deployment, through this lens"? |
| P-2 | **The portfolio is an aggregation of deployments, never a separate dataset** | Every portfolio CSAT figure has a deployment list behind it, reachable in ≤ 2 steps | Does each portfolio number have a drill-down to the deployments that make it up? |
| P-3 | **Distinguish lifecycle state, outcome evidence, required action and history** | Survey state ≠ customer verdict ≠ follow-up expectation ≠ trajectory | Does the feature mix "what is happening", "what was observed" and "what someone must do" in one indicator? |
| P-4 | **Name the system of action** | DM shows *what* to fix *where* and *by when*; SFDC/Qualtrics own the action | For each attention item: where is it resolved, and does DM pretend to resolve it? |
| P-5 | **Show expectations truthfully when completion is invisible** | "Follow-up expected · in Qualtrics", never "overdue" | Does the feature show inferred obligations as if their status were known? |
| P-6 | **Time-boxed, irreversible moments are the highest-value operational signals** | The prepare-by deadline before launch outranks historical analytics | Which deadlines in this feature can't be undone, and are they the most prominent operational facts? |
| P-7 | **Evidence base travels with every figure** | n, d and coverage sit beside satisfaction | Can a reader tell how much data stands behind each number? |
| P-8 | **No opaque composites** | No CSAT health score; facets read together | Does a single score hide components with different owners? |
| P-9 | **Overview communicates health at three levels** (message → attention → evidence) | Level 1 in 5 seconds; Level 2 named deployments; Level 3 on demand | Is the first screen a message, or a wall of equal-weight tiles? |
| P-10 | **Different kinds of attention are never summed** | Concern, follow-up, preparation, chase and evidence gaps are kept apart | Does a "needs attention" count mix different problems and owners? |
| P-11 | **External programme measures must reconcile** | DM's Top-2 Box must equal Qualtrics for the same scope | Where DM restates an external KPI (SFDC health, Qualtrics CSAT), does it reconcile or label the difference? |
| P-12 | **One deployment history accumulates across lenses** | Deployment CSAT history is a chronological record with provenance | Could this feature contribute dated events to a shared deployment timeline? |
| P-13 | **Scope, not separate dashboards, serves different roles** | One Overview; role = scope + depth | Is a role-specific page really a different question, or the same facts at a different scope? |
| P-14 | **Forecasts are labelled forecasts, with their rule** | Upcoming MDS/PGL shows the rule and is superseded by actual launch | Does the feature show derived future dates as facts? |

## 2. Future review map (do not redesign yet)

| Area | Principles to test | Question for the whole-app review |
|---|---|---|
| **Overview** (app) | P-2, P-9, P-10, P-13 | Is DM Overview a Level-1 message across lenses (internal health + customer + go-live horizon), or a collection of tiles? Should CSAT's Level 1 feed it? |
| **Deployments** | P-1, P-12 | Is this the natural host of the deployment-detail surface and its cross-lens history? |
| **Go Lives** | P-6, P-12, P-14 | Go-live dates drive PGL forecasts. Is Go Lives a timeline lens of the same deployment milestones CSAT reads? |
| **Reporting** (Executive Summary, Monthly Report) | P-2, P-7, P-11 | Are reported figures traceable to deployments and reconciled with sources? |
| **Portfolio Health** (Current State, Momentum) | P-2, P-3, P-8 | Is health a facet set or a composite? How does it relate to app Overview? |
| **Trends** | P-7, P-2 | Are trends evidence-qualified, and do they drill to deployments? |
| **Notable** | P-4, P-10, P-12 | Is Notable the cross-lens "attention" layer CSAT concerns could feed, or one more list? |
| **Student** (HENP) | P-1, P-13 | A lens on a deployment subset, or a separate product? |
| **Escalations** (PDX) | P-3, P-4 | Escalation state vs evidence vs action; system of action? |
| **Manage Overrides** | P-4, P-12 | An action surface; should overrides appear as events in deployment history? |

## 3. Conceptual overlaps to examine (no merging in this task)

| Pair | Classification | Why |
|---|---|---|
| App Overview vs Portfolio Health | `POTENTIAL_OVERLAP` | Both claim "portfolio health"; P-9 asks which communicates the message |
| Reporting vs Trends | `POTENTIAL_OVERLAP` | Both present portfolio figures over time; audiences may differ (sent report vs exploration) |
| Go Lives vs deployment timeline / CSAT Upcoming | `POTENTIAL_OVERLAP` | Same milestones (MTP dates) in several lenses; CSAT's PGL forecast is derived from them |
| Notable vs cross-feature attention (CSAT concern, escalations, Executive Watch) | `NEEDS_USER_RESEARCH` | Is Notable *the* attention layer, or a curated list? |
| CSAT customer concern vs deployment health | `CLEARLY_DISTINCT` (different evidence) but should be **juxtaposed** | Customer vs internal perspective; divergence is informative (N4) |
| Feature-specific deployment modals (Deployments edit/meta, Go Lives modal, Escalation detail, Health Plan, Override detail, CSAT history) | `LIKELY_DUPLICATION` | Several partial views of one object; the deployment-detail surface already recommended (Concept B) |
| Portfolio Health Momentum vs Trends | `POTENTIAL_OVERLAP` | Both express change over time |
| CSAT Survey settings (notification rules) vs Reporting distribution | `POTENTIAL_OVERLAP` | Both are DM-sent email rules with a shared `ReportDistributionLog` |
| Student vs Deployments | `NEEDS_USER_RESEARCH` | Subset lens vs separate workflow |
| Executive Watch vs Notable | `NEEDS_USER_RESEARCH` | Two curated attention mechanisms |

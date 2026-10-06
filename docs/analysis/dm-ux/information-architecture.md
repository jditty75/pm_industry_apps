# Information architecture (superset, per-app reduction, scalability)

Sources: `libraries/DepMngr/src/CoreUI_Markup.js` (`_CoreUI_Markup_getAppShell`, `_buildTabBar_`), `CoreConfig.js` (`withDefaults`, role visibility), `solutions/*_DM/src/Config_*.js`, `CoreUI_Js.js` (`switchTab`).

## Superset (top level)

Overview → Deployments → [Student] → Go Lives → Reporting (Executive Summary | Monthly Report) → Portfolio Health (Current State | Portfolio Momentum) → [Escalations] → Trends → CSAT (Upcoming Batches | In-Flight Surveys | Notification Management | File Upload) → Notable Deployments → Manage Overrides.

- **Feature-gated**: Overview (`overviewTab.enabled`), Trends (`trendsTab.enabled`), CSAT (`mgmPglTab/csatTab.enabled`), Notable (`ui.notable.enabled`).
- **Dynamic splice**: Student (`cfg.student.tab.insertAfter`, default after Deployments), Escalations (`escalations.tab.insertAfter`, default after Portfolio).
- **Merged**: `execsummary` + `report` config tabs render as one "Reporting" tab with a segmented control.
- **Role-gated** (`roleVisibility`): READ_ONLY sees Deployments, Go Lives, Portfolio (+Overview). POWER_USER/ADMIN see all (includes CSAT, Overrides, Notable, Trends, Reporting). `?viewAs=READ_ONLY` previews the reduced shell.
- **Secondary navigation (3 idioms)**: `seg-control` segmented buttons (Reporting, Go Lives views, Portfolio views, CSAT horizon/type filters); `csat-subtab-nav` underline sub-tabs (CSAT, with `role=tab`); Student cross-tab banner; no breadcrumbs, **no URL/hash routing or deep links** (no `location.hash`/`pushState` in client JS; state is session-only by design).
- **Detail experiences (modals/expansion)**: Deployments expanded row + Edit modal + Meta modal; Go Lives modal; Override detail/impact-summary modals; Executive Watch modal; Deployment Health Plan modal; Escalation detail modal; Notable edit + add-picker; Student edit; Audit detail; Report send; CSAT rule modal; Confirm modal.

## Per-app reduction (from `Config_*.js`, static reading)

| Tab / feature | SLG | HC | HENP | EVI | PDX | HS |
|---|---|---|---|---|---|---|
| Overview | on | on | on | on | on | on |
| Deployments, Go Lives, Reporting, Portfolio, Overrides | on | on | on | on | on | on |
| Trends | **on** | listed but `enabled:false` (see below) | not listed, off | on | on | on |
| CSAT (id `mgmPgl`) | on, label **"MGM / PGL"** | on, "CSAT" | on, "CSAT" | off | off | off |
| Notable | on | on | on | off | off | off |
| Student | off | off | **on** (after Deployments) | off | off | off |
| Escalations | off | off | off | off | **on** (after Portfolio) | off |
| ProductMode (union scoping) | no | no | no | yes | yes | yes |
| Personalization / welcome | on | off | off | on | on | on |
| Exec Watch | on | (config-driven) | (config-driven) | off | (default) | (default) |

Counting Overview and the merged Reporting tab, the realised bar is 7 tabs (EVI, HS), 8 (PDX with Escalations; HC), and 9 (SLG, HENP). Tab order is hardcoded per app, so ordering and labels diverge (HC Trends last; SLG "MGM / PGL").

**Defect candidate** (static analysis, unverified in browser): HC lists `trends` in `ui.tabs` while `trendsTab.enabled:false`. `_CoreUI_Markup_buildTabBar_` renders every tab in `ui.tabs`, while the Trends panel is only built when enabled → a Trends button with no panel.

## Does the flat tab bar scale to CSAT?

Pressure points:
- CSAT is already the densest tab: 4 sub-tabs plus horizon/type filter bars, KPI strip, tables, 2 modals. Adding Overview, Responses, Customer Feedback and AI Insights means **8-9 sub-areas** under one tab, with HENP simultaneously carrying Student/Notable.
- Adding each as a top-level tab would push SLG/HENP from 9 to roughly 12-13 tabs: the bar wraps (`flex-wrap:wrap`) rather than scrolling or collapsing; no overflow strategy exists (wrap behaviour at 13 tabs not browser-verified).
- Role/feature gating differs by sub-area (aggregates T1, comments T2, AI T2+gate). Tab visibility is the existing, enforced-in-markup gating unit, so top-level tabs map cleanly to permission, but sub-nav can too (gate per sub-tab).
- Same-named things collide: "Responses" (surveys received) vs "In-Flight Surveys" (sent/tracked) need clear grouping, which the approved CSAT architecture already defines.

Alternatives (analysis only):

| Model | Pros | Cons |
|-------|------|------|
| A. One CSAT tab with internal sub-navigation (extends today's `csat-subtab-nav`) | Zero change for other tabs; per-sub-area flags map to existing `csat.responses/feedback/aiInsights` gates; low retraining; matches Reporting/Portfolio precedent | Sub-nav idiom must be standardised first (3 idioms now); 6+ sub-tabs strain one row; deep CSAT nesting hides content behind two clicks; no URL state |
| B. Multiple top-level tabs (CSAT Overview, Survey Tracking, Responses, Feedback) | Direct access; clear permissions | Tab bar overflow (13 tabs); inflates tabs for 3 apps without CSAT surplus; lacks grouping with deployment |
| C. Grouped primary nav (e.g., sections: Portfolio, Deployments, Customer, Operations) with 2nd-level tabs | Scales to any future subsystem (Escalations, Student, Trends); family-wide consistent | Largest change; invalidates "familiar navigation" strength; needs per-app group reduction logic |
| D. Hybrid: keep flat top level; every subsystem owns a standardised second-level nav component; plus deployment-centric drill-through across tabs | Preserves familiarity, enables CSAT growth, fixes inconsistency | Requires the shared sub-nav + deep-link/state work |

Assessment: A/D is the lowest-risk fit; C only becomes necessary if more than CSAT grows (Escalations/Student/Trends could). Decide after concepts; do not add top-level CSAT tabs without grouping.

## Deployment as an organising object

A user asking "what is going on with deployment X?" must currently visit, in the best case:
1. **Deployments** (row expand + Edit/Meta modals: health, stage, partner, dates, notes, override flags).
2. **Go Lives** (go-live record/phases; Go Lives modal).
3. **Overrides** (override detail from Deployments row or Manage Overrides).
4. **Notable** (Notable edit; reachable only via picker/add).
5. **Escalations** (PDX only) detail modal.
6. **Student** (HENP) row.
7. **CSAT** (In-Flight rows by deployment; future Responses timeline).
8. **Trends/Portfolio/Overview** only at aggregate level; red-deployment drilldowns exist.
Existing cross-links are ad hoc and one-way: `goToDeploymentByAccount`, `jumpToDeploymentFromOverride_`, `openNotableAddForDeployment`, `openAuditForDeployment`, `openOverrideDetailFromDeployment_`. There is no single deployment page/panel and no URL for a deployment.

Finding: DM treats the deployment as a **row in several tables**, not an object with one home. A reusable, read-first **deployment detail surface** (hosted in a side panel or modal; each feature contributes a section gated by role/config; CSAT contributes the response timeline) would reduce the visit count from ~4-7 tabs to 1 and give CSAT the "deployment CSAT section" the approved architecture already calls for (`csat-ui-architecture.md` §3). This is a design-phase decision; it does not require changing top-level navigation.

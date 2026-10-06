# Composer prototype specification: CSAT Surveys

Narrow handoff for **one isolated Surveys prototype** with deterministic state pages. Design baseline: [README.md](README.md). This is a focused prototype, **not** production, not Responses, not a deployment drawer, not an API. No giant prototype toolbar.

## 1. Build

| Item | Value |
|---|---|
| Location | `skills/gas-monorepo-engineer/dm-ux-csat-surveys/` (does not modify V3/V2/V1/concept folders or production DepMngr) |
| Styling | Production DepMngr CSS inlined via `skills/gas-monorepo-engineer/scripts/gas_bundle_extract.mjs` from `solutions/HC_DM/src`, same as the V3 prototype. Prototype layout: `dm-ux-csat-surveys/src/csat-surveys.css` (`csat-sv-` prefix). Tokens only — no new colours |
| Files | `csat_surveys_render.py`, `preview_csat_surveys_build.py`, `preview_csat_surveys.py`, `preview_csat_surveys_selftest.py`, `fixtures/csat-surveys-states.json` |
| Fixture | Eight states from README §13; row content stored as final strings plus `stateInputs` (lifecycle state, attention kind, dates, counts) for rule checks. Synthetic values, fictional names (`Example …`, `Sample …`, `Lakeside …`, `Northview …`, `Riverside …`) |
| Shell | DM `.header`, `.tabs` (CSAT active), `.csat-subtab-nav` **Overview · Surveys · Responses** (**Surveys** active), scope button on the sub-nav row, then the sticky filter + phase-jump bar and the one-line horizon strip. **No `.info-banner`** |
| Launch | `.\preview.ps1 CSAT_SURVEYS` → builds, serves, opens **Normal** by default. `-NoOpen` for CI/selftest. Equivalent: `python skills/gas-monorepo-engineer/dm-ux-csat-surveys/preview_csat_surveys.py --no-open` |
| Output | Gitignored `.preview-out/CSAT_SURVEYS_*.html` (the `CSAT_SURVEYS` prefix keeps these from overwriting V3/V2 pages) |
| Selftest | `python skills/gas-monorepo-engineer/dm-ux-csat-surveys/preview_csat_surveys_selftest.py` and `skills/gas-monorepo-engineer/scripts/preview_selftest.py` |
| Visual smoke | `node skills/gas-monorepo-engineer/dm-ux-csat-surveys/preview_csat_surveys_visual_smoke.mjs` → `.preview-out/CSAT_SURVEYS_*_1440x900.png` |
| Implementation README | `skills/gas-monorepo-engineer/dm-ux-csat-surveys/README.md` |

## 2. Pages (stable URLs)

| File / URL path | State |
|---|---|
| `CSAT_SURVEYS_INDEX.html` | Plain list of the eight links, one line each. No shell |
| `CSAT_SURVEYS_NORMAL.html` | 1 Normal upcoming portfolio (**primary review page**, opened by default) |
| `CSAT_SURVEYS_HEAVY.html` | 2 Heavy upcoming month |
| `CSAT_SURVEYS_PREP.html` | 3 Preparation issues |
| `CSAT_SURVEYS_INFLIGHT.html` | 4 Active in-flight |
| `CSAT_SURVEYS_CHASE.html` | 5 Chase / bounce |
| `CSAT_SURVEYS_RESPONDED.html` | 6 Recently responded |
| `CSAT_SURVEYS_NOFORECAST.html` | 7 Cannot forecast |
| `CSAT_SURVEYS_QUIET.html` | 8 Quiet / no immediate activity |

## 3. Prototype chrome (hard limits)

- One small bottom-right badge: `LOCAL PROTOTYPE · State 1 of 8: Normal · All states` (links to the index). Same idiom as the V3 badge.
- **No** scenario/scope/access/branding switcher toolbar, **no** drawer, modal, Responses page, deployment-detail page, Overview page, second banner or animation.

## 4. Interactions

- Hover and a visible 2px `--color-primary` focus outline (2px offset) on every link, tab, chip, the scope button and `<summary>`.
- The **scope button** and **filter/phase-jump chips** render in their resting state with correct `aria` (`aria-haspopup`/`aria-expanded="false"` on the scope button; `aria-pressed` on toggle chips). Activating them does nothing — filtering is demonstrated by the separate state pages, not by live JS. The active phase-jump item may anchor-scroll within the page only.
- Each **In-Flight row** has one collapsed `<details>` "invitation detail" (per-contact awaiting / opened / bounced). This is the **only** interactive disclosure. One representative row is expanded in the screenshot set.
- Row deployment names and "→" links are inert, `title="Destination not built in this prototype"`, except in-page phase anchors.
- Focus order = reading order: sub-nav → scope → filter/jump chips → horizon line links → Upcoming rows → In Flight rows → Recent rows.

**Do not build:** live filtering, scope switching, navigation to any destination, a deployment drawer, tooltips that carry essential information.

## 5. Composition fidelity (1440 × 900)

Follow [README §12](README.md) exactly. Sticky scope + filter bar and a single horizon line above three stacked `.trends-section` groups (Upcoming → In Flight → Recent), each with an 11px/600 uppercase eyebrow and a count header. Two-line rows ≈ 48px, 20–22px baselines, operational density. One dated emphasis per row. No KPI tiles, no large cards, no chart marks, no banner. Attention markers use `.status-pill`; `.status-yellow`/`.status-red` only for time-critical / all-bounced.

## 6. Self-test (assert on every page)

1. Sub-nav has exactly three tabs: Overview, Surveys, Responses (**Surveys** selected).
2. Exactly three lifecycle groups in order — Upcoming, In Flight, Recent — each with its eyebrow (`PREPARE`, `SURVEY`, `RESPOND · CLOSE · FOLLOW UP`). No other content group.
3. Every row has exactly one survey tag (`MDS` or `PGL`) and at most one attention `.status-pill`; normal rows have none.
4. `.status-red` appears only on all-bounced rows; `.status-yellow` only on time-critical prepare (≤ 7 days) or chase (≤ 7 days) rows. No other coloured fills.
5. The five attention kinds are never summed: no element combines two kinds' counts, and no "needs attention" total exists.
6. Every count in the horizon line and group headers is a link (drills to deployments/filter).
7. `Can't forecast` rows appear only in the Upcoming tail, are muted, and carry no yellow/red fill.
8. Each In-Flight row has one collapsed `<details>`; it is closed by default.
9. Banned strings absent (case-insensitive): `Needs Attention`, `Survey Operations`, `overdue`, `completed`, `closed ticket`, `delivered`, `confirmed contact`, `at risk`, `ready` (allowed only inside "readiness issues" / "no readiness issues"), `driver`, `ranking`, `AI Insights`, `coveragePct`.
10. No respondent name/role, contact name or email, and no comment/theme/sentiment text anywhere in the fixture or HTML. Readiness facets name a **role or date only** ("No Executive Sponsor contact", "Missing First Target MTP date").
11. Follow-up facets say "expected" / "status in Qualtrics" and name an **owner role**, never a ticket state, owner name or outcome. Partner-led rows (if present) carry no follow-up facet.
12. No `<canvas>`, no chart `<svg>` (header W mark excepted), no bars/meters/sparklines, no `.info-banner`.

## 7. Screenshots for review

Eight screenshots at **1440 × 900**, default scroll position, named after the page, plus one extra of an In-Flight row with its invitation `<details>` open. Before handover, check for truncation of long deployment names, group-header count accuracy, row baseline alignment, and that empty groups show their informative sentence rather than a blank.

## 8. Visual acceptance questions for Jeff

Answer Yes / Partly / No with a note. Review **Normal** first, then 2–8, then back to Normal.

1. In five seconds, can an EM see what the next round needs them to prepare?
2. Do the three lifecycle groups read as one continuous surface (not tabs), and is the order right?
3. Is the primary row scannable — deployment, survey, date, attention, next step — at operational density?
4. Do exceptions stand out **without** every survey looking like an alert?
5. Are the five attention kinds visibly different kinds of thing, and never summed?
6. Is "Can't forecast" clearly a forecast limitation, not an alarm, and distinct from "Prepare now"?
7. Does Recent give enough closure to answer "what happened to this survey?" without becoming Responses?
8. Is follow-up shown as an **expectation in Qualtrics** only — never overdue, completed or owned by DM?
9. Does the page hold up at a heavy upcoming month and at SLG-like low volume, with the same composition?
10. Does it feel like Deployment Manager and sit naturally beside Overview V3?
11. Do the proposed Surveys rules (S1–S5) feel right: Recent = current + previous round, Later collapsed, attention-first sort, quiet-by-default rows?

Approval phrase for this stage: **CSAT SURVEYS VISUALLY APPROVED**.

## 9. Out of scope

Production DepMngr UI/CSS/markup/JS/config; CLASP; deploy; CoreLib release; APIs; EDM; workbooks; the Responses design and page; the deployment-history / deployment-drawer surfaces; the Overview page; Workday-brand experiments; live filtering or scope switching; modifying the V3/V2 prototypes.

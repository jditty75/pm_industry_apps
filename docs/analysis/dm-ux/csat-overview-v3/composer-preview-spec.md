# Composer prototype specification: CSAT Overview V3

Narrow handoff for the **implemented** localhost prototype (design spec baseline commit `daf663e`).

## 1. Build

| Item | Value |
|---|---|
| Location | `skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/` (does not modify V2/V1/concept folders or production DepMngr) |
| Styling | Production DepMngr CSS inlined via `skills/gas-monorepo-engineer/scripts/gas_bundle_extract.mjs` from `solutions/HC_DM/src`. Prototype layout: `dm-ux-csat-overview-v3/src/csat-overview-v3.css` (`csat-v3-` prefix) |
| Files | `csat_overview_v3_render.py`, `preview_csat_overview_v3_build.py`, `preview_csat_overview_v3.py`, `preview_csat_overview_v3_selftest.py`, `fixtures/csat-overview-v3-states.json` |
| Fixture | Eight states from [state-model.md](state-model.md); sentences A/B/C and region copy stored as final strings plus `messageInputs` for rule checks |
| Shell | DM `.header`, `.tabs` (CSAT active), `.csat-subtab-nav` **Overview · Surveys · Responses** (Overview active), scope menu button on the sub-nav row. **No `.info-banner`** |
| Launch | `.\preview.ps1 CSAT_OVERVIEW_V3` → builds, serves, opens **Healthy**. `.\preview.ps1 CSAT_OVERVIEW_V3 -NoOpen` for CI/selftest. Equivalent: `python skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/preview_csat_overview_v3.py --no-open` |
| Output | Gitignored `.preview-out/CSAT_OVERVIEW_V3_*.html` |
| Selftest | `python skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/preview_csat_overview_v3_selftest.py` and `skills/gas-monorepo-engineer/scripts/preview_selftest.py` |

## 2. Pages (stable URLs)

| File | State |
|---|---|
| `CSAT_OVERVIEW_V3_INDEX.html` | Plain list of the eight links, one line each. No shell |
| `CSAT_OVERVIEW_V3_HEALTHY.html` | 1 Healthy (**primary review page**, opened by default) |
| `CSAT_OVERVIEW_V3_CONCERNS.html` | 2 Customer concerns present |
| `CSAT_OVERVIEW_V3_UPCOMING.html` | 3 Heavy upcoming-survey month |
| `CSAT_OVERVIEW_V3_CHASE.html` | 4 Several surveys need chasing |
| `CSAT_OVERVIEW_V3_LOW_EVIDENCE.html` | 5 Weak / insufficient evidence |
| `CSAT_OVERVIEW_V3_SLG.html` | 6 Low-volume SLG-like (SLG shell) |
| `CSAT_OVERVIEW_V3_PARTNER.html` | 7 Partner-led scope |
| `CSAT_OVERVIEW_V3_CLEAR.html` | 8 No immediate actions |

The V3 prefix keeps these pages from overwriting the V2 pages in `.preview-out/`.

After `.\preview.ps1 CSAT_OVERVIEW_V3` (port from the preview server, typically `http://127.0.0.1:<port>/`):

| URL path | State |
|---|---|
| `/CSAT_OVERVIEW_V3_HEALTHY.html` | 1 Healthy (**default open**) |
| `/CSAT_OVERVIEW_V3_CONCERNS.html` | 2 Customer concerns |
| `/CSAT_OVERVIEW_V3_UPCOMING.html` | 3 Heavy upcoming |
| `/CSAT_OVERVIEW_V3_CHASE.html` | 4 Chase |
| `/CSAT_OVERVIEW_V3_LOW_EVIDENCE.html` | 5 Weak evidence |
| `/CSAT_OVERVIEW_V3_SLG.html` | 6 SLG-like low volume |
| `/CSAT_OVERVIEW_V3_PARTNER.html` | 7 Partner-led |
| `/CSAT_OVERVIEW_V3_CLEAR.html` | 8 No immediate actions |
| `/CSAT_OVERVIEW_V3_INDEX.html` | Plain index (no DM shell) |

## 3. Prototype chrome (hard limits)

- One small bottom-right badge: `LOCAL PROTOTYPE · State 1 of 8: Healthy · All states` (links to the index).
- **No** toolbar, scenario/scope/access/branding switchers, drawer, modal, Surveys page, Responses page, deployment-detail page, second banner or animation.

## 4. Interactions

**Build:**
- Hover and a visible 2px primary focus outline (2px offset) on every link, tab, the scope button and `<summary>`.
- The scope button renders **closed** with `aria-haspopup` / `aria-expanded="false"`. Activating it does nothing. Partner-led is demonstrated by its own page.
- `<details>` *Breakdown and method* works natively (collapsed by default). This is the only interactive disclosure.
- Links are inert, with the title "Destination not built in this prototype". The R1 C concern count is a same-page link to R2 (`#csat-v3-concerns`) and **does** work.
- Focus order = reading order: sub-nav → scope button → R1 links → R2 → R3 → R4 → summary.

**Do not build:** scope switching, window menu, navigation to any destination, tooltips that carry essential information.

## 5. Composition fidelity (1440 × 900)

Follow [information-hierarchy.md §4–6](information-hierarchy.md) exactly. Key measurements: R1 top ≈ 244px, height ≈ 152 · R2/R3 row ≈ 304, 7/5 columns · R4 ≈ 114 · bottom ≤ 860 on Healthy. One 32px figure. One 20px sentence. No other text above 14px except the existing DM header title.

## 6. Self-test (assert on every page)

1. Sub-nav has exactly three tabs: Overview, Surveys, Responses (Overview selected).
2. Regions `R1`–`R4` (`data-csat-region`) are present, in order, on all eight pages. No other content region exists.
3. Exactly one element has the anchor-figure class. Exactly one has the headline class.
4. R1 contains no `<li>`, no `<table>` and no deployment name from the fixture.
5. The R1 A word matches the rules for the fixture inputs: tier (n), satisfaction word (displayed % vs 80/65), direction (halves ≥ 10, ±10 points, opposition rule).
6. R1 C clause order matches the priority rule (time-critical → concern, else concern → horizon). The concern clause is always present.
7. Every % on the page has an "x of n" or "n responses" in the same region.
8. Banned strings absent (case-insensitive): `Needs Attention`, `AI Insights`, `Survey Operations`, `driver`, `significant`, `outperform`, `leaderboard`, `ranking`, `overdue`, `completed`, `at risk`, `because`, `due to`, `caused`, `coveragePct`, `bonus`, `compensation`, `incentive`, `performance plan`. (`ready` is allowed only inside the phrase "readiness issues".)
9. No comment text, respondent role or contact name or email in the fixture or the HTML.
10. Partner page: no "Follow-up expected" string inside R2 rows; the partner footer sentence is present.
11. No `<canvas>`, no `<svg>` charts (the header W mark excepted), no bars or meters.
12. `<details>` is closed by default. The disclosure contains the single `<table>` on the page.

## 7. Screenshots for review

Eight screenshots at **1440 × 900**, default scroll position, named after the page. Check them for truncation of long deployment names, R2/R3 height mismatch and wrapping in R1 C before handing over. Add one extra screenshot of Healthy with the disclosure open (full height).

## 8. Visual acceptance questions for Jeff

Answer each one Yes / Partly / No, with a note. Review Healthy first, then 2–8, then return to Healthy.

1. Can an executive understand the CSAT message in five seconds?
2. Does the page clearly show what needs attention now?
3. Is Upcoming visible enough, given that preparation is the primary operational use case?
4. Does the page connect customer outcomes with deployment actions?
5. Does it feel like Deployment Manager?
6. Is it materially calmer than V2?
7. Can an EM still find their operational priorities?
8. Does the page remain useful at SLG-like low volume?
9. Are concern, follow-up, preparation, chase and evidence gaps visibly different kinds of thing, and never added up?
10. Does any sentence claim more than the visible evidence supports? (Check states 2, 5 and 7.)
11. Is the partner-led context quiet enough, and never a contest?
12. Do the proposed DM rules (V3-D1…D7 in the [README](README.md)) feel right: "strong" at 80%, "recent" at 90 days, follow-up shown for 30 days?

Approval phrase for this stage: **CSAT OVERVIEW V3 VISUALLY APPROVED**. Until Jeff says it, the Surveys, Responses and deployment-history visual passes do not start.

## 9. Out of scope

Production DepMngr UI/CSS/markup/JS/config; CLASP; deploy; CoreLib release; APIs; EDM; workbooks; Surveys, Responses and deployment-history designs; Workday-brand experiments; modifying the V2 prototype.

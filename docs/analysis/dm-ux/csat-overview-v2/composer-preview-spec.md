# Composer prototype specification — CSAT Overview v2 (one design, seven static states)

Narrow handoff. It authorizes building **one** CSAT Overview design as **seven deterministic static pages** plus a plain index. Nothing else. Build only after Jeff accepts this design spec.

## 1. Build

| Item | Value |
|---|---|
| Location | `skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/` (implemented). Do **not** modify `dm-ux-concept/` or `dm-ux-csat-overview/` (the rejected A/B/C) |
| Styling | Production DepMngr CSS inlined via `skills/gas-monorepo-engineer/scripts/gas_bundle_extract.mjs` from `solutions/HC_DM/src`. Prototype-only CSS: `skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/src/csat-overview-v2.css` |
| Build | `python skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/preview_csat_overview_v2_build.py` |
| Renderer | `skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/csat_overview_v2_render.py` |
| Fixture | `skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/fixtures/csat-overview-v2-states.json` |
| Shell | Real DM header, real top-level tab bar (CSAT active), the single CSAT `.info-banner` (copy from [overview-information-design.md §5](overview-information-design.md)), `.csat-subtab-nav` with exactly **Overview · Responses · Survey Operations** (Overview active) |
| Data | One fixture `fixtures/csat-overview-v2-states.json` holding the seven states exactly as in [state-model.md](state-model.md). Values are copied verbatim, never generated or randomised. The renderer computes nothing; it formats fixture values |
| Output (gitignored) | `.preview-out/` pages below |
| Launch | `.\preview.ps1 CSAT_OVERVIEW_V2` → builds, serves, opens **Healthy** (`CSAT_OVERVIEW_HEALTHY.html`). `.\preview.ps1 CSAT_OVERVIEW_V2 -NoOpen` for CI/selftest. Index: `CSAT_OVERVIEW_V2_INDEX.html` on the same server |
| Selftest | `python skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/preview_csat_overview_v2_selftest.py` (also wired in `scripts/preview_selftest.py`) |

## 2. Pages (stable URLs)

| File | State |
|---|---|
| `CSAT_OVERVIEW_V2_INDEX.html` | Plain list of the seven links with one-line descriptions. No shell |
| `CSAT_OVERVIEW_HEALTHY.html` | 1 Workday-led · healthy · adequate evidence |
| `CSAT_OVERVIEW_RISK.html` | 2 Workday-led · concerning satisfaction |
| `CSAT_OVERVIEW_LOW_EVIDENCE.html` | 3 Workday-led · inadequate evidence |
| `CSAT_OVERVIEW_DECLINE.html` | 4 Workday-led · meaningful decline |
| `CSAT_OVERVIEW_PARTNER.html` | 5 Partner-led scope |
| `CSAT_OVERVIEW_ALL.html` | 6 All-deployments scope |
| `CSAT_OVERVIEW_LOW_VOLUME.html` | 7 SLG-like low volume (SLG shell title) |

States 1–6 use an HC-like app shell. State 7 uses the SLG-like shell. Header titles come from the existing app config strings and contain no customer data.

### Stable URLs (localhost)

After `.\preview.ps1 CSAT_OVERVIEW_V2` (port from preview server, typically `http://127.0.0.1:<port>/`):

| URL path | State |
|---|---|
| `/CSAT_OVERVIEW_HEALTHY.html` | 1 Healthy (default open) |
| `/CSAT_OVERVIEW_RISK.html` | 2 Concerning satisfaction |
| `/CSAT_OVERVIEW_LOW_EVIDENCE.html` | 3 Low evidence |
| `/CSAT_OVERVIEW_DECLINE.html` | 4 Meaningful decline |
| `/CSAT_OVERVIEW_PARTNER.html` | 5 Partner-led |
| `/CSAT_OVERVIEW_ALL.html` | 6 All deployments |
| `/CSAT_OVERVIEW_LOW_VOLUME.html` | 7 SLG-like low volume |
| `/CSAT_OVERVIEW_V2_INDEX.html` | Plain index (no DM shell) |

## 3. Prototype chrome (hard limits)

- One small corner badge, bottom-right, not full-width: `LOCAL PROTOTYPE · State 3 of 7: Low evidence · All states`, where "All states" links to the index.
- Nothing else. No toolbar, no dropdowns, no scope/scenario/access/branding switchers, no A/B/C links, no second banner.

## 4. Interactions

**Build:**
- Hover and visible focus (2px primary outline, 2px offset) on links, sub-nav tabs, scope segments, risk rows, band-bar segments and `n<5` / `n<10` / `REFERENCE` / ⓘ explanations. Tooltips show the explanatory text in the spec.
- Keyboard focus order follows reading order: sub-nav → scope bar → OV-1 → OV-2 → OV-3 → OV-4 → OV-5.
- Correct ARIA per [overview-information-design.md §8](overview-information-design.md): tablist for sub-nav, radiogroup for the scope control (static `aria-checked` per page), real table semantics.

**Do not build:**
- Working scope switching. The scope control is rendered with the state's active segment, and clicking it does nothing. Scope is demonstrated by states 1, 5 and 6 as separate pages.
- Window select behaviour (render the closed control only).
- Any navigation to Responses, Survey Operations or deployment history. Links are inert with the tooltip "Destination not built in this prototype".
- Drawer, modal, Responses page, Survey Operations page, branding toggle, layout-changing controls, animation.

## 5. Fidelity checklist (Composer self-test)

Add `preview_csat_overview_v2_selftest.py` (and register it in `preview_selftest.py`) to assert, for every state page:

1. Sub-nav contains exactly three tabs, labelled Overview, Responses, Survey Operations.
2. The OV-1 title contains the scope name matching the active segment.
3. Every mean on the page has an adjacent response count.
4. The strings `Needs Attention`, `AI Insights`, `driver`, `Drivers of Satisfaction`, `Customer Feedback` (as nav), `significant`, `outperform`, `leaderboard`, `ranking` do not appear (case-insensitive). No copy refers to people-management or organisational-performance consequences of CSAT. All copy describes delivery only.
5. No customer comment text exists in the fixture or the HTML.
6. Regions OV-0…OV-5 are present in the same order on all seven pages (one composition).
7. Fixture values in the HTML match `state-model.md` (spot-check headline, PGL row, risk count, qualifier per state).
8. No `<canvas>` or chart library. Bars and meters are plain HTML/CSS.

## 6. Screenshots for review

Seven screenshots at **1440 × 900**, one per state page, default scroll position. No other screenshots are required. Name them after the page (`CSAT_OVERVIEW_HEALTHY.png`, …). Before handing them over, check the rendered pages for label collisions and overflow (bars, long deployment names, the qualifier sentence).

## 7. Out of scope

Production DepMngr UI/CSS/markup/JS/config; CLASP; deploy; CoreLib release; APIs; EDM; workbooks; the Responses, Survey Operations and deployment-history designs; Workday-brand experiments.

## 8. Visual acceptance questions for Jeff

Answer each one Yes / Partly / No, with a note. Review the states in order 1 → 7, then return to 1.

**Story**
1. Reading state 1 top to bottom, does it tell one coherent Customer Satisfaction story (scope → score → evidence → stages → risk → ratings → process), or does it still feel like a set of tiles?
2. Can I say the narrative sentence from [reading-narrative.md](reading-narrative.md) after about 30 seconds on the page?

**Workday-led emphasis**
3. Is it obvious, without reading the controls, that I'm looking at Workday-led deployments?
4. Does the Workday-led emphasis feel natural rather than heavy-handed?
5. Is the partner-led reference row useful context or a distraction? Does it ever read as a contest?
6. In states 5 and 6, do Partner-led and All deployments feel like deliberate alternative lenses, with their limits (no MDS, mixed PGL) clearly stated?

**Evidence**
7. Can I tell how much evidence supports each score (responses, deployments, heard from) without hunting?
8. In state 3, does the page stop me trusting a high score that rests on thin coverage, without making the page look broken?
9. In state 7, does the page remain useful at SLG-like volume? Do "too few responses" and `n<5` feel honest and intentional?

**Attention**
10. Can I distinguish Customer Satisfaction risk, evidence gaps and Survey Operations issues at a glance? Are they ever confused?
11. For each risk row, do I know why it's there without opening anything?
12. In state 4, is the decline clear and correctly located (PGL, not MDS), without overstating it?

**Next step**
13. Do I know where I would go next from each signal?
14. Is there anything on the page I would not use, or anything missing that I'd expect on a monitoring visit?

**Deployment Manager fit**
15. Does this clearly belong in Deployment Manager (blue, type, density, tables, status pills), while being better organised than today?
16. Is anything visually louder than it should be (headline figure, red pills, bars)?

Approval phrase for this stage: **CSAT OVERVIEW VISUALLY APPROVED**. Until Jeff says it, Responses, Survey Operations and deployment-history visual design do not start.

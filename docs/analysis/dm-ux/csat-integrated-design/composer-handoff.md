# Composer handoff — integrated CSAT prototype (2026-10-06)

**This is the single build spec for the integrated CSAT prototype. No further Claude design prompt is required before implementation.** Build the navigable subsystem (Overview ↔ Surveys ↔ Responses + drill into Deployment CSAT History), create the shared components, harmonize Overview and Surveys visually, wire navigation/drill-down, add representative states, add tests, and run one self-review screenshot pass. Design rationale is in [`README.md`](README.md); do not re-derive it.

## 0. Hard boundaries (do not cross)

- **Prototype/local only.** Fully isolated from production. No change to production UI, CSS, markup, JS, or config.
- **No EDM, no workbooks, no R3 APIs, no CLASP, no deploy, no CoreLib release.** Fixtures are synthetic and in-prototype.
- **Do not change approved information architecture** (navigation, Overview four regions, Surveys lifecycle workflow, measurement semantics, provenance separation, attention-never-summed). The self-review permission (§8) is for layout defects only.
- Respondent **identity is never rendered** (role only). No green in the CSAT body. No modal/drawer for deployment detail.

## 1. Where to build & how to run

**Implemented:** `skills/gas-monorepo-engineer/dm-ux-csat-integrated/` (build, render, fixtures, shared CSS/JS, selftest, Playwright screenshots).

| Action | Command |
|--------|---------|
| Launch (opens Overview) | `.\preview.ps1 CSAT_INTEGRATED` |
| CI / no browser | `.\preview.ps1 CSAT_INTEGRATED -NoOpen` |
| Build only | `python skills/gas-monorepo-engineer/dm-ux-csat-integrated/preview_csat_integrated_build.py` |
| Selftest | `python skills/gas-monorepo-engineer/dm-ux-csat-integrated/preview_csat_integrated_selftest.py` |
| Screenshots (1440×900) | `node skills/gas-monorepo-engineer/dm-ux-csat-integrated/preview_csat_integrated_screenshots.mjs` |

**Default URL:** served `CSAT_INTEGRATED.html` → hash `#/overview`. **Routes:** `#/overview` · `#/surveys` · `#/responses` · `#/deployment/<synthetic-id>/csat`. Standalone `CSAT_OVERVIEW_V3_*` and `CSAT_SURVEYS_*` previews unchanged.

**Screenshot output:** `.preview-out/csat-integrated-screenshots/` (post self-review pass, 2026-10-06).

Prototype CSS prefix: `csat-ix-` for integrated-only chrome; shared components use `csat-` names from README §3.

## 2. Shell & navigation

- Real DM shell (header card + 48px blue strip + Workday "W", `.container` at the shared CSAT content width).
- **Tri-tab** `Overview · Surveys · Responses` via `csatSubtabNav` (reuse `.csat-subtab-nav/-btn/-badge/-panel` + `switchCsatSubTab()`; add roving `tabindex` + arrow keys). Survey settings (ADMIN) is out of the navigable prototype except as a stub link.
- `csatScopeMenu` right of the sub-nav on every surface ("Workday-led · Rolling 12 months ▾").
- **Routing / deep links:** `#/overview`, `#/surveys`, `#/responses`, and `#/deployment/<id>/csat` (Deployment CSAT History). Deployment history is a **routed in-page workspace** — the content region swaps, sub-nav + scope persist, a breadcrumb returns to the originating list with scope/filters restored from URL state. No drawer, no modal.

## 3. Page specs

### 3.1 Responses (`#/responses`)
Four altitudes (README §1.1): **L0** scope bar + `csatFilterBar` (PRIMARY chips + ADVANCED disclosure) · **L1** learning strip `data-csat-region="RESP_LEARN"` — the five facts (README §1.3), each a filter-link · **L2** `Group by` toggle (Deployment · Survey[default] · Response) + result list of `csatRow`s, attention-first sort, overflow cap + "+k more →" · **L3** evidence via **inline row expansion** only (`csatProvenanceBlock`: Customer comment / Qualtrics analysis). Lenses: Delivery ratings (ranked lowest-first, descriptive) and Product Area ("responses touching area", n<5 suppressed). T1 renders without comments; T2 adds the evidence panel without changing navigation.

### 3.2 Deployment CSAT History (`#/deployment/<id>/csat`)
Six-facet header (README §2.1) over the chronological E1–E12 spine (README §2.2), each event tagged milestone / process / outcome / action / history; forecasts labelled as forecasts. Content inventory per README §2.3, including compact Aspect/Team/Agreement score chips (no portfolio bars), T2 comments, labelled Qualtrics analysis, and out-links to Surveys (this deployment's row), Responses (pre-filtered deployment × survey), and a Qualtrics stub (action). Breadcrumb back to origin.

### 3.3 Overview & Surveys
Link into the existing frozen state pages; apply only the harmonization in README §4 (Overview: shared tags/links/status, wire drill-down to the real pages) and README §5 (Surveys: shared `csatRow` grid, section-summary into headers, 1000px breakpoint, verdict chip in freed space). Do not alter their content or workflow.

## 4. Shared components

Build every component in README §3 once, on the existing token layer, used identically across all four surfaces. Retire ad-hoc CSAT colour literals in favour of `--color-status-*`. The `csatRow` CSS-grid track system is shared by Surveys and Responses and is the mechanism that fixes Surveys' horizontal utilisation.

## 5. State matrix (fixtures)

New synthetic state pages (README §7): `RESPONSES_NORMAL`, `RESPONSES_LOW_VOLUME` (SLG shell), `RESPONSES_T2_DETAIL`, `DEPLOYMENT_HISTORY_MDS_PGL`, `DEPLOYMENT_HISTORY_MDS_ONLY`, `DEPLOYMENT_HISTORY_FOLLOWUP`, plus an `_INDEX`. Reuse the 8 `CSAT_OVERVIEW_V3_*` and 8 `CSAT_SURVEYS_*` pages for the navigable shell. Fixtures must honour the canonical field set and the honesty rules: NPS only on PGL rows and only shown at n ≥ 10; cells n < 5 suppressed as "n < 5"; product-area counts labelled "responses touching area"; separate respondent verdicts never averaged; blank ≠ 0; `overall_satisfaction` may differ from `pgl/mds_satisfaction` on a few rows (flag, don't reconcile). Keep volumes realistic (HC low-hundreds, SLG dozens).

## 6. Data grounding

Ground fixtures in `csat-response-v1` (`docs/analysis/csat-subsystem/`). Customer-authored vs Qualtrics-derived must be visibly separated (`csatProvenanceBlock`). Use real canonical fields: `survey_type` (MDS/PGL), `overall_satisfaction`, `pgl_satisfaction`, `mds_satisfaction`, `nps_score` (PGL), the four `comment_*`, `*_sentiment`/`*_parent_topics` + `qx_analytics_json`, Aspect/Team/Agreement delivery dimensions, `product_areas`/`product_area_groups`, `priming_partner_type` (Workday/Partner), `deployment_stage_at_response`, dates. Do not invent unavailable data (no follow-up completion/owner/ticket status; no sentiment on Overview; no root cause; no causal driver claims).

## 7. Tests

Add the prototype's own structural/client tests (match the existing CSAT prototype test style): routing/deep-link resolution, tri-tab + roving-tabindex a11y, state-page render, suppression behaviour (n<5, NPS n<10), provenance blocks never merged, no green in the CSAT body, one-filled-pill-per-row. Report what was actually run and its result; do not claim coverage that was not executed.

## 8. Composer visual self-review (eliminate one human iteration)

1. Build. 2. Render each state at **1440×900** via Playwright. 3. Inspect the screenshots. 4. If obvious layout defects exist (misaligned `csatRow` columns, overflow past 900px, whitespace the harmonization was meant to remove, drawer-like/scrim artefacts, green in body), perform **one** internal refinement pass. 5. Re-render. 6. Report the final screenshots and the before/after of any refinement. This permission is for layout polish only — it must not change approved IA. Fine pixel polish beyond this one pass is left to human screenshot iteration.

## 9. Acceptance — the prototype must let Jeff answer yes

1. Does CSAT feel like one coherent subsystem? 2. Does Overview summarize without duplicating the other pages? 3. Does Surveys work as the operational lifecycle? 4. Does Responses make historical learning understandable? 5. Can I move naturally from portfolio signal → deployment evidence? 6. Does deployment history tell the customer's story of that deployment? 7. Do HC/SLG/HENP feel like the same product? 8. Does everything still feel like Deployment Manager?

## 10. Review sequence (Jeff)

1. `.\preview.ps1 CSAT_INTEGRATED` → **Overview** (`#/overview`).
2. **Surveys** (`#/surveys`) — confirm lifecycle density / `csatRow` grid.
3. **Responses normal** — `CSAT_INTEGRATED_RESPONSES_NORMAL.html` or `#/responses`.
4. Open **Example Health Network** → `#/deployment/syn-ehn-001/csat`.
5. **Deployment CSAT History** — MDS→PGL story, breadcrumb back.
6. Return to **Responses**; toggle **T2 evidence** → `CSAT_INTEGRATED_RESPONSES_T2_DETAIL.html`.
7. **SLG low-volume** — `CSAT_INTEGRATED_RESPONSES_LOW_VOLUME.html`.
8. **HENP** — `CSAT_INTEGRATED_HENP.html` (`#/overview`).
9. Back to **Overview** — subsystem coherence check.

The next step after this prototype is Jeff's visual approval — not another design cycle.

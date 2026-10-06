# Composer preview specification — CSAT Overview A/B/C only

Narrow handoff. This spec authorizes building **three static/interactive localhost pages only** — one CSAT Overview composition each — for a fair side-by-side visual comparison. It does not authorize the deployment drawer, Responses, Customer Feedback, production code, CLASP, or deploy.

## 1. What to build

Three pages, each a standalone, stable URL:

- `/DM_UX_CSAT_A.html` — Overview A per `overview-a.md`
- `/DM_UX_CSAT_B.html` — Overview B per `overview-b.md`
- `/DM_UX_CSAT_C.html` — Overview C per `overview-c.md`

Each renders: the current DM header/shell → unchanged top-level tab bar (CSAT active) → CSAT sub-nav (Overview active; Survey Tracking/Responses/Customer Feedback present but inert — clicking them does nothing in this pass, no need to build those screens) → the one Overview composition's content, per its layout diagram and region spec. Reuse real DM CSS/components by inlining `CoreLib.CoreUI.getStylesheet()`/markup patterns from `libraries/DepMngr/src`, exactly as the existing `dm-ux-concept` preview already does (per `../preview-strategy.md` and `../preview-concept-spec.md` §1) — do not invent a new visual system or a new CSS approach.

## 2. Prototype chrome (hard constraint)

At most:

- A small, dismissible "LOCAL PROTOTYPE — NOT PRODUCTION" indicator, corner-anchored, not a full-width bar.
- Simple `A | B | C` links, placed **outside/above** the application shell (e.g., in a thin strip above the header card, not inside it), so switching compositions doesn't require any in-app control.

Explicitly **not** to build: the Phase-1 prototype's full-width "PROTOTYPE CONTROLS" dropdown bar, its duplicate "LOCAL UX PROTOTYPE" banner stripe, any Concept/App/Visual/Access/Scenario selector, any erratic state-switching control. The application content should dominate the viewport — chrome is a corner badge plus three links, nothing more.

## 3. One synthetic dataset, three renderers

Build **one** synthetic dataset and render all three pages from it, so composition is the only variable Jeff is comparing. Dataset shape (consistent with `canonical-response-model.md` and `../preview-concept-spec.md` §5):

- **25–40 synthetic deployments**, SLG shell, obviously fake names (e.g., "Example County," "Sample School District," "Synthetic Water Authority" — never real account names).
- Mix of MDS-only, PGL-only, and both-survey-types-present deployments.
- Realistic satisfaction spread: a majority in the 3.5–4.5 range, a handful (4–6) deliberately low (≤2.5) or declining across their response history, to populate the Needs Attention list/table meaningfully.
- NPS present on PGL-bearing deployments, with overall portfolio n ≥ 10 so the headline NPS is not itself in the low-n state (keep a *separate* smaller-n slice for the low-n demonstration, see below).
- Product Areas: multi-valued per response (1–4 areas each), spanning at least 6 distinct areas; at least one area with fewer than 5 total responses (for the Product Area `n<5` state) and at least one area with strong representation (for a "top area" reading).
- Response volume adequate to drive a believable 12-month trend line (don't need the full ~300/yr production projection — a plausible monthly distribution is enough).
- A handful of responses flagged as having an associated comment (for the feedback-flag ⚑ glyph) — **no comment text itself** needs to exist in this dataset tier, since Overview is T1-only; a boolean is sufficient.
- Survey Tracking context numbers (sent/completion rate/awaiting/upcoming/bounced) populated plausibly, consistent with the deployment set above.

No real customer data, ever, per repo convention (`../preview-concept-spec.md` §5, §9).

## 4. Fixed comparison conditions

Across all three pages, hold identical:

- **Shell**: SLG app shell, same header title/subtitle/freshness timestamp.
- **Data**: the one synthetic dataset above — same numbers appear in each composition's hero/strip/columns (Overall 4.2, PGL 4.0, MDS 3.8, NPS 42, etc. — pick one fixed set of headline numbers and reuse verbatim across A/B/C).
- **Period**: same default period selection (e.g., "Last 90 days") visible on load for all three.
- **Visual tokens**: Treatment 1 only (current DM tokens — primary `#0F4C81`, existing neutrals). Do **not** build a Treatment 2 (Workday) variant in this pass — out of scope per `comparison.md`'s "Future Workday-brand opportunities."

Only the Overview composition (layout, component choices, hierarchy) should differ between the three pages — this is the entire point of the comparison.

## 5. Exact screenshot states for review

Capture and present exactly these three screenshots, each **1440×900**, nothing else needed for this pass:

1. `/DM_UX_CSAT_A.html` — CSAT → Overview, default period, default filters (no filters applied), T1 access.
2. `/DM_UX_CSAT_B.html` — same state.
3. `/DM_UX_CSAT_C.html` — same state.

Optional, only if useful to show the n<5/low-n treatment in context (not required for the primary comparison): one additional screenshot per composition with a filter applied that narrows the dataset enough to trigger at least one `n<5` cell, to confirm the suppression treatment reads correctly in situ. If captured, keep these as a clearly separate "state" set from the three primary screenshots so they don't get compared against each other as if they were different compositions of the same data.

## 6. Interactions this pass does need (and does not)

**Needed** (enough to judge the composition, not to build the next phase):
- Hover/focus states on KPI cards, attention rows/table rows, and Product Area rows (to confirm clickability reads correctly even though the destination isn't built).
- The n<5/low-n pill's hover/focus affordance showing its explanatory text.
- Trend chart renders statically with legible labels; no animation required.

**Not needed** (explicitly deferred):
- Any real navigation — clicking Survey Tracking/Responses/Customer Feedback sub-nav, or an attention-row/table-row "View supporting responses" link, may no-op or show a simple "Overview-only prototype" tooltip rather than navigating anywhere.
- The deployment drawer in any form.
- Any T1/T2 access-level toggle control in the UI chrome — build the Overview pages at T1 only, since that's the composition's actual intended access level; do not reintroduce a prominent access-switcher control as part of this narrow pass.
- Loading/error/empty states — out of scope for this comparison; the existing broad prototype already demonstrates those patterns and nothing here depends on re-proving them.

## 7. What not to touch (restated from README)

No production DepMngr runtime/CSS/markup/JS/config, no CLASP, no deploy, no modification to `skills/gas-monorepo-engineer/dm-ux-concept/` (the Phase-1 broad prototype — build these three pages alongside it, not inside or over it), no API/EDM/workbook changes.

# Comparison and recommendation

## Preserved / Evolved / New / Removed

### Overview A — Executive signal first

| | |
|---|---|
| **Preserved** | Header card, top-level tabs, single info banner, filter-row + chip vocabulary, Deployments' unequal-weight KPI-card pattern (one dominant + colored-accent supporting cards), compact table density, status-pill color semantics. |
| **Evolved** | The KPI-card pattern is evolved from "3 cards, similar size" (Deployments) to "1 hero + 3 compact" — same component family, new size variant. |
| **New** | Hero-sized KPI card (no current equivalent at this scale); the Overall-Satisfaction sparkline-beside-number treatment; the trend line+volume-bar chart; the Attention card as a named, bordered component. |
| **Removed** (vs. today's CSAT tab) | Nothing removed — today's CSAT tab has no Overview at all, so this is purely additive. The only prior pattern this *replaces* is the failed prototype's 5-equal-KPI row and oversized drawer chrome — neither of which is current production. |

### Overview B — Balanced operational analytics

| | |
|---|---|
| **Preserved** | Same shell/banner/filter vocabulary as A. Closest fit to Portfolio Health/Reporting's existing equal-weight multi-tile strips. |
| **Evolved** | Survey Coverage is evolved from "a one-line callout" (A) into a real compact stat list, borrowing In-Flight's existing KPI-strip content at reduced scale. |
| **New** | The three-column equal-weight strip as a single coherent card (new composite component); Attention as a first-class column rather than a sidebar. |
| **Removed** | Nothing from production; same note as A re: the failed prototype. |

### Overview C — Investigation first

| | |
|---|---|
| **Preserved** | Reuses the Deployments table component nearly directly (sortable headers, link cells, status-colored score column) — the strongest direct reuse of the three compositions. |
| **Evolved** | KPI cards are evolved away from card form entirely into a slim text reference strip — a deliberate reduction, not a new component. |
| **New** | Per-row trend sparkline inside a table cell; Product-Area-as-filter-for-attention-table interaction; "Show: All · Declining · Low score" filter chip. |
| **Removed** | The KPI-card component is absent from this composition entirely (replaced by the reference strip) — the only composition where a current DM component family (KPI card) doesn't appear on this screen at all. |

## Comparison matrix

| Dimension | A — Executive signal | B — Balanced | C — Investigation |
|---|---|---|---|
| Fit with current DM | Strong — extends Deployments' own KPI asymmetry | Strong — extends Portfolio Health/Reporting's strip rhythm | Strong — extends Deployments' table directly, but introduces a metrics style (text strip) with no current analogue |
| Information hierarchy | Clear, single-headline | Clear, three-way | Clear, investigation-led |
| Operational usefulness (quick satisfaction read) | High | High | Low — requires reading the reference strip, easy to skim past |
| Operational usefulness (triage) | Moderate (5-row attention list) | Moderate (5-row attention column) | High (sortable 10–12 row table) |
| Density | Moderate | Moderate–high (most content above the fold) | High |
| Analytical clarity (answers "better or worse?") | High (delta + sparkline on the headline) | High (trend chart full-width) | Moderate (trend relegated to a small mini-chart) |
| Scalability (more metrics/areas later) | Good — supporting tiles can grow to a 4th/5th without disturbing the hero | Good — columns can each grow modestly | Good — table rows scale naturally; Product Area panel is the tightest space |
| Implementation feasibility | Straightforward — reuses existing KPI-card and new line-chart components | Straightforward — reuses existing KPI-card plus a new 3-column composite | Straightforward — heaviest reuse (existing table component), lightest new-component surface |
| Accessibility | Good — large numeral + non-color-only delta glyph | Good — equal-weight columns reduce reliance on size for meaning | Good — table semantics (headers, sort) are the most mature a11y pattern already in DM |

## Recommendation

**Overview A — Executive signal first.**

Reasons, weighed against the brief's own criteria:

1. **Fit with current DM**: A is the most direct, legible extension of a pattern DM users already know — Deployments' TOTAL/RED/YELLOW asymmetric KPI row — applied one level up to "how are customers doing." A user who already understands Deployments' KPI row understands Overview's hero card with zero new learning.
2. **Information hierarchy**: the brief's own progression — portfolio health → signal → where's the issue → which deployments — maps cleanly onto A's layout top-to-bottom: hero (health) → supporting tiles + trend (signal) → attention list (where) → Product Area (which responses explain it). B spreads the same progression across equal-weight columns, which is coherent but reads as "three things to notice" rather than a progression. C inverts the progression (leads with "which," ends with "health"), which is right for a *return visit* during active triage but wrong for a *first glance* landing screen.
3. **Operational usefulness**: A answers the stated headline question ("how are customers experiencing deployments") fastest, while still surfacing an actionable attention list in the same view — it does not sacrifice triage capability, it sequences it second.
4. **Scalability & implementation feasibility**: A's component list (hero KPI card, compact KPI card, trend chart, attention card, Product Area list) is the smallest new-component surface of the three and composes cleanly with components Composer will build anyway for B and C's shared elements.

**C's attention table is not wasted** — recommend carrying its richer table treatment (sortable columns, per-row sparkline, feedback flag column) forward into the dedicated **Responses** screen design (a later pass), where an investigation-dense table is unambiguously the right primary content. **B's three-column strip** is worth keeping on record as the stronger option if Jeff's later feedback is that CSAT needs to feel more like Portfolio Health/Reporting's existing dashboards than like a satisfaction headline.

This recommendation is not approved — Jeff reviews the three rendered compositions before any direction is chosen.

## Accessibility considerations (all three)

- Large numerals (hero or strip) are never the *only* signal of direction or severity — every delta/decline indicator pairs an arrow glyph and explicit sign with color, never color alone (per discovery finding, `../concept-a-evolve-in-place.md` §13 "color-only status" audit).
- Trend chart axis labels, series labels, and legend are real text (not canvas-only unlabeled strokes), sized ≥11px, with a reduced-motion-safe static render (no animated line-draw-in).
- Attention list/table rows and Product Area rows are real interactive elements (`<button>`/`<a>`) with visible focus states, not `div onclick` — consistent with the a11y fixes already scoped for the shared shell in `../concept-a-evolve-in-place.md` §13.
- `n<5` and "low n" treatments are never conveyed by omission (a blank cell) — always an explicit, legible label plus an accessible explanation on focus/hover, not hover-only.
- C's sortable table headers get `aria-sort` and keyboard sort activation, matching the existing Go Lives sortable-column fix already scoped for the shared shell.
- Sub-nav (Overview/Survey Tracking/Responses/Customer Feedback) uses the already-specified `sub-nav` semantics (`role=tablist`/`tab`/`aria-selected`) — unchanged by this visual pass, just confirmed as the landing point.

## Future Workday-brand opportunities (not designed in this pass)

Per `../recommended-direction.md` §"Decisions required from Jeff," these remain open and are **not** addressed by any of the three compositions above (all three are built on Treatment 1 — current DM tokens, unchanged primary blue):

- **Ballpoint blue** as the primary token, once the `#0057AE` vs. `#0875C1` authority question is resolved.
- **Archivo** for the hero numeral specifically (A) or the reference-strip numerals (C) — the hero card in A is the single best candidate in this whole screen for a typography experiment, since it's a genuinely new large-numeral treatment rather than a reskin.
- **Chart palette**: the trend chart's Overall/PGL/MDS line colors are drawn from existing status semantics in all three compositions here; a future Workday-palette pass could evaluate the original material's secondary chart colors specifically against this chart, once a composition is chosen.
- **Contrast methodology**: whichever composition is chosen should get the same contrast audit already scoped for the shared shell (`--color-text-subtle`, orange-as-text) applied to any new hero/strip numeral colors.

None of this is designed here — flagged only as where a later, separate Workday-branding pass could focus once the information-hierarchy question (A/B/C) is settled.

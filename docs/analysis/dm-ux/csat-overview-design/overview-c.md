# Overview C — Investigation first

> **Status: not selected — product information model under redesign.** See [../csat-product-model/](../csat-product-model/README.md).

Design-spec document. No runtime changed. Reference viewport: **1440×900**, content container `max-width:1400px` centered.

## Concept

Built around the workflow "find the deployments/areas that need a look," with headline metrics reduced to a reference strip rather than a destination in themselves. This is the composition for a PM/engagement-manager audience whose actual task on this screen is triage, not a satisfaction readout — the metrics exist to justify and contextualize the investigation list, not to lead it.

## Layout diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Header card — unchanged]                                                    │ 88px
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview  Deployments  Go Lives  Reporting  Portfolio Health  Trends  CSAT…  │ 44px
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview   Survey Tracking   Responses   Customer Feedback                   │ 40px
├──────────────────────────────────────────────────────────────────────────────┤
│ ⓘ Find deployments and areas that need a closer look.                       │ 36px
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔍 Search   Period ▾   Show: All · Declining · Low score   Product Area ▾   │ 44px
├──────────────────────────────────────────────────────────────────────────────┤
│  Overall 4.2 (n=238)  ·  PGL 4.0 (n=142)  ·  MDS 3.8 (n=96)  ·  NPS 42 (n=61)│ 32px  (slim reference strip)
├───────────────────────────────────────────────────────┬──────────────────────┤
│  Needs attention — 6 deployments                       │  Product Area        │
│  DEPLOYMENT          SCORE  TREND     AREA      ⚑      │  Core HCM  4.3 (88)  │
│  Example County—HCM   2.1    ╲        Core HCM   ⚑      │  Payroll   3.9 (44)  │ 480px
│  City of Hagerstown   PGL 1.8 ╲       Payroll    ⚑      │  Benefits  n<5 ⓘ     │
│  Clark County (WA)    2.6    ╲        Benefits          │  … 5 more            │
│  Broward Co. Sheriff  3.0    ╲╱       Core HCM           │  (click filters      │
│  Anoka County         2.9    ╲        Multiple           │   attention list)   │
│  Metro Wash. Airports 3.1    ─         Payroll            │                     │
│  (sortable: score · trend · recency · area)             │  Trend (mini)       │
│  Row → View supporting responses                         │  ╱‾╲_╱‾ overall     │
├───────────────────────────────────────────────────────┴──────────────────────┤
│  Survey context: 32 sent · 68% completion · 4 awaiting · View Survey Tracking →│ 36px
└──────────────────────────────────────────────────────────────────────────────┘
```

Heights: 88+44+40+36+44+32+480+36 ≈ 800px — leaves headroom versus 900 for comfortable row spacing in the attention table (this composition's dominant element).

## Region specification

- **Reference strip** (full width, ~32px): a single text line, not cards — `Overall 4.2 (n=238)  ·  PGL 4.0 (n=142)  ·  MDS 3.8 (n=96)  ·  NPS 42 (n=61)`, each segment separated by a middle-dot, numerals bold/14px, labels 11px uppercase muted. This is intentionally the least visually prominent headline treatment of the three compositions — it exists so a user never has to leave Overview to recall the topline numbers while investigating, not to be read first.
- **Investigation row** (full width, ~480px, split **65/35**):
  - *Needs Attention table* (≈900px): this composition's workhorse, structured as a real compact table (reusing the Deployments table component) rather than a short card list — up to 10–12 rows, columns: Deployment (link/chip), Score (with survey-type label inline since Overall/PGL/MDS must never be shown as one blended column, per `canonical-response-model.md` §2), Trend (a tiny per-row sparkline, ~40×16px), Area (first/primary Product Area + "+N" if multiple), and a feedback flag column (⚑ glyph only when a T2-gated comment exists, never preview text). Sortable by score, trend direction, recency, or area (reusing the existing sortable-header pattern noted for Go Lives in `../concept-a-evolve-in-place.md` §13). Row click: "View supporting responses" (entry point only, not built in this pass).
  - *Product Area panel* (≈500px): same ranked list as A/B, but here it is interactive in spec intent — selecting an area is described as filtering the attention table to that area (behavior to specify further at implementation time; this pass only establishes that the two panels are visually paired side by side so the relationship reads immediately). Below it, a small trend sparkline (no axis labels, just shape) gives just enough trend context without competing with the reference strip above.
- **Survey context footer** (full width, ~36px): same single-line treatment as Overview A's, placed last because operational coverage is the least relevant fact to an investigation-first workflow — present for completeness, not competing for attention.

## Visual hierarchy

- **Eye sees first**: the "Needs attention — 6 deployments" table header and its first few rows — the largest, most structured region on the page, positioned immediately below the (deliberately minimal) reference strip.
- **Eye sees second**: the Product Area panel beside it, since the two are visually paired at equal height and a user scanning the table for a pattern naturally glances right to check if a Product Area explains it.
- **Action encouraged**: sort/filter the attention table, then drill into a specific row — this composition is built for someone who already knows they're here to triage, not to get a general readout.
- **Intentionally de-emphasized**: the headline metrics (reference strip only) and survey coverage (footer only) — both present for context, neither competing with the investigation surface.
- **Why it fits DM**: it reuses the Deployments tab's actual table component (sortable headers, status-colored score column, link cells) almost directly, which is the single most "DM" surface in the whole application — this composition will feel the most immediately familiar to a Deployments power-user, at the cost of feeling less like a dedicated "CSAT health" summary at a glance (see trade-off in `comparison.md`).

## n<5 / T1

Same `n<5` pill treatment as A/B. The per-row feedback flag (⚑) in the attention table is the same non-content boolean indicator used in A/B's attention card — this composition surfaces it more often (one per row, in its own column) simply because the table has room for it, not because it reveals more; T2 content access rules are unchanged.

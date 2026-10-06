# Overview A — Executive signal first

> **Status: rejected for visual/information design — superseded by approved product model.** Current Overview design: [../csat-overview-v2/](../csat-overview-v2/README.md). Product model: [../csat-product-model/](../csat-product-model/README.md).

Design-spec document. No runtime changed. Reference viewport: **1440×900**, content container `max-width:1400px` centered (matches current DM, per `../current-design-system.md`).

## Concept

One dominant number carries the page. Everything else is scaled down from it. This is the composition that most directly mirrors Deployments' own KPI row (`TOTAL` neutral + `RED`/`YELLOW` status-colored, unequal weight by design) applied to CSAT: **Overall Satisfaction is the "TOTAL"** of customer experience, and PGL/MDS/NPS are its supporting breakdown — not three more equals.

## Layout diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Header card — unchanged: W mark · title/subtitle · freshness pill · actions]│ 88px
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview  Deployments  Go Lives  Reporting  Portfolio Health  Trends  CSAT…  │ 44px  (top-level tabs, unchanged)
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview   Survey Tracking   Responses   Customer Feedback                   │ 40px  (CSAT sub-nav)
├──────────────────────────────────────────────────────────────────────────────┤
│ ⓘ Customer experience across active & historical deployments.                │ 36px  (info banner, one only)
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔍 Search account/deployment   Period: Last 90 days ▾   Type: All·MDS·PGL   │ 44px  (filter row)
│    Product Area ▾        Advanced Filters        Clear filters              │
├───────────────────────────────────────────┬──────────────────────────────────┤
│  OVERALL SATISFACTION                     │  PGL SATISFACTION                │
│                                            │  4.0        n=142                │ 200px
│  4.2  ▲0.3 vs prior period                 ├──────────────────────────────────┤
│  72% favorable · n=238                     │  MDS SATISFACTION                │
│  ╱‾‾╲_╱‾‾‾ (sparkline, 6 pts)              │  3.8        n=96                 │
│                                            ├──────────────────────────────────┤
│                                            │  NPS (PGL)                       │
│                                            │  42         n=61                 │
├───────────────────────────────────────────┼──────────────────────────────────┤
│  Satisfaction trend                        │  Needs attention          6      │
│  [line chart: Overall / PGL / MDS,         │  • Example County — Core HCM     │ 260px
│   monthly, volume bars beneath axis,       │    Overall 2.1 ↓ · 3 responses   │
│   n<5 months shown as dotted/unfilled]     │  • City of Hagerstown             │
│                                            │    PGL 1.8 · negative feedback ⚑ │
│  Period: 12 months ▾                       │  • Clark County (WA)              │
│                                            │    Declining 3 surveys running   │
│                                            │  … (2 more)                      │
│                                            │  View all in Responses →         │
├───────────────────────────────────────────┼──────────────────────────────────┤
│  Product Area                              │  Survey context                  │
│  Core HCM        ████████ 4.3 (n=88)       │  32 sent · 68% completion         │
│  Payroll         ██████   3.9 (n=44)       │  4 awaiting response             │ 140px
│  Benefits        ████     n<5 ⓘ            │  View Survey Tracking →           │
│  … View all Product Areas →                │                                   │
└───────────────────────────────────────────┴──────────────────────────────────┘
```

Approx. heights: header 88 + tabs 44 + sub-nav 40 + banner 36 + filters 44 + hero row 200 + trend/attention 260 + bottom row 140 ≈ 852px, fits 900 with normal page margin; trend chart and attention list may each scroll internally if content exceeds height rather than growing the page.

## Region specification

- **Hero band** (full width, ~200px): two cards, ratio **60/40**.
  - *Overall Satisfaction card* (≈820px wide): white surface, `--radius-lg`, `--shadow-sm`, 3px top border in primary blue (`#0F4C81`, Treatment 1). Number at ~44–48px/700, immediately followed by a small delta indicator (▲/▼ + value, colored by direction using existing status green/red, never color-only — always paired with the arrow glyph and a sign). "% favorable · n=" in 12px muted gray beneath. A compact sparkline (last 6 periods) sits to the right of the number, not below it — reinforces this card answers "trending up or down," not just "what is it today."
  - *Supporting tiles* (≈540px wide): PGL Satisfaction, MDS Satisfaction, NPS stacked as three compact cards reusing the exact Deployments KPI-card visual (3px colored top border, bold number ~28px, small uppercase label, `n=` caption) — same component, smaller instance, never the hero's size. NPS card shows the low-n treatment when applicable (see below).
- **Trend + Attention row** (full width, ~260px): **70/30** split.
  - *Trend chart* (≈960px): one line per series (Overall solid, PGL/MDS dashed or distinct hue from the existing status palette — not a rainbow), monthly granularity, light volume bars anchored to the x-axis baseline for response-count context, axis labels legible at 11–12px, period control reusing the filter row's period selector (no duplicate control). Months with n<5 render the line as a dotted/lower-opacity segment rather than suppressing the point, so a thin stretch of data doesn't read as a cliff.
  - *Attention card* (≈440px): header "Needs attention" + a count badge (reusing the status-pill red/yellow treatment for the badge only). Up to 5 rows, each: deployment name (acts as "Open deployment context" — not built in this pass, just the entry point), a one-line reason (score + direction, or "negative feedback" with a small flag glyph if a T2-gated comment exists — glyph only, no text preview), and nothing else. Footer link **"View all in Responses →"**.
- **Bottom row** (full width, ~140px): **even wider split, 65/35.**
  - *Product Area* (≈900px): compact horizontal ranked bar list, top 5–6 areas by response volume, label + thin bar + score + `n=`. Areas with n<5 show the `n<5` pill in place of a bar/score. Caption under the list: "Responses touching area — one response can span multiple areas." Link: "View all Product Areas →" (destination: Responses, pre-filtered by area, built in a later pass).
  - *Survey context* (≈500px): single-line operational callout — sent count, completion rate, awaiting-response count for the active period — styled like the existing blue info banner but compact (not a full card), with one link **"View Survey Tracking →"**.

## Visual hierarchy

- **Eye sees first**: the Overall Satisfaction number and its delta — largest type, top-left of the content region, the position current DM users already scan first (where Deployments puts its TOTAL card).
- **Eye sees second**: the Attention card, because it sits at the same vertical band as the trend chart and uses a status-colored count badge — the one piece of color-coded alarm on the page.
- **Action encouraged**: click into the Attention list → Responses, pre-filtered. This is the one "do something" affordance on the page; everything else is read-only context.
- **Intentionally de-emphasized**: Survey Tracking (reduced to a single-line callout — it has its own destination already) and Product Area detail (a compact list, not a chart, since a dense comparison communicates better than a bar chart at this size per the brief).
- **Why it fits DM**: it reuses the exact unequal-weight KPI pattern Deployments already uses (one dominant neutral number, smaller status-flavored supporting numbers), the same info-banner/filter-row/compact-card vocabulary, and introduces exactly two new elements (a hero-sized KPI card and a line+bar trend chart) rather than a new visual system.

## n<5 treatment

A small pill, visually consistent with `.status-pill` sizing but neutral gray (not red/yellow/green — this is a privacy/reliability signal, not a health signal): text `n<5`, with a small (ⓘ) affordance that reveals, on hover/focus, "Fewer than 5 responses — suppressed to protect reliability and privacy." Used in: NPS card (when n<10, labeled "low n" variant with the same visual family), Product Area rows, and any trend-chart point. Never a blank cell, never a zero.

## T1 safety

Everything on this composition is T1: scores, counts, deltas, trend lines, deployment names, Product Area labels. The Attention card's feedback flag is a boolean glyph (has-comment / no-comment), never comment text — consistent with `csat-ux-requirements.md`'s rule that comments require a distinct, separately permission-checked call.

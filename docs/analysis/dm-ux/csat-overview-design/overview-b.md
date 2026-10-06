# Overview B — Balanced operational analytics

> **Status: not selected — product information model under redesign.** See [../csat-product-model/](../csat-product-model/README.md).

Design-spec document. No runtime changed. Reference viewport: **1440×900**, content container `max-width:1400px` centered.

## Concept

No single dominant number. Three questions — "how satisfied are customers," "how much coverage/signal do we have," "what needs attention" — get genuinely equal visual weight as three columns, because for a DD/VP audience reviewing CSAT alongside other portfolio-health screens (Reporting, Portfolio Health, Trends), outcome, coverage, and risk are equally load-bearing, not a single headline with footnotes. This directly answers the brief's challenge to the failed prototype's "five equal KPI cards" differently than A does: instead of collapsing to one dominant number, B keeps three equal *zones*, each internally hierarchical (not five equal tiles).

## Layout diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Header card — unchanged]                                                    │ 88px
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview  Deployments  Go Lives  Reporting  Portfolio Health  Trends  CSAT…  │ 44px
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview   Survey Tracking   Responses   Customer Feedback                   │ 40px
├──────────────────────────────────────────────────────────────────────────────┤
│ ⓘ Customer experience across active & historical deployments.                │ 36px
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔍 Search   Period: Last 90 days ▾   Type: All·MDS·PGL   Product Area ▾ …   │ 44px
├────────────────────────────┬────────────────────────────┬────────────────────┤
│ CUSTOMER OUTCOMES           │ SURVEY COVERAGE             │ NEEDS ATTENTION   │
│                              │                              │             6     │
│ Overall 4.2 ▲0.3  n=238     │ 32 sent this period          │ • Example County  │
│ ───────────────────────     │ 68% completion rate          │   Overall 2.1 ↓   │ 230px
│ PGL 4.0 n=142                │ 4 awaiting response          │ • City of         │
│ MDS 3.8 n=96                 │ ───────────────────────     │   Hagerstown      │
│ NPS  42  n=61                 │ 12 upcoming (3 mo)           │   PGL 1.8 ⚑       │
│                              │ 0 bounced/failed             │ • Clark County    │
│                              │                              │   declining       │
│                              │                              │ View all →        │
├────────────────────────────┴────────────────────────────┴────────────────────┤
│  Satisfaction & volume trend                                                 │
│  [line: Overall/PGL/MDS, monthly · bars: response volume · period selector]  │ 220px
├───────────────────────────────────────────┬────────────────────────────────┤
│  Product Area                              │  Survey Tracking detail →        │ 140px
│  Core HCM ████████ 4.3 (n=88)              │  (link out — not built here)     │
│  Payroll  ██████   3.9 (n=44)              │                                   │
│  Benefits ████     n<5 ⓘ                   │                                   │
└───────────────────────────────────────────┴────────────────────────────────┘
```

Heights: 88+44+40+36+44+230+220+140 ≈ 842px — fits 900 with margin.

## Region specification

- **Three-column zone** (full width, ~230px, columns ≈ 440/440/520):
  - *Customer Outcomes* (left): Overall Satisfaction as the largest element in its column (~32px numeral, smaller than A's hero since it shares the row with two equally-weighted neighbors) with delta and n; a thin rule; then PGL/MDS/NPS as a compact label:value:n list below it (not separate cards — a tighter, column-native list treatment, since the column itself is already the visual boundary).
  - *Survey Coverage* (center): promoted relative to A — not a one-line callout but a real compact stat list: sent, completion rate, awaiting-response count, upcoming count, bounced/failed count — mirroring the existing In-Flight KPI strip's content (`concept-a-evolve-in-place.md` §3, "Survey Tracking... already has the right KPI strip") but condensed to fit a column rather than a full tab.
  - *Needs Attention* (right): same content and interaction as Overview A's attention card (deployment + reason, up to 5 rows, footer link), but here it's a first-class column rather than a sidebar — equal border/shadow treatment to its neighbors, not visually subordinate.
  - All three columns share one card chrome (white surface, `--shadow-sm`, thin divider rules internally) so the row reads as one coherent strip, the way Deployments' TOTAL/RED/YELLOW row reads as one strip despite the cards having different accent colors.
- **Trend row** (full width, ~220px): identical content/behavior to Overview A's trend chart, but full-width here (no attention card competing for the row) since Attention already got its own column above — avoids showing the same information twice.
- **Bottom row** (~140px): Product Area list identical to A's (left, ≈900px). Right column (≈500px) is a single link-out card to Survey Tracking rather than duplicate stats, since Survey Coverage already appeared above — this avoids redundancy between the top zone and the bottom row.

## Visual hierarchy

- **Eye sees first**: the three-column header strip as a unit — because all three cards share the same visual weight and sit on one row, the eye scans left-to-right (Outcomes → Coverage → Attention) before settling on any single number. This is deliberate: it mirrors how a DD/VP actually reviews portfolio health today (several equal-weight tiles on Portfolio Health/Reporting), so CSAT Overview feels consistent with the rest of DM's operational-dashboard pages, not uniquely headline-driven.
- **Eye sees second**: the trend chart, since it's the next full-width band and the largest visual element after the strip.
- **Action encouraged**: still the Attention column's "View all →", but it is one of three equally-weighted options rather than the obviously dominant visual — a user genuinely interested in coverage (e.g., "did enough surveys go out this quarter") is equally served.
- **Intentionally de-emphasized**: nothing is as de-emphasized as in A — this is the composition's defining trait and its trade-off (see `comparison.md`).
- **Why it fits DM**: Portfolio Health and Reporting already use multi-tile, equal-weight strips (`ph-kpi`, `trends-v1-stat-row` per `../current-design-system.md`) — this composition is the closest sibling to those existing pages' rhythm, so a user moving between CSAT and Portfolio Health sees a familiar pattern rather than a different idiom per tab.

## n<5 / T1

Identical treatment to Overview A (same `n<5` pill, same T1-only scope, same feedback-flag-not-content rule in the Attention column).

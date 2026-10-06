# CSAT Overview — information design

One design. It follows [reading-narrative.md](reading-narrative.md) step by step. The scope model is detailed in [workday-partner-comparison.md](workday-partner-comparison.md). The seven states are in [state-model.md](state-model.md).

Region IDs are `OV-0…OV-5`. They are deliberately different from the risk-signal IDs `R1–R6` in [data-to-insight-map.md §4](../csat-product-model/data-to-insight-map.md).

## 1. Metric definitions used on Overview

Binding for the prototype and for later implementation. Vocabulary follows [metric-semantics.md §8](../csat-product-model/metric-semantics.md), except that "driver" becomes "delivery rating".

| Metric | Definition | Display |
|---|---|---|
| **Overall Satisfaction (mean)** | `overall_satisfaction` 1–5, responses in the active scope and window. **Deployment-weighted**: average each deployment's responses first (per stage for stage rows; across its in-window responses for the scope headline), then average those deployment values. Null Overall excluded | One decimal, "4.3 / 5". Never two decimals. `n<5` responses → "n<5" instead of a mean |
| **Response bands** | Count of responses Satisfied (4–5), Neutral (3), Dissatisfied (1–2). **Raw response counts** with no weighting, so stakeholder disagreement inside a deployment stays visible | Counts "17 · 2 · 1" + 3-segment bar. No % on Overview (at n of 7–30, a percentage looks more precise than the data is) |
| **Responses (n)** | Count of in-window responses with a non-null Overall | Always shown with any mean |
| **Deployments (d)** | Distinct `deployment_id` behind those responses | Always shown with n |
| **Heard from (coverage)** | Deployments with ≥1 response for the stage ÷ deployments whose survey for that stage **fell due** in the window (due rule pending validation, README V1/V2) | "17 of 20 due" + 5-step meter. Per stage only; never a blended headline %. Never multiplied into satisfaction |
| **Weighting note** | Shown only when the deployment-weighted and response-weighted means differ by ≥0.2 | One muted line in OV-1: "Each deployment counts once. Counting every response gives 4.0. 3 deployments with several respondents rated lower." |
| **Direction** | Latest 6 months vs preceding 6 months *within the selected 12-month window*, per row. Requires **≥10 responses in each half** for that row. Improving / Declining when the deployment-weighted mean moves by **≥0.3** (proposed default, README V5); otherwise Stable | Word + glyph + values: "▼ Declining 4.3 → 3.6". Insufficient: "Too few responses to determine direction", with the half counts "(6 · 8; 10 needed in each)" |
| **NPS** | PGL only. %promoters (9–10) − %detractors (0–6) among PGL responses with `nps_score`. Requires n≥10 | Signed integer "+41" with "(n 31)". Below threshold: "n<10". MDS row: "Not asked" |
| **Delivery ratings** | Deployment-weighted mean of each approved delivery dimension with n≥5 in scope (see OV-3) | "Schedule management 3.8 (n 30)" |
| **Paired deployments** | Deployments in scope with ≥1 MDS response (any date) and ≥1 PGL response in window. Change = PGL deployment mean − MDS deployment mean. Held: \|Δ\| < 1; Higher: ≥ +1; Lower: ≤ −1 | Counts only. Breakdown shown only at ≥5 pairs |

Rules applied everywhere: blank is null, never zero. No figure without its n. No significance language. No monthly series.

## 2. Hierarchy

| Priority | Region | Narrative steps |
|---|---|---|
| Frame | **OV-0 Scope bar** | 1 |
| **Primary 1** | **OV-1 Customer Satisfaction** (scope headline + stage rows + partner reference + evidence qualifier) | 2, 3, 4, 5, 6, 10 (gaps) |
| **Primary 2** | **OV-2 Customer Satisfaction risk** | 7 |
| Secondary | OV-3 Delivery ratings | 8 |
| Secondary | OV-4 MDS → PGL journey | 9 |
| Tertiary | OV-5 Survey Operations status | 10 (process) |

Visual weight follows that order. Primary regions have the larger cards, the top row, the only 28px figure (OV-1) and the only red status pills (OV-2). Secondary regions are single-band cards with 13px content. The tertiary region is a borderless status strip on the page background.

The three attention classes each have their own home, wording and destination, and their counts are never added together:

| Class | Home | Visual treatment |
|---|---|---|
| Customer Satisfaction risk | OV-2, its own card | Status pills (red/yellow, always with text) |
| Evidence gap | OV-1 footer: the evidence qualifier sentence | Neutral info line; caution glyph + yellow-fg text only when coverage <50% |
| Survey Operations issue | OV-5 foot-of-page strip | ⚠ glyph + muted text; no fills |

## 3. Region summary

| Region | Business question | Drill-down |
|---|---|---|
| OV-0 Scope bar | Whose satisfaction, over what period, how fresh? | — (controls) |
| OV-1 Customer Satisfaction | How satisfied, on how much evidence, at each stage, which direction, and how does partner-led PGL compare? | Responses (scope/stage/window) · Survey Operations (evidence gaps) |
| OV-2 Customer Satisfaction risk | Which customers told us something concerning, and what exactly? | Deployment CSAT history · Responses (risk filter) |
| OV-3 Delivery ratings | Which delivery dimensions do customers rate lowest/highest? | Responses (rating ≤2 on that dimension / full profile) |
| OV-4 MDS → PGL journey | Do deployments that answered both surveys hold satisfaction? | Responses (paired, filtered to change class) |
| OV-5 Survey Operations status | Is the collection process limiting what we see? | Survey Operations (pre-filtered) |

Full map: [drilldown-map.md](drilldown-map.md).

## 4. Region specifications

### OV-0 Scope bar

| | |
|---|---|
| **Question** | "Whose satisfaction am I looking at, over what period, and how current is it?" |
| **Information** | Left: label **Delivery leadership** + `.seg-control` **Workday-led** (default, active) · **Partner-led** · **All deployments**. Then label **Window** + compact select **Rolling 12 months** with the resolved date range in text ("Oct 2025 – Sep 2026"). Any non-default inherited DM header scope (personalization owner/"Showing", product mode) is echoed as read-only text: "Showing: my deployments". Right: "Responses imported 5 Oct 2026, 07:12" with the existing `freshness-fresh/aging/stale` pill semantics, plus the existing secondary **Refresh** button |
| **Why here** | Scope changes what every number means. It must be stated once, first, and repeated in each region subtitle |
| **Priority** | Frame. Controls only, no metrics |
| **Window options** | All are 12 months long, so Direction keeps one meaning: *Rolling 12 months* (default), *Previous 12 months*, and fiscal years once history covers them (data starts 2025-11) |
| **Not here** | Survey stage filter (stage is always a split, never a filter), Product Area, EM, partner, services approach. Those are Responses lenses. No "More filters" on Overview V1 |
| **T1/T2** | T1 |
| **Low-n** | n/a |

### OV-1 Customer Satisfaction (primary 1)

| | |
|---|---|
| **Question** | "How satisfied are customers in this scope, on how much evidence, at each survey stage, is it changing, and how does partner-led PGL compare?" |
| **Why Overview space** | It is the reason CSAT exists. Score and evidence are one unit (product model commitment 2) |
| **Priority** | Highest. Top-left, 8 of 12 columns, the only 28px figure on the page |
| **T1/T2** | T1 |

**Structure (top → bottom):**

1. **Card header.** Title "Customer Satisfaction · Workday-led deployments" (the scope name is part of the title and changes with scope). Subtitle "Rolling 12 months · Oct 2025 – Sep 2026". Right: an ⓘ "How these figures are calculated" popover listing the §1 definitions in plain words.
2. **Scope headline line** (one row, ~48px). Label OVERALL SATISFACTION (11px uppercase muted) → **4.3** (28px/700) + "/ 5" (14px muted) → "52 responses · 40 deployments" (13px) → direction ("▬ Stable · 4.2 → 4.3 · 24 · 28 responses"). No bar and no card-in-card. This is a line of text, not a KPI tile.
3. **Stage table** (`<table>`, DM table styling). Columns:

   | Survey stage | Satisfaction | Responses · Satisfied · Neutral · Dissatisfied | Evidence | Heard from | Direction | NPS |
   |---|---|---|---|---|---|---|
   | **MDS** Mid-deployment | **4.4** | bar + "17 · 2 · 1" | 20 responses · 17 deployments | 17 of 20 due + meter | ▬ Stable 4.3 → 4.4 | Not asked |
   | **PGL** Post go-live | **4.2** | bar + "27 · 4 · 1" | 32 · 25 | 25 of 29 due | ▬ Stable 4.2 → 4.2 | +41 (n 31) |
   | ↳ *Partner-led PGL* `REFERENCE` | 4.0 | bar + "17 · 4 · 2" | 23 · 19 | *Comparison context — observed values only* (spans Heard from → NPS) | | |

   The reference row is muted: `--color-text-muted` text, bar segments at 55% opacity, label indented 16px, a small `REFERENCE` tag (10px uppercase, 1px border, no fill). Its behaviour in each scope is defined in [workday-partner-comparison.md](workday-partner-comparison.md).
4. **Stage note** (12px muted, one line, under the table): "MDS and PGL rows are different deployments at different points in delivery. For deployments with both, see MDS → PGL journey." This replaces any separate stage-comparison visual.
5. **Evidence qualifier** (footer, `border-top: 1px solid var(--color-border-subtle)`). One sentence plus one link, chosen by rule:

   | Condition (each stage with a due count) | Sentence | Link |
   |---|---|---|
   | All stages ≥70% heard from | ⓘ "Based on most deployments due for a survey. 7 due surveys have no response yet." | "View 7 evidence gaps →" |
   | Any stage 50–69% | ⓘ "Based on some of the deployments due. PGL: 18 of 29. 14 due surveys have no response yet." | "View 14 evidence gaps →" |
   | Any stage <50% | ⚠ **"Read with caution:** we have heard from fewer than half of the deployments due at PGL (12 of 30)." (yellow-fg text, caution glyph) | "View 31 evidence gaps →" |
   | No gaps | ✓ "Heard from every deployment due in this window." | — |
   | Due schedule unavailable (V2) | ⓘ "Coverage can't be shown for partner-led deployments: no survey-due schedule." | — |

   Thresholds 70/50 are proposed defaults for Jeff to confirm. The sentence states coverage and never comments on whether satisfaction is good. The weighting note (§1) sits on the next line when it applies.
6. **Link**: "View responses →" (right-aligned in the footer) → Responses filtered to scope + window.

**Low-n behaviour:**

| Condition | Behaviour |
|---|---|
| Row n<5 | Satisfaction cell "n<5" (neutral pill with explanation on hover/focus). Bands cell "4 responses: too few to summarise" with no bar. Evidence, Heard from and the counts remain (they are counts, not satisfaction aggregates). Direction: "Too few responses…" |
| Scope n<5 | Headline value "n<5". Row text explains |
| Zero responses in window | Headline "No responses in this window". Rows still show Heard from (0 of N due), so the gap is the story. The qualifier is the "<50%" variant |
| NPS n<10 | "n<10" with tooltip "NPS needs at least 10 PGL responses" |
| Direction insufficient | "Too few responses to determine direction (6 · 8; 10 needed in each)" in muted text, with no glyph. This reads as a normal, expected state, not an error |

### OV-2 Customer Satisfaction risk (primary 2)

| | |
|---|---|
| **Question** | "Which customers told us something concerning, and why am I seeing each one?" |
| **Why Overview space** | It is the main reason a manager acts after a monitoring visit. Each item is a fact about a named deployment |
| **Priority** | Second. Top-right, 4 of 12 columns, same height as OV-1. The only red pills on the page |
| **T1/T2** | T1. No comment text and no respondent role. The negative-feedback trigger is a non-content flag labelled *Qualtrics analysis* (P6). Its content is only reachable at T2 in Responses/history |

**Triggers** (evaluated per response in window, rolled up to one row per deployment):

| Pill (text, always visible) | Rule | Severity group | Fact line shown |
|---|---|---|---|
| **Dissatisfied** (red) | R1: Overall ≤2 | Low verdict | "PGL · Overall Satisfaction 2 of 5 · 14 Aug 2026" |
| **Declined** (red) | R3: same deployment, later response lower by ≥1 and now ≤3 | Low verdict | "MDS 4 → PGL 2 · 2 Sep 2026" |
| **Low rating** (yellow) | R4: any approved delivery rating ≤2 while Overall ≥3 | Early warning | "MDS · Communications rated 1 · Overall 4 · 3 Jul 2026" |
| **Negative feedback** (yellow) | R6: comment sentiment negative (Qualtrics analysis) while Overall ≥4; only if P6 flag enabled | Early warning | "PGL · Overall 4 · comment flagged negative (Qualtrics analysis) · 21 Jun 2026" |

Not on Overview: R2 NPS detractor, R5 stakeholder divergence. Both remain available in Responses.

**Layout:** header "Customer Satisfaction risk" + subtitle "Workday-led · rolling 12 months". Summary line (13px): "**2** deployments with a low verdict · **1** early warning". The two counts are never summed into a total. Then a list of up to **5** rows, each 2 lines (~46px):
line 1 → [pill] **Deployment name** (link, 13px/600), right-aligned stage tag (`MDS`/`PGL`, existing `.survey-pill`);
line 2 → fact line (12px muted); "+1 more signal" when the deployment has more than one; in All scope, "· Partner-led" or "· Workday-led".
Order: low verdicts first, then early warnings; most recent first within each group. Footer: "View all 10 in Responses →" when there are more than 5, otherwise "View in Responses →".

**Empty state:** "No Customer Satisfaction risk among the 52 responses received in this window." Then (muted): "Deployments not yet heard from aren't included. See evidence gaps." This prevents silence being read as satisfaction.

**Low-n:** none. These are records, not aggregates, so suppression does not apply ([metric-semantics.md §6](../csat-product-model/metric-semantics.md)).

### OV-3 Delivery ratings (secondary)

**Label decision: "Delivery ratings"**, not "Experience dimensions". DM users read "dimension" as analyst jargon. "Delivery ratings" says exactly what the data is: customers' ratings of aspects of our delivery. It claims no causation and makes it natural to leave out the sales-cycle items, which are context and not delivery. Individual items are "ratings" ("Schedule management rating").

| | |
|---|---|
| **Question** | "Which parts of our delivery do customers rate lowest, and what is rated highest?" |
| **Information** | One band: **Lowest rated** → up to 2 items "Schedule management 3.8 (n 30)" · "Communications 4.0 (n 30)"; **Highest rated** → 1 item "Technical competence 4.6 (n 50)". Stage-specific items are tagged: "Prepared for go-live (PGL)", "Guidance (MDS)". Link "All delivery ratings →" |
| **Eligible ratings** | team understanding, collaboration, responsiveness, technical competence, guidance (MDS); methodology, schedule management, communications, value (current survey version); prepared for go-live (PGL). Excluded: sales-expectation/transition items (context) and business case (unresolved). These appear in Responses only |
| **Selection rule** | Ratings with n≥5 in scope, deployment-weighted mean. "Lowest" is shown only if it is ≥0.3 below the median eligible rating. Otherwise: "No delivery rating stands out. All are within 0.3 of each other." |
| **Why Overview space** | It points investigation to a dimension in one line. The full profile is overload ([information-hierarchy.md §5](../csat-product-model/information-hierarchy.md)) |
| **Priority** | Secondary: 8 columns under OV-1, one content line, 13px |
| **Language** | "lowest-rated", "highest-rated" only. Never "drives", "caused", "impact" |
| **Partner comparison** | None on Overview. Link "Compare by delivery leadership →" goes to the Responses rating profile split by leadership |
| **T1/T2** | T1 |
| **Low-n** | Items with n<5 are not eligible. Fewer than 3 eligible → "Too few ratings in this window to compare delivery dimensions." |

### OV-4 MDS → PGL journey (secondary)

| | |
|---|---|
| **Question** | "When the same deployment answered both surveys, did satisfaction hold?" |
| **Information** | Title "MDS → PGL journey", subtitle "Workday-led deployments with both surveys". Line: "**7** deployments: Held **5** · Higher **1** · Lower **1**" (counts link to Responses filtered to that class). Note (12px muted): "Same deployment, often different respondents." |
| **Why Overview space** | It is the only defensible longitudinal reading, and it lands on named deployments |
| **Priority** | Secondary: 4 columns under OV-2, compact |
| **Scope rule** | Always Workday-led, because partner-led deployments have no MDS. In the All scope the subtitle reads "Workday-led only: partner-led deployments have no MDS survey". In the Partner-led scope: "Not applicable: partner-led deployments are not surveyed at MDS." |
| **Low-n** | Fewer than 5 pairs: "2 deployments have both surveys: too few to summarise (5 needed)." + "View their histories →". No percentages ever |
| **T1/T2** | T1 |

### OV-5 Survey Operations status (tertiary)

| | |
|---|---|
| **Question** | "Is the collection process failing in a way that limits what I just read?" |
| **Information** | One strip: label SURVEY OPERATIONS (11px uppercase muted), then only non-zero issues, each a link: "⚠ 2 bounced invitations" · "⚠ 3 invitations expire within 7 days" · "⚠ 1 notification rule invalid" · "⚠ 4 deployments can't be scheduled (missing target dates)" · "Invitations imported 5 Oct 2026". Right: "Open Survey Operations →". All clear: "✓ No survey operation issues · Invitations imported 5 Oct 2026" |
| **Why Overview space** | Bounces and expiries explain *why* evidence may be thin. The user needs to know they exist, not to work them from here |
| **Priority** | Lowest. Page background `--color-surface-alt`, 1px top border, no card, no colour fill. Glyph + text, never a pill |
| **Scope** | Follows delivery-leadership scope where InFlight rows carry it. If not, the label reads "Survey Operations · all deployments" (validation, README V9) |
| **Not here** | Sent/opened/started/completed funnels, response rate, upcoming batches. Those are Survey Operations content |
| **T1/T2** | T1 counts only. No contact names or emails (P7) |
| **Stale data** | Responses import older than the stale threshold also appears here: "⚠ Responses not imported for 18 days". The OV-0 pill turns stale. Figures still render, because stale is not wrong |

## 5. Desktop composition — 1440 × 900

Uses the real DM shell (`.header`, `.tabs`, one `.info-banner`, `.csat-subtab-nav`). Container `max-width:1400px`, centred, 20px gutters. The 12-column grid has a 16px gap: 8 columns ≈ 921px, 4 columns ≈ 463px.

```
 x=20                                                                                         x=1420
 ┌──────────────────────────────────────────────────────────────────────────────────────────────┐ y=16
 │▐W▌ <App> Deployment Health Manager (HC-like shell)   ● Data as of Oct 6   [View as Read Only] │ header 72
 │    <app subtitle from config>                                                  [Showing: All▾]│
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
   Deployments   Portfolio   Go Lives   Trends   Reporting   [CSAT]   …                            tabs 41
 ┌▌ⓘ CSAT: what customers tell us about our delivery, how representative that is, and where to follow up.┐ banner 44
   Overview   Responses   Survey Operations                                                         subnav 37
   ══════════                                                                                       (underline)
   Delivery leadership [▉Workday-led▉│ Partner-led │ All deployments]   Window [Rolling 12 months ▾]   scope 36
   Oct 2025 – Sep 2026                          Responses imported 5 Oct 2026, 07:12 (fresh) [⟳ Refresh]
 ┌───────────────────────────────────────────────────────────────┐ ┌────────────────────────────────┐ y≈336
 │ Customer Satisfaction · Workday-led deployments            ⓘ  │ │ Customer Satisfaction risk     │
 │ Rolling 12 months · Oct 2025 – Sep 2026                       │ │ Workday-led · rolling 12 months│
 │                                                               │ │ 2 low verdicts · 1 early warning│
 │ OVERALL SATISFACTION  4.3 / 5   52 responses · 40 deployments  │ │────────────────────────────────│
 │                      ▬ Stable · 4.2 → 4.3 (24 · 28 responses)  │ │[Dissatisfied] Example Health   │
 │───────────────────────────────────────────────────────────────│ │  Network                  PGL  │
 │ SURVEY STAGE  SATISF.  SATISFIED·NEUTRAL·DISSAT.  EVIDENCE      HEARD FROM     DIRECTION  NPS│ │  Overall Satisfaction 2 of 5 · │
 │ MDS           4.4      ▇▇▇▇▇▇▇▇▇▇▇▇▇▏▏ 17·2·1    20 resp·17 dep 17 of 20 ▰▰▰▰▱ ▬ Stable   Not │ │  14 Aug 2026                   │
 │ Mid-deploym.                                                    due          4.3→4.4  asked│ │[Dissatisfied] Sample Regional  │
 │ PGL           4.2      ▇▇▇▇▇▇▇▇▇▇▇▇▇▏▏ 27·4·1    32 · 25        25 of 29 ▰▰▰▰▱ ▬ Stable  +41  │ │  Medical Center           MDS  │
 │ Post go-live                                                    due          4.2→4.2  n 31 │ │  Overall Satisfaction 2 of 5 · │
 │  ↳ Partner-led PGL REFERENCE 4.0 ▆▆▆▆▆▆▆▆▆▆▏▏ 17·4·2  23 · 19   Comparison context: observed  │ │  2 Sep 2026                    │
 │                                                                 values only                  │ │[Low rating] Example Children's │
 │ MDS and PGL rows are different deployments. For deployments with both, see MDS → PGL journey. │ │  Hospital                 MDS  │
 │───────────────────────────────────────────────────────────────│ │  Communications rated 1 ·      │
 │ ⓘ Based on most deployments due for a survey. 7 due surveys    │ │  Overall 4 · 3 Jul 2026        │
 │   have no response yet.   View 7 evidence gaps →  View responses→│ │        View in Responses →     │
 └───────────────────────────────────────────────────────────────┘ └────────────────────────────────┘ y≈656
 ┌───────────────────────────────────────────────────────────────┐ ┌────────────────────────────────┐ y≈672
 │ Delivery ratings   LOWEST  Schedule management 3.8 (n 30) ·    │ │ MDS → PGL journey              │
 │   Communications 4.0 (n 30)   HIGHEST  Technical competence    │ │ Workday-led, both surveys      │
 │   4.6 (n 50)          All delivery ratings → · Compare by leadership →│ │ 7 deployments: Held 5 · Higher 1 · Lower 1 │
 │                                                               │ │ Same deployment, often different respondents │
 └───────────────────────────────────────────────────────────────┘ └────────────────────────────────┘ y≈772
 ─────────────────────────────────────────────────────────────────────────────────────────────────── y≈788
   SURVEY OPERATIONS  ⚠ 2 bounced invitations · ⚠ 3 invitations expire within 7 days ·                 strip 40
   Invitations imported 5 Oct 2026                                         Open Survey Operations →
                                                                                                     y≈828 (<900)
```

**Vertical budget (approx.):** shell through sub-nav ≈ 280px; scope bar 44; OV-1/OV-2 row 320; gap 16; OV-3/OV-4 row 100; gap 16; OV-5 40. Everything fits above the fold at 1440×900 with ~70px to spare. The risk list caps at 5 rows so OV-2 never pushes OV-1 taller.

**Alignment:** OV-1 and OV-3 share the 8-column left edge and width. OV-2 and OV-4 share the 4-column track. Row heights match within each row (grid `align-items: stretch`). Table columns: Survey stage 120 · Satisfaction 96 · Bands 210 · Evidence 150 · Heard from 160 · Direction 110 · NPS 64 (≈ 890px inner).

**Why two columns at the top:** satisfaction and risk are the two primary questions. Side by side, the score and the "who" are read in one sweep, and the page fits above the fold at real volumes (2–3 stage rows; 0–5 risk rows). A full-width stage table with 3 rows would leave most of the width empty.

## 6. Visual language (current DM; no brand experiment)

| Element | Treatment |
|---|---|
| Cards | `.trends-section` idiom: white, 1px `--color-border`, radius 8px, padding 16px, no shadow beyond `--shadow-subtle`. No coloured top borders (that is the DM KPI-card idiom and it is deliberately not used). No card-in-card |
| Region title | 14px/600 `--color-text` (`.trends-section-title`). Subtitle 12px **`--color-text-muted`**, not `--color-text-subtle` (#94A3B8 is ~2.6:1 on white; it is used only for decorative separators) |
| Scope headline figure | 28px/700 `--color-text`. The only large number on the page, smaller than DM's 32px stat-card value |
| Stage-row mean | 16px/600 |
| Body / table cells | 13px `--color-text`; secondary facts 12px `--color-text-muted` |
| Table headers | Existing `th`: 11px uppercase, 0.6px letter-spacing, muted, bottom border only. No zebra striping. Row height ~44px (two-line stage label) |
| Band bar | 120×8px, three segments in fixed order Satisfied `--color-status-green` · Neutral `#CBD5E1` · Dissatisfied `--color-status-red`, 2px white gap between segments, 2px end radius, `aria-hidden` (counts carry the data). Scale = row n (bars are within-row proportions; equal bar length across rows). Counts always printed beside the bar in text tokens. Per-segment hover/focus tooltip "Satisfied (4–5): 17 of 20 responses" |
| Coverage meter | 5 steps × 10×6px, filled `--color-primary`, empty `--color-border`. The text "17 of 20 due" is primary and the meter is decoration (`aria-hidden`). Never green/red: coverage is not a status judgement |
| Direction | Glyph + word, `--color-text`: ▲ Improving · ▬ Stable · ▼ Declining. Declining word in `--color-status-red-fg`; Improving in `--color-status-green-fg`. Insufficient: muted text, no glyph |
| Risk pills | Existing `.status-pill` with `.status-red` (Dissatisfied, Declined) and `.status-yellow` (Low rating, Negative feedback). Text always present |
| `n<5` / `n<10` | Neutral pill: `--color-surface-alt` fill, 1px border, muted text, `tabindex=0`, `aria-describedby` explanation ("Fewer than 5 responses: the average isn't shown, to protect accuracy and anonymity") |
| Scope control | Existing `.seg-control` / `.seg-control-btn.active` (primary fill, white 600 text) |
| Links | 13px `--color-primary`, "→" suffix, underline on hover/focus |
| Banner | The existing single CSAT `.info-banner`, copy updated to one line. No second banner |
| Colour budget | Primary blue (controls, links, meter); green/red only in band bars and direction words; red/yellow pills only in OV-2; yellow-fg text only in the "<50%" evidence qualifier. No orange (reserved for Executive Watch), no indigo |
| Spacing | 16px between cards; 12px between header and content inside a card; 8px within rows. DM density |

## 7. T1 / T2

- **Overview is entirely T1.** It renders the same for T1 and T2 users. It never fetches comment content, so it has no dependency on T2.
- Per-response facts are deployment + stage + score + date only. **Respondent role is omitted on Overview.** Role + deployment + score is quasi-identifying for single-respondent deployments (P7), and Overview does not need it. Role stays in deployment history and Responses.
- The "Negative feedback" trigger is a non-content flag with *Qualtrics analysis* provenance, shown only if P6's T1 flag is enabled. Turning it off removes the trigger. The rest of the page does not change.
- No theme/topic counts and no sentiment aggregates are shown. No aggregate qualitative signal earns Overview space at current per-app comment volumes: tens of comments a year, mostly n<5 per topic.

## 8. Accessibility (design intent; not a WCAG certification)

- **Sub-navigation**: `role="tablist"`, `role="tab"`, `aria-selected`, roving tabindex with ←/→. The existing `.csat-subtab-nav` already uses tab roles; keyboard handling is added.
- **Scope control**: `role="radiogroup"` labelled "Delivery leadership", each option `role="radio"` + `aria-checked`, arrow keys move selection, Tab enters/leaves. The active option is also announced in the region titles. On change, a polite live region announces "Showing Partner-led deployments".
- **Focus**: visible 2px `--color-primary` outline, 2px offset, on every control, link, pill with explanation and band-bar segment. This replaces DM's `outline:none` pattern for these elements.
- **Status never by colour alone**: risk pills carry words; direction has glyph + word; band counts are text; the qualifier caution has a glyph + "Read with caution".
- **Tables**: real `<table>`, `<th scope="col">`, stage cell as `<th scope="row">`. The reference row has an accessible label "Partner-led PGL, reference for comparison".
- **Contrast**: essential text uses `--color-text` (#0F172A) or `--color-text-muted` (#475569, ~7.6:1 on white). Pill fg/bg pairs: red-fg on red-bg and yellow-fg on yellow-bg are both > 6:1 (computed from hex). Band colours were checked with the dataviz validator: green↔red deutan ΔE 8.1, passing with secondary encoding (fixed order, 2px gaps, text counts). Bar fill contrast is below 3:1, so text counts are mandatory.
- **Suppression states** have plain-language explanations reachable by keyboard.
- **Zoom/reflow**: at ≤1100px the 8/4 grid stacks (OV-1, OV-2, OV-3, OV-4, OV-5). Desktop-first; no mobile design in scope.

## 9. Explicitly not on Overview

| Excluded | Reason | Where it lives |
|---|---|---|
| Raw customer comments, response rows | T2 / investigation | Responses, deployment history |
| Respondent identity or role | P7; quasi-identification | Deployment history (role only) |
| Qualtrics topics, sentiment summaries/trends | Machine-derived explanation, not satisfaction | Responses feedback view (T2) |
| Full delivery-rating matrix; leadership × rating comparison grid | Overload; halo | Responses |
| Product Area chart, ranking or filter | Scope context, multi-valued, non-additive, mostly n<5 per app. It answers no monitoring question at portfolio level | Responses lens. The existing DM header product mode, where configured, is inherited and stated, not added |
| Monthly satisfaction line, sparklines | 2–7 responses/month/app | Nowhere |
| Separate PGL Satisfaction / MDS Satisfaction KPIs | ~95% identical to Overall on their own stage | Response detail (mismatch flag) |
| % satisfied / % favourable | P1 settled on the mean; at n 7–30 a % overstates precision | Band counts serve the purpose |
| Generic "Needs attention" count | Three different problems | Kept separate (§2) |
| Response rate, sent/opened funnel, upcoming batches | Process | Survey Operations |
| EM / partner segmentation or ranking | P8 | Responses lens |
| NPS detractor and stakeholder-divergence signals | Secondary or investigative | Responses |
| Owner, status, follow-up workflow | P9 | Future |
| AI Insights or placeholder | Not a dependency | Future slot in Responses/history |
| Workday-vs-partner leaderboard, deltas or "gap" figures | Implies a contest and causation | Juxtaposed observed values only |
| Any language about people-management or organisational-performance consequences of CSAT | Out of product scope. Copy describes delivery only | Nowhere |
| Today's `coveragePct` | Wrong denominator | Retired |

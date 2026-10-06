# Information hierarchy and composition

## 1. Three levels, four regions

| Level | Question | Region(s) | Visual signature |
|---|---|---|---|
| **1 Executive message** | What do I need to know? | **R1 Message** | The only large figure (32px) and the only 20px sentence. Full width. Prose, no list |
| **2 Management attention** | Which deployments need follow-up, preparation or chasing? | **R2 Customer concerns** · **R3 Survey horizon** | Two equal-height cards side by side. Named deployments, one or two lines each. Status pills with words |
| **3 Supporting evidence** | Why are we saying that? | **R4 Learning and evidence** (+ collapsed *Breakdown and method*) | One quiet row of four labelled facts at 13px. The disclosure holds the detail |

That is four content regions, down from V2's six (scope bar, satisfaction, risk, delivery ratings, journey, survey-operations strip). The scope bar, banner and survey-operations strip no longer exist as regions.

Hard rules (from the architecture, applied visually):

1. R1 never contains a list or a deployment name.
2. Every count in R2/R3 has its named deployments behind it. Up to 4 are visible; the rest are one link away.
3. R4 never introduces a new kind of attention. It explains.
4. Nothing on Overview is an action control. Every link goes to the place where the action happens, or where it is explained.
5. Concern, follow-up, preparation, chase and evidence gaps never share a pill, a count or a heading.

## 2. Lifecycle made perceptible

Each region carries a small **eyebrow** (11px/600 uppercase, muted, 0.6px letter-spacing) naming its lifecycle stages:

| Region | Eyebrow | Title |
|---|---|---|
| R1 | *(none: it summarises all stages)* | – |
| R2 | RESPOND · FOLLOW UP | Customer concerns |
| R3 | PREPARE · SURVEY | Survey horizon |
| R4 | LEARN | What customers are telling us |

Read together, the eyebrows spell the lifecycle **Prepare → Survey → Respond → Follow up → Learn** without a diagram. Inside R3, the order runs top to bottom: next round (prepare) → following round → in flight (survey). R2's rows show the response and its follow-up together. R4 is where the cycle ends: what was learned.

R2 sits to the **left** of R3 on purpose, even though the lifecycle starts with Prepare. Customer outcomes lead the approved weighting, and the left column is read first. The eyebrows keep the lifecycle legible anyway.

## 3. Eye path (intended)

| # | Fixation | Time | What the reader gets | Why here |
|---|---|---|---|---|
| 1 | R1 anchor figure "85%" | 0–1 s | The programme measure | Largest, darkest mark on the page; top-left of the content |
| 2 | R1 sentence A | 1–3 s | The verdict in words: strong / mixed / concerning + direction | Same row as the figure, 20px/600: the eye continues right |
| 3 | R1 sentence C (two bold counts) | 3–5 s | How many deployments have concerns; the next deadline | The 600-weight counts are the only bold words in the 14px text |
| 4 | R2 first rows | 5–15 s | *Which* deployments, how recent, whether follow-up is expected | Left column, directly below the concern count that sent the reader there |
| 5 | R3 next-round block | 15–25 s | Round date, prepare-by, how many, which have readiness issues | Right column, same height. The prepare-by line is the only dated status line |
| 6 | R3 in-flight line | 25–30 s | What is open; what needs chasing | Bottom of R3, deliberately subordinate |
| 7 | R4 facts | 30 s + | Lowest delivery rating, NPS, partner-led context, evidence base | Bottom row, 13px, lowest contrast of the content regions |
| 8 | Drill-down | on intent | Surveys, Responses, deployment history | Every count and name is a link |

The order follows the approved weighting (outcomes lead, attention second, horizon as context) and each role's depth. Leadership often stops at 3. A DS/DD continues to 4. An EM typically reads 3 → 5 → 6, so the right column is built to be scanned on its own.

## 4. Desktop composition: 1440 × 900

Real DM shell: `.header`, `.tabs`, `.csat-subtab-nav`. **No `.info-banner` on Overview** (its definition moves to the method note). Container `max-width:1400px`, content x = 44…1396 (1352px). A 12-column grid with 16px gaps gives a 98px column. R2 spans 7 columns (782px) and R3 spans 5 (554px).

```
 x=44                                                                                                   x=1396
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐ y=24
 │▐W▌ Healthcare Deployment Health Manager                                ● Data as of Oct 9, 2026  Showing: All│ header (unchanged)
 │    Healthcare program portfolio                                                                         │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────┘ y=102
   Deployments   Go Lives   Reporting   Portfolio Health   [CSAT]   Notable Deployments   Manage Overrides     tabs (unchanged)
 ──────────────────────────────────────────────────────────────────────────────────────────────────────────  y=174
   Overview   Surveys   Responses                                       Workday-led · Rolling 12 months ▾       sub-nav + scope menu
   ════════                                                                                                    y=190–228
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐ y=244
 │                    │                                                                                    │
 │      85%           │  Workday-led customer satisfaction is strong and stable.                           │ A 20/600
 │   rated 4 or 5     │  44 of 52 responses rated their deployment 4 or 5 · 40 deployments ·               │ B 14/400
 │   (Top-2 Box)      │  Oct 2025 – Sep 2026                                                               │
 │                    │  **2 deployments** raised customer concerns in the last 90 days, 1 with follow-up  │ C 14/400
 │                    │  expected. Next survey round 4 Nov: **9 deployments** to prepare by 21 Oct.        │   counts 600 + link
 │                    │                                                                                    │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────┘ y=396  R1 (152)
 ┌──────────────────────────────────────────────────────────────┐ ┌──────────────────────────────────────────┐ y=412
 │ RESPOND · FOLLOW UP                                          │ │ PREPARE · SURVEY                         │ eyebrow 11
 │ Customer concerns                       Last 90 days         │ │ Survey horizon                           │ title 14/600
 │──────────────────────────────────────────────────────────────│ │──────────────────────────────────────────│
 │ [Detractor] Example Health Network                     PGL   │ │ Next round · Wed 4 Nov                   │ 13/600
 │   Satisfaction 2 · NPS 4 · 14 Sep · Follow-up expected:      │ │ 9 deployments · 6 MDS · 3 PGL            │ 13
 │   Deployment Sponsor · in Qualtrics                          │ │ Prepare by Wed 21 Oct · 12 days          │ 13/600
 │──────────────────────────────────────────────────────────────│ │ 2 with readiness issues:                 │ 12 muted
 │ [Detractor] Sample Regional Medical Center             MDS   │ │   Example Children's Hospital   MDS      │ 13 link + tag
 │   Satisfaction 3 · 5 Aug · Follow-up status in Qualtrics     │ │   No Executive Sponsor contact           │ 12 muted
 │                                                              │ │   Sample University Health      PGL      │
 │                                                              │ │   No customer contact with email         │
 │                                                              │ │ Following round · Wed 2 Dec · 7 deploym. │ 12 muted
 │                                                              │ │──────────────────────────────────────────│
 │                                                              │ │ In flight · October round · closes 28 Oct│ 13/600
 │──────────────────────────────────────────────────────────────│ │ 11 surveys · 3 responded · 8 not yet     │ 13
 │ Follow-up expected on 5 responses from the last 30 days      │ │ 1 to chase: all invitations bounced →    │ 13 link
 │ (4 MDS acknowledgements, 1 Detractor) · tracked in Qualtrics │ │                                          │
 │                           View all concerns in Responses →   │ │                  Open Surveys →          │ links 13
 └──────────────────────────────────────────────────────────────┘ └──────────────────────────────────────────┘ y=716  row (304)
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐ y=732
 │ LEARN  What customers are telling us                                                                    │
 │ LOWEST DELIVERY RATING      │ RECOMMENDATION (PGL NPS) │ PARTNER-LED PGL, FOR CONTEXT │ EVIDENCE           │ labels 11 caps
 │ Schedule management: 71%    │ +41 · 31 responses       │ 74% rated 4 or 5 ·           │ 7 deployments with │ 13
 │ rated 4 or 5 (MDS, 21)      │                          │ 23 responses                 │ Detractor responses│
 │                             │                          │                              │ in 12 months · 4   │
 │                             │                          │                              │ closed unanswered →│
 │ ▸ Breakdown and method                                                                                  │ disclosure 13
 └────────────────────────────────────────────────────────────────────────────────────────────────────────┘ y≈846  R4 (~114)
                                                                                                             ~54px spare
```

**Vertical budget:** shell + sub-nav 228 · gap 16 · R1 152 · gap 16 · R2/R3 304 · gap 16 · R4 ≈114. Bottom ≈ 846, so everything fits above the 900px fold. Removing the banner and scope bar returns ≈ 110px compared with V2.

**Overflow rules (same layout in every state):** R2 shows ≤ 4 rows and then "+k more in the last 90 days →". R3 shows ≤ 3 named readiness issues and then "+k more →". R2 and R3 share a row height (grid `align-items: stretch`). Extra space is left empty, never filled. Long deployment names truncate with an ellipsis at one line, with the full name in `title` and the accessible name.

**Alignment:** R1 and R4 span all 12 columns. The R1 divider sits at x ≈ 44 + 192, and the R4 facts use four equal tracks. The R2/R3 boundary falls at the 7/5 column line. All card padding is 16px (R1: 20px vertical). Text baselines inside R2 rows and R3 lists are 20px apart.

## 5. Typography roles

| Role | Spec | Used for |
|---|---|---|
| Anchor figure | 32px/700, `--color-text`, tabular numerals | R1 only (DM stat-card size) |
| Message headline | 20px/600, `--color-text` | R1 sentence A only (matches DM header title weight) |
| Message body | 14px/400 `--color-text`; counts 14px/600 as links (`--color-primary`) | R1 B, C |
| Region title | 14px/600 (`.trends-section-title`) | R2, R3, R4 |
| Eyebrow / fact label | 11px/600 uppercase, `--color-text-muted`, 0.6px tracking | Region eyebrows, R4 labels |
| Item primary | 13px/600; deployment names as links | R2 rows, R3 names, R3 block heads |
| Item secondary | 12px/400 `--color-text-muted` (never `--color-text-subtle`) | Fact lines |
| Body | 13px/400 | R3 counts, R4 facts, footers |

Three sizes do the hierarchy (32 → 20 → 14). Everything else is 13/12/11, which is DM density.

## 6. Surfaces and colour

| Element | Treatment |
|---|---|
| R1 | `.trends-section` card: white, 1px `--color-border`, radius 8, `--shadow-subtle`. A 1px vertical divider separates the anchor. No tint, no coloured border, no icon |
| R2, R3, R4 | Same card idiom. R4 has no shadow, so it sits slightly lower in the visual stack |
| Row separators | 1px `--color-border-subtle` between R2 rows and between R3 blocks |
| Status pills | `.status-pill`, text always present. **Detractor** pill colour follows the guidebook display band of the response's satisfaction: 1–2 → `.status-red`, 3 or an NPS-only Detractor → `.status-yellow` (GB-46). These are the only coloured fills on the page |
| Survey tags | Existing `.survey-pill` (MDS / PGL), neutral |
| Deadline emphasis | Prepare-by ≤ 7 days with issues: ⚠ glyph + `--color-status-yellow-fg` text "Prepare by Wed 21 Oct · 2 days". Glyph and words, never colour alone |
| Links | `--color-primary`, 13–14px, "→" suffix on navigational links, underline on hover/focus |
| Not used | Green status pills (freshness moves to the header badge), bars, meters, sparklines, donut charts, orange, indigo, banners |

## 7. Controls (quiet by design)

| Control | Where | Form |
|---|---|---|
| **Scope menu** | Right end of the CSAT sub-nav row, baseline-aligned with the tabs | A text button, 13px `--color-text-muted`: "Workday-led · Rolling 12 months ▾". It opens a small menu with **Delivery leadership** (radio: Workday-led *default* · Partner-led · All deployments) and **Window** (Rolling 12 months *default* · Previous 12 months · fiscal years when history allows). When an inherited DM scope is active, it reads "My deployments · Workday-led · Rolling 12 months ▾" |
| Scope echo | R1 sentence A ("Workday-led customer satisfaction…") and the window range in sentence B | Scope is stated **once** in the message, not in every region subtitle |
| Freshness | Existing header "Data as of" badge. Import times live in the disclosure. A stale import adds a ⚠ clause to R1 B (executive-message §5) | No pill on the page |
| Refresh / import | Removed from Overview → Surveys › Survey settings (ADMIN) | – |
| Disclosure | Native `<details>/<summary>` "Breakdown and method", collapsed by default | Not a drawer or modal |

## 8. Lists vs prose

| Content | Form | Reason |
|---|---|---|
| Executive message | Prose | One sentence says what four tiles would only imply |
| Concerns, readiness issues | Lists of named deployments | People act on deployments, not on counts |
| Horizon and in-flight counts | One-line prose with "·" separators | Counts are context; a table would invite comparison |
| Learning facts | Labelled definition pairs | Four unrelated facts that each need a label, and no table |
| Breakdown | The one compact table (inside the disclosure) | Per-survey comparison is genuinely tabular |

## 9. T1 / T2

- **Overview is entirely T1** and renders identically for T1 and T2 users. It never requests comment content.
- R2 rows show deployment, survey, date, satisfaction value, NPS value, alert class and follow-up expectation with its **owner role** ("Deployment Sponsor"). **No respondent role, name or identity**, so a single-respondent deployment is not identifiable by role + score (P7).
- R3 readiness issues name the *missing contact role* ("No Executive Sponsor contact"). No contact names or emails.
- No themes, sentiment, topic counts, Product Areas or comment-derived flags (P6 refined).
- Deployment names are DM master data, shown in V2 and in the rest of DM.

## 10. Accessibility (design intent; not a WCAG certification)

- **Landmarks and headings:** `<main>` per page. R1 is a `<section>` with a visually hidden `<h2>` "Customer satisfaction summary". R2–R4 use `<h2>` titles with their eyebrows as preceding text in the same heading group. Sentence A is a `<p>` with `aria-describedby` pointing to sentence B.
- **Hierarchy without colour:** size and weight carry Level 1 → 3. Pills carry words. The deadline uses glyph + words. Direction uses words, never arrows alone.
- **Sub-nav:** `role="tablist"`, `role="tab"`, `aria-selected`, roving tabindex with ←/→.
- **Scope menu:** a `<button aria-haspopup="true" aria-expanded>`. The menu uses `role="radiogroup"` groups with arrow keys and Esc to close, and focus returns to the button. A polite live region announces "Showing Partner-led deployments" on change.
- **Focus:** visible 2px `--color-primary` outline with a 2px offset on every link, tab, button and `<summary>`. No `outline:none`.
- **Links:** accessible names are complete: "2 deployments raised customer concerns, view list". Never "click here" or a bare "→".
- **Suppressed / insufficient states** are plain sentences in the flow, not tooltips. "n<10" in R4 is spelled out: "Not shown: fewer than 10 PGL responses (8)".
- **Contrast:** essential text uses `--color-text` or `--color-text-muted` (#475569, ~7.6:1 on white). Pill fg/bg pairs as in V2 (> 6:1).
- **Reflow:** at ≤ 1100px R2 and R3 stack (R2 first) and the R4 facts wrap 2×2. Desktop-first.
- **Reading order** equals visual order: R1 → R2 → R3 → R4 → disclosure.

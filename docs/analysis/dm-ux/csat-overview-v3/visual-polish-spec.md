# CSAT Overview V3: visual polish and art direction (2026-10-06)

Status: **specification only.** Nothing in the prototype, production DepMngr, fixtures or EDM was changed by this document. The next step is implementation by Composer on the isolated V3 prototype ([§11](#11-composer-handoff)).

Governing direction (Jeff, on the V3 Healthy prototype): *"This is the right level of information. From here I think it's just CSS refining to make it more attractive."*

So this is refinement of one approved screen. It is not a redesign, a concept, or a set of alternatives.

**Inputs used:** the attached V3 Healthy screenshot; production `libraries/DepMngr/src/CoreUI_Css.js` (tokens L35–80, header L104–177, tabs L186–212, `.stat-card` L452, `.status-badge` L1259, `.ph-card` L2158, `.survey-pill` L2671, `.status-pill` L3379, `.csat-subtab-*` L3438, `.overview-card` L3555, `.trends-section` L3667) and `CoreUI_Markup.js` header (L240–256); the V3 prototype (`skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/`: CSS, renderer, fixture, self-test); [information-hierarchy.md](information-hierarchy.md), [state-model.md](state-model.md), [../csat-reconciled-architecture/](../csat-reconciled-architecture/README.md), [../current-design-system.md](../current-design-system.md).

**Measurement stance:** screenshot geometry below was read from the attached image (about ±2px; the image is 1:1 with CSS pixels). The page was **not** re-rendered for this document. Geometry targets in §4 and §12 are estimates that Composer must measure and record.

---

## 0. What is frozen

| Frozen | Exactly |
|---|---|
| Sub-navigation | Overview · Surveys · Responses (Overview selected) |
| Region sequence | R1 Executive message → R2 Customer concerns ‖ R3 Survey horizon → R4 Learn (+ collapsed *Breakdown and method*) |
| Composition | R1 full width · R2/R3 side by side at **7 : 5** · R4 full width · same positions in all eight states |
| R1 content | Top-2 Box figure + caption · interpretation sentence (A) · evidence sentence (B: responses, deployments, period) · implication sentence (C: concerns + upcoming survey) |
| R2 content | Detractor label · deployment name · MDS/PGL · satisfaction/NPS/date · follow-up expectation with owner role · Qualtrics boundary · 90-day qualifier · follow-up footer · link to Responses |
| R3 content | Next round · MDS/PGL counts · prepare-by date and countdown · readiness issues · following round · can't-forecast context · In flight summary · chase/bounce context · link to Surveys |
| R4 content | Lowest delivery rating · PGL NPS · partner-led (or Workday-led) PGL context · evidence context · *Breakdown and method* disclosure |
| Words | Every visible word in the fixture. §11 adds a **word-sequence self-test** that fails if any visible word is added, removed, reordered or reworded |
| Visual language | Current Deployment Manager only. No Ballpoint palette, no Archivo, no new Workday brand treatment, no new font families |

---

## 1. Screenshot diagnosis

Classification: **KEEP** = working, leave it alone · **POLISH** = right idea, execution can be sharper · **VISUAL_DEFECT** = an execution fault (geometry, inconsistency or accessibility), not a matter of taste.

| # | Area | Observation | Class |
|---|---|---|---|
| D1 | Eye path | It runs 85% → headline → bold counts → R2 → R3 → R4, as designed. The amount of information is right | KEEP |
| D2 | Shell | Header card, primary tabs and the CSAT tab underline exactly match production | KEEP |
| D3 | Sub-nav | The active "Overview" underline floats about 8px **above** the row's rule: `.csat-v3-subnav-row` has `padding-bottom: 8px` and a separate border, and the rule is `--color-border-subtle` rather than production's `--color-border`. The selected tab is visually detached from its baseline | VISUAL_DEFECT |
| D4 | Nav → content | The CSAT sub-nav sits about 40px below the primary tab rule (production `.tabs` 24px + V3 `margin-top` 16px) but only ~19px above R1. The child nav looks closer to the content than to its parent | POLISH |
| D5 | Vertical rhythm | Card-to-card gaps are about **33px vertically** (R1→row, row→R4) but **16px horizontally** (R2↔R3). Cause: production `.trends-section { margin-bottom: 16px }` stacks on the V3 flex `gap: 16px`. The page reads as loosely stacked boxes, not a composed grid | VISUAL_DEFECT |
| D6 | Fold | The middle row is ~451px tall (y 421–872), so at 1440×900 R4 starts at y≈905 and is entirely below the fold. The earlier V3 budget (R4 ending ≈846) is not met | VISUAL_DEFECT |
| D7 | R1 metric | 85% is centred in a fixed 192px column with a vertical divider. That makes it a separate KPI tile beside a paragraph. Two lines, not one statement | POLISH |
| D8 | R1 divider | The vertical divider is only as tall as the figure and caption (~60px), while the copy runs ~90px. It ends mid-message | VISUAL_DEFECT |
| D9 | R1 copy | Sentences B (evidence) and C (implication) share one style (14px, `--color-text`). The evidence does not read as the figure's qualifier, and the paragraph runs ~935px wide | POLISH |
| D10 | R1 left edge | The copy starts at x≈243 and the figure is centred at x≈110. Neither lines up with anything in R2, R3 or R4 | POLISH |
| D11 | Region titles | "Customer concerns" / "Survey horizon" (14/600) are almost the same weight as deployment names (13/600) and R3 block heads (13/600). The cards have no clear top | VISUAL_DEFECT |
| D12 | Eyebrows | Useful lifecycle cues. Their 8px gap to the title, plus the head rule, makes them float as a separate technical line | POLISH |
| D13 | R2 rows | Correct content, but line 1 mixes a 24px pill, a 13px name and a 10px tag. Line 2 packs evidence and the follow-up expectation into one run-on line. Names do not form a scannable column | POLISH |
| D14 | Detractor pill | `.status-pill` padding 4/10 makes it ~24px tall, taller than the line it labels | POLISH |
| D15 | Survey tag | MDS/PGL use `.survey-pill` with no variant class, so they render as bare **10px** text with no fill or border: an unstyled fragment below DM's readable minimum | VISUAL_DEFECT |
| D16 | Links on hover | `.csat-v3-link:hover` draws the 2px focus outline as well as an underline (the boxed "Example Children's Hospital" in the screenshot). Hover should not look like keyboard focus | VISUAL_DEFECT |
| D17 | Footer links | R2's "View all concerns in Responses →" sits mid-card, left-aligned (y≈679). R3's "Open Surveys →" is pinned bottom-right (y≈847). Same role, different position | VISUAL_DEFECT |
| D18 | R2 empty space | About 180px of empty card below the two concern rows | KEEP (empty space is allowed; fixed by pinning the footer, not by adding content) |
| D19 | R3 temporal hierarchy | "Next round · Wed 4 Nov", "Prepare by Wed 21 Oct · 12 days", "Following round · Wed 2 Dec" and "In flight · … closes 28 Oct" are all 13/600 prose. The dates are not on a common line, Next round does not outrank Following or In flight, and the eye has to read every line to find the deadline | POLISH |
| D20 | Readiness issues | They are rendered as normal muted text, the same as any metadata. A preparation gap gets no warning treatment at all | POLISH |
| D21 | In Flight | Same type as Next round, so it does not read as subordinate | POLISH |
| D22 | R4 | Four uppercase labels under an uppercase eyebrow, unemphasised 13px text, and no column structure: it reads like a report footer | POLISH |
| D23 | R4 evidence link | The link is a **bare "→"** (`inert_link("→")`): a ~10px hit target whose accessible name is "right arrow". This contradicts the V3 accessibility intent ("never a bare →") | VISUAL_DEFECT |
| D24 | Disclosure | "Breakdown and method" is in link blue, so it competes with drill-downs | POLISH |
| D25 | Scope control | Quiet, text-only, right-aligned. The right weight | KEEP (small alignment polish only) |
| D26 | Freshness | Only in the header. No duplicate in CSAT | KEEP |
| D27 | Header freshness badge | It stretches to the full header height (a tall green oval), because `.header` is `align-items: stretch` and the badge is a direct child. **Production markup and CSS are identical** (`CoreUI_Markup.js` L248, `CoreUI_Css.js` L104/L173), so this probably exists in production too (not browser-verified there) | Shell finding, **out of scope**. The prototype must keep mirroring production. Recorded in §13 |
| D28 | Card surfaces | White cards on the `#F8FAFC` page, 1px border, 8px radius. Right idea. The radius is smaller than DM's main card family (`.stat-card`, `.ph-card` and `.overview-card` all use `--radius-lg` 12px), and R4 drops the shadow, which reads as inconsistent rather than intentional | POLISH |

**Summary:** the content and order are right. The polish problems are execution: doubled gaps, a floating tab indicator, title hierarchy, an isolated metric, unstructured rows, an untreated warning, a footer-like Learn region, and three small accessibility faults (hover outline, bare-arrow link, unstyled 10px tag).

---

## 2. Overall art direction

**One sentence:** *Same page, tightened into one grid. The executive message becomes a single statement, every card shares one inner structure, and severity is carried by form (fill vs rule vs text), not by more colour.*

Five moves:

1. **One rhythm.** 16px between all cards in both directions, one card padding, one radius, one divider colour.
2. **One inner grid.** Every card uses the same two tracks: an **88px marker track** (the figure in R1, the Detractor pill in R2, time labels in R3) and a content track. The R1 headline and R2 deployment names start on the same vertical line.
3. **Hierarchy by size, then weight, then colour.** 32 → 20 → 15 → 14 → 13 → 12 → 11. Colour is used only for links (blue) and semantics (red/amber).
4. **Three severity forms that never mix:** a *filled pill* is the customer's voice (Detractor). An *amber rule with amber text* is our preparation gap. *Plain text* is everything else.
5. **Quiet supporting layer.** Labels in muted sentence case, uppercase only for lifecycle eyebrows, and disclosure in muted rather than link blue.

Explicitly not used: gradients, illustrations, photography, decorative icons, charts, sparklines, meters, animation, glass/blur, glow, filled tiles, coloured card backgrounds, radius above 12px on cards, new font families, extra shadow levels.

---

## 3. Design system (prototype-scoped)

### 3.1 Tokens

All values reuse production tokens from `CoreUI_Css.js` `:root`. The prototype adds **scoped aliases** on `#csat-overview-v3-app` so the values are named once. There is one new raw value, the 88px gutter.

| Token | Value | Production source | Why |
|---|---|---|---|
| `--csat-v3-gap` | `var(--space-4)` = 16px | `--space-4` | Card↔card in both axes |
| `--csat-v3-pad-y` | `var(--space-4)` = 16px | `.trends-section` padding | Card vertical padding (R2–R4) |
| `--csat-v3-pad-x` | `var(--space-5)` = 24px | `.header-body` padding 16/24 | Card horizontal padding, all four cards, so every content edge aligns |
| `--csat-v3-r1-pad-y` | `var(--space-5)` = 24px | `--space-5` | R1 breathes slightly more |
| `--csat-v3-radius` | `var(--radius-lg)` = 12px | `.stat-card`, `.ph-card`, `.overview-card` | DM's main card radius; the header keeps 16 |
| `--csat-v3-shadow` | `var(--shadow-subtle)` | `--shadow-subtle` | Same on all four cards; the header keeps `--shadow-card` |
| `--csat-v3-rule` | `var(--color-border)` #E5E7EB | `--color-border` | Card edges, sub-nav rule, R4 column separators |
| `--csat-v3-divider` | `var(--color-border-subtle)` #F1F5F9 | row borders in `.csat-table` | Horizontal dividers inside cards |
| `--csat-v3-warn-rule` | `var(--color-status-yellow)` #F59E0B | `--color-status-yellow` | Preparation-warning rule |
| `--csat-v3-warn-text` | `var(--color-status-yellow-fg)` #92400E | `--color-status-yellow-fg` | Preparation-warning text |
| `--csat-v3-gutter` | **88px** (new) | — | The marker track. Fits the widest markers: "100%" at 32/700 ≈ 74px, the "Detractor" pill ≈ 68px, "Prepare by" ≈ 62px. Multiple of 4 |
| `--csat-v3-gutter-gap` | `var(--space-3)` = 12px | `--space-3` | Marker → content |
| `--csat-v3-max` | 1400px (unchanged) | `.container`, `.header` | Content max width 1352px inside 24px padding |

Do **not** introduce new colours, shadows or radii. Do **not** reference the undefined production tokens (`--radius-2`, `--color-surface-1`, `--color-brand`…). Use the defined ones above.

### 3.2 Typography (current DM system stack, 14px base)

Seven sizes, three weights (400 / 600 / 700, with 700 for the figure only). The 14px size is shared with production navigation.

| Role | Size / line height | Weight | Colour | Notes |
|---|---|---|---|---|
| Primary tabs, CSAT sub-nav | 14/21 (production) | 500→600 / 600 | muted → primary | Unchanged production |
| Scope control | 13/20 | 400 | `--color-text-muted` | Caret 10px |
| **Executive metric** | **32/32** | 700 | `--color-text` | `tabular-nums`, letter-spacing −0.01em. Never coloured |
| Metric caption | 12/16 | 400 | muted | Wraps to 2 lines inside the gutter |
| **Executive interpretation** (A) | **20/28** | 600 | `--color-text` | Matches the header title |
| Executive evidence (B) | 13/20 | 400 | muted | Qualifies the figure |
| Executive implication (C) | 14/22 | 400 | `--color-text` | Count links 600 |
| **Region title** | **15/22** | 600 | `--color-text` | `.overview-card-title` precedent (0.9375rem) |
| Lifecycle eyebrow | 11/16 | 600, uppercase, 0.06em | muted | The only uppercase text besides survey acronyms |
| Region qualifier ("Last 90 days") | 12/16 | 400 | muted | Right of the title, baseline-aligned |
| **Primary item**: R2 deployment name; R3 Next-round values | 14/20 | 600 | primary (link) / text | |
| Secondary item: R3 issue names; Following and In flight values | 13/20 | 600 | primary (link) / text | |
| Primary row fact | 13/20 | 400 | `--color-text` | R2 evidence line, R3 counts, R4 fact text |
| Metadata | 12/18 | 400 | muted | R2 follow-up line, card footer notes. (R3 secondary-block lines stay 13px, muted: §4 D-3) |
| Time label (R3 rail), fact label (R4) | 12/20 (rail), 12/16 (fact) | 600 | muted | Sentence case |
| Tag (MDS / PGL) | 11/16 | 600, 0.04em | muted | Text tag, not a pill |
| Pill text | 11/18 | 600 | semantic fg | Sentence case ("Detractor") |
| Primary drill-down link | 13/20 | 600 | primary | With → |
| Inline drill-down link | 13/20 | 400 | primary | With → |
| Disclosure summary | 13/20 | 400 | muted | Native marker |

Minimum text size on the page: **11px**, and only for eyebrows, tags and pills, all at 600 weight. `--color-text-subtle` (#94A3B8, 2.6:1) is **never** used for text.

### 3.3 Spacing and vertical rhythm

All spacing is on a 4px grid and uses production `--space-*` tokens.

| Relationship | Value | Change from screenshot |
|---|---|---|
| Primary tab rule → CSAT sub-nav | 24px (production `.tabs` margin) | V3 extra `margin-top` removed (−16) |
| Sub-nav rule → R1 | 16px | ≈ same |
| Card ↔ card, vertical and horizontal | 16px | 33 → 16 vertical |
| Card padding | 16 × 24 (R1: 24 × 24) | x 16 → 24 |
| Eyebrow → title | 2px | 8 → 2 (one heading unit) |
| Title → first content | 12px | Head rule removed |
| R2 row ↔ row | 12px padding above and below + 1px divider | 8 → 12 |
| R2 line 1 → line 2 → line 3 | 2px row gap | — |
| R1 headline → B → C | 4px → 8px | 8 / 8 → 4 / 8 |
| R3 rail row ↔ row (inside a block) | 4px | — |
| R3 block ↔ block | 8px + 1px divider + 8px | 12+8 → 8+8 |
| R4 label → text | 4px | — |
| R4 column inner padding | 24px either side of the separator | — |
| Content → pinned card footer | `margin-top: auto`, min 12px | R2 not pinned → pinned |
| Footer note → footer link | 4px | — |

### 3.4 Grid and alignment

- **Outer grid:** content 1352px at ≥ 1448px viewport. R1 and R4 span the full width. The middle row is `minmax(0, 7fr) minmax(0, 5fr)` with a 16px gap (R2 ≈ 782, R3 ≈ 554; unchanged ratio, as approved).
- **Alignment lines that matter:**
  1. **Content edge** (card x + 24): the R1 figure, eyebrows and titles, R2 Detractor pills, R3 time labels and the R4 first column all start here. In R1, R2 and R4 that is the same x.
  2. **Name line** (content edge + 100 = 88 + 12): the R1 headline/B/C and the R2 deployment names, facts and follow-up lines. The executive statement and the named deployments read down one vertical. In R3 the same offset carries the time values.
  3. **Card bottoms:** the R2 and R3 footer links share a baseline (both pinned).
- R4 columns are four equal tracks. They are deliberately **not** forced onto the 7/5 line: four unequal columns would look fussy.

### 3.5 Cards and surfaces

```
background: var(--color-surface);
border: 1px solid var(--csat-v3-rule);
border-radius: var(--csat-v3-radius);      /* 12 */
box-shadow: var(--csat-v3-shadow);         /* subtle; identical on R1–R4 */
margin: 0;                                  /* kill .trends-section margin-bottom */
```

- R4 gets the **same** shadow as the others. Level 3 is carried by typography, not by a missing shadow.
- Internal dividers are horizontal `--csat-v3-divider` only. The **one** exception is R4's vertical column separators (`--csat-v3-rule`), because #F1F5F9 is invisible as a vertical hairline.
- The R2/R3 head rule (under the title) is removed. The heading group stands on spacing alone.
- No tinted backgrounds, accent top bars (`.stat-card::before`), coloured borders, or nested cards.

### 3.6 Colour hierarchy

| Colour | Used for | Never for |
|---|---|---|
| `--color-text` #0F172A | Figure, headline, titles, row facts, time values | — |
| `--color-text-muted` #475569 (7.6:1) | Eyebrows, labels, captions, evidence B, metadata, scope control, disclosure, tags | — |
| `--color-primary` #0F4C81 | Links and active navigation **only** | Numbers, titles, decoration |
| Red pair (`-red-bg` / `-red-fg`) | Detractor pill, satisfaction 1–2 (GB-46) | Anything else |
| Yellow pair (`-yellow-bg` / `-yellow-fg`) | Detractor pill, satisfaction 3 or NPS-only (GB-46) | — |
| Amber rule + `-yellow-fg` text, no fill | Preparation warnings only (§3.8) | Customer concerns |
| Green | Header freshness badge (production) only | The CSAT body. Not for "good" numbers like 85% or +41, and not for "No readiness issues found" |
| Orange / indigo / info-blue | Not used | — |

Neutral text is the default. Every good-news sentence ("No readiness issues found", "Nothing to chase.", "No Detractor responses…") is plain muted or plain text, not green.

### 3.7 Status and pill system

| Concept | Form | Spec |
|---|---|---|
| **CUSTOMER_CONCERN**: Detractor | **Filled pill**, at most one per row, R2 only | `.status-pill` scoped: `padding: 1px 8px; border-radius: var(--radius-pill); font: 600 11px/18px; letter-spacing: .01em; white-space: nowrap` → 20px tall. `.status-red` / `.status-yellow` colours unchanged |
| Survey type (MDS / PGL) | **Text tag**, no fill or border | Scoped `.survey-pill` override: `margin:0; padding:0; background:none; border:0; font: 600 11px/16px; letter-spacing:.04em; color: muted` |
| Row qualifier ("Declined from MDS 5") | Plain metadata | 12/16 muted, after the survey tag |
| **PREPARATION_WARNING** | **Amber rule + amber text**, no fill (§3.8) | R3 only |
| Deadline ≤ 7 days with issues | ⚠ glyph + words in `-yellow-fg` | Glyph `aria-hidden`; the words carry the meaning |
| Healthy / neutral | Plain text | No pill, no green |

Rules: no element on Overview other than the Detractor label is a pill. Pills never appear in R1, R3 or R4. Red vs yellow Detractor differs by colour **and** by the satisfaction value printed on line 2, so meaning survives without colour.

### 3.8 Preparation-warning treatment (distinct from customer concern)

| | CUSTOMER_CONCERN | PREPARATION_WARNING |
|---|---|---|
| Meaning | The customer told us something bad | We are missing something before launch |
| Form | Filled pill at the row's left edge | 2px amber rule on the left of a group, no fill |
| Text colour | Pill fg only; the row text stays neutral | The reason phrase is in `-yellow-fg` #92400E (7.1:1) |
| Weight | 600 label inside a fill | 400 text |
| Glyph | None | ⚠ only on a time-critical prepare-by (≤ 7 days with issues) |
| Where | R2 | R3 |

Group spec: `.csat-v3-prep-warning { border-left: 2px solid var(--csat-v3-warn-rule); padding-left: 10px; margin: 4px 0; }`. Inside it: the lead line ("2 with readiness issues:") at 13/20 `--color-text`, then a `<ul>` of issues, one line each: **name** (13/600 link) · tag (MDS) · **reason** (12/18 `--csat-v3-warn-text`). The reason wraps under the name when narrow. "3 deployments can't be forecast: missing dates →" gets its own warning group in the Following-round block, with the link text kept in primary.

Which lines are warnings is decided by renderer rules, so the fixture is not touched: `issue: true` lines; string lines containing "readiness issue" that do **not** start with "No "; and lines containing "can't be forecast". The amber rule is supplementary (non-text contrast 2.1:1); the words always state the problem.

### 3.9 Link system

| Class | Examples | Style | Arrow | Underline |
|---|---|---|---|---|
| **ENTITY** | Deployment names (R2, R3) | 14/600 (R2), 13/600 (R3), primary | No | Hover/focus only |
| **PROSE_LINK** | R1 C counts ("2 deployments", "9 deployments") | 14/600 primary | No | **Persistent** soft underline: `text-decoration: underline; text-decoration-color: rgba(15,76,129,.35); text-underline-offset: 3px`, full colour on hover. Primary vs text contrast is ≈2.0:1, so links inside prose need a non-colour cue |
| **INLINE_DRILLDOWN** | "+1 more…→", "can't be forecast…→", "1 to chase…→", R2 empty-state links, R4 evidence clause | 13/400 primary | Yes | Hover/focus only |
| **PRIMARY_DRILLDOWN** | "View all concerns in Responses →", "Open Surveys →" | 13/600 primary, pinned card footer, **left-aligned** | Yes | Hover/focus only |
| **SECONDARY_DISCLOSURE** | "Breakdown and method" | 13/400 **muted**, native ▸ marker → `--color-text` + underline on hover | No | Hover/focus only |

Rules:
- The arrow means "takes you to another place" (Surveys, Responses, a filtered list). Entity and prose links have none.
- Wrap every "→" in `<span aria-hidden="true">`. The accessible name is the words.
- `:hover` = underline only. `:focus-visible` = 2px primary outline, 2px offset, 2px radius. **Remove the outline from `:hover`** (D16).
- Standalone links get `padding-block: 2px` for a ≥ 24px hit height.

---

## 4. Annotated region specification

Implementation class per row: **CSS** = CSS_ONLY · **MARKUP** = PRESENTATIONAL_MARKUP (same words, different elements or spans).

### A — Header and navigation

| ID | Keep | Problem | Refinement | Class |
|---|---|---|---|---|
| A1 | Production header card, W strip, title, freshness badge, "Showing" | D27 stretched badge mirrors production | **No change in the prototype.** Recorded in §13 | — |
| A2 | Production primary tabs | — | None | — |
| A3 | Overview · Surveys · Responses, production `.csat-subtab-btn` | D3 floating underline | `.csat-v3-subnav-row { padding-bottom:0; margin:0 0 16px; border-bottom:1px solid var(--csat-v3-rule); align-items:center }`. The nav aligns to the bottom (`align-self:flex-end`), and buttons keep production `margin-bottom:-1px`, so the 2px indicator sits **on** the rule | CSS |
| A4 | — | D4 sub-nav too far from the primary tabs | Remove V3 `margin-top` (the production `.tabs` 24px remains) | CSS |
| A5 | Quiet text scope control, right end of the sub-nav row | Baseline drift; caret read aloud | 13/20 muted, `padding: 4px 8px`, `border-radius: var(--radius-md)`, transparent. Hover: `--color-text` on `--color-surface-alt`. Focus ring. Vertically centred on the tab labels. The caret becomes `<span class="csat-v3-caret" aria-hidden="true">▾</span>` at 10px, 4px left margin. No border; not the bordered `.dd-dropdown-trigger`; no segmented control | CSS + MARKUP (caret span) |
| A6 | Freshness in the header only | — | No CSAT freshness element. A stale-import ⚠ clause stays in R1 B (existing rule) | — |

### B — Executive message (R1)

| ID | Keep | Problem | Refinement | Class |
|---|---|---|---|---|
| B1 | Figure + caption + A + B + C, in that DOM order | D7 isolated KPI; D8 short divider | **Lockup:** `.csat-v3-r1-inner { grid-template-columns: var(--csat-v3-gutter) minmax(0,1fr); column-gap: var(--csat-v3-gutter-gap); align-items: baseline }`. Remove the divider (`border-right:0; padding-right:0`). The figure's baseline aligns with the headline's first baseline, so "85%  Workday-led customer satisfaction is strong and stable." reads as one statement | CSS |
| B2 | 32/700 figure | Centred in its own column | `text-align:left`, 32/32, tabular, −0.01em. The caption is 12/16 muted, left, 6px below, and wraps naturally to "rated 4 or 5 / (Top-2 Box)" inside 88px (`max-width:none; margin-inline:0`) | CSS |
| B3 | Headline A 20/600 | — | 20/28, `margin: 0 0 4px` | CSS |
| B4 | Evidence B | D9 same as C | `#csat-v3-msg-b`: 13/20 **muted**, `margin: 0 0 8px`. It reads as the figure's footnote. Use the existing `id` (stable; it is referenced by `aria-describedby`) | CSS |
| B5 | Implication C with 600 count links | — | 14/22 `--color-text`, margin 0. Count links are PROSE_LINK (persistent soft underline) | CSS |
| B6 | — | D9 line length ~935px; D10 left edge | `.csat-v3-r1-copy { max-width: 960px }`. The copy starts on the **name line** (§3.4). Healthy B and C stay on one line each at 1352px | CSS |
| B7 | — | — | Padding 24 × 24. Estimated height ≈ 130px (Healthy) | CSS |

### C — Customer concerns (R2)

| ID | Keep | Problem | Refinement | Class |
|---|---|---|---|---|
| C1 | Eyebrow "Respond · Follow up", title, "Last 90 days" | D11, D12 | Eyebrow 11/16, 2px above the title. Title 15/22. Qualifier 12/16 muted, baseline-aligned right. Head rule removed; 12px to the first row | CSS |
| C2 | Row content | D13 no row structure | Row = grid `var(--csat-v3-gutter) minmax(0,1fr) auto auto`, `column-gap: 12px`, `row-gap: 2px`, `padding: 12px 0`. Divider `border-top: 1px solid var(--csat-v3-divider)` on `row + row` only. `.csat-v3-concern-line1 { display: contents }`, so the pill (col 1), name (col 2), survey tag (col 3) and row tag (col 4) all sit on grid row 1. **DOM order = visual order**, so the PGL tag comes before "Declined from MDS 5" | CSS |
| C3 | — | Evidence and follow-up in one run-on line | Split `.csat-v3-concern-detail` into two lines spanning `2 / -1`: **facts** ("Satisfaction 2 · NPS 4 · 14 Sep", 13/20 text) and **follow-up** ("Follow-up expected: Deployment Sponsor · in Qualtrics" or "Follow-up status in Qualtrics", 12/18 muted). The split is at the first " · Follow-up". Partner rows have no follow-up, so they render one line. Words unchanged | MARKUP |
| C4 | Pill | D14 | §3.7 pill spec, `justify-self:start; align-self:center` | CSS |
| C5 | Name link | — | ENTITY 14/20 600. One-line ellipsis (`min-width:0` on the track), full name in `title` | CSS |
| C6 | MDS/PGL | D15 | §3.7 text tag, right-aligned in col 3 | CSS |
| C7 | Footer note + "View all concerns in Responses →" | D17 | Wrap them in `<div class="csat-v3-region-foot">`: `margin-top:auto; padding-top:12px`, note 12/18 muted, 4px, link PRIMARY_DRILLDOWN left-aligned. It pins to the card bottom, level with R3's footer | MARKUP + CSS |
| C8 | "+k more in the last 90 days →" | — | INLINE_DRILLDOWN directly after the rows, 8px top margin, aligned to the **name line** (`padding-left: calc(var(--csat-v3-gutter) + var(--csat-v3-gutter-gap))`) | CSS |
| C9 | Empty state (Low evidence, No actions) | — | Primary sentence 13/20 text, aligned to the content edge. Following inline drill-downs 13/400 primary, 4px apart. No icon, no illustration, no tinted box | CSS |
| C10 | Card | — | `min-height` stays at 304px as the floor; the row stretches to R3. Empty space between rows and footer is intentional | CSS |

Resulting row:

```
[Detractor]  Example Health Network ······························  PGL
             Satisfaction 2 · NPS 4 · 14 Sep                              ← 13 text
             Follow-up expected: Deployment Sponsor · in Qualtrics        ← 12 muted
 └ 88 gutter ┘└ name line
```

### D — Survey horizon (R3)

| ID | Keep | Problem | Refinement | Class |
|---|---|---|---|---|
| D-1 | Eyebrow "Prepare · Survey", title | D11, D12 | As C1 (no qualifier) | CSS |
| D-2 | Block order: Next round → Following round → In flight | D19 no temporal axis | **Time rail.** Each block is a grid `var(--csat-v3-gutter) minmax(0,1fr)`, `column-gap:12px`, `row-gap:4px`, `align-items: baseline`. Left: **time label** (12/20 600 muted). Right: **value**, then that row's lines. The renderer splits the block head at its first " · " into label and value ("Next round" / "Wed 4 Nov"; "In flight" / "October round · closes 28 Oct"; a head without " · ", e.g. "In flight", has an empty value so its first line moves up). A line starting with "Prepare by " becomes its own rail row (label "Prepare by", value "Wed 21 Oct · 12 days"), and the lines after it belong to that row. Lines that don't match (e.g. "Prepare-by date passed · launches…") stay plain lines in the current row | MARKUP + CSS |
| D-3 | — | Next round not dominant | The **first block** is the primary block: values 14/20 600 `--color-text`, lines 13/20 text. Following and In flight values 13/20 600, lines 13/20 **muted** | CSS |
| D-4 | Prepare-by with emphasis/warning | — | Value 14/600 text. With the fixture `warning: true`: ⚠ (`aria-hidden`) + `--csat-v3-warn-text`. The plain-string and `emphasis` prepare-by variants in the fixture render identically, which normalises an existing fixture inconsistency without touching it | MARKUP + CSS |
| D-5 | Readiness issues | D20 | PREPARATION_WARNING group (§3.8): lead line + `<ul>` of issues | MARKUP + CSS |
| D-6 | "No readiness issues found (dates and contacts present)." | — | Plain 13 muted. No rule, no green | CSS |
| D-7 | Can't-forecast link | — | Its own warning group inside the Following block (§3.8) | MARKUP + CSS |
| D-8 | In Flight | D21 | Secondary block (D-3). "1 to chase: all invitations bounced →" is INLINE_DRILLDOWN in primary, not amber: chasing is a different kind of attention from preparation. "Nothing to chase." is 13 muted | CSS |
| D-9 | Block separators | — | `block + block { border-top:1px solid var(--csat-v3-divider); margin-top:8px; padding-top:8px }`. Remove the old per-block margin and padding | CSS |
| D-10 | "Open Surveys →" | D17 | PRIMARY_DRILLDOWN, pinned bottom, **left-aligned** (`text-align:left`) | CSS |

Resulting block:

```
Next round       Wed 4 Nov                                   ← 12/600 muted | 14/600 text
                 9 deployments · 6 MDS · 3 PGL               ← 13 text
Prepare by       Wed 21 Oct · 12 days                        ← 14/600 (⚠ + amber when ≤7 days with issues)
                 ┃ 2 with readiness issues:                  ← amber rule, 13 text
                 ┃ Example Children's Hospital  MDS  No Executive Sponsor contact   ← 13/600 link · tag · 12 amber
                 ┃ Sample University Health     PGL  No customer contact with email
─────────────────────────────────────────────
Following        Wed 2 Dec                                   ← 13/600
round            7 deployments                               ← 13 muted
                 ┃ 3 deployments can't be forecast: missing dates →
─────────────────────────────────────────────
In flight        October round · closes 28 Oct               ← 13/600
                 11 surveys · 3 responded · 8 without a response yet   ← 13 muted
                 1 to chase: all invitations bounced →       ← 13 link
Open Surveys →                                               ← pinned, left
```

"Following round" wraps to two lines inside the 88px gutter beside a value of three or more lines. That is intended and costs no height.

Estimated Healthy R3 height ≈ 410px (from ≈451): tighter separators, a 2px eyebrow gap, no head rule. The estimate must be measured (§12).

### E — Learn (R4)

| ID | Keep | Problem | Refinement | Class |
|---|---|---|---|---|
| E1 | Eyebrow "Learn", title "What customers are telling us" | — | As C1 | CSS |
| E2 | Four observations | D22 footer feel | **Learning strip:** `.csat-v3-learn-grid { grid-template-columns: repeat(4, minmax(0,1fr)); gap:0; margin-top:12px }`. Each `.csat-v3-learn-fact`: `padding: 0 24px; border-left: 1px solid var(--csat-v3-rule)`. First: `padding-left:0; border-left:0`; last: `padding-right:0`. Separators run the full row height. The first column starts on the content edge | CSS |
| E3 | Labels | Second uppercase tier | `.csat-v3-fact-label`: 12/16 600 muted, **sentence case** (`text-transform:none; letter-spacing:0`), 4px below. Labels share the top line | CSS |
| E4 | Fact text | Nothing stands out | 13/20 `--color-text`. **One key value per observation** in `<strong class="csat-v3-fact-key">` (600, same size). The renderer wraps the first match of `^(?:[^:]+: )?([+\-−]?\d+(?:\.\d+)?%?(?: of \d+)?)`, so "Schedule management: **71%** rated…", "**+41** · 31 responses", "**74%** rated 4 or 5…", "**7** deployments with…", "**4 of 6** rated…". Suppression sentences ("Too few…", "Not shown: fewer than…") match nothing and stay plain | MARKUP + CSS |
| E5 | Evidence drill-down | D23 bare "→" | Link the **final clause** "4 surveys closed without a response →" (text after the last " · "), INLINE_DRILLDOWN, arrow `aria-hidden` | MARKUP |
| E6 | Disclosure | D24 | `.csat-v3-disclosure { margin-top:16px; padding-top:12px; border-top:1px solid var(--csat-v3-divider) }`. Summary SECONDARY_DISCLOSURE (§3.9), `width: fit-content`, native marker, collapsed. The table inside keeps its 12px style but uses `--csat-v3-divider` cell borders | CSS |
| E7 | Card | D28 shadow missing | Same card as R1–R3 | CSS |

---

## 5. Before → after (intended perception)

| Region | Before | After |
|---|---|---|
| Page | Loose boxes with 33px vertical and 16px horizontal gaps; R4 entirely below the fold | One grid with 16px everywhere; two shared vertical lines; R1–R3 inside the fold and R4's heading starting above it |
| Sub-nav | The selected tab floats above a faint line | The selected tab sits on DM's rule, like the primary tabs above it |
| R1 | "85%" is a KPI tile; a paragraph beside it | "85% — Workday-led customer satisfaction is strong and stable." is one statement. The evidence is a quiet footnote, and the implication with its two linked counts leads down into the cards |
| R2 | A pill, a name and fragments of text | A column of names you can scan; each name has its reason directly below it and the follow-up expectation as quieter context |
| R3 | A stack of similar 13/600 lines | A time rail: the eye runs down *Next round → Prepare by → Following → In flight*, reads the two primary dates first, then sees the amber-ruled exceptions |
| Warnings | Readiness issues look like metadata | Amber-ruled preparation gaps; visibly a different kind of thing from a Detractor pill |
| In Flight | As loud as Next round | Muted context at the bottom of the rail |
| R4 | A report footer with four uppercase labels | A deliberate four-column learning strip: sentence-case labels, one bold value each, quiet separators, method tucked beneath |
| Links | Blue everywhere, boxed on hover, footers in two positions | Five link roles with one rule each; drill-downs pinned at card bottoms, left-aligned |

---

## 6. Eight-state resilience

The same CSS works in every state. No state-specific class except the existing `--count` anchor and the fixture's `warning` flag.

| State | Stress | How the system handles it |
|---|---|---|
| 1 Healthy | Baseline | As specified |
| 2 Concerns | 4 rows + "+1 more", a decline tag, longer facts | R2 becomes the tallest card (~4 × 86px rows); R3 stretches and its footer stays pinned. The decline tag sits after PGL in col 4. Overflow stays capped at 4 rows |
| 3 Heavy upcoming | ⚠ prepare-by in 2 days; 5 readiness issues | ⚠ + amber on the prepare-by value; warning group. Named lists cap at 3 + "+k more →" (existing rule). *Fixture renders a summary string only (§13)* |
| 4 Chase | Prepare-by passed; chase line | "Prepare-by date passed…" does not match the "Prepare by " rule, so it renders as a muted line under Next round. The chase link stays primary |
| 5 Weak evidence | Count anchor "8"; long A and B; R2 empty; suppressed R4 | "8" + "responses" fit the gutter. B wraps to two muted lines inside 960px. R2 empty state per C9. R4: no key value is emphasised in suppressed facts; the strip still reads as four columns |
| 6 SLG-like | Small counts; mostly suppressed R4 | "No readiness issues found" is plain muted. Variable R3 height is absorbed by the pinned footer |
| 7 Partner-led | Rows with no follow-up line; long footer | Rows render two lines. The footer note wraps at 12/18 above any link |
| 8 No actions | R2 empty; no issues | Empty state + footer. No amber anywhere on the page. That is the visual definition of "no immediate actions" |

General tolerance rules:
- **More rows:** cap at 4 (R2) and 3 named issues (R3), then "+k more →". Never scroll inside a card.
- **Fewer rows:** the card keeps its height (stretch / 304px floor). Space stays empty; footers stay pinned.
- **Long names:** one-line ellipsis with the full name in `title` and the accessible name.
- **Long sentences:** wrap within the content track. Never truncate prose.
- **Insufficient evidence:** plain sentences in the same slots. No placeholder dashes, greyed tiles or "N/A".

---

## 7. Responsive desktop behaviour

| Viewport | Behaviour |
|---|---|
| ≥ 1448px (wide) | Container stays at 1400px max (production), centred. Nothing stretches. R1 copy is capped at 960px |
| 1440 × 900 (primary acceptance) | As specified. Target: R1–R3 fully above the fold; R4 heading begins above it |
| ~1280 (content ≈ 1232) | Same layout. R3 ≈ 508px, value track ≈ 360px: readiness reasons wrap under the issue name (flex-wrap), R4 columns ≈ 260px with facts up to three lines. No breakpoint needed |
| ≤ 1000px | R2/R3 stack (R2 first). R4 becomes 2 × 2: columns 1 and 3 lose the left border and padding, and rows get a 16px gap. Use **1000px**, an existing DM breakpoint, instead of V3's 1100px, to avoid more breakpoint sprawl. The R1 lockup holds (the gutter still fits) |
| Mobile | Not designed (desktop operational app) |

---

## 8. Accessibility refinements (design intent; not a WCAG certification)

- **Contrast:** text uses only `--color-text` (≈17:1) and `--color-text-muted` (≈7.6:1) on white; amber text #92400E ≈7.1:1. Pill fg/bg pairs as production (> 6:1). No `--color-text-subtle` text.
- **Not colour alone:** "Detractor" is a word, and its band shows in the printed satisfaction value. Warnings state the missing item in words. ⚠ is `aria-hidden` and always paired with words. The amber rule is supplementary.
- **Links:** prose links carry a persistent underline (primary vs text ≈2.0:1). Standalone links are set apart by position and arrow. Accessible names are the words, never "→" (fixes D23). Arrow glyphs are `aria-hidden`.
- **Focus:** `:focus-visible` 2px primary outline, 2px offset, on every link, tab, button and `<summary>`. **Hover never draws an outline** (fixes D16). No `outline:none`.
- **Hit areas:** standalone links `padding-block: 2px` (≥ 24px). The scope button is ≥ 28px tall.
- **Structure:** readiness issues become a real `<ul>`. Rail labels are text in DOM order before their values, so reading order equals visual order. R2 `display: contents` keeps DOM order (survey tag before row tag).
- **Motion:** no transitions or animations are added. The existing `prefers-reduced-motion` block stays.
- **Minimum size:** 11px only for 600-weight eyebrows, tags and pills.

---

## 9. Prohibited (refinement, not embellishment)

Gradients · illustrations · photography · decorative or extra icons (⚠ is the only glyph, and only for time-critical preparation) · charts, bars, meters, sparklines, donuts · animation and motion · glass/blur · glow · coloured or tinted card backgrounds · accent top bars · card radius > 12px · heavier shadows · new font families · new colours · new KPI tiles · any new metric, sentence or label · removing any fixture content · moving regions.

---

## 10. Change classification summary

| Class | Items |
|---|---|
| **CSS_ONLY** | A3, A4, A5 (style), B1–B7, C1, C2, C4–C6, C8–C10, D-1, D-3, D-6, D-8–D-10, E1–E3, E6, E7; all of §3 tokens, cards, rhythm, links, focus, responsive |
| **PRESENTATIONAL_MARKUP** (same words) | A5 caret span · C3 facts/follow-up split · C7 footer wrapper · D-2 time-rail label/value split · D-4 prepare-by row · D-5/D-7 warning group + `<ul>` · E4 key-value `<strong>` · E5 evidence link scope · arrow `aria-hidden` spans |
| **CONTENT_CHANGE** | **None proposed.** Fixture gaps noted in §13 need Jeff's decision and a separate task |
| **ARCHITECTURE_CHANGE** | **None** |

Separator note: the rail and the R2 split replace a " · " with a line or column break. That changes only punctuation at the split point, never words. The word-sequence test (§11) ignores "·".

---

## 11. Composer handoff

**Task:** *Apply V3 visual polish to the isolated prototype only.*

**May modify:**
- `skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/src/csat-overview-v3.css`
- `skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/csat_overview_v3_render.py`: the PRESENTATIONAL_MARKUP items in §10 only
- `skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/preview_csat_overview_v3_selftest.py`, plus a new `fixtures/csat-overview-v3-visible-words.json` baseline
- `docs/analysis/dm-ux/csat-overview-v3/`: visual-review notes and README status

**Must not modify:** `fixtures/csat-overview-v3-states.json` (no wording, values, keys or flags), production `libraries/DepMngr/**`, any `solutions/**`, other prototypes, `scripts/preview_engine.py`, EDM, workbooks. No CLASP, no deploy, no CoreLib release.

**Order of work:**
1. **Before any edit**, build the eight pages and write the word-sequence baseline: for each page, the visible text (existing `_visible_text_html`), with "·" and "→" removed, split on whitespace. Commit it as `fixtures/csat-overview-v3-visible-words.json`.
2. Add scoped tokens (§3.1) on `#csat-overview-v3-app`. Scope every production override under `#csat-overview-v3-app` (`.trends-section`, `.trends-section-title`, `.status-pill`, `.survey-pill`), never globally.
3. Rhythm and surfaces: gaps, margins, padding, radius, shadow, sub-nav rule (A3, A4, §3.3–3.5).
4. R1 lockup (B1–B7).
5. R2 row grid, pill and tag, footer pin (C1–C10).
6. R3 time rail and warning groups (D-1–D-10).
7. R4 strip, key values, evidence link, disclosure (E1–E7).
8. Links and focus (§3.9, §8). Breakpoint to 1000px (§7).
9. Self-test additions (below), then `python …/preview_csat_overview_v3_selftest.py` → PASS. Then `.\preview.ps1 CSAT_OVERVIEW_V3` → validate PASS.
10. If headless Chrome is available, capture all eight states at 1440×900 and Healthy at 1280×800. Record measured geometry against §12 in `docs/analysis/dm-ux/csat-overview-v3/visual-polish-review.md`. Report honestly what was not captured.

**Self-test additions:**
- **Word-sequence invariant:** each page's visible word sequence equals the committed baseline (fails on any added, removed, reordered or reworded word).
- At most one `.status-pill` per `.csat-v3-concern-row`; zero `.status-pill` in R1, R3 and R4.
- No R4 link whose visible text is only "→"; every "→" is inside `aria-hidden="true"`.
- `.csat-v3-prep-warning` present in Healthy R3 and absent from the No-actions page.
- R2 and R3 each have exactly one pinned footer element when a footer link exists.
- Existing checks stay green (region order, one anchor figure, one headline, no tables/lists in R1, disclosure closed, banned words, partner follow-up rule).

**Starter CSS skeleton** (values are normative; selectors may be adjusted):

```css
#csat-overview-v3-app {
  --csat-v3-gap: var(--space-4);
  --csat-v3-pad-y: var(--space-4);
  --csat-v3-pad-x: var(--space-5);
  --csat-v3-r1-pad-y: var(--space-5);
  --csat-v3-radius: var(--radius-lg);
  --csat-v3-shadow: var(--shadow-subtle);
  --csat-v3-rule: var(--color-border);
  --csat-v3-divider: var(--color-border-subtle);
  --csat-v3-warn-rule: var(--color-status-yellow);
  --csat-v3-warn-text: var(--color-status-yellow-fg);
  --csat-v3-gutter: 88px;
  --csat-v3-gutter-gap: var(--space-3);
}
#csat-overview-v3-app .csat-v3-layout { gap: var(--csat-v3-gap); }
#csat-overview-v3-app .csat-v3-layout .trends-section {
  margin: 0;
  background: var(--color-surface);
  border: 1px solid var(--csat-v3-rule);
  border-radius: var(--csat-v3-radius);
  box-shadow: var(--csat-v3-shadow);
  padding: var(--csat-v3-pad-y) var(--csat-v3-pad-x);
}
#csat-overview-v3-app .csat-v3-layout .csat-v3-r1 { padding: var(--csat-v3-r1-pad-y) var(--csat-v3-pad-x); } /* must out-rank the rule above */
#csat-overview-v3-app .csat-v3-mid-row {
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  gap: var(--csat-v3-gap);
}
#csat-overview-v3-app .trends-section-title { font-size: 15px; line-height: 22px; }
#csat-overview-v3-app .csat-v3-eyebrow { line-height: 16px; letter-spacing: .06em; margin: 0 0 2px; }
#csat-overview-v3-app .csat-v3-link:hover { text-decoration: underline; outline: none; }
#csat-overview-v3-app :is(a, button, summary):focus-visible {
  outline: 2px solid var(--color-primary); outline-offset: 2px; border-radius: 2px;
}
```

---

## 12. Visual acceptance criteria

Jeff judges 1–10. Composer measures M1–M8 and records the numbers.

1. **The executive message reads as one coherent statement:** figure and interpretation are one lockup on a shared baseline, with no divider; evidence reads as its footnote.
2. **Customer concerns scan deployment → reason → context:** names form one vertical column; line 2 is the customer's rating; line 3 is the follow-up expectation.
3. **Survey Horizon makes next round and prepare-by timing obvious:** the two primary dates are the strongest text in R3 and sit on one value line under a time rail.
4. **Preparation warnings do not look like Detractors:** amber rule and text with no fill, vs a filled pill. No pill appears in R3.
5. **In Flight is clearly subordinate to Upcoming:** smaller values, muted lines, last in the rail.
6. **Learn looks intentionally designed, not like a report footer:** four aligned columns with separators, sentence-case labels, one key value each, disclosure quiet beneath.
7. **Scope controls remain quiet:** a 13px muted text button, no border, no segmented control.
8. **The page is more polished without being less dense:** the same words (word-sequence test PASS), no larger type except titles (+1px), less total height.
9. **The same visual system works across all eight states** without state-specific styling (see the §13 fixture caveat).
10. **It still unmistakably feels like Deployment Manager:** production header, tabs, tokens, pills, radius family and type stack; nothing new.

Measured checks:

| # | Check | Target |
|---|---|---|
| M1 | Card ↔ card gaps (R1→row, row→R4, R2↔R3) | All 16px (±1) |
| M2 | Healthy 1440×900: bottom of R2/R3 | ≤ 900px (estimate ≈ 805–810) |
| M3 | Healthy 1440×900: R4 title visible | Top of R4 ≤ ~850px |
| M4 | Active sub-nav indicator | Overlaps the row rule (0px gap) |
| M5 | R1 headline x = R2 deployment-name x | Equal (±1) |
| M6 | R2 and R3 footer link baselines (Healthy) | Equal (±1) |
| M7 | Smallest rendered font size | 11px (eyebrow, tag, pill only) |
| M8 | Hover on any link | Underline only; no outline |

---

## 13. Open observations (recorded, not acted on)

| # | Observation | Class | Owner |
|---|---|---|---|
| O1 | Header freshness badge stretches to the full header height. Production markup/CSS match the prototype, so it is likely live too (not browser-verified in production). A probable fix would be `align-self:center` on `.freshness-badge` | Production shell finding; out of scope; would be a CoreLib CSS change | Whole-app review |
| O2 | **Fixture fidelity limits the eight-state test.** Concerns, Heavy upcoming, Chase, Weak evidence and Partner render readiness issues as summary strings ("1 readiness issue (named)", "5 with readiness issues: 3 named, then +2 more →", "2 still show readiness issues (named)"), so the named-issue list geometry is exercised only by Healthy. "View all concerns in Responses →" exists only in Healthy. The Concerns In-flight head lacks "closes 28 Oct" that [state-model.md](state-model.md) specifies | CONTENT_CHANGE (fixture), needs Jeff's OK; best done as a small fixture-fidelity task before final eight-state approval | Jeff |
| O3 | In the Chase state the round closing in 6 days has no time-critical mark in R3 (R1 C carries it). Applying the prepare-by ⚠ treatment to a round closing ≤ 7 days with chase items would mirror V3-D7 | Product rule; not adopted here | Jeff |

---

*Production mutations by this document: none.*

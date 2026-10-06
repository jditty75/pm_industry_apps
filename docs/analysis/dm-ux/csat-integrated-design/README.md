# CSAT integrated UX design — Responses · Deployment CSAT History · one subsystem (2026-10-06)

**Status: product-approved architecture, completing the CSAT visual/interaction design end-to-end.** This folder closes the remaining CSAT design in one pass and supersedes prior *visual-design* specs for integrated implementation. Prior docs are preserved as **decision history** — this folder does not restate the architecture, it designs the two unbuilt surfaces (Responses, Deployment CSAT History), defines the shared component system, and gives final harmonization guidance for the two frozen surfaces (Overview, Surveys).

Read with (not instead of): the approved architecture in [`../csat-reconciled-architecture/`](../csat-reconciled-architecture/README.md), the canonical data in [`../../csat-subsystem/`](../../csat-subsystem/README.md), the frozen [`../csat-overview-v3/`](../csat-overview-v3/README.md) and [`../csat-surveys-design/`](../csat-surveys-design/README.md). The buildable spec is [`composer-handoff.md`](composer-handoff.md).

## What is frozen (do not reopen)

- **Navigation:** `Overview · Surveys · Responses` (+ Survey settings/ADMIN). No fourth CSAT section. Deployment CSAT History is **not** a tab — it is a shared deployment-context surface reached by drill-down.
- **Overview V3** information architecture — four regions `R1 → (R2 ‖ R3) → R4` — content level and hierarchy frozen; this pass adds only visual/component harmonization.
- **Surveys** lifecycle worklist — one lifecycle-ordered surface (Prepare → Survey → Respond · Close · Follow up), compact two-line rows, no internal tabs; workflow frozen, this pass improves only horizontal utilization.
- **Measurement:** Top-2 Box DSAT (4–5); mean is detail only; NPS 0–10 PGL-only, shown at n ≥ 10; Detractor = DSAT ≤ 3 **or** NPS ≤ 6; follow-up shown as *expectation* (Workday-led only), never "overdue/completed"; aggregate cells suppressed at n < 5. No new thresholds.
- **Provenance never merges:** *Customer comment* (CUSTOMER_SOURCE) · *Qualtrics analysis* (QUALTRICS_DERIVED) · *AI-generated* (reserved, absent in V1). Respondent identity is never shown (role only).
- **Attention is never summed:** Customer concern · Prepare now · Chase now · Follow-up expected · Evidence gap.

---

## 1. Responses — the investigation workspace

Responses answers one question with two faces: *what did customers tell us, what can we learn, and which deployments/responses explain it?* It is a single surface that serves both portfolio-analytical investigation and historical evidence browsing — **not** two products (no separate "Analytics" page) and **not** a second executive dashboard. The user never lands on a 57-column table and never lands on a wall of KPIs. They land on a **chooser → list → evidence** progression.

### 1.1 Information hierarchy (four altitudes, top to bottom)

| Altitude | Region | Purpose | Content |
|---|---|---|---|
| L0 | **Scope bar** | Set the lens | Scope menu (Workday-led · window) — same idiom as Overview/Surveys. `PRIMARY_FILTER` chips inline; `ADVANCED_FILTER` behind a disclosure. |
| L1 | **Learning strip** (`data-csat-region="RESP_LEARN"`) | *Help me choose what to investigate* — the smallest useful analytical layer | ≤5 facts, each a filter-link (see 1.3). Not a KPI grid. |
| L2 | **Lens switch + result list** (`RESP_LIST`) | *Which deployments/responses carry the signal* | Default grain **deployment × survey**; group-by toggle; row anatomy in 1.4. |
| L3 | **Evidence** (`RESP_EVIDENCE`) | *What exactly did this customer say* | T2 customer comments + Qualtrics analysis, revealed by **inline row expansion** (1.6). Deeper deployment story routes to Deployment CSAT History. |

L1 is deliberately thin so the page stays an investigation workspace. Delivery Ratings and Product Area are **not** in L1 (they are non-additive/descriptive and would become a KPI wall); they live as **lenses** on the list (1.7–1.8).

### 1.2 Program measurement (reuse, do not re-derive)

Responses reconciles portfolio learning with individual evidence by showing the **programme figure** and the **response evidence** in the same scope/window, and letting the user cross from one to the other in one step. Two kinds of figure, never confused (approved J2): the **programme measure** (Top-2 Box DSAT, response-weighted, with *x of n · d deployments*; NPS PGL-only n ≥ 10) and **deployment state counts** (each deployment counts once, e.g. "4 deployments with a Detractor response"). Raw 1–5 stays meaningful at the response and deployment level via the verdict band (Satisfied 4–5 / Neutral 3 / Dissatisfied 1–2); a 3 is *Neutral* in a distribution but makes a response a *Detractor* for follow-up — Responses shows both facts without contradiction.

### 1.3 The learning strip — summaries that earn space

Exactly these, left to right, each a link that filters the list below; nothing else competes for L1:

1. **Deployment Satisfaction (Top-2 Box)** — `82% · 21 of 26 · 19 deployments`. The anchor, identical semantics to Overview R1.
2. **Verdict distribution** — compact band `Satisfied 18 · Neutral 5 · Dissatisfied 3` (raw 1–5). Doubles as the Detractor entry point.
3. **NPS (PGL)** — `+41 · 31 responses`, or honest `NPS — low n (6)` below n = 10.
4. **MDS vs PGL** — two mini Top-2 Box facts, juxtaposed (different questions, never pooled).
5. **Delivery leadership** — Workday-led (primary) vs Partner-led (muted reference), Top-2 Box each; no delta, no ranking.

At low volume (1.11) facts 3–5 collapse to a single honest line; the list and deployment evidence carry the page instead.

### 1.4 Result list — grain and row anatomy

**Default grain: deployment × survey** (one row per deployment's MDS or PGL). The deployment-centric principle decides the default; individual responses stay one expansion away. A `Group by` control offers **Deployment** (default, collapses a deployment's MDS+PGL under its name) · **Survey** (deployment × survey, the default rows) · **Response** (every `response_id`, for dense-evidence investigation). Several respondents on one survey keep **separate verdicts, never averaged**; the row shows the survey's verdict as "worst-wins for attention" (Detractor if any respondent is a Detractor) with a `2 responses` count that expands to each.

Row answers at a glance, in a fixed column grid (shared `csat-row`, see component system):

`[attention marker] · [deployment name →] · [MDS|PGL tag] · [customer verdict] · [key rating/context] · [evidence availability] · [survey date]`

- **Customer verdict** — verdict band chip (Detractor pill only when the band is Dissatisfied or NPS ≤ 6; colour by GB-46: DSAT 1–2 red, DSAT 3 / NPS-only amber). One filled pill per row maximum.
- **Key rating/context** — one honest fact: the survey's lowest delivery dimension *or* NPS (PGL) *or* MDS→PGL decline tag ("Declined from MDS 5"). Never a matrix in the row.
- **Evidence availability** — a quiet marker when customer comments exist (T2) and/or Qualtrics analysis exists; distinct glyphs, never merged.
- **Follow-up expectation** — facet on the line (Workday-led only): "Follow-up expected · in Qualtrics". Never overdue/closed.
- **Survey date** — right column, tabular, one dated emphasis per row.

Designed for realistic volume (HC ≈ low hundreds; SLG ≈ dozens), not BI scale: overflow caps + "+k more →", no infinite scroll inside a card, attention-first sort.

### 1.5 Filtering / segmentation — PRIMARY vs ADVANCED

**`PRIMARY_FILTER`** (always visible as chips): period/window · survey type (MDS · PGL) · delivery leadership (Workday-led · Partner-led · All) · satisfaction/Detractor state.

**`ADVANCED_FILTER`** (behind a "More filters" disclosure, never all on screen at once): Product Area (+ Product Area group) · Delivery Rating dimension · deployment/account search · qualitative signal (sentiment band / parent topic) · services approach · deployment stage-at-response · sub-region / industry scope. Every active filter shows as a removable chip; the learning-strip links set these same chips so analysis and filtering are the same mechanism.

### 1.6 Customer comments — reached from a signal, one disclosure idiom

Comments are T2 evidence and are reached **naturally from an analytical signal**: a row's evidence marker (or the verdict chip) expands the row **inline** into an evidence panel beneath it — no modal, no overlay, no drawer. The panel shows, as clearly separated blocks that never blur authorship:

- **Customer comment** (CUSTOMER_SOURCE) — the four free-text fields present for that survey (`comment_reasons`, `comment_improve`, `comment_working_well`, `comment_additional`), verbatim, labelled per question, with respondent **role** (never name/email).
- **Qualtrics analysis** (QUALTRICS_DERIVED) — supporting chips: parent topics, sentiment band, actionability/effort/emotion where present — visually subordinate, explicitly labelled "Qualtrics analysis".

Only **two** disclosure idioms exist across Responses: **inline expansion** (response evidence, stays in the investigation) and **routed navigation** (the deployment's full story → Deployment CSAT History). This is deliberate — no modal maze.

### 1.7 Qualtrics analytics treatment

Sentiment (label + score), parent topics, and the packed `qx_analytics_json` analytics are **explanatory/supporting evidence, never an authoritative satisfaction measure**. They answer *what patterns exist in the feedback?* They appear only as (a) a `qualitative signal` filter in ADVANCED, and (b) subordinate chips in the evidence panel (1.6) and Deployment CSAT History. Parent topics (clean, `|`-joined) are the theme grouping; raw Topics (comma-bearing) are not a filter facet. Sentiment Polarity is dropped (constant 0). No sentiment on Overview (frozen).

### 1.8 Delivery Ratings — descriptive, not causal

A **Delivery ratings lens** (list toggle, reached from Overview's "lowest delivery rating → Responses › Delivery ratings") ranks the Aspect / Team / Agreement dimensions by Top-2 Box, lowest first, each with n beside it, each drilling to the responses that rated it low. It supports *which dimensions are rated lowest · does it differ by MDS/PGL · by Workday/partner delivery · which responses support that* — split toggles for survey type and leadership. Rules honoured: the three dimension groups are **different questions** and are never pooled across MDS/PGL; blank ≠ 0; team ratings under partner-led describe a different team (juxtapose only). **No causal language** ("lowest-rated", never "driver of dissatisfaction"); no bars presented as proof.

### 1.9 Product Area — honest segmentation

A **Product Area lens** (ADVANCED filter + optional group-by) segments the list. Counts are labelled **"responses touching area"**, never summed to a portfolio total; `product_area_groups` is the default grouping; per-area/low-n cells (n < 5) are suppressed with "n < 5", not hidden silently. Multi-value membership is stated in the lens header so the user is never misled that areas are additive.

### 1.10 Workday-led / partner-led comparison

Responses is where deeper comparison than Overview is appropriate — but still **comparison context, not a contest**. Workday-led is the default/primary lens; partner-led is a muted reference in the same structure. DSAT and NPS are like-for-like at PGL; team ratings describe different teams (juxtapose only). MDS has **no partner-led responses on record** — stated as a fact, not a rule. No leaderboard language, no winner/loser styling, no causal claims, no deltas or rankings. CLFU is ProServ-only, so follow-up expectation is shown for Workday-led only; partner-led Detractors show the verdict without a ProServ follow-up expectation.

### 1.11 Low-volume behaviour

When aggregate evidence is thin (SLG-like): the learning strip collapses to the one honest figure it can support; suppressed analytics render as an intentional, calm "n < 5 — too few to summarise" rather than an empty/broken region; and **deployment evidence becomes the primary content** — the list leads, each deployment row carries more of its own story, and the user investigates by deployment rather than by aggregate. Empty analytical regions never look broken; they carry a sentence.

### 1.12 T1 / T2 access

Responses is useful at **T1** (programme figures, verdict bands, counts, lenses, delivery-rating and product-area aggregates with suppression) and renders without comment text. **T2** progressively reveals the evidence panel (customer comments + full Qualtrics analysis) *without changing navigation* — the same rows, same lenses, the expansion simply carries content. Contacts and comments are POWER_USER+; READ_ONLY sees no CSAT. **T3 identity is never exposed.**

---

## 2. Deployment CSAT History — the customer's story of one deployment

This is the shared deployment-context surface (not a tab), reachable from Overview R2 rows, Overview readiness names, Surveys rows, Responses rows, and — eventually — any DM lens. It answers *what has the customer-satisfaction story of this deployment been?* It is **deployment-centric, not a portfolio dashboard in miniature.**

### 2.1 Structure — six facets over a chronological spine

The approved six facets (read together, no composite score) are the content; the chronological record (E1–E12 where data exists) is the spine:

1. **Latest customer verdict** — "PGL · Aug 2026 · Detractor (DSAT 3, NPS 8)".
2. **Customer trajectory** — "MDS 5 → PGL 3" (separate verdicts, never averaged).
3. **Follow-up expected** — "Detractor follow-up expected · owner role: Deployment Sponsor · tracked in Qualtrics" (Workday-led only; never overdue/completed).
4. **Survey in motion** — "PGL open · 1 of 2 contacts responded · closes 28 Oct".
5. **Next survey** — "PGL forecast Dec 2026 · prepare by 18 Nov · contacts: no Executive Sponsor".
6. **Evidence recency** — "Last heard: 7 months ago (MDS)". Silence is a state, not a verdict.

### 2.2 Timeline model

One chronological record per deployment, each event tagged by the four distinctions it proves and never conflates — **deployment milestone · survey process state · customer outcome · action expectation · historical evidence**:

```
E1  Deployment start (SFDC)                        milestone
E2  MDS forecast (⅓ point) · prepare by …          process (forecast, labelled)
E3  MDS launched / E4 closed                        process
E5  MDS response(s) — verdict, scores, evidence     outcome + T2 evidence
E6  MDS follow-up expected                          action expectation
E7  Go-live (actual supersedes forecast)            milestone (context)
E8  PGL forecast (+2 mo) · prepare by …             process (forecast, labelled)
E9  PGL launched / closed                           process
E10 PGL response(s) — verdict, scores, NPS, evidence outcome + T2 evidence
E11 PGL follow-up expected                          action expectation
E12 Historical learning / later go-lives (context)  history
```

Forecast events are labelled forecasts with their rule; actual launch supersedes forecast. Subsequent go-lives appear as **context events** and do not generate extra PGL forecasts (DG-01). DM shows verdicts, scores, survey states, forecasts, and follow-up *expectation + expected owner role*; DM **cannot** prove follow-up completion, actual owner, ticket status, or root cause — these are not fabricated.

### 2.3 Content inventory

Current/next survey · MDS/PGL history · Top-2 Box and raw scores as appropriate · NPS (PGL, n gate) · Delivery Ratings (the deployment's Aspect/Team/Agreement for each survey, as compact score chips — no portfolio bars) · response evidence · customer comments (T2) · Qualtrics analysis (labelled, subordinate) · follow-up expectation · survey history · links/actions out to **Surveys** (this deployment's lifecycle row), **Responses** (pre-filtered to deployment × survey), and **Qualtrics** (for action — exclusions, resends, CLFU). It is the **investigation unit and the target of every portfolio drill-down**; it reuses the same shared components as the rest of CSAT so a score chip or verdict means the same thing everywhere.

### 2.4 Deployment-detail interaction — recommended pattern

**Recommendation: a routed, deep-linkable in-page deployment workspace** (the content region swaps to the deployment's history; the CSAT sub-nav and scope persist; a breadcrumb returns to the originating list with its scope/filters restored via URL state). **Not** a right-side drawer, **not** a modal.

| Candidate | Verdict |
|---|---|
| Right-side panel / drawer | **Rejected.** This is the pattern whose prototype was visually rejected (the ~42%-width, modal-looking drawer). Re-evaluated per the brief: the *need* for deployment context stands, the drawer *interaction* does not — it competes with the portfolio list, scrims the page, and reads as a modal. |
| Modal | Rejected. Violates "no modal maze"; breaks deep linking and desktop multi-tasking. |
| In-page detail workspace (routed) | **Recommended.** |
| Dedicated separate page (hard nav away) | Close, but loses the sense of staying inside CSAT; the routed in-page workspace keeps the sub-nav and scope so the user has not "left". |

Why the routed in-page workspace wins on the brief's own criteria: **desktop-first** (uses the full content width the drawer wasted); **preserves portfolio context** (sub-nav + breadcrumb + restored filters, so Back returns you exactly where you were); **deep-linkable** (`#/deployment/<id>/csat` is shareable and is the single drill target named by every other surface); **density** (no scrim, no cramped 42% column — the six facets and timeline get room); **no modal behaviour**; and **reusable** — it is the one shared deployment-detail surface other DM lenses can adopt (Concept B's intent, realised as an in-page route rather than a drawer). This also yields exactly **two disclosure idioms subsystem-wide**: inline expansion (evidence within a list) and routed detail (the deployment story).

---

## 3. Shared CSAT component system

The point is that CSAT reads as **one subsystem**, not separately designed pages. Every component below is built once, on the existing CoreUI token layer, and used identically across Overview · Surveys · Responses · Deployment CSAT History. Build on existing tokens (`--color-primary #0F4C81`, `--color-status-*`, `--space-*`, `--radius-*`, `--shadow-subtle/-card`); do **not** introduce the undefined `--font-family` / `--color-surface-subtle` / `--color-brand*` vocabulary; standardise on the `--color-status-{green,yellow,red}[-bg|-fg]` triplets and retire the ad-hoc CSAT literals (`#1a73e8 / #137333 / #b06000 / #c5221f / #c62828 / #2e7d32`).

| Component | Role | Spec / reuses |
|---|---|---|
| `csatDeploymentLink` | Deployment name as the universal drill target | `--color-primary` link, "→" on nav, truncation + `title`; always routes to Deployment CSAT History. |
| `csatSurveyTag` | MDS / PGL | Neutral **text tag** (no fill/border), 11px/600, 0.04em, muted — as polished in V3. |
| `csatEyebrow` | Lifecycle eyebrow | 11px/600 uppercase, 0.06em, muted — the V3/Surveys idiom (PREPARE · SURVEY · RESPOND · FOLLOW UP · LEARN). |
| `csatVerdictChip` | Customer verdict / Detractor | `.status-pill` + `.status-red` (DSAT 1–2) / `.status-yellow` (DSAT 3 or NPS-only). Filled pill = customer's voice; ≤1 per row; **never green**. |
| `csatAttentionMarker` | Attention kind | Three never-mixed forms: filled pill (Detractor) · amber rule+text (our prep/chase gap) · plain text (everything else). Fixed left column. |
| `csatSurveyDate` | Date / deadline | Right column, `tabular-nums`; one dated emphasis per row; ⚠ glyph only when prepare-by ≤ 7 days with issues. |
| `csatTopToBox` | Top-2 Box figure | The single large figure where it anchors (32px/700 on Overview R1 / Responses L1); `tabular-nums`, never coloured; caption "rated 4 or 5 (Top-2 Box)". |
| `csatNps` | NPS | PGL-only, n ≥ 10 else "low n"; "+41 · 31 responses"; never beside Top-2 Box at the same size. |
| `csatDeliveryRating` | One delivery dimension | Compact "Schedule management: 71% · 21 responses" fact or score chip; no matrix, no proof-bars; descriptive language only. |
| `csatFollowupFacet` | Follow-up expectation | "Follow-up expected · in Qualtrics"; Workday-led only; never overdue/completed. |
| `csatDrilldownLink` | Drill-down | Five link roles from V3 (ENTITY · PROSE_LINK · INLINE_DRILLDOWN · PRIMARY_DRILLDOWN · SECONDARY_DISCLOSURE); "→" on navigational links. |
| `csatFilterBar` | Filter controls | `PRIMARY_FILTER` chips (reuse `.filter-chip`) + `ADVANCED_FILTER` disclosure (reuse `.filter-drawer-toggle`); active filters are removable chips; learning-strip links drive the same chips. |
| `csatSectionHeader` | Section header + inline summary | `.trends-section-title` eyebrow with the section's count summary **right-aligned in the header row** (not a separate band). |
| `csatRow` | Compact deployment/survey row | **One CSS-grid track system** shared by Surveys and Responses: `[marker 28px] [name 1fr] [tag auto] [verdict auto] [key-fact minmax] [evidence auto] [date auto]`; columns align across all groups; see §5 for how this fixes Surveys' horizontal utilisation. |
| `csatProvenanceBlock` | Evidence authorship | Three never-merged labels — "Customer comment" / "Qualtrics analysis" / "AI-generated" (last reserved); used in Responses evidence panel and Deployment history. |
| `csatScopeMenu` | Scope / lens | Quiet text button right of the sub-nav: "Workday-led · Rolling 12 months ▾"; `aria-haspopup/expanded`; identical on all surfaces. |
| `csatSubtabNav` | Overview\|Surveys\|Responses | Reuse `.csat-subtab-nav / -btn / -badge / -panel` + `switchCsatSubTab()`; **add roving `tabindex` + arrow keys** (currently missing) for the tri-tab. |

Card recipe (restrained, everywhere): white surface, 1px `--color-border`, radius 12px (`--radius-lg`), `--shadow-subtle`, 16–24px padding; 16px gap rhythm. **Green is banned in the CSAT body** (only the production header freshness badge). No bars/meters/donuts/sparklines, no orange/indigo in CSAT content, no `.info-banner`.

---

## 4. Overview harmonization (visual/component only — content frozen)

Do not touch Overview's content or the four-region IA. Apply only:

- **Shared tags/chips:** R2 Detractor pills → `csatVerdictChip`; MDS/PGL → `csatSurveyTag`; decline tag → shared metadata style.
- **Status treatment:** confirm the three-form rule (filled pill / amber rule+text / plain) via the shared `csatAttentionMarker`; keep green out of the body; keep the one anchor figure as the only large number (`csatTopToBox`).
- **Deployment links:** every R2 row / readiness name → `csatDeploymentLink` routing to the now-built Deployment CSAT History (today it is the one real link; it becomes a real route).
- **Typography & blue:** unchanged — reaffirm blue for links/active-nav only.
- **Lifecycle language:** keep the eyebrows (RESPOND · FOLLOW UP / PREPARE · SURVEY / LEARN) via `csatEyebrow`.
- **Drill-down behaviour:** wire the drill-down map destinations (Surveys / Responses / Deployment CSAT History) to the real pages built this pass; the "+k more" and anchor-figure links resolve into Responses with the matching scope/filter.
- **Known item (do not fix here):** the header freshness-badge full-height-oval observation is a whole-app production concern needing separate authorization — contain it in the prototype only (`align-self:center`).

No bespoke Overview redesign cycle.

## 5. Surveys harmonization (horizontal utilisation only — workflow frozen)

Preserve the compact lifecycle worklist and all its information. Address only the deferred issue that the worklist **wastes horizontal space**. The fix is the shared `csatRow` grid plus these alignments, all implementable in the same Composer pass:

- **Content max width:** adopt the shared CSAT content measure and align Surveys' container to it; stop letting the two-line row stretch name-left / date-right with empty middle.
- **Row columns / alignment:** replace the loose two-line flow with the shared **CSS-grid track system** (`csatRow`) so every row across Upcoming / In Flight / Recent shares the same column edges — marker, name, tag, verdict/status, key-fact·where-to-act, date. Horizontal space now **carries the facet** in its own column instead of wrapping to a second line; rows become denser and the right rail stops floating in whitespace.
- **Date / action placement:** date pinned to the right track (tabular, one emphasis); "where to act" (fix in SFDC · with the customer · VoC Slack · Qualtrics) sits in the key-fact column, not on a lonely second line.
- **Section-summary placement:** the horizon counts move into each group's `csatSectionHeader` (right-aligned in the header row), reclaiming the dedicated horizon strip's vertical space and using the header's horizontal room.
- **Whitespace:** one 16px rhythm; freed horizontal space is used to surface each row's **latest verdict chip** inline (shared `csatVerdictChip`) rather than left blank — more signal per row, same workflow.
- **Breakpoint:** harmonise the reflow breakpoint to **1000px** (Overview V3's polished value; Surveys doc currently says 1100px) so all CSAT surfaces reflow together.

## 6. HC / SLG / HENP — one design, config only

All three DM apps use this exact CSAT design. **Differences are data/configuration only — never separate designs.** A single `csatAppConfig` drives them:

| Config key | HC | SLG | HENP |
|---|---|---|---|
| `industryLabel` / scope label | Healthcare | State & Local Gov | Higher Ed & Student |
| `subRegionRouting` | US Healthcare | US Government | US Higher Education & Student |
| `deploymentUniverse` | workbook deployment master (any status) | same | same |
| `lowVolumeMode` | off | **on** (dozens of responses) | off/auto |
| `studentContext` | – | – | **on** — "Student" terminology where the data is student-scoped |
| labels | default | default | Student-aware labels **only where config-driven** |

Low-volume mode (SLG, and any app/scope that trips the n thresholds) applies the behaviour in §1.11: thin learning strip, deployment-evidence-forward list, intentional suppression copy. Student context in HENP is label/terminology only — same components, same IA. **EVI / PDX / HS remain outside CSAT** unless existing configuration enables a sub-region routing and programme participation; the design does not assume them.

## 7. Representative states (minimal matrix)

Enough deterministic states to prove the integrated design, reusing existing Overview/Surveys state pages rather than multiplying them. New states this pass:

- `RESPONSES_NORMAL` — mixed, HC-scale (full learning strip, lenses, attention-first list).
- `RESPONSES_LOW_VOLUME` — SLG shell (thin strip, deployment-evidence-forward, suppression visible-but-calm).
- `RESPONSES_T2_DETAIL` — a row expanded into the evidence panel (customer comment + Qualtrics analysis, provenance separated).
- `DEPLOYMENT_HISTORY_MDS_PGL` — full lifecycle (E1–E12), MDS 5 → PGL 3 trajectory.
- `DEPLOYMENT_HISTORY_MDS_ONLY` — pre-go-live deployment, PGL forecast upcoming.
- `DEPLOYMENT_HISTORY_FOLLOWUP` — Detractor with follow-up expected (Workday-led), "tracked in Qualtrics".

Existing `CSAT_OVERVIEW_V3_*` (8) and `CSAT_SURVEYS_*` (8) state pages are reused as-is for the navigable shell; the integrated prototype links into them rather than re-creating them.

## 8. Integrated prototype — what this unlocks

For the first time CSAT can be evaluated as a **subsystem**: Overview ↔ Surveys ↔ Responses navigation, and a drill from a synthetic deployment into Deployment CSAT History, fully isolated from production. The build spec, routing, autonomy grant, self-review protocol, and acceptance checklist are in [`composer-handoff.md`](composer-handoff.md).

---

## Supersession & provenance

This folder **supersedes prior CSAT *visual-design* specs for integrated implementation** (`csat-overview-v2/`, `csat-overview-design/`, and the visual-execution role of the Phase-1 concept prototype). It does **not** supersede: the approved architecture (`csat-reconciled-architecture/`), the canonical data contracts (`csat-subsystem/`), or the frozen IA of `csat-overview-v3/` and `csat-surveys-design/` — those remain authoritative and are the inputs this design integrates. No production UI, CSS, EDM, workbook, API, or deployment change is implied by this folder. Design-only.

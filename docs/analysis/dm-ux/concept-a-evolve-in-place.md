# Concept A — Evolve in place

Design-concept document. No runtime UI/CSS/JS/config was changed to produce this. Builds on `docs/analysis/dm-ux/design-opportunities.md` and `docs/analysis/csat-subsystem/csat-ui-architecture.md`; does not repeat their evidence.

**Question this concept answers:** What is the best possible version of today's Deployment Manager, changing as little of the navigation model as the evidence actually requires?

## 1. Premise

Keep the flat top-level tab bar exactly as users know it. Fix the three things the discovery found actually wrong — inconsistent secondary navigation, token/component drift, accessibility gaps — and give CSAT one well-built top-level tab with a single standardized internal sub-navigation pattern. Deployment detail stays inside the existing modal idiom, but consolidated onto one shared modal component instead of the current one-modal-per-feature sprawl.

This is the lowest-risk concept: no existing muscle memory (tab order, tab labels, "click a tab to see a thing") is broken. The bet is that most of today's user-visible roughness is inconsistency and drift, not a wrong architecture.

## 2. Navigation

- Top-level tab bar unchanged in position, visual style, and (for existing tabs) order: Overview → Deployments → [Student] → Go Lives → Reporting → Portfolio Health → [Escalations] → Trends → CSAT → Notable Deployments → Manage Overrides.
- **One standardized secondary-nav component** replaces today's three idioms (`.seg-control`, `csat-subtab-nav` underline tabs, Student banner). New component: `sub-nav` — underline-tab visual (closest to current CSAT subtabs, already has `role=tab`), used everywhere a tab needs internal sections: CSAT, Go Lives (Recent/Upcoming/All or the Explorer KPI+timeline mode), Portfolio Health (Current State/Momentum), Reporting (Executive Summary/Monthly). Segmented-control visual style is retired as a distinct pattern; segmented controls that are actually *filters* (not navigation) become filter chips instead (see §9) — this is the one semantic fix underneath an unchanged look.
- Student (HENP) keeps its current cross-tab banner treatment; it is config-spliced, not a generalizable pattern, and the discovery didn't flag it as broken.
- No URL/hash routing introduced. Deep links are explicitly out of scope for Concept A — if a deep-link requirement turns out to matter, that is itself evidence Concept B's model is needed (see `concept-comparison.md`).

## 3. CSAT design

One top-level **CSAT** tab (label standardized to "CSAT" everywhere — see §9), internal `sub-nav` with five sections. Content and data contracts per `docs/analysis/csat-subsystem/csat-ui-architecture.md`; this document only specifies layout/placement.

**CSAT Overview** (new section; today's CSAT tab has no portfolio-level view). Five things get top placement, nothing else competes for attention at first glance:
1. Response count (n) for the active filter scope — every other number on the page is contextualized by this.
2. Overall Satisfaction — mean + % favorable (4–5), always shown with n.
3. NPS — PGL only, shown only when n ≥ 10, otherwise "low n" treatment (not hidden — see §12).
4. MDS vs PGL satisfaction, side by side tiles, never blended into one number.
5. A single attention/risk signal: a short list of deployments whose most recent response is low-scoring or whose trend is declining — this is the one row that should make a user click through, so it's a list of links into Responses/deployment-detail, not another static number.
Below the fold: trend-over-time chart, Product Area breakdown (labeled "responses touching area," never a plain count — see §16-equivalent in this concept), filter bar (date range, Product Area, deployment/account, survey type).

**Survey Tracking.** Keep today's In-Flight view largely as-is — it already has the right KPI strip (sent/open rate/completion rate/bounced) and 6-column table; this is the part of CSAT discovery explicitly said to "stay as-is, relabel/regroup only." Changes: move Upload (manual fallback) from a peer sub-tab to a small "Upload a batch" action inside this section (it's an input mechanism, not a navigation destination); fold "Upcoming Batches" in as a toggle view within Survey Tracking (operational lifecycle, same data family) rather than a sibling top-level CSAT sub-tab; Notification Management stays a sub-section here, not promoted.

**Responses.** New section (no current equivalent). Historical response table: filters for date range, survey type (MDS/PGL), deployment/account, Product Area (multi-select chips, not a dropdown — Product Area is multi-valued per response). Columns: response date, deployment/account, survey type, Overall Satisfaction, survey-specific satisfaction (PGL or MDS, whichever applies to that row — never shown as one merged column), NPS (PGL rows only). Row click opens the existing modal idiom — a `response-detail` modal, not a page — showing full score breakdown, Product Area tags, and a link into Customer Feedback filtered to that response. Drill path: Overview risk signal → Responses (pre-filtered) → response-detail modal → Customer Feedback (pre-filtered to that response's comments). No dead-end dashboard tiles; every KPI tile in Overview is a filter-applying link into Responses.

**Customer Feedback.** New section. Comment-first layout: each card shows the verbatim customer comment (labeled **Customer comment**), then below it, visually separated (different background tint, explicit label, never adjacent without a label) the Qualtrics-derived topics/sentiment (labeled **Qualtrics analysis**). Provenance badges are never combined into one line of text. Grouped by the four canonical comment questions (reasons / improve / working-well / additional) with a question-group filter. Each card shows deployment, survey type, response date, Product Area tags for provenance/context. T2 gating (see §10) hides this section entirely (not row-by-row) when the viewer lacks T2 access.

**Future AI.** A single disabled/"coming soon" sub-nav entry, not built. When eventually active it would show AI-generated portfolio/deployment theme summaries, each badged **AI-generated** with model + generated-at, always below and visually distinct from the Qualtrics analysis badge — reserving the slot now avoids a later navigation reshuffle.

## 4. Deployment detail

No new surface. The existing per-feature modals (Deployments edit/meta, Go Lives, Override detail, Notable edit, Escalation detail, Student edit) are consolidated onto one shared `modal` component shell (already mostly true — `modal-overlay`/`modal`/`modal-sm` — the fix is retiring the bespoke `dhp-modal-*` and `risk-modal-*` CSS families in favor of the shared shell with a content-only override, not new chrome). CSAT's contribution to "understanding a deployment" is a response-timeline widget embedded inside the existing Deployments-row expansion (not a new tab, not a new modal) — this is the one direct CSAT→Deployments cross-link this concept adds. The 4–7-areas problem (discovery §5) is **not solved** by Concept A; this is its main known gap and is called out explicitly in `concept-comparison.md`.

## 5. Whole-app implications

| Change | Classification |
|---|---|
| Standardized `sub-nav` component (replaces 3 idioms) | REUSABLE_COMPONENT |
| Retiring segmented-control-as-navigation in favor of filter chips where the control was actually filtering | APP_WIDE_DESIGN_SYSTEM |
| Consolidated modal shell (retiring `dhp-modal-*`/`risk-modal-*` bespoke chrome) | REUSABLE_COMPONENT |
| CSAT tab restructure (5 sections) | CSAT_ONLY |
| Response-timeline widget in Deployments row-expansion | CSAT_ONLY (consumes a REUSABLE_COMPONENT: expandable row) |
| Token consolidation (fixing undefined `var()` refs, duplicate border-grey, 3×`:root`→1) | APP_WIDE_DESIGN_SYSTEM |
| Accessibility fixes (tab semantics, modal dialog role, contrast, focus-visible) | APP_WIDE_DESIGN_SYSTEM |
| Container max-width unification (1400px everywhere, dropping the 1200px outliers) | APP_WIDE_DESIGN_SYSTEM |
| Label standardization ("MGM/PGL"→"CSAT" surface-wide) | APP_WIDE_INFORMATION_ARCHITECTURE (naming, not structure) |

Top-level navigation itself: unchanged. Secondary navigation: standardized. Deployment detail: unchanged (known gap). Cards/tables/filters: consolidated onto fewer shared classes. Modals/drawers: consolidated shell, no drawers introduced. Deep links: none. Role/access states: unchanged mechanism (`roleVisibility` + feature flags), extended with T2 gating for Customer Feedback. Empty/loading/error: standardized (see §12).

## 6. Family-wide behavior

Same shell, same components, across all six apps — this concept changes nothing about *how* family differences are expressed (still config-driven tabs/flags), only how consistently the shared parts are built.

- **SLG** (feature-rich, CSAT labeled "MGM/PGL" today): gets full 5-section CSAT tab, label becomes "CSAT" (Survey Tracking section may keep "MGM/PGL" as internal vocabulary per discovery finding — see §9), Notable present, no Student/Escalations tab, Exec Watch present.
- **HENP** (feature-rich + Student): same CSAT tab, Student banner unchanged, Notable present.
- **EVI** (reduced, ProductMode, no CSAT/Notable): CSAT tab absent entirely (today's behavior preserved) — this concept doesn't change the feature-gating mechanism, only what the tab looks like where it exists.
- **PDX** (Escalations pilot, ProductMode): Escalations tab keeps its current modal-detail pattern, now using the consolidated modal shell instead of bespoke `risk-modal-*` CSS.
- **HC, HS**: same shell; HC gets the CSAT tab (feature-rich minus Student/Escalations), HS does not (no CSAT today, unchanged).

## 7. Current DM visual treatment (Treatment 1)

Primary blue `#0F4C81` stays. Slate neutrals stay. System font stays everywhere, body and headings. The only visible changes are token hygiene: collapse the 3 `:root` blocks into 1, remove the 11 undefined `var()` fallback references, replace the `#E2E8F0` duplicate-border-grey literal with the token `--color-border`, fix `--color-text-subtle` (currently 2.56:1, fails AA) to a value that passes 4.5:1 against white while staying visually "subtle" relative to muted/primary text, and give orange (`#F46821`, 3.07:1, used for Exec Watch) a text-safe pairing (keep it for backgrounds/borders/icons, stop using it as small unweighted text color). No new hues introduced.

## 8. Selective Workday visual treatment (Treatment 2)

Swap the primary token value only: `--color-primary` from `#0F4C81` to Ballpoint `#0057AE` (7.06:1 on white, per `visual_guidelines.md`), `--color-primary-dark` toward Ink `#0F2E66`, `--color-primary-tint` recomputed from Ballpoint rather than hand-picked. Slate neutrals stay (Workday's "Ink" neutral family is not a drop-in replacement for the current cool-grey scale and the discovery didn't evaluate it for table density). Orange accent is evaluated against Thumbtack `#FC5B05` but only if a contrast-safe text/background pairing can be derived — otherwise Exec Watch keeps its current orange. Headings and KPI numerals only (not body or table text) are evaluated in Archivo, loaded via the existing Drive-asset serving pattern already used elsewhere in the repo (`webapp-design.md`), with system-font fallback.

Explicitly excluded, no matter the treatment (per instruction): 22px root type, cream page background, hero gradients, horizon curves, glow gradients, underlined secondary buttons, photography/illustration.

Note: the Workday guideline hex (`Ballpoint #0057AE`) differs from the hex already shipped in `solutions/{HC,HENP,SLG}_GoLives` and `PS_SPA` (`#0875C1`). Before building this treatment, Jeff needs to say which is authoritative — this is an unresolved question carried over from the discovery, not new to this concept.

## 9. Naming

Complete the already-started migration (per `csat-current-state.md`: SLG's visible label is already "CSAT"; internal tab id `mgmPgl`, cache keys, and DOM ids are legacy): standardize the top-level tab label to "CSAT" on every app that has it, everywhere. Internal "MGM/PGL" vocabulary may remain *inside* the Survey Tracking section where it describes the two survey instruments (per discovery guidance) — it is a within-section implementation vocabulary, not a tab label.

## 10. Security tiers in this concept

T1 (aggregates): CSAT Overview + Responses table scores, gated by existing `csat.*.enabled` + role ≥ POWER_USER, matching today's mechanism. T2 (comments/free text): gates the entire Customer Feedback section — when absent, the sub-nav entry for Customer Feedback either doesn't render or renders a locked empty-state card explaining that detail-level access isn't available (never a hidden-but-present DOM panel — client-side hiding is a UX convenience here, not the security boundary; the actual boundary is the server read contract, out of scope for this document per instruction 34). T3 (respondent identity): nothing in this concept displays respondent identity — it isn't stored in V1.

## 11. Component vocabulary (this concept's contribution)

Confirms/fixes the existing families rather than inventing new ones: KPI tile (consolidate `kpi-card`/`stat-card`/`overview-kpi-tile`/`csat-kpi-card`/etc. — ~10 variants → 1 component with a size/accent prop), status pill (keep, already consistent), chip — split into two explicit kinds: **semantic chip** (status/classification, non-interactive) and **filter chip** (interactive, removable) — today's CSS conflates them under 25 similar classes, sub-nav (new, replaces 3 idioms), modal (consolidate bespoke variants onto one shell + content slot), response card / feedback card (new, CSAT-specific), empty/loading/error state (standardize — see §12).

## 12. States

Every CSAT section specifies: normal populated; no responses (empty state: explain why — no surveys sent yet vs. sent-but-none-returned, these are different situations and the copy should say which); loading (skeleton rows matching the eventual table shape, not a spinner-only state); error (retry affordance, no raw error text); partial-data (e.g., Responses loaded but Qualtrics sentiment missing for some rows — show the row, mark sentiment columns "pending analysis" rather than blank); n<5 (aggregate cells show "n<5" instead of a number — applies to Product Area breakdowns and any cross-tab, per `csat-ui-architecture.md` §2); T1-only access (Customer Feedback section locked, Overview/Responses/Survey Tracking fully visible); T2 access (everything visible); disabled feature (CSAT tab absent for EVI/PDX/HS — already today's behavior, confirmed unchanged).

## 13. Accessibility fixes (applies family-wide, not CSAT-only)

- Top-level tab bar and new `sub-nav`: add `role=tablist`/`role=tab`/`aria-selected`, roving `tabindex`, arrow-key navigation.
- Modals: add `role=dialog` (currently 0 found despite 5 `aria-modal` uses), focus trap on open, focus return to trigger on close, `Escape` already works — keep it.
- Contrast: fix `--color-text-subtle` and orange-as-text (see §7).
- Forms: add `for=`/`id` pairing to the 96 `<label>` elements currently missing it (static-search finding; needs browser confirmation).
- Tables: add `scope="col"` to `<th>`, add `aria-sort` to the Go Lives sortable columns.
- Motion: add a `prefers-reduced-motion` guard around the modal slide-up transition (currently none anywhere in the stylesheet).
- Color-only status: table rows already show health in words in most places; audit remaining color-only dots/bars (status bars at 2.2–2.5:1) and add a text/shape cue.

This concept does not claim WCAG conformance — it is a checklist for Composer's prototype and a later real audit, consistent with the discovery's own "static analysis only" caveat.

## 14. Density

Normal operational density is preserved as-is (13–14px tables, uppercase micro-headers). This concept does not introduce a density mode switch — it instead sets a floor: no table/caption text below 11px (today's stylesheet has some 9–10px uses flagged as a readability risk); 10–11px remains the practical minimum for secondary/caption text, 12–14px for anything a user scans repeatedly (table body, KPI labels).

## 15. What stays familiar / what changes (summary)

**Stays:** tab order, tab labels (except MGM/PGL→CSAT), tab bar visual style, modal-for-detail interaction model, primary blue hue (Treatment 1), system font, table density, filter-chip-driven exploration, segmented-control *visual* where it's genuinely a view toggle (Go Lives Recent/Upcoming/All).

**Changes:** CSAT gains a real Overview and Responses/Feedback sections (net-new, additive — nothing removed); one secondary-nav pattern instead of three; one modal shell instead of several bespoke CSS families; token cleanup (invisible to users, visible to future maintainers); several accessibility fixes (visible mainly to assistive-tech users); optional Treatment 2 token swap (visual, opt-in, reversible by token value alone).

**Explicitly not solved:** the 4–7-areas-per-deployment problem. A user still visits Deployments, Go Lives, Overrides, Notable, (Escalations/Student where applicable), and now CSAT's embedded timeline widget — fewer full-page visits than today (the CSAT piece moves into the Deployments row-expansion) but no single deployment home. If that gap turns out to matter more than familiarity, that is the argument for Concept B.

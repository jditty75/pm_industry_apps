# Strengths, opportunities, direction, next phase

## Strengths to preserve (constraints for later design)
1. **Clean, quiet visual clarity**: white cards on cool grey, restrained colour, status carried by small pills. Positive user feedback is the evidence; do not re-skin for brand purity.
2. **Recognisable Workday character** with minimal means: W mark in blue strip, deep blue, orange accent for Executive Watch.
3. **Familiar flat tab navigation** with low training burden; same shell across six apps.
4. **Useful density**: 13-14px tables, uppercase micro-headers, filter chips + "More filters" drawer, expandable rows, segmented controls; progressive disclosure already used.
5. **Status scanning**: green/yellow/red pill triplets with AA-grade text pairs; KPI strips at tab tops.
6. **One implementation, config-driven**: shared library gives family coherence; per-app differences come from config.
7. **Role-aware shell** (READ_ONLY, personalization, view-as) and an Overview landing page.
8. **Modals for edit/confirm** are consistent in the generic family (`modal`, `modal-sm`).
9. A token layer (`--space-*`, `--radius-*`, status triplets) already exists to build on.

## Opportunities (ranked)

### HIGH_VALUE
1. **Standardise secondary navigation** (3 idioms now) before CSAT adds 4-5 more sub-areas. Evidence: Reporting/Go Lives/Portfolio use `seg-control`, CSAT uses `csat-subtab-nav`.
2. **Reusable deployment-detail surface** (one home per deployment; features contribute gated sections; hosts CSAT timeline). Evidence: 4-7 places today, ad hoc one-way cross-links, no deep link.
3. **Tokenise remaining colour/type/z-index and define undefined tokens** (11 undefined `var()` names, 99 hex values, no type scale) so new CSAT components inherit one vocabulary. Prerequisite for any palette or font decision.
4. **Accessibility baseline**: tablist semantics/keyboard on the primary tab bar and subtabs, modal `role=dialog`/focus management, `--color-text-subtle` contrast (2.56:1), sortable `aria-sort`, `prefers-reduced-motion`. Matters because CSAT adds data tables and charts.
5. **Server-enforced CSAT tiering reflected in UI structure** (separate sub-areas for aggregate vs comment vs AI).

### MEDIUM_VALUE
6. Consolidate KPI tile, pill, chip, empty/loading, and modal families (10+ KPI variants, 21 pill classes) into a small component set; reduces CSS size and style divergence. Do via aliasing, not rewrite.
7. Family normalisation: tab labels (SLG "MGM / PGL" vs "CSAT"), tab order (HC Trends last), HC dead Trends button, config-driven tab ordering.
8. Breakpoint rationalisation (8 values) and consistent content width (1400 container, 1200 sub-blocks).
9. Move JS-embedded colours (112 hex) to CSS tokens/classes.
10. Deep-link/state for tab + deployment (shareable URLs), useful for CSAT drill-ins.
11. Clarify "Reporting" tab vs "Executive Summary"/"Report" config ids.

### LOW_VALUE / COSMETIC
12. Adopt Workday palette hex values behind tokens (Ballpoint/Ink).
13. Archivo for headings/KPI numerals.
14. Replace emoji icons with the catalog icons.
15. Left-border accent rule alignment; gradient progress fills; horizon device on Overview.
16. Legacy alias removal.

## Design-system assessment

Options: A preserve · B evolve with selected original assets · C rebase on original · D hybrid/evolved system.

**Recommendation: B/D (evolve)** — keep DM's visual language, layout density and tab shell as the authoritative baseline; refactor the implementation into a coherent component/token system, adopt only (i) Workday palette values *if Jeff chooses* behind existing tokens, (ii) the contrast-safe pair method, (iii) optional Archivo for display text and icons catalog for chrome. **Do not rebase (C)**: the original material has no components, tables, filters or density guidance, its type scale and gradient devices are marketing-oriented, and users already like DM. **Pure preserve (A)** is insufficient because CSAT growth exposes nav inconsistency, drift and a11y gaps.

## Decisions for Jeff (evidence cannot answer)
1. Should DM's blue move to Workday Ballpoint `#0057AE` (brand alignment) or stay `#0F4C81` (user-approved look)? Same question for orange accent, and whether to adopt Archivo (external font dependency).
2. Do you or Chris have the original skill bundle (SKILL.md Steps 1-6, templates)? It is absent from Git; it may change conclusions on "Cards and surfaces" rules.
3. Which palette is authoritative: guideline hex (`#0057AE`) or the GoLives/PS_SPA variant (`#0875C1`)?
4. Is CSAT intended to remain POWER_USER+ only, and may aggregates (not comments) reach READ_ONLY?
5. Is the SLG "MGM / PGL" label intentional, or should all apps say "CSAT"?
6. Is a read-first per-deployment surface wanted as a family-wide feature (it affects every tab), or CSAT-only?

## Recommended next Claude design phase
Produce **3 concepts** (design-only, standalone preview pages using the real `getStylesheet()` bundle; no production edits), each shown across SLG (full), HENP (Student+CSAT) and EVI (no CSAT):
1. **Evolve-in-place**: flat tabs retained; one standard sub-nav component; CSAT as a single tab with Overview | Survey Tracking | Responses | Feedback | (AI); deployment detail as modal.
2. **Deployment-centric**: same tabs plus a persistent deployment side panel (CSAT timeline, go live, overrides, notable) and deep links.
3. **Grouped navigation**: top-level sections (Portfolio / Deployments / Customer / Operations) with second-level tabs, testing scalability of CSAT, Student, Escalations together.
Each concept must include: token/type decisions (keep vs Workday palette as a switchable token set), preservation constraints above, CSAT Overview/Responses/Feedback/Survey Tracking/deployment timeline with T1/T2 states, empty/loading/error/low-n states, accessibility checklist, and a Composer preview spec identifying fixtures/handlers to add (see preview-strategy.md).

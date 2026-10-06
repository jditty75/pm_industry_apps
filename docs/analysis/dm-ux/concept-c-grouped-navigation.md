# Concept C — Grouped navigation

Design-concept document. No runtime UI/CSS/JS/config was changed to produce this. This concept is the one explicitly asked to challenge the current shell (instruction 12); it is not pre-selected as the winner (instruction 12, 28).

**Question this concept answers:** Does a more scalable navigation architecture justify changing a shell users already like?

## 1. Premise

Replace the flat, single-row top-level tab bar with a two-level grouped navigation: a small number of top-level groups, each containing today's tabs as second-level items. This is the only concept that changes the thing discovery flagged as "familiar and low-training-cost but reaching scalability pressure" — it tests whether that pressure is real enough, today, to justify retraining existing users.

## 2. Navigation

Four top-level groups, chosen along the lines the discovery's own "4 alternative models" analysis in `information-architecture.md` considered:

- **Portfolio** — Overview, Trends, Portfolio Health, Reporting (Executive Summary/Monthly Report via `sub-nav`).
- **Deployments** — Deployments, Go Lives, Manage Overrides, [Student — HENP only, as a `sub-nav` entry here rather than a cross-cutting banner].
- **Customer Experience** — CSAT (Overview/Survey Tracking/Responses/Customer Feedback/Future AI via `sub-nav`), Notable Deployments.
- **Specialized** — Escalations (PDX only). For apps where this group would otherwise be empty (every app except PDX today), the group itself does not render — a group with zero enabled children is absent, not shown empty.

Each top-level group is a button; clicking it reveals its second-level items as the `sub-nav` row directly beneath (same `sub-nav` component as Concepts A and B — this concept changes the *first* level, not the component vocabulary). The previously-active second-level item within a group is remembered when switching away and back.

This groups 10 destinations (today's 7-9 realized tabs, plus CSAT's internal sections counted as destinations) into 4 first-level clicks + 1 second-level click, versus today's single-level 7-9-wide bar. It is explicitly designed to absorb CSAT's 5 sections and Student/Escalations without the first-level bar ever exceeding 4 items, regardless of how many features DM grows to in the future — that headroom is the entire argument for this concept.

## 3. CSAT design

Same five sections as Concepts A and B (Overview / Survey Tracking / Responses / Customer Feedback / Future AI), same content rules, now reached via Customer Experience → CSAT → `sub-nav`. No content difference from A/B — this concept differs only in how many clicks and what first-level label precedes CSAT. One consequence worth naming: CSAT is no longer a top-level tab name a user scans directly in the primary bar; it's one click deeper, under "Customer Experience." Whether that's a cost or a clarification (grouping CSAT with Notable under one recognizable heading) is exactly the kind of tradeoff `concept-comparison.md` scores explicitly rather than asserting.

## 4. Deployment detail

This concept is agnostic to Concept B's drawer — it can be paired with either Concept A's modal-only approach or Concept B's drawer (the grouped top level and the deployment-detail surface are orthogonal design axes). For comparison purposes, this document assumes it is paired with Concept B's drawer, since pairing it with Concept A's unsolved 4–7-areas gap would understate its best-case value and make the matrix in `concept-comparison.md` incomparable. If Jeff's review prefers Concept C's navigation without the drawer, that's a valid hybrid to request from Composer.

## 5. Whole-app implications

| Change | Classification |
|---|---|
| Two-level grouped top nav (replaces flat bar) | APP_WIDE_INFORMATION_ARCHITECTURE |
| Group-level component (new: collapsible/expandable first-level control) | REUSABLE_COMPONENT |
| `sub-nav` second level | REUSABLE_COMPONENT (same as A/B) |
| Empty-group suppression logic | APP_WIDE_DESIGN_SYSTEM (every app's config now needs a "does this group have any enabled children" check, not just "is this tab enabled") |
| Deployment drawer (if paired, per §4) | Same as Concept B §5 |
| CSAT tab structure | CSAT_ONLY |
| Token/a11y/density | Same baseline as Concepts A/B |

This is the concept with the largest IA footprint — every tab-enablement check in `CoreConfig.js` and every tab-bar-building function in `CoreUI_Markup.js` would need to account for group membership, not just flat enablement. That implementation cost is real and is scored explicitly in the comparison matrix, not hidden.

## 6. Family-wide behavior

- **SLG / HENP** (feature-rich): all 4 groups render (Specialized only for apps with Escalations, so not these two) — realistically Portfolio, Deployments, Customer Experience for SLG/HENP; 3 groups, not 4, since Escalations is PDX-only. This is the one real test of whether grouping helps at the richest end of the family: SLG/HENP go from a 9-wide single row to 3 first-level buttons + up to 5 second-level items under Customer Experience.
- **HC**: same 3 groups (Portfolio, Deployments, Customer Experience).
- **EVI** (reduced): Customer Experience group would have zero enabled children (no CSAT, no Notable) — the group doesn't render at all, so EVI shows 2 groups (Portfolio, Deployments). This is a genuine readability win for the reduced-feature case: fewer groups for a simpler app, rather than the same 7-tab bar EVI shows today regardless of how sparse its config is.
- **PDX**: Portfolio, Deployments, Specialized (Escalations) — no Customer Experience group (no CSAT/Notable for PDX). Demonstrates Escalations fitting cleanly into a group of its own rather than needing a bespoke insertion point in a flat bar (today it's spliced in after Portfolio via `insertAfter` config — grouped nav replaces that splice logic with group membership).
- **HS**: Portfolio, Deployments only.

Family-wide consistency is slightly weaker under this concept than A/B: different apps now show a *different number of top-level groups* (2 to 3), not just a different tab count within one row — a user moving between EVI and SLG sees a structurally different first click, not just a longer list. This is the central risk the comparison matrix should weigh.

## 7. Current DM visual treatment (Treatment 1)

Same token set as Concepts A/B (§7 in each). The group-level control is new chrome with no current equivalent — recommend it visually subordinate to content (a slim row above the `sub-nav`, same weight class as today's tab bar, not a heavier "mega-nav" treatment) to avoid DM acquiring a marketing-site navigation feel, which instruction 4 explicitly warns against ("do not turn DM into a sparse marketing dashboard").

## 8. Selective Workday visual treatment (Treatment 2)

Same approach as Concepts A/B §8 (Ballpoint primary, Archivo headings/KPI numerals only, same exclusion list). No concept-specific additions here — the grouped-nav chrome itself should use the same primary/neutral tokens as everything else, not a distinct "navigation palette."

## 9. Security tiers in this concept

Identical model to Concept A §10 / Concept B §9 — T1/T2/T3 gating is unaffected by which navigation shell contains the tab. One addition specific to grouping: if a role can see none of a group's children (e.g., READ_ONLY and CSAT), the group itself must not render as an empty, clickable dead-end — same "absent, not shown empty" rule as §2, now applied per-role as well as per-config.

## 10. Component vocabulary (this concept's contribution)

Adds one new family beyond Concepts A/B: **group nav control** (first-level button, expand/active states, badge for "has notable items" if ever needed — not committing to that now). Everything else (KPI tile, pill, chip, `sub-nav`, modal, deployment drawer if paired) is shared with A/B.

## 11. States

Same per-section state set as Concept A §12, plus: **empty group** (a group with zero visible children for the current role/config never renders — already specified in §2/§6, listed here as a state to verify in Composer's preview, since it's easy to get wrong) and **group-switch transition** (what happens to second-level selection when switching groups — recommend remembering last-active second-level item per group, tested as a state in preview).

## 12. Accessibility

Same baseline as Concepts A/B §13, plus: the first-level group control needs its own keyboard model — likely `role=tablist` at the group level too, or a disclosure-button pattern (`aria-expanded`) if groups behave as expand/collapse rather than tab-select; this is a genuine new a11y surface this concept introduces that A/B don't have, and should be prototyped both ways before committing.

## 13. Density

Same floor as Concepts A/B §14. Two-level navigation costs vertical space (group row + `sub-nav` row, versus today's one row) — on a dense operational page this is a real tradeoff (less room for the KPI strip/table above the fold) and should be measured in Composer's preview, not assumed negligible.

## 14. What stays familiar / what changes (summary)

**Stays:** `sub-nav` component (shared with A/B), tab *content* for every existing tab (nothing inside Deployments, Go Lives, etc. changes), token set, deployment drawer if paired with Concept B.

**Changes:** the first click a user makes to reach anything changes for every single tab except whichever one ends up as a group's sole/default child — this is real retraining cost for every existing user, on every visit, not just once. Tab-count-per-row drops but total-clicks-to-destination for already-memorized paths may increase by one click (first-level group, then second-level item) for anything that isn't the default-shown child of its group.

**Explicitly not pre-decided to win** (instruction 12): this concept is the most architecturally scalable and the most disruptive to existing muscle memory. Whether scalability pressure is real enough *today* (7–9 tabs, not yet at a breaking point per the discovery) to justify that disruption is the central question `concept-comparison.md` and `recommended-direction.md` have to answer honestly, not assume.

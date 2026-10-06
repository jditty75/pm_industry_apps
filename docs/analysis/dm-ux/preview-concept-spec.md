# Preview implementation specification (handoff to Composer)

This document specifies what to build for isolated localhost concept previews. **No production DepMngr runtime, CSS, markup, JS, config, or deploy pipeline is touched by this spec or by building against it.** Previews are standalone pages that may reuse current DM CSS/tokens/components where convenient, per `docs/agent/ui-preview.md`'s existing pattern (DepMngr's real stylesheet/JS bundle strings inlined from `libraries/DepMngr/src` via the existing preview engine) — extend that pattern rather than inventing a new one.

## 1. What to build

Three concept previews plus one baseline:

- **Baseline** — today's DM, unchanged, for side-by-side comparison. (Already buildable via existing `.\preview.ps1 <APP_ID>` per app.)
- **Concept A preview** — standardized `sub-nav`, consolidated modal shell, 5-section CSAT tab, token/a11y fixes applied to the existing shell.
- **Concept B preview** — everything in Concept A, plus the deployment drawer with hash-based deep links.
- **Concept C preview** — grouped top-level navigation (optional, lower priority per `recommended-direction.md` decision 6; build only if Jeff opts in) — recommend pairing with Concept B's drawer per `concept-c-grouped-navigation.md` §4, so its deployment-context score is comparable in the visual matrix.

Each preview is a standalone page/route under the existing `.preview-out/` mechanism (gitignored, localhost-only, dismissible "LOCAL PREVIEW" banner) — not a modification to any `solutions/<APP>_DM` source.

## 2. Page structure per concept

**Concept A**: one page per app scenario (see §6), structurally: header (unchanged) → flat tab bar (unchanged) → active tab's content, where CSAT's content is the new 5-section layout with the new `sub-nav` row. No new top-level routes.

**Concept B**: same as A, plus the drawer renders as an overlay within the same page (not a separate route) — triggered by clicking any deployment reference. Deep-link state (`#tab=...&deployment=...&section=...`) should be readable on page load so a preview URL can be shared pointing straight at an open drawer/section, for the visual-review matrix in §8.

**Concept C**: header (unchanged) → group-level row (new) → `sub-nav` row for the active group's second-level item → content. Drawer overlay, if paired, same as B.

## 3. Dimensions / layout

Desktop-first per instruction 4 — build and screenshot at **1440×900** as the primary viewport (matches DM's existing 1400px container max-width). A secondary check at **1920×1080** is useful for the grouped-nav vertical-space concern (`concept-c-grouped-navigation.md` §13) but is not required for every screenshot. Do not build a mobile-first layout; graceful `max-width` wrapping (as today) is sufficient, not a redesign.

## 4. Component hierarchy to build fixtures for

New components needed, by concept:

| Component | A | B | C |
|---|---|---|---|
| `sub-nav` (underline tabs, `role=tab`/`aria-selected`) | new | reused | reused |
| Consolidated `modal` shell (content-slot variant) | new | reused (for edit flows) | reused |
| CSAT Overview KPI row (5 items per `concept-a-evolve-in-place.md` §3) | new | reused | reused |
| Response table + `response-detail` modal | new | superseded by drawer CSAT section (build both; B doesn't need the modal) | reused from B |
| Feedback card (comment + Qualtrics-analysis provenance badges) | new | reused | reused |
| Deployment drawer shell + internal `sub-nav` | — | new | reused (if paired) |
| Deployment chip (click target referencing a deployment) | — | new | reused |
| Group-nav control (`aria-expanded` or tablist) | — | — | new |
| KPI tile (consolidated, replacing ~10 current variants) | new | reused | reused |
| Filter chip vs. semantic chip (split, per `concept-a-evolve-in-place.md` §11) | new | reused | reused |

## 5. Fixture requirements (synthetic only — instruction 31)

All text synthetic; no real customer names, accounts, or comments. Build fixture sets covering, at minimum:

1. **Mixed MDS/PGL portfolio** — a deployment set where some have only MDS responses, some only PGL, some both across time (feeds Timeline/MDS→PGL chronology).
2. **High satisfaction** — Overall Satisfaction mean ≥4.5, mostly favorable.
3. **Low satisfaction** — mean ≤2.5, for the Overview attention/risk-signal list and for testing status-color contrast at the low end.
4. **Multiple historical responses on one deployment** — ≥4 responses spanning >1 year, for the drawer Timeline and MDS→PGL comparison view.
5. **Product Area multi-select** — responses with 1, and responses with up to 9, Product Area values, to verify the "responses touching area" non-additive labeling renders correctly and doesn't imply a false total.
6. **Mixed sentiment** — Qualtrics sentiment spanning positive/neutral/negative on the same deployment, to verify the Customer Feedback provenance badges stay legible across sentiment-driven styling.
7. **Concerning customer feedback** — a comment whose content and low score should surface on the Overview risk-signal list, to verify the drill-through path (Overview → Responses pre-filtered → response-detail/drawer → Feedback pre-filtered) actually lands correctly.
8. **No responses** — a deployment or portfolio scope with zero CSAT data, to verify the empty state distinguishes "no surveys sent" from "sent, none returned."
9. **n<5** — an aggregate cell (e.g., a Product Area group) with fewer than 5 contributing responses, to verify suppression renders as "n<5" rather than a number.
10. **T1-only** — a role/view-state with aggregate access but no comment access, to verify Customer Feedback is absent/locked, not hidden-but-present.
11. **T2** — full access, for contrast against #10.
12. **High-volume portfolio** — a larger synthetic set (dozens to ~100 responses) to check table/chart performance and scroll behavior at a volume beyond the ~28-per-app sample scale the real data currently shows (see §9 note on evidence).
13. **Student-enabled HENP** — a HENP scenario with the Student banner/section present alongside CSAT, to verify they coexist without visual collision.
14. **Reduced-feature EVI** — an EVI scenario with no CSAT, no Notable tab, and (for Concept B) a drawer with only Summary/Timeline/Overrides sections, to verify the "fewer features, not padded" requirement.

Also needed, orthogonal to the list above: an **NPS low-n** case (n<10, PGL-only, per `csat-ui-architecture.md`'s stricter NPS gate) distinct from the general n<5 aggregate-suppression case, since they're different thresholds for different things.

## 6. App scenarios

Build at least these three real-app shapes (not six — the family-wide requirement is demonstrated by proving the shell handles the extremes, not by exhaustively screenshotting every app):

- **SLG** — feature-rich: CSAT (labeled "CSAT," migrating from "MGM/PGL" per `recommended-direction.md` decision 4), Notable, no Student, no Escalations.
- **HENP** — feature-rich + Student: CSAT, Student, Notable.
- **EVI** — reduced: no CSAT, no Notable, ProductMode context banner present.

Additionally, for the family-wide and PDX-Escalations requirement (instruction 25), render **PDX** at least once (Escalations-only differentiator, no CSAT/Notable) — this can be a single extra screenshot rather than a full scenario build-out.

## 7. Interactions, filter behavior, deployment-detail behavior, toggles

- **Filters**: Product Area filter is multi-select chips (not a single-select dropdown); date range and survey-type (MDS/PGL) filters compose with it; applying a filter from an Overview KPI tile should land on Responses pre-filtered, demonstrating the no-dead-end-dashboard requirement (instruction 14).
- **Deployment-detail behavior** (Concept B/C-paired): clicking a deployment chip opens the drawer at `section=summary` by default, or at the section implied by the entry point (e.g., opening from a CSAT Responses row opens directly to `section=csat`). Switching top-level tabs while the drawer is open keeps it open and in place (per `concept-b-deployment-centric.md` §2) — this is a specific behavior to verify, not just build.
- **T1/T2 access toggle**: a visible preview-only control (clearly marked as a preview affordance, not part of any concept's actual UI) that switches the fixture's simulated access level, to generate the T1-only vs. T2 screenshots in §5 #10/#11 without needing two separate fixture files.
- **Token treatment toggle**: a preview-only control switching between Treatment 1 (current DM evolved) and Treatment 2 (selective Workday — Ballpoint primary, Archivo headings/KPI numerals) for the shortlisted concept, per instruction 32's requirement to show both treatments. Implement as a CSS custom-property swap at the root, not two separate builds.
- **Loading/empty/error states**: each should be reachable via a preview-only state selector (matching the existing DM preview pattern's `?scenario=` querystring convention) rather than requiring a timed/simulated network delay.

## 8. Visual review matrix (minimum screenshots, instruction 32)

1. SLG Overview/shell (Concept A and B, Treatment 1).
2. SLG CSAT Overview.
3. SLG Responses.
4. SLG Customer Feedback.
5. Deployment detail with MDS→PGL history (Concept B drawer, Timeline section; or Concept A's response-timeline-in-row-expansion if B isn't shortlisted).
6. HENP shell showing Student + CSAT.
7. EVI reduced-feature shell.
8. Loading state (any CSAT section).
9. Empty state (no responses).
10. Low-n/T1-access state.

For whichever concept is shortlisted after Jeff's review, additionally capture:
- Same core screens (1–4) under **Treatment 2** (selective Workday), for direct comparison against the Treatment 1 versions already captured.

## 9. Scope notes and evidence caveats for Composer

- Fixture volume: design around portfolio-scale projections in `csat-ui-architecture.md` (~300/year planned; high-volume fixture uses synthetic rows). **SLG Responses storage canary (accepted production evidence):** Responses source 177; SLG routed candidates 28; 26 stored; 2 excluded by historical deployment-universe eligibility; first pass inserted 26 / updated 0; second pass inserted 0 / updated 0; `CSAT_Responses` exists in SLG; repeat processing produced no duplicate growth. Do not caption prototype screens as demonstrating production counts — fixtures remain synthetic.
- No R3/read-API work, no server contract changes, and no AI service calls are part of this spec (instruction 34, 37). The "Future AI" sub-nav entry in every concept renders as a disabled/placeholder state only.
- Do not build screenshots or mock images into the `docs/analysis/dm-ux/` documentation tree itself (instruction 35) — screenshots are Composer/Jeff review artifacts, produced and reviewed outside Git-tracked docs unless Jeff later asks for specific ones to be archived.

## 10. UI data-needs inventory (instruction 34 — needs, not API shapes)

For the shortlisted concept (expected: B), the UI will eventually need, without committing here to how it's served:

- Portfolio-scope aggregates: response count, Overall Satisfaction mean + % favorable, NPS (PGL, n≥10 gated), MDS vs PGL tiles, Product Area breakdown (non-additive), trend-over-time series — all filterable by date range/Product Area/deployment/survey-type, all n<5-suppressible at the cell level.
- Deployment-scope data: a single deployment's response list (scores + metadata, no comments) for T1, plus comments + Qualtrics analysis for T2; Summary/Health/Timeline fields already produced today by Deployments/Go Lives/Overrides read paths — the drawer needs these composed per-deployment, not duplicated.
- Response-detail: full field set per `canonical-response-model.md`'s `csat-response-v1` contract, scoped by T1/T2 as above.
- Access-tier evaluation: whatever currently resolves role (`AppUsers`/`roleVisibility`) needs to extend to a T1/T2 comment-level check — today's mechanism is client-side visibility only (per `csat-current-state.md`); the real boundary is a future server concern, out of scope here.

This inventory is deliberately data-shaped, not endpoint-shaped — turning it into secure read contracts is explicitly the next phase's job (instruction 34), not this one's.

## 11. Approval workflow (for Composer and Jeff, instruction 33)

Claude concept (this document and its siblings) → Composer isolated preview → Jeff screenshot/browser review → feedback → Composer iteration → Jeff visual approval, recorded explicitly as **CSAT / DM UX VISUALLY APPROVED** → only then does R3/read-API design and production UI implementation begin. Architecture approval (this document) is not visual approval and does not authorize either preview-stage shortcuts into production code or, independently, any production deploy.

## 12. Launch (implemented)

From repo root:

```powershell
.\preview.ps1 DM_UX
```

Output: `.preview-out/DM_UX.html` (gitignored), served at `http://127.0.0.1:<port>/DM_UX.html`. Full controls, hash routes, and review checklist: [visual-review-guide.md](visual-review-guide.md).

Source (isolated, not production DepMngr): `skills/gas-monorepo-engineer/dm-ux-concept/`.

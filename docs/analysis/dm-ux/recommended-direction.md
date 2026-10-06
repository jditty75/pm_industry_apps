# Recommended direction

## Recommendation

**Concept B (Deployment-centric hybrid), built on Concept A's baseline fixes.** This is a defined hybrid, not a fourth concept: take everything in Concept A (standardized `sub-nav`, consolidated modal shell, token/component cleanup, accessibility fixes, the five-section CSAT tab) as the foundation every concept shares, and add Concept B's one structural addition — the persistent, deep-linkable deployment drawer — on top of it. Concept C's grouped top-level navigation is **not** recommended for this round; see §4.

## Why

The comparison matrix in `concept-comparison.md` shows B inheriting every STRONG score A earns (familiarity, family consistency, CSAT fit, migration risk, maintainability) and trading only three STRONGs for MODERATEs (density, accessibility, implementation complexity) in exchange for moving the single dimension the discovery flagged most clearly — deployment context, the 4–7-areas problem — from WEAK to STRONG. That is a narrow, well-understood trade, not a leap.

Concept C's scalability advantage is real but speculative: today's realized tab counts (7 for EVI/HS, up to 9 for SLG/HENP, per `information-architecture.md`) are not yet at the point the discovery called a breaking point, and the discovery's own finding was that the *inconsistency* of today's three secondary-nav idioms is the live problem, not the tab count itself — a problem Concept A's `sub-nav` consolidation already fixes without touching the top level. Spending Concept C's retraining and implementation cost against a problem that hasn't arrived yet is not justified by current evidence. If tab count or user feedback later shows the flat bar genuinely straining, Concept C's design is already fully specified in `concept-c-grouped-navigation.md` and can be revisited without starting over.

## What we gain

- A single, reusable home for "what's going on with this deployment," reachable in one click from Deployments, Go Lives, CSAT Responses, Notable, Escalations (PDX), and Student (HENP) rows — down from the discovery's documented 4–7 separate visits.
- Deep links for the first time in DM's history — a URL a support engineer or PM can share that opens directly to a specific deployment's CSAT history, without walking someone through four tabs verbally.
- A complete, well-structured CSAT subsystem (Overview, Survey Tracking, Responses, Customer Feedback, Future AI) as one top-level tab, meeting the explicit requirement that CSAT not become several top-level tabs.
- Consolidated tokens, one secondary-nav pattern instead of three, one modal shell instead of several bespoke CSS families, and a documented accessibility checklist — correctness and maintainability gains that don't depend on which navigation concept wins.
- A component vocabulary (KPI tile, status pill, two kinds of chip, `sub-nav`, modal, deployment drawer, response card, feedback card) small enough to reason about, replacing today's ~20 KPI/card variants and 21+25 pill/chip classes.

## What we preserve

- The exact top-level tab bar today's users already know — order, labels (one rename: "MGM/PGL"→"CSAT" on SLG, completing a migration already underway per `csat-current-state.md`), and visual style.
- The modal-for-quick-edits interaction model for short-lived actions (editing a Notable classification, confirming an override) — only *browsing* detail moves into the drawer; *editing* can stay a modal launched from it.
- Current density, current primary blue (Treatment 1 default), current restrained visual character — nothing about DM's "quiet" look changes unless Jeff separately approves the Workday-token Treatment 2 experiment.
- The config-driven family model: the drawer's section list is config-driven per app exactly like today's tab list is, so SLG/HENP/HC/EVI/PDX/HS continue to diverge only by data/config/feature-flag, never by bespoke visual system.

## What changes for existing users

- A new surface (the drawer) appears the first time a user clicks a deployment reference anywhere in the app. It needs a moment of discovery but requires no relearning of anything that already works — users who never click it experience an unchanged app.
- CSAT (and, for SLG, the "MGM/PGL" label) gets meaningfully richer — more sections than today's single In-Flight-focused tab.
- A handful of existing modals (Go Lives, Override, Notable, Escalation, Student *detail* views) relocate into the drawer; their corresponding *edit* flows are expected to still open as modals, now launched from inside the drawer rather than from the originating tab directly — this is the one interaction-pattern change existing power users will notice and should be called out plainly in any rollout communication.

## What does not change

- Top-level tab count, order, or labels (except the one CSAT rename).
- The per-app feature-flag mechanism (`ui.tabs`, `notable.enabled`, `student.enabled`, `escalations.enabled`, `ProductMode` union scoping).
- The role/access model (`roleVisibility`, POWER_USER/ADMIN/READ_ONLY) — extended with T2 gating for CSAT comments, not replaced.
- The desktop-first, information-dense design intent — nothing in this recommendation introduces a sparse marketing-dashboard aesthetic.

## Why the tradeoff is justified

The discovery produced one clear, evidenced structural gap (4–7 areas per deployment) and one clear, evidenced consistency gap (three secondary-nav idioms, drifted tokens, accessibility holes). Concept A alone fixes the second gap but not the first. Concept C fixes neither gap better than B does and introduces a navigation change with real retraining cost against a scalability problem that current tab counts don't yet justify. Concept B fixes both evidenced gaps, preserves everything users already like, and confines its risk to one well-scoped new component rather than to the primary navigation every user touches on every visit. That is the best-evidenced ratio of benefit to disruption available from this discovery.

## Decisions required from Jeff before preview implementation

Kept to genuine visual/product decisions, not implementation detail (instruction 29's final list, consolidated with each concept's open questions):

1. **Primary palette**: keep current `#0F4C81`, or adopt Workday Ballpoint — and if the latter, which hex is authoritative, the documented guideline value `#0057AE` or the value already shipped in `solutions/{HC,HENP,SLG}_GoLives`/`PS_SPA` (`#0875C1`)? These differ and only one should be called "the Workday standard."
2. **Archivo for headings/KPI numerals**: worth a Composer preview, or skip the typography experiment entirely given the external-font-load cost?
3. **Drawer modality**: should the deployment drawer be a true modal (`role=dialog`, focus-trapped, background inert) or a non-modal panel (background stays interactive/scrollable)? `concept-b-deployment-centric.md` §12 recommends non-modal but flags it as untested.
4. **CSAT label completion**: confirm standardizing "CSAT" as the visible label everywhere (SLG's label already migrated per discovery; this would complete it, leaving internal `mgmPgl` ids/cache-keys as acknowledged legacy debt, not renamed now).
5. **Drawer section scope**: is the deployment drawer wanted as the family-wide surface described here (every app, sections gated by config), or should it ship CSAT-enabled-apps-first and expand later?
6. **Is Concept C's grouped navigation worth prototyping anyway**, purely to have a side-by-side visual comparison on record, even though it isn't the recommended direction? (Composer can build it in parallel at low marginal cost since it reuses the `sub-nav` component either way.)

Architecture approval alone does not authorize moving to R3/read-API or production UI work — see `preview-concept-spec.md` for the next step, and instruction 33's approval chain (Claude concept → Composer preview → Jeff visual review → iteration → **CSAT / DM UX VISUALLY APPROVED** → only then R3/production implementation).

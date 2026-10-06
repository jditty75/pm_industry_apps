# Concept B — Deployment-centric hybrid

Design-concept document. No runtime UI/CSS/JS/config was changed to produce this. Builds on `docs/analysis/dm-ux/information-architecture.md` §"Deployment as an organising object" and `docs/analysis/csat-subsystem/csat-ui-architecture.md`.

**Question this concept answers:** Can Deployment Manager remain feature-oriented while giving every deployment a coherent home?

## 1. Premise

Everything about Concept A's top-level navigation is preserved unchanged. On top of it, this concept adds exactly one new structural element: a persistent, reusable **deployment-detail surface** — a right-side panel/drawer, not a new tab — that any row, link, or KPI drill-down across the whole app can open, and that keeps its place (selected deployment, scroll position, active section) while the user moves between top-level tabs. This is the concept that treats discovery finding §5 (4–7 areas to understand one deployment) as the primary problem to solve, while treating the flat-tab familiarity as a constraint to preserve, not challenge.

## 2. Navigation

- Top-level tabs: unchanged from today (same as Concept A §2, including the standardized `sub-nav` fix — Concept B assumes Concept A's secondary-nav and modal consolidation as a baseline, since both are evidence-driven regardless of which concept wins).
- **New: deployment drawer.** A panel that slides in from the right, overlaying ~40% of the viewport (desktop-first — this is not a mobile bottom-sheet pattern), leaving the underlying tab content visible and scrollable behind a dim scrim. Opening the drawer does not navigate away from the current tab; closing it returns exactly to where the user was.
- **Deep links.** The drawer's state is reflected in the URL hash (GAS HtmlService constraints mean this is a hash-based pseudo-route, not server routing — see `preview-concept-spec.md` for what's actually buildable): `#deployment=<id>&section=<csat|health|timeline|golive|notable|escalations|student|overrides>`. Opening a link with a `#deployment=` hash on load opens the drawer directly — useful for support/collaboration ("look at this deployment") without walking someone through 4 tabs first. Top-level tab state is a second hash segment (`#tab=csat&deployment=...`) so a link can also land on a specific tab with the drawer open.
- The drawer is reachable from: Deployments table rows, Go Lives rows, CSAT Responses rows, Notable rows, Escalation rows (PDX), Student rows (HENP), and Overview risk-signal links. One click, same destination, from anywhere a deployment is referenced.

## 3. CSAT design

The CSAT top-level tab is structurally identical to Concept A (Overview / Survey Tracking / Responses / Customer Feedback / Future AI, same five sections, same content rules — provenance badges, T1/T2 gating, n<5, MDS/PGL non-blending, NPS n≥10 gate). Concept B does not change *what* CSAT shows; it changes how a single deployment's CSAT history is reached and where it lives once reached.

The one CSAT-specific addition: every response row and every deployment reference inside Overview/Responses/Customer Feedback opens the deployment drawer at `section=csat` instead of (or in addition to) a standalone response-detail modal. The drawer's CSAT section *is* the response-detail + response-timeline experience — Concept A's separate `response-detail` modal is superseded by this one richer, persistent surface. A user can open a response from the Responses table, read the full comment, then without closing anything, switch the drawer to `section=timeline` to see that same deployment's Go Live date and health history for context, then back to `section=csat` — no tab switching, no lost place.

## 4. Deployment detail (this concept's core contribution)

The drawer has its own internal `sub-nav` (same component as Concept A's, applied to a drawer rather than a page) with sections chosen from — not all of these appear for every deployment, gated by feature/config/role exactly as today's tabs are:

- **Summary** (always present) — account, stage, partner, services approach, dates; the content of today's Deployments edit/meta modal, now the drawer's default landing section.
- **Health** — current status pill + the handful of fields driving it; supersedes the Deployment Health Plan modal's read side.
- **Timeline** — a single chronological view combining Go Live events, override history, and (new) CSAT survey sends/responses as dated markers on one line — this is where the MDS→PGL chronology (see §15-equivalent, below) becomes visible without leaving the drawer.
- **CSAT** — response history for this deployment: list of responses with scores, and for each, the comment + Qualtrics analysis (same provenance rules as the Customer Feedback tab section).
- **Notable** (when the deployment is on the Notable list) — classification/validation status, same content as today's Notable edit modal, read-first with an edit affordance for POWER_USER+.
- **Escalations** (PDX only, when applicable) — escalation detail, same content as today's modal.
- **Student** (HENP only, when applicable) — student-specific fields.
- **Overrides** — override detail/impact summary.

Not every item gets its own sub-tab (per instruction 11): Health is folded into Summary as a status strip rather than a separate section, since it's a handful of fields, not a dataset — only Timeline, CSAT, Notable, Escalations, Student, and Overrides warrant their own `sub-nav` entries because each has enough content to need its own scroll region and filters.

This directly answers the discovery's 4–7-area finding: the same information is still produced by the same six-or-so features, but a user reaches all of it from one persistent surface instead of navigating through each feature's own tab and modal.

## 5. Whole-app implications

| Change | Classification |
|---|---|
| Deployment drawer (new surface) | APP_WIDE_INFORMATION_ARCHITECTURE |
| Drawer internal `sub-nav` | REUSABLE_COMPONENT (same component as Concept A's) |
| Hash-based deep-link state | APP_WIDE_DESIGN_SYSTEM (new pattern, touches every feature that links to a deployment) |
| Existing per-feature modals (Go Lives, Override, Notable, Escalation, Student) | Their *detail* content moves into the drawer; their *edit* forms may remain modals launched from the drawer (editing is a distinct, shorter-lived interaction than browsing) — REUSABLE_COMPONENT boundary redrawn, not all modals deleted |
| CSAT tab structure | Same as Concept A — CSAT_ONLY |
| Token/a11y/density work | Same as Concept A §7–8, §13–14 — inherited, not re-litigated here |
| Top-level tabs/cards/tables/filters outside the drawer | Unchanged from today |

Role/access states: the drawer respects the same `roleVisibility`/feature-flag gating per section as the equivalent top-level tab would — e.g., READ_ONLY sees Summary/Health/Timeline but not an edit affordance; a deployment with no CSAT data for that app (EVI/PDX/HS) simply has no CSAT section in its drawer, same as those apps having no CSAT tab.

## 6. Family-wide behavior

- **SLG / HENP** (feature-rich): drawer shows up to 6 sections (Summary, Timeline, CSAT, Notable, Overrides, +Student for HENP). This is where the drawer earns its keep — these are exactly the apps where today's "visit 4-7 areas" finding is worst.
- **HC**: Summary, Timeline, CSAT, Notable, Overrides (no Student/Escalations).
- **EVI** (reduced config): Summary, Timeline, Overrides only — drawer is genuinely smaller, not padded with empty sections; this is the "fewer-features" family example the brief asks for.
- **PDX**: Summary, Timeline, Escalations, Overrides (no CSAT/Notable) — demonstrates PDX-only Escalations fits the same drawer shell as every other feature, not a bespoke surface.
- **HS**: Summary, Timeline, Overrides.

One shell, one drawer component, one `sub-nav` — the section *list* is config-driven per app exactly like today's top-level tab list is, which is the same mechanism already in place, applied to a new surface rather than a new mechanism.

## 7. Current DM visual treatment (Treatment 1)

Identical token set to Concept A §7 (primary `#0F4C81`, cleaned-up neutrals, fixed `--color-text-subtle`/orange contrast). The drawer is visually a card: same `--shadow-elevated`, same `--radius-xl`, white surface — it should look like it belongs to the existing component system, not like a bolted-on panel.

## 8. Selective Workday visual treatment (Treatment 2)

Identical approach to Concept A §8 (Ballpoint primary swap, Archivo for headings/KPI numerals only). One additional consideration specific to this concept: the drawer's Timeline section is the single best candidate in the whole app for the original material's chart/secondary-palette colors (status-over-time markers), since it's a genuinely new visual element rather than a reskin of an existing one — worth a focused look during Composer's preview, not a commitment here.

## 9. Security tiers in this concept

Same T1/T2/T3 model as Concept A §10, applied per-section inside the drawer rather than per top-level tab: the drawer's CSAT section is gated exactly like the CSAT tab's Customer Feedback section (T2 required for comments; T1 viewers see scores only, or the section is absent/locked). Because the drawer is reachable from many entry points, the gating must be evaluated by section, not by entry point — a Notable-tab user and a Responses-tab user opening the same deployment's drawer must see identically-gated content.

## 10. Component vocabulary (this concept's contribution)

Adds exactly one new family to Concept A's vocabulary: **deployment detail** (the drawer shell + its internal `sub-nav` + a "deployment chip" — a small reusable reference element, e.g. "Acme County Public Schools · SLG · Active," that appears anywhere a deployment is named and is itself the click target that opens the drawer). Everything else (KPI tile, pill, chip, modal, response card, feedback card) is identical to Concept A's.

## 11. States

Same per-section state set as Concept A §12 (normal/empty/loading/error/partial/n<5/T1/T2/disabled), applied to the drawer. Two drawer-specific additions: **drawer-loading** (deployment summary loads fast; later sections like CSAT/Timeline may still be fetching — show the drawer immediately with a per-section skeleton rather than blocking the whole drawer on the slowest section) and **deep-link-not-found** (a `#deployment=` hash pointing at an id the current app/role can't see — show a clear "not available" state, not a silent blank drawer).

## 12. Accessibility

Inherits Concept A §13 in full. Drawer-specific additions: `role=dialog` (or `aria-modal="false"` with `role=complementary` if it should remain a non-modal panel — recommend non-modal, since the design intent is that background content stays visibly present and scrollable; a decision for Composer's prototype to test both ways), focus moves into the drawer on open, `Escape` closes it, focus returns to the triggering row/link on close, and the scrim must not trap focus if the drawer is non-modal.

## 13. Density

Same floor as Concept A §14. The drawer itself, at ~40% viewport width, is the one place in this concept where density needs explicit attention — it's narrower than a full tab page, so tables inside it (e.g., the CSAT response list) may need a more compact column set than the full Responses tab uses. Specify this as a design decision for Composer to try, not a commitment here.

## 14. What stays familiar / what changes (summary)

**Stays:** everything in Concept A's "stays" list, plus: no top-level navigation change at all — a user who never opens the drawer experiences a DM that looks and behaves exactly like Concept A's.

**Changes:** one new reusable surface (the drawer) that didn't exist before; deep-link URLs become a real, usable concept for the first time; several existing modals' *detail* content relocates into the drawer (their *edit* forms may stay as modals, launched from the drawer).

**Directly solves:** the 4–7-areas problem — this is this concept's reason for existing, and the one dimension where it is evidence-backed to outperform Concept A.

**Risk this concept carries that Concept A doesn't:** a new piece of UI (the drawer) has to be built well — if it's inconsistent or slow, it's a new failure surface layered on top of an otherwise-unchanged app, rather than a refinement of something that already works.

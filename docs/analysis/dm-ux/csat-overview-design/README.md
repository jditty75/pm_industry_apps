# CSAT Overview — focused visual design (2026-10-05)

Visual-design-only. No production UI/CSS/markup/JS/config changed, no CLASP used, no deploy performed, no new preview built, no API/EDM/workbook changes. Scope: **one screen** — Deployment Manager → CSAT → Overview. Grounds in the completed architecture work in `../` (esp. `recommended-direction.md`, `concept-a-evolve-in-place.md` §3, `concept-b-deployment-centric.md`) and `docs/analysis/csat-subsystem/` (esp. `csat-ui-architecture.md`, `canonical-response-model.md`); does not re-derive or contradict either.

## Why this reset

The first broad prototype (`skills/gas-monorepo-engineer/dm-ux-concept/`, reviewed via `.\preview.ps1 DM_UX`) proved the *architecture* — five-section CSAT tab, T1/T2 gating, the deployment drawer — but its *visual execution* made the architecture impossible to evaluate on its own merits. Per `visual-review-guide.md`, **no visual approval has been recorded for that prototype.** This phase does not touch it, does not redesign the rest of Deployment Manager, and does not build code — it produces a visual specification Composer can implement next as three narrow, stable preview pages.

The broad prototype remains available for reference and reuse of fixture/data logic. It is **superseded for visual evaluation purposes only** as of this document; see the note added to `../README.md` and `../visual-review-guide.md`.

## Visual evidence reviewed

Three screenshots (desktop, current as of 2026-10-05):

1. **Phase-1 broad prototype** — Concept B drawer open over the CSAT tab (SLG, "Mixed Portfolio" scenario). Not a visual baseline.
2. **Production DM — Deployments tab** (SLG Deployment Health Manager). Authoritative visual baseline.
3. **Production DM — current CSAT tab** (Upcoming Batches view). Authoritative visual baseline for CSAT specifically.

### What makes current production DM polished (screenshots 2–3)

- **Header card**: dark navy Workday "W" tile on the left, title + one-line subtitle, a green "data as of" freshness pill, and one or two right-aligned action controls (View as Read Only, Showing: All). Everything in one calm horizontal band — no visual noise above it.
- **Top-level tabs**: plain text, underline-only active state, no pill/box chrome, no icons. Nine tabs fit without crowding because they're just text plus one bottom border.
- **Context banner**: a single, restrained left-accented (blue) info banner directly under the tab row, one line, one icon, explaining what the current view is for. Exactly one of these per screen — it is the only "chrome" allowed above the content.
- **KPI cards are not uniform**: on Deployments, TOTAL/RED/YELLOW are three cards of *unequal semantic weight* (a neutral total, two status-colored counts) distinguished only by a 3px colored top border — not a filled background, not a badge, not an icon. The number is the entire visual payload; the label is small, uppercase, muted gray underneath.
- **Secondary callouts use color intentionally**: a purple-left-accented banner for "KPI context" (overrides), distinct from the blue info banner — color is reserved for a small number of specific meanings, never decorative.
- **Filters are two-tier, not one giant bar**: a single row of a search box + toggle/pill filters (Health: Red ×, Yellow ×, Green, ⚠ Executive Watch) + an Owner dropdown + "Advanced Filters" + "Clear filters" — then, only if filters are active, a second **"ACTIVE:"** row shows them back as removable chips. Nothing is shown unless it's either a control or an applied state.
- **Tables are dense and quiet**: small uppercase gray column headers, colored status pills only in the one column where status is the point, hyperlinked primary identifiers, an expand chevron per row, a compact "META INFO" column carrying secondary metadata (who/when) in small gray text. No zebra striping, no heavy borders, no card-per-row.
- **The current CSAT tab already demonstrates the right instincts at smaller scale**: segmented toggles (3 Months/6 Months, All/MDS/PGL) styled as a compact dark-filled control, date-grouped sections with inline milestone pills (Open/R1/R2/Close with dates), a category sub-header, then a dense table. This is the existing visual grammar the new Overview must extend, not replace.

### What degraded the Phase-1 prototype (screenshot 1)

- **Three layers of prototype chrome stacked at once**: a full-width dark "PROTOTYPE CONTROLS" bar with five dropdowns, a second full-width amber-text banner repeating "LOCAL UX PROTOTYPE..." immediately below it, *and* a persistent badge in the corner. Production allows exactly one banner, ever. This prototype used three bands of non-application chrome before any real content appeared — easily a sixth of the viewport height before the app starts.
- **The drawer visually dims the entire app behind it as if it were a modal**, even though the architecture (`concept-b-deployment-centric.md` §12) recommends a *non-modal* panel where background content stays visibly present and interactive. The scrim makes it look and feel modal regardless of the underlying intent, which contradicts the "keeps its place, doesn't block the rest of the app" premise the architecture is selling.
- **The drawer is oversized relative to its content density**: ~42–45% of the viewport for a timeline that is really a short bulleted list. Production's density instinct (compact cards, small type, tight row height) is absent here — the timeline rows use inconsistent bold/regular weight with no grouping, reading as a flat list rather than a structured chronology.
- **Too many simultaneous navigation tiers**: top-level tabs, CSAT sub-tabs (Overview/Survey Tracking/Responses/Customer Feedback/**AI Insights (future)**), *and* the drawer's own internal tabs (Summary/Timeline/CSAT/Notable/Overrides) are all visible on screen together — three tiers compete for the eye at once, worse than the "inconsistent secondary nav" problem the discovery originally flagged.
- **"AI Insights (future)" renders as a persistently visible, if greyed-out, fifth sub-tab.** The brief for this phase explicitly rules this out (§4 below) — a disabled tab that's always present is still a navigation element demanding to be read and dismissed on every visit.
- **Net effect**: the prototype does not look like an evolution of production DM. It looks like a different, less finished application wearing DM's color token in a few places. This is a visual-execution failure, not evidence against the underlying architecture.

## What this phase does and does not do

**Does**: specify, at wireframe precision, three alternative visual compositions for CSAT → Overview only, each a natural evolution of the current DM visual language identified above; recommend one; specify a narrow Composer handoff to build three static/interactive comparison pages.

**Does not**: redesign Deployment Manager as a whole; touch production CSS/markup/JS; modify the existing broad prototype; design the deployment drawer, Survey Tracking, Responses, or Customer Feedback in detail (only their entry points from Overview); write code; change CLASP/deploy state.

## CSAT Overview's job

Answer, in order: **"How are customers experiencing our deployments?"** then **"Where should I investigate?"** It is a landing summary that earns a drill-through, not an exhaustive display of every field in `csat-response-v1` (`canonical-response-model.md`). Assumes the familiar DM shell and a restrained CSAT sub-nav: **Overview | Survey Tracking | Responses | Customer Feedback** (per `concept-a-evolve-in-place.md` §3) — "Future AI" either omitted entirely from this pass or rendered as a single subtle, non-greyed marker per composition's own call (see each doc), never a persistent disabled tab.

## Metric semantics this design respects

From `canonical-response-model.md` §2 and `csat-ui-architecture.md` §2 — binding across all three compositions:

- **Overall Satisfaction** is the only cross-survey headline number. **PGL Satisfaction** and **MDS Satisfaction** are survey-specific and are never averaged into each other or into Overall.
- **NPS** is PGL-only, shown only at **n ≥ 10** (stricter than the general n<5 suppression floor), otherwise a "low n" treatment.
- **Product Area** is multi-valued per response; per-area counts are non-additive and must be labeled "responses touching area," never a plain count that implies a portfolio total.
- Blank is null, never rendered as zero.
- Aggregate cells with **n < 5** render the literal treatment `n<5`, styled as part of the application (a neutral, muted pill with an info affordance), never hidden or shown as 0.
- Overview is **T1-only**: scores, counts, trends, and deployment/area references. No customer comment text, no per-response free text, no respondent identity. Where a deployment's attention-worthiness is partly evidenced by negative feedback, Overview may reference *that a comment exists* (a non-content indicator) but never its content — opening it is explicitly a T2 action handled outside this screen.

## Contents of this folder

| Doc | What it covers |
|---|---|
| [overview-a.md](overview-a.md) | Composition A — Executive signal first |
| [overview-b.md](overview-b.md) | Composition B — Balanced operational analytics |
| [overview-c.md](overview-c.md) | Composition C — Investigation first |
| [comparison.md](comparison.md) | Preserved/Evolved/New/Removed per composition, recommendation, accessibility, future Workday-brand opportunities |
| [composer-preview-spec.md](composer-preview-spec.md) | Narrow Composer handoff: three static pages, minimal chrome, one synthetic dataset, exact screenshot states |

## Approval chain

Unchanged from `preview-concept-spec.md` §11: this document and its siblings → Composer builds the three narrow Overview previews → Jeff reviews screenshots at 1440×900 → iteration → explicit **CSAT OVERVIEW VISUALLY APPROVED** → only then does the deployment drawer, Responses, Customer Feedback, or any production implementation get designed/built. Nothing here authorizes a next step beyond this visual spec.

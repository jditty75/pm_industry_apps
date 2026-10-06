# Deployment Manager UX discovery & design concepts (2026-10-05)

Evidence-only audit of the Deployment Manager (DM) family design versus the Workday-oriented design material in the repo, plus a follow-on design-concept phase. **No production/runtime UI, CSS, markup, JS, config, or deploy pipeline changes.** Non-sensitive; source paths referenced, CSS not duplicated. The concept phase is design-only — screenshots/previews are built by a separate Composer pass per `preview-concept-spec.md`, not committed here.

## Discovery documents (load progressively)

| Doc | Read when |
|-----|-----------|
| [original-workday-assets.md](original-workday-assets.md) | You need to know what "original Workday assets" actually exist, and their provenance |
| [current-design-system.md](current-design-system.md) | You need the real CSS/token/component architecture of DM and its consistency/drift |
| [current-vs-original.md](current-vs-original.md) | Matrix comparison, migration mapping, adopt / don't-adopt, accessibility |
| [information-architecture.md](information-architecture.md) | Superset tabs, per-app reduction, flat-tab scalability, deployment-as-object |
| [csat-ux-requirements.md](csat-ux-requirements.md) | CSAT user tasks and security-shaped UI boundaries |
| [design-opportunities.md](design-opportunities.md) | Preserve list, ranked opportunities, direction recommendation, next design phase |
| [preview-strategy.md](preview-strategy.md) | What the localhost preview can/can't prototype today |

## Design-concept documents (2026-10-05, follow-on phase)

Grounded in the discovery above and in `docs/analysis/csat-subsystem/`; does not redo either.

| Doc | Read when |
|-----|-----------|
| [concept-a-evolve-in-place.md](concept-a-evolve-in-place.md) | Best-possible version of today's flat-tab shell; lowest-risk baseline every other concept builds on |
| [concept-b-deployment-centric.md](concept-b-deployment-centric.md) | Adds a persistent, deep-linkable deployment-detail drawer on top of Concept A |
| [concept-c-grouped-navigation.md](concept-c-grouped-navigation.md) | Challenges the flat shell with grouped/hierarchical top nav, for scalability |
| [concept-comparison.md](concept-comparison.md) | Scored matrix (STRONG/MODERATE/WEAK) across familiarity, density, scalability, CSAT fit, deployment context, consistency, a11y, complexity, risk, maintainability, growth |
| [recommended-direction.md](recommended-direction.md) | Recommendation (Concept B on Concept A's baseline), what's gained/preserved/changed, decisions needed from Jeff |
| [preview-concept-spec.md](preview-concept-spec.md) | Handoff spec for Composer: page structure, fixtures, states, deep links, T1/T2 and token-treatment toggles, visual-review screenshot matrix |
| [visual-review-guide.md](visual-review-guide.md) | Launch command, controls, review sequence, stable URLs, checklist, approval phrase |

## Focused visual-design follow-on (2026-10-05)

| Doc | Read when |
|-----|-----------|
| [csat-overview-design/README.md](csat-overview-design/README.md) | The architecture above is approved in principle, but the Phase-1 prototype's *visual execution* needs a reset — a narrower CSAT → Overview-only visual spec, grounded in current production DM screenshots, with three alternative compositions for Jeff to compare |

## CSAT product model reset (2026-10-05)

| Doc | Read when |
|-----|-----------|
| [csat-product-model/README.md](csat-product-model/README.md) | **Current CSAT direction (approved 2026-10-06).** What CSAT should tell a DM user: question hierarchy, metric semantics, MDS→PGL journey, attention taxonomy, information hierarchy, navigation (Overview / Responses / Survey Operations), workflows, next visual-design handoff |

The focused Overview compositions A/B/C in `csat-overview-design/` are **rejected for visual/information design — superseded by approved product model.** They are retained for reference.

## CSAT Overview v2 — single design (2026-10-06)

| Doc | Read when |
|-----|-----------|
| [csat-overview-v2/README.md](csat-overview-v2/README.md) | *Historical (superseded for visual design by V3).* One Overview from the approved product model: Workday-led default lens with partner-led/all-deployments context, satisfaction + evidence unit, explainable risk, delivery ratings, journey, seven states, drill-down map, Composer handoff for seven static pages |

## CSAT reconciled architecture — VoC guidebook × deployment-centric DM (2026-10-06)

| Doc | Read when |
|-----|-----------|
| [csat-reconciled-architecture/README.md](csat-reconciled-architecture/README.md) | **Current CSAT architecture (product-approved for visual design, J1–J6 approved 2026-10-06).** Reconciles the VoC *PGL and MDS Deployment Surveys Guidebook* with the CSAT data foundation: survey lifecycle (prepare → in flight → responded → follow-up), Top-2 Box / Detractor rules, deployment and portfolio CSAT models, SFDC/Qualtrics/EDM/DM boundaries, data gaps, V1 scope, navigation **Overview · Surveys · Responses**, portable DM design principles |

## CSAT Overview V3 — executive-first visual design (2026-10-06)

| Doc | Read when |
|-----|-----------|
| [csat-overview-v3/README.md](csat-overview-v3/README.md) | **Current CSAT Overview design.** One executive-first Overview on the approved reconciled architecture (J1–J6): a deterministic Top-2 Box message, named customer concerns, the survey horizon (prepare-by, readiness, in flight, chase), a quiet learning row, eight states, drill-down map, Composer handoff for eight static pages |

The reconciled architecture is now **product-approved for visual design**. `csat-overview-v2/` is **superseded for visual design by the reconciled architecture / V3** and retained for history.

## CSAT Surveys — deployment-centric operational design (2026-10-06)

| Doc | Read when |
|-----|-----------|
| [csat-surveys-design/README.md](csat-surveys-design/README.md) | **Current CSAT Surveys design.** The operational survey lifecycle (prepare → in flight → responded / closed → follow-up) as one lifecycle-ordered surface — no internal tabs: scope + filter bar, a dense horizon line, three phase groups (Upcoming · In Flight · Recent), a deployment × survey row, five distinct attention kinds (Prepare now · Can't forecast · Chase now · Delivery problem · Follow-up expected) that are never summed, 1440×900 composition, eight states, future-data requirements, Composer handoff |

Applies the approved reconciled architecture and the provisional V3 visual vocabulary to **Surveys**. Design-only; the prototype handoff lives in [csat-surveys-design/composer-preview-spec.md](csat-surveys-design/composer-preview-spec.md).

## CSAT integrated design — Responses · Deployment CSAT History · one subsystem (2026-10-06)

| Doc | Read when |
|-----|-----------|
| [csat-integrated-design/README.md](csat-integrated-design/README.md) | **Current CSAT integrated design — completes the subsystem end-to-end.** Designs the two unbuilt surfaces (**Responses** investigation workspace; **Deployment CSAT History** as a routed in-page deployment workspace, not the rejected drawer), the **shared CSAT component system**, final visual/component **harmonization for Overview** and horizontal-utilisation **harmonization for Surveys**, **HC/SLG/HENP** config-only behaviour, low-volume behaviour, and a minimal representative state matrix |
| [csat-integrated-design/composer-handoff.md](csat-integrated-design/composer-handoff.md) | The single build spec for the integrated, navigable CSAT prototype (shell, routing/deep-links, page specs, shared components, state fixtures, tests, Composer autonomy + 1440×900 self-review protocol, acceptance checklist) — no further Claude design prompt needed before implementation |

These two files **supersede prior CSAT *visual-design* specs for integrated implementation** (`csat-overview-v2/`, `csat-overview-design/`, and the visual-execution role of the Phase-1 concept prototype). They do **not** supersede the approved architecture (`csat-reconciled-architecture/`), the canonical data contracts (`../csat-subsystem/`), or the frozen IA of `csat-overview-v3/` and `csat-surveys-design/`, which remain authoritative inputs. Design-only; no production/EDM/workbook/API/deploy change.

Status of earlier CSAT design folders: `csat-product-model/` is **still authoritative for areas marked KEEP** in [decision-reconciliation.md](csat-reconciled-architecture/decision-reconciliation.md) (semantics, tiers, small-n rules, journey, feedback placement). It is **superseded** on headline metric, risk thresholds, navigation and hierarchy. `csat-overview-v2/` and its prototype are **historical**: the visual-language guidance is reusable, but its structure and thresholds are superseded. `csat-overview-design/` stays rejected/historical.

## Headline findings

1. **The "original Workday assets" are brand-guideline docs plus recipes, not a UI kit.** No CSS file, HTML template, component library or screenshots exist in the repo. The core of Chris's skill (`SKILL.md` Steps 1-6: skeleton, tokens, "Cards and surfaces", gradient library) is **absent**; surviving references still point at it.
2. **Current DM is a distinct, coherent-in-spirit but Workday-light system**: slate neutrals, deep blue `#0F4C81`, system font stack, 14px dense base, card+strip header with the white Workday "W" mark, and one orange `#F46821` accent. It does **not** use Archivo, Ballpoint `#0057AE`, Keyboard cream, or the brand palette.
3. **Original material is mostly marketing/brand-oriented** (hero gradients, horizon curves, 22px root type). Only a few ideas fit a dense operational tool.
4. **DM already has a token layer but drift is real**: 99 distinct hex colours in one 4.3k-line stylesheet, undefined `var()` references, 3 `:root` blocks, ~20 KPI/card variants, 21 pill and 25 chip classes.
5. **Navigation is already two-level in several places** with three different secondary-nav idioms (segmented control, `csat-subtab-nav`, Portfolio views). CSAT is the third tab to need it; the problem is *inconsistency*, not tab count.
6. **Recommendation: evolve (option B/D hybrid)** — keep the DM system, consolidate tokens, fix a11y gaps, standardise secondary nav and a reusable deployment-detail surface, and selectively adopt Workday tokens (Ballpoint, Ink, status semantics) only where a decision is made.

Provenance vocabulary: `ORIGINAL_SKILL_ASSET`, `CURRENT_DM_IMPLEMENTATION`, `SHARED/ADAPTED`, `LEGACY/UNUSED`, `UNKNOWN_PROVENANCE`.

Verification stance: static source analysis only. No browser inspection or live Apps Script run was performed; contrast ratios are computed from hex values, not WCAG compliance claims.

## Design-concept phase outcome

Three concepts were produced (Evolve in place / Deployment-centric / Grouped navigation); recommendation is Concept B built on Concept A's baseline fixes — see `recommended-direction.md`. **Phase 1 localhost prototypes** are implemented under `skills/gas-monorepo-engineer/dm-ux-concept/` — launch with `.\preview.ps1 DM_UX` (see [visual-review-guide.md](visual-review-guide.md)). No visual approval has been recorded yet.

**Superseded for visual evaluation (2026-10-05):** the Phase-1 prototype's visual execution (prototype-chrome weight, drawer sizing/scrim, competing navigation tiers) is no longer used as a visual baseline — review feedback found it looked substantially less polished than production DM and made the underlying architecture hard to judge on its own merits. The prototype itself, its fixtures, and its architecture (Concept B, the drawer, the five-section CSAT tab) remain valid and are not discarded — only its visual comparison role is superseded. A narrower visual-design pass for CSAT → Overview only now lives in [csat-overview-design/](csat-overview-design/README.md), grounded in screenshots of current production DM rather than the prototype's own styling.

**Evidence (SLG Responses storage canary):** Responses source 177; SLG routed 28; 26 stored; 2 excluded by deployment-universe eligibility; idempotent re-runs; `CSAT_Responses` present in SLG. Prototype fixtures remain synthetic and are not sized to the canary row count.

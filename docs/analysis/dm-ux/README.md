# Deployment Manager UX discovery (2026-10-05)

Evidence-only audit of the Deployment Manager (DM) family design versus the Workday-oriented design material in the repo. **No redesign, no source/CSS/config/preview changes.** Non-sensitive; source paths referenced, CSS not duplicated.

## Documents (load progressively)

| Doc | Read when |
|-----|-----------|
| [original-workday-assets.md](original-workday-assets.md) | You need to know what "original Workday assets" actually exist, and their provenance |
| [current-design-system.md](current-design-system.md) | You need the real CSS/token/component architecture of DM and its consistency/drift |
| [current-vs-original.md](current-vs-original.md) | Matrix comparison, migration mapping, adopt / don't-adopt, accessibility |
| [information-architecture.md](information-architecture.md) | Superset tabs, per-app reduction, flat-tab scalability, deployment-as-object |
| [csat-ux-requirements.md](csat-ux-requirements.md) | CSAT user tasks and security-shaped UI boundaries |
| [design-opportunities.md](design-opportunities.md) | Preserve list, ranked opportunities, direction recommendation, next design phase |
| [preview-strategy.md](preview-strategy.md) | What the localhost preview can/can't prototype today |

## Headline findings

1. **The "original Workday assets" are brand-guideline docs plus recipes, not a UI kit.** No CSS file, HTML template, component library or screenshots exist in the repo. The core of Chris's skill (`SKILL.md` Steps 1-6: skeleton, tokens, "Cards and surfaces", gradient library) is **absent**; surviving references still point at it.
2. **Current DM is a distinct, coherent-in-spirit but Workday-light system**: slate neutrals, deep blue `#0F4C81`, system font stack, 14px dense base, card+strip header with the white Workday "W" mark, and one orange `#F46821` accent. It does **not** use Archivo, Ballpoint `#0057AE`, Keyboard cream, or the brand palette.
3. **Original material is mostly marketing/brand-oriented** (hero gradients, horizon curves, 22px root type). Only a few ideas fit a dense operational tool.
4. **DM already has a token layer but drift is real**: 99 distinct hex colours in one 4.3k-line stylesheet, undefined `var()` references, 3 `:root` blocks, ~20 KPI/card variants, 21 pill and 25 chip classes.
5. **Navigation is already two-level in several places** with three different secondary-nav idioms (segmented control, `csat-subtab-nav`, Portfolio views). CSAT is the third tab to need it; the problem is *inconsistency*, not tab count.
6. **Recommendation: evolve (option B/D hybrid)** — keep the DM system, consolidate tokens, fix a11y gaps, standardise secondary nav and a reusable deployment-detail surface, and selectively adopt Workday tokens (Ballpoint, Ink, status semantics) only where a decision is made.

Provenance vocabulary: `ORIGINAL_SKILL_ASSET`, `CURRENT_DM_IMPLEMENTATION`, `SHARED/ADAPTED`, `LEGACY/UNUSED`, `UNKNOWN_PROVENANCE`.

Verification stance: static source analysis only. No browser inspection or live Apps Script run was performed; contrast ratios are computed from hex values, not WCAG compliance claims.

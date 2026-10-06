# Current DM vs original Workday assets

Original = `visual_guidelines.md` + `webapp-design.md` + gradient/horizon recipes (brand guideline, not UI kit). Current = `libraries/DepMngr/src/CoreUI_Css.js`. Classes: CURRENT_DM_STRONGER / ORIGINAL_ASSET_STRONGER / ROUGHLY_EQUIVALENT / DIFFERENT_GOALS / INSUFFICIENT_EVIDENCE.

## Matrix

| Area | Original | Current DM | Class | Why |
|------|----------|-----------|-------|-----|
| Primary colour | Ballpoint `#0057AE` (7.06:1 on white) | `#0F4C81` (8.86:1) | ROUGHLY_EQUIVALENT | Both deep blue; DM darker/less saturated; not the brand hex |
| Ink / text | Ink `#0F2E66` (13.1:1) | slate `#0F172A` text, `#475569` muted | DIFFERENT_GOALS | Original uses navy text; DM uses neutral slate, better for dense data; navy would tint every table |
| Accent | Thumbtack `#FC5B05`, Lunch Break `#FEC10B`, "orange leads forward movement" | Orange `#F46821` only for Executive Watch | ORIGINAL_ASSET_STRONGER (for brand character) | DM has almost no warm accent; but orange-as-status would collide with yellow/red health |
| Neutrals / bg | Paper white, Keyboard cream `#FCF8E8`, Business Card `#F1F3F6` | `#F8FAFC` page, white cards | ROUGHLY_EQUIVALENT | Cream is warmer; cool grey reads cleaner under data |
| Borders/shadows | Guideline silent (presentation: "no drop shadows") | 3 token shadows, 1px borders | INSUFFICIENT_EVIDENCE | |
| Status colours | Not defined (secondary palette is for charts) | green/yellow/red bg+fg triplets; AA-checked pairs 6.4-6.8:1 | CURRENT_DM_STRONGER | Original has no semantic status system |
| Font | **Archivo** (all web apps) | System stack | ORIGINAL_ASSET_STRONGER for brand; DM stronger for load/CDN-free; DIFFERENT_GOALS | Archivo adds Google Fonts dependency; GoLives already loads it |
| Type scale | 1em=22px root; Body 2 0.85em | 14px root, 10-13px common, no scale | DIFFERENT_GOALS | Original root is marketing-sized; unusable for tables. DM lacks any scale though (drift) |
| Heading hierarchy | H1-H6 defined | h1 20px, modal h2 15px, section titles ad hoc | ORIGINAL_ASSET_STRONGER (as a reference ladder only) | |
| Table type | None | 11-12px uppercase headers, 13px cells | CURRENT_DM_STRONGER | Original has none |
| Layout/shell | Grids by % margins, horizon containers | Sticky header card + 1400px container + flat tabs | DIFFERENT_GOALS | Original targets pages/posters |
| Navigation | None | flat tabs + seg controls + subtab nav | CURRENT_DM_STRONGER (by default) | No original guidance |
| Buttons | Primary Ballpoint/white; Secondary underlined text; Tertiary outlined | primary filled / secondary outlined / destructive | CURRENT_DM_STRONGER | Underlined-text secondary reduces affordance in dense toolbars |
| Cards | "No left-border accent stripes" (webapp-design) | cards with radius 8-16; override cards use `border-left:4px #4338CA` | ORIGINAL (rule) vs DM (practice): conflict | DM violates the rule in override/risk cards; low priority |
| Tabs, filters, inputs, chips, modals, alerts, empty states | None | Implemented | CURRENT_DM_STRONGER | Absence of original coverage |
| Icons / logo | Dub/logo rules; 754 Drive icons, 2px stroke, horizon curve | Inline white "W" mark in blue strip; emoji refresh glyphs; text/CSS icons | ORIGINAL_ASSET_STRONGER (catalog) | Guideline: don't place logo inside other shapes; DM places W on a solid strip (a recognised, acceptable-looking variant but unvalidated) |
| Hover/focus/selected | Not defined | hover on rows/tabs; `.active` states; 1 `:focus-visible` | INSUFFICIENT_EVIDENCE / DM weak | |
| Progressive disclosure, dense interaction | None | filter chips + More-filters drawer, expandable rows, popovers | CURRENT_DM_STRONGER | |
| Gradients / horizon | Detailed recipes | None | DIFFERENT_GOALS | Hero/marketing devices |
| Accessibility guidance | AA-safe pair table; gradient contrast rule | Ad hoc | ORIGINAL_ASSET_STRONGER (as method) | The pair table is small but useful |

## What migrated from the original into DM

| Pattern | Original | Current DM | Relationship |
|---------|----------|-----------|--------------|
| Workday W/Dub mark | Dub = "w" + arc; white colourway on dark | Inline SVG, white, in blue strip | ADAPTED (mark is the real glyph; background is DM blue, not Ink/After Hours; no clear-space system) |
| Primary blue | Ballpoint `#0057AE` | `#0F4C81` | PARALLEL, not derived; no hex match |
| Orange accent | Thumbtack `#FC5B05` | `#F46821` | SIMILAR, no evidence of derivation; 3.07:1 on white |
| Neutrals | Business Card/Desk/Staple/Laptop | Slate scale | NOT derived |
| Font | Archivo | System stack | NOT adopted (GoLives did adopt) |
| Buttons | Primary blue filled | `.btn-primary` | Convergent (generic web convention) |
| Cards/radius/shadows | none specified | tokens | CURRENT_DM only |
| Status | none | green/yellow/red | CURRENT_DM only |
| Tab/table/filter patterns | none | all | CURRENT_DM only |

**Conclusion**: Workday character in DM is carried by the W mark, the deep blue and one orange; little else traces to the original assets. The earlier-stated belief that "substantial Workday styling" was incorporated is true at the *impression* level (blue, W mark, clean surface) but not at the *token* level.

## If original assets were applied more literally, visibly:
1. Archivo replaces system font (slightly wider letterforms; table columns need re-fitting; external font request from `fonts.googleapis.com`).
2. Header strip/links/active tab move from `#0F4C81` to Ballpoint `#0057AE` (brighter blue).
3. Text moves from slate to navy Ink; page background could move to cream Keyboard/Paper.
4. Secondary buttons become underlined text; hero gradient/horizon curves would appear (on Overview only, if at all).
5. Body size would jump toward the 22px root unless re-derived. Result: lower density, more scrolling in tables. Net: more branded, less operational.

## Candidates worth reconsidering

| Candidate | Problem it solves | Replaces | Fit for dense desktop |
|-----------|-------------------|----------|----------------------|
| Brand palette as the *source of truth for tokens* (Ballpoint/Ink/Water Cooler/Blue Sky) | DM blue is un-sourced; ties DM to Workday identity; Ink/After Hours give dark option | `--color-primary*`, off-token blues (`#1A73E8`, `#E8F0FE`) | Yes, a value swap behind existing tokens; verify contrast |
| Safe colour-pair table + contrast method | No contrast rules for new features | Ad hoc colours | Yes |
| Archivo for headings/KPI numerals only | Brand voice with minimal density impact | System font in H1/KPI values | Partial; needs a licensing/CDN decision |
| Type ladder (relative to a 14px root) | 30 font sizes, no scale | rem/px sprawl | Yes if re-based, not the 22px root |
| Spacing scale in 2px steps | Already approximated by `--space-*` | none | Low value |
| Icon catalog (Drive) | DM uses emoji/text glyphs for refresh/status | Emoji (`&#x1F504;`) | Yes for few chrome icons; cached SVG load cost; Drive access needed |
| Secondary-palette chart colours | Charts use ad hoc hex in JS | JS hex literals | Yes, if status colours stay separate |
| Gradient progress fill | Optional polish | flat bars | Low value |

## Not recommended for adoption
- 22px root type scale / Large Headline sizes (density loss).
- Gradient hero, horizon curves, glow gradients (marketing; guideline caps horizon use to one per page; zero operational value).
- Underlined-text secondary buttons (weaker affordance in toolbars).
- Cream Keyboard as page background (conflicts with status-colour legibility; DM users like current look).
- Photography/illustration rules, co-brand lockups (not applicable).
- Wholesale Archivo adoption without a font-loading/perf decision.
- The "no left-border accents" rule applied retroactively (cosmetic churn; optional later).

## Accessibility / usability (computed, not formally audited)

| Item | Finding |
|------|---------|
| Text contrast | Primary on white 8.86:1; muted `#475569` 7.2:1 OK. **`--color-text-subtle #94A3B8` is 2.56:1 on white** (used 17x for placeholder/captions: fails AA). `#64748B` 4.76:1 passes. Orange `#F46821` 3.07:1 fails for small text (used as Exec Watch KPI value and borders). |
| Status | Pills use bg+fg pairs 6.4-6.8:1 and text labels; bare `#10B981`/`#F59E0B` are 2.5/2.2:1 on white (dots/bars: need non-colour cue). Health shown in words in most tables, but charts/dots rely on colour. |
| Focus | 1 `:focus-visible` rule (Escalations rows); search input sets `outline:none` with only background change; most buttons rely on UA default focus ring (acceptable) but form inputs have custom `:focus`. |
| Keyboard | Primary tab bar has no tablist semantics or arrow keys; CSAT subtab nav has `role=tab` + `aria-selected` but no roving tabindex; 131 inline `onclick` on buttons (keyboard-accessible) but clickable table rows depend on JS. Escape closes modals (4 handlers). |
| Modals | `aria-modal` appears 5x in markup; no `role=dialog` found in markup; no focus trap or return-focus evidence; slide animation with no `prefers-reduced-motion`. |
| Forms | 96 `<label>` elements but 0 `for=` attributes found by static search (labels probably wrap or are visual only; unverified). |
| Tables | 22 `<table>` / 147 `<th>`; no `scope`, no `aria-sort` for sortable headers (Go Lives sortable). |
| Density | 10-11px text x103 uses (captions, pills, uppercase headers) is a readability risk; 9px used 5x. |
| Targets | Compact buttons/pills 18-24px tall; adequate for desktop mouse, below 24px for some chips. |

These are risks inferred from source; no assistive-technology testing, no browser run, no WCAG conformance claim.

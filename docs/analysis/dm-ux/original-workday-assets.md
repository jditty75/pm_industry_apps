# Original Workday-oriented assets: inventory and provenance

Scope searched: `skills/gas-monorepo-engineer/**`, `solutions/**`, `libraries/**`, `docs/**`, `config/**`, `.preview-out/` (gitignored). Git history of the skill: single import commit `17eea8f` (2026-10-02, "skill V2"); `SKILL.md` was later rewritten (`3af1e99`, `3556276`) as a deploy/Git operator skill.

## What exists

| Asset | Path | Content | Provenance |
|-------|------|---------|-----------|
| Visual guidelines | `skills/gas-monorepo-engineer/references/visual_guidelines.md` | Brand identity: logo/Dub rules, **Archivo** type scale (1em root = 22px), 10-colour core + 9 secondary palette (hex), gradients, photo/illustration/icon rules, web button rule (Primary Ballpoint/white, Secondary underlined, Tertiary outlined), WCAG-AA safe pairs | ORIGINAL_SKILL_ASSET (brand-marketing oriented) |
| Web app builder reference | `references/webapp-design.md` | GAS constraints, Drive brand-asset serving, `.brand-icon` CSS, rules ("Archivo, no left-border accent stripes, no system fonts") | ORIGINAL_SKILL_ASSET, **truncated**: titled "Original GAS Web App Builder Reference", references "skeleton above" and "Step 3" that do not exist |
| Gradient recipes | `references/gradients-in-apps.md` | Gradient hero, gradient headline, progress-fill; stops e.g. `workday-go-night-crop-4` | ORIGINAL_SKILL_ASSET; refers to missing SKILL.md Step 3 "gradient library" |
| Horizon curves | `references/horizon-curves.md` | SVG arc section dividers; "one horizon moment per page" | ORIGINAL_SKILL_ASSET |
| Icon/logo catalog | `references/wday-icons-logos.csv` | 754 rows: filename, Google Drive File ID, type (`wd-accent-*.svg`...). Files live in Drive, not repo | ORIGINAL_SKILL_ASSET (assets not inspectable offline; Drive IDs not copied here) |
| Legacy preview | `scripts/preview.py` | Four-file app compiler (`index/styles/scripts.html`); `--lint` enforces rules from missing SKILL.md sections | ORIGINAL_SKILL_ASSET, legacy; current DM uses `preview_engine.py` |
| GoLives apps | `solutions/{HC,HENP,SLG}_GoLives/src/Index.html` | Single-file apps with Workday palette vars and Archivo via Google Fonts | UNKNOWN_PROVENANCE: likely skill-derived, but **palette differs** from the guideline (see below) |
| PS_SPA | `solutions/PS_SPA/src/Index.html` | Same shifted palette, system font | UNKNOWN_PROVENANCE |
| SLG_Capacity | `solutions/SLG_Capacity/src/Stylesheet.html` | 179 KB, system font, own green/amber palette | CURRENT_IMPLEMENTATION of a different app; no Workday token use found |

## What does NOT exist

- No CSS/HTML template files, component library, example app, screenshot/image or design-token file from the skill.
- No SKILL.md Steps 1-6 content (skeleton, token block, "Cards and surfaces", gradient library, lint rule source). Recoverable only if Jeff/Chris still have the original skill bundle; **not in Git history**.
- No guidance for dense tables, filters, tabs, modals, forms, empty/loading/error states, or desktop-operational density. `visual_guidelines.md` is silent on them; its only component guidance is the web-button rule.

## Palette discrepancy (provenance flag)

Guideline hex (`visual_guidelines.md`) vs GoLives/PS_SPA variables:

| Name | Guideline | GoLives/PS_SPA |
|------|-----------|----------------|
| Ballpoint | `#0057AE` | `#0875C1` |
| Ink | `#0F2E66` | `#0A3D7C` |
| After Hours | `#022043` | `#0B1E3F` |
| Thumbtack | `#FC5B05` | `#D6371E` (red-orange) |
| Paper | `#FFFFFF` | `#FDFCF7` |

So the GoLives family uses a *variant* of the Workday palette. Either an earlier skill version or hand-tuned values. **Do not call either "the Workday standard" without Jeff/Chris confirming**; the guideline file is the only documented source.

## Rule status in DM

`webapp-design.md` demands Archivo and brand palette "unless the user explicitly overrides". DM does neither (see current-design-system.md). Its header comment says Phase 1/2 design was "Approved by Jeff in Phase 2 Design Brief ... 2026-06-09", i.e. an explicit override by design approval.

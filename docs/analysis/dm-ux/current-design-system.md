# Current Deployment Manager design system (as implemented)

All six apps share one UI implementation in `libraries/DepMngr/src/`; each app contributes only config and a thin shell (`solutions/<APP>_DM/src/WebApp.html` injects `CoreLib.CoreUI.getStylesheet()`, `getAppShell(APP_CONFIG)`, `getJsBundle()`). Classification: CURRENT_DM_IMPLEMENTATION.

| Layer | File | Size |
|-------|------|------|
| CSS (string array, one stylesheet) | `CoreUI_Css.js` | 4,267 lines, ~1,130 selectors |
| Markup (server-rendered shell + tab/modal builders) | `CoreUI_Markup.js` | 2,799 lines |
| Client JS bundle (string) | `CoreUI_Js.js` | 11,555 lines |
| Orchestrator | `CoreUI.js` | |

Layer: tokens → base → components → feature blocks. No build step; no CSS files; styles ship as one `<style>`.

## Shell
- **Header card** (`.header`): sticky, white card, radius 16, shadow; left 48px blue strip with white Workday "W" mark SVG (inline, `CoreUI_Markup.js` `_CoreUI_Markup_workdayWMarkSvg_`), title 20px/600 + subtitle 12px, freshness badge, right region (View-as, personalization mode, product selector).
- **Container**: `max-width:1400px`, centred; section blocks inside some tabs use `max-width:1200px` (5 places) — mixed widths.
- **Tab bar** (`.tabs/.tab`): flat underline tabs, 14px/500 muted → active 600 primary + 2px bottom border. Buttons only; **no `role=tab`, no `aria-selected`, no keyboard arrow handling** on the primary tab bar.
- Tab titles from config; "Executive Summary" + "Monthly Report Preview" merge into one **Reporting** tab with a segmented control.
- Banners: welcome, full-portfolio indicator, view-as-read-only, Student cross-tab banner.

## Tokens (`:root`, `CoreUI_Css.js` ~L35)
- Colour: primary `#0F4C81` (+dark `#0A3359`, tint `#E8EFF6`), slate neutrals (`#0F172A` text, `#475569` muted, `#94A3B8` subtle, `#E5E7EB` border, `#F8FAFC` page), status green/yellow/red with bg+fg triplets (Tailwind-like). Orange `#F46821` appears only as the "Executive Watch" accent (4 uses).
- Space: 4/8/12/16/24/32/48; radius 4/8/12/16/pill; 3 shadow levels; 150/250ms transitions.
- Legacy aliases (`--primary-color`, `--text-dark`...) kept "for safety".
- **Type**: system stack (`-apple-system, Segoe UI, Roboto...`), 14px body, line-height 1.5. Tokens do **not** exist for type size, font weight, or z-index.

## Components (canonical class)
Buttons `.btn` + `-primary/-secondary/-destructive/-destructive-strong/-compact`; tables (`table`, `th` 11-12px uppercase, `.table-container`); filter bar (search box, `.filter-select`, `.filter-chip`, advanced popover/drawer); segmented control (`.seg-control`); pills/badges (`.status-pill`, `.survey-pill`, `.phased-pill`, `.ovr-pill`...); modals (`.modal-overlay/.modal/.modal-sm`, 16px radius, slide-up); form inputs (`.form-*`); toasts; spinner/loading; empty states; KPI tiles.

## Consistency analysis (measured from `CoreUI_Css.js`)

| Signal | Value | Reading |
|--------|-------|---------|
| Distinct hex colours | 99 (506 uses); `var(--` 1,367 uses | Tokens dominate, but long tail of literals |
| Most-used literals | `#E2E8F0` x44 (≈ border, but different from `--color-border #E5E7EB`), `#0F4C81` x31 (the primary, hardcoded), `#64748B` x30 (no token), `#4338CA` x16 (Override indigo), `#6D28D9`, `#1A73E8`, `#C62828`, `#F46821` | Drift: second border grey, hardcoded primary, off-token blues/reds |
| `:root` blocks | 3 (second adds override/report-exclude colours at L1414) | Feature-scoped tokens, acceptable but unmanaged |
| Undefined `var()` refs | `--color-accent, --color-bg-subtle, --color-brand, --color-brand-subtle, --color-primary-muted, --color-surface-1/2/subtle, --color-text-primary, --font-family, --radius-2` | Newer features reference a different token vocabulary that was never defined; they work only because of fallbacks |
| Font sizes | 12px x83, 11px x60, 10px x43, 13px x39, 14px x28; plus rem sizes 0.75/0.8125/0.875rem and 0.65-0.9rem oddities (30 distinct) | No type scale; mixed px/rem; 9-11px text is common |
| Radii | token (md 44, lg 16...) but literal 6px x14, 10px x6, 999px x24 beside `--radius-pill` x19 | Mostly consistent, some literals |
| Class families | `ph-*` 303 selectors (Portfolio Health), `trends-*` 163, `overview-*` 80, `csat-*` 67, `esc-*` 65, `risk-*` 55 | Per-feature namespaces replicate generic components |
| Variants | KPI/stat tiles: `kpi-card`, `stat-card`, `kpi-strip-card`, `overview-kpi-card/tile`, `csat-kpi-card`, `ph-kpi`, `ph-slide-kpi`, `esc-kpis`, `momentum-kpi-strip`, `trends-v1-stat-row` (>=10). Pills: 21 classes (`esc-pill-*` re-implements `status-pill`). Chips: 25. Modals: generic `modal` plus `risk-modal-*`, `dhp-modal-*`, `esc-modal-*` families. Empty states: 21 classes. Loading: 8. Secondary nav: `seg-control` (Reporting, Go Lives, Portfolio views), `csat-subtab-nav` (CSAT) | Multiple versions of the same component |
| Responsive | 15 `@media max-width` rules (breakpoints 500/520/640/720/768/860/900/1000) | Eight different breakpoints; desktop-first, graceful but unsystematic |
| Interaction | 36 `:hover`, 7 `:focus`, 1 `:focus-visible`, 0 `prefers-reduced-motion`/`prefers-color-scheme`; `outline:none` on search input (replaced by background only) | Focus visibility weak |
| `!important` | 8 | Low |
| Inline styles / JS colours | JS bundle: 112 hex literals, 41 `.style.` assignments (charts, status colours, `#c62828`); markup has some `style="..."` attrs (e.g., CSAT toolbar) | Colour decisions leak into JS |
| Phase history | Header comments name Phase 1 (v9) tokens, Phase 2 (v10), 3a, 3g, ESC1, Notable, CSAT V2.8 | Layered, additive growth |

**Intentional variation**: status colour semantics (green/yellow/red triplets), Override indigo `#4338CA` (a deliberate "operational marker" colour), ProductMode/Student banners, orange for Executive Watch, `modal-sm` confirm size.
**Drift**: second border grey, hardcoded primary, undefined tokens, per-feature KPI/pill/modal/empty/loading re-implementations, duplicated secondary-nav styles, inconsistent max-widths, breakpoint sprawl, `csat-subtab-badge` `#c62828` vs status-red token.

## Family divergence (app-specific UI)
Same CSS for all six. Differences come only from config:
- Header title/subtitle (`headerTitle`), tab list, per-feature flags (see information-architecture.md).
- Label divergence: SLG labels the `mgmPgl` tab **"MGM / PGL"**, HC/HENP label it **"CSAT"** (same tab id and feature).
- Tab order divergence: HC lists Trends **last**; SLG/EVI/PDX/HS put it after Portfolio.
- Latent dead tab (static analysis, not browser-verified): HC lists `trends` in `ui.tabs` with `trendsTab.enabled:false`; `_CoreUI_Markup_buildTabBar_` does not check `trendsTab.enabled` while the panel builder does, so the button likely renders without a panel.

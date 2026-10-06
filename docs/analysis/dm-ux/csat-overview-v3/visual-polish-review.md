# CSAT Overview V3 — visual polish implementation review (2026-10-06)

Status: **Implementation complete — awaiting Jeff visual approval.**

Specification: [visual-polish-spec.md](visual-polish-spec.md) (commit `40a8833`).

## Review command

```powershell
.\preview.ps1 CSAT_OVERVIEW_V3
```

Healthy default URL is printed as `serve: http://127.0.0.1:<port>/CSAT_OVERVIEW_V3_HEALTHY.html`. Index lists all eight states.

Self-test:

```powershell
python skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/preview_csat_overview_v3_selftest.py
```

## Implementation summary

| Area | What changed |
|---|---|
| Tokens / rhythm | Scoped `--csat-v3-*` on `#csat-overview-v3-app`; 16px card gaps (killed stacked `.trends-section` margin); 12px radius + subtle shadow on R1–R4 |
| Sub-nav | Production-aligned rule (`--csat-v3-rule`); removed extra `margin-top`; scope caret `aria-hidden` |
| R1 | 88px gutter lockup, no divider; 32/20/13/14 hierarchy; prose links with soft underline |
| R2 | Three-line rows, text MDS/PGL tags, pinned `csat-v3-region-foot`, concern footer left-aligned |
| R3 | Time rail (`csat-v3-rail-*`), preparation warnings (`csat-v3-prep-warning` + `<ul>`), secondary Following / In flight |
| R4 | Four-column learning strip, `csat-v3-fact-key`, evidence clause link, muted disclosure |
| Links | Five roles; hover underline only; `:focus-visible` ring |
| Badge (prototype only) | `#csat-overview-v3-app .header .freshness-badge { align-self: center }` — see [production-badge-observation.md](production-badge-observation.md) |

## Visible-text baseline

Committed before polish: `skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/fixtures/csat-overview-v3-visible-words.json`. Self-test enforces identical word sequences on all eight state pages (middle dot and arrow glyphs normalized out of tokens).

## Fixture gaps (unchanged)

Per Jeff (2026-10-06): do **not** expand fixture copy in this pass. Healthy exercises named readiness issues; Concerns / Heavy upcoming / Chase / Partner still use summary strings for some readiness rows (spec §13 O2). Revisit after Healthy visual approval.

## Chase ⚠ rule (unchanged)

Per Jeff (2026-10-06): no new escalation for “round closes within N days” in Chase state (spec §13 O3). Existing Chase copy and semantics preserved.

## Measured checks (Healthy, Playwright Chromium, local server)

Captured 2026-10-06 after implementation. Screenshot: `.preview-out/CSAT_OVERVIEW_V3_HEALTHY_1440x900.png` (gitignored).

| ID | Check | Target | Measured |
|---|---|---|---|
| M1 | R1→mid, mid→R4, R2↔R3 gaps | 16px (±1) | **16.0**, **16.0**, **16.0** |
| M2 | Mid-row bottom @ 1440×900 | ≤ 900px | **844.3** |
| M3 | R4 section top @ 1440×900 | ≤ ~850px (heading above fold) | **860.3** (title visible within 900px viewport) |
| M5 | R1 headline x = R2 deployment name x | ±1px | **169** = **169** |
| M6 | R2 / R3 footer link baselines | ±1px | **827.3** = **827.3** |

M4 (sub-nav indicator on rule) and M7 (smallest font 11px) were **not** instrumented in this pass; validate in browser. M8 (hover vs focus) verified by CSS (`:hover { outline: none }`, `:focus-visible` ring) — not manually clicked in this session.

### Desktop smoke

| Viewport | R4 section top (y) | Notes |
|---|---|---|
| 1440×900 | 860.3 | Learn region starts ~40px above viewport bottom |
| 1280×900 | 900.3 | Same composition; R4 title at fold line |

Wide desktop (≥1448px): container remains 1400px max; no additional measurement run.

## Hover / focus

Implemented in `csat-overview-v3.css` per spec §3.9 and §8. Keyboard tab through links and sub-nav recommended during visual review.

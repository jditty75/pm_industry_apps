# CSAT Surveys — localhost UX prototype

Design: [`docs/analysis/dm-ux/csat-surveys-design/`](../../../docs/analysis/dm-ux/csat-surveys-design/) (commit `c19253b`).

## Launch

```powershell
.\preview.ps1 CSAT_SURVEYS
```

Opens **Normal** by default. `-NoOpen` for CI/selftest.

```powershell
python skills/gas-monorepo-engineer/dm-ux-csat-surveys/preview_csat_surveys.py --no-open
```

Output (gitignored): `.preview-out/CSAT_SURVEYS_*.html`

## Review sequence

1. `CSAT_SURVEYS_NORMAL.html` — primary acceptance
2. `CSAT_SURVEYS_HEAVY.html`
3. `CSAT_SURVEYS_PREP.html`
4. `CSAT_SURVEYS_INFLIGHT.html`
5. `CSAT_SURVEYS_CHASE.html`
6. `CSAT_SURVEYS_RESPONDED.html`
7. `CSAT_SURVEYS_NOFORECAST.html`
8. `CSAT_SURVEYS_QUIET.html`
9. Return to Normal

Index: `CSAT_SURVEYS_INDEX.html`

## Self-test

```powershell
python skills/gas-monorepo-engineer/dm-ux-csat-surveys/preview_csat_surveys_selftest.py
```

## Visual smoke (Playwright)

```powershell
node skills/gas-monorepo-engineer/dm-ux-csat-surveys/preview_csat_surveys_visual_smoke.mjs
```

Screenshots: `.preview-out/CSAT_SURVEYS_*_1440x900.png`

# DM family local preview (M1+)

Progressive detail for `*_DM` apps. Entry: [`docs/agent/ui-preview.md`](../../../docs/agent/ui-preview.md).

## Commands

```powershell
.\preview.ps1 SLG_DM
.\preview.ps1 SLG_DM -Scenario at-risk
.\preview.ps1 HC_DM -Scenario empty -NoOpen
python skills/gas-monorepo-engineer/scripts/preview_selftest.py
```

Scenarios: `mixed-health` (default), `at-risk`, `empty`, `go-live-window`, `edge-values`, `volume`.  
Runtime override: `?scenario=at-risk` on the localhost URL (all scenarios embedded at build time).

## M1 mock runtime

- Each `google.script.run` access returns a **new** handler chain (matches GAS; required because boot fires identity, freshness, and overview in parallel).
- Mock script is injected **before** the CoreUI JS bundle; `APP_UI_CONFIG` is evaluated from real `Config_*.js` via `gas_bundle_extract.mjs ui-config`.
- Contract tests: `preview_dm_contract.py` + `preview_dm_runtime_smoke.mjs`.

## M1 mock handlers

Implemented in `preview_dm_fixtures.py` / injected by `preview_engine.py`:

- `getIdentityBoot`
- `getDataFreshnessForUI`
- `getAllDeploymentsForUI`
- `getOverviewData`

Fixtures: `skills/gas-monorepo-engineer/scripts/fixtures/dm/` (synthetic names only).

## Agent workflow

1. Edit DepMngr UI and/or `Config_*.js` / shell as needed.
2. `.\preview.ps1 <APP>_DM` with representative `-Scenario` values.
3. Confirm `validate: PASS`; inspect localhost (layout, KPIs, deployments table, overview).
4. `python skills/gas-monorepo-engineer/scripts/preview_selftest.py` for regression.
5. Git commit/push source.
6. State **`READY FOR PRODUCTION AUTHORIZATION`** — not production verification.

M2–M5 methods log a visible diagnostic and fail the handler (see `preview-data-plan.md`).

# Preview strategy assessment (no implementation)

Tooling: `.\preview.ps1 <APP>` → `skills/gas-monorepo-engineer/scripts/preview_engine.py` (generates `.preview-out/<APP>.html`, gitignored), `preview_server.py` (127.0.0.1), `preview_validate.py`, DM mocks in `preview_dm_fixtures.py` / `preview_dm_m2.py` / `preview_dm_notable.py`, config in `config/ui-preview.json` (DM = `PARTIAL`, profile `dm-depmngr-webapp`, mockProfile `dm-v1`). Plan: `docs/analysis/dm-family/preview-data-plan.md`; usage `docs/agent/ui-preview.md`, `references/ui-preview-dm.md`.

## What works today
- **Real** DepMngr CSS/markup/JS (inlined from local `libraries/DepMngr/src`), real `Config_*.js` via Node VM, per-app header/tab differences.
- **M1** mocks: identity, freshness, deployments, overview. **M2**: Go Lives + overrides with session-local writes. **Notable** mock (own module + selftest).
- Scenarios (`mixed-health`, `at-risk`, `empty`, `go-live-window`, `edge-values`, `volume`) via `-Scenario`/`?scenario=`; chainable `google.script.run` mock.
- Contract tests: `preview_dm_contract.py`, `preview_dm_runtime_smoke.mjs`, `preview_selftest.py`.

## Gaps
| Need | Status |
|------|--------|
| Redesigned shell/navigation | Shell is real code: an alternate shell cannot be previewed without editing CoreUI (out of scope here) or a **parallel prototype page** that reuses the CSS bundle; no mechanism for A/B shell variants or "concept" switch |
| CSAT Overview / Responses / Customer Feedback / deployment timeline | **No fixtures or handlers.** `getCsatTabDataForUI` is in `M3_PLUS_METHODS` (fail-loud stub); `getCsatResponsesOverviewForUI`, `getCsatResponsesPageForUI`, `getCsatResponseDetailForUI`, `getCsatDeploymentResponsesForUI`, `getCsatFeedbackPageForUI`, `getCsatAiInsightsForUI` are documented in `csat-ui-architecture.md` §8 but not implemented anywhere |
| Survey Tracking (In-Flight, Batches, Notify) | Same stub: no in-flight/batch fixtures; today's CSAT tab renders only its empty/error state |
| Fixtures | Only a synthetic Qualtrics Responses **CSV** exists (`solutions/External_Data_Manager/test/fixtures/synthetic-qualtrics-responses.csv`) plus a fixtures plan (`docs/agent/preview-csat-responses-fixtures.md`: scenarios `csat-responses-overview-aggregates`, `-detail-synthetic`, `-deployment-timeline` "not wired") |
| Role/tier tests | No role switch in preview beyond `viewAs`; need T1 vs T2 preview roles to prove the permission boundary |
| Family coverage | Preview fixtures profile all six apps; CSAT for EVI/PDX/HS needs "feature off" scenarios |
| Deployment-detail panel | No fixture for cross-feature per-deployment data (CSAT timeline + go live + overrides + notable) |
| Static prototype path | Not required if concepts are standalone HTML reusing `getStylesheet()` output |

## Requirements for visual prototyping (later, not now)
1. Choose: (a) real-code preview with new mock handlers, or (b) disposable standalone concept pages sharing the stylesheet. (b) is cheaper and keeps production code untouched while the direction is undecided; (a) is needed once a direction is chosen.
2. Add synthetic CSAT scenarios from the architecture list (`responses-none`, `mixed-mds-pgl`, `low-sat`, `multi-history`, `multi-product-area`, `with-comments`, `with-topics`, `high-volume`, `ai-placeholder`) plus in-flight/batches fixtures; fixed lorem templates; no `@`, no production strings.
3. Per-app profile toggles so SLG (full), HC/HENP (CSAT), EVI/PDX/HS (no CSAT) show shell reduction.
4. A role/tier switch (`?role=` / `?tier=`) for POWER_USER vs T2.
5. Keep preview labelled non-production; structural validation PASS is not production verification.

Not performed here: any run of preview, any code change.

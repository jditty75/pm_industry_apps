# Engineering baseline — Deployment Signal (2026-10-06)

Reconciliation of handoff vs repository at reconciliation time. Live workbook counts are **handoff-only** unless re-verified via export diagnostic or GAS editor.

## Reconciliation matrix (summary)

| Handoff claim | Repo | Tests | Config owner | CoreLib / consumer | Live evidence | Docs | Disposition |
|---------------|------|-------|--------------|-------------------|---------------|------|-------------|
| Trajectory modules in DepMngr | Present under `libraries/DepMngr/src/CoreDeploymentTrajectory*.js` | 75/75 `npm test` | `deploymentSignal` in CoreConfig | SLG enables; others default off | GAS HEAD pushed (terminal); pin 148 local | Platform docs added | **VERIFIED** (Git commit pending at reconciliation start) |
| Schema version 2 | `deploymentSignal.schemaVersion` default 2 | Sheet-write tests | SLG + CoreConfig | — | — | domain doc | **VERIFIED** |
| SLG-only pilot | Only `Config_SLG.js` has `enabled: true` | — | SLG | — | — | README | **VERIFIED** |
| Exec Summary untouched | No trajectory refs in `CoreExecSummary.js` | — | — | — | — | — | **VERIFIED** |
| PF History connector tab | Reader in `CoreDeploymentTrajectory` | Schedule tests | SLG sheet name | — | Handoff 923 rows | — | **LIVE_NOT_VERIFIED** |
| Runtime counts (184 / 781 / …) | Diagnostics logged in refresh summary | — | — | — | Handoff only | — | **HANDOFF_ONLY** |
| CoreLib immutable includes trajectory | Not on `main` Git until commit; pin 148 in working tree | — | — | SLG `appsscript.json` 148 (uncommitted) | Requires `clasp versions` / cut | — | **REQUIRES_FOLLOW_UP** |
| Default action history sheet name | CoreConfig default `SFDC_HealthPlanActionHistory`; SLG overrides `SFDC_DHPActionHistory` | — | SLG override | — | — | — | **PARTIAL** (defaults vs SLG) |

## Git / release state (at reconciliation)

- **Git `main` (pre-commit):** trajectory implementation **untracked**; SLG/DepMngr **modified** not committed.
- **Tests:** `libraries/DepMngr` → **76** tests pass (75 trajectory suite + PF export analysis).
- **Latest fleet pin on `main` commit:** CoreLib **146** (per `deployments.md` 2026-10-05).
- **Working tree SLG pin:** **148** — trajectory must ship in a **new immutable library version** before non-SLG consumers pin it; do not assume 148 contains trajectory without version audit.
- **SLG live library:** `clasp push` to DepMngr HEAD occurred same session; consumer calls `CoreLib.CoreDeploymentTrajectory` only if pinned version includes those files.

## Production mutations this pass

None authorized. No connector, trigger, Script Property, or Exec Summary changes.

## Diagnostics tooling

`node scripts/diagnose-deployment-trajectory-pf-history.js` with gitignored CSV exports — see [human-validation-package.md](./human-validation-package.md).

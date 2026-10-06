# LLM Context Assembler (architecture only — not implemented)

## Problem

`Deployment_Trajectory` is optimized for analytical completeness (~many columns). Sauna should not receive the full row.

## Inputs

- Selected columns from `Deployment_Trajectory` (current condition + key trajectory metrics).
- **Selected** raw intervention narrative from `SFDC_DHP` / `SFDC_DHPActionHistory` (retrieved by id, not duplicated in trajectory).
- Evidence-quality metadata (`build_warnings`, coverage counts, reconciliation status).
- **Context contract helpers** (validator-local today: `scripts/deployment_trajectory_validation/context_contract.py`) for health/schedule reconciliation flags.

## Output

Compact, reasoning-oriented context block (per deployment or small batch), e.g.:

- Identity: name, customer, stage, health, days to MTP.
- Health trajectory summary with **explicit reconciliation** when `current_health` ≠ last HealthEvents `new_health`.
- Schedule trajectory summary with **net comparison basis** (`mtp_net_movement_comparison`, `earliest_recorded_mtp`) and initial-population vs valid-change distinction.
- **Recent vs historical windows** (e.g. 90d vs lifetime / 365d) — never label lifetime gross as 90-day movement.
- Product Function schedule summary when `mtp_analysis_grain = PRODUCT_FUNCTION`; PF target history gaps marked **UNAVAILABLE**.
- Intervention header + **one or few** latest narrative excerpts.
- Evidence quality / warnings.

## Requirements learned from pilot calibration (CAL-01)

1. **Recent vs historical** — Separate quiet recent trajectory from substantial historical volatility; both may appear in the same deployment.
2. **Deterministic metric semantics** — Ship field definitions with summaries (see [deployment-signal-domain.md](./deployment-signal-domain.md#summary-field-semantics-trajectory-row)).
3. **Evidence availability** — State what history exists; mark PF target history **UNAVAILABLE** when absent (not zero movement).
4. **Evidence-quality warnings** — Surface `build_warnings`, reconciliation status, and `health_summary_not_reconciled_with_current_health` when applicable.
5. **Summary/trace reconciliation** — If summary fields and HealthEvents/MTP trace can disagree, include contract metadata; never ask the model to bridge the gap.
6. **Never infer missing evidence** — Missing Green transition after Yellow is a source/history boundary, not an LLM interpolation task.
7. **Trace sufficiency** — When showing net/gross movement, include enough MTP trace rows to explain net baseline (initial population vs valid changes).
8. **Compact context** — Selected metrics + excerpted traces, not full trajectory sheets.

## Principle

Optimize for **LLM reasoning**, not analytical completeness. Every interpretive claim must trace to deterministic or source evidence.

## Pilot calibration status

| Case | Purpose | Ground truth |
|------|---------|--------------|
| CAL-01 | Historical volatility → current stabilization | Sana **NO_SIGNAL** — confirmed correct (local pilot record; no customer detail in Git) |
| CAL-02 | Green + historical volatility + lifecycle exposure | PENDING |
| CAL-03 | Green + active intervention | PENDING |

Local packets and manifest: `.ai/signal-exports/` (gitignored).

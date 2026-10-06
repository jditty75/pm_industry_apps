# deployment-signal-context-v1

Versioned schema for deterministic Context Assembler output consumed by the Sana Deployment Signals Pilot agent.

## Principles

- GAS / validator **select and normalize facts**; Sana **interprets** evidence.
- Every trajectory fact carries an explicit time horizon (`recent_30d`, `recent_90d`, `historical_365d`, `lifetime`).
- Unavailable evidence is named (e.g. `product_function_target_history_available: false`) — never implied zero movement.

## Top-level sections

| Section | Purpose |
|---------|---------|
| `metadata` | Schema version, snapshot date, logical app, deployment id, evidence window definitions |
| `current_state` | Health, stage, MTP, days to MTP, partners, analysis grain |
| `health_trajectory` | Historized summary + reconciliation contract + selected HealthEvents |
| `schedule_trajectory` | Windowed metrics + movement contract + selected MtpEvents |
| `product_function` | Rollups, reconciliation, PF target history availability |
| `intervention` | DHP / Action History facts + deterministically selected narrative excerpts |
| `evidence_quality` | HIGH / MEDIUM / LOW completeness classification (not Signal confidence) |
| `trace_references` | Audit metadata without full workbook payload |

## Health reconciliation

When `current_health` ≠ last HealthEvents `new_health`:

- Set `health_current_matches_last_event_new_health: false`
- Do **not** invent transitions or present `days_at_current_health` as verified tenure
- Prefer `days_since_last_historized_health_change` and concise caveats

## Schedule semantics

Ship `movement_contract` with net/gross definitions, initial target population vs valid target movement, and actual vs target separation.

## Evidence quality (deterministic)

Conservative classification from build warnings, health reconciliation, parent MTP reconciliation, PF rollup reconciliation, intervention mismatch flags, and missing critical history.

## Implementations

| Runtime | Entry |
|---------|--------|
| Apps Script | `CoreDeploymentSignalContext.buildDeploymentSignalContext`, `buildDeploymentSignalPortfolioContext` |
| Local pilot | `scripts/deployment_trajectory_validation/context_assembler.py` |

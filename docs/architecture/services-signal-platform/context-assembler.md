# LLM Context Assembler (architecture only — not implemented)

## Problem

`Deployment_Trajectory` is optimized for analytical completeness (~many columns). Sauna should not receive the full row.

## Inputs

- Selected columns from `Deployment_Trajectory` (current condition + key trajectory metrics).
- **Selected** raw intervention narrative from `SFDC_DHP` / `SFDC_DHPActionHistory` (retrieved by id, not duplicated in trajectory).
- Evidence-quality metadata (`build_warnings`, coverage counts, reconciliation status).

## Output

Compact, reasoning-oriented context block (per deployment or small batch), e.g.:

- Identity: name, customer, stage, health, days to MTP.
- Health trajectory summary (previous health, last change, deterioration/recovery counts).
- Schedule trajectory summary (target changes, net/gross movement, recent slips).
- Product Function schedule summary when `mtp_analysis_grain = PRODUCT_FUNCTION`.
- Intervention header + **one or few** latest narrative excerpts.
- Evidence quality / warnings.

## Principle

Optimize for **LLM reasoning**, not analytical completeness. Every interpretive claim must trace to deterministic or source evidence.

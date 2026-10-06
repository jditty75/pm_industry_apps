# Deployment signal domain (pilot)

First Services Signal Platform domain. One **Active** parent deployment per `Deployment_Trajectory` row (SLG pilot population).

## Source contracts (preserve joins)

| Sheet | Grain | Join |
|-------|-------|------|
| `SFDC_Deployments` | Parent deployment | `Id` |
| `SFDC_DeploymentHistory` | Field history | `ParentId` → `SFDC_Deployments.Id` |
| `SFDC_DeploymentProductFunctions` | Product Function | `Deployment__c` → Deployment `Id` |
| `SFDC_DeploymentProductFunctionHistory` | PF field history | `ParentId` → Product Function `Id` → Deployment |
| `SFDC_DHP` | Open Health Plan | `Deployment__r.Id` → Deployment |
| `SFDC_DHPActionHistory` | Action narrative | `Deployment_Health_Plan__c` → DHP → Deployment |

Do not casually change mature Salesforce connector schemas; pilot-specific tabs are preferred for isolation.

## Parent MTP semantics

| Role | Field |
|------|-------|
| Projected / target history | `First_Move_to_Production_Date_C__c` |
| Actual outcome history | `First_Move_to_Production_Date_Actual__c` |
| Baseline / OEMB context | `First_Move_to_Production_Date_OEMB__c` |
| Current reference only | `Current_MTP_Date__c` on deployments row |

**`Current_MTP_Date__c` is not historized in Salesforce.** Schedule **events** for parent deployments use historized target/actual fields above, not `Current_MTP_Date__c` history (that field does not exist in `SFDC_DeploymentHistory` inventory).

`CoreHistory.getMTPDateHistory` may include MTP-related fields for **effective MTP replay metadata** (`effective_mtp_replay_point_count` on the trajectory row). That replay is aligned with existing CoreHistory behavior and is separate from v2 schedule event construction in `TrajectorySchedule.buildParentSchedule`.

## Product Function MTP

- Effective MTP per function: **actual if populated, else target**.
- Actual population is an **outcome**; it does not increment target-change metrics.
- History fields: `Production_Move_Date_Target__c`, `Production_Move_Date_Actual__c`.

## Technical analysis grain (`mtp_analysis_grain`)

Internal metadata only — not leadership vocabulary.

| Value | Rule |
|-------|------|
| `DEPLOYMENT` | PF rows exist; all populated effective MTP dates collapse to one date. |
| `PRODUCT_FUNCTION` | Two or more distinct populated effective MTP dates. |
| `DEPLOYMENT_ONLY` | No PF data or insufficient populated effective dates. |

Do not use “Big Bang” or “Phased” in implementation, logs, or user-facing pilot language.

## Health trajectory

- Ranks: Green = 0, Yellow = 1, Red = 2.
- Deterioration / improvement only when both sides parse to a rank.
- Blank transitions are traceable on `Deployment_Trajectory_HealthEvents` but not auto-classified as deterioration/improvement.

### Summary field semantics (trajectory row)

| Field | Meaning |
|-------|---------|
| `current_health` | Live `Overall_Health__c` on the deployment row (authoritative **now**). |
| `previous_health` | **Old** value of the **last recorded** historized transition — not guaranteed to be the health immediately before `current_health`. |
| `health_last_change_date` | Date of the last **recorded** historized transition. |
| `days_at_current_health` | Days from `health_last_change_date` to build date — equals tenure at `current_health` only when `current_health` matches the last event `new_health`. |
| `Deployment_Trajectory_HealthEvents` | Full historized transition list from Deployment History; does not include silent field updates. |

When `current_health` differs from the last event `new_health`, Context Assembler must emit reconciliation metadata (`health_current_matches_last_event_new_health: false` and explicit caveats). Do not infer missing transitions (pilot calibration **CAL-01**).

### Schedule net / gross (parent target)

| Concept | Rule |
|---------|------|
| **Gross movement** | `mtp_gross_movement_days` — sum of `abs(movement_days)` on **valid** parent target changes (both old and new dates). |
| **Net movement** | `mtp_net_movement_days` — signed days from `earliest_recorded_mtp` to `current_mtp`; basis in `mtp_net_movement_comparison` (typically `earliest_recorded_current_mtp`). |
| **Initial target population** | Blank → date appears on the MTP trace but is **not** a valid target change; does **not** set the net baseline. |
| **Actual outcome** | `PARENT_ACTUAL_MTP` / `FUNCTION_ACTUAL_MTP` — separate from target movement metrics. |

Pilot note: lifetime gross parent movement can be positive while net is zero when the earliest **valid** recorded target equals current MTP (CAL-01 schedule ambiguity — contract, not math defect).

## Schedule trajectory

- **Target** metrics: changes, slips, accelerations, **net** movement (ultimate position vs earliest reliable target), **gross** movement (sum of absolute moves — not “cumulative slippage”).
- **Actual** metrics: separate; `actual_vs_final_target_days` when both sides exist.
- Initial blank → date target population is **not** a counted target change (`validChange: false`).

## Derived datasets

| Sheet | Grain | Notes |
|-------|-------|-------|
| `Deployment_Trajectory` | 1 row / active deployment | Schema version in `trajectory_schema_version` (config default **2**) |
| `Deployment_Trajectory_HealthEvents` | Health change events | |
| `Deployment_Trajectory_MtpEvents` | Schedule events | Types: `PARENT_*`, `FUNCTION_*` |
| `Deployment_Trajectory_ActionHistory_Index` | Action rows linked to deployment | IDs/counts/dates — **no** raw narrative copied into trajectory |

Writes replace sheet body with idempotent full refresh (`CoreDeploymentTrajectorySheetWrite`).

## Intervention context

- DHP: open plan metadata on trajectory row (counts, owners, categories, recency).
- Action History: association via DHP ids; narrative stays on `SFDC_DHPActionHistory` for future Context Assembler.

## Configuration gating

- `CoreConfig.withDefaults`: `deploymentSignal.enabled` defaults **false**.
- **SLG only:** `solutions/SLG_DM/src/Config_SLG.js` sets `enabled: true` and sheet names.
- Other `*_DM` apps: no `deploymentSignal` block; `CoreDeploymentTrajectory.refresh` no-ops.

## Entry points

- `CoreDeploymentTrajectory.refresh(cfg)` — library.
- `refreshDeploymentTrajectory()` / `debugDeploymentTrajectoryForDeployment(id)` — SLG container, **manual** editor/menu only (no production Exec Summary trigger).

## Known limitations (open)

1. **Product Function target history:** whether `FUNCTION_TARGET_CHANGE = 0` in live MTP events reflects data (e.g. history rows only on Actual field) vs defect — use export diagnostic script; see engineering baseline.
2. **Unresolved PF history ParentIds (~170 in handoff):** likely mix of deleted/historical PFs outside current extract; categorize with export diagnostic before join changes.
3. **Parent MTP reconciliation warnings:** mix of `EXPECTED_LIMITATION`, `SOURCE_HISTORY_GAP`, `CURRENT_VS_RECONSTRUCTED_DIFFERENCE`, and cases needing human validation — do not suppress.

## Pilot freeze

**Deployment Trajectory v2** is pilot-frozen for the SLG Signal pilot. See [deployment-trajectory-v2-pilot-freeze.md](./deployment-trajectory-v2-pilot-freeze.md). Context Assembler consumes this contract; semantic trajectory changes require explicit review.

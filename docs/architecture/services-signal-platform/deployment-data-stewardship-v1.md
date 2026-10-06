# deployment-data-stewardship-v1

Deterministic system-of-record QA lane — separate from Deployment Intelligence (Sana trajectory interpretation).

## Lanes

| Lane | Question |
|------|----------|
| `DEPLOYMENT_DATA_STEWARDSHIP` | Is system-of-record data complete, current, consistent, and trustworthy? |
| `PLATFORM_EVIDENCE_LIMITATION` | Is evidence missing because of extract/source capability (not EM maintenance)? |

A deployment may have stewardship conditions, platform limitations, Stage-1 candidates, or none — lanes are not mutually exclusive.

## Impact (operational, not AI risk)

| Class | Meaning |
|-------|---------|
| `BLOCKING` | Materially prevents reliable interpretation of a critical dimension |
| `REVIEW` | Inconsistent or stale; should be reviewed |
| `ADVISORY` | Limitation noted; current interpretation still usable |

Every condition includes: `condition_code`, `affected_domain`, factual `observation`, `source_fields`, `trace_reference`, `impact_classification`, optional `age_or_staleness_days`, and `review_action: SYSTEM_OF_RECORD_REVIEW_REQUIRED` (no blame language).

## Starting condition codes

Examples implemented from context packets: `CURRENT_MTP_MISSING`, `HEALTH_STATE_RECONCILIATION_MISMATCH`, `PF_ROLLUP_RECONCILIATION_MISMATCH`, `PF_COMPLETE_STAGE_NOT_TERMINAL`, `PARENT_MTP_RECONCILIATION_MISMATCH`, `MTP_PASSED_REMAINING_PF_WORK`, intervention/lifecycle codes, and platform codes such as `PF_TARGET_DATE_HISTORY_UNAVAILABLE`.

## Implementations

| Runtime | Entry |
|---------|--------|
| Local pilot | `scripts/deployment_trajectory_validation/data_stewardship.py` |
| Apps Script | `CoreDeploymentDataStewardship.analyzePacket(packet)` |

Portfolio scan: `python scripts/deployment-signal-stage2-harness.py` → `.ai/signal-exports/data-stewardship-review.html` and `data-stewardship-summary.json`.

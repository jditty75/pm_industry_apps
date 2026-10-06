# Data Stewardship rule precision audit

Deterministic QA from `deployment-signal-context-v1` packets. **Deployment Intelligence** asks what deserves leadership attention; **Data Stewardship** asks whether the system of record is complete, current, consistent, and trustworthy.

Stewardship does **not** depend on AI. Branch: Context Assembler → AI Signals **and** Stewardship detector → QA worklist.

Accountability design: emit `SYSTEM_OF_RECORD_REVIEW_REQUIRED` with condition, field, evidence, staleness, and expected review source — **not** "EM failed" or personal blame.

## Population metrics (184-deployment pilot, post–precision fix)

Recompute after rule changes:

```text
python scripts/deployment-signal-stage2-harness.py
```

Inspect `data-stewardship-summary.json` → `deployment_populations` for actionable vs contextual vs platform-only counts.

Post–precision-fix scan (184 deployments, local harness):

| Metric | Count |
|--------|------:|
| Deployments with any stewardship condition | 155 |
| **Actionable** stewardship (incl. PF rollup refinement class) | 136 |
| **Contextual-only** stewardship | 19 |
| Platform limitations only | 29 |
| BLOCKING | 48 |
| REVIEW | 131 |
| ADVISORY (stewardship lane only) | 0 |
| Multiple stewardship conditions | 54 |
| Stewardship condition rows | 214 |
| Platform limitation rows | 556 |

Parent MTP: 46 `PARENT_MTP_RECONSTRUCTION_LIMITATION` (platform) + 23 `PARENT_MTP_RECONCILIATION_MISMATCH` (DATE_MISMATCH stewardship).

## Rule catalog

| Code | Business meaning | Predicate (summary) | Domain | Expected owner/source | Team can fix? | Impact | False-positive risks | Mimics / limitations | Classification |
|------|------------------|---------------------|--------|----------------------|---------------|--------|----------------------|----------------------|----------------|
| `CURRENT_MTP_MISSING` | No current parent MTP in context | `current_mtp` empty | SCHEDULE | Salesforce Deployment MTP fields | Yes | BLOCKING | Terminal deployments with actual-only dates | Reconstruction gaps | ACTIONABLE_STEWARDSHIP |
| `HEALTH_STATE_RECONCILIATION_MISMATCH` | Live health ≠ last HealthEvents transition | reconciliation flag false | HEALTH | HealthEvents + Deployment health | Yes | REVIEW | Sparse history, timing lag | Sparse events (platform) | ACTIONABLE_STEWARDSHIP |
| `PF_ROLLUP_RECONCILIATION_MISMATCH` | PF count ≠ completed + remaining | rollup flag false | PRODUCT_FUNCTION | Deployment Product Functions | Often | REVIEW | Extract grain, stale rollups | Target-history gap (different code) | NEEDS_RULE_REFINEMENT |
| `PF_COMPLETE_STAGE_NOT_TERMINAL` | All PFs complete, stage still pre-terminal | remaining=0, stage in pre-terminal set | LIFECYCLE | Stage + PF status | Yes | REVIEW | Stage lag after last PF | — | ACTIONABLE_STEWARDSHIP |
| `PARENT_MTP_RECONCILIATION_MISMATCH` | Recorded parent MTP ≠ reconstructed history | `DATE_MISMATCH` only | SCHEDULE | Deployment MTP history | Yes | REVIEW | OEMB baseline vs current | — | ACTIONABLE_STEWARDSHIP |
| `PARENT_MTP_RECONSTRUCTION_LIMITATION` | Cannot verify parent lineage from history | `RECONSTRUCTED_*` status | SCHEDULE | Extract/history retention | No (platform) | ADVISORY | Universal in cohort | Salesforce history limits | PLATFORM_LIMITATION |
| `MTP_PASSED_REMAINING_PF_WORK` | Past MTP with remaining PFs | days_to_mtp &lt; -30 and remaining &gt; 0 | SCHEDULE | MTP + PF dates | Context-dependent | REVIEW | Intentional phased go-lives | Not always SoR error | CONTEXTUAL_STEWARDSHIP |
| `OPEN_HEALTH_PLAN_STALE_MAINTENANCE` | Open DHP not updated | open plan + days_since_dhp_update &gt; 90 | INTERVENTION | DHP maintenance | Yes | REVIEW | Snapshot timing | — | ACTIONABLE_STEWARDSHIP |
| `INTERVENTION_HEALTH_STATUS_DIVERGENCE` | Health ≠ Action History status | mismatch on open plan | INTERVENTION | Action History | Yes | REVIEW | Different semantics of "health" | — | ACTIONABLE_STEWARDSHIP |
| `OPEN_PLAN_WITHOUT_ACTION_HISTORY` | Open plan, zero AH rows | open plan + count=0 | INTERVENTION | Action History | Yes | ADVISORY | New plans | — | CONTEXTUAL_STEWARDSHIP |
| `OPEN_INTERVENTION_AFTER_APPARENT_COMPLETION` | Terminal stage + open plan | stage terminal + open plan | LIFECYCLE | DHP closure | Often | ADVISORY | Hypercare plans | — | CONTEXTUAL_STEWARDSHIP |
| `PF_TARGET_DATE_HISTORY_UNAVAILABLE` | No historized PF targets | flag false on all pilot | PRODUCT_FUNCTION | PF History object | No | ADVISORY | 100% pilot cohort | Known extract gap | PLATFORM_LIMITATION |
| `PLATFORM_EVIDENCE_GAP` | Named unavailable evidence | `unavailable_evidence` entries | EVIDENCE | Extract pipeline | No | ADVISORY | — | — | PLATFORM_LIMITATION |
| `HEALTH_EVENT_HISTORY_SPARSE` | Current health without events | sparse flag + health set | HEALTH | HealthEvents | No | ADVISORY | Large Green cohort | Retention | PLATFORM_LIMITATION |

## Precision changes (closeout)

- **Parent MTP:** `RECONSTRUCTED_BLANK_CURRENT_POPULATED` / `RECONSTRUCTED_POPULATED_CURRENT_BLANK` → `PARENT_MTP_RECONSTRUCTION_LIMITATION` (platform). Only `DATE_MISMATCH` remains `PARENT_MTP_RECONCILIATION_MISMATCH` (stewardship).
- **PF rollup:** remains stewardship but tagged **NEEDS_RULE_REFINEMENT** — high volume (105/184) may mix extract semantics with true SoR inconsistency; do not use raw count as EM accountability without sampling.

## Remaining ambiguities

- Whether PF rollup mismatches are predominantly extract roll-up logic vs maintainable Salesforce rows (requires sampled EM review).
- Whether `MTP_PASSED_REMAINING_PF_WORK` should ever promote to leadership Signals vs stewardship-only context.
- Stage-1 overlap: stewardship conditions on NO_SIGNAL deployments are expected; stewardship ≠ Signal.

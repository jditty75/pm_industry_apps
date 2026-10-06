# Deployment Trajectory v2 — pilot freeze

**Status:** pilot-frozen deterministic contract (SLG Signal pilot). Not immutable forever; semantic changes require explicit review before portfolio or production expansion.

## What freeze means

- Trajectory v2 outputs are validated for the Signal pilot (workbook validation, human review, three-case Sana calibration).
- **Context Assembler** (`CoreDeploymentSignalContext`, `deployment-signal-context-v1`) may depend on this contract.
- Known source limitations stay explicit in packets (PF target history, health reconciliation, parent MTP reconciliation).
- **Do not** change trajectory metric semantics in drive-by work; treat changes as a versioned contract bump.

## Configuration

- `deploymentSignal.schemaVersion` default **2** in `CoreConfig.withDefaults`.
- SLG-only enablement: `solutions/SLG_DM/src/Config_SLG.js` (`deploymentSignal.enabled: true`).

## Code

| Component | Location |
|-----------|----------|
| Trajectory engine | `libraries/DepMngr/src/CoreDeploymentTrajectory*.js` |
| Context Assembler | `libraries/DepMngr/src/CoreDeploymentSignalContext.js` |
| Local portfolio generation | `scripts/generate-deployment-signal-context-packets.py` |

## Calibration acceptance (reasoning patterns — not deterministic rules)

| Case | Pattern | Pilot outcome |
|------|---------|----------------|
| CAL-01 | Historical volatility → current stabilization | NO_SIGNAL |
| CAL-02 | Historical displacement + lifecycle exposure + evidence ambiguity | WATCH / COMPOUND |
| CAL-03 | Green + recent intervention + remaining delivery exposure | WATCH / INTERVENTION |

Recorded as calibration observations only. **Do not** encode these as hard-coded thresholds in GAS.

Local evidence: `.ai/signal-exports/` (gitignored).

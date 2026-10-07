# Services Signal Platform

Operational layer above Deployment Manager dashboards: compress leadership attention onto deployments that merit investigation, with traceable evidence.

## Platform flow

```text
Operational source data (Salesforce sheets, Health Plans, Action History)
        ↓
Deterministic derived trajectory (GAS / DepMngr)
        ↓
Evidence quality + trace sheets
        ↓
LLM Context Assembler (SLG pilot — deployment-signal-context-v1)
        ↓
Stage 1 — Sana candidate discovery (manual; 184 → 17 accepted pilot)
        ↓
Stage 2 — portfolio compression + Data Stewardship (deterministic harness → manual Sana)
        ↓
Post-reasoning normalization → deployment-signal-v1 (SLG persistence — GAS)
        ↓
Signal lifecycle → leadership email (future) / Deployment Manager (future UI)
```

**Pilot closeout:** [pilot-closeout.md](./pilot-closeout.md) (184 → 17 → 11 accepted result).

## Principles

| Principle | Meaning |
|-----------|---------|
| State | Where the deployment **is** today (health, stage, current MTP). |
| Trajectory | Where it is **going** and how schedule/health **changed**. |
| Intervention | **Why** patterns may matter (DHP + Action History narrative at source). |
| Attention | The platform decides **what deserves attention**, not every row. |

**GAS calculates facts. The LLM interprets evidence.** Do not move date math, health ranks, or schedule volatility into the reasoning model.

## Deterministic vs LLM

- **Deterministic (now):** health/schedule metrics, Product Function grain, joins, trace rows, warning tokens, counts/recency for DHP and Action History.
- **LLM (later):** compound patterns, leadership relevance, careful interpretation, leadership questions — only after human validation of trajectory v2.

## Production isolation

The production **HENP Exec Summary_GAS** Sauna agent (daily 7:00 AM, per-industry current-state analysis) stays **unchanged** during the Deployment pilot. The pilot is config-gated (`deploymentSignal.enabled`) and **SLG-only** in `Config_SLG.js`. No `CoreExecSummary` or trajectory coupling in library code.

## Domain strategy

**Deployment** is the first pilot domain. Do not generalize implementation into a shared framework until the pilot proves value. Reuse this **pattern** in documentation for future domains.

## Engineering references

| Document | Purpose |
|----------|---------|
| [pilot-closeout.md](./pilot-closeout.md) | Accepted pilot outcome, scorecard, conclusion |
| [ai-reasoning-contract.md](./ai-reasoning-contract.md) | Preferred concise AI instruction + boundary |
| [deployment-signal-domain.md](./deployment-signal-domain.md) | Trajectory v2 sheets, sources, grain, limitations |
| [structured-signals-contract.md](./structured-signals-contract.md) | `deployment-signal-v1` field contract |
| [deployment-signal-persistence.md](./deployment-signal-persistence.md) | SLG sheets, APIs, Sana handoff, lifecycle |
| [signal-lifecycle-roadmap.md](./signal-lifecycle-roadmap.md) | Lifecycle semantics + POSITIVE modeling |
| [weekly-operating-governance-model.md](./weekly-operating-governance-model.md) | Daily/weekly cadence, approval boundary, email + DM consumption |
| [llm-guardrails.md](./llm-guardrails.md) | Evidence/safety guardrails (companion to AI contract) |
| [data-stewardship-rule-audit.md](./data-stewardship-rule-audit.md) | Stewardship rule precision audit |
| [stage-2-legacy-embedded-contract.md](./stage-2-legacy-embedded-contract.md) | Superseded embedded Stage-2 rubric (audit) |
| [deployment-trajectory-v2-pilot-freeze.md](./deployment-trajectory-v2-pilot-freeze.md) | Pilot-frozen trajectory v2 contract |
| [deployment-signal-context-v1.md](./deployment-signal-context-v1.md) | Context packet schema |
| [context-assembler.md](./context-assembler.md) | Assembler architecture and portfolio workflow |
| [stage-2-portfolio-compression.md](./stage-2-portfolio-compression.md) | Stage 2 compression, stewardship lane, workflow |
| [deployment-signal-candidate-v1.md](./deployment-signal-candidate-v1.md) | Normalized Stage-1 candidate contract |
| [deployment-data-stewardship-v1.md](./deployment-data-stewardship-v1.md) | Data Stewardship condition contract |
| [human-validation-package.md](./human-validation-package.md) | Ten-deployment review format |
| [engineering-baseline-2026-10.md](./engineering-baseline-2026-10.md) | Reconciliation matrix and Git/runtime ownership |

## Code ownership

| Layer | Location |
|-------|----------|
| Trajectory engine | `libraries/DepMngr/src/CoreDeploymentTrajectory*.js` |
| Context Assembler | `libraries/DepMngr/src/CoreDeploymentSignalContext.js` |
| Signal persistence | `CoreDeploymentSignalPersistence.js`, `CoreDeploymentSignalNormalize.js`, `CoreDeploymentSignalLifecycle.js` |
| Defaults / gating | `libraries/DepMngr/src/CoreConfig.js` (`deploymentSignal`, schema version **2**, `persistenceEnabled` default **false**) |
| Local packet / harness | `scripts/generate-deployment-signal-context-packets.py`, `scripts/deployment-signal-portfolio-pilot-harness.py`, `scripts/deployment-signal-stage2-harness.py` |
| Data Stewardship | `CoreDeploymentDataStewardship.js`, `deployment_trajectory_validation/data_stewardship.py` |
| SLG pilot enablement | `solutions/SLG_DM/src/Config_SLG.js`, `Code.js` (trajectory + `persistApprovedSlgSignalRun`) |
| Tests | `deployment-signal-persistence.test.js`, `deployment-trajectory-*.test.js`, `deployment-signal-*.test.js` |
| Local PF history diagnostic | `scripts/diagnose-deployment-trajectory-pf-history.js` |

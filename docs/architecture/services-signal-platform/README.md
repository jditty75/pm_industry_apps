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

## Authoritative references (production)

| Document | Purpose |
|----------|---------|
| [deployment-signal-domain.md](./deployment-signal-domain.md) | Trajectory v2 sheets, sources, grain, limitations |
| [deployment-signal-context-v1.md](./deployment-signal-context-v1.md) | Context packet schema |
| [context-assembler.md](./context-assembler.md) | Assembler architecture and portfolio workflow |
| [ai-reasoning-contract.md](./ai-reasoning-contract.md) | AI instruction boundary (facts vs interpretation) |
| [structured-signals-contract.md](./structured-signals-contract.md) | `deployment-signal-v1` field contract |
| [deployment-signal-persistence.md](./deployment-signal-persistence.md) | SLG sheets, APIs, Sana handoff, lifecycle |
| [signal-lifecycle-roadmap.md](./signal-lifecycle-roadmap.md) | Lifecycle semantics + POSITIVE modeling |
| [deployment-data-stewardship-v1.md](./deployment-data-stewardship-v1.md) | Data Stewardship condition contract |
| [weekly-operating-governance-model.md](./weekly-operating-governance-model.md) | Daily/weekly cadence, approval boundary, email + DM consumption |
| [llm-guardrails.md](./llm-guardrails.md) | Evidence/safety guardrails (companion to AI contract) |

## Pilot history and audits

| Document | Classification |
|----------|----------------|
| [pilot-closeout.md](./pilot-closeout.md) | **PILOT HISTORY** — 184 → 17 → 11 accepted result |
| [deployment-trajectory-v2-pilot-freeze.md](./deployment-trajectory-v2-pilot-freeze.md) | **PILOT HISTORY** — frozen trajectory v2 contract |
| [stage-2-portfolio-compression.md](./stage-2-portfolio-compression.md) | **PILOT HISTORY** — Stage 2 compression workflow |
| [deployment-signal-candidate-v1.md](./deployment-signal-candidate-v1.md) | **PILOT HISTORY** — Stage-1 candidate schema (Python + test helper) |
| [human-validation-package.md](./human-validation-package.md) | **PILOT HISTORY** — ten-deployment review format |
| [data-stewardship-rule-audit.md](./data-stewardship-rule-audit.md) | **PILOT HISTORY** — rule precision audit |
| [engineering-baseline-2026-10.md](./engineering-baseline-2026-10.md) | **MERGE CANDIDATE** — reconciliation matrix (see code map below) |
| [stage-2-legacy-embedded-contract.md](./stage-2-legacy-embedded-contract.md) | **SUPERSEDED** — embedded Stage-2 rubric |

## Code ownership (post-consolidation)

| Layer | Location |
|-------|----------|
| Trajectory domain | `CoreDeploymentTrajectory.js`, `CoreDeploymentTrajectoryMetrics.js`, `CoreDeploymentTrajectorySchedule.js` |
| Trajectory sheet store | `CoreDeploymentTrajectoryStore.js` |
| Context + normalization | `CoreDeploymentSignals.js` (`CoreDeploymentSignalContext`, `CoreDeploymentSignalNormalize`) |
| Signal persistence API | `CoreDeploymentSignalPersistence.js` |
| Lifecycle | `CoreDeploymentSignalLifecycle.js` |
| Signal workbook store | `CoreDeploymentSignalStore.js` (schema, Spreadsheet IO, in-memory test store) |
| Data Stewardship | `CoreDeploymentDataStewardship.js` |
| Defaults / gating | `CoreConfig.js` (`deploymentSignal`, schema version **2**, `persistenceEnabled` default **false**) |
| SLG orchestration | `solutions/SLG_DM/src/Config_SLG.js`, `Code.js` (trajectory refresh, persistence wrappers) |
| Pilot / local harness | `scripts/deployment_trajectory_validation/`, `scripts/deployment-signal-stage2-harness.py`, `libraries/DepMngr/test/helpers/stage1-candidate-pilot.js` |
| Tests | `libraries/DepMngr/test/deployment-*.test.js` |

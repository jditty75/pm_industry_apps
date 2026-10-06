# Context Assembler (Deployment Signal pilot)

Deterministic layer between **Deployment Trajectory v2** and **Sana reasoning**. See [deployment-signal-context-v1.md](./deployment-signal-context-v1.md) and [deployment-trajectory-v2-pilot-freeze.md](./deployment-trajectory-v2-pilot-freeze.md).

## Responsibility

| Does | Does not |
|------|----------|
| Select facts, normalize semantics, explicit time windows | Assign Signal categories |
| Surface unavailable evidence and reconciliation metadata | Assign leadership attention |
| Include selected trace rows and intervention excerpts | Predict outcomes or causality |
| Classify evidence completeness (HIGH/MEDIUM/LOW) | Write leadership recommendations |

## Entry points (Apps Script / DepMngr)

- `CoreDeploymentSignalContext.buildDeploymentSignalContext(cfg, deploymentId, options)`
- `CoreDeploymentSignalContext.buildDeploymentSignalPortfolioContext(cfg, options)`
- Gated by `deploymentSignal.enabled` (default **false**; SLG pilot only).

## Local portfolio workflow

1. Generate packets: `python scripts/generate-deployment-signal-context-packets.py`
2. Inspect: `.ai/signal-exports/context-packet-review.html`
3. Build Sana input (no LLM): `python scripts/deployment-signal-portfolio-pilot-harness.py`
4. Manually run unchanged **Sana Deployment Signals Pilot** agent with `.ai/signal-exports/sana-portfolio-pilot-input*.txt` (**Stage 1**)
5. Store verbatim Stage-1 Sana outputs in `.ai/signal-exports/stage1/`
6. `python scripts/deployment-signal-stage2-harness.py` → inspect review HTML → paste `sana-stage2-portfolio-compression-input.txt` (**Stage 2**) → save response to `stage2/Sana-stage2-output.txt`

Pilot accepted: 184 → 17 → 11. AI contract: [ai-reasoning-contract.md](./ai-reasoning-contract.md).

Production-derived artifacts remain under `.ai/signal-exports/` only (gitignored).

## Stage 1 result (accepted)

184 deployments evaluated → **17** candidate Signals → **167** NO_SIGNAL (~90.8% compressed). See [stage-2-portfolio-compression.md](./stage-2-portfolio-compression.md).

## Pilot calibration acceptance (patterns — not rules)

| Case | Pattern | Accepted Sana outcome |
|------|---------|------------------------|
| CAL-01 | Historical volatility → current stabilization | NO_SIGNAL |
| CAL-02 | Historical displacement + lifecycle exposure + evidence ambiguity | WATCH / COMPOUND |
| CAL-03 | Green + recent intervention + remaining delivery exposure | WATCH / INTERVENTION |

Automatic reproduction: `context-packets/calibration-comparison-report.json` from the generator script.

## Batching strategy

When portfolio payload size exceeds limits, the harness emits deterministic batches (stable `deployment_id` order). **Stage 1:** per-batch candidate Signals. **Stage 2:** portfolio-level attention compression across normalized candidates — see `scripts/deployment-signal-stage2-harness.py` and [stage-2-portfolio-compression.md](./stage-2-portfolio-compression.md).

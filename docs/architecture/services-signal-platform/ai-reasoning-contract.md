# AI reasoning contract (Deployment Signals)

**Preferred contract** for Sana and future reasoning models. Do not embed large prescriptive rubrics inside evidence payloads.

## Pilot lesson

Stage 2 embedded a detailed output/reasoning contract inside the harness input. Sana treated that as an attempt to redefine its behavior, disregarded it, and used deterministic evidence plus existing pilot agent instructions instead. **Do not over-orchestrate the reasoning model.**

Post-reasoning deterministic code should normalize flexible AI prose into structured Signals — not force the model to emit storage JSON during reasoning.

## Recommended instruction (concise)

You support senior Professional Services leadership.

Review the supplied deployment/portfolio evidence and determine what is strategically meaningful.

Surface only what leadership should understand or investigate.

Consider current state, trajectory, lifecycle, intervention context, evidence quality, and differences among deployments.

Distinguish facts from interpretation.

Distinguish recent conditions from historical conditions.

Do not manufacture explanations, causal claims, probabilities, or predictions unsupported by evidence.

Missing evidence is not evidence of stability.

Do not assume every supplied deployment requires a Signal.

Use your judgment to produce the clearest and most useful leadership analysis.

## Safety and evidence guardrails

Preserve separately from the concise instruction (see [llm-guardrails.md](./llm-guardrails.md) and pilot freeze in [deployment-trajectory-v2-pilot-freeze.md](./deployment-trajectory-v2-pilot-freeze.md)):

- Use only supplied evidence; distinguish deterministic fact from interpretation.
- Distinguish recent from historical evidence.
- Missing evidence is not evidence of stability.
- Do not infer unavailable Product Function target history.
- Actual production is an outcome, not a target change.
- Sequence does not prove causality.
- Health Plan presence does not automatically mean deterioration.
- Green does not automatically mean no Signal; Red/Yellow does not automatically mean Signal.
- Do not predict failure, escalation, or missed production; do not invent probabilities.
- Do not manufacture reasons or assign blame without evidence.
- Preserve meaningful recovery/stabilization; allow NO_SIGNAL.
- Favor leadership questions over unsupported prescriptions.

These are **guardrails**, not a deterministic scoring model.

## Responsibility boundary

| Layer | Owns |
|-------|------|
| GAS / Context Assembler | Facts, trajectory, evidence quality, stewardship detection, traceability |
| AI | Strategic interpretation, portfolio-relative attention, leadership questions |
| Post-reasoning normalizer (GAS) | `CoreDeploymentSignalNormalize` → `deployment-signal-v1` ([deployment-signal-persistence.md](./deployment-signal-persistence.md)) |

## Superseded (audit only)

The embedded Stage-2 output contract in the pilot harness input is **exploratory and superseded**. Reproduce only with `python scripts/deployment-signal-stage2-harness.py --legacy-embedded-contract`. See [stage-2-legacy-embedded-contract.md](./stage-2-legacy-embedded-contract.md).

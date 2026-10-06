# Deployment Signals pilot closeout

**Date:** 2026-10-06  
**Scope:** SLG portfolio, deterministic trajectory v2 + Context Assembler + manual Sana Stage 1/2  
**Production:** Unchanged (config-gated pilot; no Signal persistence or DM UI)

## Accepted experimental path

| Stage | Deployments / candidates | Outcome |
|-------|--------------------------|---------|
| Population | 184 active | Deterministic context for all |
| Stage 1 | 17 candidate Signals, 167 NO_SIGNAL | ~90.8% compression |
| Stage 2 | 11 retained Signals, 6 further NO_SIGNAL | 184 → 17 → 11 |

Final retained Signal density ≈ **6%** of the active portfolio. **11 is not a production target** — attention compression stays evidence-driven.

## Stage 2 portfolio themes (aggregate, no deployment IDs)

**Retained (11):** sustained/compound long-running conditions; schedule/lifecycle divergence; intervention gaps; early-lifecycle intervention; a meaningful **Green exception**; an informational completion/closeout condition.

**Compressed (6):** routine relative to other candidates; insufficiently distinctive; undermined by evidence/reconciliation gaps; primarily a data-governance condition rather than a trajectory Signal.

## Green discovery

Automated portfolio analysis surfaced at least one **current Green / Post Prod** deployment whose Product Function and intervention evidence materially diverged from quiet parent-level presentation — supporting the hypothesis that trajectory/context can surface meaningful Green deployments conventional current-state review may overlook. **Not** a rule "Green + X = Signal."

## AI reasoning lesson

Over-prescriptive embedded Stage-2 instructions were **rejected** by Sana. Future contract: role + objective + trustworthy evidence + guardrails ([ai-reasoning-contract.md](./ai-reasoning-contract.md)).

## Calibration (patterns only — not GAS rules)

| ID | Pattern | Pilot outcome |
|----|---------|---------------|
| CAL-01 | Historical volatility + current stabilization | NO_SIGNAL (leader confirmed) |
| CAL-02 | Historical displacement + lifecycle exposure + evidence ambiguity | WATCH / COMPOUND |
| CAL-03 | Green + recent intervention + remaining delivery exposure | WATCH / INTERVENTION |

Same unchanged agent for all three.

## Data Stewardship emergence

Deterministic QA lane separate from Deployment Intelligence. Requires rule-precision validation before accountability metrics — see [data-stewardship-rule-audit.md](./data-stewardship-rule-audit.md).

## Evidence ceiling / data roadmap

- PF target-date history unavailable across current extract
- No recent 30/90-day health or schedule-target changes in pilot population
- Substantial portfolio lacks historized health events
- Parent MTP reconstruction/reconciliation limitations remain

Opportunities for future leading-signal power — not pilot invalidations.

## Scorecard

| Dimension | Status |
|-----------|--------|
| Deterministic accuracy | **DEMONSTRATED** (trajectory v2 + context packets at scale) |
| Attention compression | **DEMONSTRATED** (184 → 17 → 11) |
| Green discovery | **DEMONSTRATED** (≥1 credible example) |
| Temporal reasoning | **PROMISING** (limited by sparse change events) |
| Compound reasoning | **DEMONSTRATED** |
| Intervention reasoning | **DEMONSTRATED** |
| Recovery/stabilization recognition | **PROMISING** |
| Evidence discipline | **DEMONSTRATED** |
| Causal restraint | **DEMONSTRATED** |
| Leadership usefulness | **PROMISING** (human validation; no production UI) |
| Data Stewardship discovery | **DEMONSTRATED** |
| Calibrated outcome forecasting | **NOT YET DEMONSTRATED** |

## Conclusion

The Deployment Signals pilot demonstrates that a deterministic GAS evidence layer combined with AI reasoning can materially compress a deployment portfolio into differentiated leadership Signals while preserving traceability and avoiding unsupported predictive claims.

A separate deterministic Data Stewardship capability is valuable but needs rule-precision validation before accountability use.

**Recommended next milestone:** Design and implement controlled Signal normalization/persistence + lifecycle tracking, keeping AI reasoning flexible and evidence-grounded — **not started in this closeout.**

## Local evidence (gitignored)

`.ai/signal-exports/` — Stage-1 `stage1/Sana.txt`, harness artifacts, `pilot-manifest.json`. Stage-2 verbatim Sana output: `stage2/Sana-stage2-output.txt` when placed.

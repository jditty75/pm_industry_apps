# Signal lifecycle roadmap (design only)

No production persistence in the pilot closeout phase.

## Lifecycle states

| State | Question answered |
|-------|-------------------|
| `NEW` | What appeared this run that leadership has not seen before? |
| `CONTINUING` | What material condition persists week over week? |
| `ESCALATED` | What became more important (attention, scope, or evidence)? |
| `DE_ESCALATED` | What became less important while still tracked? |
| `RESOLVED` | What closed or no longer merits attention? |
| `POSITIVE` | What materially improved or stabilized in a leadership-relevant way? |

Recurring reporting must answer: what is new, what continues, what escalated/de-escalated, what resolved, and what improved.

## Signal identity (requirements, not final algorithm)

Do **not** use AI prose as the stable identity key.

Consider deterministic inputs:

- Deployment identifier
- Signal family / category (e.g. COMPOUND, INTERVENTION, SCHEDULE)
- Relevant evidence dimensions (health trajectory, schedule divergence, intervention gap)
- Active vs resolved state and time window

**Alternatives to evaluate during implementation:**

- Hash of normalized evidence fingerprint + category
- Explicit `signal_family` assigned by normalizer from AI output
- Human-readable stable key with versioned mapping table

## Consumption channels (future)

Both consume the same underlying lifecycle store after **one weekly human approval** (authorization only — see [weekly-operating-governance-model.md](./weekly-operating-governance-model.md)):

1. **Deployment Manager landing intelligence** — interactive portfolio Signals; "What changed, what deserves attention, and what is improving?"
2. **Weekly leadership email** — lifecycle-driven emphasis (`NEW`, `ESCALATED`, materially `CONTINUING`, `DE_ESCALATED`, `POSITIVE`, `RESOLVED`); not a second AI pass.

Deployment Manager remains the **investigation surface**. Signals deep-link into DM context; do not duplicate full DM inside Signal output.

Brief content should be driven by **lifecycle state**, not merely by the current Signal population — exact semantics belong in the lifecycle implementation phase.

## Forecasting boundary

Maturity path: State → Change → Trajectory → Signal → Forward-looking assessment → Decision support.

The pilot demonstrates useful Signal **reasoning**; it does **not** demonstrate calibrated outcome prediction. Probabilities (e.g. "72% chance of missing MTP") require labeled outcomes, backtesting, calibration, and false-positive/false-negative evaluation.

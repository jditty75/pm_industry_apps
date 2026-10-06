# Weekly operating and governance model (design only)

Defines production cadence and human approval boundaries for the post-pilot Signal Platform. **Not implemented** in the pilot closeout.

## Operating cadence

| Cadence | What runs | AI required? |
|---------|-----------|----------------|
| **Daily** | Refresh operational evidence, Deployment Trajectory v2, Context Assembler packets, Data Stewardship scan | No — deterministic GAS + local/scheduled refresh only |
| **Weekly** | Signal Agent (strategic portfolio analysis) on latest deterministic evidence | Yes — primary AI reasoning cadence |
| **Monthly** | Longitudinal / portfolio-pattern analysis | Optional later — not initial cadence |
| **Event-triggered** | Off-cycle analysis on material deterministic events | Optional later — not initial cadence |

Daily work keeps evidence current without invoking the reasoning model. Weekly work produces leadership Signals.

## Governed weekly workflow

```text
Daily deterministic evidence refresh
        ↓
Weekly Signal Agent (completed proposed weekly run)
        ↓
Human workflow approval  ← authorization boundary, not re-analysis
        ↓
Approved Signal persistence
        ↓
Signal lifecycle update (compare to prior approved run)
        ↓
Automatic leadership email (same approved state)
        ↓
Deployment Manager landing intelligence (same approved state)
```

### Human approval principle

**Human approval is an authorization boundary, not an analytical step.**

The approver is **not** expected to re-analyze, individually curate, rewrite, rank, or adjudicate each Signal. The Signal Agent owns the analysis.

Approval exists because company LLM governance requires authorization before AI-generated output is **written/persisted** into Google Sheets and allowed to continue through governed downstream workflow.

Approval means: **authorize this completed weekly Signal Agent workflow/output to proceed.**

Approval does **not** mean: *I personally validated every Signal against underlying deployment evidence.*

If routine manual re-analysis is required before weekly approval, treat that as a **Signal Platform quality problem**, not normal workflow design.

### Post-approval automation (one approval)

One weekly human approval should authorize the remainder:

1. Persist the approved Signal run
2. Compare with the prior approved Signal run
3. Assign/update Signal lifecycle states ([signal-lifecycle-roadmap.md](./signal-lifecycle-roadmap.md))
4. Generate the weekly leadership Signal email
5. Send to configured leadership distribution
6. Expose the same approved Signal state to Deployment Manager

**Do not design** as normal requirements: second email approval; per-Signal checkboxes; mandatory per-Signal adjudication; mandatory email editing; manual ranking by the approver.

## Weekly leadership email

- Consumes the **same approved Signal/lifecycle state** as Deployment Manager — not a separate AI analysis.
- Emphasize lifecycle change: `NEW`, `ESCALATED`, materially `CONTINUING`, `DE_ESCALATED`, `POSITIVE`, `RESOLVED`.
- Avoid resending unchanged full narratives merely because a Signal remains active.
- Email generation/sending: future implementation; not in pilot closeout.

## Deployment Manager landing intelligence

Second primary consumption channel. Intended question: **What changed, what deserves attention, and what is improving?**

- Signal Platform = attention/orchestration layer
- Deployment Manager = investigation/action context
- Signals deep-link into deployment context; do not duplicate full DM inside Signal output

## Next implementation milestone

Design and implement **controlled Signal normalization/persistence + lifecycle tracking + weekly governed approval transaction**, preserving flexible AI reasoning ([ai-reasoning-contract.md](./ai-reasoning-contract.md)). Treat Signal Agent → approval → persistence/lifecycle → email → DM as **one governed weekly workflow**.

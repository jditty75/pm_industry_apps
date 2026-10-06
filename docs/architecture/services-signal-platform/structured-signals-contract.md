# deployment-signal-v1 (structured contract — design only)

No production storage in the pilot closeout. Reasoning quality comes first; persistence follows via a **normalizer / validator** after AI output.

## Design decision

Do not constrain reasoning excessively to ease persistence. Flow:

```text
AI reasoning output → normalizer / validator → deployment-signal-v1
```

Preserve original AI prose in an audit field where useful.

## Schema (planned)

| Field | Purpose |
|-------|---------|
| `schema_version` | `deployment-signal-v1` |
| `deployment_id` | Deployment identifier |
| `generated_at` | ISO timestamp |
| `attention` | `HIGH` \| `WATCH` \| `INFORMATIONAL` \| `POSITIVE` (portfolio-relative) |
| `signal_type` | Category: HEALTH, SCHEDULE, LIFECYCLE, INTERVENTION, COMPOUND, POSITIVE, etc. |
| `observation` | Factual condition (deterministic-backed where possible) |
| `evidence_summary` | Pointers / short summary of supporting trajectory context |
| `interpretation` | AI strategic reading (not fact) |
| `why_it_matters` | Leadership relevance |
| `leadership_question` | Investigative prompt |
| `confidence` | `HIGH` \| `MEDIUM` \| `LOW` (interpretive, not evidence_quality) |
| `evidence_limitations` | Known gaps affecting interpretation |
| `deterministic_context_ref` | Link to context packet / trace (e.g. deployment-signal-context-v1 id + checksum) |
| `source_reasoning_run_ref` | Stage/run id, model agent version, input checksum |
| `reasoning_prose_original` | Optional full AI text for audit |
| `data_stewardship_present` | Whether stewardship conditions exist (boolean; details in stewardship lane) |

## Attention vs evidence quality

- `evidence_quality.classification` in context packets is **deterministic** (HIGH/MEDIUM/LOW completeness).
- Signal `confidence` is **interpretive** and assigned during reasoning or normalization — do not conflate.

## Related contracts

- Input context: [deployment-signal-context-v1.md](./deployment-signal-context-v1.md)
- Stage-1 candidates: [deployment-signal-candidate-v1.md](./deployment-signal-candidate-v1.md)
- Lifecycle: [signal-lifecycle-roadmap.md](./signal-lifecycle-roadmap.md)

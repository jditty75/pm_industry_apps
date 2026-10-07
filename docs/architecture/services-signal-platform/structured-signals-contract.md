# deployment-signal-v1 (structured contract)

Implemented for **SLG** persistence. See [deployment-signal-persistence.md](./deployment-signal-persistence.md) for sheets, APIs, and governance.

## Flow

```text
AI substantive output → CoreDeploymentSignalNormalize → lifecycle (CoreDeploymentSignalLifecycle)
  → persistApprovedSlgSignalRun → Deployment_Signals / History / Runs
```

Preserve original AI prose in `reasoning_prose_original` when supplied.

## Substantive fields (Sana)

- `deployment_id`, `attention`, `signal_type`, `observation`, `interpretation`, `why_it_matters`, `leadership_question`, `confidence`, `evidence_limitations`
- Optional: `context_ref`, `reasoning_prose_original`, `current_health`, `stage`

## System fields (GAS)

- `schema_version` (`deployment-signal-v1`), `signal_id`, `signal_run_id`, `signal_as_of`, `generated_at`/`received_at`/`persisted_at`, `lifecycle_state`, `signal_status`, `source_reasoning_run_ref`, `prior_signal_id`, `normalization_version`

## Attention vs evidence quality

- Context packet `evidence_quality` is deterministic.
- Signal `confidence` is interpretive — do not conflate.

## Related contracts

- Input context: [deployment-signal-context-v1.md](./deployment-signal-context-v1.md)
- Stage-1 candidates: [deployment-signal-candidate-v1.md](./deployment-signal-candidate-v1.md)
- Lifecycle: [signal-lifecycle-roadmap.md](./signal-lifecycle-roadmap.md)

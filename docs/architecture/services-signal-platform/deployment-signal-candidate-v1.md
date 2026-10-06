# deployment-signal-candidate-v1

Normalized contract for Stage-1 Sana portfolio candidate Signals (deterministic ingest; Sana prose preserved separately).

## Identity / trace

| Field | Purpose |
|-------|---------|
| `deployment_id` | Join key to `deployment-signal-context-v1` |
| `context_packet_ref` | Local path reference to context JSON |
| `stage1_batch` | Source batch file stem |
| `stage1_position` | Position within parsed batch |
| `source_checksum` | SHA-256 of verbatim Stage-1 batch text |

## Stage-1 assessment

Normalized enums (`HIGH`, `WATCH`, …) plus `*_raw` strings copied from Sana without reinterpretation.

Fields: Attention, Signal Type, Observation, Historical Evidence, Interpretation, Why This Matters, Leadership Question, Confidence, Evidence Limitations.

`stage1_raw_text` retains the verbatim block for audit.

## Ingest

- Local: `scripts/deployment_trajectory_validation/stage1_ingest.py`
- Apps Script mirror: `CoreDeploymentSignalStage1Ingest.js` (parser tests)
- Verbatim Stage-1 batch outputs: `.ai/signal-exports/stage1/sana-batch-{01,02,03}-output.txt` (gitignored)

Pilot acceptance: **17** unique candidate deployments across three Stage-1 batches; ingest fails loudly on count mismatch or duplicate `deployment_id`.

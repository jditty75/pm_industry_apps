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
- Authoritative Stage-1 source (local, gitignored): `.ai/signal-exports/stage1/Sana.txt` — three **cumulative** portfolio reports in one verbatim file (`REPORT_01_BATCH_1`, `REPORT_02_BATCHES_1_2`, `REPORT_03_FULL_PORTFOLIO`). Legacy optional: `sana-batch-{01,02,03}-output.txt`.

Pilot acceptance: **17** unique candidate deployments (184 evaluated / 167 NO_SIGNAL); cumulative appearances are deduplicated by `deployment_id`; ingest fails loudly on count mismatch or unresolved assessment conflicts.

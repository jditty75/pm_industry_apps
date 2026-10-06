# Stage 2 — portfolio attention compression

## Stage 1 result (accepted pilot)

| Metric | Value |
|--------|------:|
| Deployments evaluated | 184 |
| Stage-1 candidate Signals | 17 |
| NO_SIGNAL | 167 |
| Compression | ~90.8% |

Stage 1 used three sequential Sana portfolio runs preserved verbatim in local `stage1/Sana.txt` (cumulative reports). Stage 1 outcomes are **not** deterministic rules — they are inputs to Stage 2.

## Accepted Stage-2 result (pilot)

| Metric | Value |
|--------|------:|
| Stage-1 candidates reviewed | 17 |
| Deployment Intelligence Signals retained | 11 |
| Further compressed to NO_SIGNAL | 6 |
| Path | 184 → 17 → 11 (~6% final density) |

Stage-2 Sana output is preserved locally (gitignored): `.ai/signal-exports/stage2/Sana-stage2-output.txt`. Aggregate findings only in [pilot-closeout.md](./pilot-closeout.md).

## Stage 2 question

Across the portfolio, which Stage-1 candidates genuinely deserve **senior leadership attention** relative to one another, and which belong primarily to **Data Stewardship**?

## Responsibility split

| Owner | Role |
|-------|------|
| Composer / GAS / local Python | Parse Stage-1 outputs, normalize candidates, join context, stewardship scan, artifacts, traceability |
| Sana | Relative importance, leadership relevance, further attention compression, interpretation |

No hard-coded top-N, rankings, severity scores, or thresholds to reproduce Stage-1 counts.

## Workflow

1. Store verbatim Stage-1 Sana output as `.ai/signal-exports/stage1/Sana.txt` (three cumulative reports in one file).
2. `python scripts/deployment-signal-stage2-harness.py`
3. Inspect `.ai/signal-exports/stage2-candidate-review.html` and `data-stewardship-review.html`.
4. Manually paste `.ai/signal-exports/sana-stage2-portfolio-compression-input.txt` into Sana.
5. Save verbatim Sana response to `.ai/signal-exports/stage2/Sana-stage2-output.txt`.

**AI contract:** Use [ai-reasoning-contract.md](./ai-reasoning-contract.md). The long embedded output contract in early harness inputs is **superseded** ([stage-2-legacy-embedded-contract.md](./stage-2-legacy-embedded-contract.md)). Sana rejected that embedded rubric during the pilot.

Reproduce legacy input with `python scripts/deployment-signal-stage2-harness.py --legacy-embedded-contract` (audit only; do not rerun Sana to tune).

## Future Signal lifecycle (not implemented)

Recurring production Signals will likely need states such as: `NEW`, `CONTINUING`, `ESCALATED`, `DE_ESCALATED`, `RESOLVED`, `POSITIVE` for weekly leadership reporting and history.

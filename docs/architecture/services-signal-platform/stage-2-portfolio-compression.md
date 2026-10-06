# Stage 2 — portfolio attention compression

## Stage 1 result (accepted pilot)

| Metric | Value |
|--------|------:|
| Deployments evaluated | 184 |
| Stage-1 candidate Signals | 17 |
| NO_SIGNAL | 167 |
| Compression | ~90.8% |

Stage 1 used three deterministic Sana batches (unchanged Deployment Signals Pilot agent). Stage 1 outcomes are **not** deterministic rules — they are inputs to Stage 2.

## Stage 2 question

Across the portfolio, which Stage-1 candidates genuinely deserve **senior leadership attention** relative to one another, and which belong primarily to **Data Stewardship**?

## Responsibility split

| Owner | Role |
|-------|------|
| Composer / GAS / local Python | Parse Stage-1 outputs, normalize candidates, join context, stewardship scan, artifacts, traceability |
| Sana | Relative importance, leadership relevance, further attention compression, interpretation |

No hard-coded top-N, rankings, severity scores, or thresholds to reproduce Stage-1 counts.

## Workflow

1. Store verbatim Stage-1 Sana outputs under `.ai/signal-exports/stage1/`.
2. `python scripts/deployment-signal-stage2-harness.py`
3. Inspect `.ai/signal-exports/stage2-candidate-review.html` and `data-stewardship-review.html`.
4. Manually paste `.ai/signal-exports/sana-stage2-portfolio-compression-input.txt` into Sana (Stage-2 instructions are embedded in that artifact).

## Stage-2 quality gate

Every retained Deployment Intelligence Signal must include **Incremental Value Beyond Current Health** — what leadership learns beyond current health/status alone.

## Future Signal lifecycle (not implemented)

Recurring production Signals will likely need states such as: `NEW`, `CONTINUING`, `ESCALATED`, `DE_ESCALATED`, `RESOLVED`, `POSITIVE` for weekly leadership reporting and history.

# Agent handoff

**Deployment Signal Platform — deterministic baseline reconciled in Git (2026-10-06).**

- Architecture: [`docs/architecture/services-signal-platform/README.md`](../docs/architecture/services-signal-platform/README.md)
- Human validation: [`docs/architecture/services-signal-platform/human-validation-package.md`](../docs/architecture/services-signal-platform/human-validation-package.md)
- Live workbook validation: `python scripts/validate-deployment-trajectory-workbook.py --workbook ".ai/signal-exports/SLG DeploymentHealth_v1.xlsx"` → local HTML under `.ai/signal-exports/`

**Next:** Place verbatim Stage-1 Sana outputs in `.ai/signal-exports/stage1/` → `python scripts/deployment-signal-stage2-harness.py` → inspect `stage2-candidate-review.html` → paste `sana-stage2-portfolio-compression-input.txt` into Sana.

No production deployment authorization. Exec Summary Sauna agent unchanged.

# Stage-2 legacy embedded contract (superseded)

**Status:** Exploratory pilot artifact — **not** the recommended future AI contract.

During the Deployment Signals pilot, `sana-stage2-portfolio-compression-input.txt` included a long embedded "STAGE 2 OUTPUT CONTRACT" section. Sana identified this as an attempt to redefine its output behavior and **disregarded** it, relying on deterministic evidence and existing Deployment Signals Pilot agent instructions instead.

Sana still:

- Evaluated all 17 Stage-1 candidates
- Retained 11 portfolio-level Signals
- Compressed 6 additional candidates to NO_SIGNAL
- Preserved the meaningful Green exception
- Remained non-predictive and evidence-disciplined

## Why this file exists

Preserve pilot history without encouraging future agents to copy the embedded rubric into harness inputs. The preferred contract is [ai-reasoning-contract.md](./ai-reasoning-contract.md).

## Reproduction

```text
python scripts/deployment-signal-stage2-harness.py --legacy-embedded-contract
```

This re-attaches the legacy contract block to the generated input for audit comparison only. Do not rerun Sana to tune results.

# Qualtrics external data — discovery index

Discovery-only analysis (2026-10-05). No automation implemented. No production data in these files.

## Business problem (summary)

Jeff manually exports Qualtrics → runs local Python → uploads per-app `survey_normalized_*.csv` into Deployment Manager (CSAT tab). Goal: one Drive inbox drop of the **raw** Qualtrics export with validation, transform, split, canonical ingest, verify, and audit.

## Documents

| File | Contents |
|------|----------|
| [current-workflow.md](./current-workflow.md) | As-is manual pipeline and GAS touchpoints |
| [source-contract.md](./source-contract.md) | Raw Qualtrics export schema and semantics |
| [transformation-analysis.md](./transformation-analysis.md) | Python transformer behavior and Apps Script portability |
| [ingestion-contract.md](./ingestion-contract.md) | SLG/HENP upload path, shared DepMngr API, workbook effects |
| [future-architecture.md](./future-architecture.md) | Drive workflow, job states, orchestration, options, open questions |

## Key findings (executive)

- **Transformer location:** Not in monorepo; lives at `C:\Users\jeffrey.ditty\Documents\PY\Qualtrics.py` (header comment: `qualtrics_normalize.py`).
- **GAS ingestion:** Single shared implementation: `CoreLib.CoreData.uploadCsatInFlightCsvForUI` (container wrappers in each `*_DM` `WebAppCode.js`).
- **Split routing:** Python splits on Qualtrics `Sub Region` → `app`: `US Healthcare` → Healthcare population / **HC_DM**; `US SLED` → SLED population / **SLG_DM** + **HENP_DM** (downstream DepMngr tenant filter per workbook). HENP does **not** consume the Healthcare population.
- **V1A implementation:** `solutions/External_Data_Manager` — CSV normalizer + orchestrator through `READY_FOR_INGESTION` only.
- **V1B implementation:** Drive Inbox processor, destination registry, audit ledger, dry-run Process Now, DepMngr `ingestCsatInFlight` (Git; library release pending). See [external-data-manager.md](../../agent/external-data-manager.md).
- **Portability:** Transformation logic is implemented in GAS (`QualtricsTransform.js`); production source format is **CSV** (no XLSX pipeline).
- **Canonical boundary:** `CoreData.ingestCsatInFlight(config, normalizedRows, metadata, context)` shared by manual UI (`uploadCsatInFlightCsvForUI`) and EDM.

## Related repo references

- DM family: [docs/analysis/dm-family/README.md](../../dm-family/README.md)
- `google.script.run` contracts: [google-script-run-contracts.md](../../dm-family/google-script-run-contracts.md)
- Workbook structure (safe metadata): `docs/analysis/dm-family/{SLG,HENP}_DM.structure.json`

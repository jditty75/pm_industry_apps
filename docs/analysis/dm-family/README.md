# DM family analysis (sanitized)

Tracked **structural** workbook metadata and rationalization docs for the six Deployment Health apps (`SLG_DM`, `HC_DM`, `HENP_DM`, `EVI_DM`, `PDX_DM`, `HS_DM`).

## Start here

- **[RATIONALIZATION.md](./RATIONALIZATION.md)** — executive summary and artifact index
- **[cleanup-plan.md](./cleanup-plan.md)** / **[preview-data-plan.md](./preview-data-plan.md)** — ordered next steps

## Regenerate

Workbook structure from gitignored live XLSX in `docs/migrations/live/`:

```powershell
.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -Force
```

JSON cross-analysis (matrix, DepMngr usage, run contracts):

```powershell
python docs/analysis/dm-family/tools/rationalization_analyze.py
```

Each `*_DM.structure.json` includes sheet names, hidden state, dimensions, first-row headers, named-range definitions, and a capped sample of formula cross-sheet references. It does **not** include customer cell values, OAuth tokens, Script IDs, or spreadsheet file IDs.

# DM family workbook structure (sanitized)

Tracked **structural** metadata derived from gitignored live snapshots in `docs/migrations/live/`. Used for DepMngr config/workbook cleanup analysis and future sanitized preview fixtures.

Regenerate after refreshing snapshots:

```powershell
.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -Force
```

Each `*_DM.structure.json` includes sheet names, hidden state, dimensions, first-row headers, named-range definitions, and a capped sample of formula cross-sheet references. It does **not** include customer cell values, OAuth tokens, Script IDs, or spreadsheet file IDs.

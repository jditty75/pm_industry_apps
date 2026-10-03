# Migration artifacts

Versioned **reference** workbooks and tooling for Deployment Health (`*_DM`) migration analysis.

| Path | Git | Purpose |
|------|-----|---------|
| `PDX_DeploymentHealth_v1.xlsx` | Tracked | Pinned structural reference for Paradox split work |
| `live/` | **Ignored** | Current XLSX exports from production workbooks (sensitive) |
| `tools/snapshot-dm-workbooks.ps1` | Tracked | Download/refreshes `live/*.xlsx` via read-only Google APIs |

## Refresh live snapshots

```powershell
.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -List
.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -WhatIf
.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -App SLG_DM
.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -Force
```

If Drive export returns 403, grant **read-only Drive** once:

```powershell
clasp login --extra-scopes https://www.googleapis.com/auth/drive.readonly
```

or:

```powershell
.\docs\migrations\tools\snapshot-dm-workbooks.ps1 -Authorize
```

Safe structural inventories (sheet names, headers row 1, named ranges, no customer values) land in `docs/analysis/dm-family/` after a successful export.

# SLED Marketing — Upcoming Core Go-Lives

Google Apps Script web app (container-bound to **SLED_ActiveDeployments**) that shows an upcoming core production go-live timeline for the SLED marketing team, with Excel export of the current filtered view.

## Setup

1. Ensure the bound spreadsheet has tabs `SFDC_SLED_Deployments` and `SFDC_SLED_DeploymentProducts`.
2. Update `.clasp.json` `scriptId` if you create a new Apps Script project (`clasp clone` writes this automatically).
3. For standalone mode, set Script Property `SOURCE_SPREADSHEET_ID` to the sheet ID.

## Deploy

From this directory:

```bash
clasp push
```

Open the script editor to deploy the web app (`clasp open`), or use an existing web app deployment URL after push.

## Verify data layer

In the Apps Script editor, run `runSelfTest()` from `Tests.gs`. It asserts inclusion counts (373 qualifying deployments), helper behavior, and the ~165-event / ~151-customer 6-month window pool. Check **Execution log** for actual counts if data has drifted.

Expected inclusion breakdown:

- 218 Initial + 31 Specialized-Initial + 124 Subsequent-with-core = 373 qualifying
- 104 excluded (Subsequent with no core product)

## Source layout

All Apps Script source lives in `src/` (clasp `rootDir`):

| File | Role |
|------|------|
| `Config.gs` | Sheet names, core product map, `FIELD_REGISTRY` |
| `Helpers.gs` | Pure date/person parsers, header index builder |
| `DataAccess.gs` | Sheet reads, inclusion, milestone builder |
| `Code.gs` | `doGet`, `getUpcomingGoLives`, `exportCurrentView` |
| `Tests.gs` | `runSelfTest()` |
| `Index.html` / `Styles.html` / `JavaScript.html` | Web UI |

Adding a display/export column: one row in `FIELD_REGISTRY` in `Config.gs`.

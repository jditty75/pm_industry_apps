# Link Inventory — Deployment Health Manager

This table tracks the six destination Apps Script web app URLs used by the
"Launch Tool" buttons on the Google Site. Replace each placeholder with the
live, deployed web app URL for that app before publishing.

| Category | Card Title | Description | Apps Script Web App URL | Button Text | Owner | Status/Notes |
|---|---|---|---|---|---|---|
| Industry Portfolio Apps | State & Local Government | Portfolio-level management reporting for State & Local Government deployments. | `PASTE_STATE_LOCAL_GOVERNMENT_URL_HERE` | Launch Tool | Jeff Ditty (jeffrey.ditty@workday.com) | Placeholder — replace with SLG_DM deployed web app URL |
| Industry Portfolio Apps | Higher Education / Nonprofit | Portfolio-level management reporting for Higher Education and Nonprofit deployments. | `PASTE_HIGHER_ED_NONPROFIT_URL_HERE` | Launch Tool | Jeff Ditty (jeffrey.ditty@workday.com) | Placeholder — replace with HENP_DM deployed web app URL |
| Industry Portfolio Apps | Healthcare | Portfolio-level management reporting for Healthcare deployments. | `PASTE_HEALTHCARE_URL_HERE` | Launch Tool | Jeff Ditty (jeffrey.ditty@workday.com) | Placeholder — replace with HC_DM deployed web app URL |
| Product Portfolio Apps | Evisort | Portfolio-level management reporting for Evisort deployments. | `PASTE_EVISORT_URL_HERE` | Launch Tool | Jeff Ditty (jeffrey.ditty@workday.com) | Placeholder — replace with EVI_DM deployed web app URL |
| Product Portfolio Apps | HiredScore | Portfolio-level management reporting for HiredScore deployments. | `PASTE_HIREDSCORE_URL_HERE` | Launch Tool | Jeff Ditty (jeffrey.ditty@workday.com) | Placeholder — replace with HS_DM deployed web app URL |
| Product Portfolio Apps | Paradox | Portfolio-level management reporting for Paradox deployments. | `PASTE_PARADOX_URL_HERE` | Launch Tool | Jeff Ditty (jeffrey.ditty@workday.com) | Placeholder — replace with PDX_DM deployed web app URL |

## Notes

- Use each app's **deployed** web app URL (from `clasp deploy` /
  Apps Script deployment dialog), not the editor URL and not the HEAD/dev
  URL — the Google Site should always point at a stable production
  deployment.
- If a deployment is re-cut with a new deployment ID, update the
  corresponding row in this table and the live button link in Google Sites.
- Keep this file as the single source of truth for which URL is live on
  the site; do not let the Sites page and this table drift out of sync.

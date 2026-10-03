# Preview data plan — interactive `preview.ps1` for DM family

**Current state:** `previewSupport: PARTIAL` — shell, CSS, and DepMngr client bundle render; `google.script.run` is a no-op Proxy ([`preview_engine.py`](../../../skills/gas-monorepo-engineer/scripts/preview_engine.py) `SHIM`).

**Target:** `.\preview.ps1 SLG_DM` shows populated Deployments + Overview + Go Lives with scenario switching; same mock layer reusable for HC/HENP/EVI/PDX/HS via `appId` + config profile.

## Milestone 1 — Smart mock shim (minimum viable interactive)

**Where:** Extend `preview_engine.py` (or sibling `preview_dm_mocks.js` injected after `SHIM`).

1. Replace blind Proxy with a **method → handler** map for Phase-1 endpoints:
   - `getIdentityBoot`
   - `getDataFreshnessForUI`
   - `getAllDeploymentsForUI`
   - `getOverviewData`
2. Load fixtures from `skills/gas-monorepo-engineer/scripts/fixtures/dm/`:
   - `identity-boot.json`
   - `freshness-fresh.json` / `freshness-stale.json`
   - `deployments-mixed-health.json`
   - `overview-mixed-health.json`
3. Support `?scenario=` query param (parsed in shim from `location.search`) to swap JSON files per [preview-fixture-design.md](./preview-fixture-design.md).
4. Log unimplemented methods to console with **actionable** message (keep chainable handlers).

**Acceptance:** Deployments tab shows rows, KPIs, health filters animate; overview tab non-empty; freshness badge colored.

**Reuse:** `config/ui-preview.json` — add optional `mockProfile: "dm-v1"` on all `*_DM` entries pointing at shared fixture pack.

## Milestone 2 — Go Lives + overrides (implemented)

**Handlers (read):**

- `getRecentGoLivesData`, `getUpcomingGoLivesData`
- `getGoLivesExplorerDataForUI`
- `getAllActiveOverridesForUI`, `getOverrideAuditLogForUI`

**Handlers (write — session-local only):**

- `updateDeploymentWithMetaAndOverride`, `updateGoLivesOverride`
- `setOverrideClassificationForUI`, `clearSingleOverrideForUI`

Builders: `preview_dm_m2.py` derives go-live and override fixtures from the same deployment rows as M1 (per scenario). Mutable override state lives in `sessionStorage` (`preview-dm-override-state-v1`) inside the injected mock runtime.

**Acceptance:** Go Lives tab (legacy + explorer) and Manage Overrides exercise real client handlers; writes never call GAS.

## Milestone 3 — Module tabs + remaining writes

Still stub / unimplemented in preview:

- `saveExecutiveSummaryHtml`, portfolio/trends/CSAT/notable/reporting endpoints (see `M3_PLUS_METHODS` in `preview_dm_m2.py`)

## Milestone 4 — Module tabs

| Tab | Methods | Profile |
|-----|---------|---------|
| Trends | `getTrendsDashboardData` | all |
| CSAT | `getCsatTabDataForUI` | all |
| Notable | `getNotableData`, `getGoLivesForNotablePicker` | SLG+ |
| Student | `getStudentTabData` | HENP only |
| Escalations | `getEscalationsDashboardData` | PDX only |
| Reporting | `getReportSendConfigForUI`, `getGmailReportPreview` (static HTML string) | ADMIN mock |

## Milestone 5 — ProductMode filter

When preview app is `HS_DM` or `PDX_DM`:

- Evaluate real `Config_HS.js` / `Config_PDX.js` in Node (already done).
- Apply **client-side filter** on shared deployment fixture using `productModeDeploymentNameIncludes` rules OR maintain two deployment JSON files.

## Implementation checklist

- [x] Create `fixtures/dm/*.json` (sanitized, no real accounts)
- [x] `preview_engine.py` + `preview_dm_fixtures.py`: DM mock shim inject
- [x] `preview_selftest.py`: assert handlers exist for Milestone 1 methods (six apps)
- [x] M2: go-lives + overrides fixtures, session-local write mocks, contract tests (`validate_m2_bundle`, `preview_dm_runtime_smoke.mjs`)
- [x] Document in `docs/agent/ui-preview.md` + `references/ui-preview-dm.md`
- [x] `preview.ps1 -Scenario at-risk` passes query to opened URL

## Out of scope (v1)

- Executing `CoreData` in Node VM
- Monthly report send / Gmail
- Slides `createPortfolioHealthSlides`
- Live `viewAsReadOnly` URLs (keep disabled in preview config stub)

## Verification

1. `.\preview.ps1 SLG_DM -NoOpen` → validate PASS  
2. Browser: Deployments + Overview populated under `mixed-health`  
3. `?scenario=empty` → empty states  
4. Repeat smoke for `HC_DM`, `HENP_DM` (Industry) and `HS_DM` (ProductMode filter)

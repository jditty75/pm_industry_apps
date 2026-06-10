/**
 * SLG Deployment Health Web App — Server-side wiring layer.
 *
 * Includes:
 *   - doGet (templated HTML so scriptlets resolve)
 *   - Phase 0/1 endpoints: data fetches, exec summary, report preview, overrides
 *   - Phase 2 endpoints: identity boot, viewMode-aware data fetches, manage
 *     overrides queries, classification updates, bulk clear actions
 *
 * NOTE:
 *   - Core data / analytics / reporting logic lives in CoreLib.
 *   - This file only wires WebApp entry points + server functions used by the
 *     client JS bundle. Each function is a thin delegate to CoreLib.
 *
 * Phase history:
 *   Phase 0 (CoreLib v8): doGet switched to createTemplateFromFile.
 *   Phase 1 (CoreLib v9): no changes to this file.
 *   Phase 2 (CoreLib v10): viewModeOpts forwarding on data fetches +
 *                          new endpoints for personalization, manage
 *                          overrides, classification, bulk clear.
 */

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('WebApp');
  return t.evaluate()
    .setTitle(APP_CONFIG.ui.appTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================================
// (OPTIONAL) LOCAL WEB CONFIG — Phase 1 leftover, kept for any local uses
// ============================================================================

const webCONFIG = {
  ACTIVE_DEPLOYMENTS_SHEET: 'ActiveDeployments',
  GO_LIVES_SHEET: 'Go Lives',
  DEPLOYMENTS_COLS: {
    ACCOUNT_NAME: 1, DEPLOYMENT_NAME: 2, SERVICES_APPROACH: 3, INDUSTRY: 4,
    SUB_REGION: 5, PARTNER: 6, DEPLOYMENT_STAGE: 7, DEPLOYMENT_HEALTH: 8,
    CURRENT_MTP_DATE: 9, PROF_SERVICES_LOCS: 10, PROF_SERVICES_DETAILS: 11,
    DAM_FULL_NAME: 12, WD_ENG_MANAGER: 13, CURRENT_DEPLOYMENT_UPDATE: 14,
    DEPLOYMENT_ID: 15
  },
  GO_LIVES_COLS: {
    ACCOUNT_NAME: 1, INDUSTRY: 2, DAM_FULL_NAME: 3, WD_ENG_MANAGER: 4,
    PARTNER: 5, DEPLOYMENT_NAME: 6, SERVICES_APPROACH: 7, PRODUCT_AREA: 8,
    GO_LIVE_DATE_ACTUAL: 9, IN_PRODUCTION: 10
  }
};

// ============================================================================
// PHASE 2 — IDENTITY BOOT
// ============================================================================

/**
 * Called once at WebApp page load. Returns the current user record (or null)
 * plus the active users list (used by VP/PM dropdown).
 *
 * Shape:
 *   {
 *     user: <CoreUsers.getCurrentUser result> | null,
 *     activeUsers: <CoreUsers.getActiveUsers result>
 *   }
 */
function getIdentityBoot() {
  return {
    user: CoreLib.CoreUsers.getCurrentUser(APP_CONFIG),
    activeUsers: CoreLib.CoreUsers.getActiveUsers(APP_CONFIG)
  };
}

// ============================================================================
// PHASE 1 + 2 — DATA FETCHES (viewModeOpts forwarded when supplied)
// ============================================================================

/**
 * Phase 1 endpoint, preserved as-is. The Phase 2 client JS no longer calls
 * this directly for the Deployments tab (uses getAllDeploymentsForUI instead),
 * but external callers (Code.gs menu items, debug helpers) may still use it.
 */
function getActiveDeploymentsData() {
  return CoreLib.CoreData.getActiveDeployments(APP_CONFIG);
}

/**
 * Phase 2: returns full portfolio (all health colors). The Phase 2 client JS
 * uses this for the redesigned Deployments tab and applies the Health filter
 * client-side.
 *
 * @param {Object=} viewModeOpts  { viewMode: 'my'|'all', ddDisplayName: string }
 */
function getAllDeploymentsForUI(viewModeOpts) {
  return CoreLib.CoreData.getAllDeployments(APP_CONFIG, viewModeOpts);
}

/**
 * Phase 1 endpoint, extended in Phase 2 to forward viewModeOpts.
 *
 * @param {Object=} viewModeOpts
 */
function getGoLivesData(viewModeOpts) {
  return CoreLib.CoreData.getGoLives(APP_CONFIG, viewModeOpts);
}

/**
 * Phase 1 endpoint, extended in Phase 2 to forward viewModeOpts.
 *
 * @param {Object=} viewModeOpts
 */
function getUpcomingGoLivesData(viewModeOpts) {
  return CoreLib.CoreData.getUpcomingGoLives(APP_CONFIG, viewModeOpts);
}

// ============================================================================
// PHASE 1 — EXECUTIVE SUMMARY (unchanged)
// ============================================================================

function getExecutiveSummaryHtml() {
  return CoreLib.CoreExecSummary.get(APP_CONFIG);
}

function saveExecutiveSummaryHtml(html) {
  return CoreLib.CoreExecSummary.save(APP_CONFIG, html);
}

// ============================================================================
// PHASE 1 — MONTHLY REPORT PREVIEW (unchanged)
// ============================================================================

function getHtmlReportPreview() {
  return CoreLib.CoreReport.buildInlineHtmlWithAnalytics(APP_CONFIG);
}

// ============================================================================
// PHASE 1 — PORTFOLIO HEALTH (unchanged)
// ============================================================================

function getPortfolioHealthData() {
  return CoreLib.CorePortfolioHealth.getSnapshot(APP_CONFIG);
}

// ============================================================================
// PHASE 1 — OVERRIDE / META UPDATES (unchanged — audit wiring lives in CoreData)
// ============================================================================

/**
 * Combined meta + overrides update for a deployment. Phase 2: CoreData now
 * writes an OverrideAudit row server-side. No client signature change.
 */
function updateDeploymentWithMetaAndOverride(rowIndex, deploymentId, metaData, overrideData) {
  return CoreLib.CoreData.updateDeploymentWithMetaAndOverride(
    APP_CONFIG, deploymentId, metaData, overrideData
  );
}

/**
 * Go Lives overrides update. Phase 2: CoreData writes audit row.
 */
function updateGoLivesOverride(accountName, overrideData) {
  return CoreLib.CoreData.updateGoLivesOverride(APP_CONFIG, accountName, overrideData);
}

// ============================================================================
// PHASE 2 — MANAGE OVERRIDES ENDPOINTS
// ============================================================================

/**
 * Returns all active overrides (deployments + go lives) for the Manage
 * Overrides tab. Honors viewMode personalization.
 *
 * @param {Object=} viewModeOpts
 */
function getAllActiveOverridesForUI(viewModeOpts) {
  return CoreLib.CoreData.getAllActiveOverrides(APP_CONFIG, viewModeOpts);
}

/**
 * Returns OverrideAudit log rows.
 *
 * @param {Object=} opts  { sinceDays?: number, limit?: number }
 */
function getOverrideAuditLogForUI(opts) {
  return CoreLib.CoreData.getOverrideAuditLog(APP_CONFIG, opts);
}

/**
 * Flip the Classification (Monthly | Structural) on a single override row.
 * PM-only — CoreData enforces.
 *
 * @param {string} type            'deployment' | 'golives'
 * @param {string} idOrAccount     DeploymentID for deployment; AccountName for golives
 * @param {string} classification  'Monthly' | 'Structural'
 */
function setOverrideClassificationForUI(type, idOrAccount, classification) {
  return CoreLib.CoreData.setOverrideClassification(APP_CONFIG, type, idOrAccount, classification);
}

/**
 * Bulk clear monthly overrides for the current calendar month.
 * PM-only — CoreData enforces.
 */
function bulkClearMonthlyOverridesForUI() {
  return CoreLib.CoreData.bulkClearMonthlyOverrides(APP_CONFIG);
}

/**
 * Bulk clear ALL active overrides regardless of date or classification.
 * PM-only — CoreData enforces.
 */
function bulkClearAllOverridesForUI() {
  return CoreLib.CoreData.bulkClearAllOverrides(APP_CONFIG);
}
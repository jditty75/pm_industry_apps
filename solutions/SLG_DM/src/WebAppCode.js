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

/**
 * Phase 3c: builds the Outlook-optimized report HTML and runs analytics first.
 * Paired with getHtmlReportPreview() for the Report tab view toggle.
 */
function getHtmlReportPreviewOutlook() {
  CoreLib.CoreAnalytics.update(APP_CONFIG);
  return CoreLib.CoreReport.buildOutlookHtml(APP_CONFIG);
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
 * Combined meta + overrides update for a deployment. Phase 2: CoreData writes
 * an OverrideAudit row. Phase 3d: accepts optional notes (override reason).
 */
function updateDeploymentWithMetaAndOverride(rowIndex, deploymentId, metaData, overrideData, notes) {
  return CoreLib.CoreData.updateDeploymentWithMetaAndOverride(
    APP_CONFIG, deploymentId, metaData, overrideData, notes
  );
}

/**
 * Go Lives overrides update. Phase 2: CoreData writes audit row.
 * Phase 3d: accepts optional notes (override reason).
 */
function updateGoLivesOverride(accountName, overrideData, notes) {
  return CoreLib.CoreData.updateGoLivesOverride(APP_CONFIG, accountName, overrideData, notes);
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
 * Phase 3f: returns the last N audit entries for a specific deployment.
 * Used by the expanded row detail inline audit summary. Visible to all roles.
 *
 * @param {string} deploymentId  Salesforce deployment ID or accountName
 * @param {number=} limit        Max rows to return (default 3)
 */
function getDeploymentAuditSummaryForUI(deploymentId, limit) {
  return CoreLib.CoreData.getDeploymentAuditSummary(APP_CONFIG, deploymentId, limit);
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

/**
 * Diagnostic: Lists which deployments are Phased and verifies they're also
 * flagged correctly in the data that feeds the Deployments tab.
 *
 * Logs three sections:
 *   1. The raw enrichment map's phased deployments (from CoreSalesforce)
 *   2. The same deployments after going through CoreData.getAllDeployments
 *      (which is what the WebApp's Deployments tab actually consumes)
 *   3. Any mismatches between the two
 */
function _diagnose_phased_deployments() {
  Logger.log('=== PART 1: Phased deployments from enrichment map ===');
  var enrichmentMap = CoreLib.CoreSalesforce.getDeploymentEnrichmentMap(APP_CONFIG);
  var phasedFromEnrichment = [];

  Object.keys(enrichmentMap).forEach(function(deploymentId) {
    var enrichment = enrichmentMap[deploymentId];
    if (enrichment.isPhased) {
      phasedFromEnrichment.push({
        deploymentId: deploymentId,
        upcomingDates: enrichment.upcomingDates,
        nextGoLiveDate: enrichment.nextGoLiveDate,
        productFunctionCount: enrichment.productFunctionCount
      });
    }
  });

  Logger.log('Total deployments in enrichment map: ' + Object.keys(enrichmentMap).length);
  Logger.log('Phased deployments in enrichment map: ' + phasedFromEnrichment.length);
  phasedFromEnrichment.forEach(function(item, i) {
    Logger.log('\nPhased ' + (i + 1) + ': ' + item.deploymentId);
    Logger.log('  Next go-live: ' + item.nextGoLiveDate);
    Logger.log('  Total products: ' + item.productFunctionCount);
    item.upcomingDates.forEach(function(date) {
      Logger.log('  ' + date.date + ': ' + date.products.join(', '));
    });
  });

  Logger.log('\n=== PART 2: Same deployments via CoreData.getAllDeployments ===');
  Logger.log('(This is what the Deployments tab actually reads.)');

  // Call the function the Deployments tab uses, with no viewMode (full team view)
  var allDeployments = CoreLib.CoreData.getAllDeployments(APP_CONFIG, { viewMode: 'all', ddDisplayName: '' });

  // Find phased deployments by looking for isPhased: true
  var phasedFromAllDeployments = allDeployments.filter(function(row) {
    return row.isPhased === true;
  });

  Logger.log('Total deployments from getAllDeployments: ' + allDeployments.length);
  Logger.log('Deployments with isPhased=true: ' + phasedFromAllDeployments.length);

  if (phasedFromAllDeployments.length > 0) {
    Logger.log('\nPhased deployments (with account names):');
    phasedFromAllDeployments.forEach(function(row, i) {
      Logger.log((i + 1) + ': ' + row.accountName + ' [' + row.deploymentId + '] (' + row.health + ')');
    });
  } else {
    Logger.log('\nWARNING: No deployments have isPhased=true in getAllDeployments output.');
    Logger.log('This means CoreData.getAllDeployments is NOT injecting the flag.');
  }

  Logger.log('\n=== PART 3: Cross-check ===');
  var enrichmentIds = phasedFromEnrichment.map(function(p) { return p.deploymentId; });
  var allDeploymentIds = phasedFromAllDeployments.map(function(p) { return p.deploymentId; });

  // Find IDs in enrichment but missing from getAllDeployments output
  var missingFromAll = enrichmentIds.filter(function(id) {
    return allDeploymentIds.indexOf(id) === -1;
  });

  if (missingFromAll.length > 0) {
    Logger.log('\nDeploymentIDs that are phased in enrichment but missing isPhased=true in getAllDeployments:');
    missingFromAll.forEach(function(id) {
      Logger.log('  ' + id);
      // Look up what getAllDeployments has for this deployment
      var match = allDeployments.find(function(row) { return row.deploymentId === id; });
      if (match) {
        Logger.log('    Found in getAllDeployments output: accountName="' + match.accountName + '", health="' + match.health + '", isPhased=' + match.isPhased);
      } else {
        Logger.log('    Not found in getAllDeployments output at all.');
      }
    });
  } else if (phasedFromEnrichment.length > 0) {
    Logger.log('\nAll phased deployments from enrichment are correctly flagged in getAllDeployments. ✓');
  }

  Logger.log('\n=== END DIAGNOSTIC ===');
}
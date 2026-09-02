/**
 * EVI_DM Deployment Health Web App — Server-side wiring layer.
 *
 * NOTE:
 *   - Core data / analytics / reporting logic lives in CoreLib.
 *   - Requires APP_CONFIG from Config_EVI.js.
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
    activeUsers: CoreLib.CoreUsers.getActiveUsers(APP_CONFIG),
    access: CoreLib.CoreUsers.getCurrentUserAccess(APP_CONFIG)
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
function getAllDeploymentsForUI(viewModeOpts, productOpts) {
  return CoreLib.CoreData.getAllDeploymentsForUI(APP_CONFIG, viewModeOpts, productOpts);
}

/**
 * Phase 3i: New endpoint — returns Recent Go Lives from SFDC_Deployments
 * (Complete deployments) via CoreData.getRecentGoLives().
 *
 * @param {Object=} viewModeOpts  { viewMode: 'my'|'all', ddDisplayName: string }
 */
function getRecentGoLivesData(viewModeOpts, productOpts) {
  return CoreLib.CoreData.getRecentGoLives(APP_CONFIG, viewModeOpts || {}, undefined, productOpts);
}

/**
 * Phase 1 endpoint, extended in Phase 2 to forward viewModeOpts.
 *
 * @param {Object=} viewModeOpts
 */
function getUpcomingGoLivesData(viewModeOpts, productOpts) {
  return CoreLib.CoreData.getUpcomingGoLives(APP_CONFIG, viewModeOpts, productOpts);
}

// ============================================================================
// MDS / PGL — MONTH-BATCH SURVEY VIEW
// ============================================================================

/**
 * Returns the MDS/PGL month-grouped batch view for the requested horizon.
 *
 * @param {Object=} viewModeOpts  { viewMode:'my'|'all', ddDisplayName:string }
 * @param {number=} windowMonths  3 or 6. Default 3.
 */
function getMdsPglBatchViewForUI(viewModeOpts, windowMonths) {
  return CoreLib.CoreData.getMdsPglBatchView(
    APP_CONFIG,
    viewModeOpts || {},
    (windowMonths === 6) ? 6 : 3
  );
}

/**
 * UI Endpoint Wrapper: Fetch CSAT Tab Data
 * @param {Object=} viewModeOpts
 * @param {number=} windowMonths  3 or 6. Default 3.
 */
function getCsatTabDataForUI(viewModeOpts, windowMonths, productOpts) {
  var cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  return CoreLib.CoreData.getCsatTabDataForUI(
    cfg,
    viewModeOpts,
    (windowMonths === 6) ? 6 : 3,
    productOpts
  );
}

/**
 * UI Endpoint Wrapper: Upload CSAT In-Flight CSV
 */
function uploadCsatInFlightCsvForUI(viewModeOpts, csvText) {
  var cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  return CoreLib.CoreData.uploadCsatInFlightCsvForUI(cfg, csvText);
}

/**
 * UI Endpoint Wrapper: Validate NotificationConfig rows.
 * @param {Object=} opts
 * @return {{valid:Array<Object>, invalid:Array<Object>}}
 */
function validateNotificationConfigForUI(opts) {
  return CoreLib.CoreNotify.validateNotificationConfig(APP_CONFIG);
}

/**
 * UI Endpoint Wrapper: Send a test survey notification.
 * @param {Object=} opts
 * @param {string} notificationKey
 * @param {string=} recipient
 * @return {boolean}
 */
function sendTestNotificationForUI(opts, notificationKey, recipient) {
  return CoreLib.CoreNotify.sendTestNotification(APP_CONFIG, notificationKey, recipient);
}

/**
 * UI Endpoint Wrapper: Edit an existing NotificationConfig rule.
 * @param {Object=} opts
 * @param {Object} rule
 * @return {{success:boolean, updated:boolean, status:string, error?:string}}
 */
function upsertNotificationRuleForUI(opts, rule) {
  return CoreLib.CoreNotify.upsertNotificationRule(APP_CONFIG, rule);
}

/**
 * UI Endpoint Wrapper: Filtered CSAT survey notification audit log.
 * @param {Object=} opts
 * @return {{rows:Array<Object>, total:number}}
 */
function getDistributionLogDataForUI(opts) {
  var cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  return CoreLib.CoreData.getDistributionLogDataForUI(cfg);
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

/** Preview the exact V2 HTML that the Gmail send path emits. */
function getGmailReportPreview() {
  return CoreLib.CoreReport.buildReportV2WithAnalytics(APP_CONFIG);
}

/**
 * Diagnostic: report preview build with phase timings (no email).
 * @return {{ totalMs: number, phases: Array<Object> }}
 */
function _debugGmailReportPreviewPerformance() {
  return CoreLib.CoreReport.debugGmailReportPreviewPerformance(APP_CONFIG);
}

/**
 * N8: production native Gmail send for the V2 monthly report.
 * @return {{status: string, error?: string}}
 */
function sendMonthlyReport() {
  return CoreLib.CoreDistribute.sendMonthlyReport(APP_CONFIG);
}

/**
 * N8: test send to self — no distribution log row.
 * @param {string=} recipient
 * @return {{status: string, error?: string}}
 */
function sendMonthlyReportTest(recipient) {
  return CoreLib.CoreDistribute.sendMonthlyReportTest(APP_CONFIG, recipient);
}

/**
 * N9: returns send config for the compose modal; canSend gates the UI.
 * @return {Object}
 */
function getReportSendConfigForUI() {
  var cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  var me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  var allowed = (cfg.report.distribution.allowedSenders || []).map(function (e) {
    return String(e).toLowerCase();
  });
  var monthLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM yyyy');
  var subject = (cfg.report.distribution.subjectTemplate || '')
    .replace(/\{\{appTitle\}\}/g, (cfg.ui && cfg.ui.appTitle) || cfg.report.title || cfg.appId)
    .replace(/\{\{monthLabel\}\}/g, monthLabel);
  return {
    canSend: allowed.indexOf(me) !== -1,
    enabled: !!cfg.report.distribution.enabled,
    to: (cfg.report.distribution.to || []).join(', '),
    cc: (cfg.report.distribution.cc || []).join(', '),
    bcc: cfg.report.distribution.bcc || '',
    fromAlias: cfg.report.distribution.fromAlias || '',
    allowedAliases: cfg.notify.allowedFromAliases || [],
    subject: subject,
    testDefaultRecipient: me || cfg.notify.testDefaultRecipient || ''
  };
}

/**
 * N9: admin-gated production send. Server re-checks allowedSenders.
 * @param {Object=} envelope
 * @return {{status: string, error?: string}}
 */
function sendMonthlyReportFromUI(envelope) {
  var cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  var me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  var allowed = (cfg.report.distribution.allowedSenders || []).map(function (e) {
    return String(e).toLowerCase();
  });
  if (allowed.indexOf(me) === -1) {
    return { status: 'denied', error: 'Not authorized to send the monthly report.' };
  }
  return CoreLib.CoreDistribute.sendMonthlyReport(APP_CONFIG, { force: true, envelope: envelope || {} });
}

/**
 * N9: admin-gated test send — no log row.
 * @param {Object=} envelope
 * @return {{status: string, error?: string}}
 */
function sendMonthlyReportTestFromUI(envelope) {
  var cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  var me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  var allowed = (cfg.report.distribution.allowedSenders || []).map(function (e) {
    return String(e).toLowerCase();
  });
  if (allowed.indexOf(me) === -1) {
    return { status: 'denied', error: 'Not authorized.' };
  }
  var to = (envelope && envelope.to) || Session.getActiveUser().getEmail();
  return CoreLib.CoreDistribute.sendMonthlyReportTest(APP_CONFIG, to);
}

/**
 * N9: Send Log rows filtered to Monthly Report category.
 * @return {{rows: Array<Object>, total: number}}
 */
function getReportSendLogForUI() {
  return CoreLib.CoreDistribute.getMonthlyReportSendLog(APP_CONFIG);
}

// ============================================================================
// PHASE 1 — PORTFOLIO HEALTH (unchanged)
// ============================================================================

function getPortfolioHealthData(viewModeOpts, productOpts) {
  return CoreLib.CorePortfolioHealth.getSnapshot(APP_CONFIG, viewModeOpts, productOpts);
}

/**
 * P2: Portfolio Momentum server endpoint.
 * Returns null if momentum is not enabled for this app.
 */
function getPortfolioMomentumData() {
  return CoreLib.CorePortfolioMomentum.getMomentumSnapshot(APP_CONFIG);
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

// ============================================================================
// PERFORMANCE LAYER 2: CACHE PRE-WARMING
// ============================================================================
// Called by an Apps Script time-based trigger (set up manually in Jeff's
// runbook). Pre-warms the _PerfCache sheet so user-triggered endpoints hit
// warm cache instead of paying cold-start computation.
// ============================================================================

function _warmCaches() {
  return CoreLib.CoreSalesforce._warmCaches(APP_CONFIG);
}

// ============================================================================
// N4 — DATA FRESHNESS MONITORING
// ============================================================================

/**
 * Returns data-freshness signal for the header badge (L1).
 * @return {Object}
 */
function getDataFreshnessForUI() {
  return CoreLib.CoreFreshnessMonitor.getFreshnessForUI(APP_CONFIG);
}

/**
 * L2 alert entry point — installed manually as a 4-hourly time-based trigger.
 * @return {void}
 */
function checkDataFreshness() {
  return CoreLib.CoreData.checkDataFreshnessAndAlert_(APP_CONFIG);
}

// ============================================================================
// N7 — MDS/PGL NOTIFICATIONS
// ============================================================================

/**
 * Daily trigger entry point for config-driven MDS/PGL notifications.
 * @return {void}
 */
function runNotifications() {
  return CoreLib.CoreNotify.runNotifications(APP_CONFIG);
}

/**
 * Validates NotificationConfig rows and writes per-row status.
 * @return {{valid:Array<Object>, invalid:Array<Object>}}
 */
function validateNotificationConfig() {
  return CoreLib.CoreNotify.validateNotificationConfig(APP_CONFIG);
}

/**
 * Side-effect-free test send via production render path.
 * @param {string} notificationKey
 * @param {string=} recipient
 * @return {boolean}
 */
function sendTestNotification(notificationKey, recipient) {
  return CoreLib.CoreNotify.sendTestNotification(APP_CONFIG, notificationKey, recipient);
}

/**
 * One-time idempotent setup for the NotificationConfig sheet tab.
 * @return {void}
 */
function initNotificationConfigSheet() {
  return CoreLib.CoreNotify.initNotificationConfigSheet(APP_CONFIG);
}

/**
 * One-time idempotent setup for the ReportDistributionLog sheet tab.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function initReportDistributionLog() {
  return CoreLib.CoreDistribute.initReportDistributionLog(APP_CONFIG);
}

// ============================================================================
// NOTABLE DEPLOYMENTS (Part 2)
// ============================================================================

/**
 * Returns the list of notable deployments for this app, joined with local
 * effective deployments. Delegates to CoreLib.CoreNotable.getNotableForApp.
 *
 * @return {Array<Object>}
 */
function getNotableData() {
  return CoreLib.CoreNotable.getNotableForApp(APP_CONFIG);
}

/**
 * Updates editable fields on an existing notable peer row.
 * Errors (including access-denied) propagate unchanged to the client.
 *
 * @param {string} deploymentId  Full or 15-char-prefix SFDC Deployment ID.
 * @param {Object} fieldUpdates  Map of editable header name -> new value.
 * @param {string=} notes        Optional change notes.
 * @return {{ success: boolean, rowIndex: number }}
 */
function updateNotable(deploymentId, fieldUpdates, notes) {
  return CoreLib.CoreNotable.updateNotableDeployment(
    APP_CONFIG,
    deploymentId,
    fieldUpdates,
    notes
  );
}

/**
 * Adds a new notable row for a deployment in this app's effective deployments.
 * Errors propagate unchanged to the client. If a peer row already exists,
 * CoreNotable throws an error whose message starts with "DUPLICATE:" — the
 * client can detect this prefix and redirect to edit instead of add.
 *
 * @param {string} deploymentId  Full or 15-char-prefix SFDC Deployment ID.
 * @param {Object} fieldUpdates  Field overrides; must include 'Notability Trigger'.
 * @param {string=} notes        Optional change notes.
 * @return {{ success: boolean, rowIndex: number }}
 */
function addNotable(deploymentId, fieldUpdates, notes) {
  return CoreLib.CoreNotable.addNotableDeployment(
    APP_CONFIG,
    deploymentId,
    fieldUpdates,
    notes
  );
}

/**
 * Returns a combined array of recent and upcoming go-live deployments for the
 * Notable Deployment picker. Each entry is a lightweight object suitable for
 * client-side rendering. Does not filter out deployments already in the notable
 * list — the client can overlay that if needed.
 *
 * @return {Array<{deploymentId:string, accountName:string, deploymentName:string,
 *                 industry:string, mtpDate:string|null, goLiveDate:string|null,
 *                 view:string}>}
 */
function getGoLivesForNotablePicker() {
  var _cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  var _lookback = (_cfg.notable && _cfg.notable.pickerLookbackDays) || 180;
  var recent = CoreLib.CoreData.getRecentGoLivesForNotablePicker(APP_CONFIG, {}, _lookback) || [];
  var upcoming = CoreLib.CoreData.getUpcomingGoLives(APP_CONFIG, {}) || [];  // unchanged

  var results = [];

  recent.forEach(function (row) {
    results.push({
      deploymentId:   row.deploymentId   || '',
      accountName:    row.accountName    || '',
      deploymentName: row.deploymentName || '',
      industry:       row.industry       || '',
      mtpDate:        null,
      goLiveDate:     row.lastGoLiveDate || null,
      view:           'recent'
    });
  });

  upcoming.forEach(function (row) {
    results.push({
      deploymentId:   row.deploymentId              || '',
      accountName:    row.accountName               || '',
      deploymentName: row.deploymentName            || '',
      industry:       row.industry                  || '',
      mtpDate:        row.nextGoLiveDate || row.mtpDate || null,
      goLiveDate:     null,
      view:           'upcoming'
    });
  });

  return results;
}
// ============================================================================
// OVERVIEW TAB DATA
// ============================================================================

/**
 * Returns the Overview tab snapshot (totals, topHighRisk, upcomingGoLives,
 * lifecycleBuckets). Delegates to CoreLib with 5-min _PerfCache backing.
 *
 * @return {Object}
 */
function getOverviewData(viewModeOpts, productOpts) {
  return CoreLib.CoreData.getOverviewSnapshot(APP_CONFIG, viewModeOpts, productOpts);
}

function _getOverviewData_legacy_() {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();

    // ── Read SFDC_Deployments ───────────────────────────────────────────
    var depSheet = ss.getSheetByName((APP_CONFIG.sheets && APP_CONFIG.sheets.deployments) || 'SFDC_Deployments');
    var depData  = (depSheet && depSheet.getLastRow() > 1)
      ? depSheet.getRange(2, 1, depSheet.getLastRow() - 1,
                          depSheet.getLastColumn()).getValues()
      : [];

    // 0-based confirmed column indices
    var C_ID         = 0;
    var C_NAME       = 1;
    var C_ACCOUNT_ID = 2;
    var C_ACCOUNT    = 3;
    var C_MTP        = 11;
    var C_FIRST_MTP  = 12;
    var C_STATUS     = 13;
    var C_STAGE      = 15;
    var C_HEALTH     = 16;
    var C_PARTNER    = 22;

    var now             = new Date();
    var thirtyDaysAgo   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    var thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    var totalActive = 0, red = 0, yellow = 0, green = 0;
    var recentGoLives = 0, upcomingGoLives = 0;
    var stageMap = {};
    var topRedRows = [], upcomingRows = [];

    depData.forEach(function(r) {
      var status = (r[C_STATUS] || '').toString().trim();
      var health = (r[C_HEALTH] || '').toString().trim();

      if (status === 'Active') {
        totalActive++;
        if      (health === 'Red')    red++;
        else if (health === 'Yellow') yellow++;
        else if (health === 'Green')  green++;

        var stage = (r[C_STAGE] || 'Unknown').toString().trim();
        stageMap[stage] = (stageMap[stage] || 0) + 1;

        var mtp = r[C_MTP] ? new Date(r[C_MTP]) : null;
        if (mtp && !isNaN(mtp) && mtp >= now && mtp <= thirtyDaysAhead) {
          upcomingGoLives++;
          upcomingRows.push({
            accountName:    (r[C_ACCOUNT] || '').toString(),
            deploymentName: (r[C_NAME]    || '').toString(),
            mtpDate:        r[C_MTP] ? r[C_MTP].toString() : ''
          });
        }

        if (health === 'Red') {
          topRedRows.push({
            accountName:    (r[C_ACCOUNT] || '').toString(),
            deploymentName: (r[C_NAME]    || '').toString(),
            partner:        (r[C_PARTNER] || '').toString(),
            mtpDate:        r[C_MTP] ? r[C_MTP].toString() : ''
          });
        }
      }

      if (status === 'Complete') {
        var firstMtp = r[C_FIRST_MTP] ? new Date(r[C_FIRST_MTP]) : null;
        if (firstMtp && !isNaN(firstMtp) &&
            firstMtp >= thirtyDaysAgo && firstMtp <= now) {
          recentGoLives++;
        }
      }
    });

    // Sort and trim lists
    topRedRows.sort(function(a, b) {
      return new Date(a.mtpDate || 0) - new Date(b.mtpDate || 0);
    });
    topRedRows = topRedRows.slice(0, 5);

    upcomingRows.sort(function(a, b) {
      return new Date(a.mtpDate || 0) - new Date(b.mtpDate || 0);
    });
    upcomingRows = upcomingRows.slice(0, 5);

    var byStage = Object.keys(stageMap).sort().map(function(s) {
      return { stage: s, count: stageMap[s] };
    });

    // ── Read SFDC_Wellness — count executive watch deployments ──────────
    var wellnessSheet = ss.getSheetByName((APP_CONFIG.sheets && APP_CONFIG.sheets.wellness) || 'SFDC_Wellness');
    var wellnessAccountIds = {};
    if (wellnessSheet && wellnessSheet.getLastRow() > 1) {
      wellnessSheet.getRange(2, 1, wellnessSheet.getLastRow() - 1, 2)
        .getValues().forEach(function(r) {
          var aid = (r[1] || '').toString().slice(0, 15);
          if (aid) wellnessAccountIds[aid] = true;
        });
    }
    var executiveWatchCount = 0;
    depData.forEach(function(r) {
      if ((r[C_STATUS] || '').toString().trim() !== 'Active') return;
      var aid = (r[C_ACCOUNT_ID] || '').toString().slice(0, 15);
      if (wellnessAccountIds[aid]) executiveWatchCount++;
    });

    return {
      deployments: {
        total:   totalActive,
        red:     red,
        yellow:  yellow,
        green:   green,
        byStage: byStage,
        topRed:  topRedRows
      },
      goLives: {
        recentCount:   recentGoLives,
        upcomingCount: upcomingGoLives,
        upcomingList:  upcomingRows
      },
      executiveWatch: { count: executiveWatchCount }
    };
  } catch(e) {
    return { error: e.toString() };
  }
}

/**
 * D1 diagnostic passthrough. Run from the Apps Script editor.
 */
function _debugDdFromContacts_SLG() {
  return CoreLib.CoreData._debugDdFromContacts_(APP_CONFIG);
}

function _debugSfdcColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = CoreLib.CoreConfig.withDefaults(APP_CONFIG);
  var sheetNames = [
    cfg.sheets.deployments || 'SFDC_Deployments',
    cfg.sheets.sfdcDeploymentProductFunctions || 'SFDC_DeploymentProductFunctions',
    'SFDC_Wellness'
  ];

  sheetNames.forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log('--- ' + sheetName + ': NOT FOUND ---');
      return;
    }
    Logger.log('--- ' + sheetName + ' ---');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    headers.forEach(function(h, i) {
      Logger.log('Col ' + (i + 1) + ' (index ' + i + '): ' + h);
    });
  });
}

/**
 * ProductMode active deployment union diagnostic. Run from the Apps Script editor.
 * Compares workbook parent/PF counts to getAllDeployments output.
 */
function _debugProductModeActiveDeploymentsUnion() {
  var summary = CoreLib.CoreData._debugProductModeActiveDeploymentsUnion(APP_CONFIG);
  Logger.log('\n=== getAllDeployments cross-check ===');
  var deployments = CoreLib.CoreData.getAllDeployments(APP_CONFIG, { viewMode: 'all', ddDisplayName: '' });
  var bySource = { parent: 0, productFunction: 0, productFunctionGrouped: 0, other: 0 };
  deployments.forEach(function (r) {
    var src = r.deploymentRowSource || 'other';
    if (bySource[src] !== undefined) bySource[src]++;
    else bySource.other++;
  });
  Logger.log('getAllDeployments count=' + deployments.length);
  Logger.log('getAllDeployments by deploymentRowSource=' + JSON.stringify(bySource));
  if (summary.countByParentMatchStatus) {
    Logger.log('getAllEffectiveDeployments by parentMatchStatus=' +
      JSON.stringify(summary.countByParentMatchStatus));
  }
  summary.getAllDeploymentsCount = deployments.length;
  summary.getAllDeploymentsBySource = bySource;
  return summary;
}

/**
 * ProductMode deployment display-grain diagnostic. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugProductModeDeploymentDisplayGrain() {
  return CoreLib.CoreData._debugProductModeDeploymentDisplayGrain(APP_CONFIG);
}

/**
 * ProductMode count-grain vs display-grain diagnostic. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugProductModeCounts() {
  return CoreLib.CoreData._debugProductModeCounts(APP_CONFIG);
}

/**
 * Data freshness diagnostic for the header badge. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugDataFreshness() {
  return CoreLib.CoreFreshnessMonitor._debugDataFreshness(APP_CONFIG);
}

/**
 * Comprehensive ProductMode source diagnostic. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugProductModeSources() {
  return CoreLib.CoreData._debugProductModeSources(APP_CONFIG, 10);
}

/**
 * ProductMode PF go-live event diagnostic. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugProductModeGoLiveEvents() {
  return CoreLib.CoreData._debugProductModeGoLiveEvents(APP_CONFIG, { product: 'all' });
}

/**
 * Overview Next High Risk widget diagnostic. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugOverviewNextHighRisk() {
  return CoreLib.CoreData._debugOverviewNextHighRisk(APP_CONFIG, { product: 'all' });
}

/**
 * Deployment Health Plan diagnostic. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugDeploymentHealthPlan() {
  return CoreLib.CoreData._debugDeploymentHealthPlan(APP_CONFIG);
}

/**
 * Wellness / Executive Watch diagnostic. Run from the Apps Script editor.
 * @return {Object}
 */
function _debugWellnessData() {
  return CoreLib.CoreData._debugWellnessData(APP_CONFIG);
}

// ===========================================================================
// TRENDS TAB ENDPOINTS (T1)
// ===========================================================================

/**
 * @param {Object=} viewModeOpts
 * @return {Object}
 */
function getTrendsTimeInRedData(viewModeOpts) {
  return CoreLib.CoreTrends.getTimeInRedMetrics(
    APP_CONFIG,
    viewModeOpts || {},
    CacheService.getScriptCache()
  );
}

/**
 * @return {Object}
 */
function getTrendsHealthTrajectoryData() {
  return CoreLib.CoreTrends.getHealthTrajectory(
    APP_CONFIG,
    CacheService.getScriptCache()
  );
}

/**
 * @param {Object=} viewModeOpts
 * @return {Object}
 */
function getTrendsHealthByPartnerData(viewModeOpts) {
  return CoreLib.CoreTrends.getHealthByPartner(
    APP_CONFIG,
    viewModeOpts || {},
    CacheService.getScriptCache()
  );
}

/**
 * @param {Object=} viewModeOpts
 * @return {Object}
 */
function getTrendsHealthByDeliveryDirectorData(viewModeOpts) {
  return CoreLib.CoreTrends.getHealthByDeliveryDirector(
    APP_CONFIG,
    viewModeOpts || {},
    CacheService.getScriptCache()
  );
}

/**
 * @param {Object=} viewModeOpts
 * @return {Object}
 */
function getTrendsTimeInStageData(viewModeOpts) {
  return CoreLib.CoreTrends.getTimeInStageMetrics(
    APP_CONFIG,
    viewModeOpts || {},
    CacheService.getScriptCache()
  );
}

/**
 * @param {Object=} viewModeOpts
 * @return {Object}
 */
function getTrendsTimeToGoLiveData(viewModeOpts) {
  return CoreLib.CoreTrends.getTimeToGoLiveMetrics(
    APP_CONFIG,
    viewModeOpts || {},
    CacheService.getScriptCache()
  );
}

/**
 * @param {Object=} viewModeOpts
 * @return {Object}
 */
function getTrendsGoLiveOutcomeData(viewModeOpts) {
  return CoreLib.CoreTrends.getGoLiveOutcomePatterns(
    APP_CONFIG,
    viewModeOpts || {},
    CacheService.getScriptCache()
  );
}

function _debug_personalization() {
  // 1. What names are in AppUsers?
  var users = CoreLib.CoreUsers.getActiveUsers(APP_CONFIG);
  Logger.log('AppUsers displayNames:');
  users.forEach(function(u) {
    Logger.log('  "' + u.displayName + '" (role=' + u.role + ')');
  });

  // 2. What does the DD Assignment map look like?
  var map = CoreLib.CoreUsers.getDDAssignmentMap(APP_CONFIG);
  var mapKeys = Object.keys(map);
  Logger.log('DD Assignment map has ' + mapKeys.length + ' entries');
  Logger.log('Sample entries:');
  mapKeys.slice(0, 5).forEach(function(k) {
    Logger.log('  "' + k + '" -> "' + map[k] + '"');
  });

  // 3. What accountName values are on effective deployments?
  var deployments = CoreLib.CoreData.getAllDeployments(APP_CONFIG, { viewMode: 'all', ddDisplayName: '' });
  Logger.log('Deployment accountName sample:');
  deployments.slice(0, 5).forEach(function(d) {
    Logger.log('  "' + d.accountName + '"');
  });

  // 4. For a specific DD, how many rows would match?
  var testDD = 'Steve Rogers'; // or whichever you tested
  var filtered = CoreLib.CoreUsers.filterRowsByAccountOwner(APP_CONFIG, deployments, testDD);
  Logger.log('filterRowsByAccountOwner("' + testDD + '") returned ' + filtered.length + ' rows');

  // 5. Cross-reference: which account names in the DD map actually exist in deployments?
  var deploymentNames = {};
  deployments.forEach(function(d) { deploymentNames[d.accountName] = true; });
  var matchedInMap = mapKeys.filter(function(k) { return deploymentNames[k]; });
  var unmatchedInMap = mapKeys.filter(function(k) { return !deploymentNames[k]; });
  Logger.log('DD map entries that match a deployment accountName: ' + matchedInMap.length);
  Logger.log('DD map entries with NO matching deployment: ' + unmatchedInMap.length);
  Logger.log('First 5 unmatched map entries:');
  unmatchedInMap.slice(0, 5).forEach(function(k) {
    Logger.log('  "' + k + '" (owned by "' + map[k] + '")');
  });
}

function _debug_c1_cache_smoke() {
  var testKey = 'c1-smoke-test-' + Date.now();
  var testValue = { hello: 'world', numbers: [1,2,3,4,5] };

  CoreLib.CoreData._perfCacheWrite_(testKey, testValue);
  var read = CoreLib.CoreData._perfCacheRead_(testKey);
  Logger.log('Small match: ' + (JSON.stringify(read) === JSON.stringify(testValue)));

  var largeKey = 'c1-smoke-large-' + Date.now();
  var largeArr = [];
  for (var i = 0; i < 5000; i++) largeArr.push({ idx: i, name: 'deployment_' + i });

  CoreLib.CoreData._perfCacheWrite_(largeKey, largeArr);
  var readLarge = CoreLib.CoreData._perfCacheRead_(largeKey);
  Logger.log('Large match: length=' + (readLarge && readLarge.length) + ' (expected 5000)');

  CoreLib.CoreData._perfCacheDeleteKey_(testKey);
  CoreLib.CoreData._perfCacheDeleteKey_(largeKey);
  Logger.log('Post-delete (should be null): ' + CoreLib.CoreData._perfCacheRead_(testKey));
}

function _debug_c1_realpath_v2() {
  var appId = APP_CONFIG.appId;

  // First: check what's in CacheService BEFORE any call (should be null after fresh start).
  var cache = CacheService.getScriptCache();
  var preCheck = cache.get('sfdcRows:' + appId);
  var preManifest = cache.get('sfdcRows:' + appId + ':manifest');
  Logger.log('BEFORE any call:');
  Logger.log('  sfdcRows single: ' + (preCheck ? 'PRESENT (' + preCheck.length + ' chars)' : 'null'));
  Logger.log('  sfdcRows manifest: ' + (preManifest ? 'PRESENT (' + preManifest + ')' : 'null'));

  // Second: make the call.
  var startTime = Date.now();
  var deployments = CoreLib.CoreData.getAllDeployments(APP_CONFIG, { viewMode: 'all', ddDisplayName: '' });
  var elapsed = Date.now() - startTime;
  Logger.log('getAllDeployments returned ' + deployments.length + ' rows in ' + elapsed + 'ms');

  // Third: check CacheService IMMEDIATELY after — but also with 500ms delay in case async.
  Logger.log('AFTER call, immediate check:');
  var postCheck = cache.get('sfdcRows:' + appId);
  var postManifest = cache.get('sfdcRows:' + appId + ':manifest');
  Logger.log('  sfdcRows single: ' + (postCheck ? 'PRESENT (' + postCheck.length + ' chars)' : 'null'));
  Logger.log('  sfdcRows manifest: ' + (postManifest ? 'PRESENT (' + postManifest + ')' : 'null'));

  // Fourth: check ALL keys we might expect.
  Logger.log('AFTER call, checking all expected keys:');
  var allKeys = [
    'sfdcRows:' + appId,
    'sfdcRows:' + appId + ':manifest',
    'enrichmentMap:' + appId,
    'enrichmentMap:' + appId + ':manifest',
    'ddContacts:' + appId,
    'ddContacts:' + appId + ':manifest',
    'mdsPglBatchView:' + appId + ':3',
    'mdsPglBatchView:' + appId + ':3:manifest',
    'overviewData:' + appId + ':v2',
    'overviewData:' + appId + ':v2:manifest'
  ];
  allKeys.forEach(function(k) {
    var v = cache.get(k);
    Logger.log('  ' + k + ': ' + (v ? 'PRESENT (' + v.length + ' chars)' : 'null'));
  });
}

function _debug_c1_verify_working_v2() {
  Logger.log('=== C1 Working Verification ===');

  // Step 1: Force a cold-cache condition by clearing tier-1 in DHLibrary.
  // We can't do this directly from SLG since _cache is inside DHLibrary's IIFE,
  // but we can trigger a mutation which calls _clearCache internally.
  // Instead, just measure back-to-back calls in a fresh execution.

  var t0 = Date.now();
  var d1 = CoreLib.CoreData.getAllDeployments(APP_CONFIG, { viewMode: 'all', ddDisplayName: '' });
  var e1 = Date.now() - t0;
  Logger.log('Call 1: ' + d1.length + ' rows in ' + e1 + 'ms');

  var t1 = Date.now();
  var d2 = CoreLib.CoreData.getAllDeployments(APP_CONFIG, { viewMode: 'all', ddDisplayName: '' });
  var e2 = Date.now() - t1;
  Logger.log('Call 2: ' + d2.length + ' rows in ' + e2 + 'ms');

  Logger.log('');
  Logger.log('Interpretation:');
  Logger.log('  Call 2 fast (<100ms): tier-1 in-memory is serving (same execution)');
  Logger.log('  Both calls similar (~1500ms+): NO caching happening at all');
  Logger.log('  Cannot yet distinguish tier-2 vs tier-1 in same execution.');
}

/**
 * N2 manual cache flush — run from the Apps Script editor (or wire to a menu/trigger).
 * Clears this app's CacheService entries used by CoreData/CoreSalesforce tier-2,
 * so the next data read rebuilds from the live SFDC_Deployments sheet.
 *
 * Safe to run anytime. Returns a summary of what it cleared.
 */
function flushCache() {
  var appId = (APP_CONFIG && APP_CONFIG.appId) ? APP_CONFIG.appId : 'default';

  // Known tier-2 cache-key prefixes used across CoreData + CoreSalesforce.
  var prefixes = [
    'sfdcRows:',
    'enrichmentMap:',
    'ddContacts:',
    'studentDeploymentIds:',
    'studentProductFunctions:',
    'overviewData:',
    'mdsPglBatchView:'
  ];

  var keys = [];
  prefixes.forEach(function (p) {
    var base = p + appId;
    keys.push(base);
    keys.push(base + ':manifest');
    // Clear chunked payloads (chunked writes use :chunk:N up to ~50 pieces).
    for (var i = 0; i < 50; i++) keys.push(base + ':chunk:' + i);
  });

  var cleared = 0;
  try {
    var cache = CacheService.getScriptCache();
    // removeAll tolerates keys that don't exist.
    for (var start = 0; start < keys.length; start += 100) {
      var batch = keys.slice(start, start + 100);
      cache.removeAll(batch);
      cleared += batch.length;
    }
  } catch (e) {
    Logger.log('flushCache: CacheService clear error: ' + e);
  }

  // Also clear the document cache in case any writer used it.
  try {
    var dcache = CacheService.getDocumentCache();
    if (dcache) {
      for (var s2 = 0; s2 < keys.length; s2 += 100) {
        dcache.removeAll(keys.slice(s2, s2 + 100));
      }
    }
  } catch (e2) {
    Logger.log('flushCache: DocumentCache clear error: ' + e2);
  }

  var msg = 'flushCache(' + appId + '): attempted clear of ' + keys.length +
            ' cache keys across ' + prefixes.length + ' prefixes.';
  Logger.log(msg);
  return msg;
}
function _probeGmailAdvanced() {
  try {
    var me = Gmail.Users.getProfile('me');
    Logger.log('Advanced Gmail OK — mailbox: ' + me.emailAddress +
               ', messagesTotal: ' + me.messagesTotal);
  } catch (e) {
    Logger.log('Advanced Gmail BLOCKED: ' + e);
  }
}
/**
 * Lists the send-as aliases configured on the account running this script,
 * with verification status. Diagnostic — run from the editor, or wire to the
 * N9 modal's From dropdown so it reflects REAL verified aliases.
 *
 * @return {Array<{email:string, displayName:string, isPrimary:boolean,
 *                 isDefault:boolean, verificationStatus:string, treatAsAlias:boolean}>}
 */
function listSendAsAliases() {
  var out = [];
  try {
    var me = Session.getEffectiveUser().getEmail();
    var resp = Gmail.Users.Settings.SendAs.list('me');   // advanced Gmail service
    (resp.sendAs || []).forEach(function (a) {
      out.push({
        email:              a.sendAsEmail || '',
        displayName:        a.displayName || '',
        isPrimary:          !!a.isPrimary,               // the mailbox's own address
        isDefault:          !!a.isDefault,               // default "From"
        verificationStatus: a.verificationStatus || '',  // 'accepted' = verified & usable
        treatAsAlias:       !!a.treatAsAlias
      });
    });
    Logger.log('listSendAsAliases (' + me + '): ' + JSON.stringify(out, null, 2));
  } catch (e) {
    Logger.log('listSendAsAliases: FAILED — ' + e +
      '  (is the Gmail advanced service enabled in Services?)');
  }
  return out;
}
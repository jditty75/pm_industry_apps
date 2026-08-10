/**
 * HENP Deployment Health Web App — Server-side wiring layer.
 *
 * Phase 3j + Stage 1: wired to CoreLib v12.
 * Mirrors the SLG WebApp endpoint surface; HENP-specific behavior lives
 * entirely in APP_CONFIG (Config_HENP.gs).
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
// IDENTITY BOOT (Stage 1: includes access context)
// ============================================================================

function getIdentityBoot() {
  return {
    user: CoreLib.CoreUsers.getCurrentUser(APP_CONFIG),
    activeUsers: CoreLib.CoreUsers.getActiveUsers(APP_CONFIG),
    access: CoreLib.CoreUsers.getCurrentUserAccess(APP_CONFIG)
  };
}

// ============================================================================
// DATA FETCHES
// ============================================================================

function getActiveDeploymentsData() {
  return CoreLib.CoreData.getActiveDeployments(APP_CONFIG);
}

function getAllDeploymentsForUI(viewModeOpts) {
  return CoreLib.CoreData.getAllDeployments(APP_CONFIG, viewModeOpts);
}

function getRecentGoLivesData(viewModeOpts) {
  return CoreLib.CoreData.getRecentGoLives(APP_CONFIG, viewModeOpts || {});
}

function getUpcomingGoLivesData(viewModeOpts) {
  return CoreLib.CoreData.getUpcomingGoLives(APP_CONFIG, viewModeOpts);
}

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

// ============================================================================
// EXECUTIVE SUMMARY
// ============================================================================

function getExecutiveSummaryHtml() {
  return CoreLib.CoreExecSummary.get(APP_CONFIG);
}

function saveExecutiveSummaryHtml(html) {
  return CoreLib.CoreExecSummary.save(APP_CONFIG, html);
}

// ============================================================================
// MONTHLY REPORT
// ============================================================================

function getHtmlReportPreview() {
  return CoreLib.CoreReport.buildInlineHtmlWithAnalytics(APP_CONFIG);
}

function getHtmlReportPreviewOutlook() {
  CoreLib.CoreAnalytics.update(APP_CONFIG);
  return CoreLib.CoreReport.buildOutlookHtml(APP_CONFIG);
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

// ============================================================================
// N7 — MDS/PGL NOTIFICATIONS
// ============================================================================

/**
 * Daily trigger entry point for config-driven MDS/PGL notifications.
 * @return {void}
 */
function runNotifications() {
  return CoreLib.CoreData.runNotifications(APP_CONFIG);
}

/**
 * Validates NotificationConfig rows and writes per-row status.
 * @return {{valid:Array<Object>, invalid:Array<Object>}}
 */
function validateNotificationConfig() {
  return CoreLib.CoreData.validateNotificationConfig(APP_CONFIG);
}

/**
 * Side-effect-free test send via production render path.
 * @param {string} notificationKey
 * @param {string=} recipient
 * @return {boolean}
 */
function sendTestNotification(notificationKey, recipient) {
  return CoreLib.CoreData.sendTestNotification(APP_CONFIG, notificationKey, recipient);
}

/**
 * One-time idempotent setup for the NotificationConfig sheet tab.
 * @return {void}
 */
function initNotificationConfigSheet() {
  return CoreLib.CoreData.initNotificationConfigSheet(APP_CONFIG);
}

/**
 * One-time idempotent setup for the ReportDistributionLog sheet tab.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function initReportDistributionLog() {
  return CoreLib.CoreDistribute.initReportDistributionLog(APP_CONFIG);
}

// ============================================================================
// PORTFOLIO HEALTH
// ============================================================================

function getPortfolioHealthData() {
  return CoreLib.CorePortfolioHealth.getSnapshot(APP_CONFIG);
}

/**
 * P2: Portfolio Momentum server endpoint.
 * Returns null if momentum is not enabled for this app.
 */
function getPortfolioMomentumData() {
  return CoreLib.CorePortfolioMomentum.getMomentumSnapshot(APP_CONFIG);
}
// OVERRIDES / META
// ============================================================================

function updateDeploymentWithMetaAndOverride(rowIndex, deploymentId, metaData, overrideData, notes) {
  return CoreLib.CoreData.updateDeploymentWithMetaAndOverride(
    APP_CONFIG, deploymentId, metaData, overrideData, notes
  );
}

function updateGoLivesOverride(accountName, overrideData, notes) {
  return CoreLib.CoreData.updateGoLivesOverride(APP_CONFIG, accountName, overrideData, notes);
}

// ============================================================================
// MANAGE OVERRIDES
// ============================================================================

function getAllActiveOverridesForUI(viewModeOpts) {
  return CoreLib.CoreData.getAllActiveOverrides(APP_CONFIG, viewModeOpts);
}

function getOverrideAuditLogForUI(opts) {
  return CoreLib.CoreData.getOverrideAuditLog(APP_CONFIG, opts);
}

function getDeploymentAuditSummaryForUI(deploymentId, limit) {
  return CoreLib.CoreData.getDeploymentAuditSummary(APP_CONFIG, deploymentId, limit);
}

function setOverrideClassificationForUI(type, idOrAccount, classification) {
  return CoreLib.CoreData.setOverrideClassification(APP_CONFIG, type, idOrAccount, classification);
}

function bulkClearMonthlyOverridesForUI() {
  return CoreLib.CoreData.bulkClearMonthlyOverrides(APP_CONFIG);
}

function bulkClearAllOverridesForUI() {
  return CoreLib.CoreData.bulkClearAllOverrides(APP_CONFIG);
}

// ============================================================================
// STUDENT TAB
// ============================================================================

/**
 * Returns the Student tab data payload (deployments, products, kpis).
 * Delegates to CoreLib.CoreData.buildStudentTabData_.
 *
 * @return {?Object}
 */
function getStudentTabData() {
  return CoreLib.CoreData.buildStudentTabData_(APP_CONFIG);
}

/**
 * Saves Student-specific fields (Registration Date, Notes) for a deployment.
 * Server-side enforces POWER_USER/ADMIN role, notes length, and date validity.
 *
 * @param {string} deploymentId
 * @param {{registrationDate?:string, notes?:string}} patch
 * @return {{ok:boolean, row:Object}}
 */
function saveStudentDeploymentFields(deploymentId, patch) {
  return CoreLib.CoreData.saveStudentDeploymentFields(APP_CONFIG, deploymentId, patch);
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

function _runValidation() {
  return CoreLib.CoreData._validateEffectiveDeployments(APP_CONFIG);
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
  return CoreLib.CoreData.getDataFreshness(APP_CONFIG);
}

/**
 * L2 alert entry point — installed manually as a 4-hourly time-based trigger.
 * @return {void}
 */
function checkDataFreshness() {
  return CoreLib.CoreData.checkDataFreshnessAndAlert_(APP_CONFIG);
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
function getOverviewData() {
  return CoreLib.CoreData.getOverviewSnapshot(APP_CONFIG);
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

function _debugSfdcColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = ['SFDC_Deployments', 'SFDC_Wellness'];

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
function _debug_c1_full_trace() {
  var appId = APP_CONFIG.appId;
  var testKey = 'sfdcRows:' + appId;

  Logger.log('=== FULL TRACE ===');

  // Step 1: What does HENP's own cache see?
  var henpCache = CacheService.getScriptCache();
  Logger.log('Step 1 (HENP cache, pre-call):');
  Logger.log('  single: ' + JSON.stringify(henpCache.get(testKey)));
  Logger.log('  manifest: ' + JSON.stringify(henpCache.get(testKey + ':manifest')));

  // Step 2: Trigger C1's write path.
  Logger.log('');
  Logger.log('Step 2: Calling getAllDeployments...');
  var deps = CoreLib.CoreData.getAllDeployments(APP_CONFIG, { viewMode: 'all', ddDisplayName: '' });
  Logger.log('  Returned ' + deps.length + ' rows');

  // Step 3: Immediately check HENP's cache.
  Logger.log('');
  Logger.log('Step 3 (HENP cache, immediately after):');
  Logger.log('  single: ' + JSON.stringify(henpCache.get(testKey)));
  Logger.log('  manifest: ' + JSON.stringify(henpCache.get(testKey + ':manifest')));

  // Step 4: Test HENP writing to and reading from its own cache directly.
  Logger.log('');
  Logger.log('Step 4: HENP direct write/read test:');
  var directKey = 'henp-direct-' + Date.now();
  henpCache.put(directKey, 'test payload from HENP', 300);
  var directRead = henpCache.get(directKey);
  Logger.log('  Wrote and read back: ' + directRead);
  henpCache.remove(directKey);
}
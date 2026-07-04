/**
 * HC Deployment Health Web App — Server-side wiring layer.
 *
 * Phase 3j + Stage 1: wired to CoreLib v13.
 * Mirrors the SLG WebApp endpoint surface; HC-specific behavior lives
 * entirely in APP_CONFIG (Config_HC.gs).
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

function getGoLivesData(viewModeOpts) {
  return CoreLib.CoreData.getGoLives(APP_CONFIG, viewModeOpts);
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
  var recent = CoreLib.CoreData.getRecentGoLives(APP_CONFIG, {}) || [];
  var upcoming = CoreLib.CoreData.getUpcomingGoLives(APP_CONFIG, {}) || [];

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
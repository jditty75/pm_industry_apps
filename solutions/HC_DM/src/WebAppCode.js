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

function getUpcomingSurveysData(viewModeOpts) {
  return CoreLib.CoreData.getUpcomingSurveys(APP_CONFIG, viewModeOpts || {});
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

// ============================================================================
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
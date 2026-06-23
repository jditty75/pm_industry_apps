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
/**
 * Healthcare Deployment Health Web App - Server-side Code (using CoreLib)
 *
 * Includes:
 * - Red/Yellow deployments (effective view: source + overrides + meta)
 * - Go Lives (effective: source + overrides; HC uses all valid-dated rows)
 * - Upcoming Go Lives (effective: source + overrides)
 * - Monthly report preview (inline HTML)
 *
 * NOTE:
 * - Core data / analytics / reporting logic is in the shared CoreLib.
 * - This file only wires WebApp entry points + server functions used by WebApp.html.
 */

// ==== WEB APP ENTRY POINT ====

// Keep this unchanged to continue serving the existing WebApp.html
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('WebApp');
  return t.evaluate()
    .setTitle(APP_CONFIG.ui.appTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==== IDENTITY BOOT ====

/**
 * Called once at WebApp page load. Returns the current user record (or null)
 * plus the active users list and access context.
 *
 * @return {{ user: Object|null, activeUsers: Array, access: Object }}
 */
function getIdentityBoot() {
  return {
    user: CoreLib.CoreUsers.getCurrentUser(APP_CONFIG),
    activeUsers: CoreLib.CoreUsers.getActiveUsers(APP_CONFIG),
    access: CoreLib.CoreUsers.getCurrentUserAccess(APP_CONFIG)
  };
}

// ==== (OPTIONAL) LOCAL WEB CONFIG FOR CLIENT-ONLY CONSTANTS ====
//
// If you still reference webCONFIG internally in this file (e.g. for
// non-Core use), you can keep it. CoreLib relies on APP_CONFIG instead.

const webCONFIG = {
  ACTIVE_DEPLOYMENTS_SHEET: 'ActiveDeployments',
  GO_LIVES_SHEET: 'Go Lives',
  // ActiveDeployments column mappings (1-based)
  DEPLOYMENTS_COLS: {
    ACCOUNT_NAME: 1,              // A
    DEPLOYMENT_NAME: 2,           // B
    SERVICES_APPROACH: 3,         // C
    INDUSTRY: 4,                  // D
    SUB_REGION: 5,                // E
    PARTNER: 6,                   // F
    DEPLOYMENT_STAGE: 7,          // G
    DEPLOYMENT_HEALTH: 8,         // H
    CURRENT_MTP_DATE: 9,          // I
    PROF_SERVICES_LOCS: 10,       // J
    PROF_SERVICES_DETAILS: 11,    // K
    DAM_FULL_NAME: 12,            // L
    WD_ENG_MANAGER: 13,           // M
    CURRENT_DEPLOYMENT_UPDATE: 14,// N
    DEPLOYMENT_ID: 15             // O
  },
  // Go Lives column mappings (1-based)
  GO_LIVES_COLS: {
    ACCOUNT_NAME: 1,              // A
    INDUSTRY: 2,                  // B
    DAM_FULL_NAME: 3,             // C
    WD_ENG_MANAGER: 4,            // D
    PARTNER: 5,                   // E
    DEPLOYMENT_NAME: 6,           // F
    SERVICES_APPROACH: 7,         // G
    PRODUCT_AREA: 8,              // H
    GO_LIVE_DATE_ACTUAL: 9,       // I
    IN_PRODUCTION: 10             // J
  }
};

// ==== DATA RETRIEVAL: EFFECTIVE VIEWS (WEBAPP API) ====
//
// These are called from WebApp.html via google.script.run.
// They now delegate to CoreLib.CoreData with APP_CONFIG.

function getActiveDeploymentsData() {
  return CoreLib.CoreData.getActiveDeployments(APP_CONFIG);
}

function getGoLivesData() {
  return CoreLib.CoreData.getGoLives(APP_CONFIG);
}

function getUpcomingGoLivesData() {
  return CoreLib.CoreData.getUpcomingGoLives(APP_CONFIG);
}

// ==== EXECUTIVE SUMMARY API (EXEC TAB IN WEBAPP) ====

function getExecutiveSummaryHtml() {
  return CoreLib.CoreExecSummary.get(APP_CONFIG);
}

function saveExecutiveSummaryHtml(html) {
  return CoreLib.CoreExecSummary.save(APP_CONFIG, html);
}

// ==== MONTHLY REPORT PREVIEW API (REPORT TAB IN WEBAPP) ====

/**
 * HTML report preview (inline HTML, same as menu-based preview).
 * Runs snapshot analytics first, then builds the inline HTML report.
 */
function getHtmlReportPreview() {
  return CoreLib.CoreReport.buildInlineHtmlWithAnalytics(APP_CONFIG);
}

// ==== DATA UPDATE FUNCTIONS – ONLY OVERRIDES + META, NOT SOURCE SHEETS ====

/**
 * Combined meta + overrides update for a deployment.
 * Does NOT touch ActiveDeployments (source-only).
 *
 * Called from WebApp.html when saving Red/Yellow overrides/meta.
 *
 * @param {number} rowIndex       (kept for signature compatibility, not used)
 * @param {string} deploymentId
 * @param {{deliveryDirector:string, ddNotes:string}} metaData
 * @param {{
 *   overrideHealth:string,
 *   overrideMtpDate:string,
 *   overrideStage:string,
 *   overrideAccount:string,
 *   overrideDeployment:string,
 *   overrideCurrentUpdate:string,
 *   excludeFromReport:boolean
 * }} overrideData
 * @return {{success:boolean}}
 */
function updateDeploymentWithMetaAndOverride(rowIndex, deploymentId, metaData, overrideData) {
  // rowIndex is ignored by CoreLib (we key off DeploymentID only)
  return CoreLib.CoreData.updateDeploymentWithMetaAndOverride(
    APP_CONFIG,
    deploymentId,
    metaData,
    overrideData
  );
}

/**
 * Go Lives overrides: GoLivesOverrides only (per AccountName).
 * Does NOT touch Go Lives (source-only).
 *
 * Called from WebApp.html when saving Go Lives / Upcoming Go Lives overrides.
 *
 * @param {string} accountName
 * @param {{
 *   overrideDate:string,
 *   overridePartner:string,
 *   excludeFromReport:boolean
 * }} overrideData
 * @return {{success:boolean}}
 */
function updateGoLivesOverride(accountName, overrideData) {
  return CoreLib.CoreData.updateGoLivesOverride(APP_CONFIG, accountName, overrideData);
}

// ==== PORTFOLIO HEALTH (TAB 5) ==========================================

function getPortfolioHealthData() {
  return CoreLib.CorePortfolioHealth.getSnapshot(APP_CONFIG);
}
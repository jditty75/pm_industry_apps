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
function getAllDeploymentsForUI(viewModeOpts) {
  return CoreLib.CoreData.getAllDeployments(APP_CONFIG, viewModeOpts);
}

/**
 * Phase 3i: New endpoint — returns Recent Go Lives from SFDC_Deployments
 * (Complete deployments) via CoreData.getRecentGoLives().
 * Supersedes the legacy getGoLivesData() for the Recent view in the WebApp.
 *
 * @param {Object=} viewModeOpts  { viewMode: 'my'|'all', ddDisplayName: string }
 */
function getRecentGoLivesData(viewModeOpts) {
  return CoreLib.CoreData.getRecentGoLives(APP_CONFIG, viewModeOpts || {});
}

/**
 * DEPRECATED in Phase 3i. Previously returned data from the legacy 'Go Lives'
 * sheet (now frozen). Kept for backward compatibility; the client JS now calls
 * getRecentGoLivesData() instead. Will be removed after the Go Lives sheet is
 * manually deleted by Jeff.
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
// MGM / PGL — UPCOMING SURVEYS
// ============================================================================

/**
 * Returns upcoming MGM and PGL surveys (next 30 days) for Active deployments,
 * respecting viewMode (My Portfolio / All).
 *
 * @param {Object=} viewModeOpts  { viewMode:'my'|'all', ddDisplayName:string }
 * @return {{ windowDays:number, today:string, rows:Array, exceptions:Array }}
 */
function getUpcomingSurveysData(viewModeOpts) {
  return CoreLib.CoreData.getUpcomingSurveys(APP_CONFIG, viewModeOpts || {});
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
 * Returns aggregated KPI data for the Overview tab.
 * Reads directly from SFDC_Deployments and SFDC_Wellness sheets using
 * 0-based confirmed column indices from the 24-col standard layout.
 *
 * @return {Object}  { deployments, goLives, executiveWatch } | { error }
 */
function getOverviewData() {
  try {
    var ss  = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);

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
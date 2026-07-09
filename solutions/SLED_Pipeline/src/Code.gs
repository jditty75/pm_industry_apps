/**
 * Code.gs — Server-side entry points for SLED Pipeline Analysis.
 * doGet() serves the web app; all google.script.run endpoints are here.
 */

/**
 * Serves the web app HTML page.
 * @param {Object} e  Apps Script event object (unused in Phase 2).
 * @returns {HtmlOutput}
 */
function doGet(e) {
  Logger.log('doGet: serving SLED Pipeline app');
  var t = HtmlService.createTemplateFromFile('WebApp');
  return t.evaluate()
    .setTitle(APP_CONFIG.ui.appTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Includes the raw HTML content of a file (styles.html, javascript.html).
 * Used as <?!= include_('styles') ?> inside WebApp.html template.
 * @param {string} filename  File name without extension.
 * @returns {string}
 */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Returns the Overview tab summary for the given filter payload.
 * Called by the client via google.script.run.getOverviewSummary(payload).
 * @param {Object} payload  Filter state from the client (scope, studentFilter, pipelineStatus, …).
 * @returns {Object}  { meta, metrics, bullets, charts }
 */
function getOverviewSummary(payload) {
  Logger.log('getOverviewSummary: ' + JSON.stringify(payload));
  return Analytics_buildOverviewSummary_(payload);
}

/**
 * Phase 1 diagnostic — kept for regression testing.
 * Run in the Apps Script editor to verify the data layer.
 * @returns {Object}
 */
function getDataLayerDiagnostics() {
  Logger.log('getDataLayerDiagnostics: start');
  var rows = Data_getEffectiveRows_();
  var by   = function(pred) { return rows.filter(pred).length; };
  var result = {
    totalRows:        rows.length,
    teamScope: {
      SLG:  by(function(r) { return r.teamScope === 'SLG';  }),
      HENP: by(function(r) { return r.teamScope === 'HENP'; }),
      NONE: by(function(r) { return r.teamScope === 'NONE'; })
    },
    student:           by(function(r) { return r.isStudentSlice;        }),
    subscriptionLike:  by(function(r) { return r.isSubscriptionLike;    }),
    servicesLike:      by(function(r) { return r.isServicesLike;        }),
    closedWon:         by(function(r) { return r.isClosedWon;           }),
    active:            by(function(r) { return r.isActive;              }),
    hasRelatedService: by(function(r) { return r.hasRelatedServiceFlag; }),
    sample:            rows.slice(0, 3)
  };
  Logger.log('getDataLayerDiagnostics: totalRows=' + result.totalRows);
  return result;
}

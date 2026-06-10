/**
 * CoreSalesforce.gs
 *
 * Reads the SFDC_DeploymentProductFunctions sheet (populated by the Salesforce
 * Connector for Google Sheets via a second SOQL query) and produces an
 * enrichment map keyed by Deployment ID.
 *
 * Pattern reference: canvas mn8ps1VU3kL9 (Salesforce two-query join in Apps Script).
 * Phase 3a design: canvas MrW75zesCehF §3a.5.
 *
 * Public surface — single function:
 *   CoreSalesforce.getDeploymentEnrichmentMap(cfg)
 *
 * Returns:
 *   {
 *     '<deploymentId>': {
 *       isPhased: boolean,
 *       upcomingDates: [{ date: 'YYYY-MM-DD', products: ['Product A', ...] }, ...],
 *       nextGoLiveDate: 'YYYY-MM-DD' | null,
 *       productFunctionCount: number
 *     },
 *     ...
 *   }
 *
 * Degrades gracefully when the sheet is missing, empty, or has malformed headers.
 *
 * Convention: top-level object (no IIFE). No caching — each call re-reads the
 * sheet, which is sub-100ms at expected row counts (50–200 rows per app).
 *
 * Phase history:
 *   Phase 3a (v11): introduced as part of the Salesforce two-query join.
 */

var CoreSalesforce = {

  /**
   * Reads SFDC_DeploymentProductFunctions and builds a map of deployment-level
   * enrichment data from child product-function records.
   *
   * @param {AppConfig} cfg  App configuration (run through CoreConfig.withDefaults).
   * @return {Object}  Map keyed by Deployment__c (the FK / DeploymentID).
   */
  getDeploymentEnrichmentMap: function (cfg) {
    cfg = CoreConfig.withDefaults(cfg);
    var sheetName = cfg.sheets.sfdcDeploymentProductFunctions ||
                    'SFDC_DeploymentProductFunctions';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log('CoreSalesforce.getDeploymentEnrichmentMap: sheet "' +
                 sheetName + '" not found — returning empty map.');
      return {};
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('CoreSalesforce.getDeploymentEnrichmentMap: sheet "' +
                 sheetName + '" has no data rows — returning empty map.');
      return {};
    }

    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) {
      Logger.log('CoreSalesforce.getDeploymentEnrichmentMap: sheet "' +
                 sheetName + '" has no columns — returning empty map.');
      return {};
    }

    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headerRow = allValues[0];

    // -----------------------------------------------------------------------
    // Column index resolution — case-insensitive substring matching with
    // position-based fallbacks per the spec (§3 of the Cursor Handoff Spec).
    // -----------------------------------------------------------------------
    var colProductArea    = CoreSalesforce._findCol_(headerRow, ['product_area'], 1);
    var colDateTarget     = CoreSalesforce._findCol_(headerRow, ['production_move_date_target', 'move_date_target'], 3);
    var colDeploymentFk   = CoreSalesforce._findDeploymentFkCol_(headerRow, 5);

    // These columns are read but less critical; missing them doesn't abort.
    var missingCols = [];
    if (colProductArea    < 0) missingCols.push('Product_Area__c');
    if (colDateTarget     < 0) missingCols.push('Production_Move_Date_Target__c');
    if (colDeploymentFk   < 0) missingCols.push('Deployment__c (FK)');

    if (missingCols.length > 0) {
      Logger.log('CoreSalesforce.getDeploymentEnrichmentMap: WARNING — could not ' +
                 'resolve columns: ' + missingCols.join(', ') +
                 '. Check sheet headers in "' + sheetName + '".');
    }

    if (colDeploymentFk < 0) {
      Logger.log('CoreSalesforce.getDeploymentEnrichmentMap: FK column missing — ' +
                 'cannot group by deployment. Returning empty map.');
      return {};
    }

    var tz = Session.getScriptTimeZone();

    // -----------------------------------------------------------------------
    // Build the enrichment map: group rows by deploymentId, then by date.
    // -----------------------------------------------------------------------
    // Intermediate: { deploymentId: { dateKey: Set<productName> } }
    var byDeployment = {};
    var rowCount = 0;
    var orphanCount = 0;

    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];

      var deploymentId = String(row[colDeploymentFk] || '').trim();
      if (!deploymentId) {
        orphanCount++;
        continue;
      }

      var rawDate = (colDateTarget >= 0) ? row[colDateTarget] : null;
      var dateKey = CoreSalesforce._normalizeDate_(rawDate, tz);
      if (!dateKey) continue;  // Skip rows with no valid target date.

      var productArea = (colProductArea >= 0)
        ? String(row[colProductArea] || '').trim()
        : '';

      if (!byDeployment[deploymentId]) {
        byDeployment[deploymentId] = {};
      }
      if (!byDeployment[deploymentId][dateKey]) {
        byDeployment[deploymentId][dateKey] = {};
      }
      if (productArea) {
        byDeployment[deploymentId][dateKey][productArea] = true;
      }

      rowCount++;
    }

    // -----------------------------------------------------------------------
    // Convert the intermediate structure to the final map.
    // -----------------------------------------------------------------------
    var enrichmentMap = {};
    var deploymentCount = 0;
    var phasedCount = 0;

    Object.keys(byDeployment).forEach(function (deploymentId) {
      var dateMap = byDeployment[deploymentId];
      var dates = Object.keys(dateMap).sort();  // chronological (YYYY-MM-DD sorts correctly)

      var upcomingDates = dates.map(function (dateKey) {
        var products = Object.keys(dateMap[dateKey]).sort();
        return { date: dateKey, products: products };
      });

      var isPhased = (dates.length > 1);
      var nextGoLiveDate = dates.length > 0 ? dates[0] : null;

      var totalCount = 0;
      dates.forEach(function (d) {
        totalCount += Object.keys(dateMap[d]).length || 1;
      });

      enrichmentMap[deploymentId] = {
        isPhased:             isPhased,
        upcomingDates:        upcomingDates,
        nextGoLiveDate:       nextGoLiveDate,
        productFunctionCount: totalCount
      };

      deploymentCount++;
      if (isPhased) phasedCount++;
    });

    Logger.log('CoreSalesforce.getDeploymentEnrichmentMap: read ' + rowCount +
               ' rows, ' + deploymentCount + ' deployments, ' + phasedCount +
               ' phased, ' + orphanCount + ' orphaned/skipped rows.');

    return enrichmentMap;
  },

  // -------------------------------------------------------------------------
  // INTERNAL HELPERS
  // -------------------------------------------------------------------------

  /**
   * Find a column index by case-insensitive substring matching.
   * Tries each keyword in order; returns the first match.
   * Falls back to the positional default if no header matches.
   *
   * @param {Array} headers       Row 1 values from the sheet.
   * @param {Array<string>} keywords  Keywords to search for (case-insensitive).
   * @param {number} positionalDefault  0-based column index to use as fallback.
   * @return {number}  0-based column index, or -1 if nothing found.
   * @private
   */
  _findCol_: function (headers, keywords, positionalDefault) {
    var lower = headers.map(function (h) { return String(h || '').toLowerCase(); });
    for (var k = 0; k < keywords.length; k++) {
      var kw = keywords[k].toLowerCase();
      for (var i = 0; i < lower.length; i++) {
        if (lower[i].indexOf(kw) !== -1) return i;
      }
    }
    // Positional fallback: use default position if the header at that position
    // is non-empty (i.e., the sheet has at least that many columns).
    if (positionalDefault >= 0 && positionalDefault < headers.length &&
        String(headers[positionalDefault] || '').trim() !== '') {
      return positionalDefault;
    }
    return -1;
  },

  /**
   * Find the Deployment__c FK column — specifically the column that contains
   * "deployment" but is NOT a relationship traversal (no dot notation).
   * Positional fallback: column F (index 5).
   *
   * @param {Array} headers
   * @param {number} positionalDefault
   * @return {number}
   * @private
   */
  _findDeploymentFkCol_: function (headers, positionalDefault) {
    var lower = headers.map(function (h) { return String(h || '').toLowerCase(); });
    for (var i = 0; i < lower.length; i++) {
      var h = lower[i];
      // Match "deployment__c" or "deployment" without dots (relationship traversal).
      if (h.indexOf('deployment') !== -1 && h.indexOf('.') === -1) return i;
    }
    // Positional fallback.
    if (positionalDefault >= 0 && positionalDefault < headers.length &&
        String(headers[positionalDefault] || '').trim() !== '') {
      return positionalDefault;
    }
    return -1;
  },

  /**
   * Normalize a raw cell value (Date object, ISO string, or numeric serial)
   * to a 'YYYY-MM-DD' string. Returns null if the value is absent or invalid.
   *
   * @param {any} rawDate
   * @param {string} tz   Script timezone (from Session.getScriptTimeZone()).
   * @return {string|null}
   * @private
   */
  _normalizeDate_: function (rawDate, tz) {
    if (!rawDate) return null;
    var d;
    if (rawDate instanceof Date) {
      d = rawDate;
    } else if (typeof rawDate === 'number') {
      // Numeric values from the sheet could be ms timestamps or serial numbers.
      // Try as a Unix ms timestamp first; if the resulting year looks unreasonable,
      // fall through to string parsing.
      d = new Date(rawDate);
      if (isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) {
        d = new Date(String(rawDate));
      }
    } else {
      d = new Date(String(rawDate));
    }
    if (!d || isNaN(d.getTime())) return null;
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
};

// ---------------------------------------------------------------------------
// SMOKE TEST — run from Apps Script editor to verify the module.
// ---------------------------------------------------------------------------

/**
 * Manual test: run this function from the Apps Script editor on the SLG app.
 * Verify: non-zero map size, some phased deployments, correct upcomingDates shape.
 */
function _test_phase3a() {
  var map = CoreSalesforce.getDeploymentEnrichmentMap(APP_CONFIG);
  Logger.log('Enrichment map size: ' + Object.keys(map).length);
  var phasedCount = 0;
  var sampleId = null;
  Object.keys(map).forEach(function (id) {
    if (map[id].isPhased) phasedCount++;
    if (!sampleId && map[id].isPhased) sampleId = id;
  });
  Logger.log('Phased count: ' + phasedCount);
  if (sampleId) {
    Logger.log('Sample phased deployment: ' + JSON.stringify(map[sampleId], null, 2));
  } else {
    Logger.log('No phased deployments found (expected if SFDC sheet is not yet populated).');
  }
}

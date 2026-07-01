/**
 * CoreSalesforce.gs
 *
 * Reads the SFDC_DeploymentProductFunctions sheet (populated by the Salesforce
 * Connector for Google Sheets via a second SOQL query) and produces an
 * enrichment map keyed by Deployment ID.
 *
 * Pattern reference: canvas mn8ps1VU3kL9 (Salesforce two-query join in Apps Script).
 * Phase 3a design: canvas MrW75zesCehF §3a.5.
 * Phase 3i design: canvas XFX5uNQh2KyN — Go Lives SOQL migration.
 *
 * Public surface — single function:
 *   CoreSalesforce.getDeploymentEnrichmentMap(cfg)
 *
 * Returns per deployment (Phase 3i shape):
 *   {
 *     '<deploymentId>': {
 *       isPhased: boolean,        // true if union of upcoming + recent dates > 1
 *       upcomingDates: [{ date: 'YYYY-MM-DD', products: ['Product A', ...] }, ...],
 *       nextGoLiveDate: 'YYYY-MM-DD' | null,
 *       recentDates:   [{ date: 'YYYY-MM-DD', products: ['Product A', ...] }, ...],
 *       lastGoLiveDate: 'YYYY-MM-DD' | null,
 *       productFunctionCount: number
 *     },
 *     ...
 *   }
 *
 * Degrades gracefully when the sheet is missing, empty, or has malformed headers.
 *
 * Convention: top-level object (no IIFE). No caching — each call re-reads the
 * sheet, which is sub-100ms at expected row counts (50–500 rows per app).
 *
 * Phase history:
 *   Phase 3a (v11): introduced as part of the Salesforce two-query join.
 *   Phase 3i: extended with recentDates + lastGoLiveDate from Actual move dates;
 *             isPhased now considers the union of all upcoming + recent dates.
 *   Phase 5 (Notable): _warmCaches now calls CoreNotable._warmNotable so the
 *             5-minute time-based trigger also pre-warms Notable peer-sheet data.
 */

// ===========================================================================
// PERFORMANCE LAYER 1: PER-EXECUTION IN-MEMORY CACHE
// ---------------------------------------------------------------------------
// The enrichment map is the most expensive computation in CoreLib. It reads
// SFDC_DeploymentProductFunctions (thousands of rows) and builds a deployment
// -> upcoming/recent dates structure. Without caching, each WebApp endpoint
// that needs this rebuilds it from scratch — 6+ rebuilds per page load.
// ===========================================================================

// Performance Layer 1: per-execution cache for enrichment map.
var _enrichmentCache = null;

// D1: per-execution cache for DD-from-Contacts map.
var _ddContactsCache = null;

/**
 * Clears the enrichment cache. Currently not called by anything in CoreSalesforce
 * because the underlying SFDC_DeploymentProductFunctions sheet is read-only
 * (populated by the SOQL connector). Provided for future use.
 */
function _clearEnrichmentCache() {
  _enrichmentCache = null;
}

// ===========================================================================
// PERFORMANCE LAYER 2: SHEET-TAB CACHE for enrichment map
// ---------------------------------------------------------------------------
// Mirrors the pattern in CoreData. 5-minute TTL. Cleared by CoreData's
// _clearCache(cfg) via the cross-module call CoreSalesforce._clearEnrichmentSheetCache.
// ===========================================================================

var _PERF_CACHE_SHEET_S = '_PerfCache';
var _PERF_CACHE_TTL_SEC_S = 300; // 5 minutes

function _getPerfCacheSheet_S_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(_PERF_CACHE_SHEET_S);
  if (!sheet) {
    sheet = ss.insertSheet(_PERF_CACHE_SHEET_S);
    sheet.getRange(1, 1, 1, 3).setValues([['Key', 'ValueJson', 'Timestamp']]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

// Layer 2.5: chunk size = 45000 chars (under 50k cell limit with safety margin).
var _PERF_CACHE_CHUNK_SIZE_S = 45000;

function _perfCacheReadS_(key) {
  try {
    var sheet = _getPerfCacheSheet_S_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

    var single = null;
    var chunks = [];
    var tsMs = null;
    var chunkPrefix = key + ':chunk:';

    for (var i = 0; i < values.length; i++) {
      var rowKey = String(values[i][0]);
      if (rowKey === key) {
        single = String(values[i][1] || '');
        var tc = values[i][2];
        tsMs = (tc instanceof Date) ? tc.getTime() : Number(tc);
      } else if (rowKey.indexOf(chunkPrefix) === 0) {
        var idx = parseInt(rowKey.substring(chunkPrefix.length), 10);
        if (!isNaN(idx)) {
          chunks.push({ idx: idx, data: String(values[i][1] || '') });
          if (tsMs === null) {
            var tc2 = values[i][2];
            tsMs = (tc2 instanceof Date) ? tc2.getTime() : Number(tc2);
          }
        }
      }
    }

    // TTL check.
    if (!tsMs || Date.now() - tsMs > _PERF_CACHE_TTL_SEC_S * 1000) {
      return null;
    }

    // Single-row entry path.
    if (single !== null && chunks.length === 0) {
      if (!single) return null;
      try {
        return JSON.parse(single);
      } catch (parseErr) {
        Logger.log('CoreSalesforce._perfCacheReadS_: malformed single-row JSON for key=' + key +
                   '; treating as cache miss. Error: ' + parseErr);
        return null;
      }
    }

    // Chunked entry path.
    if (chunks.length > 0) {
      chunks.sort(function (a, b) { return a.idx - b.idx; });
      for (var ci = 0; ci < chunks.length; ci++) {
        if (chunks[ci].idx !== ci) {
          Logger.log('CoreSalesforce._perfCacheReadS_: chunk gap at idx ' + ci +
                     ' for key=' + key + '; treating as cache miss.');
          return null;
        }
      }
      var combined = chunks.map(function (c) { return c.data; }).join('');
      if (!combined) return null;
      try {
        return JSON.parse(combined);
      } catch (parseErr) {
        Logger.log('CoreSalesforce._perfCacheReadS_: malformed reassembled JSON for key=' + key +
                   '; treating as cache miss. Error: ' + parseErr);
        return null;
      }
    }

    return null;
  } catch (err) {
    Logger.log('CoreSalesforce._perfCacheReadS_: ' + err);
    return null;
  }
}

// Layer 2.5: chunk size = 45000 chars (under 50k cell limit with safety margin).
var _PERF_CACHE_CHUNK_SIZE_S = 45000;

function _perfCacheWriteS_(key, value) {
  try {
    var sheet = _getPerfCacheSheet_S_();
    var json = JSON.stringify(value);
    var now = new Date();

    // First, delete any existing rows for this key.
    _perfCacheDeleteKeyS_(sheet, key);

    if (json.length <= _PERF_CACHE_CHUNK_SIZE_S) {
      sheet.appendRow([key, json, now]);
      return;
    }

    var chunkCount = Math.ceil(json.length / _PERF_CACHE_CHUNK_SIZE_S);
    var rows = [];
    for (var i = 0; i < chunkCount; i++) {
      var start = i * _PERF_CACHE_CHUNK_SIZE_S;
      var chunk = json.substring(start, start + _PERF_CACHE_CHUNK_SIZE_S);
      rows.push([key + ':chunk:' + i, chunk, now]);
    }
    var firstRow = sheet.getLastRow() + 1;
    sheet.getRange(firstRow, 1, rows.length, 3).setValues(rows);
    Logger.log('CoreSalesforce._perfCacheWriteS_: chunked key=' + key + ' into ' + chunkCount + ' rows.');
  } catch (err) {
    Logger.log('CoreSalesforce._perfCacheWriteS_: failed for key=' + key + ': ' + err);
  }
}

/**
 * Removes all rows from the cache sheet matching the given key (single-row or chunked).
 */
function _perfCacheDeleteKeyS_(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var chunkPrefix = key + ':chunk:';
  for (var i = keys.length - 1; i >= 0; i--) {
    var k = String(keys[i][0]);
    if (k === key || k.indexOf(chunkPrefix) === 0) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**
 * Removes all rows from the cache sheet matching the given key.
 */
function _perfCacheDeleteKeyS_(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var chunkPrefix = key + ':chunk:';
  for (var i = keys.length - 1; i >= 0; i--) {
    var k = String(keys[i][0]);
    if (k === key || k.indexOf(chunkPrefix) === 0) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**
 * Public entry point called by CoreData._clearCache(cfg) to invalidate
 * the enrichment map sheet-tab cache after a mutation.
 */
function _clearEnrichmentSheetCache() {
  _enrichmentCache = null;
  try {
    var sheet = _getPerfCacheSheet_S_();
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        var k = String(data[i][0] || '');
        if (k.indexOf('enrichmentMap:') === 0) {
          sheet.deleteRow(i + 2);
        }
      }
    }
  } catch (err) {
    Logger.log('CoreSalesforce._clearEnrichmentSheetCache: ' + err);
  }
}

/**
 * Performance Layer 2: Pre-warm the sheet-tab cache for this app.
 * Called by an Apps Script time-based trigger in each app (every 4-5 min
 * during business hours). Computes SFDC raw rows and the enrichment map,
 * writing both to the _PerfCache sheet so user-triggered endpoints hit
 * warm cache instead of paying cold-start computation.
 *
 * @param {AppConfig} config
 * @return {{ ok:boolean, durationMs:number, rows:number, enrichmentDeployments:number }}
 */
function _warmCaches(config) {
  var start = Date.now();
  var cfg = CoreConfig.withDefaults(config);
  // Clear in-memory first so we force fresh reads from live sheets, then
  // populate the sheet-tab cache from those fresh reads.
  _enrichmentCache = null;
  var rowCount = 0;
  var deploymentCount = 0;
  try {
    // Trigger the enrichment computation. This will read live and write to
    // both tier 1 (in-memory) and tier 2 (sheet-tab cache) per Layer 2.
    var enrichment = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    deploymentCount = Object.keys(enrichment || {}).length;
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: enrichment build failed: ' + err);
  }
  // Also warm the SFDC raw rows via CoreData.
  try {
    // Force a fresh read by clearing CoreData's tier 1, then calling.
    // We deliberately don't call CoreData._clearCache(cfg) here because
    // that would also wipe the enrichment we just warmed.
    CoreData._warmSfdcRows(cfg);
    rowCount = (CoreData._getCachedSfdcRowCount && CoreData._getCachedSfdcRowCount()) || 0;
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: SFDC warm failed: ' + err);
  }
  // Notable Deployments: warm the peer-sheet join for this app.
  try {
    CoreNotable._warmNotable(cfg);
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: Notable warm failed: ' + err);
  }
  // MDS/PGL batch view: pre-warm both horizon windows so first user load is fast.
  try {
    CoreData.getMdsPglBatchView(cfg, null, 3);
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: MdsPgl 3-month warm failed: ' + err);
  }
  try {
    CoreData.getMdsPglBatchView(cfg, null, 6);
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: MdsPgl 6-month warm failed: ' + err);
  }
  // Overview snapshot: pre-warm so first page load returns near-instantly.
  try {
    CoreData.getOverviewSnapshot(cfg);
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: Overview snapshot warm failed: ' + err);
  }
  var elapsed = Date.now() - start;
  Logger.log('CoreSalesforce._warmCaches(' + cfg.appId + '): ' + elapsed + 'ms, ' +
             rowCount + ' SFDC rows, ' + deploymentCount + ' enriched deployments.');
  return { ok: true, durationMs: elapsed, rows: rowCount, enrichmentDeployments: deploymentCount };
}

// ===========================================================================
// D1: DD ASSIGNMENTS FROM SFDC_Contacts
// ---------------------------------------------------------------------------
// Reads SFDC_Contacts and produces a Map<deploymentId, Array<{email,name}>>
// for all contacts where Contact_Role__c === 'Deployment Sponsor'.
// Cached tier-1 (in-memory per execution) + tier-2 (sheet-tab, 5-min TTL).
// ===========================================================================

/**
 * Returns a plain-object map keyed by Deployment__c → Array<{email,name}>
 * for contacts where Contact_Role__c === 'Deployment Sponsor'.
 * Cached via _PerfCache with 5-min TTL, keyed by appId.
 *
 * @param {AppConfig} config
 * @return {Object}  { '<deploymentId>': [{email:string, name:string}, ...], ... }
 */
function getDdAssignmentsFromContacts_(config) {
  var cfg = CoreConfig.withDefaults(config);
  var cacheKey = 'ddFromContacts:' + (cfg.appId || 'default');

  // Tier 1: in-memory.
  if (_ddContactsCache !== null) return _ddContactsCache;

  // Tier 2: sheet-tab cache.
  var cached = _perfCacheReadS_(cacheKey);
  if (cached !== null) {
    _ddContactsCache = cached;
    return cached;
  }

  var sheetName = (cfg.sheets && cfg.sheets.sfdcContacts) || null;

  if (!sheetName) {
    Logger.log('getDdAssignmentsFromContacts_: cfg.sheets.sfdcContacts not configured — returning empty map.');
    _ddContactsCache = {};
    return {};
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log('getDdAssignmentsFromContacts_: sheet "' + sheetName + '" not found — returning empty map.');
    _ddContactsCache = {};
    return {};
  }

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    Logger.log('getDdAssignmentsFromContacts_: sheet "' + sheetName + '" has no data rows.');
    _ddContactsCache = {};
    return {};
  }

  var headers = values[0];
  var rows    = values.slice(1);

  function idx(name) {
    var i = headers.indexOf(name);
    return i >= 0 ? i : -1;
  }

  var roleIdx  = idx('Contact_Role__c');
  var depIdx   = idx('Deployment__c');
  var emailIdx = idx('Contact__r.Email');
  var nameIdx  = idx('Contact__r.Name');

  if (roleIdx < 0) {
    Logger.log('getDdAssignmentsFromContacts_: Contact_Role__c column not found in "' + sheetName + '".');
    _ddContactsCache = {};
    return {};
  }
  if (depIdx < 0) {
    Logger.log('getDdAssignmentsFromContacts_: Deployment__c column not found in "' + sheetName + '".');
    _ddContactsCache = {};
    return {};
  }
  if (emailIdx < 0) {
    Logger.log('getDdAssignmentsFromContacts_: Contact__r.Email column not found in "' + sheetName + '".');
    _ddContactsCache = {};
    return {};
  }

  var map      = {};
  var included = 0;
  var skipped  = 0;

  rows.forEach(function(r) {
    var role  = String(r[roleIdx]  || '').trim();
    if (role !== 'Deployment Sponsor') { skipped++; return; }

    var depId = String(r[depIdx]   || '').trim();
    if (!depId) { skipped++; return; }

    var email = String(r[emailIdx] || '').trim();
    if (!email) { skipped++; return; }  // no email → skip; source cleanup required

    var name  = (nameIdx >= 0 ? String(r[nameIdx] || '').trim() : '');

    if (!map[depId]) map[depId] = [];
    map[depId].push({ email: email, name: name });
    included++;
  });

  Logger.log('getDdAssignmentsFromContacts_(' + (cfg.appId || '?') + '): ' +
             included + ' included, ' + skipped + ' skipped, ' +
             Object.keys(map).length + ' unique deployments.');

  // Write both tiers.
  _ddContactsCache = map;
  _perfCacheWriteS_(cacheKey, map);
  return map;
}

/**
 * Clears the D1 DD-from-Contacts in-memory + sheet-tab cache.
 * Called alongside _clearEnrichmentSheetCache when sheet data changes.
 */
function _clearDdContactsCache() {
  _ddContactsCache = null;
  try {
    var sheet = _getPerfCacheSheet_S_();
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        var k = String(data[i][0] || '');
        if (k.indexOf('ddFromContacts:') === 0) {
          sheet.deleteRow(i + 2);
        }
      }
    }
  } catch (err) {
    Logger.log('_clearDdContactsCache: ' + err);
  }
}

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
    // Performance Layer 1: tier 1 (in-memory).
    if (_enrichmentCache !== null) return _enrichmentCache;
    // Performance Layer 2: tier 2 (sheet-tab cache).
    var enrichmentCacheKey = 'enrichmentMap:' + (cfg && cfg.appId ? cfg.appId : 'default');
    var cachedEnrichment = _perfCacheReadS_(enrichmentCacheKey);
    if (cachedEnrichment !== null) {
      _enrichmentCache = cachedEnrichment;
      return cachedEnrichment;
    }
    var sheetName = cfg.sheets.sfdcDeploymentProductFunctions || 'SFDC_DeploymentProductFunctions';

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
    // Phase 3i: also detect Production_Move_Date_Actual__c (col E, index 4).
    // -----------------------------------------------------------------------
    var colProductArea    = CoreSalesforce._findCol_(headerRow, ['product_area'], 1);
    var colDateTarget     = CoreSalesforce._findCol_(headerRow, ['production_move_date_target', 'move_date_target'], 3);
    var colDateActual     = CoreSalesforce._findCol_(headerRow, ['production_move_date_actual', 'move_date_actual'], 4);
    var colDeploymentFk   = CoreSalesforce._findDeploymentFkCol_(headerRow, 5);

    // These columns are read but less critical; missing them doesn't abort.
    var missingCols = [];
    if (colProductArea    < 0) missingCols.push('Product_Area__c');
    if (colDateTarget     < 0) missingCols.push('Production_Move_Date_Target__c');
    if (colDateActual     < 0) missingCols.push('Production_Move_Date_Actual__c (non-fatal)');
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

    var tz  = Session.getScriptTimeZone();
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

    // -----------------------------------------------------------------------
    // Build the enrichment map: group rows by deploymentId, then by date.
    // Phase 3i intermediate structure:
    //   { deploymentId: {
    //       upcoming: { dateKey: { productName: true } },  // Target >= today
    //       recent:   { dateKey: { productName: true } }   // Actual < today
    //   } }
    // -----------------------------------------------------------------------
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

      var productArea = (colProductArea >= 0)
        ? String(row[colProductArea] || '').trim()
        : '';

      if (!byDeployment[deploymentId]) {
        byDeployment[deploymentId] = { upcoming: {}, recent: {} };
      }

      var addedToAnyBucket = false;

      // --- Upcoming bucket: Production_Move_Date_Target__c >= today ---
      if (colDateTarget >= 0) {
        var rawTarget = row[colDateTarget];
        var targetKey = CoreSalesforce._normalizeDate_(rawTarget, tz);
        if (targetKey && targetKey >= todayKey) {
          if (!byDeployment[deploymentId].upcoming[targetKey]) {
            byDeployment[deploymentId].upcoming[targetKey] = {};
          }
          if (productArea) {
            byDeployment[deploymentId].upcoming[targetKey][productArea] = true;
          }
          addedToAnyBucket = true;
        }
      }

      // --- Recent bucket: Production_Move_Date_Actual__c < today ---
      if (colDateActual >= 0) {
        var rawActual = row[colDateActual];
        var actualKey = CoreSalesforce._normalizeDate_(rawActual, tz);
        if (actualKey && actualKey < todayKey) {
          if (!byDeployment[deploymentId].recent[actualKey]) {
            byDeployment[deploymentId].recent[actualKey] = {};
          }
          if (productArea) {
            byDeployment[deploymentId].recent[actualKey][productArea] = true;
          }
          addedToAnyBucket = true;
        }
      }

      if (addedToAnyBucket) rowCount++;
    }

    // -----------------------------------------------------------------------
    // Convert the intermediate structure to the final map.
    // Phase 3i: isPhased considers the UNION of all upcoming + recent dates.
    // -----------------------------------------------------------------------
    var enrichmentMap = {};
    var deploymentCount = 0;
    var phasedCount = 0;

    Object.keys(byDeployment).forEach(function (deploymentId) {
      var buckets = byDeployment[deploymentId];

      // --- Upcoming dates (sorted ascending) ---
      var upcomingKeys = Object.keys(buckets.upcoming).sort();
      var upcomingDates = upcomingKeys.map(function (dateKey) {
        return { date: dateKey, products: Object.keys(buckets.upcoming[dateKey]).sort() };
      });
      var nextGoLiveDate = upcomingKeys.length > 0 ? upcomingKeys[0] : null;

      // --- Recent dates (sorted ascending; lastGoLiveDate = last) ---
      var recentKeys = Object.keys(buckets.recent).sort();
      var recentDates = recentKeys.map(function (dateKey) {
        return { date: dateKey, products: Object.keys(buckets.recent[dateKey]).sort() };
      });
      var lastGoLiveDate = recentKeys.length > 0 ? recentKeys[recentKeys.length - 1] : null;

      // --- isPhased: union of all distinct dates across both buckets ---
      var allDistinctDates = {};
      upcomingKeys.forEach(function (k) { allDistinctDates[k] = true; });
      recentKeys.forEach(function (k)   { allDistinctDates[k] = true; });
      var isPhased = (Object.keys(allDistinctDates).length > 1);

      // --- productFunctionCount (approximate: product-name count per date across both buckets) ---
      var totalCount = 0;
      upcomingKeys.forEach(function (d) { totalCount += Object.keys(buckets.upcoming[d]).length || 1; });
      recentKeys.forEach(function (d)   { totalCount += Object.keys(buckets.recent[d]).length || 1; });

      enrichmentMap[deploymentId] = {
        isPhased:             isPhased,
        upcomingDates:        upcomingDates,
        nextGoLiveDate:       nextGoLiveDate,
        recentDates:          recentDates,
        lastGoLiveDate:       lastGoLiveDate,
        productFunctionCount: totalCount
      };

      deploymentCount++;
      if (isPhased) phasedCount++;
    });

    Logger.log('CoreSalesforce.getDeploymentEnrichmentMap: read ' + rowCount +
               ' rows, ' + deploymentCount + ' deployments, ' + phasedCount +
               ' phased (upcoming+recent), ' + orphanCount + ' orphaned/skipped rows.');

    // Performance Layer 1: tier 1 (in-memory).
    _enrichmentCache = enrichmentMap;
    // Performance Layer 2: tier 2 (sheet-tab cache).
    _perfCacheWriteS_(enrichmentCacheKey, enrichmentMap);
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
  },

  // Performance Layer 2 exports
  _clearEnrichmentSheetCache: _clearEnrichmentSheetCache,
  _warmCaches: _warmCaches,

  // D1: DD-from-Contacts
  getDdAssignmentsFromContacts_: getDdAssignmentsFromContacts_,
  _clearDdContactsCache:        _clearDdContactsCache
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

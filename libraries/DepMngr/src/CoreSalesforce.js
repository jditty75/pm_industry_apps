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

// S1: per-execution caches for Student predicate maps.
var _studentIdsCache = null;
var _studentPFCache = null;

/**
 * Clears the enrichment cache. Currently not called by anything in CoreSalesforce
 * because the underlying SFDC_DeploymentProductFunctions sheet is read-only
 * (populated by the SOQL connector). Provided for future use.
 */
function _clearEnrichmentCache() {
  _enrichmentCache = null;
}

// ===========================================================================
// PERFORMANCE LAYER 2 (CoreSalesforce): CacheService — KNOWN NO-OP CROSS-EXECUTION
// ---------------------------------------------------------------------------
// STATUS (C1-Finalize, July 2026):
//   Same status as CoreData's tier-2 CacheService section. See CoreData.js
//   for full explanation. This "_S" variant handles the enrichment map,
//   DD contacts map, and Student maps. All writes go to DHLibrary's
//   invisible cache. All reads miss.
//
// TIER-1 (in-memory _enrichmentCache, _ddContactsCache, _studentCache) is
// what actually delivers within-execution performance. Cross-execution
// caching is currently unavailable.
//
// FUTURE: See CoreData.js post-mortem note for Option 2 (redesign).
// ===========================================================================

var _PERF_CACHE_TTL_SEC_S = 21600;      // 6 hours
var _PERF_CACHE_CHUNK_SIZE_S = 90000;   // base64-encoded chars per chunk

var _perfCacheKnownKeysS_ = {};

/**
 * Serializes and compresses a value for CacheService storage.
 * @private
 */
function _perfCacheEncodeS_(value) {
  var json = JSON.stringify(value);
  var blob = Utilities.newBlob(json, 'application/json');
  var compressed = Utilities.gzip(blob);
  return Utilities.base64Encode(compressed.getBytes());
}

/**
 * Decodes and parses a CacheService payload.
 * @private
 */
function _perfCacheDecodeS_(encoded) {
  try {
    var bytes = Utilities.base64Decode(encoded);
    var blob = Utilities.newBlob(bytes, 'application/x-gzip');
    var decompressed = Utilities.ungzip(blob);
    return JSON.parse(decompressed.getDataAsString());
  } catch (err) {
    Logger.log('CoreSalesforce._perfCacheDecodeS_: failed to decode payload: ' + err);
    return null;
  }
}

/**
 * Reads a value from CacheService. Returns null if missing or decode fails.
 * @param {string} key
 * @return {*} the parsed value or null
 */
function _perfCacheReadS_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var manifestKey = key + ':manifest';
    var manifestRaw = cache.get(manifestKey);

    if (manifestRaw) {
      // Chunked path.
      var manifest;
      try {
        manifest = JSON.parse(manifestRaw);
      } catch (parseErr) {
        Logger.log('CoreSalesforce._perfCacheReadS_: manifest parse failed for ' + key);
        return null;
      }
      if (!manifest || !manifest.chunks || manifest.chunks < 1) return null;

      var chunkKeys = [];
      for (var i = 0; i < manifest.chunks; i++) chunkKeys.push(key + ':chunk:' + i);
      var chunkMap = cache.getAll(chunkKeys);

      var combined = '';
      for (var j = 0; j < manifest.chunks; j++) {
        var chunk = chunkMap[key + ':chunk:' + j];
        if (chunk === undefined || chunk === null) {
          Logger.log('CoreSalesforce._perfCacheReadS_: missing chunk ' + j + ' for key=' + key + '; treating as miss.');
          return null;
        }
        combined += chunk;
      }
      return _perfCacheDecodeS_(combined);
    }

    // Single-key path.
    var single = cache.get(key);
    if (single === null || single === undefined) return null;
    return _perfCacheDecodeS_(single);
  } catch (err) {
    Logger.log('CoreSalesforce._perfCacheReadS_: ' + err);
    return null;
  }
}

/**
 * Writes a value to CacheService. Best-effort with one retry on failure.
 * @param {string} key
 * @param {*} value any JSON-serializable value
 */
function _perfCacheWriteS_(key, value) {
  var attempts = 0;
  var maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      var cache = CacheService.getScriptCache();
      var encoded = _perfCacheEncodeS_(value);

      _perfCacheDeleteKeyS_(key);

      if (encoded.length <= _PERF_CACHE_CHUNK_SIZE_S) {
        cache.put(key, encoded, _PERF_CACHE_TTL_SEC_S);
        _perfCacheKnownKeysS_[key] = true;
        return;
      }

      // Chunked write.
      var chunkCount = Math.ceil(encoded.length / _PERF_CACHE_CHUNK_SIZE_S);
      var chunkMap = {};
      for (var i = 0; i < chunkCount; i++) {
        var start = i * _PERF_CACHE_CHUNK_SIZE_S;
        chunkMap[key + ':chunk:' + i] = encoded.substring(start, start + _PERF_CACHE_CHUNK_SIZE_S);
      }
      cache.putAll(chunkMap, _PERF_CACHE_TTL_SEC_S);
      cache.put(key + ':manifest', JSON.stringify({ chunks: chunkCount, algorithm: 'gzip-base64' }), _PERF_CACHE_TTL_SEC_S);

      _perfCacheKnownKeysS_[key] = true;
      Logger.log('CoreSalesforce._perfCacheWriteS_: chunked key=' + key + ' into ' + chunkCount + ' pieces.');
      return;
    } catch (err) {
      Logger.log('CoreSalesforce._perfCacheWriteS_ attempt ' + attempts + ' failed for key=' + key + ': ' + err);
      if (attempts < maxAttempts) {
        Utilities.sleep(500);
      } else {
        Logger.log('CoreSalesforce._perfCacheWriteS_: giving up on key=' + key + ' after ' + attempts + ' attempts.');
      }
    }
  }
}

/**
 * Removes a key (and its chunks/manifest) from CacheService.
 * @param {string} key
 */
function _perfCacheDeleteKeyS_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var manifestRaw = cache.get(key + ':manifest');
    if (manifestRaw) {
      var manifest;
      try { manifest = JSON.parse(manifestRaw); } catch (e) { manifest = null; }
      if (manifest && manifest.chunks) {
        var chunkKeys = [];
        for (var i = 0; i < manifest.chunks; i++) chunkKeys.push(key + ':chunk:' + i);
        chunkKeys.push(key + ':manifest');
        cache.removeAll(chunkKeys);
      }
    }
    cache.remove(key);
    delete _perfCacheKnownKeysS_[key];
  } catch (err) {
    Logger.log('CoreSalesforce._perfCacheDeleteKeyS_: ' + err);
  }
}

/**
 * Public entry point called by CoreData._clearCache(cfg) to invalidate
 * the enrichment map CacheService entries after a mutation.
 */
function _clearEnrichmentSheetCache() {
  _enrichmentCache = null;
  var keys = Object.keys(_perfCacheKnownKeysS_);
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i]).indexOf('enrichmentMap:') === 0) {
      _perfCacheDeleteKeyS_(keys[i]);
    }
  }
}

/**
 * Returns a plain object map:
 *   { deploymentId: [ { email, name }, ... ], ... }
 * built from SFDC_DeploymentContacts rows where
 *   Contact_Role__c === 'Deployment Sponsor'.
 *
 * Order within each deployment's array reflects sheet row order.
 *
 * Cached in-memory (tier 1) and via _PerfCache (tier 2, 5-min TTL).
 * Returns {} and logs a warning if cfg.sheets.sfdcContacts is unset
 * or the sheet does not exist.
 *
 * @param {AppConfig} config
 * @return {Object<string, Array<{email:string, name:string}>>}
 */
function getDdAssignmentsFromContacts_(config) {
  var cfg = CoreConfig.withDefaults(config);
  var appId = cfg.appId || 'default';

  // Guard: sfdcContacts must be configured by the app.
  var sheetName = cfg.sheets && cfg.sheets.sfdcContacts;
  if (!sheetName || !String(sheetName).trim()) {
    Logger.log('CoreSalesforce.getDdAssignmentsFromContacts_: sheets.sfdcContacts not configured ' +
               'for app "' + appId + '"; returning empty map.');
    return {};
  }
  sheetName = String(sheetName).trim();

  // Tier 1: in-memory.
  if (_ddContactsCache !== null) return _ddContactsCache;

  // Tier 2: sheet-tab cache.
  var cacheKey = 'ddContacts:' + appId;
  var cached = _perfCacheReadS_(cacheKey);
  if (cached !== null) {
    _ddContactsCache = cached;
    return cached;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('CoreSalesforce.getDdAssignmentsFromContacts_: sheet "' + sheetName +
               '" not found; returning empty map.');
    return {};
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('CoreSalesforce.getDdAssignmentsFromContacts_: sheet "' + sheetName +
               '" has no data rows; returning empty map.');
    _ddContactsCache = {};
    _perfCacheWriteS_(cacheKey, {});
    return {};
  }

  var lastCol = sheet.getLastColumn();
  var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headerRow = allValues[0];

  // Exact header-name lookup for the four required columns.
  var colRole       = -1;
  var colDeployment = -1;
  var colEmail      = -1;
  var colName       = -1;
  for (var hi = 0; hi < headerRow.length; hi++) {
    var h = String(headerRow[hi] || '').trim();
    if (h === 'Contact_Role__c')    colRole       = hi;
    if (h === 'Deployment__c')      colDeployment = hi;
    if (h === 'Contact__r.Email')   colEmail      = hi;
    if (h === 'Contact__r.Name')    colName       = hi;
  }

  var missingHeaders = [];
  if (colRole       < 0) missingHeaders.push('Contact_Role__c');
  if (colDeployment < 0) missingHeaders.push('Deployment__c');
  if (colEmail      < 0) missingHeaders.push('Contact__r.Email');
  if (colName       < 0) missingHeaders.push('Contact__r.Name');
  if (missingHeaders.length > 0) {
    Logger.log('CoreSalesforce.getDdAssignmentsFromContacts_: missing required headers in "' +
               sheetName + '": ' + missingHeaders.join(', ') + '; returning empty map.');
    return {};
  }

  var ddMap = {};
  for (var r = 1; r < allValues.length; r++) {
    var row = allValues[r];
    var role       = String(row[colRole]       || '').trim();
    var deployId   = String(row[colDeployment] || '').trim();
    var email      = String(row[colEmail]      || '').trim();
    var name       = String(row[colName]       || '').trim();

    // Skip rows that don't qualify.
    if (!role || role !== 'Deployment Sponsor') continue;
    if (!deployId) continue;
    if (!email) continue;

    if (!ddMap[deployId]) ddMap[deployId] = [];
    ddMap[deployId].push({ email: email, name: name });
  }

  Logger.log('CoreSalesforce.getDdAssignmentsFromContacts_(' + appId + '): built DD map for ' +
             Object.keys(ddMap).length + ' deployments from "' + sheetName + '".');

  // Tier 1.
  _ddContactsCache = ddMap;
  // Tier 2 (chunked at _PERF_CACHE_CHUNK_SIZE_S chars).
  _perfCacheWriteS_(cacheKey, ddMap);
  return ddMap;
}

/**
 * Clears both cache tiers for getDdAssignmentsFromContacts_.
 * Called by CoreData._clearCache(cfg) as part of the unified invalidation.
 */
function _clearDdContactsCache() {
  _ddContactsCache = null;
  var keys = Object.keys(_perfCacheKnownKeysS_);
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i]).indexOf('ddContacts:') === 0) {
      _perfCacheDeleteKeyS_(keys[i]);
    }
  }
}

// ===========================================================================
// S1: STUDENT PREDICATE HELPERS
// ---------------------------------------------------------------------------
// Two-tier cached (tier-1 in-memory + tier-2 _PerfCache) maps built from
// SFDC_DeploymentProductFunctions. Only active when cfg.student?.enabled === true.
// SLG/HC see cfg.student = undefined → all helpers short-circuit to {}.
// ===========================================================================

/**
 * Returns a plain object map keyed by Deployment_Id where at least one row
 * in SFDC_DeploymentProductFunctions has Product_Area === cfg.student.productAreaMatch
 * (exact match, trimmed, case-sensitive).
 *
 * Returns {} when cfg.student?.enabled !== true.
 * Cached in-memory (tier 1) and via _PerfCache (tier 2, 5-min TTL).
 *
 * Key naming: 'studentDeploymentIds:<appId>'
 *
 * @param {AppConfig} config
 * @return {Object<string, true>}
 */
function getStudentDeploymentIds_(config) {
  var cfg = CoreConfig.withDefaults(config);
  if (!cfg.student || cfg.student.enabled !== true) return {};
  var appId = cfg.appId || 'default';

  if (_studentIdsCache !== null) return _studentIdsCache;

  var cacheKey = 'studentDeploymentIds:' + appId;
  var cached = _perfCacheReadS_(cacheKey);
  if (cached !== null) {
    _studentIdsCache = cached;
    return cached;
  }

  var sheetName = (cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions) ||
                  'SFDC_DeploymentProductFunctions';
  var productAreaMatch = (cfg.student && cfg.student.productAreaMatch) || 'Student';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('CoreSalesforce.getStudentDeploymentIds_: sheet "' + sheetName +
               '" not found or empty for app ' + appId);
    _studentIdsCache = {};
    _perfCacheWriteS_(cacheKey, {});
    return {};
  }

  var allValues = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headerRow = allValues[0];

  var colProductArea = -1;
  var colDeploymentFk = CoreSalesforce._findDeploymentFkCol_(headerRow, 0);
  for (var hi = 0; hi < headerRow.length; hi++) {
    var h = String(headerRow[hi] || '').trim().toLowerCase();
    if (h.indexOf('product_area') !== -1) colProductArea = hi;
  }

  if (colProductArea < 0 || colDeploymentFk < 0) {
    Logger.log('CoreSalesforce.getStudentDeploymentIds_: missing Product_Area or Deployment FK ' +
               'column in "' + sheetName + '"');
    _studentIdsCache = {};
    return {};
  }

  var idSet = {};
  for (var r = 1; r < allValues.length; r++) {
    var row = allValues[r];
    var pa  = String(row[colProductArea] || '').trim();
    var did = String(row[colDeploymentFk] || '').trim();
    if (pa === productAreaMatch && did) {
      idSet[did] = true;
    }
  }

  Logger.log('CoreSalesforce.getStudentDeploymentIds_(' + appId + '): ' +
             Object.keys(idSet).length + ' Student deployments.');
  _studentIdsCache = idSet;
  _perfCacheWriteS_(cacheKey, idSet);
  return idSet;
}

/**
 * Returns a map: { deploymentId: [{ function, targetGoLive, actualGoLive }, ...] }
 * for Student rows only (Product_Area === cfg.student.productAreaMatch). Used by
 * the Student tab expanded-row detail.
 *
 * Returns {} when cfg.student?.enabled !== true.
 * Cached in-memory + _PerfCache. Key: 'studentProductFunctions:<appId>'
 *
 * @param {AppConfig} config
 * @return {Object<string, Array<{function:string, targetGoLive:string, actualGoLive:string}>>}
 */
function getStudentProductFunctionsMap_(config) {
  var cfg = CoreConfig.withDefaults(config);
  if (!cfg.student || cfg.student.enabled !== true) return {};
  var appId = cfg.appId || 'default';

  if (_studentPFCache !== null) return _studentPFCache;

  var cacheKey = 'studentProductFunctions:' + appId;
  var cached = _perfCacheReadS_(cacheKey);
  if (cached !== null) {
    _studentPFCache = cached;
    return cached;
  }

  var sheetName = (cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions) ||
                  'SFDC_DeploymentProductFunctions';
  var productAreaMatch = (cfg.student && cfg.student.productAreaMatch) || 'Student';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    _studentPFCache = {};
    _perfCacheWriteS_(cacheKey, {});
    return {};
  }

  var allValues = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headerRow = allValues[0];
  var tz = Session.getScriptTimeZone();

  var colProductArea = -1;
  var colDeploymentFk = CoreSalesforce._findDeploymentFkCol_(headerRow, 0);
  var colFunction = -1, colTargetGoLive = -1, colActualGoLive = -1;

  for (var hi = 0; hi < headerRow.length; hi++) {
    var h = String(headerRow[hi] || '').trim().toLowerCase();
    if (h.indexOf('product_area') !== -1) colProductArea = hi;
    if (h.indexOf('function') !== -1 && h.indexOf('deployment') === -1) colFunction = hi;
    if (h.indexOf('target') !== -1 && h.indexOf('date') !== -1) colTargetGoLive = hi;
    if (h.indexOf('actual') !== -1 && h.indexOf('date') !== -1) colActualGoLive = hi;
  }

  if (colProductArea < 0 || colDeploymentFk < 0) {
    _studentPFCache = {};
    return {};
  }

  var pfMap = {};
  for (var r = 1; r < allValues.length; r++) {
    var row = allValues[r];
    var pa  = String(row[colProductArea] || '').trim();
    var did = String(row[colDeploymentFk] || '').trim();
    if (pa !== productAreaMatch || !did) continue;
    if (!pfMap[did]) pfMap[did] = [];
    pfMap[did].push({
      'function':    colFunction     >= 0 ? String(row[colFunction]     || '').trim() : '',
      targetGoLive:  colTargetGoLive >= 0 ? (CoreSalesforce._normalizeDate_(row[colTargetGoLive], tz) || '') : '',
      actualGoLive:  colActualGoLive >= 0 ? (CoreSalesforce._normalizeDate_(row[colActualGoLive], tz) || '') : ''
    });
  }

  Logger.log('CoreSalesforce.getStudentProductFunctionsMap_(' + appId + '): ' +
             Object.keys(pfMap).length + ' deployments with Student product rows.');
  _studentPFCache = pfMap;
  _perfCacheWriteS_(cacheKey, pfMap);
  return pfMap;
}

/**
 * Clears both cache tiers for the Student predicate maps.
 * Called by CoreData._clearCache(cfg) as part of the unified cache invalidation.
 */
function _clearStudentCache_() {
  _studentIdsCache = null;
  _studentPFCache = null;
  var keys = Object.keys(_perfCacheKnownKeysS_);
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i]);
    if (k.indexOf('studentDeploymentIds:') === 0 ||
        k.indexOf('studentProductFunctions:') === 0) {
      _perfCacheDeleteKeyS_(k);
    }
  }
}

/**
 * Performance Layer 2: Pre-warm CacheService for this app.
 * Called by four time-driven triggers per app (4 AM, 10 AM, 4 PM, 10 PM ET)
 * so cache never expires during business hours with the 6-hour TTL.
 * Computes SFDC raw rows and the enrichment map, writing both to CacheService
 * so user-triggered endpoints hit warm cache instead of paying cold-start cost.
 *
 * C1: Replaced _PerfCache sheet writes with CacheService writes.
 *
 * @param {AppConfig} config
 * @return {{ ok:boolean, durationMs:number, rows:number, enrichmentDeployments:number }}
 */
function _warmCaches(config) {
  var start = Date.now();
  var cfg = CoreConfig.withDefaults(config);
  // Clear in-memory first so we force fresh reads from live sheets, then
  // populate CacheService from those fresh reads.
  _enrichmentCache = null;
  var rowCount = 0;
  var deploymentCount = 0;
  try {
    // Trigger the enrichment computation. This will read live and write to
    // both tier 1 (in-memory) and tier 2 (CacheService) per C1.
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
  // D1: pre-warm DD-from-Contacts map for this app.
  try {
    getDdAssignmentsFromContacts_(cfg);
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: DD-from-Contacts warm failed: ' + err);
  }
  // S1: pre-warm Student maps (HENP-only; no-op elsewhere).
  try {
    getStudentDeploymentIds_(cfg);
    getStudentProductFunctionsMap_(cfg);
  } catch (err) {
    Logger.log('CoreSalesforce._warmCaches: Student warm failed: ' + err);
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
    var appId = (cfg && cfg.appId) ? cfg.appId : 'default';
    var dataVer = CoreData._dataVersion(cfg);
    var enrichmentCacheKey = 'enrichmentMap:' + appId + (dataVer ? ':' + dataVer : '');
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
  _clearDdContactsCache: _clearDdContactsCache,
  _clearStudentCache_: _clearStudentCache_,
  getStudentDeploymentIds_: getStudentDeploymentIds_,
  getStudentProductFunctionsMap_: getStudentProductFunctionsMap_,
  _warmCaches: _warmCaches
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

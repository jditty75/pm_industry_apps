/**
 * CoreData.gs
 *
 * Shared data access + effective "view" builders for:
 *   - Active deployments (Red/Yellow effective view, or full-portfolio per viewMode)
 *   - Go Lives (recent/all, grouped by account)
 *   - Upcoming Go Lives (90-day window)
 *   - Meta + override updates (DeploymentsMeta, DeploymentOverrides, GoLivesOverrides)
 *   - Phase 2: Audit trail writes, bulk-clear endpoints, classification reads/writes,
 *     viewMode-aware filtering via CoreUsers.
 *
 * Phase 2 notes:
 *   - Backward compatible. Existing callers without viewMode args continue to
 *     work (treated as 'all' mode).
 *   - Every mutation endpoint writes an OverrideAudit row. Audit-write failures
 *     are logged but do not throw — the mutation succeeds regardless.
 *   - Bulk-clear endpoints check the current user's role and reject non-PM
 *     callers.
 *
 * Phase 3a notes (v11):
 *   - getUpcomingGoLives() now calls CoreSalesforce.getDeploymentEnrichmentMap()
 *     to get phased deployment detail. Returns one row per deployment (not per
 *     account+date). Each row gains: upcomingDates[], isPhased, nextGoLiveDate.
 *   - getAllDeployments() injects isPhased from the enrichment map so the
 *     Deployments tab can show the "Phased" pill.
 *   - Both functions degrade gracefully when the SFDC_DeploymentProductFunctions
 *     sheet is absent: enrichment map returns {}, fallback path runs unchanged.
 *
 * Phase 3i notes:
 *   - readSfdcDeploymentsRaw_(cfg) — new internal function that reads the unified
 *     SFDC_Deployments sheet (Active + Complete) using header-based column
 *     detection. Returns all rows with a `status` field from Overall_Status__c.
 *   - getAllDeployments() — now reads from SFDC_Deployments (via the new reader)
 *     and filters to Active-only by default. Override/meta application is
 *     preserved for Active rows. Behavior for existing callers is unchanged.
 *   - getRecentGoLives(cfg, viewModeOpts) — NEW public function. Reads Complete
 *     deployments from SFDC_Deployments, merges enrichment map recentDates, and
 *     applies the recent-window filter. Supersedes the legacy getGoLives() for
 *     the Recent Go Lives view in both the WebApp and the monthly report.
 *   - getGoLives(cfg) — DEPRECATED in Phase 3i. Left in place; no callers remain
 *     after this phase. Will be removed once the legacy Go Lives sheet is deleted.
 */

var CoreData = (function () {

    // ===========================================================================
  // PHASE 3j: PER-EXECUTION CACHE
  // ---------------------------------------------------------------------------
  // Sheet reads are by far the slowest operation in any report build. Within
  // a single Apps Script execution (which is typically a single function call
  // like buildInlineHtmlWithAnalytics), we cache the three most-read maps so
  // they're computed at most once. The cache is invalidated on every new
  // execution because Apps Script tears down the V8 runtime between calls.
  // ===========================================================================
  var _cache = {
    sfdcRows: null,           // result of readSfdcDeploymentsRaw_
    pfRows: null,             // result of readSfdcProductFunctionsRaw_
    effectiveByProduct: {},   // getAllEffectiveDeployments cache keyed by product chip
    countByProduct: {},       // getActiveCountDeployments cache keyed by product chip
    historicalPfByProduct: {}, // getProductModeHistoricalPfRows_ cache
    metaMap: null,            // result of getDeploymentsMetaMap_
    overridesMap: null,       // result of getDeploymentOverridesMap_
    goLivesOverridesMap: null, // result of getGoLivesOverridesMap_
    mdsPglBatchView: {},       // { '<windowMonths>': payload } — tier 1 for getMdsPglBatchView
    overviewSnapshot: null,     // tier 1 for getOverviewSnapshot
    pfReaderMeta: null,         // last readSfdcProductFunctionsRaw_ header diagnostics
    dhpRows: null,              // result of readDeploymentHealthPlansRaw_
    dhpMap: null,               // result of buildDeploymentHealthPlanMap_
    wellnessRows: null,         // result of readWellnessPlansRaw_
    wellnessMap: null,          // result of buildWellnessMap_
    reportBuildCtx: null        // active monthly-report build context (per execution)
  };

  /**
   * Clears the in-memory cache. Called by every mutation function after
   * it writes to a source sheet, so subsequent reads in the same execution
   * see the new values.
   *
   * @param {AppConfig=} cfg Currently unused; kept for symmetry with Layer 2
   *                        (sheet-tab cache) which will use cfg.appId.
   */
  function _clearCache(cfg) {
    // Tier 1: in-memory.
    _cache.sfdcRows = null;
    _cache.pfRows = null;
    _cache.effectiveByProduct = {};
    _cache.countByProduct = {};
    _cache.historicalPfByProduct = {};
    _cache.metaMap = null;
    _cache.overridesMap = null;
    _cache.goLivesOverridesMap = null;
    _cache.mdsPglBatchView = {};
    _cache.overviewSnapshot = null;
    _cache.pfReaderMeta = null;
    _cache.dhpRows = null;
    _cache.dhpMap = null;
    _cache.wellnessRows = null;
    _cache.wellnessMap = null;
    _cache.reportBuildCtx = null;
    // Tier 2: sheet-tab cache. Layer 2. Clears all rows including mdsPglBatchView:* and overviewData:* keys.
    _perfCacheClearAll_();
    // Cross-module cache clears.
    try { CoreSalesforce._clearEnrichmentSheetCache(); } catch (e) {}
    try { CoreSalesforce._clearDdContactsCache(); } catch (e) {}
    try { CoreSalesforce._clearStudentCache_(); } catch (e) {}
  }

  /**
   * Performance Layer 2: Pre-warm the SFDC raw rows in the sheet-tab cache.
   * Called by CoreSalesforce._warmCaches via the time-based trigger in each app.
   *
   * @param {AppConfig} config
   */
  function _warmSfdcRows(config) {
    var cfg = CoreConfig.withDefaults(config);
    // Force a fresh read by clearing tier 1 first; the function will then
    // write fresh data to both tier 1 and tier 2.
    _cache.sfdcRows = null;
    try {
      if (usesProductModePfDataSource_(cfg)) {
        readProductModePfRowsRaw_(cfg);
      } else {
        readSfdcDeploymentsRaw_(cfg);
      }
    } catch (err) {
      Logger.log('CoreData._warmSfdcRows: ' + err);
    }
  }

  /**
   * Returns the current cached SFDC row count. Used by _warmCaches for
   * its log output.
   * @return {number}
   */
  function _getCachedSfdcRowCount() {
    return _cache.sfdcRows ? _cache.sfdcRows.length : 0;
  }

  // ===========================================================================
  // PERFORMANCE LAYER 2: CacheService — KNOWN NO-OP CROSS-EXECUTION
  // ---------------------------------------------------------------------------
  // STATUS (C1-Finalize, July 2026):
  //   The tier-2 CacheService layer is architecturally a no-op for
  //   cross-execution reads. Writes DO NOT persist to the calling app's
  //   cache. Reads always miss.
  //
  // ROOT CAUSE:
  //   CacheService.getScriptCache() called from within a library binds to
  //   the library's own script cache (DHLibrary's), not the calling app's.
  //   Since the three apps (SLG, HENP, HC) share DHLibrary but each has its
  //   own separate Apps Script project, writes from CoreLib go to
  //   DHLibrary's cache — invisible to the apps that need to read them.
  //
  // WHY THE CODE REMAINS:
  //   The encode/decode/chunking implementations are correct. They're
  //   preserved in case a future redesign passes cache handles from the
  //   app context into CoreLib functions (Option 2 in the C1-Finalize
  //   post-mortem). For now, the tier-2 calls silently write to
  //   DHLibrary's cache (unused) and reads silently miss and fall through
  //   to tier-3 (live recompute).
  //
  // WHAT ACTUALLY MAKES THE UI FAST:
  //   Tier-1 in-memory cache (var _cache = {...} above). Within a single
  //   execution, repeated reads hit tier-1 and return in ~15-25ms.
  //   Cold reads from source sheets take ~1-2 seconds (SLG 173 rows,
  //   HENP 291 rows). Every fresh execution pays this cost once.
  //
  // FUTURE:
  //   If cold-load latency becomes user-facing (data grows substantially,
  //   or new features need heavier aggregation), revisit with Option 2:
  //   refactor CoreLib to accept a cache parameter from the app context.
  // ===========================================================================

  var _PERF_CACHE_TTL_SEC = 21600;      // 6 hours (CacheService max)
  var _PERF_CACHE_CHUNK_SIZE = 90000;   // base64-encoded chars per chunk

  // _perfCacheKnownKeys tracks keys written during the current execution.
  // In the current no-op design, this is populated but never usefully read
  // by any other execution.
  var _perfCacheKnownKeys = {};

  /**
   * Builds a refresh-aware tier-2 cache key: baseName + appId + optional data-version token.
   * @param {AppConfig} cfg
   * @param {string} baseName
   * @return {string}
   * @private
   */
  function _perfKey_(cfg, baseName) {
    var appId = (cfg && cfg.appId) ? cfg.appId : 'default';
    var v = _sfdcDataVersion_(cfg);
    return baseName + ':' + appId + (v ? ':' + v : '');
  }

  /**
   * Serializes and compresses a value for CacheService storage.
   * Returns a base64-encoded gzipped string.
   * @private
   */
  function _perfCacheEncode_(value) {
    var json = JSON.stringify(value);
    var blob = Utilities.newBlob(json, 'application/json');
    var compressed = Utilities.gzip(blob);
    return Utilities.base64Encode(compressed.getBytes());
  }

  /**
   * Decodes and parses a CacheService payload.
   * Returns the parsed value or null on any error.
   * @private
   */
  function _perfCacheDecode_(encoded) {
    try {
      var bytes = Utilities.base64Decode(encoded);
      var blob = Utilities.newBlob(bytes, 'application/x-gzip');
      var decompressed = Utilities.ungzip(blob);
      return JSON.parse(decompressed.getDataAsString());
    } catch (err) {
      Logger.log('CoreData._perfCacheDecode_: failed to decode payload: ' + err);
      return null;
    }
  }

  /**
   * Reads a value from CacheService. Returns null if missing or decode fails.
   * @param {string} key
   * @return {*} the parsed value or null
   * @private
   */
  function _perfCacheRead_(key) {
    try {
      var cache = CacheService.getScriptCache();
      var manifestKey = key + ':manifest';
      var manifestRaw = cache.get(manifestKey);

      if (manifestRaw) {
        // Chunked path: read manifest, then chunks.
        var manifest;
        try {
          manifest = JSON.parse(manifestRaw);
        } catch (parseErr) {
          Logger.log('CoreData._perfCacheRead_: manifest parse failed for ' + key);
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
            Logger.log('CoreData._perfCacheRead_: missing chunk ' + j + ' for key=' + key + '; treating as miss.');
            return null;
          }
          combined += chunk;
        }
        return _perfCacheDecode_(combined);
      }

      // Single-key path.
      var single = cache.get(key);
      if (single === null || single === undefined) return null;
      return _perfCacheDecode_(single);
    } catch (err) {
      Logger.log('CoreData._perfCacheRead_: ' + err);
      return null;
    }
  }

  /**
   * Writes a value to CacheService. Best-effort with one retry on failure.
   * @param {string} key
   * @param {*} value any JSON-serializable value
   * @private
   */
  function _perfCacheWrite_(key, value) {
    var attempts = 0;
    var maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        var cache = CacheService.getScriptCache();
        var encoded = _perfCacheEncode_(value);

        // First, remove any prior chunks/manifest for this key.
        _perfCacheDeleteKey_(key);

        if (encoded.length <= _PERF_CACHE_CHUNK_SIZE) {
          cache.put(key, encoded, _PERF_CACHE_TTL_SEC);
          _perfCacheKnownKeys[key] = true;
          return;
        }

        // Chunked write.
        var chunkCount = Math.ceil(encoded.length / _PERF_CACHE_CHUNK_SIZE);
        var chunkMap = {};
        for (var i = 0; i < chunkCount; i++) {
          var start = i * _PERF_CACHE_CHUNK_SIZE;
          chunkMap[key + ':chunk:' + i] = encoded.substring(start, start + _PERF_CACHE_CHUNK_SIZE);
        }
        cache.putAll(chunkMap, _PERF_CACHE_TTL_SEC);
        cache.put(key + ':manifest', JSON.stringify({ chunks: chunkCount, algorithm: 'gzip-base64' }), _PERF_CACHE_TTL_SEC);

        _perfCacheKnownKeys[key] = true;
        Logger.log('CoreData._perfCacheWrite_: chunked key=' + key + ' into ' + chunkCount + ' pieces.');
        return;
      } catch (err) {
        Logger.log('CoreData._perfCacheWrite_ attempt ' + attempts + ' failed for key=' + key + ': ' + err);
        if (attempts < maxAttempts) {
          Utilities.sleep(500);
        } else {
          Logger.log('CoreData._perfCacheWrite_: giving up on key=' + key + ' after ' + attempts + ' attempts.');
        }
      }
    }
  }

  /**
   * Removes a key (and its chunks/manifest) from CacheService.
   * @param {string} key
   * @private
   */
  function _perfCacheDeleteKey_(key) {
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
      delete _perfCacheKnownKeys[key];
    } catch (err) {
      Logger.log('CoreData._perfCacheDeleteKey_: ' + err);
    }
  }

  /**
   * Removes all keys tracked during this execution from CacheService.
   * Called by _clearCache(cfg) when a mutation invalidates the data.
   * @private
   */
  function _perfCacheClearAll_() {
    try {
      var keys = Object.keys(_perfCacheKnownKeys);
      if (keys.length === 0) return;
      for (var i = 0; i < keys.length; i++) {
        _perfCacheDeleteKey_(keys[i]);
      }
      _perfCacheKnownKeys = {};
    } catch (err) {
      Logger.log('CoreData._perfCacheClearAll_: ' + err);
    }
  }

  // ===========================================================================
  // INTERNAL HELPERS
  // ===========================================================================

  function getSpreadsheet_() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  function getCurrentUserEmail_() {
    try {
      var e = Session.getActiveUser().getEmail();
      if (e) return e;
      e = Session.getEffectiveUser().getEmail();
      if (e) return e;
    } catch (err) {
      // Fall through
    }
    return 'unknown@workday.com';
  }

  function getDeploymentsMetaMap_(config) {
    if (_cache.metaMap !== null) return _cache.metaMap;
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentsMeta);
    var map = {};
    if (!sheet) return map;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return map;

    values.slice(1).forEach(function (row) {
      var id = String(row[0] || '').trim();
      if (!id) return;
      map[id] = {
        deliveryDirector: row[1] || '',
        ddNotes:          row[2] || '',
        username:         row[3] || '',
        timestamp:        row[4] ? CoreUtils.formatDateToIsoString(row[4]) : ''
      };
    });
    _cache.metaMap = map;
    return map;
  }

  function getDeploymentOverridesMap_(config) {
    if (_cache.overridesMap !== null) return _cache.overridesMap;
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentOverrides);
    var map = {};
    if (!sheet) return map;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return map;

    var headers = values[0];
    var idxId        = headers.indexOf('DeploymentID');
    var idxHealth    = headers.indexOf('Override_Health');
    var idxMtpDate   = headers.indexOf('Override_MTPDate');
    var idxStage     = headers.indexOf('Override_Stage');
    var idxAcct      = headers.indexOf('Override_Account');
    var idxDepName   = headers.indexOf('Override_Deployment');
    var idxCurrUpd   = headers.indexOf('Override_CurrentUpdate');
    var idxExclude   = headers.indexOf('Exclude_From_Report');
    var idxUser      = headers.indexOf('LastEditedBy');
    var idxTime      = headers.indexOf('LastEditedAt');
    var idxClass     = headers.indexOf('Classification'); // Phase 2

    values.slice(1).forEach(function (row) {
      var id = String(row[idxId] || '').trim();
      if (!id) return;
      map[id] = {
        overrideHealth:        idxHealth   >= 0 ? (row[idxHealth] || '') : '',
        overrideMtp:           idxMtpDate  >= 0 ? row[idxMtpDate] : null,
        overrideStage:         idxStage    >= 0 ? (row[idxStage] || '') : '',
        overrideAccount:       idxAcct     >= 0 ? (row[idxAcct] || '') : '',
        overrideName:          idxDepName  >= 0 ? (row[idxDepName] || '') : '',
        overrideCurrentUpdate: idxCurrUpd  >= 0 ? (row[idxCurrUpd] || '') : '',
        exclude:               idxExclude  >= 0 ? _boolFromSheetCell_(row[idxExclude]) : false,
        lastEditedBy:          idxUser     >= 0 ? (row[idxUser] || '') : '',
        lastEditedAt:          (idxTime    >= 0 && row[idxTime]) ? CoreUtils.formatDateToIsoString(row[idxTime]) : '',
        classification:        normalizeClassification_(idxClass >= 0 ? row[idxClass] : '')
      };
    });

    // N3: collapse 15/18-char twin keys — newest LastEditedAt wins; result keyed by full id.
    var rawMap = map;
    map = {};
    var byPrefix = {};
    Object.keys(rawMap).forEach(function (id) {
      var entry = rawMap[id];
      var prefix = id.length >= 15 ? id.slice(0, 15) : id;
      if (!byPrefix[prefix]) {
        byPrefix[prefix] = { fullId: id, entry: entry };
      } else {
        var kept = byPrefix[prefix];
        var keptTs = kept.entry.lastEditedAt || '';
        var newTs = entry.lastEditedAt || '';
        if (newTs > keptTs) {
          Logger.log('CoreData.getDeploymentOverridesMap_: collapsed override twin for prefix ' +
                     prefix + ' — kept ' + id + ' (lastEditedAt=' + newTs + ') over ' +
                     kept.fullId + ' (lastEditedAt=' + keptTs + ')');
          byPrefix[prefix] = { fullId: id, entry: entry };
        } else {
          Logger.log('CoreData.getDeploymentOverridesMap_: collapsed override twin for prefix ' +
                     prefix + ' — kept ' + kept.fullId + ' (lastEditedAt=' + keptTs + ') over ' +
                     id + ' (lastEditedAt=' + newTs + ')');
        }
      }
    });
    Object.keys(byPrefix).forEach(function (prefix) {
      var kept = byPrefix[prefix];
      map[kept.fullId] = kept.entry;
    });

    _cache.overridesMap = map;
    return map;
  }

  function getGoLivesOverridesMap_(config) {
    if (_cache.goLivesOverridesMap !== null) return _cache.goLivesOverridesMap;
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.goLivesOverrides);
    var map = {};
    if (!sheet) return map;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return map;

    var headers = values[0];
    var idxAcct    = headers.indexOf('AccountName');
    var idxExclude = headers.indexOf('Exclude_From_Report');
    var idxDate    = headers.indexOf('Override_GoLiveDate');
    var idxPartner = headers.indexOf('Override_Partner');
    var idxUser    = headers.indexOf('LastEditedBy');
    var idxTime    = headers.indexOf('LastEditedAt');
    var idxClass   = headers.indexOf('Classification'); // Phase 2

    values.slice(1).forEach(function (row) {
      var acct = String(row[idxAcct] || '').trim();
      if (!acct) return;
      map[acct] = {
        exclude:         idxExclude >= 0 ? _boolFromSheetCell_(row[idxExclude]) : false,
        overrideDate:    idxDate    >= 0 ? row[idxDate] : null,
        overridePartner: idxPartner >= 0 ? (row[idxPartner] || '') : '',
        lastEditedBy:    idxUser    >= 0 ? (row[idxUser] || '') : '',
        lastEditedAt:    (idxTime   >= 0 && row[idxTime]) ? CoreUtils.formatDateToIsoString(row[idxTime]) : '',
        classification:  normalizeClassification_(idxClass >= 0 ? row[idxClass] : '')
      };
    });
    _cache.goLivesOverridesMap = map;
    return map;
  }

  /**
   * Normalize a Classification cell value. Blank/unknown returns 'Monthly'.
   * @param {any} v
   * @return {string}  'Monthly' | 'Structural'
   * @private
   */
  function normalizeClassification_(v) {
    var s = String(v || '').trim().toLowerCase();
    if (s === 'structural') return 'Structural';
    return 'Monthly';
  }

  /** @const {Array<string>} DeploymentOverrides sheet column headers (write order). */
  var _DEPLOYMENT_OVERRIDE_HEADERS_ = [
    'DeploymentID',
    'Override_Health',
    'Override_MTPDate',
    'Override_Stage',
    'Override_Account',
    'Override_Deployment',
    'Override_CurrentUpdate',
    'Exclude_From_Report',
    'LastEditedBy',
    'LastEditedAt',
    'Classification'
  ];

  /** @const {Array<string>} GoLivesOverrides sheet column headers (write order). */
  var _GOLIVES_OVERRIDE_HEADERS_ = [
    'AccountName',
    'Exclude_From_Report',
    'Override_GoLiveDate',
    'Override_Partner',
    'LastEditedBy',
    'LastEditedAt',
    'Classification'
  ];

  /**
   * Coerces a sheet cell value to boolean (checkbox, TRUE/FALSE strings, 1/0).
   * @param {*} v
   * @return {boolean}
   * @private
   */
  function _boolFromSheetCell_(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v === '' || v == null) return false;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }

  /**
   * Returns the 0-based column index for a header name in a header row (-1 if absent).
   * @param {Array<*>} headers
   * @param {string} headerName
   * @return {number}
   * @private
   */
  function _getSheetColumnIndex_(headers, headerName) {
    if (!Array.isArray(headers)) return -1;
    return headers.indexOf(String(headerName || '').trim());
  }

  /**
   * Ensures a sheet header row contains all required columns (appends missing ones).
   * Idempotent — safe to call on every override write.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {Array<string>} requiredHeaders
   * @return {Array<string>} current header row after ensure
   * @private
   */
  function _ensureSheetHeaders_(sheet, requiredHeaders) {
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    var changed = false;
    (requiredHeaders || []).forEach(function (header) {
      if (_getSheetColumnIndex_(headers, header) < 0) {
        headers.push(header);
        changed = true;
      }
    });
    if (changed) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    return headers;
  }

  /**
   * Drops rows flagged excludeFromReport (monthly HTML report opt-in).
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   */
  function filterRowsExcludedFromReport_(rows) {
    if (!Array.isArray(rows) || !rows.length) return rows || [];
    return rows.filter(function (r) { return !r.excludeFromReport; });
  }

  /**
   * Merges deployment + Go-Lives override fields onto go-live rows for report/UI parity.
   * Option B precedence: excluded when row, deployment override, or go-live override is flagged.
   *
   * @param {Array<Object>} rows
   * @param {Object} deploymentOverridesMap  keyed by deploymentId (getDeploymentOverridesMap_)
   * @param {Object} goLivesOverridesMap     keyed by accountName (getGoLivesOverridesMap_)
   * @return {Array<Object>}
   * @private
   */
  function _enrichGoLiveRowsWithOverrides_(rows, deploymentOverridesMap, goLivesOverridesMap) {
    if (!Array.isArray(rows) || !rows.length) return rows || [];

    var depMap = deploymentOverridesMap || {};
    var glMap = goLivesOverridesMap || {};

    return rows.map(function (row) {
      var depId = row.deploymentId || '';
      var acct = row.accountName || '';
      var depOv = depId ? (depMap[depId] || {}) : {};
      var glOv = acct ? (glMap[acct] || {}) : {};
      var excluded = !!(
        row.excludeFromReport ||
        depOv.exclude ||
        glOv.exclude
      );
      return Object.assign({}, row, {
        partner:           glOv.overridePartner || row.partner || '',
        currentUpdate:     depOv.overrideCurrentUpdate || row.currentUpdate || '',
        excludeFromReport: excluded
      });
    });
  }

  /**
   * Normalizes a Salesforce deployment id string (trim; use full 18 when present).
   * @param {any} id
   * @return {string}
   * @private
   */
  function _canonicalId_(id) {
    var s = String(id || '').trim();
    return s.length >= 18 ? s.slice(0, 18) : s;
  }

  /**
   * Config-gated ProductMode switch for two-source active deployment union.
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {boolean}
   * @private
   */
  function isProductModeActiveDeploymentsUnionEnabled_(cfg) {
    return !!(cfg && cfg.activeDeployments &&
              cfg.activeDeployments.productModeUnionEnabled === true);
  }

  /**
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function _getProductModeSourceMode_(cfg) {
    if (!isProductModeActiveDeploymentsUnionEnabled_(cfg)) return 'parent';
    return (cfg.activeDeployments && cfg.activeDeployments.productModeSourceMode) || 'parentPlusPf';
  }

  /**
   * ProductMode display grain for active deployment surfaces.
   * @param {AppConfig} cfg
   * @return {'pfRow'|'parentDeployment'|'deploymentProduct'}
   * @private
   */
  function _getProductModeDisplayGrain_(cfg) {
    if (!isProductModeActiveDeploymentsUnionEnabled_(cfg)) return 'pfRow';
    var grain = cfg.activeDeployments && cfg.activeDeployments.productModeDisplayGrain;
    if (grain === 'parentDeployment' || grain === 'deploymentProduct') return grain;
    return 'pfRow';
  }

  /**
   * ProductMode count grain for Overview / analytics / portfolio KPI totals.
   * Independent of display grain. Unset or invalid values follow display grain
   * so existing apps keep prior count behavior.
   * @param {AppConfig} cfg
   * @return {'pfRow'|'parentDeployment'|'deploymentProduct'}
   * @private
   */
  function _getProductModeCountGrain_(cfg) {
    if (!isProductModeActiveDeploymentsUnionEnabled_(cfg)) return 'pfRow';
    var grain = cfg.activeDeployments && cfg.activeDeployments.productModeCountGrain;
    if (grain === 'parentDeployment' || grain === 'deploymentProduct' || grain === 'pfRow') {
      return grain;
    }
    return _getProductModeDisplayGrain_(cfg);
  }

  /**
   * ProductMode go-live event grain.
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function _getProductModeGoLiveGrain_(cfg) {
    return (cfg.activeDeployments && cfg.activeDeployments.productModeGoLiveGrain) ||
      'accountDate';
  }

  /**
   * Normalizes a product area string for stable group keys.
   * @param {string} productArea
   * @return {string}
   * @private
   */
  function _normalizeProductAreaKey_(productArea) {
    return String(productArea || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  /**
   * Stable deploymentId for deploymentProduct grain groups.
   * @param {string} parentId
   * @param {string} productArea
   * @return {string}
   * @private
   */
  function _deriveGroupedDeploymentProductId_(parentId, productArea) {
    return _canonicalId_(parentId) + '__product__' + _normalizeProductAreaKey_(productArea);
  }

  /**
   * Detail object for one PF row attached to a grouped deployment row.
   * @param {Object} pf
   * @return {Object}
   * @private
   */
  function _buildPfDetailObject_(pf) {
    return {
      pfRowId: pf.pfRowId || '',
      productArea: pf.productArea || '',
      funcArea: pf.funcArea || '',
      targetGoLive: pf.targetGoLive || '',
      actualGoLive: pf.actualGoLive || '',
      overallStatus: pf.overallStatus || '',
      phase: pf.phase || '',
      stage: pf.stage || '',
      health: pf.health || ''
    };
  }

  /**
   * Collects eligible PF rows for pfOnly active deployment builds.
   * @param {Array<Object>} pfRows
   * @param {AppConfig} cfg
   * @return {Array<{pf: Object, index: number}>}
   * @private
   */
  function _collectEligiblePfOnlyRows_(pfRows, cfg) {
    var seenPf = {};
    var eligible = [];
    (pfRows || []).forEach(function (pf, index) {
      if (!pf || (!pf.deploymentFk && !pf.parentDeploymentId)) return;
      var eligibility = _evaluatePfOnlyRowEligibility_(pf, cfg);
      if (!eligibility.eligible) return;
      var dedupeKey = _pfOnlyDedupeKey_(pf);
      if (seenPf[dedupeKey]) return;
      seenPf[dedupeKey] = true;
      eligible.push({ pf: pf, index: index });
    });
    return eligible;
  }

  /**
   * Analyzes PF row counts at each display grain (diagnostics).
   * @param {Array<Object>} pfRows
   * @param {AppConfig} cfg
   * @return {Object}
   * @private
   */
  function _analyzePfDisplayGrain_(pfRows, cfg) {
    var eligible = _collectEligiblePfOnlyRows_(pfRows, cfg);
    var parentCounts = {};
    var parentProductCounts = {};
    var parentNames = {};

    eligible.forEach(function (item) {
      var pf = item.pf;
      var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      parentCounts[parentId] = (parentCounts[parentId] || 0) + 1;
      if (!parentNames[parentId]) {
        parentNames[parentId] = pf.accountName || pf.deploymentName || parentId;
      }
      var ppKey = parentId + '|' + String(pf.productArea || '').trim().toLowerCase();
      parentProductCounts[ppKey] = (parentProductCounts[ppKey] || 0) + 1;
    });

    var dupParentExamples = [];
    var dupParentProductExamples = [];
    Object.keys(parentCounts).forEach(function (pid) {
      if (parentCounts[pid] > 1 && dupParentExamples.length < 5) {
        dupParentExamples.push({
          parentDeploymentId: pid,
          accountName: parentNames[pid] || '',
          rowCount: parentCounts[pid]
        });
      }
    });
    Object.keys(parentProductCounts).forEach(function (key) {
      if (parentProductCounts[key] > 1 && dupParentProductExamples.length < 5) {
        var sep = key.indexOf('|');
        dupParentProductExamples.push({
          parentDeploymentId: key.slice(0, sep),
          productArea: key.slice(sep + 1),
          rowCount: parentProductCounts[key]
        });
      }
    });

    return {
      pfActiveRowCount: eligible.length,
      groupedParentDeploymentCount: Object.keys(parentCounts).length,
      groupedDeploymentProductCount: Object.keys(parentProductCounts).length,
      duplicateParentExamples: dupParentExamples,
      duplicateParentProductExamples: dupParentProductExamples
    };
  }

  /**
   * Builds one grouped ProductMode deployment row from multiple PF records.
   * @param {Array<{pf: Object, index: number}>} groupItems
   * @param {AppConfig} cfg
   * @param {'parentDeployment'|'deploymentProduct'} grain
   * @param {Object} metaMap
   * @param {Object} overridesMap
   * @param {Object} wellnessMap
   * @param {number} groupIndex
   * @return {Object|null}
   * @private
   */
  function _buildGroupedPfDeploymentRow_(groupItems, cfg, grain, metaMap, overridesMap, wellnessMap, groupIndex) {
    if (!groupItems || !groupItems.length) return null;

    var primary = groupItems[0];
    var pf = primary.pf;
    var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
    var row = _buildPfOnlyDeploymentRow_(pf, cfg, metaMap, overridesMap, primary.index, wellnessMap);
    row.deploymentName = String(pf.deploymentName || row.deploymentName || '').trim();

    var productFunctions = groupItems.map(function (item) {
      return _buildPfDetailObject_(item.pf);
    });
    var functions = [];
    var productAreas = [];
    groupItems.forEach(function (item) {
      var fa = String(item.pf.funcArea || '').trim();
      if (fa && functions.indexOf(fa) < 0) functions.push(fa);
      var pa = String(item.pf.productArea || '').trim();
      if (pa && productAreas.indexOf(pa) < 0) productAreas.push(pa);
    });

    var groupId = grain === 'parentDeployment'
      ? parentId
      : _deriveGroupedDeploymentProductId_(parentId, pf.productArea);

    row.deploymentId = groupId;
    row.parentDeploymentId = parentId;
    row.deploymentFk = parentId;
    row.deploymentRowSource = 'productFunctionGrouped';
    row.parentMatchStatus = 'pfGrouped';
    row.productFunctions = productFunctions;
    row.productFunctionCount = productFunctions.length;
    row.productAreas = productAreas;
    row.functions = functions;
    row.productArea = grain === 'deploymentProduct'
      ? (pf.productArea || '')
      : productAreas.join(', ');
    row.funcArea = functions.join(', ');
    row.rowIndex = primary.index + 2;
    return row;
  }

  /**
   * True when ProductMode apps should use PF sheet as primary data source.
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function usesProductModePfDataSource_(cfg) {
    if (!isProductModeActiveDeploymentsUnionEnabled_(cfg)) return false;
    var src = (cfg.activeDeployments && cfg.activeDeployments.productModeDataSource) || 'parent';
    return src === 'productFunction' || _getProductModeSourceMode_(cfg) === 'pfOnly';
  }

  /**
   * True when go-live surfaces should read PF rows (active + complete).
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function usesProductModePfGoLiveSource_(cfg) {
    if (!isProductModeActiveDeploymentsUnionEnabled_(cfg)) return false;
    return (cfg.activeDeployments && cfg.activeDeployments.productModeGoLiveSource) === 'productFunction';
  }

  /**
   * True when historical/report surfaces should read PF rows (active + complete).
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function usesProductModePfHistoricalSource_(cfg) {
    if (!isProductModeActiveDeploymentsUnionEnabled_(cfg)) return false;
    return (cfg.activeDeployments && cfg.activeDeployments.productModeHistoricalSource) === 'productFunction';
  }

  /**
   * Canonical ProductMode PF raw reader (normalized relationship fields).
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function readProductModePfRowsRaw_(cfg) {
    return readSfdcProductFunctionsRaw_(cfg);
  }

  /**
   * Filters PF rows by global product chip when enabled.
   * @param {Array<Object>} pfRows
   * @param {string} productArea
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function filterProductModePfRowsByProduct_(pfRows, productArea, cfg) {
    if (!cfg || !cfg.ui || !cfg.ui.productFilter || cfg.ui.productFilter.enabled !== true) {
      return pfRows;
    }
    if (!productArea || productArea === 'all') return pfRows;
    if (!Array.isArray(pfRows) || !pfRows.length) return pfRows;

    var nameTokens = (cfg.ui.productFilter.nameTokens &&
                      cfg.ui.productFilter.nameTokens[productArea]) || [];
    return pfRows.filter(function (pf) {
      if (String(pf.productArea || '').trim() === productArea) return true;
      if (!nameTokens.length) return false;
      var depName = String(pf.deploymentName || '').toLowerCase();
      if (!depName) return false;
      for (var ti = 0; ti < nameTokens.length; ti++) {
        var token = String(nameTokens[ti] || '').toLowerCase();
        if (token && depName.indexOf(token) >= 0) return true;
      }
      return false;
    });
  }

  /**
   * Returns all PF rows for historical/go-live analysis (Active + Complete).
   * @param {AppConfig} cfg
   * @param {Object=} productOpts
   * @return {Array<Object>}
   * @private
   */
  function getProductModeHistoricalPfRows_(cfg, productOpts) {
    var pa = (productOpts && productOpts.product) || 'all';
    var cacheKey = 'hist:' + pa;
    if (_cache.historicalPfByProduct && _cache.historicalPfByProduct[cacheKey]) {
      return _cache.historicalPfByProduct[cacheKey];
    }
    var pfRows = [];
    try {
      pfRows = readProductModePfRowsRaw_(cfg) || [];
    } catch (e) {
      Logger.log('CoreData.getProductModeHistoricalPfRows_: read failed: ' + e);
      return [];
    }
    pfRows = filterProductModePfRowsByProduct_(pfRows, pa, cfg);
    pfRows = filterRowsByReportProductScope_(pfRows, cfg);
    pfRows = filterDeploymentsByStudent_(pfRows, 'exclude', cfg);
    if (!_cache.historicalPfByProduct) _cache.historicalPfByProduct = {};
    _cache.historicalPfByProduct[cacheKey] = pfRows;
    return pfRows;
  }

  /**
   * Parent deployment id for parent-keyed joins (meta, overrides, DD, wellness).
   * @param {Object} row
   * @return {string}
   * @private
   */
  function _parentDeploymentLookupId_(row) {
    if (!row) return '';
    return _canonicalId_(row.parentDeploymentId || row.deploymentFk || row.deploymentId);
  }

  /**
   * Begins a request-scoped report build context and pre-warms shared reads.
   * @param {AppConfig} cfg
   * @return {Object}
   */
  function beginReportBuildContext_(cfg) {
    if (_cache.reportBuildCtx) return _cache.reportBuildCtx;
    var ctx = {
      cfg: cfg,
      startedAt: Date.now(),
      phases: []
    };
    _cache.reportBuildCtx = ctx;
    if (usesProductModePfDataSource_(cfg)) {
      readSfdcProductFunctionsRaw_(cfg);
    }
    try {
      CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (e) {
      Logger.log('CoreData.beginReportBuildContext_: enrichment warm failed: ' + e);
    }
    return ctx;
  }

  /**
   * Ends the active report build context marker.
   */
  function endReportBuildContext_() {
    _cache.reportBuildCtx = null;
  }

  /**
   * Records a report-build phase timing entry on the active context.
   * @param {string} phase
   * @param {number} startedMs
   * @param {number=} totalStartMs
   * @private
   */
  function _markReportBuildPhase_(phase, startedMs, totalStartMs) {
    var ctx = _cache.reportBuildCtx;
    if (!ctx) return;
    var now = Date.now();
    ctx.phases.push({
      phase: phase,
      ms: now - startedMs,
      totalMs: totalStartMs ? now - totalStartMs : now - ctx.startedAt
    });
    Logger.log('CoreData.reportBuild: ' + phase + ' +' + (now - startedMs) + 'ms total=' +
               (totalStartMs ? now - totalStartMs : now - ctx.startedAt) + 'ms');
  }

  /**
   * @param {AppConfig} cfg
   * @return {Array<string>}
   * @private
   */
  function _getProductModeUnionStatuses_(cfg) {
    var statuses = cfg && cfg.activeDeployments && cfg.activeDeployments.productModeUnionStatuses;
    return Array.isArray(statuses) && statuses.length ? statuses.slice() : ['Active'];
  }

  /**
   * @param {string} phase
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function _isExcludedPfPhase_(phase, cfg) {
    var excluded = cfg && cfg.activeDeployments && cfg.activeDeployments.productModeExcludePhases;
    if (!Array.isArray(excluded) || !excluded.length) return false;
    if (!phase) return false;
    var norm = String(phase).trim().toLowerCase();
    for (var i = 0; i < excluded.length; i++) {
      if (String(excluded[i] || '').trim().toLowerCase() === norm) return true;
    }
    return false;
  }

  /**
   * @param {Object} pf
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function _isExcludedCustomer360PfRow_(pf, cfg) {
    if (!(cfg && cfg.activeDeployments &&
          cfg.activeDeployments.productModeExcludeCustomer360 === true)) {
      return false;
    }
    var hay = [
      pf.productArea, pf.funcArea, pf.deploymentName, pf.accountName
    ].join(' ').toLowerCase();
    return hay.indexOf('customer 360') >= 0;
  }

  /**
   * @param {Object} pf
   * @param {Object=} parentRow
   * @return {string}
   * @private
   */
  function _getPfRowStatus_(pf, parentRow) {
    if (pf && pf.overallStatus) return String(pf.overallStatus).trim();
    if (parentRow && parentRow.overallStatus) return String(parentRow.overallStatus).trim();
    return '';
  }

  /**
   * @param {Object} pf
   * @param {Object=} parentRow
   * @param {AppConfig} cfg
   * @return {{ eligible: boolean, reason: string }}
   * @private
   */
  function _evaluatePfRowStatus_(pf, parentRow, cfg) {
    var eligibleStatuses = _getProductModeUnionStatuses_(cfg);
    var allowNoStatus = !!(cfg.activeDeployments &&
                           cfg.activeDeployments.allowPfRowsWithoutParentStatus === true);
    var completeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                          cfg.salesforce.statusValues.complete) || 'Complete';
    var status = _getPfRowStatus_(pf, parentRow);

    if (!status) {
      return allowNoStatus
        ? { eligible: true, reason: '' }
        : { eligible: false, reason: 'statusMissing' };
    }
    if (status === completeStatus) {
      return { eligible: false, reason: 'statusComplete' };
    }
    if (eligibleStatuses.indexOf(status) < 0) {
      return { eligible: false, reason: 'statusNotEligible' };
    }
    return { eligible: true, reason: '' };
  }

  /**
   * @param {Object} pf
   * @param {AppConfig} cfg
   * @return {{ eligible: boolean, reason: string }}
   * @private
   */
  function _evaluatePfOnlyRowEligibility_(pf, cfg) {
    if (!pf) return { eligible: false, reason: 'missingRow' };
    if (!(_canonicalId_(pf.parentDeploymentId || pf.deploymentFk))) {
      return { eligible: false, reason: 'missingDeploymentId' };
    }
    if (!String(pf.deploymentName || '').trim() && !String(pf.accountName || '').trim()) {
      return { eligible: false, reason: 'missingMinimumFields' };
    }
    if (!String(pf.productArea || '').trim() && !String(pf.funcArea || '').trim()) {
      return { eligible: false, reason: 'missingMinimumFields' };
    }
    var statusEval = _evaluatePfRowStatus_(pf, null, cfg);
    if (!statusEval.eligible) return { eligible: false, reason: statusEval.reason };
    if (_isExcludedPfPhase_(pf.phase, cfg)) return { eligible: false, reason: 'excludedPhase' };
    if (_isExcludedCustomer360PfRow_(pf, cfg)) return { eligible: false, reason: 'excludedCustomer360' };
    return { eligible: true, reason: '' };
  }

  /**
   * Dedupe key for pfOnly mode: pfRowId when present, else deterministic fallback.
   * @param {Object} pf
   * @return {string}
   * @private
   */
  function _pfOnlyDedupeKey_(pf) {
    if (pf.pfRowId) return 'id:' + _canonicalId_(pf.pfRowId);
    return _productFunctionDedupeKey_(pf);
  }

  /**
   * Builds one PF-only deployment-shaped row (one row per PF record).
   * @param {Object} pf
   * @param {AppConfig} cfg
   * @param {Object} metaMap
   * @param {Object} overridesMap
   * @param {number} index
   * @return {Object}
   * @private
   */
  function _buildPfOnlyDeploymentRow_(pf, cfg, metaMap, overridesMap, index, wellnessMap) {
    var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
    var meta = (metaMap && metaMap[parentId]) || {};
    var accountId = pf.accountId || '';
    var wKey = accountId ? accountId.slice(0, 15) : '';
    var wellness = (wellnessMap && wKey && wellnessMap[wKey]) || null;
    var base = {
      deploymentId: parentId,
      parentDeploymentId: parentId,
      deploymentFk: parentId,
      deploymentName: pf.deploymentName || '',
      accountId: accountId,
      accountName: pf.accountName || '',
      industry: pf.industry || '',
      region: pf.region || '',
      subRegion: pf.subRegion || '',
      subRegionAlt: pf.subRegionAlt || '',
      deploymentStartDate: pf.deploymentStartDate || '',
      mtpDate: pf.mtpDate || '',
      firstMtpDateActual: pf.firstMtpDateActual || '',
      overallStatus: pf.overallStatus || '',
      phase: pf.phase || '',
      stage: pf.stage || '',
      health: pf.health || '',
      completionDate: pf.completionDate || '',
      wdEngManager: pf.wdEngManager || '',
      damFullName: pf.damFullName || '',
      primingPartner: pf.primingPartner || '',
      implPartner: pf.implPartner || '',
      partner: pf.partner || '',
      currentUpdate: pf.currentUpdate || '',
      rowIndex: index + 2,
      deliveryDirector: meta.deliveryDirector || '',
      ddNotes: meta.ddNotes || '',
      metaUsername: meta.username || '',
      metaTimestamp: meta.timestamp || ''
    };
    _attachWellnessFieldsToRow_(base, wellness);

    var derived = buildEffectiveDeploymentRow_(base, overridesMap || {});
    derived.deploymentId = _deriveProductFunctionDeploymentId_(parentId, pf);
    derived.parentDeploymentId = parentId;
    derived.deploymentFk = parentId;
    derived.deploymentRowSource = 'productFunction';
    derived.parentMatchStatus = 'pfOnly';
    return _overlayPfFieldsOnDeploymentRow_(derived, pf);
  }

  /**
   * Builds ProductMode pfOnly rows at a requested grain.
   * @param {AppConfig} cfg  Already-defaulted config.
   * @param {'pfRow'|'parentDeployment'|'deploymentProduct'} grain
   * @return {Array<Object>}
   * @private
   */
  function _buildProductModePfOnlyRowsAtGrain_(cfg, grain) {
    var pfRows = [];
    try {
      pfRows = readSfdcProductFunctionsRaw_(cfg) || [];
    } catch (e) {
      Logger.log('CoreData._buildProductModePfOnlyRowsAtGrain_: read failed: ' + e);
      return [];
    }

    var metaMap = getDeploymentsMetaMap_(cfg);
    var overridesMap = getDeploymentOverridesMap_(cfg);
    var wellnessMap = {};
    try { wellnessMap = buildWellnessMap_(cfg) || {}; } catch (e) {
      Logger.log('CoreData._buildProductModePfOnlyRowsAtGrain_: buildWellnessMap_ failed: ' + e);
    }

    var eligible = _collectEligiblePfOnlyRows_(pfRows, cfg);
    var effective = [];

    if (grain === 'pfRow') {
      eligible.forEach(function (item) {
        var row = _buildPfOnlyDeploymentRow_(item.pf, cfg, metaMap, overridesMap, item.index, wellnessMap);
        if (!row || !row.deploymentId) return;
        if (!(row.accountName || row.deploymentName)) return;
        effective.push(row);
      });
    } else {
      var groups = {};
      eligible.forEach(function (item) {
        var pf = item.pf;
        var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
        var groupKey = grain === 'parentDeployment'
          ? parentId
          : parentId + '__product__' + _normalizeProductAreaKey_(pf.productArea);
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(item);
      });

      var groupIndex = 0;
      Object.keys(groups).forEach(function (groupKey) {
        var row = _buildGroupedPfDeploymentRow_(
          groups[groupKey], cfg, grain, metaMap, overridesMap, wellnessMap, groupIndex++);
        if (!row || !row.deploymentId) return;
        if (!(row.accountName || row.deploymentName)) return;
        effective.push(row);
      });
    }

    Logger.log('CoreData._buildProductModePfOnlyRowsAtGrain_: ' + effective.length +
               ' active rows (grain=' + grain + ') from ' + pfRows.length + ' PF records.');
    return effective;
  }

  /**
   * ProductMode pfOnly: active deployments built exclusively from PF sheet rows.
   * Uses productModeDisplayGrain for Deployments-tab / display surfaces.
   * @param {AppConfig} config
   * @return {Array<Object>}
   * @private
   */
  function buildProductModePfOnlyEffectiveDeployments_(config) {
    var cfg = CoreConfig.withDefaults(config);
    return _buildProductModePfOnlyRowsAtGrain_(cfg, _getProductModeDisplayGrain_(cfg));
  }

  /**
   * ProductMode active rows for KPI counts, independent of display grain.
   * @param {AppConfig} cfg  Already-defaulted config.
   * @param {Object=} productOpts
   * @return {Array<Object>}
   * @private
   */
  function getProductModeActiveCountRows_(cfg, productOpts) {
    var pa = (productOpts && productOpts.product) || 'all';
    var cacheKey = String(pa);
    if (_cache.countByProduct && _cache.countByProduct[cacheKey]) {
      return _cache.countByProduct[cacheKey];
    }

    var countGrain = _getProductModeCountGrain_(cfg);
    var displayGrain = _getProductModeDisplayGrain_(cfg);
    var rows;

    if (countGrain === displayGrain) {
      rows = getAllEffectiveDeployments(cfg, productOpts) || [];
    } else {
      rows = _buildProductModePfOnlyRowsAtGrain_(cfg, countGrain);
      rows = _attachDdContactsToRows_(rows, cfg);
      rows = filterDeploymentsByProduct_(rows, pa, cfg);
    }

    if (!_cache.countByProduct) _cache.countByProduct = {};
    _cache.countByProduct[cacheKey] = rows;
    return rows;
  }

  /**
   * Active rows for app-level KPI counts (Overview, analytics, portfolio totals).
   * ProductMode uses productModeCountGrain; IndustryMode uses parent deployments.
   *
   * @param {AppConfig} config
   * @param {Object=} productOpts
   * @return {Array<Object>}
   */
  function getActiveCountDeployments(config, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    if (usesProductModePfDataSource_(cfg)) {
      return getProductModeActiveCountRows_(cfg, productOpts);
    }
    return getAllEffectiveDeployments(cfg, productOpts);
  }

  /**
   * Resolves a deployment id to its canonical 18-char form from SFDC rows when available.
   * @param {AppConfig} cfg
   * @param {any} deploymentId
   * @return {string}
   * @private
   */
  function _resolveCanonicalDeploymentId_(cfg, deploymentId) {
    var target = _canonicalId_(deploymentId);
    if (!target) return '';
    if (target.length >= 18) return target;
    var prefix = target.slice(0, 15);
    try {
      var rows = readSfdcDeploymentsRaw_(cfg) || [];
      for (var i = 0; i < rows.length; i++) {
        var id = _canonicalId_(rows[i].deploymentId);
        if (!id) continue;
        if (id === target || (id.length >= 15 && id.slice(0, 15) === prefix)) {
          return id;
        }
      }
    } catch (err) {
      Logger.log('CoreData._resolveCanonicalDeploymentId_: readSfdcDeploymentsRaw_ failed: ' + err);
    }
    return target;
  }

  function buildEffectiveDeploymentRow_(rawRow, overridesMap) {
    var ov = overridesMap[rawRow.deploymentId] || {};
    return Object.assign({}, rawRow, {
      accountName:       ov.overrideAccount || rawRow.accountName,
      deploymentName:    ov.overrideName || rawRow.deploymentName,
      health:            ov.overrideHealth || rawRow.health,
      mtpDate:           ov.overrideMtp ? CoreUtils.formatDateToIsoString(ov.overrideMtp) : rawRow.mtpDate,
      stage:             ov.overrideStage || rawRow.stage,
      currentUpdate:     ov.overrideCurrentUpdate || rawRow.currentUpdate,
      excludeFromReport: !!ov.exclude,
      reviewUsername:    ov.lastEditedBy || rawRow.metaUsername || '',
      reviewTimestamp:   ov.lastEditedAt || rawRow.metaTimestamp || ''
    });
  }

  /**
   * Phase 3j: SFDC-based effective deployments builder.
   * Reads SFDC_Deployments (Active only), applies meta + overrides.
   *
   * Callers should use getAllEffectiveDeployments(), the canonical entry point.
   *
   * @param {AppConfig} config
   * @return {Array<Object>}
   * @private
   */
  function buildEffectiveDeploymentsFromSfdc_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var statusValues = (cfg.salesforce && cfg.salesforce.statusValues) || {};
    var activeStatus = statusValues.active || 'Active';

    var sfdcRows = [];
    try {
      sfdcRows = readSfdcDeploymentsRaw_(cfg);
    } catch (err) {
      Logger.log('CoreData.buildEffectiveDeploymentsFromSfdc_: readSfdcDeploymentsRaw_ failed: ' + err);
      return [];
    }
    sfdcRows = sfdcRows.filter(function(r) {
      return !r.overallStatus || r.overallStatus === 'Active';
    });
    if (!sfdcRows || sfdcRows.length === 0) return [];

    var activeRaw = sfdcRows.filter(function (r) {
      return !r.status || r.status === activeStatus;
    });

    if (activeRaw.length === 0) {
      Logger.log('CoreData.buildEffectiveDeploymentsFromSfdc_: no Active rows after status filter.');
      return [];
    }

    var metaMap = getDeploymentsMetaMap_(cfg);
    var overridesMap = getDeploymentOverridesMap_(cfg);

    var effective = activeRaw.map(function (r, index) {
      var meta = metaMap[r.deploymentId] || {};
      var base = Object.assign({}, r, {
        rowIndex: index + 2,
        deliveryDirector: meta.deliveryDirector || '',
        ddNotes: meta.ddNotes || '',
        metaUsername: meta.username || '',
        metaTimestamp: meta.timestamp || ''
      });
      return buildEffectiveDeploymentRow_(base, overridesMap);
    }).filter(function (r) {
      return !!(r && r.deploymentId && (r.accountName || r.deploymentName));
    });

    Logger.log('CoreData.buildEffectiveDeploymentsFromSfdc_: ' + effective.length + ' effective rows.');
    return effective;
  }

  /**
   * Builds a stable dedupe key for a product-function row.
   * @param {Object} pf
   * @return {string}
   * @private
   */
  function _productFunctionDedupeKey_(pf) {
    if (pf.pfRowId) return 'id:' + _canonicalId_(pf.pfRowId);
    return [
      _canonicalId_(pf.parentDeploymentId || pf.deploymentFk),
      String(pf.productArea || '').trim().toLowerCase(),
      String(pf.funcArea || '').trim().toLowerCase(),
      String(pf.targetGoLive || '').trim(),
      String(pf.actualGoLive || '').trim()
    ].join('|');
  }

  /**
   * Derives a unique deploymentId for a PF-derived UI row.
   * @param {string} baseDeploymentId  Parent deployment id or PF deployment FK.
   * @param {Object} pf
   * @return {string}
   * @private
   */
  function _deriveProductFunctionDeploymentId_(baseDeploymentId, pf) {
    var parentId = _canonicalId_(baseDeploymentId);
    if (pf.pfRowId) {
      return parentId + '__pf__' + _canonicalId_(pf.pfRowId);
    }
    Logger.log('CoreData._deriveProductFunctionDeploymentId_: no stable pfRowId for parent ' +
               parentId + ' — using product/function/date fallback key.');
    var fallback = [
      String(pf.productArea || '').trim(),
      String(pf.funcArea || '').trim(),
      String(pf.targetGoLive || '').trim(),
      String(pf.actualGoLive || '').trim()
    ].join('_');
    return parentId + '__pf__' + Utilities.base64EncodeWebSafe(fallback).slice(0, 16);
  }

  /**
   * Applies PF product/function overlay and display naming to a deployment row.
   * @param {Object} derived
   * @param {Object} pf
   * @return {Object}
   * @private
   */
  function _overlayPfFieldsOnDeploymentRow_(derived, pf) {
    derived.productArea = pf.productArea || derived.productArea || '';
    derived.funcArea = pf.funcArea || derived.funcArea || '';
    derived.targetGoLive = pf.targetGoLive || derived.targetGoLive || '';
    derived.actualGoLive = pf.actualGoLive || derived.actualGoLive || '';
    if (pf.pfRowId) derived.pfRowId = pf.pfRowId;
    if (pf.overallStatus) derived.overallStatus = pf.overallStatus;

    if (derived.productArea && derived.funcArea) {
      var baseName = String(derived.deploymentName || '').trim();
      var suffix = derived.productArea + ' / ' + derived.funcArea;
      if (!baseName || baseName.indexOf(suffix) === -1) {
        derived.deploymentName = (baseName ? baseName + ' \u2014 ' : '') + suffix;
      }
    }
    return derived;
  }

  /**
   * Normalizes one PF sheet row into a deployment-shaped row by cloning an active parent.
   * @param {Object} parentRow  Effective parent deployment row.
   * @param {Object} pf         Normalized PF row from readSfdcProductFunctionsRaw_.
   * @return {Object}
   * @private
   */
  function _normalizeProductFunctionDeploymentRow_(parentRow, pf) {
    var derived = Object.assign({}, parentRow);
    var parentId = _canonicalId_(parentRow.deploymentId);
    derived.deploymentId = _deriveProductFunctionDeploymentId_(parentId, pf);
    derived.parentDeploymentId = parentId;
    derived.deploymentFk = parentId;
    derived.deploymentRowSource = 'productFunction';
    derived.parentMatchStatus = 'matchedParent';
    return _overlayPfFieldsOnDeploymentRow_(derived, pf);
  }

  /**
   * Synthesizes a deployment-shaped row from PF relationship fields when no parent match exists.
   * @param {Object} pf
   * @param {AppConfig} cfg
   * @return {Object}
   * @private
   */
  function _synthesizeProductFunctionDeploymentRow_(pf, cfg) {
    var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
    var base = {
      deploymentId: parentId,
      parentDeploymentId: parentId,
      deploymentFk: parentId,
      deploymentName: pf.deploymentName || '',
      accountId: pf.accountId || '',
      accountName: pf.accountName || '',
      industry: pf.industry || '',
      region: pf.region || '',
      subRegion: pf.subRegion || '',
      subRegionAlt: pf.subRegionAlt || '',
      deploymentStartDate: pf.deploymentStartDate || '',
      mtpDate: pf.mtpDate || '',
      firstMtpDateActual: pf.firstMtpDateActual || '',
      overallStatus: pf.overallStatus || '',
      phase: pf.phase || '',
      stage: pf.stage || '',
      health: pf.health || '',
      completionDate: pf.completionDate || '',
      wdEngManager: pf.wdEngManager || '',
      damFullName: pf.damFullName || '',
      primingPartner: pf.primingPartner || '',
      implPartner: pf.implPartner || '',
      partner: pf.partner || '',
      currentUpdate: pf.currentUpdate || '',
      isExecutiveWatch: false,
      wellnessData: null
    };

    var overridesMap = getDeploymentOverridesMap_(cfg);
    var derived = buildEffectiveDeploymentRow_(base, overridesMap);
    derived.deploymentId = _deriveProductFunctionDeploymentId_(parentId, pf);
    derived.parentDeploymentId = parentId;
    derived.deploymentFk = parentId;
    derived.deploymentRowSource = 'productFunction';
    derived.parentMatchStatus = 'synthesizedFromPfRelationship';
    return _overlayPfFieldsOnDeploymentRow_(derived, pf);
  }

  /**
   * Appends PF-derived deployment rows for ProductMode apps.
   * Includes PF rows that match an active parent, or rows synthesized from
   * Deployment__r.* relationship fields when no parent match exists.
   *
   * @param {Array<Object>} parentRows  Active parent effective rows.
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function appendProductFunctionDeploymentRows_(parentRows, cfg) {
    parentRows = parentRows || [];

    var parentById = {};
    parentRows.forEach(function (row) {
      if (!row || !row.deploymentId) return;
      var canon = _canonicalId_(row.deploymentId);
      parentById[canon] = row;
      if (canon.length >= 15) parentById[canon.slice(0, 15)] = row;
    });

    var pfRows = [];
    try {
      pfRows = readSfdcProductFunctionsRaw_(cfg) || [];
    } catch (e) {
      Logger.log('CoreData.appendProductFunctionDeploymentRows_: readSfdcProductFunctionsRaw_ failed: ' + e);
      return parentRows;
    }

    var seenPf = {};
    var pfDerived = [];
    pfRows.forEach(function (pf) {
      if (!pf || !pf.deploymentFk) return;

      var dedupeKey = _productFunctionDedupeKey_(pf);
      if (seenPf[dedupeKey]) return;

      var fk = _canonicalId_(pf.deploymentFk);
      var parent = parentById[fk] || parentById[fk.slice(0, 15)] || null;
      var statusEval = _evaluatePfRowStatus_(pf, parent, cfg);
      if (!statusEval.eligible) return;

      var derived;
      if (parent) {
        derived = _normalizeProductFunctionDeploymentRow_(parent, pf);
      } else {
        if (!_pfSynthesisMeetsMinimum_(pf, cfg)) return;
        if (_isExcludedPfPhase_(pf.phase, cfg)) return;
        if (_isExcludedCustomer360PfRow_(pf, cfg)) return;
        derived = _synthesizeProductFunctionDeploymentRow_(pf, cfg);
      }

      if (!derived || !derived.deploymentId) return;
      if (!(derived.accountName || derived.deploymentName)) return;

      seenPf[dedupeKey] = true;
      pfDerived.push(derived);
    });

    Logger.log('CoreData.appendProductFunctionDeploymentRows_: ' + parentRows.length +
               ' parent rows + ' + pfDerived.length + ' PF-derived rows.');
    return parentRows.concat(pfDerived);
  }

  /**
   * @param {Object} pf
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function _pfSynthesisMeetsMinimum_(pf, cfg) {
    return _evaluatePfOnlyRowEligibility_(pf, cfg).eligible;
  }

  /**
   * ProductMode active deployment union: parent rows plus PF-derived rows.
   * @param {AppConfig} config
   * @return {Array<Object>}
   * @private
   */
  function buildProductModeEffectiveDeployments_(config) {
    var parentRows = buildEffectiveDeploymentsFromSfdc_(config) || [];
    var markedParents = parentRows.map(function (row) {
      return Object.assign({}, row, { deploymentRowSource: 'parent' });
    });
    return appendProductFunctionDeploymentRows_(markedParents, CoreConfig.withDefaults(config));
  }

  /**
   * Phase 3j: Canonical effective deployments view.
   *
   * Reads SFDC_Deployments (with meta + overrides). Returns empty on error or
   * no Active rows — never falls back to legacy ActiveDeployments.
   *
   * @param {AppConfig} config
   * @param {Object=} productOpts  { product: string } — global product filter; 'all' or absent = no filter
   * @return {Array<Object>}
   */
  function getAllEffectiveDeployments(config, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var pa = (productOpts && productOpts.product) || 'all';
    var cacheKey = String(pa);
    if (_cache.effectiveByProduct && _cache.effectiveByProduct[cacheKey]) {
      return _cache.effectiveByProduct[cacheKey];
    }

    var effective = [];
    try {
      if (isProductModeActiveDeploymentsUnionEnabled_(cfg)) {
        var sourceMode = _getProductModeSourceMode_(cfg);
        if (sourceMode === 'pfOnly') {
          effective = buildProductModePfOnlyEffectiveDeployments_(cfg);
        } else if (sourceMode === 'parentPlusPf') {
          effective = buildProductModeEffectiveDeployments_(cfg);
        } else {
          effective = buildEffectiveDeploymentsFromSfdc_(cfg);
        }
      } else {
        effective = buildEffectiveDeploymentsFromSfdc_(cfg);
      }
    } catch (err) {
      Logger.log('CoreData.getAllEffectiveDeployments: SFDC path threw. Error: ' + err);
      effective = [];
    }

    effective = _attachDdContactsToRows_(effective, cfg);
    effective = filterDeploymentsByProduct_(effective, pa, cfg);
    if (!_cache.effectiveByProduct) _cache.effectiveByProduct = {};
    _cache.effectiveByProduct[cacheKey] = effective;
    return effective;
  }

  /**
   * S1.6 refactor: extracts the D1 ddContacts/ddFromContacts attach loop into
   * a shared helper so multiple effective-view builders can call it.
   *
   * @param {Array<Object>} rows
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function _attachDdContactsToRows_(rows, cfg) {
    var ddMap = {};
    try {
      ddMap = getDdAssignmentsFromContacts_(cfg) || {};
    } catch (e) {
      Logger.log('CoreData._attachDdContactsToRows_: getDdAssignmentsFromContacts_ failed: ' + e);
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var lookupId = row.parentDeploymentId || row.deploymentId;
      var contacts = ddMap[lookupId] || [];
      row.ddContacts = contacts;
      row.ddFromContacts = contacts.length === 0 ? null
        : contacts.length === 1 ? (contacts[0].name || contacts[0].email)
        : contacts.map(function (c) { return c.name || c.email; }).filter(Boolean).join(', ');
    }
    return rows;
  }

  /**
   * S1.6: Returns effective deployments including BOTH Active and Complete rows.
   * Applies meta + overrides + D1 ddContacts/ddFromContacts attachment, matching
   * the shape returned by getAllEffectiveDeployments() but without the Active-only
   * status filter.
   *
   * Used exclusively by buildStudentTabData_ (Student tab needs the Complete slice).
   * DO NOT use this from Deployments, Overview, Portfolio Health, Report, or any
   * other Active-portfolio surface — those must remain Active-only.
   *
   * @param {AppConfig} config
   * @return {Array<Object>}
   */
  function buildAllEffectiveDeploymentsIncludingComplete_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var sfdcRows = [];
    try {
      sfdcRows = readSfdcDeploymentsRaw_(cfg);
    } catch (err) {
      Logger.log('CoreData.buildAllEffectiveDeploymentsIncludingComplete_: SFDC read failed: ' + err);
      return [];
    }
    if (!sfdcRows.length) {
      Logger.log('CoreData.buildAllEffectiveDeploymentsIncludingComplete_: no SFDC rows.');
      return [];
    }

    // NOTE: intentionally NO status filter here. Both Active and Complete rows are kept.
    var metaMap = getDeploymentsMetaMap_(cfg);
    var overridesMap = getDeploymentOverridesMap_(cfg);

    var effective = sfdcRows.map(function (r, index) {
      var meta = metaMap[r.deploymentId] || {};
      var base = Object.assign({}, r, {
        rowIndex: index + 2,
        deliveryDirector: meta.deliveryDirector || '',
        ddNotes: meta.ddNotes || '',
        metaUsername: meta.username || '',
        metaTimestamp: meta.timestamp || ''
      });
      return buildEffectiveDeploymentRow_(base, overridesMap);
    }).filter(function (r) {
      return !!(r && r.deploymentId && (r.accountName || r.deploymentName));
    });

    Logger.log('CoreData.buildAllEffectiveDeploymentsIncludingComplete_: ' +
               effective.length + ' rows (Active + Complete).');

    return _attachDdContactsToRows_(effective, cfg);
  }

  /**
   * Phase 3j diagnostic: log SFDC-based effective view counts and health breakdown.
   *
   * @param {AppConfig} config
   * @param {number=} sampleLimit Number of rows to log (default 20).
   * @return {{ sfdcCount:number, legacyCount:number, onlyInSfdc:number, onlyInLegacy:number }}
   */
  function _validateEffectiveDeployments(config, sampleLimit) {
    var cfg = CoreConfig.withDefaults(config);
    var limit = sampleLimit || 20;

    var sfdcRows = [];
    try { sfdcRows = buildEffectiveDeploymentsFromSfdc_(cfg) || []; }
    catch (err) { Logger.log('SFDC path threw: ' + err); }

    Logger.log('=== _validateEffectiveDeployments(' + (cfg.appId || '?') + ') ===');
    Logger.log('  sfdcCount=' + sfdcRows.length);

    var healthOf = function (rows) {
      var c = { Green: 0, Yellow: 0, Red: 0, Other: 0 };
      rows.forEach(function (r) {
        var h = String(r.health || '').trim();
        if (c[h] !== undefined) c[h]++; else c.Other++;
      });
      return c;
    };
    Logger.log('  SFDC health: ' + JSON.stringify(healthOf(sfdcRows)));

    sfdcRows.slice(0, limit).forEach(function (r, i) {
      Logger.log('  sfdc[' + i + ']: ' + (r.accountName || '') +
                 ' [' + r.deploymentId + '] ' + (r.deploymentName || '') +
                 ' (' + (r.health || '') + ')');
    });

    return {
      sfdcCount: sfdcRows.length,
      legacyCount: 0,
      onlyInSfdc: 0,
      onlyInLegacy: 0
    };
  }

  /**
   * ProductMode union validation/diagnostic. Compares parent-only vs union counts.
   *
   * @param {AppConfig} config
   * @param {number=} sampleLimit
   * @return {Object}
   */
  function _validateProductModeActiveDeploymentsUnion(config, sampleLimit) {
    var cfg = CoreConfig.withDefaults(config);
    var limit = sampleLimit || 5;
    var adCfg = cfg.activeDeployments || {};
    var unionEnabled = isProductModeActiveDeploymentsUnionEnabled_(cfg);
    var sourceMode = _getProductModeSourceMode_(cfg);
    var displayGrain = _getProductModeDisplayGrain_(cfg);
    var countGrain = _getProductModeCountGrain_(cfg);
    var goLiveGrain = _getProductModeGoLiveGrain_(cfg);
    var unionStatuses = _getProductModeUnionStatuses_(cfg);
    var allowNoStatus = adCfg.allowPfRowsWithoutParentStatus === true;
    var excludePhases = adCfg.productModeExcludePhases || [];
    var excludeCustomer360 = adCfg.productModeExcludeCustomer360 === true;
    var completeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                          cfg.salesforce.statusValues.complete) || 'Complete';
    var activeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                        cfg.salesforce.statusValues.active) || 'Active';
    var parentSheet = cfg.sheets.deployments || 'SFDC_Deployments';
    var pfSheet = cfg.sheets.sfdcDeploymentProductFunctions || 'SFDC_DeploymentProductFunctions';

    var rawParents = [];
    try { rawParents = readSfdcDeploymentsRaw_(cfg) || []; } catch (e) {
      Logger.log('_validateProductModeActiveDeploymentsUnion: readSfdcDeploymentsRaw_ failed: ' + e);
    }

    var parentStatusCounts = {};
    var parentActiveIds = {};
    rawParents.forEach(function (r) {
      var st = String(r.overallStatus || r.status || '(blank)').trim();
      parentStatusCounts[st] = (parentStatusCounts[st] || 0) + 1;
      if (st === activeStatus && r.deploymentId) {
        var pid = _canonicalId_(r.deploymentId);
        parentActiveIds[pid] = true;
        if (pid.length >= 15) parentActiveIds[pid.slice(0, 15)] = true;
      }
    });

    var parentEffective = [];
    try { parentEffective = buildEffectiveDeploymentsFromSfdc_(cfg) || []; } catch (e) {
      Logger.log('_validateProductModeActiveDeploymentsUnion: buildEffectiveDeploymentsFromSfdc_ failed: ' + e);
    }

    var pfRows = [];
    try { pfRows = readSfdcProductFunctionsRaw_(cfg) || []; } catch (e) {
      Logger.log('_validateProductModeActiveDeploymentsUnion: readSfdcProductFunctionsRaw_ failed: ' + e);
    }
    var pfMeta = _cache.pfReaderMeta || {
      headers: [],
      foundColumns: {},
      missingRecommended: _PF_RECOMMENDED_HEADERS_.slice()
    };

    var pfStatusCounts = {};
    var pfPhaseCounts = {};
    var pfFuncCounts = {};
    var pfHealthCounts = {};
    var pfActiveCount = 0;
    var pfCompleteCount = 0;
    var pfWithAccountId = 0;
    var pfMissingAccountId = 0;
    var pfWithAccountName = 0;
    var pfMissingAccountName = 0;
    var stats = {
      pfRowsIncludedInActiveUi: 0,
      pfRowsSkippedBecauseStatusComplete: 0,
      pfRowsSkippedBecauseStatusMissing: 0,
      pfRowsSkippedBecauseStatusNotEligible: 0,
      pfRowsSkippedBecauseMissingMinimumFields: 0,
      pfRowsSkippedBecauseDuplicatePfRowId: 0,
      pfRowsSkippedBecauseExcludedPhase: 0,
      pfRowsSkippedBecauseCustomer360: 0
    };
    var seenPf = {};
    var pfActiveDeploymentIds = {};
    var samplePfFks = [];
    var sampleIncludedPf = [];

    pfRows.forEach(function (pf) {
      if (!pf || !pf.deploymentFk) return;
      var fk = _canonicalId_(pf.deploymentFk);
      if (samplePfFks.length < limit) samplePfFks.push(fk);

      if (String(pf.accountId || '').trim()) pfWithAccountId++;
      else pfMissingAccountId++;
      if (String(pf.accountName || '').trim()) pfWithAccountName++;
      else pfMissingAccountName++;

      var pfStatus = _getPfRowStatus_(pf, null);
      var statusKey = pfStatus || '(blank)';
      pfStatusCounts[statusKey] = (pfStatusCounts[statusKey] || 0) + 1;
      if (pfStatus === activeStatus) pfActiveCount++;
      if (pfStatus === completeStatus) pfCompleteCount++;

      var phaseKey = String(pf.phase || '(blank)').trim();
      pfPhaseCounts[phaseKey] = (pfPhaseCounts[phaseKey] || 0) + 1;
      var funcKey = String(pf.funcArea || '(blank)').trim();
      pfFuncCounts[funcKey] = (pfFuncCounts[funcKey] || 0) + 1;
      var healthKey = String(pf.health || '(blank)').trim();
      pfHealthCounts[healthKey] = (pfHealthCounts[healthKey] || 0) + 1;

      var dedupeKey = _pfOnlyDedupeKey_(pf);
      if (seenPf[dedupeKey]) {
        stats.pfRowsSkippedBecauseDuplicatePfRowId++;
        return;
      }

      var eligibility = _evaluatePfOnlyRowEligibility_(pf, cfg);
      if (!eligibility.eligible) {
        if (eligibility.reason === 'statusComplete') stats.pfRowsSkippedBecauseStatusComplete++;
        else if (eligibility.reason === 'statusMissing') stats.pfRowsSkippedBecauseStatusMissing++;
        else if (eligibility.reason === 'statusNotEligible') stats.pfRowsSkippedBecauseStatusNotEligible++;
        else if (eligibility.reason === 'excludedPhase') stats.pfRowsSkippedBecauseExcludedPhase++;
        else if (eligibility.reason === 'excludedCustomer360') stats.pfRowsSkippedBecauseCustomer360++;
        else stats.pfRowsSkippedBecauseMissingMinimumFields++;
        return;
      }

      seenPf[dedupeKey] = true;
      stats.pfRowsIncludedInActiveUi++;
      var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      pfActiveDeploymentIds[parentId] = true;
      if (parentId.length >= 15) pfActiveDeploymentIds[parentId.slice(0, 15)] = true;

      if (sampleIncludedPf.length < limit) {
        sampleIncludedPf.push({
          deploymentId: _deriveProductFunctionDeploymentId_(parentId, pf),
          pfRowId: pf.pfRowId || '',
          parentDeploymentId: parentId,
          deploymentFk: _canonicalId_(pf.deploymentFk),
          accountId: pf.accountId || '',
          deploymentName: pf.deploymentName || '',
          accountName: pf.accountName || '',
          industry: pf.industry || '',
          region: pf.region || '',
          subRegion: pf.subRegion || '',
          subRegionAlt: pf.subRegionAlt || '',
          overallStatus: pf.overallStatus || '',
          phase: pf.phase || '',
          stage: pf.stage || '',
          health: pf.health || '',
          productArea: pf.productArea || '',
          funcArea: pf.funcArea || '',
          deploymentRowSource: 'productFunction',
          parentMatchStatus: 'pfOnly'
        });
      }
    });

    var parentActiveInPf = 0;
    var parentActiveNotInPf = 0;
    var pfActiveNotInParent = 0;
    Object.keys(parentActiveIds).forEach(function (id) {
      if (id.length < 15) return;
      if (pfActiveDeploymentIds[id] || pfActiveDeploymentIds[id.slice(0, 15)]) parentActiveInPf++;
      else parentActiveNotInPf++;
    });
    Object.keys(pfActiveDeploymentIds).forEach(function (id) {
      if (id.length < 15) return;
      if (!parentActiveIds[id] && !parentActiveIds[id.slice(0, 15)]) pfActiveNotInParent++;
    });

    var unionRows = [];
    try { unionRows = getAllEffectiveDeployments(cfg) || []; } catch (e) {
      Logger.log('_validateProductModeActiveDeploymentsUnion: getAllEffectiveDeployments failed: ' + e);
    }

    var bySource = { parent: 0, productFunction: 0, productFunctionGrouped: 0, other: 0 };
    var byMatchStatus = { pfOnly: 0, pfGrouped: 0, matchedParent: 0, synthesizedFromPfRelationship: 0, other: 0 };
    unionRows.forEach(function (r) {
      var src = r.deploymentRowSource || 'other';
      if (bySource[src] !== undefined) bySource[src]++;
      else bySource.other++;
      var match = r.parentMatchStatus || 'other';
      if (byMatchStatus[match] !== undefined) byMatchStatus[match]++;
      else byMatchStatus.other++;
    });

    var grainAnalysis = _analyzePfDisplayGrain_(pfRows, cfg);
    var sampleGroupedRows = unionRows
      .filter(function (r) { return r.deploymentRowSource === 'productFunctionGrouped'; })
      .slice(0, limit)
      .map(function (r) {
        return {
          deploymentId: r.deploymentId,
          parentDeploymentId: r.parentDeploymentId,
          accountName: r.accountName,
          deploymentName: r.deploymentName,
          productArea: r.productArea,
          funcArea: r.funcArea,
          productFunctionCount: r.productFunctionCount,
          productFunctions: (r.productFunctions || []).slice(0, 3)
        };
      });

    Logger.log('=== _validateProductModeActiveDeploymentsUnion(' + (cfg.appId || '?') + ') ===');
    Logger.log('  productModeUnionEnabled=' + unionEnabled);
    Logger.log('  productModeSourceMode=' + sourceMode);
    Logger.log('  productModeDisplayGrain=' + displayGrain);
    Logger.log('  productModeCountGrain=' + countGrain);
    Logger.log('  productModeGoLiveGrain=' + goLiveGrain);
    Logger.log('  productModeUnionStatuses=' + JSON.stringify(unionStatuses));
    Logger.log('  allowPfRowsWithoutParentStatus=' + allowNoStatus);
    Logger.log('  productModeExcludePhases=' + JSON.stringify(excludePhases));
    Logger.log('  productModeExcludeCustomer360=' + excludeCustomer360);
    Logger.log('  parentSheet=' + parentSheet + ', pfSheet=' + pfSheet);
    Logger.log('  pfAvailableHeaders=' + JSON.stringify(pfMeta.headers || []));
    Logger.log('  pfMissingRecommendedHeaders=' + JSON.stringify(pfMeta.missingRecommended || []));
    Logger.log('  parentRowCount=' + rawParents.length);
    Logger.log('  parentStatusCounts=' + JSON.stringify(parentStatusCounts));
    Logger.log('  activeParentEffectiveCount=' + parentEffective.length);
    Logger.log('  pfRowCount=' + pfRows.length);
    Logger.log('  pfActiveCount=' + pfActiveCount);
    Logger.log('  pfCompleteCount=' + pfCompleteCount);
    Logger.log('  pfStatusCounts=' + JSON.stringify(pfStatusCounts));
    Logger.log('  pfPhaseCounts=' + JSON.stringify(pfPhaseCounts));
    Logger.log('  pfFuncCounts=' + JSON.stringify(pfFuncCounts));
    Logger.log('  pfHealthCounts=' + JSON.stringify(pfHealthCounts));
    Logger.log('  pfRowsWithAccountId=' + pfWithAccountId);
    Logger.log('  pfRowsMissingAccountId=' + pfMissingAccountId);
    Logger.log('  pfRowsWithAccountName=' + pfWithAccountName);
    Logger.log('  pfRowsMissingAccountName=' + pfMissingAccountName);
    Logger.log('  pfRowsIncludedInActiveUi=' + stats.pfRowsIncludedInActiveUi);
    Logger.log('  grainAnalysis=' + JSON.stringify(grainAnalysis));
    Logger.log('  effectiveDeploymentCount=' + unionRows.length);
    Logger.log('  pfRowsSkippedBecauseStatusComplete=' + stats.pfRowsSkippedBecauseStatusComplete);
    Logger.log('  pfRowsSkippedBecauseStatusMissing=' + stats.pfRowsSkippedBecauseStatusMissing);
    Logger.log('  pfRowsSkippedBecauseStatusNotEligible=' + stats.pfRowsSkippedBecauseStatusNotEligible);
    Logger.log('  pfRowsSkippedBecauseMissingMinimumFields=' + stats.pfRowsSkippedBecauseMissingMinimumFields);
    Logger.log('  pfRowsSkippedBecauseDuplicatePfRowId=' + stats.pfRowsSkippedBecauseDuplicatePfRowId);
    Logger.log('  pfRowsSkippedBecauseExcludedPhase=' + stats.pfRowsSkippedBecauseExcludedPhase);
    Logger.log('  pfRowsSkippedBecauseCustomer360=' + stats.pfRowsSkippedBecauseCustomer360);
    Logger.log('  parentActiveDeploymentIdsRepresentedInPf=' + parentActiveInPf);
    Logger.log('  parentActiveDeploymentIdsNotRepresentedInPf=' + parentActiveNotInPf);
    Logger.log('  activePfDeploymentIdsNotRepresentedInParent=' + pfActiveNotInParent);
    Logger.log('  parentPfOverlapCount=' + parentActiveInPf);
    Logger.log('  finalGetAllEffectiveDeploymentsCount=' + unionRows.length);
    Logger.log('  countByDeploymentRowSource=' + JSON.stringify(bySource));
    Logger.log('  countByParentMatchStatus=' + JSON.stringify(byMatchStatus));
    Logger.log('  samplePfDeploymentFkValues=' + JSON.stringify(samplePfFks));
    Logger.log('  sampleIncludedPfRows=' + JSON.stringify(sampleIncludedPf));

    if (sourceMode === 'pfOnly' && pfRows.length > 0 && stats.pfRowsIncludedInActiveUi === 0) {
      Logger.log('  WARNING: PF rows exist but none included in pfOnly active UI.');
      if (stats.pfRowsSkippedBecauseStatusMissing > 0) {
        Logger.log('  Likely cause: missing Deployment__r.Overall_Status__c on PF rows.');
      } else if (stats.pfRowsSkippedBecauseStatusComplete === pfRows.length) {
        Logger.log('  Likely cause: PF rows are Complete-only.');
      } else if (stats.pfRowsSkippedBecauseMissingMinimumFields > 0) {
        Logger.log('  Likely cause: missing relationship fields (account/name/product/function).');
      }
    }
    if (stats.pfRowsSkippedBecauseStatusComplete > 0) {
      Logger.log('  NOTE: Complete PF rows are intentionally skipped from active UI because ' +
                 'productModeUnionStatuses=' + JSON.stringify(unionStatuses) + '.');
    }

    Logger.log('  sampleGroupedRows=' + JSON.stringify(sampleGroupedRows));

    unionRows.slice(0, limit).forEach(function (r, i) {
      Logger.log('  union[' + i + ']: source=' + (r.deploymentRowSource || '?') +
                 ' match=' + (r.parentMatchStatus || '?') +
                 ' id=' + r.deploymentId + ' pfRowId=' + (r.pfRowId || '') +
                 ' status=' + (r.overallStatus || '') + ' phase=' + (r.phase || '') +
                 ' product=' + (r.productArea || '') + ' func=' + (r.funcArea || ''));
    });

    return {
      productModeUnionEnabled: unionEnabled,
      productModeSourceMode: sourceMode,
      productModeDisplayGrain: displayGrain,
      productModeCountGrain: countGrain,
      productModeGoLiveGrain: goLiveGrain,
      productModeUnionStatuses: unionStatuses,
      allowPfRowsWithoutParentStatus: allowNoStatus,
      productModeExcludePhases: excludePhases,
      productModeExcludeCustomer360: excludeCustomer360,
      parentSheet: parentSheet,
      pfSheet: pfSheet,
      pfAvailableHeaders: pfMeta.headers || [],
      pfMissingRecommendedHeaders: pfMeta.missingRecommended || [],
      parentRowCount: rawParents.length,
      parentStatusCounts: parentStatusCounts,
      activeParentEffectiveCount: parentEffective.length,
      pfRowCount: pfRows.length,
      pfActiveCount: pfActiveCount,
      pfCompleteCount: pfCompleteCount,
      pfStatusCounts: pfStatusCounts,
      pfPhaseCounts: pfPhaseCounts,
      pfFuncCounts: pfFuncCounts,
      pfHealthCounts: pfHealthCounts,
      pfRowsWithAccountId: pfWithAccountId,
      pfRowsMissingAccountId: pfMissingAccountId,
      pfRowsWithAccountName: pfWithAccountName,
      pfRowsMissingAccountName: pfMissingAccountName,
      pfRowsIncludedInActiveUi: stats.pfRowsIncludedInActiveUi,
      grainAnalysis: grainAnalysis,
      effectiveDeploymentCount: unionRows.length,
      sampleGroupedRows: sampleGroupedRows,
      pfRowsSkippedBecauseStatusComplete: stats.pfRowsSkippedBecauseStatusComplete,
      pfRowsSkippedBecauseStatusMissing: stats.pfRowsSkippedBecauseStatusMissing,
      pfRowsSkippedBecauseStatusNotEligible: stats.pfRowsSkippedBecauseStatusNotEligible,
      pfRowsSkippedBecauseMissingMinimumFields: stats.pfRowsSkippedBecauseMissingMinimumFields,
      pfRowsSkippedBecauseDuplicatePfRowId: stats.pfRowsSkippedBecauseDuplicatePfRowId,
      pfRowsSkippedBecauseExcludedPhase: stats.pfRowsSkippedBecauseExcludedPhase,
      pfRowsSkippedBecauseCustomer360: stats.pfRowsSkippedBecauseCustomer360,
      parentActiveDeploymentIdsRepresentedInPf: parentActiveInPf,
      parentActiveDeploymentIdsNotRepresentedInPf: parentActiveNotInPf,
      activePfDeploymentIdsNotRepresentedInParent: pfActiveNotInParent,
      parentPfOverlapCount: parentActiveInPf,
      finalCount: unionRows.length,
      countByDeploymentRowSource: bySource,
      countByParentMatchStatus: byMatchStatus,
      samplePfDeploymentFkValues: samplePfFks,
      sampleIncludedPfRows: sampleIncludedPf
    };
  }

  /**
   * ProductMode deployment display-grain diagnostic for EVI/AI validation.
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugProductModeDeploymentDisplayGrain(config) {
    var cfg = CoreConfig.withDefaults(config);
    var displayGrain = _getProductModeDisplayGrain_(cfg);
    var countGrain = _getProductModeCountGrain_(cfg);
    var goLiveGrain = _getProductModeGoLiveGrain_(cfg);

    var effective = [];
    try { effective = getAllEffectiveDeployments(cfg) || []; } catch (e) {
      Logger.log('_debugProductModeDeploymentDisplayGrain: getAllEffectiveDeployments failed: ' + e);
    }

    var deployments = [];
    try {
      deployments = getAllDeployments(cfg, { viewMode: 'all', ddDisplayName: '' }) || [];
    } catch (e) {
      Logger.log('_debugProductModeDeploymentDisplayGrain: getAllDeployments failed: ' + e);
    }

    var bySource = {};
    deployments.forEach(function (r) {
      var src = r.deploymentRowSource || 'other';
      bySource[src] = (bySource[src] || 0) + 1;
    });

    var accountCounts = {};
    deployments.forEach(function (r) {
      var key = String(r.accountName || '').trim();
      if (!key) return;
      accountCounts[key] = (accountCounts[key] || 0) + 1;
    });
    var duplicateAccountExamples = [];
    Object.keys(accountCounts).forEach(function (accountName) {
      if (accountCounts[accountName] > 1 && duplicateAccountExamples.length < 5) {
        duplicateAccountExamples.push({
          accountName: accountName,
          rowCount: accountCounts[accountName]
        });
      }
    });

    var pfRows = [];
    try { pfRows = readSfdcProductFunctionsRaw_(cfg) || []; } catch (e) {
      Logger.log('_debugProductModeDeploymentDisplayGrain: PF read failed: ' + e);
    }
    var grainAnalysis = _analyzePfDisplayGrain_(pfRows, cfg);

    var first10DeploymentRows = deployments.slice(0, 10).map(function (r) {
      return {
        accountName: r.accountName || '',
        deploymentName: r.deploymentName || '',
        deploymentId: r.deploymentId || '',
        parentDeploymentId: r.parentDeploymentId || '',
        productArea: r.productArea || '',
        funcArea: r.funcArea || '',
        productFunctionCount: r.productFunctionCount || 0,
        deploymentRowSource: r.deploymentRowSource || ''
      };
    });

    return {
      appId: cfg.appId || 'UNKNOWN',
      productModeSourceMode: _getProductModeSourceMode_(cfg),
      productModeDisplayGrain: displayGrain,
      productModeCountGrain: countGrain,
      productModeGoLiveGrain: goLiveGrain,
      getAllEffectiveDeploymentsCount: effective.length,
      getAllDeploymentsCount: deployments.length,
      countByDeploymentRowSource: bySource,
      duplicateAccountExamples: duplicateAccountExamples,
      grainAnalysis: grainAnalysis,
      first10DeploymentRows: first10DeploymentRows
    };
  }

  /**
   * ProductMode count-grain vs display-grain diagnostic.
   * Use this to validate Overview Total Active vs Deployments tab row counts.
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugProductModeCounts(config) {
    var cfg = CoreConfig.withDefaults(config);
    var sourceMode = _getProductModeSourceMode_(cfg);
    var displayGrain = _getProductModeDisplayGrain_(cfg);
    var countGrain = _getProductModeCountGrain_(cfg);
    var goLiveGrain = _getProductModeGoLiveGrain_(cfg);
    var overviewUses = (countGrain === displayGrain) ? 'displayGrain' : 'countGrain';

    var pfRows = [];
    try { pfRows = readSfdcProductFunctionsRaw_(cfg) || []; } catch (e) {
      Logger.log('_debugProductModeCounts: PF read failed: ' + e);
    }

    var unionStatuses = _getProductModeUnionStatuses_(cfg);
    var activeStatusSet = {};
    unionStatuses.forEach(function (s) { activeStatusSet[String(s || '').trim()] = true; });

    var activePfRowCount = 0;
    var uniqueActivePfIds = {};
    var uniqueActivePfIdCount = 0;
    pfRows.forEach(function (pf) {
      if (!pf) return;
      var status = String(pf.overallStatus || '').trim();
      if (!activeStatusSet[status]) return;
      activePfRowCount++;
      var pfId = pf.pfRowId ? _canonicalId_(pf.pfRowId) : '';
      if (pfId) uniqueActivePfIds[pfId] = true;
    });
    uniqueActivePfIdCount = Object.keys(uniqueActivePfIds).length;

    var grainAnalysis = _analyzePfDisplayGrain_(pfRows, cfg);
    var eligible = _collectEligiblePfOnlyRows_(pfRows, cfg);

    var countRows = [];
    try { countRows = getActiveCountDeployments(cfg, { product: 'all' }) || []; } catch (e) {
      Logger.log('_debugProductModeCounts: getActiveCountDeployments failed: ' + e);
    }
    countRows = filterDeploymentsByStudent_(countRows, 'exclude', cfg);

    var displayRows = [];
    try { displayRows = getAllEffectiveDeployments(cfg) || []; } catch (e) {
      Logger.log('_debugProductModeCounts: getAllEffectiveDeployments failed: ' + e);
    }
    displayRows = filterDeploymentsByStudent_(displayRows, 'exclude', cfg);

    var deploymentsTabRows = [];
    try {
      deploymentsTabRows = getAllDeployments(cfg, { viewMode: 'all', ddDisplayName: '' }) || [];
    } catch (e) {
      Logger.log('_debugProductModeCounts: getAllDeployments failed: ' + e);
    }

    var bySource = { parent: 0, productFunction: 0, productFunctionGrouped: 0, other: 0 };
    displayRows.forEach(function (r) {
      var src = r.deploymentRowSource || 'other';
      if (bySource[src] !== undefined) bySource[src]++;
      else bySource.other++;
    });

    var overviewTotals = { totalActive: null, red: null, yellow: null, green: null, executiveWatch: null };
    try {
      var snap = _computeOverviewSnapshot_(cfg, { viewMode: 'all' }, { product: 'all' });
      if (snap && snap.totals) overviewTotals = snap.totals;
    } catch (e) {
      Logger.log('_debugProductModeCounts: overview compute failed: ' + e);
    }

    var countHealth = { Red: 0, Yellow: 0, Green: 0, Other: 0 };
    countRows.forEach(function (r) {
      var h = String(r.health || '').trim();
      if (countHealth[h] !== undefined) countHealth[h]++;
      else countHealth.Other++;
    });

    var overviewTotal = overviewTotals.totalActive;
    var displayCount = displayRows.length;
    var deploymentsTabCount = deploymentsTabRows.length;
    var usesSeparateCountGrain = _productModeUsesSeparateCountGrain_(cfg);
    var deploymentsTabKpiUses = usesSeparateCountGrain ? 'countGrain' : 'displayGrain';

    var displayHealth = { Red: 0, Yellow: 0, Green: 0, Other: 0 };
    deploymentsTabRows.forEach(function (r) {
      var dh = String(r.health || '').trim();
      if (displayHealth[dh] !== undefined) displayHealth[dh]++;
      else displayHealth.Other++;
    });

    var defaultHealthFilter = ['Red', 'Yellow'];
    function filterRowsByHealth_(rows, healthList) {
      if (!healthList || !healthList.length) return rows;
      return rows.filter(function (r) { return healthList.indexOf(r.health) >= 0; });
    }
    var countRowsDefaultHealth = filterRowsByHealth_(countRows, defaultHealthFilter);
    var displayRowsDefaultHealth = filterRowsByHealth_(deploymentsTabRows, defaultHealthFilter);

    var countRowsForReport = countRows.filter(function (r) { return !r.excludeFromReport; });
    var reportHealthTotal = 0;
    countRowsForReport.forEach(function (r) {
      var rh = String(r.health || '').trim();
      if (rh === 'Green' || rh === 'Red' || rh === 'Yellow') reportHealthTotal++;
    });

    var portfolioHealthTotal = 0;
    countRowsForReport.forEach(function (r) {
      var ph = String(r.health || '').trim();
      if (ph === 'Green' || ph === 'Red' || ph === 'Yellow') portfolioHealthTotal++;
    });

    var sampleFunction = '';
    countRows.some(function (r) {
      var fn = String(r.funcArea || '').trim();
      if (fn) { sampleFunction = fn; return true; }
      return false;
    });
    var sampleIndustry = '';
    countRows.some(function (r) {
      var ind = String(r.industry || '').trim();
      if (ind) { sampleIndustry = ind; return true; }
      return false;
    });
    var sampleFilters = {
      noFiltersAllHealth: {
        displayRowCount: deploymentsTabCount,
        countGrainTotal: countRows.length,
        countGrainHealth: countHealth
      },
      defaultRedYellowHealth: {
        displayRowCount: displayRowsDefaultHealth.length,
        countGrainTotal: countRowsDefaultHealth.length,
        countGrainHealth: (function () {
          var h = { Red: 0, Yellow: 0, Green: 0, Other: 0 };
          countRowsDefaultHealth.forEach(function (r) {
            var key = String(r.health || '').trim();
            if (h[key] !== undefined) h[key]++;
            else h.Other++;
          });
          return h;
        })()
      }
    };
    if (sampleFunction) {
      var fnRows = countRows.filter(function (r) {
        return String(r.funcArea || '').trim() === sampleFunction;
      });
      sampleFilters.functionExample = {
        function: sampleFunction,
        displayRowCount: deploymentsTabRows.filter(function (r) {
          return String(r.funcArea || '').trim() === sampleFunction ||
            (r.productFunctions && r.productFunctions.some(function (pf) {
              return String(pf.funcArea || '').trim() === sampleFunction;
            }));
        }).length,
        countGrainTotal: fnRows.length
      };
    }
    if (sampleIndustry) {
      var indRows = countRows.filter(function (r) {
        return String(r.industry || '').trim() === sampleIndustry;
      });
      sampleFilters.industryExample = {
        industry: sampleIndustry,
        displayRowCount: deploymentsTabRows.filter(function (r) {
          return String(r.industry || '').trim() === sampleIndustry;
        }).length,
        countGrainTotal: indRows.length
      };
    }

    var mismatch = null;
    if (overviewTotal !== displayCount) {
      mismatch = 'Overview Total Active (' + overviewTotal + ') uses productModeCountGrain=' +
        countGrain + '; Deployments tab display rows (' + displayCount +
        ') use productModeDisplayGrain=' + displayGrain +
        '. Deployments tab KPI cards use count grain when grains differ.';
    }

    var report = {
      appName: cfg.appId || 'UNKNOWN',
      productModeSourceMode: sourceMode,
      productModeDisplayGrain: displayGrain,
      productModeCountGrain: countGrain,
      productModeGoLiveGrain: goLiveGrain,
      rawPfRowCount: pfRows.length,
      activePfRowCount: activePfRowCount,
      uniqueActivePfIdCount: uniqueActivePfIdCount,
      eligibleActivePfRowCount: eligible.length,
      activeDeploymentProductGroupedCount: grainAnalysis.groupedDeploymentProductCount,
      activeParentDeploymentGroupedCount: grainAnalysis.groupedParentDeploymentCount,
      overviewTotalActive: overviewTotal,
      overviewRed: overviewTotals.red,
      overviewYellow: overviewTotals.yellow,
      overviewGreen: overviewTotals.green,
      overviewExecutiveWatch: overviewTotals.executiveWatch,
      overviewRedYellowGreenSum: (overviewTotals.red || 0) + (overviewTotals.yellow || 0) +
        (overviewTotals.green || 0),
      countGrainRowCount: countRows.length,
      countGrainHealth: countHealth,
      deploymentsTabEffectiveRowCount: deploymentsTabCount,
      deploymentsTabDisplayRowCount: deploymentsTabCount,
      deploymentsTabCountGrainTotal: countRows.length,
      deploymentsTabKpiUses: deploymentsTabKpiUses,
      deploymentsTabDisplayHealth: displayHealth,
      deploymentsTabCountGrainRed: countHealth.Red,
      deploymentsTabCountGrainYellow: countHealth.Yellow,
      deploymentsTabCountGrainGreen: countHealth.Green,
      deploymentsTabCountGrainRedYellowGreenSum: countHealth.Red + countHealth.Yellow +
        countHealth.Green,
      monthlyReportHealthTotal: reportHealthTotal,
      portfolioHealthTotal: portfolioHealthTotal,
      countGrainVsDisplayGrainNote: usesSeparateCountGrain
        ? ('Metrics count at productModeCountGrain=' + countGrain +
           '; table rows use productModeDisplayGrain=' + displayGrain + '.')
        : null,
      sampleFilters: sampleFilters,
      displayGrainRowCount: displayCount,
      countByDeploymentRowSource: bySource,
      overviewCountsUse: overviewUses,
      overviewVsDisplayMismatch: mismatch,
      grainAnalysis: grainAnalysis
    };

    Logger.log('=== _debugProductModeCounts(' + (cfg.appId || '?') + ') ===');
    Logger.log('  report=' + JSON.stringify(report));
    if (mismatch) Logger.log('  NOTE: ' + mismatch);
    return report;
  }

  /**
   * Thin diagnostic wrapper for ProductMode active deployment union.
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugProductModeActiveDeploymentsUnion(config) {
    return _validateProductModeActiveDeploymentsUnion(config, 10);
  }

  /**
   * Comprehensive ProductMode source diagnostic for EVI/AI validation.
   * @param {AppConfig} config
   * @param {number=} limit
   * @return {Object}
   */
  function _debugProductModeSources(config, limit) {
    var cfg = CoreConfig.withDefaults(config);
    var lim = (typeof limit === 'number' && limit > 0) ? limit : 10;
    var unionSummary = _validateProductModeActiveDeploymentsUnion(cfg, lim);

    var pfRows = [];
    try { pfRows = readProductModePfRowsRaw_(cfg) || []; } catch (e) {
      Logger.log('_debugProductModeSources: PF read failed: ' + e);
    }
    var completeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                          cfg.salesforce.statusValues.complete) || 'Complete';
    var activeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                        cfg.salesforce.statusValues.active) || 'Active';

    var pfMissing = {
      accountId: 0, accountName: 0, deploymentName: 0, status: 0,
      targetGoLive: 0, actualGoLive: 0, duplicatePfRowId: 0
    };
    var seenPfIds = {};
    var sampleCompleteGoLives = [];
    pfRows.forEach(function (pf) {
      if (!pf) return;
      if (!String(pf.accountId || '').trim()) pfMissing.accountId++;
      if (!String(pf.accountName || '').trim()) pfMissing.accountName++;
      if (!String(pf.deploymentName || '').trim()) pfMissing.deploymentName++;
      if (!String(pf.overallStatus || '').trim()) pfMissing.status++;
      if (!String(pf.targetGoLive || '').trim()) pfMissing.targetGoLive++;
      if (!String(pf.actualGoLive || '').trim()) pfMissing.actualGoLive++;
      var pfId = String(pf.pfRowId || '').trim();
      if (pfId) {
        if (seenPfIds[pfId]) pfMissing.duplicatePfRowId++;
        seenPfIds[pfId] = true;
      }
      if (sampleCompleteGoLives.length < lim &&
          String(pf.overallStatus || '').trim() === completeStatus &&
          String(pf.actualGoLive || '').trim()) {
        sampleCompleteGoLives.push({
          pfRowId: pf.pfRowId || '',
          parentDeploymentId: _canonicalId_(pf.parentDeploymentId || pf.deploymentFk),
          accountName: pf.accountName || '',
          actualGoLive: pf.actualGoLive || '',
          productArea: pf.productArea || '',
          funcArea: pf.funcArea || ''
        });
      }
    });

    var overviewActive = null;
    try {
      var snap = _computeOverviewSnapshot_(cfg, { viewMode: 'all' }, { product: 'all' });
      overviewActive = snap && snap.totals ? snap.totals.totalActive : null;
    } catch (e) {
      Logger.log('_debugProductModeSources: overview compute failed: ' + e);
    }

    var recentPf = [];
    var upcomingPf = [];
    var goLiveEventAnalysis = null;
    try { recentPf = getRecentGoLives(cfg, { viewMode: 'all' }, undefined, { product: 'all' }) || []; }
    catch (e) { Logger.log('_debugProductModeSources: recent go-lives failed: ' + e); }
    try { upcomingPf = getUpcomingGoLives(cfg, { viewMode: 'all' }, { product: 'all' }) || []; }
    catch (e) { Logger.log('_debugProductModeSources: upcoming go-lives failed: ' + e); }
    if (usesProductModePfGoLiveSource_(cfg)) {
      try { goLiveEventAnalysis = _analyzeProductModeGoLiveEvents_(cfg, { product: 'all' }); }
      catch (e) { Logger.log('_debugProductModeSources: go-live event analysis failed: ' + e); }
    }

    var parentRows = [];
    try { parentRows = readSfdcDeploymentsRaw_(cfg) || []; } catch (e) {}
    var parentActive = parentRows.filter(function (r) {
      return String(r.overallStatus || r.status || '').trim() === activeStatus;
    }).length;

    var remainingParentDeps = [
      { feature: 'Trends tab', runtime: false, reason: 'disabled for EVI/AI; uses parent when enabled' },
      { feature: 'CoreHistory.getCurrentMTPDate', runtime: false, reason: 'utility; low exposure' },
      { feature: '_resolveCanonicalDeploymentId_', runtime: false, reason: 'ID normalization fallback' },
      { feature: 'Diagnostics comparison', runtime: false, reason: 'parent counts for audit only' },
      { feature: 'SFDC_Deployments connector refresh', runtime: true,
        reason: 'optional until all surfaces migrated; not required for active UI after this pass' }
    ];

    var report = {
      config: {
        productModeUnionEnabled: !!(cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled),
        productModeSourceMode: _getProductModeSourceMode_(cfg),
        productModeDataSource: (cfg.activeDeployments && cfg.activeDeployments.productModeDataSource) || 'parent',
        productModeHistoricalSource: (cfg.activeDeployments && cfg.activeDeployments.productModeHistoricalSource) || 'parent',
        productModeGoLiveSource: (cfg.activeDeployments && cfg.activeDeployments.productModeGoLiveSource) || 'parent',
        productModeUnionStatuses: _getProductModeUnionStatuses_(cfg),
        productModeExcludePhases: (cfg.activeDeployments && cfg.activeDeployments.productModeExcludePhases) || [],
        productModeExcludeCustomer360: !!(cfg.activeDeployments &&
                                          cfg.activeDeployments.productModeExcludeCustomer360),
        productModeDisplayGrain: _getProductModeDisplayGrain_(cfg),
        productModeCountGrain: _getProductModeCountGrain_(cfg),
        productModeGoLiveGrain: _getProductModeGoLiveGrain_(cfg),
        freshnessWatchSheet: (cfg.freshness && cfg.freshness.watchSheet) || 'SFDC_Deployments',
        trendsEnabled: !!(cfg.ui && cfg.ui.trendsTab && cfg.ui.trendsTab.enabled)
      },
      pfRowCount: pfRows.length,
      parentRowCount: parentRows.length,
      parentActiveCount: parentActive,
      overviewActiveTotal: overviewActive,
      pfActiveEffectiveCount: unionSummary.pfRowsIncludedInActiveUi,
      effectiveDeploymentCount: unionSummary.effectiveDeploymentCount,
      grainAnalysis: unionSummary.grainAnalysis,
      recentGoLiveCountPf: recentPf.length,
      upcomingGoLiveCountPf: upcomingPf.length,
      goLiveEventAnalysis: goLiveEventAnalysis,
      pfDataQuality: pfMissing,
      remainingParentDependencies: remainingParentDeps,
      unionSummary: unionSummary,
      sampleCompleteGoLiveRows: sampleCompleteGoLives,
      sampleRecentGoLives: recentPf.slice(0, lim),
      sampleUpcomingGoLives: upcomingPf.slice(0, lim)
    };

    Logger.log('=== _debugProductModeSources(' + (cfg.appId || '?') + ') ===');
    Logger.log('  config=' + JSON.stringify(report.config));
    Logger.log('  pfRowCount=' + report.pfRowCount);
    Logger.log('  parentRowCount=' + report.parentRowCount + ' parentActiveCount=' + parentActive);
    Logger.log('  overviewActiveTotal=' + overviewActive +
               ' pfActiveEffectiveCount=' + unionSummary.pfRowsIncludedInActiveUi +
               ' effectiveDeploymentCount=' + unionSummary.effectiveDeploymentCount);
    Logger.log('  grainAnalysis=' + JSON.stringify(unionSummary.grainAnalysis));
    Logger.log('  recentGoLiveCountPf=' + recentPf.length +
               ' upcomingGoLiveCountPf=' + upcomingPf.length);
    if (goLiveEventAnalysis) {
      Logger.log('  goLiveEventAnalysis=' + JSON.stringify(goLiveEventAnalysis));
    }
    Logger.log('  pfDataQuality=' + JSON.stringify(pfMissing));
    return report;
  }

  // ===========================================================================
  // WELLNESS MAP
  // ===========================================================================

  /**
   * Parses a collapsed Salesforce relationship/object cell value for a Name field.
   * @param {any} raw
   * @return {string}
   * @private
   */
  function _parseRelationshipNameField_(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (s.indexOf('Name=') < 0 && s.indexOf('name=') < 0) return s;
    var match = s.match(/(?:^|[,{]\s*)Name=([^,}]+)/);
    if (match && match[1]) return String(match[1]).trim();
    return s;
  }

  /**
   * Parses a collapsed Salesforce relationship/object cell value for an Id field.
   * @param {any} raw
   * @return {string}
   * @private
   */
  function _parseRelationshipIdField_(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (/^[a-zA-Z0-9]{15,18}$/.test(s)) return s;
    var match = s.match(/(?:^|[,{]\s*)Id=([a-zA-Z0-9]{15,18})/);
    if (match && match[1]) return match[1];
    return s;
  }

  /**
   * Parses CX_Leader_Assignment__r from plain text or connector object strings.
   * @param {any} raw
   * @return {string}
   * @private
   */
  function _parseCxLeaderFromRelationship_(raw) {
    return _parseRelationshipNameField_(raw);
  }

  /**
   * Normalizes High_Risk_Flag__c to boolean.
   * @param {any} raw
   * @return {boolean}
   * @private
   */
  function _normalizeWellnessHighRiskFlag_(raw) {
    if (raw === true) return true;
    if (raw === false) return false;
    var s = String(raw || '').trim().toLowerCase();
    if (!s) return false;
    if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
    return false;
  }

  /**
   * Splits Issue_Category__c into normalized categories.
   * @param {string} raw
   * @param {string=} delimiter
   * @return {Array<string>}
   * @private
   */
  function _splitWellnessIssueCategories_(raw, delimiter) {
    var delim = delimiter || ';';
    return String(raw || '').split(delim).map(function(part) {
      return String(part || '').trim();
    }).filter(function(part) {
      return !!part;
    });
  }

  /**
   * Derives primary issue category label from split categories.
   * @param {Array<string>} categories
   * @return {string}
   * @private
   */
  function _normalizeWellnessIssueCategoryLabel_(categories) {
    categories = categories || [];
    if (!categories.length) return '';
    if (categories.length === 1) return categories[0];
    return 'Multiple';
  }

  /**
   * Parses a wellness date for comparison.
   * @param {any} raw
   * @return {Date|null}
   * @private
   */
  function _parseWellnessDate_(raw) {
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Formats a wellness date for display/storage.
   * @param {any} raw
   * @return {string}
   * @private
   */
  function _formatWellnessDate_(raw) {
    var d = _parseWellnessDate_(raw);
    if (!d) return String(raw || '').trim();
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  /**
   * Reads raw Wellness rows from SFDC_Wellness.
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function readWellnessPlansRaw_(cfg) {
    if (_cache.wellnessRows !== null) return _cache.wellnessRows;

    var sheetName = (cfg && cfg.sheets && cfg.sheets.wellness) || 'SFDC_Wellness';
    var rows = [];

    try {
      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() === 0) {
        _cache.wellnessRows = [];
        return _cache.wellnessRows;
      }

      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var headers = allValues[0].map(function(h) { return String(h || '').trim(); });
      var lowerH = headers.map(function(h) { return h.toLowerCase(); });

      function findExact_(headerName) {
        var target = String(headerName || '').trim().toLowerCase();
        for (var i = 0; i < lowerH.length; i++) {
          if (lowerH[i] === target) return i;
        }
        return -1;
      }

      function detect_(keywords) {
        for (var ki = 0; ki < keywords.length; ki++) {
          var kw = keywords[ki].toLowerCase();
          for (var hi = 0; hi < lowerH.length; hi++) {
            if (lowerH[hi].indexOf(kw) !== -1) return hi;
          }
        }
        return -1;
      }

      function cellStr_(row, col) {
        return col >= 0 ? String(row[col] || '').trim() : '';
      }

      var colId = findExact_('Id');
      var colOverallHealth = findExact_('Overall_Health_Status__c');
      if (colOverallHealth < 0) colOverallHealth = detect_(['overall_health_status', 'overall_health']);
      var colAccount = findExact_('Account__c');
      var colAccountRelId = findExact_('Account__r.Id');
      var colAccountRel = findExact_('Account__r');
      if (colAccount < 0) colAccount = detect_(['account__c']);
      var colHighRisk = findExact_('High_Risk_Flag__c');
      if (colHighRisk < 0) colHighRisk = detect_(['high_risk_flag', 'high_risk']);
      var colWellnessUpdate = findExact_('Wellness_Update__c');
      if (colWellnessUpdate < 0) colWellnessUpdate = detect_(['wellness_update']);
      var colCxLeaderName = findExact_('CX_Leader_Assignment__r.Name');
      var colCxLeaderRel = findExact_('CX_Leader_Assignment__r');
      if (colCxLeaderRel < 0) colCxLeaderRel = detect_(['cx_leader_assignment__r']);
      var colExecSummary = findExact_('Executive_Summary__c');
      if (colExecSummary < 0) colExecSummary = detect_(['executive_summary']);
      var colSummaryIssues = findExact_('Summary_of_Issues__c');
      if (colSummaryIssues < 0) colSummaryIssues = detect_(['summary_of_issues']);
      var colIssueCategory = findExact_('Issue_Category__c');
      if (colIssueCategory < 0) colIssueCategory = detect_(['issue_category']);
      var colLastModified = findExact_('LastModifiedDate');
      if (colLastModified < 0) colLastModified = detect_(['lastmodifieddate', 'last_modified']);

      for (var r = 1; r < allValues.length; r++) {
        var row = allValues[r];
        var accountId = cellStr_(row, colAccount);
        if (!accountId) accountId = cellStr_(row, colAccountRelId);
        if (!accountId && colAccountRel >= 0) {
          accountId = _parseRelationshipIdField_(row[colAccountRel]);
        }
        if (!accountId && colAccount < 0 && colAccountRelId < 0 && colAccountRel < 0) {
          accountId = String(row[1] || '').trim();
        }
        accountId = accountId ? accountId.slice(0, 15) : '';

        var cxLeader = '';
        if (colCxLeaderName >= 0) cxLeader = cellStr_(row, colCxLeaderName);
        if (!cxLeader && colCxLeaderRel >= 0) {
          cxLeader = _parseCxLeaderFromRelationship_(row[colCxLeaderRel]);
        }

        var issueCategoryRaw = cellStr_(row, colIssueCategory);
        var issueCategories = _splitWellnessIssueCategories_(issueCategoryRaw, ';');
        var lastModifiedRaw = colLastModified >= 0 ? row[colLastModified] : '';

        rows.push({
          wellnessPlanId: cellStr_(row, colId),
          accountId: accountId,
          overallHealthStatus: cellStr_(row, colOverallHealth),
          highRiskFlag: _normalizeWellnessHighRiskFlag_(colHighRisk >= 0 ? row[colHighRisk] : ''),
          wellnessUpdate: cellStr_(row, colWellnessUpdate),
          cxLeader: cxLeader,
          executiveSummary: cellStr_(row, colExecSummary),
          summaryOfIssues: cellStr_(row, colSummaryIssues),
          issueCategoryRaw: issueCategoryRaw,
          issueCategories: issueCategories,
          issueCategory: _normalizeWellnessIssueCategoryLabel_(issueCategories),
          lastModifiedDate: _formatWellnessDate_(lastModifiedRaw),
          lastModifiedSort: _parseWellnessDate_(lastModifiedRaw)
        });
      }
    } catch (e) {
      Logger.log('CoreData.readWellnessPlansRaw_: ' + e);
      rows = [];
    }

    _cache.wellnessRows = rows;
    return _cache.wellnessRows;
  }

  /**
   * Picks the latest nonblank field value by LastModifiedDate.
   * @param {Array<Object>} plans
   * @param {string} fieldName
   * @return {string}
   * @private
   */
  function _pickLatestWellnessField_(plans, fieldName) {
    var latest = '';
    var latestDate = null;
    (plans || []).forEach(function(plan) {
      var val = String(plan[fieldName] || '').trim();
      if (!val) return;
      var d = plan.lastModifiedSort;
      if (d && (!latestDate || d.getTime() > latestDate.getTime())) {
        latestDate = d;
        latest = val;
      }
    });
    if (latest) return latest;
    for (var i = 0; i < (plans || []).length; i++) {
      var fallback = String(plans[i][fieldName] || '').trim();
      if (fallback) return fallback;
    }
    return '';
  }

  /**
   * Aggregates normalized wellness rows for one account.
   * @param {Array<Object>} plans
   * @return {Object|null}
   * @private
   */
  function _aggregateWellnessPlansForAccount_(plans) {
    plans = plans || [];
    if (!plans.length) return null;

    var wellnessPlanIds = [];
    var issueCategoryRawValues = [];
    var issueCategories = [];
    var highRiskFlag = false;

    plans.forEach(function(plan) {
      if (plan.wellnessPlanId) wellnessPlanIds.push(plan.wellnessPlanId);
      if (plan.highRiskFlag === true) highRiskFlag = true;
      if (plan.issueCategoryRaw && issueCategoryRawValues.indexOf(plan.issueCategoryRaw) < 0) {
        issueCategoryRawValues.push(plan.issueCategoryRaw);
      }
      (plan.issueCategories || []).forEach(function(cat) {
        if (cat && issueCategories.indexOf(cat) < 0) issueCategories.push(cat);
      });
    });

    var cxLeader = _pickLatestWellnessField_(plans, 'cxLeader');
    var wellnessUpdate = _pickLatestWellnessField_(plans, 'wellnessUpdate');
    var executiveSummary = _pickLatestWellnessField_(plans, 'executiveSummary');
    var summaryOfIssues = _pickLatestWellnessField_(plans, 'summaryOfIssues');
    var overallHealthStatus = _pickLatestWellnessField_(plans, 'overallHealthStatus');
    var lastModifiedDate = '';
    var latestModified = null;
    plans.forEach(function(plan) {
      if (!plan.lastModifiedSort) return;
      if (!latestModified || plan.lastModifiedSort.getTime() > latestModified.getTime()) {
        latestModified = plan.lastModifiedSort;
        lastModifiedDate = plan.lastModifiedDate || '';
      }
    });
    if (!lastModifiedDate) {
      lastModifiedDate = _pickLatestWellnessField_(plans, 'lastModifiedDate');
    }

    var agg = {
      hasCustomerWellness: true,
      wellnessPlanCount: plans.length,
      wellnessPlanIds: wellnessPlanIds,
      accountId: plans[0].accountId,
      highRiskFlag: highRiskFlag,
      overallHealthStatus: overallHealthStatus,
      issueCategory: _normalizeWellnessIssueCategoryLabel_(issueCategories),
      issueCategories: issueCategories,
      issueCategoryRawValues: issueCategoryRawValues,
      cxLeader: cxLeader,
      cxLeaderName: cxLeader,
      wellnessUpdate: wellnessUpdate,
      executiveSummary: executiveSummary,
      summaryOfIssues: summaryOfIssues,
      lastModifiedDate: lastModifiedDate,
      overallHealth: overallHealthStatus,
      highRisk: highRiskFlag,
      issueCategoryRaw: issueCategoryRawValues.length ? issueCategoryRawValues[0] : '',
      plans: plans.map(function(plan) {
        return {
          wellnessPlanId: plan.wellnessPlanId,
          accountId: plan.accountId,
          overallHealthStatus: plan.overallHealthStatus,
          highRiskFlag: plan.highRiskFlag,
          wellnessUpdate: plan.wellnessUpdate,
          cxLeader: plan.cxLeader,
          executiveSummary: plan.executiveSummary,
          summaryOfIssues: plan.summaryOfIssues,
          issueCategoryRaw: plan.issueCategoryRaw,
          issueCategories: (plan.issueCategories || []).slice(),
          issueCategory: plan.issueCategory,
          lastModifiedDate: plan.lastModifiedDate
        };
      })
    };
    return agg;
  }

  /**
   * Attaches normalized wellness fields to a deployment row.
   * @param {Object} row
   * @param {Object|null} wellness
   * @return {Object}
   * @private
   */
  function _attachWellnessFieldsToRow_(row, wellness) {
    if (!row) return row;
    if (!wellness) {
      row.isExecutiveWatch = false;
      row.wellnessData = null;
      row.customerWellness = null;
      return row;
    }
    row.isExecutiveWatch = true;
    row.wellnessData = wellness;
    row.customerWellness = wellness;
    row.overallHealthStatus = wellness.overallHealthStatus || wellness.overallHealth || '';
    row.highRiskFlag = wellness.highRiskFlag === true;
    row.cxLeader = wellness.cxLeader || wellness.cxLeaderName || '';
    row.wellnessUpdate = wellness.wellnessUpdate || '';
    row.executiveSummary = wellness.executiveSummary || '';
    row.summaryOfIssues = wellness.summaryOfIssues || '';
    row.issueCategories = (wellness.issueCategories || []).slice();
    row.lastModifiedDate = wellness.lastModifiedDate || '';
    return row;
  }

  /**
   * Builds a map of accountId (15-char) → aggregated wellness object
   * from the SFDC_Wellness sheet. Returns {} if the sheet is absent or empty.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Object}
   * @private
   */
  function buildWellnessMap_(cfg) {
    if (_cache.wellnessMap !== null) return _cache.wellnessMap;

    var rawRows = [];
    try {
      rawRows = readWellnessPlansRaw_(cfg) || [];
    } catch (e) {
      Logger.log('CoreData.buildWellnessMap_: readWellnessPlansRaw_ failed: ' + e);
      _cache.wellnessMap = {};
      return _cache.wellnessMap;
    }

    var byAccount = {};
    rawRows.forEach(function(plan) {
      if (!plan || !plan.accountId) return;
      if (!byAccount[plan.accountId]) byAccount[plan.accountId] = [];
      byAccount[plan.accountId].push(plan);
    });

    var map = {};
    Object.keys(byAccount).forEach(function(accountId) {
      var agg = _aggregateWellnessPlansForAccount_(byAccount[accountId]);
      if (!agg) return;
      map[accountId] = agg;
      if (accountId.length >= 15) map[accountId.slice(0, 15)] = agg;
    });

    _cache.wellnessMap = map;
    return _cache.wellnessMap;
  }

  /**
   * Diagnostic for SFDC_Wellness ingestion and deployment enrichment.
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugWellnessData(config) {
    var cfg = CoreConfig.withDefaults(config);
    var sheetName = (cfg.sheets && cfg.sheets.wellness) || 'SFDC_Wellness';
    var sheetExists = false;
    try {
      sheetExists = !!getSpreadsheet_().getSheetByName(sheetName);
    } catch (e) { /* no-op */ }

    _cache.wellnessRows = null;
    _cache.wellnessMap = null;
    var rawRows = readWellnessPlansRaw_(cfg) || [];
    var map = buildWellnessMap_(cfg) || {};

    var withAccountId = 0;
    var missingAccountId = 0;
    var highRiskTrueCount = 0;
    var overallHealthCounts = {};
    var issueCategoryCounts = {};
    var withCxLeader = 0;
    var withWellnessUpdate = 0;
    var withExecutiveSummary = 0;
    var withSummaryOfIssues = 0;
    var withLastModified = 0;
    var perAccountCounts = {};

    rawRows.forEach(function(row) {
      if (row.accountId) {
        withAccountId++;
        perAccountCounts[row.accountId] = (perAccountCounts[row.accountId] || 0) + 1;
      } else {
        missingAccountId++;
      }
      if (row.highRiskFlag === true) highRiskTrueCount++;
      var oh = row.overallHealthStatus || '(blank)';
      overallHealthCounts[oh] = (overallHealthCounts[oh] || 0) + 1;
      (row.issueCategories || []).forEach(function(cat) {
        issueCategoryCounts[cat] = (issueCategoryCounts[cat] || 0) + 1;
      });
      if (row.cxLeader) withCxLeader++;
      if (row.wellnessUpdate) withWellnessUpdate++;
      if (row.executiveSummary) withExecutiveSummary++;
      if (row.summaryOfIssues) withSummaryOfIssues++;
      if (row.lastModifiedDate) withLastModified++;
    });

    var multiplePerAccount = 0;
    Object.keys(perAccountCounts).forEach(function(accountId) {
      if (perAccountCounts[accountId] > 1) multiplePerAccount++;
    });

    var deploymentRows = [];
    try {
      deploymentRows = getAllDeployments(cfg, null, { product: 'all' }) || [];
    } catch (e) {
      Logger.log('CoreData._debugWellnessData: getAllDeployments failed: ' + e);
    }

    var enrichedCount = 0;
    var sampleEnriched = [];
    deploymentRows.forEach(function(row) {
      if (!row.isExecutiveWatch) return;
      enrichedCount++;
      if (sampleEnriched.length < 5) {
        sampleEnriched.push({
          accountName: row.accountName || '',
          accountId: row.accountId || '',
          isExecutiveWatch: true,
          cxLeader: row.cxLeader || (row.wellnessData && row.wellnessData.cxLeader) || '',
          overallHealthStatus: row.overallHealthStatus ||
            (row.wellnessData && row.wellnessData.overallHealthStatus) || '',
          issueCategories: row.issueCategories ||
            (row.wellnessData && row.wellnessData.issueCategories) || []
        });
      }
    });

    var result = {
      appName: cfg.appId || '',
      sheetName: sheetName,
      sheetExists: sheetExists,
      wellnessRowCount: rawRows.length,
      rowsWithAccountId: withAccountId,
      rowsMissingAccountId: missingAccountId,
      highRiskTrueCount: highRiskTrueCount,
      overallHealthStatusCounts: overallHealthCounts,
      issueCategoryCounts: issueCategoryCounts,
      rowsWithCxLeader: withCxLeader,
      rowsWithWellnessUpdate: withWellnessUpdate,
      rowsWithExecutiveSummary: withExecutiveSummary,
      rowsWithSummaryOfIssues: withSummaryOfIssues,
      rowsWithLastModifiedDate: withLastModified,
      accountsWithMultipleWellnessRows: multiplePerAccount,
      distinctAccountsInMap: Object.keys(map).length,
      sampleNormalizedRows: rawRows.slice(0, 5).map(function(r) {
        return {
          wellnessPlanId: r.wellnessPlanId,
          accountId: r.accountId,
          overallHealthStatus: r.overallHealthStatus,
          highRiskFlag: r.highRiskFlag,
          cxLeader: r.cxLeader,
          issueCategories: r.issueCategories || [],
          lastModifiedDate: r.lastModifiedDate
        };
      }),
      deploymentRowsChecked: deploymentRows.length,
      deploymentRowsWithExecutiveWatch: enrichedCount,
      sampleEnrichedRows: sampleEnriched
    };

    Logger.log('=== _debugWellnessData(' + (cfg.appId || '?') + ') ===');
    Logger.log(JSON.stringify(result, null, 2));
    Logger.log('=== end _debugWellnessData ===');
    return result;
  }

  // ===========================================================================
  // DEPLOYMENT HEALTH PLAN (DHP)
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function _isDeploymentHealthPlanEnabled_(cfg) {
    return !!(cfg && cfg.deploymentHealthPlan && cfg.deploymentHealthPlan.enabled === true);
  }

  /**
   * True when a deployment row id is a synthetic ProductMode display/group id.
   * @param {any} id
   * @return {boolean}
   * @private
   */
  function _isSyntheticDeploymentDisplayId_(id) {
    var s = String(id || '');
    return s.indexOf('__pf__') >= 0 || s.indexOf('__product__') >= 0;
  }

  /**
   * Parses a DHP date field to a Date for comparison.
   * @param {any} raw
   * @return {Date|null}
   * @private
   */
  function _parseDhpDate_(raw) {
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Formats a DHP date value for display/storage.
   * @param {any} raw
   * @return {string}
   * @private
   */
  function _formatDhpDate_(raw) {
    var d = _parseDhpDate_(raw);
    if (!d) return String(raw || '').trim();
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  /**
   * Splits and normalizes Issue_Category__c values.
   * @param {string} raw
   * @param {string} delimiter
   * @return {Array<string>}
   * @private
   */
  function _splitDhpIssueCategories_(raw, delimiter) {
    var delim = delimiter || ';';
    return String(raw || '').split(delim).map(function (part) {
      return String(part || '').trim();
    }).filter(function (part) {
      return !!part;
    });
  }

  /**
   * Reads raw Deployment Health Plan rows from SFDC_DHP.
   * Returns [] when disabled, sheet missing, or empty. Avoids noisy logs when absent.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Array<Object>}
   * @private
   */
  function readDeploymentHealthPlansRaw_(cfg) {
    if (!_isDeploymentHealthPlanEnabled_(cfg)) return [];
    if (_cache.dhpRows !== null) return _cache.dhpRows;

    var dhpCfg = cfg.deploymentHealthPlan || {};
    var sheetName = dhpCfg.sheetName || 'SFDC_DHP';
    var delimiter = dhpCfg.issueCategoryDelimiter || ';';
    var rows = [];

    try {
      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() === 0) {
        _cache.dhpRows = [];
        return _cache.dhpRows;
      }

      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var headers = allValues[0].map(function (h) { return String(h || '').trim(); });
      var lowerH = headers.map(function (h) { return h.toLowerCase(); });

      function findExact_(headerName) {
        var target = String(headerName || '').trim().toLowerCase();
        for (var i = 0; i < lowerH.length; i++) {
          if (lowerH[i] === target) return i;
        }
        return -1;
      }

      function detect_(keywords, fallback) {
        for (var ki = 0; ki < keywords.length; ki++) {
          var kw = keywords[ki].toLowerCase();
          for (var hi = 0; hi < lowerH.length; hi++) {
            if (lowerH[hi].indexOf(kw) !== -1) return hi;
          }
        }
        if (fallback >= 0 && fallback < headers.length) return fallback;
        return -1;
      }

      var colId = findExact_('Id');
      if (colId < 0) colId = detect_(['id'], 0);
      var colDeploymentId = findExact_('Deployment__r.Id');
      if (colDeploymentId < 0) colDeploymentId = detect_(['deployment__r.id'], 1);
      var colPlanOwner = findExact_('Plan_Owner__r.Name');
      if (colPlanOwner < 0) colPlanOwner = detect_(['plan_owner__r.name', 'plan_owner'], 2);
      var colLastUpdated = findExact_('DHP_Last_Updated__c');
      if (colLastUpdated < 0) colLastUpdated = detect_(['dhp_last_updated'], 3);
      var colPlanUpdate = findExact_('Deployment_Health_Plan_Update__c');
      if (colPlanUpdate < 0) colPlanUpdate = detect_(['deployment_health_plan_update'], 4);
      var colActionPlan = findExact_('Deployment_Health_Action_Plan__c');
      if (colActionPlan < 0) colActionPlan = detect_(['deployment_health_action_plan'], 5);
      var colIssueCategory = findExact_('Issue_Category__c');
      if (colIssueCategory < 0) colIssueCategory = detect_(['issue_category'], 6);

      for (var r = 1; r < allValues.length; r++) {
        var row = allValues[r];
        function cellStr_(col) { return col >= 0 ? String(row[col] || '').trim() : ''; }

        var issueCategoryRaw = cellStr_(colIssueCategory);
        rows.push({
          dhpId: cellStr_(colId),
          deploymentId: _canonicalId_(cellStr_(colDeploymentId)),
          planOwner: cellStr_(colPlanOwner),
          dhpLastUpdated: _formatDhpDate_(colLastUpdated >= 0 ? row[colLastUpdated] : ''),
          healthPlanUpdate: cellStr_(colPlanUpdate),
          healthPlanActionPlan: cellStr_(colActionPlan),
          issueCategoryRaw: issueCategoryRaw,
          issueCategories: _splitDhpIssueCategories_(issueCategoryRaw, delimiter)
        });
      }
    } catch (e) {
      Logger.log('CoreData.readDeploymentHealthPlansRaw_: ' + e);
      rows = [];
    }

    _cache.dhpRows = rows;
    return _cache.dhpRows;
  }

  /**
   * Aggregates normalized DHP rows for one deployment.
   * @param {Array<Object>} plans
   * @return {Object}
   * @private
   */
  function _aggregateDeploymentHealthPlansForDeployment_(plans) {
    plans = plans || [];
    if (!plans.length) {
      return { hasHealthPlan: false };
    }

    var latest = null;
    var latestDate = null;
    var fallback = null;
    var planOwners = [];
    var issueCategoryRawValues = [];
    var issueCategories = [];
    var dhpIds = [];

    plans.forEach(function (plan) {
      if (plan.dhpId) dhpIds.push(plan.dhpId);
      if (plan.planOwner && planOwners.indexOf(plan.planOwner) < 0) {
        planOwners.push(plan.planOwner);
      }
      if (plan.issueCategoryRaw && issueCategoryRawValues.indexOf(plan.issueCategoryRaw) < 0) {
        issueCategoryRawValues.push(plan.issueCategoryRaw);
      }
      (plan.issueCategories || []).forEach(function (cat) {
        if (cat && issueCategories.indexOf(cat) < 0) issueCategories.push(cat);
      });

      if (!fallback && (plan.dhpLastUpdated || plan.healthPlanUpdate || plan.healthPlanActionPlan)) {
        fallback = plan;
      }

      var parsed = _parseDhpDate_(plan.dhpLastUpdated);
      if (parsed && (!latestDate || parsed.getTime() > latestDate.getTime())) {
        latestDate = parsed;
        latest = plan;
      }
    });

    if (!latest) latest = fallback || plans[0];

    var primaryIssueCategory = '';
    if (issueCategories.length === 1) primaryIssueCategory = issueCategories[0];
    else if (issueCategories.length > 1) primaryIssueCategory = 'Multiple';

    return {
      hasHealthPlan: true,
      deploymentId: plans[0].deploymentId,
      dhpCount: plans.length,
      dhpIds: dhpIds,
      planOwners: planOwners,
      latestPlanOwner: latest ? (latest.planOwner || '') : '',
      latestUpdated: latest ? (latest.dhpLastUpdated || '') : '',
      latestHealthPlanUpdate: latest ? (latest.healthPlanUpdate || '') : '',
      latestHealthPlanActionPlan: latest ? (latest.healthPlanActionPlan || '') : '',
      issueCategoryRawValues: issueCategoryRawValues,
      issueCategories: issueCategories,
      primaryIssueCategory: primaryIssueCategory,
      plans: plans.map(function (p) {
        return {
          dhpId: p.dhpId,
          deploymentId: p.deploymentId,
          planOwner: p.planOwner,
          dhpLastUpdated: p.dhpLastUpdated,
          healthPlanUpdate: p.healthPlanUpdate,
          healthPlanActionPlan: p.healthPlanActionPlan,
          issueCategoryRaw: p.issueCategoryRaw,
          issueCategories: (p.issueCategories || []).slice()
        };
      })
    };
  }

  /**
   * Builds a deployment-id-keyed map of aggregated DHP data.
   * Keys include both 18-char and 15-char canonical ids when available.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Object}
   * @private
   */
  function buildDeploymentHealthPlanMap_(cfg) {
    if (!_isDeploymentHealthPlanEnabled_(cfg)) return {};
    if (_cache.dhpMap !== null) return _cache.dhpMap;

    var rawRows = readDeploymentHealthPlansRaw_(cfg) || [];
    var byDeployment = {};
    rawRows.forEach(function (plan) {
      var depId = _canonicalId_(plan.deploymentId);
      if (!depId) return;
      if (!byDeployment[depId]) byDeployment[depId] = [];
      byDeployment[depId].push(plan);
    });

    var map = {};
    Object.keys(byDeployment).forEach(function (depId) {
      var agg = _aggregateDeploymentHealthPlansForDeployment_(byDeployment[depId]);
      map[depId] = agg;
      if (depId.length >= 15) map[depId.slice(0, 15)] = agg;
    });

    _cache.dhpMap = map;
    return _cache.dhpMap;
  }

  /**
   * Resolves the deployment id used to join DHP rows onto a deployment row.
   * @param {Object} row
   * @return {string}
   * @private
   */
  function _resolveDhpJoinKeyForRow_(row) {
    if (!row) return '';

    var parentKey = _canonicalId_(row.parentDeploymentId || row.deploymentFk);
    if (parentKey) return parentKey;

    var depId = _canonicalId_(row.deploymentId);
    if (depId && !_isSyntheticDeploymentDisplayId_(depId)) return depId;

    if (row.productFunctions && row.productFunctions.length) {
      for (var i = 0; i < row.productFunctions.length; i++) {
        var pf = row.productFunctions[i];
        var pfKey = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
        if (pfKey) return pfKey;
      }
    }
    return '';
  }

  /**
   * Looks up aggregated DHP data for a deployment join key.
   * @param {Object} map
   * @param {string} joinKey
   * @return {Object|null}
   * @private
   */
  function _lookupDeploymentHealthPlan_(map, joinKey) {
    if (!map || !joinKey) return null;
    var canon = _canonicalId_(joinKey);
    if (!canon) return null;
    return map[canon] || (canon.length >= 15 ? map[canon.slice(0, 15)] : null) || null;
  }

  /**
   * Applies DHP enrichment fields to deployment rows (cloned per row).
   * Does not alter health, overallStatus, or Executive Watch fields.
   *
   * @param {Array<Object>} rows
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function applyDeploymentHealthPlansToRows_(rows, cfg) {
    rows = rows || [];
    if (!_isDeploymentHealthPlanEnabled_(cfg)) {
      return rows.map(function (row) {
        return Object.assign({}, row, { hasHealthPlan: false });
      });
    }

    var map = buildDeploymentHealthPlanMap_(cfg);
    return rows.map(function (row) {
      var enriched = Object.assign({}, row);
      var joinKey = _resolveDhpJoinKeyForRow_(row);
      var agg = _lookupDeploymentHealthPlan_(map, joinKey);
      if (agg && agg.hasHealthPlan) {
        enriched.hasHealthPlan = true;
        enriched.deploymentHealthPlan = JSON.parse(JSON.stringify(agg));
        enriched.healthPlanIssueCategory = agg.primaryIssueCategory || '';
        enriched.healthPlanIssueCategories = (agg.issueCategories || []).slice();
        enriched.healthPlanOwner = agg.latestPlanOwner || '';
        enriched.healthPlanLastUpdated = agg.latestUpdated || '';
      } else {
        enriched.hasHealthPlan = false;
      }
      return enriched;
    });
  }

  /**
   * Diagnostic for Deployment Health Plan ingestion and row enrichment.
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugDeploymentHealthPlan(config) {
    var cfg = CoreConfig.withDefaults(config);
    var dhpCfg = cfg.deploymentHealthPlan || {};
    var sheetName = dhpCfg.sheetName || 'SFDC_DHP';
    var enabled = _isDeploymentHealthPlanEnabled_(cfg);
    var productMode = isProductModeActiveDeploymentsUnionEnabled_(cfg);
    var displayGrain = _getProductModeDisplayGrain_(cfg);
    var countGrain = _getProductModeCountGrain_(cfg);

    var sheetExists = false;
    try {
      sheetExists = !!getSpreadsheet_().getSheetByName(sheetName);
    } catch (e) { /* no-op */ }

    var rawRows = [];
    if (enabled) {
      _cache.dhpRows = null;
      _cache.dhpMap = null;
      rawRows = readDeploymentHealthPlansRaw_(cfg) || [];
    }

    var withDeploymentId = 0;
    var missingDeploymentId = 0;
    var uniqueDeploymentIds = {};
    var issueCategoryCounts = {};
    var multiPerDeployment = 0;
    var perDeploymentCounts = {};

    rawRows.forEach(function (row) {
      if (row.deploymentId) {
        withDeploymentId++;
        uniqueDeploymentIds[_canonicalId_(row.deploymentId)] = true;
        perDeploymentCounts[row.deploymentId] = (perDeploymentCounts[row.deploymentId] || 0) + 1;
      } else {
        missingDeploymentId++;
      }
      (row.issueCategories || []).forEach(function (cat) {
        issueCategoryCounts[cat] = (issueCategoryCounts[cat] || 0) + 1;
      });
    });

    Object.keys(perDeploymentCounts).forEach(function (depId) {
      if (perDeploymentCounts[depId] > 1) multiPerDeployment++;
    });

    var deploymentRows = [];
    try {
      deploymentRows = getAllDeployments(cfg, null, { product: 'all' }) || [];
    } catch (e) {
      Logger.log('CoreData._debugDeploymentHealthPlan: getAllDeployments failed: ' + e);
    }

    var enrichedCount = 0;
    var withoutDhp = 0;
    var bothEwAndDhp = 0;
    var dhpOnly = 0;
    var ewOnly = 0;
    var matchedByParentKey = 0;
    var sampleEnriched = [];

    deploymentRows.forEach(function (row) {
      if (row.hasHealthPlan) {
        enrichedCount++;
        if (sampleEnriched.length < 5) {
          sampleEnriched.push({
            accountName: row.accountName || '',
            deploymentName: row.deploymentName || '',
            deploymentId: row.deploymentId || '',
            parentDeploymentId: row.parentDeploymentId || '',
            deploymentFk: row.deploymentFk || '',
            hasHealthPlan: true,
            healthPlanIssueCategories: row.healthPlanIssueCategories || [],
            healthPlanOwner: row.healthPlanOwner || '',
            healthPlanLastUpdated: row.healthPlanLastUpdated || ''
          });
        }
        var joinKey = _resolveDhpJoinKeyForRow_(row);
        if (joinKey && (row.parentDeploymentId || row.deploymentFk)) matchedByParentKey++;
      } else {
        withoutDhp++;
      }

      if (row.isExecutiveWatch && row.hasHealthPlan) bothEwAndDhp++;
      else if (row.hasHealthPlan) dhpOnly++;
      else if (row.isExecutiveWatch) ewOnly++;
    });

    var groupedDisplayRows = productMode
      ? deploymentRows.filter(function (r) {
          return r.deploymentRowSource === 'productFunctionGrouped';
        }).length
      : 0;

    var result = {
      appName: cfg.appId || cfg.ui && cfg.ui.appTitle || '',
      enabled: enabled,
      sheetName: sheetName,
      sheetExists: sheetExists,
      dhpRowCount: rawRows.length,
      dhpRowsWithDeploymentId: withDeploymentId,
      dhpRowsMissingDeploymentId: missingDeploymentId,
      distinctDeploymentIdsInDhp: Object.keys(uniqueDeploymentIds).length,
      issueCategoryCounts: issueCategoryCounts,
      deploymentsWithMultipleDhpRows: multiPerDeployment,
      sampleNormalizedDhpRows: rawRows.slice(0, 5).map(function (r) {
        return {
          dhpId: r.dhpId,
          deploymentId: r.deploymentId,
          planOwner: r.planOwner,
          dhpLastUpdated: r.dhpLastUpdated,
          issueCategories: r.issueCategories || []
        };
      }),
      joinMode: productMode ? 'ProductMode' : 'IndustryMode',
      displayGrain: displayGrain,
      countGrain: countGrain,
      groupedDisplayRowCount: groupedDisplayRows,
      deploymentRowsChecked: deploymentRows.length,
      deploymentRowsEnrichedWithDhp: enrichedCount,
      deploymentRowsWithoutDhp: withoutDhp,
      dhpDeploymentsMatchedByParentKey: matchedByParentKey,
      sampleEnrichedRows: sampleEnriched,
      rowsWithExecutiveWatchAndHealthPlan: bothEwAndDhp,
      rowsWithHealthPlanOnly: dhpOnly,
      rowsWithExecutiveWatchOnly: ewOnly
    };

    Logger.log('=== _debugDeploymentHealthPlan(' + (cfg.appId || '?') + ') ===');
    Logger.log(JSON.stringify(result, null, 2));
    Logger.log('=== end _debugDeploymentHealthPlan ===');
    return result;
  }
  
/**
 * N2: Returns a "data version" token = the latest 'Refresh Time' in the
 * 'Auto Refresh Execution Log' tab for the SFDC_Deployments sheet. Folded into
 * the sfdcRows cache key so a connector refresh of SFDC_Deployments automatically
 * invalidates stale tier-2 cache. Falls back to the overall latest refresh time,
 * then ''. Returns '' if the tab is missing/empty (key degrades to non-versioned).
 * @private
 */
function _sfdcDataVersion_(cfg) {
  try {
    var ss = getSpreadsheet_();
    var sh = ss.getSheetByName('Auto Refresh Execution Log');
    if (!sh) return '';
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return '';
    // Columns: A=Refresh Time, B=Sheet. Read both.
    var vals = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    var deploymentsSheet = cfg && cfg.sheets && cfg.sheets.deployments
      ? cfg.sheets.deployments : 'SFDC_Deployments';
    var pfSheet = cfg && cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions
      ? cfg.sheets.sfdcDeploymentProductFunctions : 'SFDC_DeploymentProductFunctions';
    var watchSheet = cfg && cfg.freshness && cfg.freshness.watchSheet
      ? cfg.freshness.watchSheet : deploymentsSheet;
    var watchTargets = {};
    watchTargets[watchSheet] = true;
    if (usesProductModePfDataSource_(cfg)) {
      watchTargets[pfSheet] = true;
    }
    watchTargets[deploymentsSheet] = true;
    var latestForWatch = '';
    var latestOverall = '';
    for (var i = 0; i < vals.length; i++) {
      var ts = vals[i][0];
      var sheetName = String(vals[i][1] || '').trim();
      if (!ts) continue;
      var key = (ts instanceof Date) ? String(ts.getTime()) : String(ts);
      if (key > latestOverall) latestOverall = key;
      if (watchTargets[sheetName] && key > latestForWatch) latestForWatch = key;
    }
    var chosen = latestForWatch || latestOverall;
    return chosen ? chosen.replace(/[^0-9A-Za-z]/g, '').slice(0, 24) : '';
  } catch (e) {
    Logger.log('CoreData._sfdcDataVersion_: ' + e);
    return '';
  }
}
  // ===========================================================================
  // PHASE 3i: SFDC_DEPLOYMENTS READER (Active + Complete unified source)
  // ===========================================================================

  /**
   * Reads the unified SFDC_Deployments sheet using header-based column detection.
   * Returns ALL rows (Active + Complete) with a `status` field. The caller
   * is responsible for filtering to the desired status.
   *
   * Column detection uses case-insensitive keyword matching, mirroring the
   * pattern from CoreSalesforce. Columns whose headers are not recognized
   * are silently skipped; only critical fields (Id, status) log a warning.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Array<Object>}  Raw deployment rows; may be empty if sheet missing.
   * @private
   */
  function readSfdcDeploymentsRaw_(cfg) {
    // Performance Layer 1: tier 1 (in-memory).
    if (_cache.sfdcRows !== null) return _cache.sfdcRows;
    // Performance Layer 2: tier 2 (sheet-tab cache).
    var cacheKey = _perfKey_(cfg, 'sfdcRows');
    var cached = _perfCacheRead_(cacheKey);
    if (cached !== null) {
      _cache.sfdcRows = cached; // hoist to tier 1 for the rest of this execution
      return cached;
    }
    var sheetName = cfg.sheets.deployments || 'SFDC_Deployments';
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log('CoreData.readSfdcDeploymentsRaw_: sheet "' + sheetName + '" not found.');
      return [];
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var lastCol  = sheet.getLastColumn();
    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers   = allValues[0].map(function (h) { return String(h || '').trim(); });
    var lowerH    = headers.map(function (h) { return h.toLowerCase(); });

    // -----------------------------------------------------------------------
    // Column index detection — keyword-based, case-insensitive.
    // For each field, we try multiple keyword patterns in priority order.
    // -----------------------------------------------------------------------
    function detect_(keywords, positionalFallback) {
      for (var ki = 0; ki < keywords.length; ki++) {
        var kw = keywords[ki].toLowerCase();
        for (var i = 0; i < lowerH.length; i++) {
          if (lowerH[i].indexOf(kw) !== -1) return i;
        }
      }
      if (positionalFallback >= 0 && positionalFallback < headers.length) return positionalFallback;
      return -1;
    }

    // ── Column detection — 24-col standard layout (confirmed 2026-06-24) ──────
    var colId             = detect_(['id'],                                                    0);
    var colName           = detect_(['name'],                                                  1);
    var colAccountId      = detect_(['customer__c'],                                           2);
    var colAccountName    = detect_(['customer__r.name', 'customer__r'],                       3);
    var colIndustry       = detect_(['customer__r.industry', 'industry'],                      4);
    var colRegion         = detect_(['ps_region_new', 'region_new', 'region'],                 5);
    var colSubRegion      = detect_(['ps_sub_region__c', 'ps_sub_region', 'sub_region'],       6);
    var colSubRegionAlt   = detect_(['subregion__c', 'subregion'],                             7);
    var colBillingState   = detect_(['billingstate', 'billing_state'],                         8);
    var colBillingCity    = detect_(['billingcity', 'billing_city'],                           9);
    var colStartDate      = detect_(['deployment_start_date'],                                10);
    var colMtpDate        = detect_(['current_mtp_date'],                                     11);
    var colFirstMtpActual = detect_(['first_move_to_production_date_actual',
                                     'move_to_production_date_actual',
                                     'first_mtp_date_actual'],                               -1);
    var colFirstMtp       = detect_(['first_move_to_production', 'first_mtp'],                12);
    var colStatus         = detect_(['overall_status'],                                       13);
    var colPhase          = detect_(['deployment_phase'],                                     14);
    var colStage          = detect_(['deployment_stage'],                                     15);
    var colHealth         = detect_(['overall_health'],                                       16);
    var colCompletionDate = detect_(['deployment_completion_date', 'completion_date'],        17);
    var colEM             = detect_(['workday_engagement_manager__r.full_name__c',
                                     'workday_engagement_manager__r',
                                     'engagement_manager', 'wdengmanager'],                   18);
    var colDAM            = detect_(['delivery_assurance_manager__r.full_name__c',
                                     'delivery_assurance_manager__r',
                                     'delivery_assurance', 'dam'],                            19);
    var colPrimingPartner = detect_(['priming_partner'],                                      20);
    var colImplPartner    = detect_(['implementation_partner'],                               21);
    var colPartner        = detect_(['deployment_partner_name', 'partner'],                   22);
    var colSummary        = detect_(['deployment_summary'],                                   23);

    if (colStatus < 0) {
      Logger.log('CoreData.readSfdcDeploymentsRaw_: WARNING — Overall_Status__c column not ' +
                 'found in "' + sheetName + '". Status-based filtering will not work.');
    }
    if (colId < 0) {
      Logger.log('CoreData.readSfdcDeploymentsRaw_: WARNING — Id column not found in "' +
                 sheetName + '". deploymentId will be empty for all rows.');
    }

    var tz = Session.getScriptTimeZone();
    var _wellnessMap = buildWellnessMap_(cfg);

    var rows = [];
    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];

      function cellStr_(col) { return col >= 0 ? String(row[col] || '').trim() : ''; }
      function cellDate_(col) {
        if (col < 0) return '';
        var raw = row[col];
        if (!raw) return '';
        var d = (raw instanceof Date) ? raw : new Date(raw);
        if (isNaN(d.getTime())) return '';
        return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      }

      var deploymentId = cellStr_(colId);
      if (!deploymentId) continue; // skip rows with no SF Id

      var rowObj = {
        deploymentId:        deploymentId,
        deploymentName:      cellStr_(colName),
        accountId:           cellStr_(colAccountId),
        accountName:         cellStr_(colAccountName),
        industry:            cellStr_(colIndustry),
        region:              cellStr_(colRegion),
        subRegion:           cellStr_(colSubRegion),
        subRegionAlt:        cellStr_(colSubRegionAlt),
        billingState:        cellStr_(colBillingState),
        billingCity:         cellStr_(colBillingCity),
        deploymentStartDate: cellStr_(colStartDate),
        mtpDate:             cellStr_(colMtpDate),
        firstMtpDate:        cellStr_(colFirstMtp),
        firstMtpDateActual:  cellDate_(colFirstMtpActual),
        overallStatus:       cellStr_(colStatus),
        phase:               cellStr_(colPhase),
        stage:               cellStr_(colStage),
        health:              cellStr_(colHealth),
        completionDate:      cellStr_(colCompletionDate),
        wdEngManager:        cellStr_(colEM),
        damFullName:         cellStr_(colDAM),
        primingPartner:      cellStr_(colPrimingPartner),
        implPartner:         cellStr_(colImplPartner),
        partner:             cellStr_(colPartner),
        currentUpdate:       cellStr_(colSummary)
      };
      var _wKey = (rowObj.accountId || '').slice(0, 15);
      var _wellness = _wellnessMap[_wKey] || null;
      _attachWellnessFieldsToRow_(rowObj, _wellness);
      rows.push(rowObj);
    }

    Logger.log('CoreData.readSfdcDeploymentsRaw_: read ' + rows.length +
               ' rows from "' + sheetName + '".');
    // Performance Layer 1: tier 1 (in-memory).
    _cache.sfdcRows = rows;
    // Performance Layer 2: tier 2 (sheet-tab cache).
    _perfCacheWrite_(cacheKey, rows);
    return rows;
  }

  /**
   * Apply viewMode personalization filtering to a row set.
   * @private
   */
  function applyViewModeFilter_(cfg, rows, viewModeOpts) {
    if (!viewModeOpts || !viewModeOpts.viewMode || viewModeOpts.viewMode === 'all') {
      return rows;
    }
    if (viewModeOpts.viewMode === 'my') {
      var ddName = String(viewModeOpts.ddDisplayName || '').trim();
      if (!ddName) return [];
      return CoreUsers.filterRowsByAccountOwner(cfg, rows, ddName);
    }
    return rows;
  }

  // ===========================================================================
  // AUDIT TRAIL HELPERS
  // ===========================================================================

  /**
   * Writes a row to the OverrideAudit sheet. Best-effort: failure is logged
   * but does not throw.
   * @private
   */
  function writeAuditRow_(cfg, entry) {
    try {
      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName('OverrideAudit');
      if (!sheet) {
        Logger.log('CoreData.writeAuditRow_: OverrideAudit sheet not found; audit skipped.');
        return;
      }
      var fieldsAffected = Array.isArray(entry.fieldsAffected)
        ? entry.fieldsAffected.join(',')
        : String(entry.fieldsAffected || '');
      sheet.appendRow([
        new Date(),                              // A: Timestamp
        getCurrentUserEmail_(),                  // B: User
        String(entry.action || ''),              // C: Action
        String(entry.overrideType || ''),        // D: OverrideType
        String(entry.deploymentId || ''),        // E: DeploymentID
        String(entry.accountName || ''),         // F: AccountName
        fieldsAffected,                          // G: FieldsAffected
        String(entry.oldValueSnapshot || ''),    // H: OldValueSnapshot
        String(entry.newValueSnapshot || ''),    // I: NewValueSnapshot
        String(entry.notes || '')                // J: Notes
      ]);
    } catch (err) {
      Logger.log('CoreData.writeAuditRow_: failed: ' + err);
    }
  }

  function lookupAccountForDeployment_(cfg, deploymentId) {
    var target = String(deploymentId || '').trim();
    if (!target) return '';
    var prefix = target.length >= 15 ? target.slice(0, 15) : target;
    try {
      var rows = getAllEffectiveDeployments(cfg);
      for (var i = 0; i < rows.length; i++) {
        var id = String(rows[i].deploymentId || '').trim();
        if (!id) continue;
        if (id === target || (id.length >= 15 && id.slice(0, 15) === prefix)) {
          return String(rows[i].accountName || '');
        }
      }
    } catch (err) {
      Logger.log('CoreData.lookupAccountForDeployment_: getAllEffectiveDeployments failed: ' + err);
    }
    return '';
  }

  function snapshotDeploymentOverride_(cfg, deploymentId) {
    var map = getDeploymentOverridesMap_(cfg);
    var row = map[String(deploymentId).trim()];
    if (!row) return { isEmpty: true };
    return {
      isEmpty: false,
      Override_Health:        row.overrideHealth || '',
      Override_MTPDate:       row.overrideMtp ? CoreUtils.formatDateToIsoString(row.overrideMtp) : '',
      Override_Stage:         row.overrideStage || '',
      Override_Account:       row.overrideAccount || '',
      Override_Deployment:    row.overrideName || '',
      Override_CurrentUpdate: row.overrideCurrentUpdate || '',
      Exclude_From_Report:    !!row.exclude,
      Classification:         row.classification || 'Monthly'
    };
  }

  function snapshotGoLivesOverride_(cfg, accountName) {
    var map = getGoLivesOverridesMap_(cfg);
    var row = map[String(accountName).trim()];
    if (!row) return { isEmpty: true };
    return {
      isEmpty: false,
      Override_GoLiveDate: row.overrideDate ? CoreUtils.formatDateToIsoString(row.overrideDate) : '',
      Override_Partner:    row.overridePartner || '',
      Exclude_From_Report: !!row.exclude,
      Classification:      row.classification || 'Monthly'
    };
  }

  function diffSnapshotFields_(before, after) {
    var changed = [];
    Object.keys(after).forEach(function (k) {
      if (k === 'isEmpty') return;
      if (String(before[k] || '') !== String(after[k] || '')) changed.push(k);
    });
    return changed;
  }

  // ===========================================================================
  // PUBLIC: ACTIVE DEPLOYMENTS
  // ===========================================================================

  function getActiveDeployments(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var allEffective = getAllEffectiveDeployments(cfg, productOpts);

    var redYellow = allEffective
      .filter(function (r) {
        if (r.health !== 'Red' && r.health !== 'Yellow') return false;
        if (cfg.report.redYellowPartnerFilter) {
          return r.partner === cfg.report.redYellowPartnerFilter;
        }
        return true;
      })
      .sort(function (a, b) {
        if (a.health === b.health) return 0;
        return a.health < b.health ? -1 : 1;
      });

    redYellow = filterDeploymentsByStudent_(redYellow, 'exclude', cfg);
    return applyViewModeFilter_(cfg, redYellow, viewModeOpts);
  }

  /**
   * Phase 2: Returns ALL effective deployments (Red, Yellow, Green) for
   * the Expanded Deployments tab. Caller-side filtering by Health is done in JS.
   *
   * Phase 3a: Injects `isPhased` on each row using CoreSalesforce enrichment.
   * Rows not found in the enrichment map get isPhased = false.
   *
   * Phase 3i: Now reads from SFDC_Deployments (cfg.sheets.deployments) instead
   * of ActiveDeployments, while preserving Active-only default behavior and
   * full override/meta application. Falls back to ActiveDeployments if the
   * new sheet is unavailable, so Phase 2 callers continue to work unchanged.
   *
   * D1.1: Refactored to delegate the base row build to getAllEffectiveDeployments(),
   * eliminating a parallel implementation. This ensures every derived field attached
   * inside getAllEffectiveDeployments() (including D1's ddContacts / ddFromContacts)
   * automatically flows through to the WebApp Deployments tab.
   */
  function getAllDeployments(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);

    // Base effective view — includes SFDC-vs-legacy fallback, Active-only filter,
    // meta application, overrides application, and D1 ddContacts/ddFromContacts.
    var allEffective = getAllEffectiveDeployments(cfg, productOpts);
    allEffective = applyDeploymentHealthPlansToRows_(allEffective, cfg);

    // Phase 3a: enrich with isPhased, upcomingDates, nextGoLiveDate.
    // Degrade gracefully when the enrichment sheet is absent.
    var enrichmentMap = {};
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData.getAllDeployments: CoreSalesforce enrichment failed — ' +
                 'isPhased will default to false. Error: ' + err);
    }

    var enriched = allEffective.map(function (row) {
      var lookupId = row.parentDeploymentId || row.deploymentId;
      var enrichment = enrichmentMap[row.deploymentId] || enrichmentMap[lookupId];
      return Object.assign({}, row, {
        isPhased:       enrichment ? !!enrichment.isPhased : false,
        upcomingDates:  enrichment ? (enrichment.upcomingDates || []) : [],
        nextGoLiveDate: enrichment ? (enrichment.nextGoLiveDate || null) : null
      });
    });

    // S1: exclude Student deployments from the Deployments tab view (HENP only).
    enriched = filterDeploymentsByStudent_(enriched, 'exclude', cfg);

    // Health-rank sort: Red -> Yellow -> Green -> other; tiebreak by accountName.
    var sorted = enriched.sort(function (a, b) {
      var rank = { 'Red': 0, 'Yellow': 1, 'Green': 2 };
      var ar = rank[a.health] !== undefined ? rank[a.health] : 99;
      var br = rank[b.health] !== undefined ? rank[b.health] : 99;
      if (ar !== br) return ar - br;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });

    return applyViewModeFilter_(cfg, sorted, viewModeOpts);
  }

  /**
   * True when ProductMode KPI totals should use count grain, not display grain.
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {boolean}
   * @private
   */
  function _productModeUsesSeparateCountGrain_(cfg) {
    if (!usesProductModePfDataSource_(cfg)) return false;
    return _getProductModeCountGrain_(cfg) !== _getProductModeDisplayGrain_(cfg);
  }

  /**
   * Deployments tab payload for the WebApp.
   * IndustryMode (and ProductMode when count grain equals display grain) returns
   * the display row array for backward compatibility.
   * ProductMode when grains differ returns { rows, countRows, useCountGrainForKpis }.
   *
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Array<Object>|{rows: Array<Object>, countRows: Array<Object>, useCountGrainForKpis: boolean}}
   */
  function getAllDeploymentsForUI(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var displayRows = getAllDeployments(cfg, viewModeOpts, productOpts);

    if (!_productModeUsesSeparateCountGrain_(cfg)) {
      return displayRows;
    }

    var countRows = getActiveCountDeployments(cfg, productOpts) || [];
    countRows = filterDeploymentsByStudent_(countRows, 'exclude', cfg);
    countRows = applyViewModeFilter_(cfg, countRows, viewModeOpts);

    return {
      rows: displayRows,
      countRows: countRows,
      useCountGrainForKpis: true
    };
  }

  // ===========================================================================
  // PUBLIC: GO LIVES
  // ===========================================================================

  /**
   * Phase 3a: Returns upcoming go-live rows for the 90-day window.
   *
   * Strategy:
   *   Pass 1 — deployments found in the CoreSalesforce enrichment map:
   *     One row per deployment, with upcomingDates[], isPhased, nextGoLiveDate.
   *   Pass 2 — fallback for deployments NOT in the enrichment map:
   *     Use dep.mtpDate from the SFDC effective view (preserves Phase 1/2 behavior).
   *     upcomingDates = single-entry array, isPhased = false.
   *
   * GoLivesOverrides (exclusion + partner/date override) are applied in both passes.
   *
   * Backward-compatible output shape — adds new fields alongside existing ones:
   *   { ...existing..., deploymentId, upcomingDates[], isPhased, nextGoLiveDate }
   *   mtpDate is set to nextGoLiveDate for backward compatibility with callers
   *   that still use row.mtpDate.
   */
  function getUpcomingGoLives(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    if (usesProductModePfGoLiveSource_(cfg)) {
      return getUpcomingGoLivesFromProductFunctions_(cfg, viewModeOpts, productOpts);
    }

    // Get the effective view of all deployments (post-meta + post-overrides).
    var allEffective = getAllEffectiveDeployments(cfg, productOpts);

    // Get GoLives overrides (exclusion, partner override, date override).
    var goLivesOverrides = getGoLivesOverridesMap_(cfg);

    // Get Salesforce enrichment. Degrade gracefully on any error.
    var enrichmentMap = {};
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData.getUpcomingGoLives: CoreSalesforce enrichment failed — ' +
                 'running in fallback-only mode. Error: ' + err);
    }

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var windowDays = (cfg.salesforce && cfg.salesforce.upcomingWindowDays) || 90;
    var windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    var results = [];
    var seenDeploymentIds = {};

    // -----------------------------------------------------------------------
    // Pass 1: enrichment map — one row per deployment with product-function data.
    // -----------------------------------------------------------------------
    allEffective.forEach(function (dep) {
      if (!dep.deploymentId) return;

      var enrichment = enrichmentMap[dep.deploymentId];
      if (!enrichment) return;

      var ov = goLivesOverrides[dep.accountName] || {};
      if (ov.exclude) return;

      // Filter upcomingDates to those within the window.
      var datesInWindow = (enrichment.upcomingDates || []).filter(function (ud) {
        if (!ud.date) return false;
        var d = new Date(ud.date);
        return !isNaN(d.getTime()) && d >= now && d <= windowEnd;
      });
      if (datesInWindow.length === 0) return;

      // Apply override date to nextGoLiveDate if set.
      var nextGoLiveDate = ov.overrideDate
        ? CoreUtils.formatDateToIsoString(ov.overrideDate)
        : datesInWindow[0].date;

      seenDeploymentIds[dep.deploymentId] = true;
      results.push({
        rowIndex:          dep.rowIndex,
        deploymentId:      dep.deploymentId,
        accountId:         dep.accountId,
        accountName:       dep.accountName,
        deploymentName:    dep.deploymentName,
        servicesApproach:  dep.servicesApproach,
        industry:          dep.industry,
        subRegion:         dep.subRegion,
        partner:           ov.overridePartner || dep.partner,
        stage:             dep.stage,
        health:            dep.health,
        dam:               dep.dam,
        wdEngManager:      dep.wdEngManager,
        deliveryDirector:  dep.deliveryDirector,
        ddNotes:           dep.ddNotes,
        upcomingDates:     datesInWindow,
        isPhased:          enrichment.isPhased,
        nextGoLiveDate:    nextGoLiveDate,
        mtpDate:           nextGoLiveDate,  // backward compat alias
        excludeFromReport: !!(ov.exclude || dep.excludeFromReport),
        reviewUsername:    ov.lastEditedBy || dep.reviewUsername || '',
        reviewTimestamp:   ov.lastEditedAt || dep.reviewTimestamp || ''
      });
    });

    // -----------------------------------------------------------------------
    // Pass 2: fallback — deployments not in the enrichment map,
    // using dep.mtpDate from the SFDC effective view.
    // -----------------------------------------------------------------------
    allEffective.forEach(function (dep) {
      if (!dep.deploymentId) return;
      if (seenDeploymentIds[dep.deploymentId]) return;

      var ov = goLivesOverrides[dep.accountName] || {};
      if (ov.exclude) return;

      var mtpDate = ov.overrideDate
        ? CoreUtils.formatDateToIsoString(ov.overrideDate)
        : dep.mtpDate;
      if (!mtpDate) return;

      var d = new Date(mtpDate);
      if (isNaN(d.getTime())) return;
      if (d < now || d > windowEnd) return;

      results.push({
        rowIndex:          dep.rowIndex,
        deploymentId:      dep.deploymentId,
        accountId:         dep.accountId,
        accountName:       dep.accountName,
        deploymentName:    dep.deploymentName,
        servicesApproach:  dep.servicesApproach,
        industry:          dep.industry,
        subRegion:         dep.subRegion,
        partner:           ov.overridePartner || dep.partner,
        stage:             dep.stage,
        health:            dep.health,
        dam:               dep.dam,
        wdEngManager:      dep.wdEngManager,
        deliveryDirector:  dep.deliveryDirector,
        ddNotes:           dep.ddNotes,
        upcomingDates:     [{ date: mtpDate, products: [] }],
        isPhased:          false,
        nextGoLiveDate:    mtpDate,
        mtpDate:           mtpDate,
        excludeFromReport: !!(ov.exclude || dep.excludeFromReport),
        reviewUsername:    ov.lastEditedBy || dep.reviewUsername || '',
        reviewTimestamp:   ov.lastEditedAt || dep.reviewTimestamp || ''
      });
    });

    // Sort by nextGoLiveDate ascending.
    results.sort(function (a, b) {
      return new Date(a.nextGoLiveDate) - new Date(b.nextGoLiveDate);
    });

    // S1: exclude Student deployments from non-Student surfaces (HENP only).
    results = filterDeploymentsByStudent_(results, 'exclude', cfg);

    results = _enrichGoLiveRowsWithOverrides_(
      results,
      getDeploymentOverridesMap_(cfg),
      getGoLivesOverridesMap_(cfg)
    );

    Logger.log('CoreData.getUpcomingGoLives: ' + results.length + ' upcoming rows ' +
               '(pass1=' + Object.keys(seenDeploymentIds).length + ', ' +
               'pass2=' + (results.length - Object.keys(seenDeploymentIds).length) + ').');

    return applyViewModeFilter_(cfg, results, viewModeOpts);
  }

  // ===========================================================================
  // PHASE 3i: RECENT GO LIVES (SOQL-based, supersedes legacy getGoLives)
  // ===========================================================================

  /**
   * Returns recent go-live rows for the configured window (default 60 days).
   *
   * Phase 3i patch: inclusion is driven by date-level window filtering on
   * Production_Move_Date_Actual__c, NOT by parent deployment status. Both Active
   * and Complete deployments are considered — a phased Active deployment that had
   * a wave go live within the last 60 days must appear in the Recent view.
   *
   * Data source: ALL rows from SFDC_Deployments (Active + Complete) joined with
   * the CoreSalesforce enrichment map (recentDates from Actual move dates on
   * SFDC_DeploymentProductFunctions). `status` is retained on each row for
   * display purposes but is NOT used as a filter.
   *
   * Window logic (per date, not per deployment):
   *   1. Fetch all past Actual dates for this deployment from enrichment.recentDates.
   *   2. Filter to dates in [today - recentWindowDays, today] → filteredRecentDates.
   *   3. If filteredRecentDates is empty, try the deployment-level fallback
   *      (First_Move_to_Production_Date_Actual__c); include only if also in window.
   *   4. Skip deployments with no in-window dates.
   *   5. lastGoLiveDate = max date in filteredRecentDates (never all-time last).
   *
   * Output row shape:
   *   {
   *     deploymentId, accountName, deploymentName, partner, industry, status,
   *     recentDates: [{ date: 'YYYY-MM-DD', products: [...] }, ...],  // window-only
   *     lastGoLiveDate: 'YYYY-MM-DD'                                   // max in window
   *   }
   *
   * @param {AppConfig} config
   * @param {Object=}   viewModeOpts       Phase 2 viewMode options (same shape as getUpcomingGoLives).
   * @param {number=}   windowDaysOverride When positive, overrides the config-derived window (e.g. 180
   *                                       for the Notable picker). Absent/null/0 → today's behavior.
   * @param {Object=}   productOpts        { product: string } — global product filter; 'all' or absent = no filter
   * @return {Array<Object>}
   */
  function getRecentGoLives(config, viewModeOpts, windowDaysOverride, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    if (usesProductModePfGoLiveSource_(cfg)) {
      return getRecentGoLivesFromProductFunctions_(cfg, viewModeOpts, windowDaysOverride, productOpts);
    }

    var pa = (productOpts && productOpts.product) || 'all';

    // Recent window: positive windowDaysOverride wins; otherwise fall back to config / 60-day default.
    var recentWindowDays =
      (typeof windowDaysOverride === 'number' && windowDaysOverride > 0)
        ? windowDaysOverride
        : (cfg.salesforce && cfg.salesforce.recentWindowDays) ||
          (cfg.ui && cfg.ui.goLivesTab && cfg.ui.goLivesTab.recentWindowDays) || 60;

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var tz = Session.getScriptTimeZone();
    var todayKey      = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var windowStart   = new Date(now.getTime() - recentWindowDays * 24 * 60 * 60 * 1000);
    var windowStartKey = Utilities.formatDate(windowStart, tz, 'yyyy-MM-dd');

    // Read ALL rows from SFDC_Deployments — Active and Complete.
    // Status filtering is intentionally absent: a phased Active deployment whose
    // most recent wave already went live belongs in the Recent view.
    var sfdcRows = [];
    try {
      sfdcRows = readSfdcDeploymentsRaw_(cfg);
    } catch (err) {
      Logger.log('CoreData.getRecentGoLives: readSfdcDeploymentsRaw_ failed — ' +
                 'returning empty. Error: ' + err);
      return [];
    }

    if (sfdcRows.length === 0) {
      Logger.log('CoreData.getRecentGoLives: SFDC_Deployments returned no rows.');
      return [];
    }

    sfdcRows = filterDeploymentsByProduct_(sfdcRows, pa, cfg);

    // Get CoreSalesforce enrichment map (recentDates = Actual dates < today).
    var enrichmentMap = {};
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData.getRecentGoLives: CoreSalesforce enrichment failed — ' +
                 'will use deployment-level fallback dates only. Error: ' + err);
    }

    var results = [];
    sfdcRows.forEach(function (dep) {
      var enrichment   = enrichmentMap[dep.deploymentId];
      var allRecentDates = enrichment ? (enrichment.recentDates || []) : [];

      // --- Date-level window filter (normalized keys; phased/multi-date aware) ---
      var recentMatch = _latestRecentDateInRange_(dep, allRecentDates, windowStartKey, todayKey);
      if (!recentMatch) return;

      var filteredRecentDates = recentMatch.filteredRecentDates;
      var lastGoLiveDate = recentMatch.lastGoLiveDate;

      results.push({
        deploymentId:   dep.deploymentId,
        accountId:      dep.accountId,
        accountName:    dep.accountName,
        deploymentName: dep.deploymentName,
        partner:        dep.partner,
        industry:       dep.industry,
        status:         dep.status,          // retained for display; not used as filter
        recentDates:    filteredRecentDates, // only in-window dates
        lastGoLiveDate: lastGoLiveDate
      });
    });

    // Sort ascending by lastGoLiveDate (oldest in-window go-live at the top).
    results.sort(function (a, b) {
      if (a.lastGoLiveDate < b.lastGoLiveDate) return -1;
      if (a.lastGoLiveDate > b.lastGoLiveDate) return  1;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });

    // S1: exclude Student deployments from non-Student surfaces (HENP only).
    results = filterDeploymentsByStudent_(results, 'exclude', cfg);

    results = _enrichGoLiveRowsWithOverrides_(
      results,
      getDeploymentOverridesMap_(cfg),
      getGoLivesOverridesMap_(cfg)
    );

    Logger.log('CoreData.getRecentGoLives: ' + results.length +
               ' deployments with in-window go-live dates (last ' +
               recentWindowDays + ' days, Active + Complete).');

    return applyViewModeFilter_(cfg, results, viewModeOpts);
  }

  /**
   * Normalizes ProductMode go-live type to canonical values.
   * @param {string} typeOrGoLiveType
   * @return {'actual'|'target'|null}
   * @private
   */
  function _normalizeProductModeGoLiveType_(typeOrGoLiveType) {
    var t = String(typeOrGoLiveType || '').trim().toLowerCase();
    if (t === 'actual' || t === 'recent' || t === 'recentactual') return 'actual';
    if (t === 'target' || t === 'upcoming' || t === 'upcomingtarget') return 'target';
    return null;
  }

  /**
   * Stable event ID for ProductMode PF go-live rows (account + date + type).
   * @param {string} accountId
   * @param {string} accountName
   * @param {string} goLiveType
   * @param {string} dateKey
   * @return {string}
   * @private
   */
  function _deriveProductModeGoLiveEventId_(accountId, accountName, goLiveType, dateKey) {
    return _normalizeGoLiveAccountKey_(accountId, accountName) + '__' +
      goLiveType + '__' +
      String(_toDateKey_(dateKey) || '').replace(/-/g, '');
  }

  /**
   * Normalized account identity for go-live event grouping.
   * @param {string} accountId
   * @param {string} accountName
   * @return {string}
   * @private
   */
  function _normalizeGoLiveAccountKey_(accountId, accountName, aliasMap) {
    var name = String(accountName || '').trim().toLowerCase();
    var id = String(accountId || '').trim();
    var byName = aliasMap && aliasMap.byName ? aliasMap.byName : null;

    if (name && byName && byName[name]) {
      return 'id:' + byName[name];
    }
    if (id) {
      return 'id:' + (id.length >= 15 ? id.slice(0, 15) : id);
    }
    if (name) return 'name:' + name;
    return 'name:';
  }

  /**
   * Maps account names to canonical 15-char IDs from PF rows that have both fields.
   * Prevents split groups when some rows lack accountId but share accountName.
   * @param {Array<Object>} details
   * @return {{ byName: Object<string, string> }}
   * @private
   */
  function _buildGoLiveAccountAliasMap_(details) {
    var byName = {};
    (details || []).forEach(function (d) {
      var name = String(d.accountName || '').trim().toLowerCase();
      var id = String(d.accountId || '').trim();
      if (!name || !id) return;
      var cid = id.length >= 15 ? id.slice(0, 15) : id;
      if (!byName[name]) byName[name] = cid;
    });
    return { byName: byName };
  }

  /**
   * Rolls up health across grouped PF rows: Red > Yellow > Green.
   * @param {Array<string>} healths
   * @return {string}
   * @private
   */
  function _rollupGoLiveHealth_(healths) {
    var rank = { 'Red': 3, 'Yellow': 2, 'Green': 1 };
    var best = '';
    var bestRank = 0;
    (healths || []).forEach(function (h) {
      var val = String(h || '').trim();
      if (!val) return;
      var r = rank[val] || 0;
      if (r > bestRank) {
        bestRank = r;
        best = val;
      }
    });
    return best;
  }

  /**
   * Builds display labels for grouped account/date go-live events.
   * @param {Array<string>} deploymentNames
   * @param {Array<string>} productAreas
   * @param {Array<string>} functions
   * @return {{displayDeploymentName: string, displayProductFunction: string, displayLabel: string}}
   * @private
   */
  function _formatGroupedGoLiveDisplayLabels_(deploymentNames, productAreas, functions) {
    var depName = (deploymentNames && deploymentNames.length) ? deploymentNames[0] : '';
    var depCount = deploymentNames ? deploymentNames.length : 0;
    var prodCount = productAreas ? productAreas.length : 0;
    var funcCount = functions ? functions.length : 0;
    var productSummary = '';

    if (prodCount === 1 && funcCount === 1) {
      productSummary = productAreas[0] + ' / ' + functions[0];
    } else if (prodCount === 1 && funcCount > 1) {
      productSummary = productAreas[0] + ' / ' + funcCount + ' functions';
    } else if (prodCount > 1) {
      productSummary = prodCount + ' products / ' + funcCount + ' functions';
    } else if (funcCount === 1) {
      productSummary = functions[0];
    } else if (funcCount > 1) {
      productSummary = funcCount + ' functions';
    }

    var displayDeploymentName = depName;
    if (productSummary) {
      displayDeploymentName = depName ? (depName + ' \u2014 ' + productSummary) : productSummary;
    }
    if (depCount > 1) {
      var meta = depCount + ' deployments';
      if (prodCount > 0) meta += ' \u00B7 ' + prodCount + ' products';
      if (funcCount > 0) meta += ' \u00B7 ' + funcCount + ' functions';
      displayDeploymentName = (depName ? depName + ' \u2014 ' : '') + meta;
    }

    var displayProductFunction = productSummary;
    if (funcCount > 1 && functions && functions.length) {
      displayProductFunction = functions.join(', ');
    }

    return {
      displayDeploymentName: displayDeploymentName,
      displayProductFunction: displayProductFunction,
      displayLabel: displayDeploymentName
    };
  }

  /**
   * PF detail object attached to grouped account/date go-live events.
   * @param {Object} pf
   * @param {string} goLiveType
   * @param {string} dateKey
   * @param {Object=} ov
   * @return {Object}
   * @private
   */
  function _buildPfGoLiveDetailObject_(pf, goLiveType, dateKey, ov) {
    ov = ov || {};
    goLiveType = _normalizeProductModeGoLiveType_(goLiveType) || goLiveType;
    var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
    var normalizedDate = _toDateKey_(dateKey);
    return {
      pfRowId: pf.pfRowId || '',
      parentDeploymentId: parentId,
      deploymentFk: parentId,
      deploymentName: pf.deploymentName || '',
      productArea: String(pf.productArea || '').trim(),
      funcArea: String(pf.funcArea || '').trim(),
      targetGoLive: pf.targetGoLive || '',
      actualGoLive: pf.actualGoLive || '',
      goLiveDate: normalizedDate,
      goLiveType: goLiveType,
      overallStatus: pf.overallStatus || '',
      phase: pf.phase || '',
      stage: pf.stage || '',
      health: pf.health || '',
      partner: ov.overridePartner || pf.partner || '',
      accountId: pf.accountId || '',
      accountName: pf.accountName || '',
      industry: pf.industry || '',
      region: pf.region || '',
      subRegion: pf.subRegion || '',
      subRegionAlt: pf.subRegionAlt || ''
    };
  }

  /**
   * Dedupe key for PF detail rows within an account/date group.
   * @param {Object} detail
   * @return {string}
   * @private
   */
  function _pfGoLiveDetailDedupeKey_(detail) {
    if (detail.pfRowId) return 'id:' + _canonicalId_(detail.pfRowId);
    return [
      _canonicalId_(detail.parentDeploymentId || detail.deploymentFk),
      String(detail.productArea || '').trim().toLowerCase(),
      String(detail.funcArea || '').trim().toLowerCase()
    ].join('|');
  }

  /**
   * Builds one grouped account/date go-live event from PF detail rows.
   * @param {Array<Object>} items
   * @return {Object|null}
   * @private
   */
  function _buildGroupedGoLiveEventRow_(items) {
    if (!items || !items.length) return null;
    var first = items[0];
    var goLiveType = _normalizeProductModeGoLiveType_(first.goLiveType) || first.goLiveType;
    var goLiveDate = first.goLiveDate;
    var accountId = first.accountId || '';
    var accountName = first.accountName || '';
    var eventKey = _productModeGoLiveEventKey_(
      accountId, accountName, goLiveDate, goLiveType, _buildGoLiveAccountAliasMap_(items));

    var productAreas = [];
    var functions = [];
    var deploymentNames = [];
    var parentDeploymentIds = [];
    var partners = [];
    var healths = [];

    items.forEach(function (d) {
      if (d.productArea && productAreas.indexOf(d.productArea) < 0) productAreas.push(d.productArea);
      if (d.funcArea && functions.indexOf(d.funcArea) < 0) functions.push(d.funcArea);
      if (d.deploymentName && deploymentNames.indexOf(d.deploymentName) < 0) deploymentNames.push(d.deploymentName);
      if (d.parentDeploymentId && parentDeploymentIds.indexOf(d.parentDeploymentId) < 0) {
        parentDeploymentIds.push(d.parentDeploymentId);
      }
      if (d.partner && partners.indexOf(d.partner) < 0) partners.push(d.partner);
      if (d.health) healths.push(d.health);
    });

    var labels = _formatGroupedGoLiveDisplayLabels_(deploymentNames, productAreas, functions);
    var health = _rollupGoLiveHealth_(healths);
    var partner = partners.length === 1 ? partners[0] : (partners[0] || '');
    var products = productAreas.slice();
    functions.forEach(function (f) {
      if (f && products.indexOf(f) < 0) products.push(f);
    });

    var row = {
      deploymentId: _deriveProductModeGoLiveEventId_(accountId, accountName, goLiveType, goLiveDate),
      eventKey: eventKey,
      goLiveDate: goLiveDate,
      goLiveType: goLiveType,
      accountId: accountId,
      accountName: accountName,
      industry: first.industry || '',
      region: first.region || '',
      subRegion: first.subRegion || '',
      subRegionAlt: first.subRegionAlt || '',
      deploymentName: deploymentNames[0] || '',
      displayDeploymentName: labels.displayDeploymentName,
      displayProductFunction: labels.displayProductFunction,
      displayLabel: labels.displayLabel,
      productArea: productAreas.length === 1 ? productAreas[0] : productAreas.join(', '),
      funcArea: functions.length === 1 ? functions[0] : functions.join(', '),
      productFunctions: items,
      productFunctionCount: items.length,
      productAreas: productAreas,
      functions: functions,
      deploymentNames: deploymentNames,
      parentDeploymentIds: parentDeploymentIds,
      parentDeploymentId: parentDeploymentIds[0] || '',
      deploymentFk: parentDeploymentIds[0] || '',
      partner: partner,
      health: health,
      stage: first.stage || '',
      phase: first.phase || '',
      status: first.overallStatus || '',
      isPhased: false,
      deploymentRowSource: 'productFunctionGoLiveEventGrouped',
      parentMatchStatus: 'pfGrouped'
    };

    if (goLiveType === 'actual') {
      row.recentDates = [{ date: goLiveDate, products: products }];
      row.lastGoLiveDate = goLiveDate;
    } else {
      row.upcomingDates = [{ date: goLiveDate, products: products }];
      row.nextGoLiveDate = goLiveDate;
      row.mtpDate = goLiveDate;
    }
    return row;
  }

  /**
   * Groups PF detail rows into account/date/type go-live events.
   * @param {Array<Object>} pfDetails
   * @return {{ events: Array<Object>, rawPfDetailCount: number, groupedEventCount: number, rawRowsCollapsed: number, rawRowsGroupedIntoEvents: number, maxProductFunctionsPerEvent: number }}
   * @private
   */
  function _groupProductModeGoLivePfDetails_(pfDetails) {
    var aliasMap = _buildGoLiveAccountAliasMap_(pfDetails);
    var groups = {};
    var seenDetail = {};
    var collapsed = 0;
    var rawCount = (pfDetails || []).length;

    (pfDetails || []).forEach(function (detail) {
      var groupKey = _productModeGoLiveEventKey_(
        detail.accountId, detail.accountName, detail.goLiveDate, detail.goLiveType, aliasMap);
      var detailKey = groupKey + '::' + _pfGoLiveDetailDedupeKey_(detail);
      if (seenDetail[detailKey]) {
        collapsed++;
        return;
      }
      seenDetail[detailKey] = true;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(detail);
    });

    var events = [];
    var maxPf = 0;
    Object.keys(groups).forEach(function (groupKey) {
      var row = _buildGroupedGoLiveEventRow_(groups[groupKey]);
      if (!row) return;
      if (row.productFunctionCount > maxPf) maxPf = row.productFunctionCount;
      events.push(row);
    });

    return {
      events: events,
      rawPfDetailCount: rawCount,
      groupedEventCount: events.length,
      rawRowsCollapsed: collapsed,
      rawRowsGroupedIntoEvents: rawCount > events.length ? (rawCount - events.length) : 0,
      maxProductFunctionsPerEvent: maxPf
    };
  }

  /**
   * Product/function fragment for display.
   * @param {string} productArea
   * @param {string} funcArea
   * @return {string}
   * @private
   */
  function _formatProductModeGoLiveProductFunction_(productArea, funcArea) {
    var pa = String(productArea || '').trim();
    var fa = String(funcArea || '').trim();
    if (pa && fa) return pa + ' / ' + fa;
    return pa || fa || '';
  }

  /**
   * Resolves the deployment column / widget label for any go-live row.
   * @param {Object} row
   * @return {string}
   */
  function resolveGoLiveDisplayDeploymentName_(row) {
    if (!row) return '';
    if (row.displayDeploymentName) return row.displayDeploymentName;
    if (row.displayLabel) return row.displayLabel;
    if (row.productFunctionCount > 1 && row.displayProductFunction) {
      var base = String(row.deploymentName || row.accountName || '').trim();
      return base ? (base + ' \u2014 ' + row.displayProductFunction) : row.displayProductFunction;
    }
    return _formatProductModeGoLiveDeploymentLabel_(
      row.deploymentName || '', row.productArea || '', row.funcArea || '');
  }

  /**
   * Secondary product/function summary for grouped go-live rows.
   * @param {Object} row
   * @return {string}
   */
  function resolveGoLiveProductFunctionSummary_(row) {
    if (!row) return '';
    if (row.displayProductFunction) return row.displayProductFunction;
    if (row.productFunctions && row.productFunctions.length) {
      return row.productFunctions.map(function (pf) {
        return _formatProductModeGoLiveProductFunction_(pf.productArea, pf.funcArea);
      }).filter(Boolean).join(', ');
    }
    return _formatProductModeGoLiveProductFunction_(row.productArea, row.funcArea);
  }

  /**
   * Stable dedupe key for ProductMode PF go-live events (account + date + type).
   * @param {string} accountId
   * @param {string} accountName
   * @param {string} goLiveDate
   * @param {string} goLiveType 'actual' | 'target'
   * @return {string}
   * @private
   */
  function _productModeGoLiveEventKey_(accountId, accountName, goLiveDate, goLiveType, aliasMap) {
    return [
      _normalizeGoLiveAccountKey_(accountId, accountName, aliasMap),
      _toDateKey_(goLiveDate),
      goLiveType
    ].join('|');
  }

  /**
   * Stable dedupe key for Overview go-live widget rows (account + date + type).
   * @param {Object} item
   * @return {string}
   * @private
   */
  function _overviewGoLiveItemEventKey_(item) {
    if (!item) return '';
    if (item.eventKey) return item.eventKey;
    return [
      _normalizeGoLiveAccountKey_(item.accountId, item.accountName),
      _toDateKey_(item.goLiveDate || item.currentMtp || item.targetGoLive || ''),
      item.goLiveType || 'target'
    ].join('|');
  }

  /**
   * Maps a grouped ProductMode go-live event to an Overview widget row shape.
   * @param {Object} r
   * @return {Object}
   * @private
   */
  function _mapProductModeGoLiveEventToOverviewItem_(r) {
    var goLiveDate = r.goLiveDate || r.nextGoLiveDate || r.lastGoLiveDate || '';
    return {
      deploymentId: r.deploymentId || '',
      accountId: r.accountId || '',
      accountName: r.accountName || '',
      goLiveDate: goLiveDate,
      targetGoLive: goLiveDate,
      currentMtp: goLiveDate,
      goLiveType: r.goLiveType || 'target',
      health: r.health || '',
      partner: r.partner || '',
      deploymentName: r.deploymentName || '',
      displayDeploymentName: r.displayDeploymentName || r.displayLabel || r.deploymentName || '',
      displayLabel: r.displayLabel || r.displayDeploymentName || '',
      displayProductFunction: r.displayProductFunction || '',
      productFunctionCount: r.productFunctionCount || 0,
      productAreas: r.productAreas || [],
      functions: r.functions || [],
      productFunctions: r.productFunctions || [],
      eventKey: r.eventKey || '',
      productArea: r.productArea || '',
      funcArea: r.funcArea || ''
    };
  }

  /**
   * Merges two Overview go-live widget rows for the same account/date/type.
   * @param {Object} a
   * @param {Object} b
   * @return {Object}
   * @private
   */
  function _mergeOverviewGoLiveItems_(a, b) {
    var pfMap = {};
    var allPf = (a.productFunctions || []).concat(b.productFunctions || []);
    allPf.forEach(function (pf) {
      var dk = pf.pfRowId ? ('id:' + pf.pfRowId) : [
        pf.parentDeploymentId, pf.productArea, pf.funcArea
      ].join('|');
      pfMap[dk] = pf;
    });
    var mergedPf = Object.keys(pfMap).map(function (k) { return pfMap[k]; });

    var productAreas = [];
    var functions = [];
    var deploymentNames = [];
    mergedPf.forEach(function (d) {
      if (d.productArea && productAreas.indexOf(d.productArea) < 0) productAreas.push(d.productArea);
      if (d.funcArea && functions.indexOf(d.funcArea) < 0) functions.push(d.funcArea);
      if (d.deploymentName && deploymentNames.indexOf(d.deploymentName) < 0) {
        deploymentNames.push(d.deploymentName);
      }
    });
    var labels = _formatGroupedGoLiveDisplayLabels_(deploymentNames, productAreas, functions);
    var health = _rollupGoLiveHealth_([a.health, b.health].concat(
      mergedPf.map(function (pf) { return pf.health; })));

    return {
      deploymentId: a.deploymentId || b.deploymentId || '',
      accountId: a.accountId || b.accountId || '',
      accountName: a.accountName || b.accountName || '',
      goLiveDate: a.goLiveDate || b.goLiveDate || a.currentMtp || b.currentMtp || '',
      targetGoLive: a.targetGoLive || b.targetGoLive || a.goLiveDate || b.goLiveDate || '',
      currentMtp: a.currentMtp || b.currentMtp || a.goLiveDate || b.goLiveDate || '',
      goLiveType: a.goLiveType || b.goLiveType || 'target',
      health: health,
      partner: a.partner || b.partner || '',
      deploymentName: deploymentNames[0] || a.deploymentName || b.deploymentName || '',
      displayDeploymentName: labels.displayDeploymentName,
      displayLabel: labels.displayLabel,
      displayProductFunction: labels.displayProductFunction,
      productFunctionCount: mergedPf.length,
      productAreas: productAreas,
      functions: functions,
      productFunctions: mergedPf,
      eventKey: a.eventKey || b.eventKey || _overviewGoLiveItemEventKey_(a),
      productArea: productAreas.length === 1 ? productAreas[0] : productAreas.join(', '),
      funcArea: functions.length === 1 ? functions[0] : functions.join(', ')
    };
  }

  /**
   * ProductMode-only defensive dedupe for Overview go-live widget rows.
   * @param {Array<Object>} items
   * @return {{ items: Array<Object>, duplicateAccountDateKeysMerged: number }}
   * @private
   */
  function _dedupeProductModeOverviewGoLiveItems_(items) {
    var map = {};
    var order = [];
    var merged = 0;
    (items || []).forEach(function (item) {
      var key = _overviewGoLiveItemEventKey_(item);
      if (!map[key]) {
        map[key] = item;
        order.push(key);
        return;
      }
      merged++;
      map[key] = _mergeOverviewGoLiveItems_(map[key], item);
    });
    return {
      items: order.map(function (k) { return map[k]; }),
      duplicateAccountDateKeysMerged: merged
    };
  }

  /**
   * Sort comparator for Overview Next High Risk rows: date, Red before Yellow, account.
   * @param {Object} a
   * @param {Object} b
   * @return {number}
   * @private
   */
  function _compareOverviewHighRiskEvents_(a, b) {
    var ad = a.goLiveDate || a.currentMtp || '';
    var bd = b.goLiveDate || b.currentMtp || '';
    if (ad < bd) return -1;
    if (ad > bd) return 1;
    var hr = { 'Red': 0, 'Yellow': 1, 'Green': 2 };
    var ah = hr[a.health] !== undefined ? hr[a.health] : 9;
    var bh = hr[b.health] !== undefined ? hr[b.health] : 9;
    if (ah !== bh) return ah - bh;
    return String(a.accountName || '').localeCompare(String(b.accountName || ''));
  }

  /**
   * ProductMode Overview Next High Risk: upcoming PF go-live events, Red/Yellow, account/date grouped.
   * @param {AppConfig} cfg
   * @param {string} todayKey
   * @param {Object=} productOpts
   * @param {number=} limit
   * @return {Array<Object>}
   * @private
   */
  function _buildProductModeOverviewNextHighRisk_(cfg, todayKey, productOpts, limit) {
    limit = (typeof limit === 'number' && limit > 0) ? limit : 5;
    var highRiskEndKey = _addDaysToKey_(todayKey,
      (cfg.salesforce && cfg.salesforce.upcomingWindowDays) || 90);
    var highRiskEvents = getProductModeGoLiveEvents_(cfg, {
      type: 'upcoming',
      startDate: todayKey,
      endDate: highRiskEndKey,
      healthFilter: ['Red', 'Yellow'],
      productOpts: productOpts
    });
    highRiskEvents.sort(_compareOverviewHighRiskEvents_);
    var mapped = highRiskEvents.map(_mapProductModeGoLiveEventToOverviewItem_);
    var deduped = _dedupeProductModeOverviewGoLiveItems_(mapped);
    return deduped.items.slice(0, limit);
  }

  /**
   * Deployment column label for ProductMode PF go-live rows.
   * @param {string} deploymentName
   * @param {string} productArea
   * @param {string} funcArea
   * @return {string}
   * @private
   */
  function _formatProductModeGoLiveDeploymentLabel_(deploymentName, productArea, funcArea) {
    var base = String(deploymentName || '').trim();
    var pa = String(productArea || '').trim();
    var fa = String(funcArea || '').trim();
    if (pa && fa) {
      var suffix = pa + ' / ' + fa;
      if (!base || base.indexOf(suffix) === -1) {
        return (base ? base + ' \u2014 ' : '') + suffix;
      }
      return base;
    }
    if (pa || fa) {
      var partial = _formatProductModeGoLiveProductFunction_(pa, fa);
      if (!base || base.indexOf(partial) === -1) {
        return base ? (base + ' \u2014 ' + partial) : partial;
      }
      return base;
    }
    return base || pa || fa;
  }

  /**
   * Readable widget label for ProductMode PF go-live events.
   * @param {string} accountName
   * @param {string} productArea
   * @param {string} funcArea
   * @param {string} dateKey
   * @return {string}
   * @private
   */
  function _formatProductModeGoLiveDisplayLabel_(accountName, productArea, funcArea, dateKey) {
    var acct = String(accountName || '').trim();
    var pa = String(productArea || '').trim();
    var fa = String(funcArea || '').trim();
    var productFunc = (pa && fa) ? (pa + ' - ' + fa) : (fa || pa);
    var dateLabel = _fmtGoLiveDisplayDate_(dateKey);
    return [acct, productFunc, dateLabel].filter(Boolean).join(' | ');
  }

  /**
   * @param {string} dateKey
   * @return {string}
   * @private
   */
  function _fmtGoLiveDisplayDate_(dateKey) {
    if (!dateKey) return '';
    var d = new Date(dateKey);
    if (isNaN(d.getTime())) return String(dateKey);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy');
  }

  /**
   * Collects PF detail rows for ProductMode go-live grouping (account/date/type).
   * @param {Array<Object>} pfRows
   * @param {AppConfig} cfg
   * @param {string} goLiveType 'actual' | 'target'
   * @param {string} windowStartKey
   * @param {string} windowEndKey
   * @param {Object} goLivesOverrides
   * @return {Array<Object>}
   * @private
   */
  function _collectProductModeGoLivePfDetails_(pfRows, cfg, goLiveType, windowStartKey, windowEndKey, goLivesOverrides) {
    var activeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                        cfg.salesforce.statusValues.active) || 'Active';
    var normalizedType = _normalizeProductModeGoLiveType_(goLiveType) || goLiveType;
    var details = [];
    (pfRows || []).forEach(function (pf) {
      if (!pf || (!pf.deploymentFk && !pf.parentDeploymentId)) return;
      var ov = (goLivesOverrides && goLivesOverrides[pf.accountName]) || {};
      if (ov.exclude) return;

      var dateKey = null;
      if (normalizedType === 'actual') {
        dateKey = _toDateKey_(pf.actualGoLive);
      } else if (normalizedType === 'target') {
        var status = String(pf.overallStatus || '').trim();
        if (status && status !== activeStatus) return;
        dateKey = _toDateKey_(ov.overrideDate || pf.targetGoLive);
      }
      if (!dateKey || !_dateKeyInRange_(dateKey, windowStartKey, windowEndKey)) return;

      details.push(_buildPfGoLiveDetailObject_(pf, normalizedType, dateKey, ov));
    });
    return details;
  }

  /**
   * Diagnostics for ProductMode PF go-live event grain (account + date + type).
   * @param {AppConfig} cfg
   * @param {Object=} productOpts
   * @return {Object}
   * @private
   */
  function _analyzeProductModeGoLiveEvents_(cfg, productOpts) {
    var recentWindowDays = (cfg.salesforce && cfg.salesforce.recentWindowDays) ||
      (cfg.ui && cfg.ui.goLivesTab && cfg.ui.goLivesTab.recentWindowDays) || 60;
    var upcomingWindowDays = (cfg.salesforce && cfg.salesforce.upcomingWindowDays) || 90;
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var recentStartKey = Utilities.formatDate(
      new Date(now.getTime() - recentWindowDays * 24 * 60 * 60 * 1000), tz, 'yyyy-MM-dd');
    var upcomingEndKey = Utilities.formatDate(
      new Date(now.getTime() + upcomingWindowDays * 24 * 60 * 60 * 1000), tz, 'yyyy-MM-dd');

    var pfRows = getProductModeHistoricalPfRows_(cfg, productOpts);
    var goLivesOverrides = getGoLivesOverridesMap_(cfg);
    var recentRaw = _collectProductModeGoLivePfDetails_(
      pfRows, cfg, 'actual', recentStartKey, todayKey, goLivesOverrides);
    var upcomingRaw = _collectProductModeGoLivePfDetails_(
      pfRows, cfg, 'target', todayKey, upcomingEndKey, goLivesOverrides);
    var recentGrouped = _groupProductModeGoLivePfDetails_(recentRaw);
    var upcomingGrouped = _groupProductModeGoLivePfDetails_(upcomingRaw);

    var accountDateGroups = {};
    recentGrouped.events.concat(upcomingGrouped.events).forEach(function (row) {
      var key = row.eventKey || _productModeGoLiveEventKey_(
        row.accountId, row.accountName, row.goLiveDate, row.goLiveType);
      if (!accountDateGroups[key]) accountDateGroups[key] = row;
    });

    var sampleSameAccountDateMultipleFunctions = [];
    var sampleSameAccountDifferentDates = [];
    var accountDateByAccount = {};

    recentGrouped.events.concat(upcomingGrouped.events).forEach(function (row) {
      var acctKey = _normalizeGoLiveAccountKey_(row.accountId, row.accountName);
      if (!accountDateByAccount[acctKey]) accountDateByAccount[acctKey] = [];
      accountDateByAccount[acctKey].push(row);

      if (row.productFunctionCount > 1 && sampleSameAccountDateMultipleFunctions.length < 5) {
        sampleSameAccountDateMultipleFunctions.push({
          accountId: row.accountId,
          accountName: row.accountName,
          goLiveDate: row.goLiveDate,
          goLiveType: row.goLiveType,
          displayLabel: row.displayLabel,
          productFunctionCount: row.productFunctionCount,
          productAreas: row.productAreas,
          functions: row.functions,
          deploymentNames: row.deploymentNames,
          eventKey: row.eventKey,
          productFunctions: (row.productFunctions || []).slice(0, 6).map(function (pf) {
            return {
              pfRowId: pf.pfRowId,
              parentDeploymentId: pf.parentDeploymentId,
              productArea: pf.productArea,
              funcArea: pf.funcArea
            };
          })
        });
      }
    });

    Object.keys(accountDateByAccount).forEach(function (acctKey) {
      if (sampleSameAccountDifferentDates.length >= 5) return;
      var rows = accountDateByAccount[acctKey];
      var dates = {};
      rows.forEach(function (r) { dates[r.goLiveDate + '|' + r.goLiveType] = true; });
      if (Object.keys(dates).length > 1) {
        sampleSameAccountDifferentDates.push({
          accountId: rows[0].accountId,
          accountName: rows[0].accountName,
          eventCount: rows.length,
          events: rows.slice(0, 5).map(function (r) {
            return {
              goLiveDate: r.goLiveDate,
              goLiveType: r.goLiveType,
              productFunctionCount: r.productFunctionCount,
              eventKey: r.eventKey
            };
          })
        });
      }
    });

    return {
      recentGoLiveRawPfRowCount: recentRaw.length,
      recentGoLiveGroupedEventCount: recentGrouped.groupedEventCount,
      recentGoLiveRawRowsCollapsed: recentGrouped.rawRowsCollapsed,
      recentGoLiveRawRowsGroupedIntoEvents: recentGrouped.rawRowsGroupedIntoEvents,
      recentGoLiveMaxProductFunctionsPerEvent: recentGrouped.maxProductFunctionsPerEvent,
      upcomingGoLiveRawPfRowCount: upcomingRaw.length,
      upcomingGoLiveGroupedEventCount: upcomingGrouped.groupedEventCount,
      upcomingGoLiveRawRowsCollapsed: upcomingGrouped.rawRowsCollapsed,
      upcomingGoLiveRawRowsGroupedIntoEvents: upcomingGrouped.rawRowsGroupedIntoEvents,
      upcomingGoLiveMaxProductFunctionsPerEvent: upcomingGrouped.maxProductFunctionsPerEvent,
      sampleSameAccountDateMultipleFunctions: sampleSameAccountDateMultipleFunctions,
      sampleSameAccountDifferentDates: sampleSameAccountDifferentDates
    };
  }

  /**
   * Canonical ProductMode PF go-live event builder used by Overview, Go Lives, and report.
   * @param {AppConfig} cfg
   * @param {Object=} options
   * @return {Array<Object>}
   * @private
   */
  function getProductModeGoLiveEvents_(cfg, options) {
    options = options || {};
    var goLiveType = _normalizeProductModeGoLiveType_(options.type || 'recent') || 'actual';

    var tz = Session.getScriptTimeZone();
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var windowStartKey = options.startDate ? _toDateKey_(options.startDate) : '';
    var windowEndKey = options.endDate ? _toDateKey_(options.endDate) : '';

    if (!windowStartKey || !windowEndKey) {
      if (goLiveType === 'actual') {
        var recentDays = (typeof options.windowDaysOverride === 'number' && options.windowDaysOverride > 0)
          ? options.windowDaysOverride
          : (cfg.salesforce && cfg.salesforce.recentWindowDays) ||
            (cfg.ui && cfg.ui.goLivesTab && cfg.ui.goLivesTab.recentWindowDays) || 60;
        windowEndKey = todayKey;
        windowStartKey = Utilities.formatDate(
          new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000), tz, 'yyyy-MM-dd');
      } else {
        var upcomingDays = (cfg.salesforce && cfg.salesforce.upcomingWindowDays) || 90;
        windowStartKey = todayKey;
        windowEndKey = Utilities.formatDate(
          new Date(now.getTime() + upcomingDays * 24 * 60 * 60 * 1000), tz, 'yyyy-MM-dd');
      }
    }

    var pfRows = getProductModeHistoricalPfRows_(cfg, options.productOpts);
    var goLivesOverrides = getGoLivesOverridesMap_(cfg);
    var rawDetails = _collectProductModeGoLivePfDetails_(
      pfRows, cfg, goLiveType, windowStartKey, windowEndKey, goLivesOverrides);
    var grouped = _groupProductModeGoLivePfDetails_(rawDetails);
    var results = grouped.events;

    if (Array.isArray(options.healthFilter) && options.healthFilter.length) {
      results = results.filter(function (row) {
        return options.healthFilter.indexOf(row.health) >= 0;
      });
    }

    results.sort(function (a, b) {
      var ad = a.goLiveDate || a.lastGoLiveDate || a.nextGoLiveDate || '';
      var bd = b.goLiveDate || b.lastGoLiveDate || b.nextGoLiveDate || '';
      if (ad < bd) return -1;
      if (ad > bd) return 1;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });

    if (typeof options.limit === 'number' && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    Logger.log('CoreData.getProductModeGoLiveEvents_: ' + results.length +
               ' grouped events (' + rawDetails.length + ' raw PF rows, ' +
               grouped.rawRowsGroupedIntoEvents + ' PF rows collapsed into account/date events) type=' +
               goLiveType);
    return results;
  }

  /**
   * Diagnostics for ProductMode PF go-live event grain.
   * @param {AppConfig} config
   * @param {Object=} productOpts
   * @return {Object}
   */
  function _debugProductModeGoLiveEvents(config, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var pa = (productOpts && productOpts.product) || 'all';
    var analysis = _analyzeProductModeGoLiveEvents_(cfg, { product: pa });
    var recentSample = getProductModeGoLiveEvents_(cfg, {
      type: 'recent', productOpts: { product: pa }, limit: 10
    });
    var upcomingSample = getProductModeGoLiveEvents_(cfg, {
      type: 'upcoming', productOpts: { product: pa }, limit: 10
    });

    var mapSample = function (r) {
      return {
        accountId: r.accountId,
        accountName: r.accountName,
        goLiveDate: r.goLiveDate,
        goLiveType: r.goLiveType,
        displayLabel: r.displayLabel,
        productFunctionCount: r.productFunctionCount,
        productAreas: r.productAreas,
        functions: r.functions,
        deploymentNames: r.deploymentNames,
        eventKey: r.eventKey
      };
    };

    var report = {
      appId: cfg.appId || '',
      productModeSourceMode: _getProductModeSourceMode_(cfg),
      productModeDisplayGrain: _getProductModeDisplayGrain_(cfg),
      productModeCountGrain: _getProductModeCountGrain_(cfg),
      productModeGoLiveGrain: _getProductModeGoLiveGrain_(cfg),
      productModeGoLiveHelperUsed: true,
      analysis: analysis,
      sampleRecentEvents: recentSample.map(mapSample),
      sampleUpcomingEvents: upcomingSample.map(mapSample)
    };

    Logger.log('=== _debugProductModeGoLiveEvents(' + (cfg.appId || '?') + ') ===');
    Logger.log('  report=' + JSON.stringify(report));
    return report;
  }

  /**
   * ProductMode recent go-lives from PF rows (Active + Complete).
   * One event row per account + actualGoLive date (product/functions attached as detail).
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {number=} windowDaysOverride
   * @param {Object=} productOpts
   * @return {Array<Object>}
   * @private
   */
  function getRecentGoLivesFromProductFunctions_(cfg, viewModeOpts, windowDaysOverride, productOpts) {
    var results = getProductModeGoLiveEvents_(cfg, {
      type: 'recent',
      windowDaysOverride: windowDaysOverride,
      productOpts: productOpts
    });
    results = filterDeploymentsByStudent_(results, 'exclude', cfg);
    results = _enrichGoLiveRowsWithOverrides_(
      results,
      getDeploymentOverridesMap_(cfg),
      getGoLivesOverridesMap_(cfg)
    );
    return applyViewModeFilter_(cfg, results, viewModeOpts);
  }

  /**
   * ProductMode upcoming go-lives from PF rows (Active).
   * One event row per account + targetGoLive date (product/functions attached as detail).
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Array<Object>}
   * @private
   */
  function getUpcomingGoLivesFromProductFunctions_(cfg, viewModeOpts, productOpts) {
    var results = getProductModeGoLiveEvents_(cfg, {
      type: 'upcoming',
      productOpts: productOpts
    });
    results = filterDeploymentsByStudent_(results, 'exclude', cfg);
    results = _enrichGoLiveRowsWithOverrides_(
      results,
      getDeploymentOverridesMap_(cfg),
      getGoLivesOverridesMap_(cfg)
    );
    return applyViewModeFilter_(cfg, results, viewModeOpts);
  }

// ===========================================================================
// N1.1: RECENT GO-LIVES FOR NOTABLE PICKER (Actual dates + past-MTP fallback)
// ===========================================================================
/**
 * Picker-only variant of getRecentGoLives. Returns confirmed recent go-lives
 * (from getRecentGoLives, Actual-date driven) PLUS deployments whose
 * Current_MTP_Date is in the past and within the lookback window but have no
 * confirmed Actual date yet.
 *
 * Rationale (N1.1): an Engagement Manager may not have set the Actual go-live
 * date in the source system yet, but the deployment is still a valid Notable
 * candidate. Used ONLY by the Notable add picker — does NOT change
 * getRecentGoLives, so the Go Lives tab, monthly report, Portfolio Health, and
 * Trends are unaffected.
 *
 * Confirmed Actual-date rows always win over an MTP-based candidate (dedup by
 * full deploymentId). MTP-based candidates carry
 * dateSource:'Current MTP (not confirmed actual)'.
 *
 * NOTE: the effective view's mtpDate is frequently a Date.toString() rendering
 * (e.g. "Mon Jul 06 2026 00:00:00 GMT-0400 ..."), NOT ISO. slice(0,10) is
 * therefore unsafe; _toKey_() normalizes any date-ish value to 'YYYY-MM-DD'.
 *
 * @param {AppConfig} config
 * @param {Object=} viewModeOpts
 * @param {number=} lookbackDays Positive window override; defaults to
 *                               cfg.notable.pickerLookbackDays (180).
 * @return {Array<Object>}
 */
function getRecentGoLivesForNotablePicker(config, viewModeOpts, lookbackDays) {
  var cfg = CoreConfig.withDefaults(config);
  var windowDays = (typeof lookbackDays === 'number' && lookbackDays > 0)
    ? lookbackDays
    : ((cfg.notable && cfg.notable.pickerLookbackDays) || 180);

  var tz = Session.getScriptTimeZone();
  var now = new Date(); now.setHours(0, 0, 0, 0);
  var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  var windowStartKey = Utilities.formatDate(windowStart, tz, 'yyyy-MM-dd');

  // Normalize any date-ish value (Date object, Date.toString(), ISO, or locale
  // string) to 'YYYY-MM-DD'. Returns '' on empty/invalid input.
  function _toKey_(v) {
    if (!v) return '';
    var d = (v instanceof Date) ? v : new Date(String(v));
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }

  // 1) Confirmed recent go-lives (Actual dates). Unchanged behavior, widened
  //    window. These already carry recentDates[] + lastGoLiveDate.
  var confirmed = getRecentGoLives(cfg, viewModeOpts, windowDays) || [];

  var seen = {};
  confirmed.forEach(function (r) {
    if (r && r.deploymentId) seen[r.deploymentId] = true;
    r.dateSource = 'Actual';
  });

  // 2) Past-MTP fallback: deployments with a past Current MTP in-window and NOT
  //    already present via a confirmed Actual date.
  var effective = [];
  try {
    effective = getAllEffectiveDeployments(cfg) || [];
  } catch (err) {
    Logger.log('CoreData.getRecentGoLivesForNotablePicker: ' +
      'getAllEffectiveDeployments failed: ' + err);
    effective = [];
  }

  var goLivesOverrides = getGoLivesOverridesMap_(cfg);
  var fallbackRows = [];

  effective.forEach(function (dep) {
    if (!dep || !dep.deploymentId) return;
    if (seen[dep.deploymentId]) return;          // confirmed Actual already covers it

    var ov = goLivesOverrides[dep.accountName] || {};
    if (ov.exclude) return;

    var mtpKey = ov.overrideDate ? _toKey_(ov.overrideDate) : _toKey_(dep.mtpDate);
    if (!mtpKey) return;
    if (mtpKey < windowStartKey || mtpKey > todayKey) return;  // past + in-window only

    seen[dep.deploymentId] = true;
    fallbackRows.push({
      deploymentId: dep.deploymentId,
      accountId: dep.accountId,
      accountName: dep.accountName,
      deploymentName: dep.deploymentName,
      partner: ov.overridePartner || dep.partner,
      industry: dep.industry,
      status: dep.overallStatus || dep.status || '',
      recentDates: [{ date: mtpKey, products: [] }],
      lastGoLiveDate: mtpKey,
      dateSource: 'Current MTP (not confirmed actual)'
    });
  });

  var combined = confirmed.concat(fallbackRows);
  combined.sort(function (a, b) {
    if (a.lastGoLiveDate < b.lastGoLiveDate) return -1;
    if (a.lastGoLiveDate > b.lastGoLiveDate) return 1;
    return String(a.accountName || '').localeCompare(String(b.accountName || ''));
  });

  Logger.log('CoreData.getRecentGoLivesForNotablePicker: ' + confirmed.length +
    ' confirmed + ' + fallbackRows.length + ' past-MTP fallback = ' +
    combined.length + ' (window ' + windowDays + 'd).');

  return applyViewModeFilter_(cfg, combined, viewModeOpts);
}

    // ===========================================================================
  // PUBLIC: META & OVERRIDES UPDATES (Phase 2 — wrapped with audit writes)
  // ===========================================================================

  /**
   * Update or insert meta data for a deployment in DeploymentsMeta.
   * Meta data is separate from overrides — no audit write here (audit log
   * is for overrides only; meta changes are tracked via LastEditedBy/At
   * columns on the meta sheet itself).
   */
  function updateDeploymentMeta(config, deploymentId, metaData) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    if (!deploymentId) throw new Error('updateDeploymentMeta: deploymentId is required');

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentsMeta);
    if (!sheet) {
      throw new Error('DeploymentsMeta sheet not found: ' + cfg.sheets.deploymentsMeta);
    }

    var targetId = String(deploymentId).trim();
    var lastRow = sheet.getLastRow();
    var rowIndex = -1;

    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) {
        return String(r[0] || '').trim();
      });
      var idx = ids.indexOf(targetId);
      if (idx >= 0) rowIndex = 2 + idx;
    }

    if (rowIndex === -1) {
      rowIndex = lastRow >= 1 ? lastRow + 1 : 2;
      sheet.getRange(rowIndex, 1).setValue(targetId);
    }

    var user = getCurrentUserEmail_();
    var now = new Date();

    if (metaData && metaData.deliveryDirector !== undefined) {
      sheet.getRange(rowIndex, 2).setValue(metaData.deliveryDirector);
    }
    if (metaData && metaData.ddNotes !== undefined) {
      sheet.getRange(rowIndex, 3).setValue(metaData.ddNotes);
    }
    sheet.getRange(rowIndex, 4).setValue(user);
    sheet.getRange(rowIndex, 5).setValue(now);

    _clearCache(cfg);
    return { success: true };
  }

  /**
   * Update or insert a deployment override in DeploymentOverrides.
   * Phase 2: writes an OverrideAudit row capturing before/after state.
   * Phase 3d: accepts optional notes (override reason) forwarded to the audit row.
   */
  function updateDeploymentOverride(config, deploymentId, overrideData, notes) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    if (!deploymentId) throw new Error('deploymentId required');

    var canonicalId = _resolveCanonicalDeploymentId_(cfg, deploymentId);

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentOverrides);
    if (!sheet) throw new Error('DeploymentOverrides sheet not found: ' + cfg.sheets.deploymentOverrides);

    var headers = _ensureSheetHeaders_(sheet, _DEPLOYMENT_OVERRIDE_HEADERS_);

    // Capture before-snapshot for audit
    var before = snapshotDeploymentOverride_(cfg, canonicalId);
    var accountName = lookupAccountForDeployment_(cfg, canonicalId);

    var values = sheet.getDataRange().getValues();
    var rowIndex = -1;
    var targetPrefix = String(deploymentId).trim();
    targetPrefix = targetPrefix.length >= 15 ? targetPrefix.slice(0, 15) : targetPrefix;
    if (values.length > 1) {
      for (var ri = 1; ri < values.length; ri++) {
        var rowId = String(values[ri][0] || '').trim();
        if (!rowId) continue;
        var rowPrefix = rowId.length >= 15 ? rowId.slice(0, 15) : rowId;
        if (rowId === String(deploymentId).trim() || rowPrefix === targetPrefix) {
          rowIndex = ri + 1;
          break;
        }
      }
    }
    if (rowIndex === -1) {
      var lastRow = sheet.getLastRow();
      rowIndex = (lastRow >= 1) ? lastRow + 1 : 2;
      sheet.getRange(rowIndex, 1).setValue(canonicalId);
    } else {
      sheet.getRange(rowIndex, 1).setValue(canonicalId);
    }

    var setCell = function (header, value) {
      var col = headers.indexOf(header);
      if (col < 0 || value === undefined) return;
      if (header === 'Exclude_From_Report') {
        sheet.getRange(rowIndex, col + 1).setValue(!!value);
        return;
      }
      sheet.getRange(rowIndex, col + 1).setValue(value);
    };

    setCell('Override_Health', overrideData.overrideHealth);
    setCell('Override_MTPDate', overrideData.overrideMtpDate ? new Date(overrideData.overrideMtpDate) : '');
    setCell('Override_Stage', overrideData.overrideStage);
    setCell('Override_Account', overrideData.overrideAccount);
    setCell('Override_Deployment', overrideData.overrideDeployment);
    setCell('Override_CurrentUpdate', overrideData.overrideCurrentUpdate);
    setCell('Exclude_From_Report', overrideData.excludeFromReport);
    // Phase 2: classification
    if (overrideData.classification !== undefined) {
      setCell('Classification', normalizeClassification_(overrideData.classification));
    }

    var user = getCurrentUserEmail_();
    setCell('LastEditedBy', user);
    setCell('LastEditedAt', new Date());

    // Capture after-snapshot and write audit row
    var after = snapshotDeploymentOverride_(cfg, canonicalId);
    var changed = diffSnapshotFields_(before, after);
    writeAuditRow_(cfg, {
      action:           before.isEmpty ? 'CREATE' : 'UPDATE',
      overrideType:     'deployment',
      deploymentId:     canonicalId,
      accountName:      accountName,
      fieldsAffected:   changed,
      oldValueSnapshot: JSON.stringify(before),
      newValueSnapshot: JSON.stringify(after),
      notes:            String(notes || '')   // Phase 3d
    });

    _clearCache(cfg);
    return { success: true };
  }

  /**
   * Phase 3d: accepts an optional notes (override reason) string and threads
   * it through to writeAuditRow_.
   */
  function updateDeploymentWithMetaAndOverride(config, deploymentId, metaData, overrideData, notes) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    updateDeploymentMeta(config, deploymentId, metaData);
    updateDeploymentOverride(config, deploymentId, overrideData, notes);
    return { success: true };
  }

  /**
   * Update or insert a Go Lives override row (keyed by AccountName).
   * Phase 2: writes audit row.
   * Phase 3d: accepts optional notes (override reason) forwarded to the audit row.
   */
  function updateGoLivesOverride(config, accountName, overrideData, notes) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    if (!accountName) throw new Error('accountName required');

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.goLivesOverrides);
    if (!sheet) throw new Error('GoLivesOverrides sheet not found: ' + cfg.sheets.goLivesOverrides);

    var headers = _ensureSheetHeaders_(sheet, _GOLIVES_OVERRIDE_HEADERS_);

    var before = snapshotGoLivesOverride_(cfg, accountName);

    var values = sheet.getDataRange().getValues();
    var rowIndex = -1;
    if (values.length > 1) {
      var accts = values.slice(1).map(function (r) { return String(r[0] || '').trim(); });
      var idx = accts.indexOf(String(accountName).trim());
      if (idx >= 0) rowIndex = idx + 2;
    }
    if (rowIndex === -1) {
      var lastRow = sheet.getLastRow();
      rowIndex = (lastRow >= 1) ? lastRow + 1 : 2;
      sheet.getRange(rowIndex, 1).setValue(accountName);
    }

    var setCell = function (header, value) {
      var col = headers.indexOf(header);
      if (col < 0 || value === undefined) return;
      if (header === 'Exclude_From_Report') {
        sheet.getRange(rowIndex, col + 1).setValue(!!value);
        return;
      }
      sheet.getRange(rowIndex, col + 1).setValue(value);
    };

    setCell('Override_GoLiveDate', overrideData.overrideDate ? new Date(overrideData.overrideDate) : '');
    setCell('Override_Partner', overrideData.overridePartner);
    setCell('Exclude_From_Report', overrideData.excludeFromReport);
    if (overrideData.classification !== undefined) {
      setCell('Classification', normalizeClassification_(overrideData.classification));
    }

    var user = getCurrentUserEmail_();
    setCell('LastEditedBy', user);
    setCell('LastEditedAt', new Date());

    var after = snapshotGoLivesOverride_(cfg, accountName);
    var changed = diffSnapshotFields_(before, after);
    writeAuditRow_(cfg, {
      action:           before.isEmpty ? 'CREATE' : 'UPDATE',
      overrideType:     'golives',
      deploymentId:     accountName,
      accountName:      accountName,
      fieldsAffected:   changed,
      oldValueSnapshot: JSON.stringify(before),
      newValueSnapshot: JSON.stringify(after),
      notes:            String(notes || '')   // Phase 3d
    });

    _clearCache(cfg);
    return { success: true };
  }

  // ===========================================================================
  // PHASE 2: MANAGE OVERRIDES ENDPOINTS
  // ===========================================================================

  /**
   * Returns a unified list of all active overrides from DeploymentOverrides
   * and GoLivesOverrides. One row per override (not per source row).
   * Honors viewMode personalization filtering.
   *
   * Shape:
   *   {
   *     type: 'deployment' | 'golives',
   *     accountName: string,
   *     deploymentId: string,  // for deployment; accountName for golives
   *     fieldsSet: Array<string>,  // names of override fields that are non-empty
   *     currentValues: Object,  // the override values
   *     setBy: string,
   *     setAt: string (ISO),
   *     classification: 'Monthly' | 'Structural'
   *   }
   */
  function getAllActiveOverrides(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var out = [];

    var depMap = getDeploymentOverridesMap_(cfg);
    Object.keys(depMap).forEach(function (id) {
      var row = depMap[id];
      var fieldsSet = [];
      if (row.overrideHealth)        fieldsSet.push('Override_Health');
      if (row.overrideMtp)           fieldsSet.push('Override_MTPDate');
      if (row.overrideStage)         fieldsSet.push('Override_Stage');
      if (row.overrideAccount)       fieldsSet.push('Override_Account');
      if (row.overrideName)          fieldsSet.push('Override_Deployment');
      if (row.overrideCurrentUpdate) fieldsSet.push('Override_CurrentUpdate');
      if (row.exclude)               fieldsSet.push('Exclude_From_Report');
      if (fieldsSet.length === 0) return;

      out.push({
        type:           'deployment',
        accountName:    lookupAccountForDeployment_(cfg, id),
        deploymentId:   id,
        fieldsSet:      fieldsSet,
        currentValues: {
          health:            row.overrideHealth || '',
          mtpDate:           row.overrideMtp ? CoreUtils.formatDateToIsoString(row.overrideMtp) : '',
          stage:             row.overrideStage || '',
          account:           row.overrideAccount || '',
          deployment:        row.overrideName || '',
          currentUpdate:     row.overrideCurrentUpdate || '',
          excludeFromReport: !!row.exclude
        },
        setBy:          row.lastEditedBy || '',
        setAt:          row.lastEditedAt || '',
        classification: row.classification || 'Monthly'
      });
    });

    var golivesMap = getGoLivesOverridesMap_(cfg);
    Object.keys(golivesMap).forEach(function (acct) {
      var row = golivesMap[acct];
      var fieldsSet = [];
      if (row.overrideDate)    fieldsSet.push('Override_GoLiveDate');
      if (row.overridePartner) fieldsSet.push('Override_Partner');
      if (row.exclude)         fieldsSet.push('Exclude_From_Report');
      if (fieldsSet.length === 0) return;

      out.push({
        type:           'golives',
        accountName:    acct,
        deploymentId:   acct,
        fieldsSet:      fieldsSet,
        currentValues: {
          goLiveDate:        row.overrideDate ? CoreUtils.formatDateToIsoString(row.overrideDate) : '',
          partner:           row.overridePartner || '',
          excludeFromReport: !!row.exclude
        },
        setBy:          row.lastEditedBy || '',
        setAt:          row.lastEditedAt || '',
        classification: row.classification || 'Monthly'
      });
    });

    // Sort by setAt (most recent first)
    out.sort(function (a, b) {
      var ta = a.setAt ? new Date(a.setAt).getTime() : 0;
      var tb = b.setAt ? new Date(b.setAt).getTime() : 0;
      return tb - ta;
    });

    return applyViewModeFilter_(cfg, out, viewModeOpts);
  }

  /**
   * Returns OverrideAudit rows.
   *
   * @param {AppConfig} config
   * @param {Object=} opts  Optional. { sinceDays?: number, limit?: number }
   *   sinceDays — only rows with Timestamp >= now minus this many days
   *   limit — return at most this many rows (most recent first)
   * @return {Array<Object>}
   */
  function getOverrideAuditLog(config, opts) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName('OverrideAudit');
    if (!sheet) return [];

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    var sinceDays = (opts && opts.sinceDays) || 0;
    var limit = (opts && opts.limit) || 0;

    var cutoff = null;
    if (sinceDays > 0) {
      cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    }

    var rows = values
      .map(function (row) {
        var ts = row[0];
        var dateObj = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(dateObj.getTime())) return null;
        return {
          timestamp:        CoreUtils.formatDateToIsoString(dateObj),
          timestampMs:      dateObj.getTime(),
          user:             String(row[1] || ''),
          action:           String(row[2] || ''),
          overrideType:     String(row[3] || ''),
          deploymentId:     String(row[4] || ''),
          accountName:      String(row[5] || ''),
          fieldsAffected:   String(row[6] || ''),
          oldValueSnapshot: String(row[7] || ''),
          newValueSnapshot: String(row[8] || ''),
          notes:            String(row[9] || '')
        };
      })
      .filter(function (r) { return r !== null; })
      .filter(function (r) {
        if (!cutoff) return true;
        return r.timestampMs >= cutoff.getTime();
      });

    rows.sort(function (a, b) { return b.timestampMs - a.timestampMs; });

    if (limit > 0 && rows.length > limit) {
      rows = rows.slice(0, limit);
    }

    return rows;
  }

  /**
   * Flip the Classification of a single override row. Used by the Manage
   * Overrides tab to promote/demote individual overrides without going
   * through the full edit modal.
   *
   * PM-only — non-PM callers get rejected.
   */
  function setOverrideClassification(config, type, idOrAccount, classification) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    requirePm_(cfg, 'setOverrideClassification');

    var newClassification = normalizeClassification_(classification);
    var ss = getSpreadsheet_();
    var sheetName = type === 'deployment' ? cfg.sheets.deploymentOverrides : cfg.sheets.goLivesOverrides;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet not found: ' + sheetName);

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { success: false, message: 'No rows in override sheet' };

    var headers = values[0];
    var idxKey   = headers.indexOf(type === 'deployment' ? 'DeploymentID' : 'AccountName');
    var idxClass = headers.indexOf('Classification');
    var idxUser  = headers.indexOf('LastEditedBy');
    var idxTime  = headers.indexOf('LastEditedAt');

    if (idxKey < 0 || idxClass < 0) {
      throw new Error('Required columns not found on ' + sheetName);
    }

    var target = String(idOrAccount).trim();
    var rowIndex = -1;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][idxKey] || '').trim() === target) {
        rowIndex = r + 1;
        break;
      }
    }
    if (rowIndex < 0) {
      return { success: false, message: 'Override row not found for: ' + target };
    }

    // Capture before/after for audit
    var before = type === 'deployment'
      ? snapshotDeploymentOverride_(cfg, target)
      : snapshotGoLivesOverride_(cfg, target);

    sheet.getRange(rowIndex, idxClass + 1).setValue(newClassification);
    if (idxUser >= 0) sheet.getRange(rowIndex, idxUser + 1).setValue(getCurrentUserEmail_());
    if (idxTime >= 0) sheet.getRange(rowIndex, idxTime + 1).setValue(new Date());

    var after = type === 'deployment'
      ? snapshotDeploymentOverride_(cfg, target)
      : snapshotGoLivesOverride_(cfg, target);

    var accountName = type === 'deployment' ? lookupAccountForDeployment_(cfg, target) : target;

    writeAuditRow_(cfg, {
      action:           'UPDATE',
      overrideType:     type,
      deploymentId:     target,
      accountName:      accountName,
      fieldsAffected:   ['Classification'],
      oldValueSnapshot: JSON.stringify(before),
      newValueSnapshot: JSON.stringify(after)
    });

    _clearCache(cfg);
    return { success: true };
  }

  /**
   * Clears all overrides classified as 'Monthly' whose LastEditedAt falls
   * within the supplied yearMonth (or current calendar month if omitted).
   * Structural overrides are not affected.
   *
   * PM-only.
   *
   * @param {AppConfig} config
   * @param {Object=} opts  { yearMonth?: 'YYYY-MM' }
   * @return {{ success:boolean, cleared:number, deploymentCount:number, golivesCount:number }}
   */
  function bulkClearMonthlyOverrides(config, opts) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    requirePm_(cfg, 'bulkClearMonthlyOverrides');

    var yearMonth = (opts && opts.yearMonth) || formatYearMonth_(new Date());
    var ym = String(yearMonth);  // 'YYYY-MM'

    var depCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.deploymentOverrides,
      'deployment',
      function (row, headers) {
        var idxClass = headers.indexOf('Classification');
        var idxTime  = headers.indexOf('LastEditedAt');
        if (idxClass < 0 || idxTime < 0) return false;
        var classification = normalizeClassification_(row[idxClass]);
        if (classification !== 'Monthly') return false;
        var ts = row[idxTime];
        if (!ts) return false;
        var d = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(d.getTime())) return false;
        return formatYearMonth_(d) === ym;
      }
    );

    var golivesCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.goLivesOverrides,
      'golives',
      function (row, headers) {
        var idxClass = headers.indexOf('Classification');
        var idxTime  = headers.indexOf('LastEditedAt');
        if (idxClass < 0 || idxTime < 0) return false;
        var classification = normalizeClassification_(row[idxClass]);
        if (classification !== 'Monthly') return false;
        var ts = row[idxTime];
        if (!ts) return false;
        var d = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(d.getTime())) return false;
        return formatYearMonth_(d) === ym;
      }
    );

    _clearCache(cfg);
    return {
      success:         true,
      cleared:         depCleared + golivesCleared,
      deploymentCount: depCleared,
      golivesCount:    golivesCleared
    };
  }

  /**
   * Clears EVERY override on both sheets, regardless of classification or date.
   * Each cleared row writes a BULK_CLEAR audit entry.
   *
   * PM-only.
   *
   * @param {AppConfig} config
   * @return {{ success:boolean, cleared:number, deploymentCount:number, golivesCount:number }}
   */
  function bulkClearAllOverrides(config) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    requirePm_(cfg, 'bulkClearAllOverrides');

    var depCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.deploymentOverrides,
      'deployment',
      function () { return true; }
    );

    var golivesCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.goLivesOverrides,
      'golives',
      function () { return true; }
    );

    _clearCache(cfg);
    return {
      success:         true,
      cleared:         depCleared + golivesCleared,
      deploymentCount: depCleared,
      golivesCount:    golivesCleared
    };
  }

  // ===========================================================================
  // INTERNAL: BULK CLEAR HELPERS
  // ===========================================================================

  /**
   * Walks the override sheet bottom-to-top, deletes rows where predicate(row,
   * headers) returns true, and writes a BULK_CLEAR audit row per deletion.
   * Bottom-to-top iteration so row indices don't shift mid-loop.
   *
   * @private
   */
  function clearOverrideRowsByPredicate_(cfg, sheetName, overrideType, predicate) {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return 0;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;

    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idxKey = headers.indexOf(overrideType === 'deployment' ? 'DeploymentID' : 'AccountName');
    if (idxKey < 0) {
      Logger.log('clearOverrideRowsByPredicate_: key column not found in ' + sheetName);
      return 0;
    }

    var cleared = 0;
    // Iterate bottom-to-top so row deletion doesn't shift downstream indices.
    for (var r = values.length - 1; r >= 1; r--) {
      var row = values[r];
      if (!predicate(row, headers)) continue;

      var keyValue = String(row[idxKey] || '').trim();
      if (!keyValue) continue;

      // Capture snapshot before delete for audit
      var before = overrideType === 'deployment'
        ? snapshotDeploymentOverride_(cfg, keyValue)
        : snapshotGoLivesOverride_(cfg, keyValue);

      var accountName = overrideType === 'deployment'
        ? lookupAccountForDeployment_(cfg, keyValue)
        : keyValue;

      // Delete the row (1-based row index in the sheet = r + 1)
      sheet.deleteRow(r + 1);

      writeAuditRow_(cfg, {
        action:           'BULK_CLEAR',
        overrideType:     overrideType,
        deploymentId:     keyValue,
        accountName:      accountName,
        fieldsAffected:   ['*'],
        oldValueSnapshot: JSON.stringify(before),
        newValueSnapshot: JSON.stringify({ isEmpty: true })
      });

      cleared++;
    }

    return cleared;
  }

  /**
   * Format a Date as 'YYYY-MM'.
   * @private
   */
  function formatYearMonth_(date) {
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  /**
   * Enforces PM-only access. Throws on non-PM callers.
   * @private
   */
  function requirePm_(cfg, fnName) {
    var me = CoreUsers.getCurrentUser(cfg);
    if (!me || !me.isAdmin) {
      throw new Error(fnName + ': PM role required. Current user: ' +
        (me ? (me.email || 'unknown') : 'anonymous'));
    }
  }

  // ===========================================================================
  // PHASE 3f: INLINE AUDIT SUMMARY
  // ===========================================================================

  /**
   * Returns the last N audit events for a specific deployment ID.
   * Used by the expanded row detail to show an inline "Recent Activity" summary.
   * Visible to all roles (no PM gate).
   *
   * @param {AppConfig} config
   * @param {string}    deploymentId  Salesforce deployment ID or accountName
   * @param {number=}   limit         Max rows to return. Default 3.
   * @return {Array<Object>}
   */
  function getDeploymentAuditSummary(config, deploymentId, limit) {
    var cfg     = CoreConfig.withDefaults(config);
    var maxRows = (typeof limit === 'number' && limit > 0) ? limit : 3;
    var targetId = String(deploymentId || '').trim();
    if (!targetId) return [];

    var allAudit = getOverrideAuditLog(cfg, { sinceDays: 0, limit: 0 });
    var filtered = allAudit.filter(function (row) {
      return row.deploymentId === targetId || row.accountName === targetId;
    });

    // getOverrideAuditLog already returns newest-first
    return filtered.slice(0, maxRows);
  }

  // ===========================================================================
  // MGM / PGL: SFDC_DeploymentProductFunctions RAW READER
  // ===========================================================================

  /**
   * Strips outer braces from a Salesforce object-like connector export string.
   * @param {any} raw
   * @return {string}
   * @private
   */
  function _stripSfdcObjectWrapper_(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') {
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  /**
   * Parses a single field from a Salesforce object-like connector export string.
   * Handles blank values, nested attributes={...}, and keys in any order.
   * @param {any} raw
   * @param {string} fieldName
   * @return {string}
   * @private
   */
  function _parseSfdcObjectField_(raw, fieldName) {
    var s = _stripSfdcObjectWrapper_(raw);
    if (!s) return '';
    if (s.indexOf('=') < 0) return s;

    var target = String(fieldName || '').trim();
    if (!target) return '';

    // Remove nested attributes blocks so commas inside do not break field parsing.
    var scan = s.replace(/attributes=\{[^}]*\}/gi, '')
      .replace(/,\s*,+/g, ',')
      .replace(/,\s*$/g, '');

    var escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp(
      '(?:^|,\\s*)' + escaped + '=(.*?)(?=,\\s*[A-Za-z_][\\w.]*=|$)', 'i'
    );
    var m = scan.match(re);
    if (!m) {
      m = scan.match(new RegExp('(?:^|,\\s*)' + escaped + '=([^,}]+)', 'i'));
    }
    if (!m) return '';
    return String(m[1] || '').trim();
  }

  /**
   * Extracts Account Id from a Customer__r object export via attributes.url fallback.
   * @param {any} raw
   * @return {string}
   * @private
   */
  function _parseSfdcAccountIdFromCustomerObject_(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var fromId = _parseSfdcObjectField_(s, 'Id');
    if (fromId) return fromId;
    var m = s.match(/\/sobjects\/Account\/([a-zA-Z0-9]{15,18})/i);
    return m ? m[1] : '';
  }

  /**
   * Recommended PF sheet headers for ProductMode union diagnostics.
   * @type {Array<string>}
   * @private
   */
  var _PF_RECOMMENDED_HEADERS_ = [
    'Id',
    'Deployment__c',
    'Deployment__r.Id',
    'Deployment__r.Name',
    'Deployment__r.Customer__c',
    'Deployment__r.Customer__r.Name',
    'Deployment__r.Customer__r.Industry',
    'Deployment__r.Customer__r.PS_Region_New__c',
    'Deployment__r.Customer__r.PS_Sub_Region__c',
    'Deployment__r.Customer__r.SubRegion__c',
    'Deployment__r.Deployment_Start_Date__c',
    'Deployment__r.Current_MTP_Date__c',
    'Deployment__r.First_Move_to_Production_Date_Actual__c',
    'Deployment__r.Overall_Status__c',
    'Deployment__r.Deployment_Phase__c',
    'Deployment__r.Deployment_Stage__c',
    'Deployment__r.Overall_Health__c',
    'Deployment__r.Deployment_Completion_Date__c',
    'Deployment__r.Workday_Engagement_Manager__r.Full_Name__c',
    'Deployment__r.Delivery_Assurance_Manager__r.Full_Name__c',
    'Deployment__r.Priming_Partner__c',
    'Deployment__r.Implementation_Partner__c',
    'Deployment__r.Deployment_Partner_Name__c',
    'Deployment__r.Deployment_Summary__c',
    'Product_Area__c',
    'Function__c',
    'Production_Move_Date_Target__c',
    'Production_Move_Date_Actual__c'
  ];

  /**
   * Reads SFDC_DeploymentProductFunctions and returns flat rows with PF fields and
   * optional Deployment__r.* relationship fields for ProductMode union synthesis.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Array<Object>}
   * @private
   */
  function readSfdcProductFunctionsRaw_(cfg) {
    if (_cache.pfRows !== null) return _cache.pfRows;

    var sheetName = cfg.sheets.sfdcDeploymentProductFunctions ||
                    'SFDC_DeploymentProductFunctions';
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log('CoreData.readSfdcProductFunctionsRaw_: sheet "' + sheetName + '" not found.');
      _cache.pfReaderMeta = {
        sheetName: sheetName,
        headers: [],
        foundColumns: {},
        missingRecommended: _PF_RECOMMENDED_HEADERS_.slice()
      };
      _cache.pfRows = [];
      return _cache.pfRows;
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      _cache.pfReaderMeta = {
        sheetName: sheetName,
        headers: [],
        foundColumns: {},
        missingRecommended: _PF_RECOMMENDED_HEADERS_.slice()
      };
      _cache.pfRows = [];
      return _cache.pfRows;
    }

    var lastCol   = sheet.getLastColumn();
    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers   = allValues[0].map(function (h) { return String(h || '').trim(); });
    var lowerH    = headers.map(function (h) { return h.toLowerCase(); });

    function detect_(keywords, fallback) {
      for (var ki = 0; ki < keywords.length; ki++) {
        var kw = keywords[ki].toLowerCase();
        for (var i = 0; i < lowerH.length; i++) {
          if (lowerH[i].indexOf(kw) !== -1) return i;
        }
      }
      if (fallback >= 0 && fallback < headers.length) return fallback;
      return -1;
    }

    function findExact_(headerName) {
      var target = String(headerName || '').trim().toLowerCase();
      for (var i = 0; i < lowerH.length; i++) {
        if (lowerH[i] === target) return i;
      }
      return -1;
    }

    function resolveCol_(exactHeader, keywordFallbacks, positionalFallback) {
      var exact = findExact_(exactHeader);
      if (exact >= 0) return exact;
      return detect_(keywordFallbacks || [], positionalFallback);
    }

    // FK column: Deployment__c preferred; fallback to deployment keyword without dot.
    var colFk = findExact_('Deployment__c');
    if (colFk < 0) {
      for (var fi = 0; fi < lowerH.length; fi++) {
        if (lowerH[fi].indexOf('deployment') !== -1 && lowerH[fi].indexOf('.') === -1) {
          colFk = fi;
          break;
        }
      }
    }
    if (colFk < 0) colFk = detect_(['deployment__c'], 5);

    var colPfId = findExact_('Id');
    if (colPfId >= 0 && colPfId === colFk) colPfId = -1;

    var cols = {
      pfRowId: colPfId,
      deploymentFk: colFk,
      parentDeploymentId: resolveCol_('Deployment__r.Id', ['deployment__r.id'], -1),
      deploymentName: resolveCol_('Deployment__r.Name', ['deployment__r.name'], -1),
      accountId: resolveCol_('Deployment__r.Customer__c', ['deployment__r.customer__c'], -1),
      customerRId: resolveCol_('Deployment__r.Customer__r.Id', ['deployment__r.customer__r.id'], -1),
      accountName: resolveCol_('Deployment__r.Customer__r.Name', ['customer__r.name'], -1),
      industry: resolveCol_('Deployment__r.Customer__r.Industry', ['customer__r.industry'], -1),
      region: resolveCol_('Deployment__r.Customer__r.PS_Region_New__c', ['ps_region_new'], -1),
      subRegion: resolveCol_('Deployment__r.Customer__r.PS_Sub_Region__c', ['ps_sub_region'], -1),
      subRegionAlt: resolveCol_('Deployment__r.Customer__r.SubRegion__c', ['subregion__c', 'subregion'], -1),
      deploymentStartDate: resolveCol_('Deployment__r.Deployment_Start_Date__c', ['deployment_start_date'], -1),
      mtpDate: resolveCol_('Deployment__r.Current_MTP_Date__c', ['current_mtp_date'], -1),
      firstMtpDateActual: resolveCol_('Deployment__r.First_Move_to_Production_Date_Actual__c',
        ['first_move_to_production_date_actual', 'move_to_production_date_actual'], -1),
      overallStatus: resolveCol_('Deployment__r.Overall_Status__c', ['overall_status'], -1),
      phase: resolveCol_('Deployment__r.Deployment_Phase__c', ['deployment_phase'], -1),
      stage: resolveCol_('Deployment__r.Deployment_Stage__c', ['deployment_stage'], -1),
      health: resolveCol_('Deployment__r.Overall_Health__c', ['overall_health'], -1),
      completionDate: resolveCol_('Deployment__r.Deployment_Completion_Date__c', ['deployment_completion_date'], -1),
      wdEngManager: resolveCol_('Deployment__r.Workday_Engagement_Manager__r.Full_Name__c',
        ['workday_engagement_manager__r.full_name', 'engagement_manager'], -1),
      damFullName: resolveCol_('Deployment__r.Delivery_Assurance_Manager__r.Full_Name__c',
        ['delivery_assurance_manager__r.full_name', 'delivery_assurance'], -1),
      primingPartner: resolveCol_('Deployment__r.Priming_Partner__c', ['priming_partner'], -1),
      implPartner: resolveCol_('Deployment__r.Implementation_Partner__c', ['implementation_partner'], -1),
      partner: resolveCol_('Deployment__r.Deployment_Partner_Name__c', ['deployment_partner_name', 'partner'], -1),
      currentUpdate: resolveCol_('Deployment__r.Deployment_Summary__c', ['deployment_summary'], -1),
      productArea: resolveCol_('Product_Area__c', ['product_area'], 1),
      funcArea: resolveCol_('Function__c', ['function__c', 'function'], 2),
      targetGoLive: resolveCol_('Production_Move_Date_Target__c',
        ['production_move_date_target', 'move_date_target'], 3),
      actualGoLive: resolveCol_('Production_Move_Date_Actual__c',
        ['production_move_date_actual', 'move_date_actual'], 4),
      customerObject: findExact_('Deployment__r.Customer__r'),
      wdEmObject: findExact_('Deployment__r.Workday_Engagement_Manager__r'),
      damObject: findExact_('Deployment__r.Delivery_Assurance_Manager__r')
    };

    var foundColumns = {};
    Object.keys(cols).forEach(function (key) {
      if (cols[key] >= 0) foundColumns[key] = headers[cols[key]];
    });
    var missingRecommended = _PF_RECOMMENDED_HEADERS_.filter(function (headerName) {
      if (findExact_(headerName) >= 0) return false;
      if (headerName === 'Deployment__r.Customer__c' && cols.accountId >= 0) return false;
      if (headerName.indexOf('Customer__r.') >= 0 && cols.customerObject >= 0) return false;
      if (headerName.indexOf('Workday_Engagement_Manager__r.') >= 0 && cols.wdEmObject >= 0) return false;
      if (headerName.indexOf('Delivery_Assurance_Manager__r.') >= 0 && cols.damObject >= 0) return false;
      return true;
    });
    _cache.pfReaderMeta = {
      sheetName: sheetName,
      headers: headers,
      foundColumns: foundColumns,
      missingRecommended: missingRecommended
    };

    var tz   = Session.getScriptTimeZone();
    var rows = [];

    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];

      function cellStr_(col) {
        return col >= 0 ? String(row[col] || '').trim() : '';
      }
      function cellDate_(col) {
        if (col < 0) return '';
        var raw = row[col];
        if (!raw) return '';
        var d = (raw instanceof Date) ? raw : new Date(raw);
        if (isNaN(d.getTime())) return '';
        return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      }
      function resolveField_(flatCol, objectCol, objectField) {
        var flat = cellStr_(flatCol);
        if (flat) return flat;
        if (objectCol >= 0 && objectField) {
          return _parseSfdcObjectField_(row[objectCol], objectField);
        }
        return '';
      }
      function resolveAccountId_() {
        var direct = cellStr_(cols.accountId);
        if (direct) return direct;
        var fromCustomerRId = cellStr_(cols.customerRId);
        if (fromCustomerRId) return fromCustomerRId;
        if (cols.customerObject >= 0) {
          return _parseSfdcAccountIdFromCustomerObject_(row[cols.customerObject]);
        }
        return '';
      }

      var fk = cellStr_(cols.deploymentFk);
      if (!fk) continue;

      var parentId = cellStr_(cols.parentDeploymentId) || fk;
      rows.push({
        pfRowId: cellStr_(cols.pfRowId),
        deploymentFk: fk,
        parentDeploymentId: parentId,
        deploymentName: cellStr_(cols.deploymentName),
        accountId: resolveAccountId_(),
        accountName: resolveField_(cols.accountName, cols.customerObject, 'Name'),
        industry: resolveField_(cols.industry, cols.customerObject, 'Industry'),
        region: resolveField_(cols.region, cols.customerObject, 'PS_Region_New__c'),
        subRegion: resolveField_(cols.subRegion, cols.customerObject, 'PS_Sub_Region__c'),
        subRegionAlt: resolveField_(cols.subRegionAlt, cols.customerObject, 'SubRegion__c'),
        deploymentStartDate: cellDate_(cols.deploymentStartDate),
        mtpDate: cellDate_(cols.mtpDate),
        firstMtpDateActual: cellDate_(cols.firstMtpDateActual),
        overallStatus: cellStr_(cols.overallStatus),
        phase: cellStr_(cols.phase),
        stage: cellStr_(cols.stage),
        health: cellStr_(cols.health),
        completionDate: cellDate_(cols.completionDate),
        wdEngManager: resolveField_(cols.wdEngManager, cols.wdEmObject, 'Full_Name__c'),
        damFullName: resolveField_(cols.damFullName, cols.damObject, 'Full_Name__c'),
        primingPartner: cellStr_(cols.primingPartner),
        implPartner: cellStr_(cols.implPartner),
        partner: cellStr_(cols.partner),
        currentUpdate: cellStr_(cols.currentUpdate),
        productArea: cellStr_(cols.productArea),
        funcArea: cellStr_(cols.funcArea),
        targetGoLive: cellDate_(cols.targetGoLive),
        actualGoLive: cellDate_(cols.actualGoLive)
      });
    }

    Logger.log('CoreData.readSfdcProductFunctionsRaw_: ' + rows.length +
               ' product-function rows from "' + sheetName + '".');
    _cache.pfRows = rows;
    return _cache.pfRows;
  }

  // ===========================================================================
  // MGM / PGL: DEPLOYMENT CONTACTS READER
  // ===========================================================================

  /**
   * Reads SFDC_DeploymentContacts and returns a map keyed by Deployment__c (FK).
   *
   * Map shape per deployment:
   *   {
   *     projectManagers:    [ { name, email, role } ],
   *     execSponsors:       [ { name, email, role } ],
   *     wdSponsor:          { name, email, role } | null,
   *     engagementManagers: [ { name, email, role } ]
   *   }
   *
   * Gracefully returns an empty map when the sheet is missing or empty.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Object}  Map keyed by deploymentId.
   * @private
   */
  function getDeploymentContactsMap_(cfg) {
    var sheetName = cfg.sheets.deploymentContacts || 'SFDC_DeploymentContacts';
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log('CoreData.getDeploymentContactsMap_: sheet "' + sheetName + '" not found — returning empty contacts map.');
      return {};
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};

    var lastCol   = sheet.getLastColumn();
    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers   = allValues[0].map(function (h) { return String(h || '').trim().toLowerCase(); });

    function findCol_(keywords) {
      for (var k = 0; k < keywords.length; k++) {
        var kw = keywords[k].toLowerCase();
        for (var i = 0; i < headers.length; i++) {
          if (headers[i].indexOf(kw) !== -1) return i;
        }
      }
      return -1;
    }

    var colDepFk   = findCol_(['deployment__c', 'deployment_c', 'deployment__r.id']);
    // FK column: prefer one that has "deployment" without a dot (not a traversal).
    if (colDepFk < 0) {
      for (var i = 0; i < headers.length; i++) {
        if (headers[i].indexOf('deployment') !== -1 && headers[i].indexOf('.') === -1) {
          colDepFk = i; break;
        }
      }
    }
    var colName    = findCol_(['contact__r.name', 'contact_name', 'name']);
    var colEmail   = findCol_(['contact__r.email', 'email']);
    var colRole    = findCol_(['contact_role__c', 'contact_role', 'role']);

    if (colDepFk < 0) {
      Logger.log('CoreData.getDeploymentContactsMap_: Deployment FK column not found in "' + sheetName + '".');
      return {};
    }

    var map = {};
    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];
      var depId = colDepFk >= 0 ? String(row[colDepFk] || '').trim() : '';
      if (!depId) continue;

      var name  = colName  >= 0 ? String(row[colName]  || '').trim() : '';
      var email = colEmail >= 0 ? String(row[colEmail] || '').trim() : '';
      var role  = colRole  >= 0 ? String(row[colRole]  || '').trim() : '';

      if (!name && !email) continue;

      if (!map[depId]) {
        map[depId] = {
          projectManagers:    [],
          execSponsors:       [],
          wdSponsor:          null,
          engagementManagers: []
        };
      }

      var contact = { name: name, email: email, role: role };

      if (role === 'Project Manager [Customer]') {
        map[depId].projectManagers.push(contact);
      } else if (role === 'Executive Sponsor') {
        map[depId].execSponsors.push(contact);
      } else if (role === 'Deployment Sponsor') {
        if (!map[depId].wdSponsor) map[depId].wdSponsor = contact;
      } else if (role === 'Engagement Manager [Primary]') {
        map[depId].engagementManagers.push(contact);
      }
      // Other roles are ignored per spec.
    }

    Logger.log('CoreData.getDeploymentContactsMap_: loaded contacts for ' +
               Object.keys(map).length + ' deployments from "' + sheetName + '".');
    return map;
  }

  // ===========================================================================
  // MGM / PGL: TIME WINDOW RESOLVER
  // ===========================================================================

  /**
   * Resolves a named time-window key into absolute { startDate, endDate, windowDays }.
   *
   * Window keys:
   *   'next30'      [today, today + 30 days]
   *   'thisMonth'   [max(today, 1st of month), last day of month]
   *   'nextMonth'   [1st of next month, last day of next month]
   *   'thisQuarter' [max(today, 1st of quarter), last day of quarter]
   *   'nextQuarter' [1st of next quarter, last day of next quarter]
   *
   * Quarters are calendar quarters (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec).
   *
   * @param {string} windowKey
   * @return {{ startDate: string, endDate: string, windowDays: number }}
   * @private
   */
  function resolveMgmPglWindow_(windowKey) {
    var tz  = Session.getScriptTimeZone();
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    function fmt_(d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }

    function lastDayOfMonth_(y, m) {
      // m is 0-based JS month. Day 0 of (m+1) = last day of m.
      return new Date(y, m + 1, 0);
    }

    function quarterBounds_(y, q) {
      // q = 0,1,2,3 (0-based quarter index)
      var startMonth = q * 3;          // 0, 3, 6, 9
      var endMonth   = startMonth + 2; // 2, 5, 8, 11
      var first = new Date(y, startMonth, 1);
      var last  = lastDayOfMonth_(y, endMonth);
      return { first: first, last: last };
    }

    var key = windowKey || 'next30';
    var startDate, endDate;

    if (key === 'thisMonth') {
      var fm = new Date(now.getFullYear(), now.getMonth(), 1);
      var lm = lastDayOfMonth_(now.getFullYear(), now.getMonth());
      startDate = fmt_(now > fm ? now : fm);
      endDate   = fmt_(lm);

    } else if (key === 'nextMonth') {
      var nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      var lnm = lastDayOfMonth_(nm.getFullYear(), nm.getMonth());
      startDate = fmt_(nm);
      endDate   = fmt_(lnm);

    } else if (key === 'thisQuarter') {
      var q = Math.floor(now.getMonth() / 3);
      var bounds = quarterBounds_(now.getFullYear(), q);
      startDate = fmt_(now > bounds.first ? now : bounds.first);
      endDate   = fmt_(bounds.last);

    } else if (key === 'nextQuarter') {
      var cq = Math.floor(now.getMonth() / 3);
      var nqIdx = cq + 1;
      var nqYear = now.getFullYear();
      if (nqIdx > 3) { nqIdx = 0; nqYear++; }
      var nqBounds = quarterBounds_(nqYear, nqIdx);
      startDate = fmt_(nqBounds.first);
      endDate   = fmt_(nqBounds.last);

    } else {
      // Default: 'next30'
      var end30 = new Date(now.getTime() + 30 * 86400000);
      startDate = fmt_(now);
      endDate   = fmt_(end30);
    }

    var ms = new Date(startDate).getTime();
    var me = new Date(endDate).getTime();
    var windowDays = Math.round(Math.max(0, me - ms) / 86400000);

    return { startDate: startDate, endDate: endDate, windowDays: windowDays };
  }

  // ===========================================================================
  // MGM / PGL: PRODUCT / PHASE LABEL BUILDER
  // ===========================================================================

  /**
   * Aggregates product-function rows into a human-readable label.
   *
   * Format: "HCM (Absence, Benefits, Core HR); Payroll (US Payroll); ..."
   *   - Product Areas sorted alphabetically.
   *   - Functions sorted alphabetically within each area.
   *   - If productArea is blank, the funcArea is used directly.
   *
   * @param {Array<{productArea:string, funcArea:string}>} pfRows
   * @return {string}
   * @private
   */
  function buildProductPhaseLabel_(pfRows) {
    if (!pfRows || pfRows.length === 0) return '';

    // Group functions by product area.
    var areaMap = {};  // { areaName: { funcName: true } }
    pfRows.forEach(function (pf) {
      var area = pf.productArea || pf.funcArea || '';
      var func = (pf.productArea && pf.funcArea) ? pf.funcArea : '';
      if (!area) return;
      if (!areaMap[area]) areaMap[area] = {};
      if (func) areaMap[area][func] = true;
    });

    var areas = Object.keys(areaMap).sort();
    var parts = areas.map(function (area) {
      var funcs = Object.keys(areaMap[area]).sort();
      if (funcs.length === 0) return area;
      return area + ' (' + funcs.join(', ') + ')';
    });

    return parts.join('; ');
  }

  // ===========================================================================
  // MDS / PGL: MONTH-BATCH VIEW (redesign — replaces getUpcomingSurveys)
  // ===========================================================================

  /**
   * Formats a YYYY-MM key as a long month label ('March 2026').
   * @param {string} ym  'YYYY-MM'
   * @return {string}
   * @private
   */
  function _formatMonthLabel_(ym) {
    var monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
    var parts = ym.split('-');
    return monthNames[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  }

  /**
   * Coerces a sheet/API date value to a JSON-serializable string for google.script.run.
   * Raw Date objects in payloads cause the client success handler to receive null.
   * @param {*} val
   * @param {*=} emptyVal  Returned when val is null/empty.
   * @return {string|null}
   * @private
   */
  function _coerceUiDateField_(val, emptyVal) {
    if (val == null || val === '') {
      return emptyVal !== undefined ? emptyVal : null;
    }
    if (val instanceof Date) {
      return CoreUtils.formatDateToIsoString(val);
    }
    return String(val);
  }

  /**
   * Computes the one-third point between a deployment start and a target date.
   * @param {string} start  'YYYY-MM-DD'
   * @param {string} end    'YYYY-MM-DD'
   * @return {string|null}  'YYYY-MM-DD' or null if inputs are invalid.
   * @private
   */
  function _computeOneThird_(start, end) {
    if (!start || !end) return null;
    var sd = new Date(start);
    var ed = new Date(end);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed < sd) return null;
    var ms = sd.getTime() + (ed.getTime() - sd.getTime()) / 3;
    return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  /**
   * Deduplicates an events array — merges product lists for events with the
   * same (kind, eventDate) key.
   * @param {Array} events
   * @return {Array}
   * @private
   */
  function _dedupeEvents_(events) {
    var seen = {};
    var out  = [];
    for (var i = 0; i < events.length; i++) {
      var e   = events[i];
      var key = e.kind + '|' + e.eventDate;
      if (seen[key]) {
        // Merge products (union, sort).
        var merged = {};
        (seen[key].products || []).forEach(function (p) { merged[p] = true; });
        (e.products || []).forEach(function (p) { merged[p] = true; });
        seen[key].products = Object.keys(merged).sort();
      } else {
        seen[key] = e;
        out.push(e);
      }
    }
    return out;
  }

  /**
   * Builds the go-live events for one Active deployment.
   * Returns one MDS event per distinct target date + one PGL event per distinct
   * actual date (falling back to MTP when no actuals exist).
   *
   * @param {Object} deploymentRow  Raw row from readSfdcDeploymentsRaw_.
   * @param {Array}  productRows    Array from readSfdcProductFunctionsRaw_ for this dep (may be undefined/empty).
   * @return {Array<{ kind:'MDS'|'PGL', eventDate:string, oneThirdPoint:string|null, products:string[] }>}
   * @private
   */
  function _buildGoLiveEvents_(deploymentRow, productRows) {
    var events = [];
    var pr = productRows || [];

    // ── MDS (target dates) ──────────────────────────────────────────────────
    if (pr.length > 0) {
      var targetMap = {}; // 'YYYY-MM-DD' -> { productArea: true }
      for (var i = 0; i < pr.length; i++) {
        var d = pr[i].targetGoLive || '';
        if (!d) continue;
        if (!targetMap[d]) targetMap[d] = {};
        if (pr[i].productArea) targetMap[d][pr[i].productArea] = true;
      }
      var targetDates = Object.keys(targetMap);
      for (var ti = 0; ti < targetDates.length; ti++) {
        var T = targetDates[ti];
        var products = Object.keys(targetMap[T]).sort();
        var oneThird = _computeOneThird_(deploymentRow.deploymentStartDate, T);
        if (oneThird) {
          events.push({ kind: 'MDS', eventDate: T, oneThirdPoint: oneThird, products: products });
        }
      }
    } else {
      if (deploymentRow.deploymentStartDate && deploymentRow.mtpDate) {
        var oneThird2 = _computeOneThird_(deploymentRow.deploymentStartDate, deploymentRow.mtpDate);
        if (oneThird2) {
          events.push({
            kind: 'MDS',
            eventDate: deploymentRow.mtpDate,
            oneThirdPoint: oneThird2,
            products: []
          });
        }
      }
    }

    // ── PGL (actual dates; fall back to MTP) ────────────────────────────────
    if (pr.length > 0) {
      var actualMap = {}; // 'YYYY-MM-DD' -> { productArea: true }
      for (var j = 0; j < pr.length; j++) {
        var da = pr[j].actualGoLive || '';
        if (!da) continue;
        if (!actualMap[da]) actualMap[da] = {};
        if (pr[j].productArea) actualMap[da][pr[j].productArea] = true;
      }
      var actualDates = Object.keys(actualMap);
      if (actualDates.length > 0) {
        for (var ai = 0; ai < actualDates.length; ai++) {
          var A = actualDates[ai];
          var aProducts = Object.keys(actualMap[A]).sort();
          events.push({ kind: 'PGL', eventDate: A, oneThirdPoint: null, products: aProducts });
        }
      } else {
        // No actuals — fall back to MTP
        if (deploymentRow.mtpDate) {
          events.push({ kind: 'PGL', eventDate: deploymentRow.mtpDate, oneThirdPoint: null, products: [] });
        }
      }
    } else {
      if (deploymentRow.mtpDate) {
        events.push({ kind: 'PGL', eventDate: deploymentRow.mtpDate, oneThirdPoint: null, products: [] });
      }
    }

    return _dedupeEvents_(events);
  }

  /**
   * Builds the exceptions list for Active deployments that are missing dates
   * required to schedule surveys. Logic lifted verbatim from the prior
   * getUpcomingSurveys implementation — do not modify.
   *
   * @param {AppConfig} cfg
   * @param {Array}     activeRows        Active rows from readSfdcDeploymentsRaw_.
   * @param {Object}    productRowsByDep  Map: deploymentId -> Array of pfRows.
   * @return {Array<ExceptionRow>}
   */
  function _buildMgmPglExceptions_(cfg, activeRows, productRowsByDep) {
    var exceptionRows = [];
    var exceptionSeen = {};

    activeRows.forEach(function (r) {
      // Only Workday PS deployments are surveyed.
      if (r.partner !== 'Workday Professional Services') return;

      var depId    = r.deploymentId;
      var depStart = r.deploymentStartDate || '';
      var depEnd   = r.mtpDate             || '';
      var products = productRowsByDep[depId] || [];

      function pushException_(missingType, hasProducts) {
        if (exceptionSeen[depId]) return;
        exceptionSeen[depId] = true;
        exceptionRows.push({
          deploymentId:        depId,
          accountName:         r.accountName,
          deploymentName:      r.deploymentName,
          deploymentStartDate: depStart || null,
          missingType:         missingType,
          hasProducts:         hasProducts,
          deliveryDirector:    r.damFullName || null
        });
      }

      if (products.length > 0) {
        var anyMissingTarget = false;
        products.forEach(function (pf) {
          if (!(pf.targetGoLive || '')) anyMissingTarget = true;
        });
        if (anyMissingTarget) pushException_('ProductTargets', true);
      } else {
        if (depStart && !depEnd) {
          pushException_('DeploymentTargetEnd', false);
        }
      }
    });

    return exceptionRows;
  }

  /**
   * Returns Active-only MDS and PGL survey rows grouped by batch month for the
   * requested horizon. Date-deduped per spec (one row per distinct go-live date).
   *
   * @param {AppConfig} config
   * @param {Object=}   viewModeOpts  { viewMode:'my'|'all', ddDisplayName:string }
   * @param {number=}   windowMonths  3 or 6. Default 3.
   * @return {{
   *   horizonMonths: number,
   *   today: string,
   *   asOf: string,
   *   groups: Array<{
   *     yearMonth: string,
   *     monthLabel: string,
   *     schedule: Object,
   *     mdsRows: Array,
   *     pglRows: Array,
   *     counts: { mds: number, pgl: number }
   *   }>,
   *   exceptions: Array
   * }}
   */
  function getMdsPglBatchView(config, viewModeOpts, windowMonths, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var horizonMonths = (windowMonths === 6) ? 6 : 3;

    // Tier 1 cache check.
    var t1Key = String(horizonMonths);
    if (_cache.mdsPglBatchView[t1Key]) {
      Logger.log('CoreData.getMdsPglBatchView: tier 1 hit for window=' + horizonMonths);
      var cached1 = _cache.mdsPglBatchView[t1Key];
      return _applyViewModeFilterToPayload_(cfg, cached1, viewModeOpts, horizonMonths, productOpts);
    }

    // Tier 2 (_PerfCache) check.
    var t2Key = _perfKey_(cfg, 'mdsPglBatchView') + ':' + horizonMonths;
    var cached2 = _perfCacheRead_(t2Key);
    if (cached2) {
      Logger.log('CoreData.getMdsPglBatchView: tier 2 hit for window=' + horizonMonths);
      _cache.mdsPglBatchView[t1Key] = cached2;
      return _applyViewModeFilterToPayload_(cfg, cached2, viewModeOpts, horizonMonths, productOpts);
    }

    // ── Build ──────────────────────────────────────────────────────────────
    Logger.log('CoreData.getMdsPglBatchView: computing for appId=' + cfg.appId +
               ', horizonMonths=' + horizonMonths);

    var tz  = Session.getScriptTimeZone();
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

    // Build month keys: [current YYYY-MM, +1, +2, …] up to horizonMonths entries.
    var monthKeys = [];
    for (var mi = 0; mi < horizonMonths; mi++) {
      var md = new Date(now.getFullYear(), now.getMonth() + mi, 1);
      monthKeys.push(Utilities.formatDate(md, tz, 'yyyy-MM'));
    }

    var scheduleByMonth = monthKeys.map(function (ym) {
      return CoreSurveySchedule.resolve(ym);
    });

    // Active deployments (raw, Active-only).
    var activeRows = [];
    try {
      if (usesProductModePfDataSource_(cfg)) {
        var effectivePf = getAllEffectiveDeployments(cfg) || [];
        var byParent = {};
        effectivePf.forEach(function (r) {
          var pid = _canonicalId_(r.parentDeploymentId || r.deploymentFk || r.deploymentId);
          if (!pid) return;
          if (!byParent[pid]) {
            byParent[pid] = Object.assign({}, r, {
              deploymentId: pid,
              parentDeploymentId: pid,
              deploymentFk: pid
            });
          }
        });
        activeRows = Object.keys(byParent).map(function (k) { return byParent[k]; });
        activeRows = filterDeploymentsByStudent_(activeRows, 'exclude', cfg);
      } else {
        var rawRows = readSfdcDeploymentsRaw_(cfg);
        activeRows = rawRows.filter(function (r) {
          return r.overallStatus === 'Active';
        });
        activeRows = filterDeploymentsByStudent_(activeRows, 'exclude', cfg);
      }
    } catch (e) {
      Logger.log('CoreData.getMdsPglBatchView: active deployment read failed: ' + e);
    }

    // Product-function rows grouped by deploymentFk.
    var productRowsByDep = {};
    try {
      var pfRows = readSfdcProductFunctionsRaw_(cfg);
      pfRows.forEach(function (pf) {
        if (!pf.deploymentFk) return;
        if (!productRowsByDep[pf.deploymentFk]) productRowsByDep[pf.deploymentFk] = [];
        productRowsByDep[pf.deploymentFk].push(pf);
      });
    } catch (e) {
      Logger.log('CoreData.getMdsPglBatchView: readSfdcProductFunctionsRaw_ failed: ' + e);
    }

    // Contacts map.
    var contactsMap = {};
    try {
      contactsMap = getDeploymentContactsMap_(cfg);
    } catch (e) {
      Logger.log('CoreData.getMdsPglBatchView: getDeploymentContactsMap_ failed: ' + e);
    }

    // Exceptions list (verbatim logic from prior getUpcomingSurveys).
    var exceptions = _buildMgmPglExceptions_(cfg, activeRows, productRowsByDep);

    // Build all rows.
    var allRows = [];
    activeRows.forEach(function (r) {
      var depId    = r.deploymentId;
      var prRows   = productRowsByDep[depId];
      var events   = _buildGoLiveEvents_(r, prRows);

      var mdsCount         = 0;
      var pglCount         = 0;
      for (var ei = 0; ei < events.length; ei++) {
        if (events[ei].kind === 'MDS') mdsCount++;
        else pglCount++;
      }
      var isMultipleGoLives = (mdsCount > 1) || (pglCount > 1);

      for (var evi = 0; evi < events.length; evi++) {
        var ev = events[evi];

        // Determine the date that drives batch-month assignment.
        var targetDate = (ev.kind === 'MDS') ? ev.oneThirdPoint : ev.eventDate;
        if (!targetDate) continue;

        // Find the matching schedule entry.
        var scheduleEntry = null;
        for (var si = 0; si < scheduleByMonth.length; si++) {
          var s   = scheduleByMonth[si];
          var win = (ev.kind === 'MDS') ? s.mdsOneThirdWindow : s.pglFirstMtpWindow;
          if (targetDate >= win.start && targetDate <= win.end) {
            scheduleEntry = s;
            break;
          }
        }
        if (!scheduleEntry) continue; // outside horizon — skip silently

        allRows.push({
          deploymentId:     depId,
          accountName:      r.accountName,
          deploymentName:   r.deploymentName,
          deliveryDirector: r.damFullName || '',
          partner:          r.partner     || '',
          isExecutiveWatch: !!r.isExecutiveWatch,
          surveyType:       ev.kind,
          eventDate:        _coerceUiDateField_(ev.eventDate),
          products:         ev.products,
          isMultipleGoLives: isMultipleGoLives,
          oneThirdPoint:    _coerceUiDateField_(ev.oneThirdPoint, null),
          startDate:        _coerceUiDateField_(r.deploymentStartDate, null),
          currentMtp:       _coerceUiDateField_(r.mtpDate, null),
          contacts:         contactsMap[depId]    || null,
          _batchYearMonth:  scheduleEntry.yearMonth
        });
      }
    });

    // ── Group by month ────────────────────────────────────────────────────
    function byAccountName_(a, b) {
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    }

    var groups = monthKeys.map(function (ym) {
      var sched = scheduleByMonth.filter(function (x) { return x.yearMonth === ym; })[0] || null;
      var mds = allRows.filter(function (row) {
        return row._batchYearMonth === ym && row.surveyType === 'MDS';
      }).sort(byAccountName_);
      var pgl = allRows.filter(function (row) {
        return row._batchYearMonth === ym && row.surveyType === 'PGL';
      }).sort(byAccountName_);
      return {
        yearMonth:  ym,
        monthLabel: _formatMonthLabel_(ym),
        schedule:   sched,
        mdsRows:    mds,
        pglRows:    pgl,
        counts:     { mds: mds.length, pgl: pgl.length }
      };
    });

    // Strip internal _batchYearMonth from row objects.
    allRows.forEach(function (row) { delete row._batchYearMonth; });
    groups.forEach(function (g) {
      g.mdsRows.forEach(function (row) { delete row._batchYearMonth; });
      g.pglRows.forEach(function (row) { delete row._batchYearMonth; });
    });

    var payload = {
      horizonMonths: horizonMonths,
      today:         todayKey,
      asOf:          new Date().toISOString(),
      groups:        groups,
      exceptions:    exceptions
    };

    // Cache the un-filtered payload.
    _cache.mdsPglBatchView[t1Key] = payload;
    _perfCacheWrite_(t2Key, payload);

    Logger.log('CoreData.getMdsPglBatchView: built ' + groups.length + ' month groups, ' +
               allRows.length + ' total rows, ' + exceptions.length + ' exceptions.');

    return _applyViewModeFilterToPayload_(cfg, payload, viewModeOpts, horizonMonths, productOpts);
  }

  /**
   * Applies product + viewMode filtering to a cached batch-view payload.
   * Returns a shallow copy of the payload with filtered row arrays.
   * @private
   */
  function _applyViewModeFilterToPayload_(cfg, payload, viewModeOpts, horizonMonths, productOpts) {
    var pa = (productOpts && productOpts.product) || 'all';
    var needsProduct = cfg.ui && cfg.ui.productFilter && cfg.ui.productFilter.enabled === true &&
      pa && pa !== 'all';
    var needsViewMode = viewModeOpts && viewModeOpts.viewMode && viewModeOpts.viewMode !== 'all';

    if (!needsProduct && !needsViewMode) {
      return payload;
    }

    // Deep-copy groups and filter rows within each group.
    var filteredGroups = payload.groups.map(function (g) {
      var combined = g.mdsRows.concat(g.pglRows);
      if (needsProduct) {
        combined = filterDeploymentsByProduct_(combined, pa, cfg);
      }
      var filtered = needsViewMode
        ? applyViewModeFilter_(cfg, combined, viewModeOpts)
        : combined;
      return {
        yearMonth:  g.yearMonth,
        monthLabel: g.monthLabel,
        schedule:   g.schedule,
        mdsRows:    filtered.filter(function (r) { return r.surveyType === 'MDS'; }),
        pglRows:    filtered.filter(function (r) { return r.surveyType === 'PGL'; }),
        counts: {
          mds: filtered.filter(function (r) { return r.surveyType === 'MDS'; }).length,
          pgl: filtered.filter(function (r) { return r.surveyType === 'PGL'; }).length
        }
      };
    });

    return {
      horizonMonths: payload.horizonMonths,
      today:         payload.today,
      asOf:          payload.asOf,
      groups:        filteredGroups,
      exceptions:    payload.exceptions
    };
  }

  /**
   * Diagnostic: logs the getMdsPglBatchView payload shape, per-month counts,
   * and the first 3 rows of each section. Run manually in the Apps Script editor.
   *
   * @param {AppConfig} cfg
   */
  function _debugMdsPglBatchView_(cfg) {
    Logger.log('=== _debugMdsPglBatchView ===');
    var payload = getMdsPglBatchView(cfg, null, 3);
    Logger.log('horizonMonths=' + payload.horizonMonths + ', today=' + payload.today);
    Logger.log('groups: ' + payload.groups.length);
    payload.groups.forEach(function (g) {
      Logger.log('  ' + g.yearMonth + ' (' + g.monthLabel + '): MDS=' + g.counts.mds + ', PGL=' + g.counts.pgl);
      g.mdsRows.slice(0, 3).forEach(function (r) {
        Logger.log('    MDS: ' + r.accountName + ' | ' + r.deploymentName +
                   ' | event=' + r.eventDate + ' | 1/3=' + r.oneThirdPoint +
                   ' | multiGL=' + r.isMultipleGoLives);
      });
      g.pglRows.slice(0, 3).forEach(function (r) {
        Logger.log('    PGL: ' + r.accountName + ' | ' + r.deploymentName +
                   ' | event=' + r.eventDate + ' | multiGL=' + r.isMultipleGoLives);
      });
    });
    Logger.log('exceptions: ' + payload.exceptions.length);
    Logger.log('=== END ===');
  }

  /**
   * Diagnostic: logs every deployment that would appear in exceptions with
   * resolved start/MTP/product-presence flags. Validates Bellingham fix.
   *
   * @param {AppConfig} cfg
   */
  function _debugMdsPglExceptions_(cfg) {
    Logger.log('=== _debugMdsPglExceptions ===');
    var cfgD = CoreConfig.withDefaults(cfg);

    var activeRows = [];
    try {
      activeRows = readSfdcDeploymentsRaw_(cfgD).filter(function (r) {
        return r.overallStatus === 'Active';
      });
    } catch (e) {
      Logger.log('readSfdcDeploymentsRaw_ error: ' + e);
    }

    var productRowsByDep = {};
    try {
      readSfdcProductFunctionsRaw_(cfgD).forEach(function (pf) {
        if (!pf.deploymentFk) return;
        if (!productRowsByDep[pf.deploymentFk]) productRowsByDep[pf.deploymentFk] = [];
        productRowsByDep[pf.deploymentFk].push(pf);
      });
    } catch (e) {
      Logger.log('readSfdcProductFunctionsRaw_ error: ' + e);
    }

    var excs = _buildMgmPglExceptions_(cfgD, activeRows, productRowsByDep);
    Logger.log('Total exceptions: ' + excs.length);
    excs.forEach(function (ex) {
      var prRows = productRowsByDep[ex.deploymentId] || [];
      Logger.log('  ' + ex.accountName + ' [' + ex.deploymentId + ']' +
                 ' | start=' + ex.deploymentStartDate +
                 ' | hasProducts=' + ex.hasProducts +
                 ' | missing=' + ex.missingType +
                 ' | pfCount=' + prRows.length);
    });

    // Validate: City of Bellingham should NOT appear if all its product dates match parent MTP.
    var bellingham = excs.filter(function (ex) {
      return (ex.accountName || '').toLowerCase().indexOf('bellingham') !== -1;
    });
    if (bellingham.length > 0) {
      Logger.log('WARNING: Bellingham appears in exceptions — review product date data.');
    } else {
      Logger.log('OK: Bellingham not in exceptions (Bellingham fix confirmed).');
    }
    Logger.log('=== END ===');
  }

  // ===========================================================================
  // V2.8: CSAT IN-FLIGHT SURVEYS
  // ===========================================================================

  /** @const {string[]} CSAT_InFlight sheet storage schema */
  var _CSAT_INFLIGHT_COLUMNS_ = [
    'deployment_id', 'account_name', 'deployment_name',
    'survey_type', 'tracking_status', 'response_received',
    'contact_name', 'contact_email', 'contact_role',
    'engagement_manager', 'partner_name',
    'sent_date', 'opened_date', 'started_date', 'finished_date',
    'survey_expires'
  ];

  /**
   * Sanitizes ISO or locale date strings into YYYY-MM-DD.
   * @param {*} dVal
   * @return {string}
   * @private
   */
  function formatShortDate_(dVal) {
    if (!dVal || dVal === '\u2014' || dVal === 'null' || dVal === 'undefined') return '\u2014';
    var str = String(dVal).trim();

    // Handle MM/DD/YYYY format
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      var parts = str.split('/');
      var mm = parts[0].padStart(2, '0');
      var dd = parts[1].padStart(2, '0');
      var yyyy = parts[2];
      return yyyy + '-' + mm + '-' + dd;
    }

    var d = new Date(str);
    if (isNaN(d.getTime())) return str.split('T')[0] || '\u2014';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  /**
   * Formats a date value for UI display as M/d/yyyy.
   * Accepts Date objects and parseable date strings; blank/invalid returns em-dash.
   * @param {*} dVal
   * @return {string}
   * @private
   */
  function _formatUiDate_(dVal) {
    if (!dVal || dVal === '\u2014' || dVal === 'null' || dVal === 'undefined') return '\u2014';
    if (dVal instanceof Date) {
      if (isNaN(dVal.getTime())) return '\u2014';
      return Utilities.formatDate(dVal, Session.getScriptTimeZone(), 'M/d/yyyy');
    }
    var str = String(dVal).trim();
    if (!str) return '\u2014';
    var d = new Date(str);
    if (isNaN(d.getTime())) return '\u2014';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d/yyyy');
  }

  /**
   * Normalizes a raw survey_status string to a UI tracking status.
   * @param {string} raw
   * @return {string} Sent|Opened|Completed|Bounced
   * @private
   */
  function _normalizeCsatTrackingStatus_(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (!s) return 'Sent';
    if (s.indexOf('bounce') !== -1 || s.indexOf('undeliver') !== -1 || s.indexOf('fail') !== -1) {
      return 'Bounced/Undeliverable';
    }
    if (s.indexOf('complete') !== -1 || s.indexOf('submit') !== -1) return 'Completed';
    if (s.indexOf('open') !== -1 || s.indexOf('start') !== -1 || s.indexOf('progress') !== -1) {
      return 'Opened';
    }
    return 'Sent';
  }

  /**
   * Parses survey_normalized CSV text into row objects keyed by schema columns.
   * @param {string} csvText
   * @return {Array<Object>}
   * @private
   */
  function _parseCsatInFlightCsv_(csvText) {
    var rows = Utilities.parseCsv(String(csvText || ''));
    if (!rows || !rows.length) return [];

    var headerRow = rows[0].map(function (h) {
      return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
    });
    var colIndex = {};
    headerRow.forEach(function (name, i) {
      if (name) colIndex[name] = i;
    });

    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var raw = rows[r];
      if (!raw || !raw.length) continue;
      var obj = {};
      var hasData = false;
      Object.keys(colIndex).forEach(function (name) {
        var val = colIndex[name] < raw.length ? String(raw[colIndex[name]] || '').trim() : '';
        if (val) hasData = true;
        obj[name] = val;
      });
      if (!hasData) continue;
      if (obj.deployment_id) {
        obj.deployment_id = _canonicalId_(obj.deployment_id);
      }
      out.push(obj);
    }
    return out;
  }

  /**
   * @param {AppConfig} cfg
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   * @private
   */
  function _getOrCreateCsatInFlightSheet_(cfg) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = cfg.sheets.csatInFlight || 'CSAT_InFlight';
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, _CSAT_INFLIGHT_COLUMNS_.length)
        .setValues([_CSAT_INFLIGHT_COLUMNS_]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  /**
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function _readCsatInFlightRows_(cfg) {
    var sheetName = cfg.sheets.csatInFlight || 'CSAT_InFlight';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var width = Math.max(_CSAT_INFLIGHT_COLUMNS_.length, sheet.getLastColumn());
    var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    var headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) {
      return String(h || '').trim();
    });

    return values.map(function (row) {
      var obj = {};
      for (var i = 0; i < headers.length; i++) {
        if (headers[i]) obj[headers[i]] = row[i];
      }
      if (obj.deployment_id) obj.deployment_id = _canonicalId_(obj.deployment_id);
      return obj;
    });
  }

  /**
   * @param {AppConfig} cfg
   * @param {Array<Object>} rows
   * @private
   */
  function _writeCsatInFlightSheet_(cfg, rows) {
    var sheet = _getOrCreateCsatInFlightSheet_(cfg);
    sheet.getRange(1, 1, 1, _CSAT_INFLIGHT_COLUMNS_.length)
      .setValues([_CSAT_INFLIGHT_COLUMNS_]);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
    if (!rows || !rows.length) return;

    var matrix = rows.map(function (obj) {
      return _CSAT_INFLIGHT_COLUMNS_.map(function (col) {
        return obj[col] !== undefined && obj[col] !== null ? obj[col] : '';
      });
    });
    sheet.getRange(2, 1, matrix.length, _CSAT_INFLIGHT_COLUMNS_.length).setValues(matrix);
  }

  /**
   * @param {AppConfig} cfg
   * @param {string} csvText
   * @private
   */
  function _backupCsatImport_(cfg, csvText) {
    var tz = Session.getScriptTimeZone();
    var dateKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var appId = cfg.appId || 'DHM';
    var fileName = 'CSAT_Import_' + appId + '_' + dateKey + '.csv';
    var folders = DriveApp.getFoldersByName('DHM_CSAT_Imports');
    var folder = folders.hasNext()
      ? folders.next()
      : DriveApp.createFolder('DHM_CSAT_Imports');
    folder.createFile(fileName, csvText, MimeType.CSV);
    Logger.log('CoreData._backupCsatImport_: saved ' + fileName);
  }

  /**
   * Filters parsed CSAT rows to deployments valid for the current app tenant.
   * @param {AppConfig} cfg
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   * @private
   */
  /**
   * Returns canonical deployment IDs valid for CSAT ingestion in this app.
   * @param {AppConfig} cfg
   * @return {Object<string, boolean>}
   * @private
   */
  function _csatAllowedDeploymentIds_(cfg) {
    var allowedIds = {};
    if (cfg.appId === 'HC_DM') {
      try {
        readSfdcDeploymentsRaw_(cfg).forEach(function (r) {
          if (r.overallStatus === 'Active' && r.deploymentId) {
            allowedIds[_canonicalId_(r.deploymentId)] = true;
          }
        });
      } catch (e) {
        Logger.log('CoreData._csatAllowedDeploymentIds_: HC read failed: ' + e);
      }
    } else {
      getAllEffectiveDeployments(cfg).forEach(function (r) {
        if (r.deploymentId) allowedIds[_canonicalId_(r.deploymentId)] = true;
      });
    }
    return allowedIds;
  }

  /**
   * Filters parsed CSAT rows to deployments valid for the current app tenant.
   * @param {AppConfig} cfg
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   * @private
   */
  function _filterCsatRowsByTenant_(cfg, rows) {
    if (!rows || !rows.length) return [];
    var allowedIds = _csatAllowedDeploymentIds_(cfg);
    return rows.filter(function (row) {
      var id = _canonicalId_(row.deployment_id);
      return id && allowedIds[id];
    });
  }

  /**
   * @param {AppConfig} cfg
   * @private
   */
  function _setCsatLastImportAt_(cfg) {
    var key = 'CSAT_LAST_IMPORT:' + (cfg.appId || 'DHM');
    PropertiesService.getScriptProperties().setProperty(key, new Date().toISOString());
  }

  /**
   * @param {AppConfig} cfg
   * @return {string} ISO timestamp or empty
   * @private
   */
  function _getCsatLastImportAt_(cfg) {
    var key = 'CSAT_LAST_IMPORT:' + (cfg.appId || 'DHM');
    return PropertiesService.getScriptProperties().getProperty(key) || '';
  }

  /**
   * @param {string} dateVal
   * @return {number|null}
   * @private
   */
  function _daysUntilDate_(dateVal) {
    if (!dateVal) return null;
    var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }

  /**
   * @param {Object} row
   * @return {Object}
   * @private
   */
  function _normalizeCsatInFlightRowForUI_(row) {
    var first = String(row.contact_first_name || '').trim();
    var last  = String(row.contact_last_name || '').trim();
    var name  = (first + ' ' + last).trim() || String(row.contact_email || '').trim();
    var role  = String(row.contact_role || row.contact_title || '').trim();
    var status = _normalizeCsatTrackingStatus_(row.survey_status);
    var depId = row.deployment_id || row.deploymentId || row.id || '';
    if (depId) depId = _canonicalId_(depId);
    return {
      deploymentId:   depId || '\u2014',
      accountName:    row.account_name || row.accountName || row.customer ||
                      row.Customer__r_Name || '\u2014',
      deploymentName: row.deployment_name || '',
      surveyType:     row.survey_type || row.surveyType || row.type || 'MDS',
      contactName:    name,
      contactEmail:   row.contact_email || '',
      contactRole:    role,
      contactDisplay: role ? (name + ' (' + role + ')') : name,
      deliveryDirector: String(
        row.delivery_director || row.deliveryDirector || row.dd || '\u2014'
      ).trim(),
      targetGoLive:   row.target_go_live || row.targetGoLive || row.mtp_date || '\u2014',
      status:         status,
      sentDate:       row.sent_date || row.sentDate || row.dispatch_date || '\u2014',
      expiresInDays:  _daysUntilDate_(row.expires_date),
      surveyLink:     row.survey_link || '',
      bounceReason:   row.bounce_reason || '',
      raw:            row
    };
  }

  /**
   * @param {Array<Object>} uiRows
   * @return {{totalSent:number, openRatePct:number, completionRatePct:number, bouncedCount:number}}
   * @private
   */
  function _buildCsatInFlightKPIs_(uiRows) {
    var sent = (uiRows || []).length;
    var opened = 0;
    var completed = 0;
    var bounced = 0;
    (uiRows || []).forEach(function (r) {
      var s = String(r.trackingStatus || '').toLowerCase();
      if (s.indexOf('bounce') !== -1 || s.indexOf('undeliver') !== -1) {
        bounced++;
        return;
      }
      if (s.indexOf('complete') !== -1) {
        completed++;
        opened++;
        return;
      }
      if (s.indexOf('open') !== -1) {
        opened++;
        return;
      }
    });
    var denom = sent - bounced;
    return {
      totalSent:         sent,
      openRatePct:       denom > 0 ? Math.round((opened / denom) * 1000) / 10 : 0,
      completionRatePct: denom > 0 ? Math.round((completed / denom) * 1000) / 10 : 0,
      bouncedCount:      bounced
    };
  }

  /**
   * Returns all deployment IDs from the SFDC_Deployments master sheet (Active + Complete).
   * @param {AppConfig} config
   * @return {Array<{id:string}>}
   * @private
   */
  function getDeploymentMaster_(config) {
    var cfg = CoreConfig.withDefaults(config);
    try {
      return readSfdcDeploymentsRaw_(cfg).map(function (r) {
        return { id: r.deploymentId };
      }).filter(function (d) { return d.id; });
    } catch (e) {
      Logger.log('CoreData.getDeploymentMaster_: read failed: ' + e);
      return [];
    }
  }

  /**
   * V2.8: Parses and ingests a survey_normalized CSV export.
   * Clears and overwrites CSAT_InFlight; backs up to Drive; invalidates caches.
   *
   * @param {AppConfig} config
   * @param {string} csvText
   * @return {{success:boolean, imported:number, discarded:number, totalInput:number, count:number, message:string}}
   */
  function uploadCsatInFlightCsvForUI(config, csvText) {
    var cfg = CoreConfig.withDefaults(config);
    var parsedRows = _parseCsatInFlightCsv_(csvText);
    var allowedIds = _csatAllowedDeploymentIds_(cfg);

    var matched = [];
    parsedRows.forEach(function (row) {
      var canonId = _canonicalId_(row.deployment_id);
      if (!canonId || !allowedIds[canonId]) return;
      matched.push({
        deployment_id:      canonId,
        account_name:       row.account_name || '\u2014',
        deployment_name:    row.deployment_name || '',
        survey_type:        row.survey_type || '',
        tracking_status:    _normalizeCsatTrackingStatus_(row.tracking_status),
        response_received:  row.response_received || '',
        contact_name:       row.full_name || ((row.first_name || '') + ' ' + (row.last_name || '')).trim() || '\u2014',
        contact_email:      row.contact_email || '',
        contact_role:       row.contact_role || '',
        engagement_manager: row.engagement_manager || '',
        partner_name:       row.partner_name || '',
        sent_date:          formatShortDate_(row.ts_email_sent),
        opened_date:        formatShortDate_(row.ts_email_opened),
        started_date:       formatShortDate_(row.ts_survey_started),
        finished_date:      formatShortDate_(row.ts_survey_finished),
        survey_expires:     formatShortDate_(row.survey_expires)
      });
    });

    Logger.log('CSAT Ingestion [' + cfg.appId + ']: input=' + parsedRows.length +
               ', matched=' + matched.length);
    try {
      _backupCsatImport_(cfg, csvText);
    } catch (e) {
      Logger.log('CSAT backup failed: ' + e);
    }
    _writeCsatInFlightSheet_(cfg, matched);
    _setCsatLastImportAt_(cfg);
    _clearCache(cfg);

    return {
      success: true,
      imported: matched.length,
      discarded: parsedRows.length - matched.length,
      totalInput: parsedRows.length,
      count: matched.length,
      message: 'Ingested ' + matched.length + ' of ' + parsedRows.length + ' survey rows.'
    };
  }

  /**
   * Maps survey type labels to batch-view keys (MDS/PGL).
   * @param {string} surveyType
   * @return {string}
   * @private
   */
  function _normalizeCsatSurveyTypeKey_(surveyType) {
    var s = String(surveyType || '').trim().toUpperCase();
    if (s === 'MGM' || s === 'MDS') return 'MDS';
    if (s === 'PGL') return 'PGL';
    return s;
  }

  /**
   * Builds a lookup map from batch rows for enriching in-flight survey rows.
   * @param {Object} upcomingBatches
   * @return {Object<string, {targetGoLive:string, deliveryDirector:string}>}
   * @private
   */
  function _buildCsatBatchLookup_(upcomingBatches) {
    var lookup = {};
    var groups = (upcomingBatches && upcomingBatches.groups) ? upcomingBatches.groups : [];
    groups.forEach(function (g) {
      (g.mdsRows || []).concat(g.pglRows || []).forEach(function (row) {
        var depId = _canonicalId_(row.deploymentId);
        var typeKey = _normalizeCsatSurveyTypeKey_(row.surveyType);
        if (!depId || !typeKey) return;
        var key = depId + '|' + typeKey;
        lookup[key] = {
          targetGoLive: row.targetDate || row.eventDate || '',
          deliveryDirector: row.deliveryDirector || ''
        };
      });
    });
    return lookup;
  }

  /**
   * Enriches in-flight UI rows with target go-live and DD from batch data.
   * @param {Array<Object>} inFlightRows
   * @param {Object} lookup
   * @private
   */
  function _enrichCsatInFlightRows_(inFlightRows, lookup) {
    (inFlightRows || []).forEach(function (row) {
      var key = _canonicalId_(row.deploymentId) + '|' +
        _normalizeCsatSurveyTypeKey_(row.surveyType);
      var match = lookup[key];
      if (match) {
        if (match.targetGoLive) row.targetGoLive = match.targetGoLive;
        var dd = String(row.deliveryDirector || '').trim();
        if (match.deliveryDirector && (!dd || dd === '\u2014')) {
          row.deliveryDirector = match.deliveryDirector;
        }
      }
    });
  }

  /**
   * Computes persistent CSAT header card metrics.
   * @param {Array<Object>} inFlightRows
   * @param {Object} upcomingBatches
   * @param {{valid:Array, invalid:Array}} notificationValidation
   * @return {{inFlightCount:number, upcomingBatchCount:number, coveragePct:number, notificationStatus:string, invalidRuleCount:number}}
   * @private
   */
  function _buildCsatHeaderSummary_(inFlightRows, upcomingBatches, notificationValidation) {
    var inFlightCount = (inFlightRows || []).length;
    var batchRows = [];
    var groups = (upcomingBatches && upcomingBatches.groups) ? upcomingBatches.groups : [];
    groups.forEach(function (g) {
      batchRows = batchRows.concat(g.mdsRows || [], g.pglRows || []);
    });
    var upcomingBatchCount = batchRows.length;

    var inflightKeys = {};
    (inFlightRows || []).forEach(function (r) {
      var key = _canonicalId_(r.deploymentId) + '|' +
        _normalizeCsatSurveyTypeKey_(r.surveyType);
      if (key !== '|') inflightKeys[key] = true;
    });
    var covered = 0;
    batchRows.forEach(function (r) {
      var key = _canonicalId_(r.deploymentId) + '|' +
        _normalizeCsatSurveyTypeKey_(r.surveyType);
      if (inflightKeys[key]) covered++;
    });
    var coveragePct = upcomingBatchCount > 0
      ? Math.round((covered / upcomingBatchCount) * 1000) / 10
      : (inFlightCount > 0 ? 100 : 0);

    var invalidCount = (notificationValidation && notificationValidation.invalid)
      ? notificationValidation.invalid.length : 0;
    var notificationStatus = invalidCount > 0
      ? (invalidCount + ' invalid rule' + (invalidCount === 1 ? '' : 's'))
      : 'All rules valid';

    return {
      inFlightCount: inFlightCount,
      upcomingBatchCount: upcomingBatchCount,
      coveragePct: coveragePct,
      notificationStatus: notificationStatus,
      invalidRuleCount: invalidCount
    };
  }

  /**
   * Returns true when a ReportDistributionLog row is a CSAT survey notification.
   * @param {Object} row
   * @return {boolean}
   * @private
   */
  function _isCsatSurveyNotificationLogRow_(row) {
    if (String(row.category || '').trim() === 'Survey Notification') return true;
    var key = String(row.notificationKey || '').trim();
    if (/^em_reminder_/.test(key) || key === 'dd_digest') return true;
    return false;
  }

  /**
   * Reads ReportDistributionLog rows filtered to CSAT survey notifications only.
   * Excludes monthly report distribution rows.
   *
   * @param {AppConfig} config
   * @return {{rows:Array<Object>, total:number}}
   */
  function getDistributionLogDataForUI(config) {
    var cfg = CoreConfig.withDefaults(config);
    Logger.log('CoreData.getDistributionLogDataForUI: appId=' + cfg.appId);

    CoreDistribute.initReportDistributionLog(cfg);
    var sheetName = (cfg.report.distribution && cfg.report.distribution.logSheet) ||
      'ReportDistributionLog';
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return { rows: [], total: 0 };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { rows: [], total: 0 };

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    var rows = [];
    values.forEach(function (cells) {
      var obj = {};
      for (var i = 0; i < headers.length; i++) {
        if (headers[i]) obj[headers[i]] = cells[i];
      }
      if (!_isCsatSurveyNotificationLogRow_(obj)) return;
      if (cfg.appId && obj.appId && String(obj.appId) !== String(cfg.appId)) return;
      rows.push(obj);
    });

    rows.sort(function (a, b) {
      return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    });

    return { rows: rows, total: rows.length };
  }

  /**
   * V2.8: unified CSAT tab payload — in-flight surveys, upcoming batches, exceptions.
   *
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {number=} windowMonths
   * @return {Object}
   */
  function getCsatTabDataForUI(config, viewModeOpts, windowMonths, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var horizonMonths = (windowMonths === 6) ? 6 : 3;
    Logger.log('CoreData.getCsatTabDataForUI: appId=' + cfg.appId +
               ', horizon=' + horizonMonths);

    var masterDeps = getDeploymentMaster_(cfg) || [];
    var totalMasterDeployments = masterDeps.length;

    var rawRows = _readCsatInFlightRows_(cfg);
    var inFlightRows = rawRows.map(function (r) {
      return {
        deploymentId:       r.deployment_id || '\u2014',
        accountName:        r.account_name || '\u2014',
        deploymentName:     r.deployment_name || '',
        surveyType:         r.survey_type || '',
        trackingStatus:     r.tracking_status || 'Sent',
        responseReceived:   r.response_received || '',
        contactName:        r.contact_name || '\u2014',
        contactEmail:       r.contact_email || '',
        contactRole:        r.contact_role || '',
        engagementManager:  r.engagement_manager || '',
        partner:            r.partner_name || '',
        sentDate:           _formatUiDate_(r.sent_date),
        openedDate:         _formatUiDate_(r.opened_date),
        startedDate:        _formatUiDate_(r.started_date),
        finishedDate:       _formatUiDate_(r.finished_date),
        surveyExpires:      _formatUiDate_(r.survey_expires || r.target_go_live)
      };
    });

    var upcomingBatches = getMdsPglBatchView(cfg, viewModeOpts, horizonMonths, productOpts);

    var distinctDepIds = {};
    inFlightRows.forEach(function (row) {
      var id = _canonicalId_(row.deploymentId);
      if (id) distinctDepIds[id] = true;
    });
    var distinctCount = Object.keys(distinctDepIds).length;
    var coveragePct = totalMasterDeployments > 0
      ? Math.round((distinctCount / totalMasterDeployments) * 100)
      : 0;
    var kpis = _buildCsatInFlightKPIs_(inFlightRows);

    var notificationValidation = { valid: [], invalid: [] };
    var notificationRules = [];
    try {
      notificationValidation = CoreNotify.validateNotificationConfig(cfg);
      notificationRules = notificationValidation.valid.concat(notificationValidation.invalid);
    } catch (e) {
      Logger.log('CoreData.getCsatTabDataForUI: notification validation failed: ' + e);
    }

    var headerSummary = _buildCsatHeaderSummary_(
      inFlightRows, upcomingBatches, notificationValidation);
    headerSummary.inFlightCount = inFlightRows.length;
    headerSummary.coveragePct = coveragePct;

    var notificationKeys = [];
    try {
      notificationKeys = CoreNotify.getNotificationKeysForMenu(cfg);
    } catch (e) {
      Logger.log('CoreData.getCsatTabDataForUI: notification keys failed: ' + e);
    }

    var importedAt = _getCsatLastImportAt_(cfg);
    var freshnessStr = 'Qualtrics data freshness: ' +
      (importedAt
        ? Utilities.formatDate(new Date(importedAt), Session.getScriptTimeZone(), 'MMM d, yyyy, hh:mm a')
        : 'no import yet');

    try {
      var _bytes = JSON.stringify({ rows: inFlightRows, upcomingBatches: upcomingBatches,
        notificationRules: notificationRules }).length;
      Logger.log('getCsatTabDataForUI OK: rows=' + inFlightRows.length +
        ', batchGroups=' + (upcomingBatches && upcomingBatches.groups ? upcomingBatches.groups.length : 'MISSING') +
        ', bytes=' + _bytes);
    } catch (ser) {
      Logger.log('getCsatTabDataForUI SERIALIZE FAIL: ' + ser);
    }

    return {
      success:          true,
      lastUpdatedText:  freshnessStr,
      coveragePct:      coveragePct,
      kpis:             kpis,
      rows:             inFlightRows,
      inFlightRows:     inFlightRows,
      upcomingBatches:  upcomingBatches,
      exceptions:       upcomingBatches.exceptions || [],
      notificationKeys: notificationKeys,
      notificationRules: notificationRules,
      notificationValidation: notificationValidation,
      headerSummary:    headerSummary,
      horizonMonths:    horizonMonths,
      asOf:             new Date().toISOString()
    };
  }

  // ===========================================================================
  // MGM / PGL: UPCOMING SURVEYS (legacy — to be removed after C3 is deployed)
  // ===========================================================================

  /**
   * Returns upcoming MGM and PGL survey events within a configurable time window
   * for all Active deployments, respecting viewMode.
   *
   * MGM (Mid-Deployment Survey): scheduled at 1/3 of the deployment duration
   *   from Deployment_Start_Date__c to the product target go-live date.
   * PGL (Post-Go-Live Survey): scheduled 2 months after the go-live date
   *   (Actual preferred, then Target).
   *
   * Grouping (phased deployments): one survey event per (deployment × go-live date)
   *   rather than one per product-function row.
   *
   * @param {AppConfig} config
   * @param {Object=}   viewModeOpts
   *   {
   *     viewMode:      'my' | 'all',
   *     ddDisplayName: string,
   *     window:        'next30' | 'thisMonth' | 'nextMonth' | 'thisQuarter' | 'nextQuarter'
   *   }
   * @return {{ windowDays:number, today:string, startDate:string, endDate:string, rows:Array, exceptions:Array }}
   */
  function getUpcomingSurveys(config, viewModeOpts) {
  var cfg = CoreConfig.withDefaults(config);
  var tz  = Session.getScriptTimeZone();
  var now = new Date();
  now.setHours(0, 0, 0, 0);
  var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  // -----------------------------------------------------------------------
  // TIME WINDOW
  // -----------------------------------------------------------------------
  var windowKey   = (viewModeOpts && viewModeOpts.window) || 'next30';
  var winResolved = resolveMgmPglWindow_(windowKey);
  var windowStartKey = winResolved.startDate;
  var windowEndKey   = winResolved.endDate;
  var windowDays     = winResolved.windowDays;

  // -----------------------------------------------------------------------
  // TIME HELPERS
  // -----------------------------------------------------------------------

  /** Whole days between two 'YYYY-MM-DD' strings (non-negative). */
  function daysBetween_(d1, d2) {
    var t1 = new Date(d1).getTime();
    var t2 = new Date(d2).getTime();
    return Math.max(0, Math.round(Math.abs(t2 - t1) / 86400000));
  }

  /** Add n calendar months to 'YYYY-MM-DD'. Returns 'YYYY-MM-DD' or null. */
  function addMonths_(dateStr, n) {
    if (!dateStr) return null;
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    var result = new Date(d);
    result.setMonth(result.getMonth() + n);
    return Utilities.formatDate(result, tz, 'yyyy-MM-dd');
  }

  /** Add n whole days to 'YYYY-MM-DD'. Returns 'YYYY-MM-DD'. */
  function addDays_(dateStr, n) {
    var d = new Date(dateStr);
    return Utilities.formatDate(new Date(d.getTime() + n * 86400000), tz, 'yyyy-MM-dd');
  }

  /** True if dateStr falls in [windowStart, windowEnd]. */
  function inWindow_(dateStr) {
    return dateStr >= windowStartKey && dateStr <= windowEndKey;
  }

  /** Days from today to dateStr (>=0). */
  function daysUntil_(dateStr) {
    return Math.max(0, Math.round((new Date(dateStr).getTime() - now.getTime()) / 86400000));
  }

  // -----------------------------------------------------------------------
  // DATA LOAD
  // -----------------------------------------------------------------------

  // Active deployments (already viewMode-filtered).
  var activeDeployments = getAllDeployments(config, viewModeOpts);

  // Build lookup: deploymentId -> raw SFDC row (for deploymentStart + firstMtpDateActual).
  var startDateMap      = {};
  var firstMtpActualMap = {};
  try {
    var rawRows = readSfdcDeploymentsRaw_(cfg);
    rawRows.forEach(function (r) {
      if (r.deploymentStart)    startDateMap[r.deploymentId]      = r.deploymentStart;
      if (r.firstMtpDateActual) firstMtpActualMap[r.deploymentId] = r.firstMtpDateActual;
    });
  } catch (e) {
    Logger.log('CoreData.getUpcomingSurveys: readSfdcDeploymentsRaw_ failed: ' + e);
  }

  // Product-function rows grouped by deploymentId.
  var productsByDeployment = {};
  try {
    var pfRows = readSfdcProductFunctionsRaw_(cfg);
    pfRows.forEach(function (pf) {
      if (!pf.deploymentFk) return;
      if (!productsByDeployment[pf.deploymentFk]) {
        productsByDeployment[pf.deploymentFk] = [];
      }
      productsByDeployment[pf.deploymentFk].push(pf);
    });
  } catch (e) {
    Logger.log('CoreData.getUpcomingSurveys: readSfdcProductFunctionsRaw_ failed: ' + e);
  }

  // Contacts map (gracefully empty if sheet missing).
  var contactsMap = {};
  try {
    contactsMap = getDeploymentContactsMap_(cfg);
  } catch (e) {
    Logger.log('CoreData.getUpcomingSurveys: getDeploymentContactsMap_ failed: ' + e);
  }

  // -----------------------------------------------------------------------
  // SURVEY CALCULATION
  // -----------------------------------------------------------------------

  var surveyRows    = [];
  var exceptionRows = [];
  var exceptionSeen = {};

  activeDeployments.forEach(function (dep) {
    var depId           = dep.deploymentId;
    var depStart        = startDateMap[depId]      || '';
    var depTargetEnd    = dep.mtpDate              || '';
    var depActualGoLive = firstMtpActualMap[depId] || '';
    var products        = productsByDeployment[depId] || [];
    var contacts        = contactsMap[depId] || null;

    // -------------------------------------------------------------------
    // NEW FILTER: Only include deployments where Deployment_Partner_Name__c
    //            is 'Workday Professional Services'.
    //
    // NOTE: This assumes CoreData.getAllDeployments mapped
    //       Deployment_Partner_Name__c to dep.partner.
    //       If it's mapped under a different property (e.g. dep.deploymentPartnerName),
    //       replace dep.partner accordingly.
    // -------------------------------------------------------------------
    if (dep.partner !== 'Workday Professional Services') {
      return;
    }

    /** Push a survey row. */
    function pushSurvey_(surveyType, status, scheduledDate, productLabel) {
      surveyRows.push({
        surveyType:               surveyType,
        status:                   status,
        deploymentId:             depId,
        accountName:              dep.accountName,
        deploymentName:           dep.deploymentName,
        productLabel:             productLabel,
        scheduledDate:            scheduledDate,
        daysUntil:                daysUntil_(scheduledDate),
        deploymentStartDate:      depStart     || null,
        deploymentTargetEndDate:  depTargetEnd || null,
        projectManagerContacts:   contacts ? contacts.projectManagers    : [],
        execSponsorContacts:      contacts ? contacts.execSponsors       : [],
        wdSponsor:                contacts ? contacts.wdSponsor          : null,
        engagementManagers:       contacts ? contacts.engagementManagers : []
      });
    }

    /** Push an exception row (at most once per deployment). */
    function pushException_(missingType, hasProducts) {
      if (exceptionSeen[depId]) return;
      exceptionSeen[depId] = true;
      exceptionRows.push({
        deploymentId:        depId,
        accountName:         dep.accountName,
        deploymentName:      dep.deploymentName,
        deploymentStartDate: depStart || null,
        missingType:         missingType,
        hasProducts:         hasProducts,
        deliveryDirector:    dep.deliveryDirector || null
      });
    }

    if (products.length > 0) {
      // ---- PHASED: group by go-live date ----

      // Build MGM buckets: { targetGoLiveDate: [ pfRows ] }
      var mgmBuckets = {};
      var anyMissingTarget = false;

      products.forEach(function (pf) {
        var pfTarget = pf.targetGoLive || '';
        if (pfTarget) {
          if (!mgmBuckets[pfTarget]) mgmBuckets[pfTarget] = [];
          mgmBuckets[pfTarget].push(pf);
        } else {
          anyMissingTarget = true;
        }
      });

      // Build PGL buckets: { pglDate: [ pfRows ] }
      // Key on pglDate (= goLiveBaseDate + 2 months); track pglStatus per bucket.
      var pglBuckets = {};  // { pglDate: { rows: [], status: 'Actual'|'Planned' } }

      products.forEach(function (pf) {
        var pfActual = pf.actualGoLive || '';
        var pfTarget = pf.targetGoLive || '';
        var goLiveBase, pglStatus;
        if (pfActual) {
          goLiveBase = pfActual;
          pglStatus  = 'Actual';
        } else if (pfTarget) {
          goLiveBase = pfTarget;
          pglStatus  = 'Planned';
        } else {
          return;
        }
        var pglDate = addMonths_(goLiveBase, 2);
        if (!pglDate) return;
        if (!pglBuckets[pglDate]) {
          pglBuckets[pglDate] = { rows: [], status: pglStatus };
        }
        pglBuckets[pglDate].rows.push(pf);
        // Upgrade status to 'Actual' if any row in this bucket has an actual date.
        if (pglStatus === 'Actual') pglBuckets[pglDate].status = 'Actual';
      });

      // Emit one MGM event per distinct targetGoLiveDate bucket.
      Object.keys(mgmBuckets).forEach(function (pfTarget) {
        if (depStart && pfTarget > depStart) {
          var dur     = daysBetween_(depStart, pfTarget);
          var mgmDate = addDays_(depStart, Math.round(dur / 3));
          if (inWindow_(mgmDate)) {
            var label = buildProductPhaseLabel_(mgmBuckets[pfTarget]);
            pushSurvey_('MGM', 'Planned', mgmDate, label || '(Unknown)');
          }
        }
      });

      // Emit one PGL event per distinct pglDate bucket.
      Object.keys(pglBuckets).forEach(function (pglDate) {
        if (inWindow_(pglDate)) {
          var bucket = pglBuckets[pglDate];
          var label  = buildProductPhaseLabel_(bucket.rows);
          pushSurvey_('PGL', bucket.status, pglDate, label || '(Unknown)');
        }
      });

      if (anyMissingTarget) pushException_('ProductTargets', true);

    } else {
      // ---- BIG-BANG: deployment-level MGM + PGL ----

      // --- Deployment-level MGM ---
      if (depStart && depTargetEnd && depTargetEnd > depStart) {
        var dur     = daysBetween_(depStart, depTargetEnd);
        var mgmDate = addDays_(depStart, Math.round(dur / 3));
        if (inWindow_(mgmDate)) {
          pushSurvey_('MGM', 'Planned', mgmDate, '(Overall Deployment)');
        }
      } else if (depStart && !depTargetEnd) {
        pushException_('DeploymentTargetEnd', false);
      }

      // --- Deployment-level PGL ---
      var pglDate   = null;
      var pglStatus = null;
      if (depActualGoLive) {
        pglDate   = addMonths_(depActualGoLive, 2);
        pglStatus = 'Actual';
      } else if (depTargetEnd) {
        pglDate   = addMonths_(depTargetEnd, 2);
        pglStatus = 'Planned';
      }
      if (pglDate && inWindow_(pglDate)) {
        pushSurvey_('PGL', pglStatus, pglDate, '(Overall Deployment)');
      }
    }
  });

  // Sort survey rows by scheduledDate ascending, then accountName.
  surveyRows.sort(function (a, b) {
    if (a.scheduledDate < b.scheduledDate) return -1;
    if (a.scheduledDate > b.scheduledDate) return  1;
    return String(a.accountName || '').localeCompare(String(b.accountName || ''));
  });

  Logger.log('CoreData.getUpcomingSurveys: ' + surveyRows.length + ' survey rows, ' +
             exceptionRows.length + ' exceptions. Window: ' + windowStartKey +
             ' to ' + windowEndKey + ' (' + windowKey + ').');

  return {
    windowDays: windowDays,
    today:      todayKey,
    startDate:  windowStartKey,
    endDate:    windowEndKey,
    windowKey:  windowKey,
    rows:       surveyRows,
    exceptions: exceptionRows
  };
}

  // ===========================================================================
  // OVERVIEW SNAPSHOT (C11b)
  // ===========================================================================

  /**
   * Normalises a deployment stage value for bucket matching.
   * @param {string} s
   * @return {string}
   * @private
   */
  function _normalizeStage_(s) {
    return String(s || '')
      .replace(/&/g, 'and')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Maps a deployment stage to its lifecycle bucket.
   * @param {string} stage
   * @return {'starting'|'building'|'landing'|'other'}
   * @private
   */
  function _bucketForStage_(stage) {
    var s = _normalizeStage_(stage);
    if (s === 'on-boarding' || s === 'plan') return 'starting';
    if (s === 'architect and configure' || s === 'configure and prototype' || s === 'test') return 'building';
    if (s === 'deploy' || s === 'post prod') return 'landing';
    return 'other';
  }

  /**
   * Normalizes a date value to a YYYY-MM-DD key in the script timezone.
   * Returns '' for blank or unparseable values (same parsing rules as formatShortDate_).
   * @param {*} val
   * @return {string}
   * @private
   */
  function _toDateKey_(val) {
    if (val == null || val === '') return '';
    var key = formatShortDate_(val);
    return (key && key !== '\u2014') ? key : '';
  }

  /**
   * True when dateKey falls in [startKey, endKey] (inclusive), using YYYY-MM-DD keys.
   * @param {string} dateKey
   * @param {string} startKey
   * @param {string} endKey
   * @return {boolean}
   * @private
   */
  function _dateKeyInRange_(dateKey, startKey, endKey) {
    if (!dateKey || !startKey || !endKey) return false;
    return dateKey >= startKey && dateKey <= endKey;
  }

  /**
   * Earliest upcoming go-live date for a getUpcomingGoLives row within an inclusive
   * YYYY-MM-DD window. Checks upcomingDates[] first (phased/multi-date), then
   * nextGoLiveDate / mtpDate — matching Go Lives tab date sources.
   * @param {Object} row
   * @param {string} startKey 'YYYY-MM-DD'
   * @param {string} endKey   'YYYY-MM-DD'
   * @return {string|null} earliest in-window date key, or null
   * @private
   */
  function _earliestUpcomingDateInRange_(row, startKey, endKey) {
    if (!row) return null;
    var keys = [];
    (row.upcomingDates || []).forEach(function (ud) {
      if (!ud || !ud.date) return;
      var k = _toDateKey_(ud.date);
      if (k && _dateKeyInRange_(k, startKey, endKey)) keys.push(k);
    });
    var primary = _toDateKey_(row.nextGoLiveDate || row.mtpDate);
    if (primary && _dateKeyInRange_(primary, startKey, endKey)) keys.push(primary);
    if (keys.length === 0) return null;
    keys.sort();
    return keys[0];
  }

  /**
   * Filters recentDates[] to in-window entries with normalized YYYY-MM-DD keys.
   * @param {Array<Object>} recentDates
   * @param {string} startKey 'YYYY-MM-DD'
   * @param {string} endKey   'YYYY-MM-DD'
   * @return {Array<{date:string, products:Array}>}
   * @private
   */
  function _filterRecentDatesInWindow_(recentDates, startKey, endKey) {
    var out = [];
    (recentDates || []).forEach(function (rd) {
      if (!rd || rd.date == null || rd.date === '') return;
      var k = _toDateKey_(rd.date);
      if (k && _dateKeyInRange_(k, startKey, endKey)) {
        out.push({ date: k, products: rd.products || [] });
      }
    });
    return out;
  }

  /**
   * Deployment-level fallback for recent go-live when product-function Actual dates
   * are absent. Prefers First_Move_to_Production_Date_Actual__c, then first MTP,
   * then completion date — all normalized via _toDateKey_().
   * @param {Object} dep
   * @return {string}
   * @private
   */
  function _deploymentRecentFallbackDateKey_(dep) {
    if (!dep) return '';
    return _toDateKey_(dep.firstMtpDateActual || dep.firstMtpDate || dep.completionDate);
  }

  /**
   * Latest in-window recent go-live for a deployment. Checks recentDates[] first
   * (phased/multi-date), then deployment-level Actual/first-MTP/completion fallback.
   * @param {Object} dep
   * @param {Array<Object>} allRecentDates enrichment.recentDates (may be empty)
   * @param {string} startKey 'YYYY-MM-DD'
   * @param {string} endKey   'YYYY-MM-DD'
   * @return {{filteredRecentDates:Array<Object>, lastGoLiveDate:string}|null}
   * @private
   */
  function _latestRecentDateInRange_(dep, allRecentDates, startKey, endKey) {
    var filtered = _filterRecentDatesInWindow_(allRecentDates, startKey, endKey);
    if (filtered.length > 0) {
      var keys = filtered.map(function (rd) { return rd.date; });
      keys.sort();
      return { filteredRecentDates: filtered, lastGoLiveDate: keys[keys.length - 1] };
    }
    var fb = _deploymentRecentFallbackDateKey_(dep);
    if (fb && _dateKeyInRange_(fb, startKey, endKey)) {
      return {
        filteredRecentDates: [{ date: fb, products: [] }],
        lastGoLiveDate:      fb
      };
    }
    return null;
  }

  /**
   * Adds N calendar days to a YYYY-MM-DD key string and returns a new key.
   * @param {string} yearMonthDay 'YYYY-MM-DD'
   * @param {number} days
   * @return {string} 'YYYY-MM-DD'
   * @private
   */
  function _addDaysToKey_(yearMonthDay, days) {
    if (!yearMonthDay) return '';
    var parts = String(yearMonthDay).split('-');
    if (parts.length !== 3) return '';
    var d = new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );
    d.setDate(d.getDate() + days);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  /**
   * Computes the overview snapshot payload from live SFDC rows.
   * @param {AppConfig} cfg
   * @return {Object}
   * @private
   */
  function _computeOverviewSnapshot_(cfg, viewModeOpts, productOpts) {
    var tz = Session.getScriptTimeZone();
    var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var pa = (productOpts && productOpts.product) || 'all';

    var activeRows;
    if (usesProductModePfDataSource_(cfg)) {
      activeRows = getActiveCountDeployments(cfg, productOpts) || [];
      activeRows = filterDeploymentsByStudent_(activeRows, 'exclude', cfg);
    } else {
      var allRows = readSfdcDeploymentsRaw_(cfg);
      allRows = filterDeploymentsByStudent_(allRows, 'exclude', cfg);
      allRows = filterDeploymentsByProduct_(allRows, pa, cfg);
      activeRows = allRows.filter(function (r) { return r.overallStatus === 'Active'; });
    }

    // TOTALS
    var totalActive    = activeRows.length;
    var redCount       = activeRows.filter(function(r) { return r.health === 'Red'; }).length;
    var yellowCount    = activeRows.filter(function(r) { return r.health === 'Yellow'; }).length;
    var greenCount     = activeRows.filter(function(r) { return r.health === 'Green'; }).length;
    var ewCount        = activeRows.filter(function(r) { return r.isExecutiveWatch; }).length;

    // TOP HIGH RISK — ProductMode uses PF go-live events; IndustryMode uses active deployment MTP.
    var topHighRisk = [];
    if (usesProductModePfGoLiveSource_(cfg)) {
      topHighRisk = _buildProductModeOverviewNextHighRisk_(cfg, todayKey, productOpts, 5);
    } else {
      var highRiskCandidates = activeRows.filter(function(r) {
        return (r.health === 'Red' || r.health === 'Yellow') && r.mtpDate && r.mtpDate >= todayKey;
      });
      highRiskCandidates.sort(function(a, b) {
        if (a.mtpDate < b.mtpDate) return -1;
        if (a.mtpDate > b.mtpDate) return 1;
        var an = (a.accountName || '').toLowerCase();
        var bn = (b.accountName || '').toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
      topHighRisk = highRiskCandidates.slice(0, 5).map(function(r) {
        return {
          deploymentId:   r.deploymentId,
          accountName:    r.accountName,
          deploymentName: r.deploymentName,
          partner:        r.partner,
          health:         r.health,
          currentMtp:     r.mtpDate
        };
      });
    }

    // UPCOMING GO LIVES — delegate to getUpcomingGoLives for parity with the Go Lives tab (C12 fix).
    // getUpcomingGoLives handles phased deployments (per-product target dates), override exclusions,
    // and partner overrides — matching exactly what the Go Lives tab's upcoming view shows.
    var upcomingGoLivesPayload = [];
    try {
      upcomingGoLivesPayload = getUpcomingGoLives(cfg, viewModeOpts, productOpts) || [];
    } catch (err) {
      Logger.log('_computeOverviewSnapshot_: getUpcomingGoLives threw — upcoming card will render empty. Error: ' + err);
    }
    var thirtyAhead = _addDaysToKey_(todayKey, 30);
    var upcomingIn30 = [];
    if (usesProductModePfGoLiveSource_(cfg)) {
      upcomingIn30 = getProductModeGoLiveEvents_(cfg, {
        type: 'upcoming',
        startDate: todayKey,
        endDate: thirtyAhead,
        productOpts: productOpts
      }).map(function (r) {
        return { row: r, inWindowDate: r.goLiveDate || r.nextGoLiveDate || '' };
      });
    } else {
      upcomingGoLivesPayload.forEach(function (r) {
        var inWindowDate = _earliestUpcomingDateInRange_(r, todayKey, thirtyAhead);
        if (inWindowDate) {
          upcomingIn30.push({ row: r, inWindowDate: inWindowDate });
        }
      });
    }
    upcomingIn30.sort(function (a, b) {
      return a.inWindowDate < b.inWindowDate ? -1 : a.inWindowDate > b.inWindowDate ? 1 : 0;
    });
    var upcomingItems;
    var upcomingTotal;
    if (usesProductModePfGoLiveSource_(cfg)) {
      var upcomingMapped = upcomingIn30.map(function (entry) {
        var item = _mapProductModeGoLiveEventToOverviewItem_(entry.row);
        item.currentMtp = entry.inWindowDate || item.currentMtp || '';
        item.goLiveDate = item.currentMtp;
        item.targetGoLive = item.currentMtp;
        return item;
      });
      var upcomingDeduped = _dedupeProductModeOverviewGoLiveItems_(upcomingMapped);
      upcomingItems = upcomingDeduped.items.slice(0, 5);
      upcomingTotal = upcomingDeduped.items.length;
    } else {
      upcomingItems = upcomingIn30.slice(0, 5).map(function (entry) {
        var r = entry.row;
        return {
          deploymentId:   r.deploymentId || '',
          accountName:    r.accountName  || '',
          deploymentName: r.deploymentName || '',
          partner:        r.partner || '',
          currentMtp:     entry.inWindowDate || ''
        };
      });
      upcomingTotal = upcomingIn30.length;
    }
    var upcomingGoLivesBlock = { total: upcomingTotal, items: upcomingItems };

    // LIFECYCLE BUCKETS
    var buckets = {
      starting: { count: 0, stages: {} },
      building: { count: 0, stages: {} },
      landing:  { count: 0, stages: {} },
      other:    { count: 0, stages: {} }
    };
    activeRows.forEach(function(r) {
      var key = _bucketForStage_(r.stage);
      buckets[key].count++;
      if (r.stage) buckets[key].stages[r.stage] = true;
    });
    var lifecycleBuckets = {};
    ['starting', 'building', 'landing', 'other'].forEach(function(key) {
      var b = buckets[key];
      lifecycleBuckets[key] = {
        count:   b.count,
        percent: totalActive > 0 ? Math.round(b.count / totalActive * 100) : 0,
        stages:  Object.keys(b.stages).sort()
      };
    });

    return {
      totals: {
        totalActive:    totalActive,
        red:            redCount,
        yellow:         yellowCount,
        green:          greenCount,
        executiveWatch: ewCount
      },
      topHighRisk:      topHighRisk,
      upcomingGoLives:  upcomingGoLivesBlock,
      lifecycleBuckets: lifecycleBuckets,
      asOf:             new Date().toISOString()
    };
  }

  /**
   * Returns the Overview tab snapshot (totals, topHighRisk, upcomingGoLives,
   * lifecycleBuckets). Two-tier cached: in-memory + _PerfCache (5-min TTL).
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function getOverviewSnapshot(config, viewModeOpts, productOpts) {
    var cfg      = CoreConfig.withDefaults(config);
    var pa       = (productOpts && productOpts.product) || 'all';
    var useCache = (!viewModeOpts || !viewModeOpts.viewMode || viewModeOpts.viewMode === 'all') &&
      (pa === 'all' || !cfg.ui.productFilter || cfg.ui.productFilter.enabled !== true);
    var cacheKey = _perfKey_(cfg, 'overviewData:v7');

    if (useCache && _cache.overviewSnapshot !== null) return _cache.overviewSnapshot;

    if (useCache) {
      var cached = _perfCacheRead_(cacheKey);
      if (cached !== null) {
        _cache.overviewSnapshot = cached;
        return cached;
      }
    }

    var payload = _computeOverviewSnapshot_(cfg, viewModeOpts, productOpts);
    if (useCache) {
      _cache.overviewSnapshot = payload;
      _perfCacheWrite_(cacheKey, payload);
    }
    Logger.log('CoreData.getOverviewSnapshot(' + cfg.appId + '): computed fresh snapshot. totalActive=' +
               (payload.totals && payload.totals.totalActive));
    return payload;
  }

  /**
   * Diagnostic for Overview Next High Risk widget (ProductMode go-live grouping).
   * @param {AppConfig} config
   * @param {Object=} productOpts
   * @return {Object}
   */
  function _debugOverviewNextHighRisk(config, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var pa = (productOpts && productOpts.product) || 'all';
    var tz = Session.getScriptTimeZone();
    var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var highRiskEndKey = _addDaysToKey_(todayKey,
      (cfg.salesforce && cfg.salesforce.upcomingWindowDays) || 90);
    var usesPfGoLive = usesProductModePfGoLiveSource_(cfg);

    var rawPfTargetCount = 0;
    var redYellowPfCount = 0;
    var groupedAccountDateEventCount = 0;
    var sampleDuplicateCandidates = [];

    if (usesPfGoLive) {
      var pfRows = getProductModeHistoricalPfRows_(cfg, { product: pa });
      var goLivesOverrides = getGoLivesOverridesMap_(cfg);
      var rawDetails = _collectProductModeGoLivePfDetails_(
        pfRows, cfg, 'target', todayKey, highRiskEndKey, goLivesOverrides);
      rawPfTargetCount = rawDetails.length;
      redYellowPfCount = rawDetails.filter(function (d) {
        return d.health === 'Red' || d.health === 'Yellow';
      }).length;
      var grouped = _groupProductModeGoLivePfDetails_(rawDetails);
      groupedAccountDateEventCount = grouped.groupedEventCount;

      var byAcctDate = {};
      rawDetails.forEach(function (d) {
        if (d.health !== 'Red' && d.health !== 'Yellow') return;
        var k = _productModeGoLiveEventKey_(d.accountId, d.accountName, d.goLiveDate, d.goLiveType);
        if (!byAcctDate[k]) byAcctDate[k] = [];
        byAcctDate[k].push(d);
      });
      Object.keys(byAcctDate).forEach(function (k) {
        if (byAcctDate[k].length < 2 || sampleDuplicateCandidates.length >= 5) return;
        sampleDuplicateCandidates.push({
          eventKey: k,
          accountName: byAcctDate[k][0].accountName,
          goLiveDate: byAcctDate[k][0].goLiveDate,
          pfRowCount: byAcctDate[k].length,
          productAreas: byAcctDate[k].map(function (d) { return d.productArea; }),
          functions: byAcctDate[k].map(function (d) { return d.funcArea; })
        });
      });
    }

    var snapshot = _computeOverviewSnapshot_(cfg, { viewMode: 'all' }, { product: pa });
    var finalItems = snapshot.topHighRisk || [];
    var keyCounts = {};
    var duplicateAccountDateKeysInPayload = 0;
    finalItems.forEach(function (item) {
      var k = _overviewGoLiveItemEventKey_(item);
      keyCounts[k] = (keyCounts[k] || 0) + 1;
    });
    Object.keys(keyCounts).forEach(function (k) {
      if (keyCounts[k] > 1) duplicateAccountDateKeysInPayload++;
    });

    var warning = duplicateAccountDateKeysInPayload > 0
      ? 'WARNING: Overview Next High Risk payload still contains duplicate account/date events.'
      : null;

    var report = {
      appId: cfg.appId || '',
      productModeSourceMode: _getProductModeSourceMode_(cfg),
      productModeDisplayGrain: _getProductModeDisplayGrain_(cfg),
      productModeCountGrain: _getProductModeCountGrain_(cfg),
      productModeGoLiveGrain: _getProductModeGoLiveGrain_(cfg),
      productModePfGoLiveSourceActive: usesPfGoLive,
      overviewPayloadField: 'topHighRisk',
      rawPfTargetRowsInWindow: rawPfTargetCount,
      redYellowPfCandidateRows: redYellowPfCount,
      groupedAccountDateEventCount: groupedAccountDateEventCount,
      finalOverviewNextHighRiskCount: finalItems.length,
      duplicateAccountDateKeysInPayload: duplicateAccountDateKeysInPayload,
      warning: warning,
      sampleFinalNextHighRiskRows: finalItems.map(function (r) {
        return {
          accountId: r.accountId,
          accountName: r.accountName,
          goLiveDate: r.goLiveDate || r.currentMtp,
          health: r.health,
          displayLabel: r.displayLabel,
          displayDeploymentName: r.displayDeploymentName,
          productFunctionCount: r.productFunctionCount,
          productAreas: r.productAreas,
          functions: r.functions,
          eventKey: r.eventKey || _overviewGoLiveItemEventKey_(r)
        };
      }),
      sampleDuplicateCandidatesBeforeGrouping: sampleDuplicateCandidates
    };

    Logger.log('=== _debugOverviewNextHighRisk(' + (cfg.appId || '?') + ') ===');
    Logger.log('  report=' + JSON.stringify(report));
    if (warning) Logger.log('  ' + warning);
    return report;
  }

  /**
   * Diagnostic: logs the overview snapshot payload shape.
   * @param {AppConfig} config
   */
  function _debugOverviewSnapshot_(config) {
    var cfg     = CoreConfig.withDefaults(config);
    var payload = getOverviewSnapshot(cfg);
    Logger.log('=== _debugOverviewSnapshot ===');
    Logger.log('asOf: ' + payload.asOf);
    Logger.log('totals: ' + JSON.stringify(payload.totals));
    Logger.log('topHighRisk count: ' + payload.topHighRisk.length);
    payload.topHighRisk.forEach(function(r, i) {
      Logger.log('  ' + (i + 1) + '. ' + r.health + ' | ' + r.accountName + ' | ' + r.currentMtp);
    });
    Logger.log('upcomingGoLives total: ' + payload.upcomingGoLives.total);
    Logger.log('lifecycleBuckets: ' + JSON.stringify(payload.lifecycleBuckets));
  }

  // ===========================================================================
  // D1: DIAGNOSTIC HELPER
  // ===========================================================================

  /**
   * Diagnostic helper. Logs deployments with 0 Deployment Sponsor contacts
   * (potential data-quality gaps) and with >1 (multi-sponsor deployments,
   * expected but worth surfacing).
   *
   * Reads live effective deployments and the DD-from-Contacts map.
   * Prints:
   *   - Total effective deployments
   *   - Count with 0 contacts, sample of up to 20 (accountName, deploymentName, deploymentId)
   *   - Count with >1 contacts, sample of up to 20 with resolved DD string
   *   - Count with exactly 1 contact
   *
   * Runs on demand from the Apps Script editor. No UI surface. No sheet output.
   *
   * @param {AppConfig} config
   */
  function _debugDdFromContacts_(config) {
    var cfg = CoreConfig.withDefaults(config);
    Logger.log('=== _debugDdFromContacts_(' + (cfg.appId || '?') + ') ===');

    var effective = [];
    try { effective = getAllEffectiveDeployments(cfg); }
    catch (e) { Logger.log('_debugDdFromContacts_: getAllEffectiveDeployments failed: ' + e); }

    var ddMap = {};
    try { ddMap = getDdAssignmentsFromContacts_(cfg) || {}; }
    catch (e) { Logger.log('_debugDdFromContacts_: getDdAssignmentsFromContacts_ failed: ' + e); }

    Logger.log('Total effective deployments: ' + effective.length);

    var zero = [];
    var multi = [];
    var single = 0;

    effective.forEach(function (r) {
      var contacts = ddMap[r.deploymentId] || [];
      if (contacts.length === 0) {
        zero.push(r);
      } else if (contacts.length === 1) {
        single++;
      } else {
        multi.push({ row: r, contacts: contacts });
      }
    });

    Logger.log('0-contact deployments: ' + zero.length);
    zero.slice(0, 20).forEach(function (r, i) {
      Logger.log('  zero[' + i + ']: accountName=' + (r.accountName || '') +
                 ', deploymentName=' + (r.deploymentName || '') +
                 ', deploymentId=' + (r.deploymentId || ''));
    });

    Logger.log('>1-contact deployments: ' + multi.length);
    multi.slice(0, 20).forEach(function (m, i) {
      var r = m.row;
      var resolved = m.contacts.map(function (c) { return c.name || c.email; }).filter(Boolean).join(', ');
      var emails = m.contacts.map(function (c) { return c.email; }).join(', ');
      Logger.log('  multi[' + i + ']: accountName=' + (r.accountName || '') +
                 ', deploymentName=' + (r.deploymentName || '') +
                 ', deploymentId=' + (r.deploymentId || '') +
                 ', resolvedDD="' + resolved + '"' +
                 ', emails=[' + emails + ']');
    });

    Logger.log('1-contact deployments: ' + single);
    Logger.log('=== end _debugDdFromContacts_ ===');
  }

  // ===========================================================================
  // ===========================================================================
  // S1: STUDENT DATA LAYER
  // ===========================================================================

  /**
   * Filters a rows array by Student inclusion. Works on deployment rows,
   * go-live rows, or any row shape with a `deploymentId` field.
   *
   * @param {Array<Object>} rows
   * @param {'exclude'|'only'} mode
   * @param {AppConfig} cfg
   * @return {Array<Object>} Filtered array. Returns rows unchanged when
   *   cfg.student?.enabled !== true (SLG/HC safety guarantee).
   */
  function filterDeploymentsByStudent_(rows, mode, cfg) {
    if (!cfg || !cfg.student || cfg.student.enabled !== true) return rows;
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    var studentIds = CoreSalesforce.getStudentDeploymentIds_(cfg) || {};
    if (mode === 'only') {
      return rows.filter(function (r) { return !!studentIds[r.deploymentId]; });
    }
    return rows.filter(function (r) { return !studentIds[r.deploymentId]; });
  }

  /**
   * Filters deployment-shaped rows to those belonging to the selected product area.
   * A deployment matches when EITHER signal is true (same union the connector scopes by):
   *   (1) deployment name contains a configured nameToken for the product area, or
   *   (2) a product-function row has Product_Area__c equal to productArea.
   * No-op when the feature is disabled or productArea is falsy/'all' (mirrors
   * filterDeploymentsByStudent_). Fail-open when product-function read fails.
   * @param {Array<Object>} rows  rows with a deploymentId field
   * @param {string} productArea  raw Product_Area__c value, or 'all'/'' for no filter
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   */
  function filterDeploymentsByProduct_(rows, productArea, cfg) {
    if (!cfg || !cfg.ui || !cfg.ui.productFilter || cfg.ui.productFilter.enabled !== true) return rows;
    if (!productArea || productArea === 'all') return rows;
    if (!Array.isArray(rows) || rows.length === 0) return rows;

    var pfCfg = cfg.ui.productFilter;
    var nameTokens = (pfCfg.nameTokens && pfCfg.nameTokens[productArea]) || [];
    var allowed = {};
    try {
      var pfRows = readSfdcProductFunctionsRaw_(cfg) || [];
      pfRows.forEach(function (pf) {
        if (String(pf.productArea || '').trim() === productArea && pf.deploymentFk) {
          allowed[_canonicalId_(pf.deploymentFk)] = true;
        }
      });
    } catch (e) {
      Logger.log('filterDeploymentsByProduct_: PF read failed: ' + e);
      return rows;
    }

    function matchesNameToken_(row) {
      if (!nameTokens.length) return false;
      var depName = String(row.deploymentName || row.name || '').toLowerCase();
      if (!depName) return false;
      for (var ti = 0; ti < nameTokens.length; ti++) {
        var token = String(nameTokens[ti] || '').toLowerCase();
        if (token && depName.indexOf(token) >= 0) return true;
      }
      return false;
    }

    return rows.filter(function (r) {
      if (String(r.productArea || '').trim() === productArea) return true;
      var lookupId = r.parentDeploymentId || r.deploymentId;
      return allowed[_canonicalId_(lookupId)] || matchesNameToken_(r);
    });
  }

  /**
   * V2 monthly report product scope: union filter across configured areas/tokens.
   * No-op when cfg.report.productScope.enabled !== true or criteria are empty.
   * Fail-open when product-function read fails (name-token / row-area matching still applies).
   *
   * @param {Array<Object>} rows
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   */
  function filterRowsByReportProductScope_(rows, cfg) {
    var scope = (cfg && cfg.report && cfg.report.productScope) || {};
    if (scope.enabled !== true) return rows;
    if (!Array.isArray(rows) || rows.length === 0) return rows;

    var includeAreas = Array.isArray(scope.includeAreas) ? scope.includeAreas : [];
    var nameTokens = Array.isArray(scope.nameTokens) ? scope.nameTokens : [];
    var aliases = scope.aliases || {};
    if (!includeAreas.length && !nameTokens.length &&
        (!aliases || !Object.keys(aliases).length)) {
      return rows;
    }

    var areaSet = {};
    includeAreas.forEach(function (area) {
      var normalized = String(area || '').trim().toLowerCase();
      if (normalized) areaSet[normalized] = true;
    });
    Object.keys(aliases).forEach(function (key) {
      var nk = String(key || '').trim().toLowerCase();
      if (nk) areaSet[nk] = true;
      var nv = String(aliases[key] || '').trim().toLowerCase();
      if (nv) areaSet[nv] = true;
    });

    var tokensLower = nameTokens.map(function (token) {
      return String(token || '').trim().toLowerCase();
    }).filter(function (t) { return !!t; });

    var allowedByPf = {};
    try {
      var pfRows = readSfdcProductFunctionsRaw_(cfg) || [];
      pfRows.forEach(function (pf) {
        var pa = String(pf.productArea || '').trim().toLowerCase();
        if (pa && areaSet[pa] && pf.deploymentFk) {
          allowedByPf[_canonicalId_(pf.deploymentFk)] = true;
        }
      });
    } catch (e) {
      Logger.log('filterRowsByReportProductScope_: PF read failed: ' + e);
    }

    function matchesNameToken_(row) {
      if (!tokensLower.length) return false;
      var depName = String(row.deploymentName || row.name || '').toLowerCase();
      if (!depName) return false;
      for (var ti = 0; ti < tokensLower.length; ti++) {
        if (depName.indexOf(tokensLower[ti]) >= 0) return true;
      }
      return false;
    }

    function matchesAreaOnRow_(row) {
      if (!Object.keys(areaSet).length) return false;
      var rowArea = String(row.productArea || '').trim().toLowerCase();
      if (rowArea && areaSet[rowArea]) return true;
      var rowAreas = row.productAreas;
      if (Array.isArray(rowAreas)) {
        for (var ai = 0; ai < rowAreas.length; ai++) {
          var a = String(rowAreas[ai] || '').trim().toLowerCase();
          if (a && areaSet[a]) return true;
        }
      }
      return false;
    }

    return rows.filter(function (r) {
      return allowedByPf[_canonicalId_(r.deploymentId)] ||
        matchesAreaOnRow_(r) ||
        matchesNameToken_(r);
    });
  }

  /**
   * Ensures StudentDeploymentData sheet exists with the V1 column schema.
   * Idempotent. Returns the Sheet object.
   *
   * Schema: A=Deployment_Id, B=Registration_Date, C=Notes,
   *         D=LastEditedBy, E=LastEditedAt
   *
   * @param {AppConfig} cfg
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   * @private
   */
  function ensureStudentDataSheet_(cfg) {
    var sheetName = (cfg.student && cfg.student.sheets && cfg.student.sheets.studentData) ||
                   'StudentDeploymentData';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, 5).setValues([[
        'Deployment_Id', 'Registration_Date', 'Notes', 'LastEditedBy', 'LastEditedAt'
      ]]);
      sheet.setFrozenRows(1);
      Logger.log('CoreData.ensureStudentDataSheet_: created sheet "' + sheetName + '"');
    }
    return sheet;
  }

  /**
   * Reads a single Student data row by deploymentId.
   *
   * @param {string} deploymentId
   * @param {AppConfig} cfg
   * @return {?{deploymentId:string, registrationDate:string, notes:string,
   *             lastEditedBy:string, lastEditedAt:string}}
   * @private
   */
  function readStudentDataRow_(deploymentId, cfg) {
    if (!deploymentId) return null;
    var sheet = ensureStudentDataSheet_(cfg);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === deploymentId.trim()) {
        return {
          deploymentId:     String(values[i][0] || ''),
          registrationDate: values[i][1] ? _formatStudentDate_(values[i][1]) : '',
          notes:            String(values[i][2] || ''),
          lastEditedBy:     String(values[i][3] || ''),
          lastEditedAt:     String(values[i][4] || '')
        };
      }
    }
    return null;
  }

  /**
   * Reads all Student data rows as a map keyed by deploymentId.
   *
   * @param {AppConfig} cfg
   * @return {Object<string, {deploymentId:string, registrationDate:string, notes:string,
   *                          lastEditedBy:string, lastEditedAt:string}>}
   * @private
   */
  function readAllStudentData_(cfg) {
    var sheet = ensureStudentDataSheet_(cfg);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    var out = {};
    for (var i = 0; i < values.length; i++) {
      var did = String(values[i][0] || '').trim();
      if (!did) continue;
      out[did] = {
        deploymentId:     did,
        registrationDate: values[i][1] ? _formatStudentDate_(values[i][1]) : '',
        notes:            String(values[i][2] || ''),
        lastEditedBy:     String(values[i][3] || ''),
        lastEditedAt:     String(values[i][4] || '')
      };
    }
    return out;
  }

  /**
   * Creates or updates a Student data row. Only touches fields present in patch.
   * Stamps LastEditedBy and LastEditedAt on every save.
   *
   * @param {string} deploymentId
   * @param {{registrationDate?:string, notes?:string}} patch
   * @param {string} editorEmail
   * @param {AppConfig} cfg
   * @return {{deploymentId:string, registrationDate:string, notes:string,
   *           lastEditedBy:string, lastEditedAt:string}}
   */
  function writeStudentDataRow_(deploymentId, patch, editorEmail, cfg) {
    var sheet = ensureStudentDataSheet_(cfg);
    var nowIso = new Date().toISOString();

    var lastRow = sheet.getLastRow();
    var existingRowNum = -1;
    var existingData = ['', '', '', '', ''];
    if (lastRow >= 2) {
      var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][0] || '').trim() === deploymentId.trim()) {
          existingRowNum = i + 2;
          existingData = values[i];
          break;
        }
      }
    }

    var regDate = (patch && patch.registrationDate !== undefined)
      ? String(patch.registrationDate || '').trim()
      : (existingData[1] ? _formatStudentDate_(existingData[1]) : '');
    var notes = (patch && patch.notes !== undefined)
      ? String(patch.notes || '').trim()
      : String(existingData[2] || '');

    var rowData = [deploymentId, regDate, notes, editorEmail || '', nowIso];

    if (existingRowNum > 0) {
      sheet.getRange(existingRowNum, 1, 1, 5).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    return {
      deploymentId:     deploymentId,
      registrationDate: regDate,
      notes:            notes,
      lastEditedBy:     editorEmail || '',
      lastEditedAt:     nowIso
    };
  }

  /**
   * Builds the server-side data payload for the Student tab.
   * Returns null when cfg.student?.enabled !== true.
   *
   * @param {AppConfig} config
   * @return {?{deployments:Array<Object>, products:Object<string,Array>,
   *            kpis:{total:number, totalActive:number, totalComplete:number,
   *                  healthActive:{red:number,yellow:number,green:number}}}}
   */
  function buildStudentTabData_(config) {
    var cfg = CoreConfig.withDefaults(config);
    if (!cfg.student || cfg.student.enabled !== true) return null;

    var allEffective = buildAllEffectiveDeploymentsIncludingComplete_(cfg);
    var studentRows  = filterDeploymentsByStudent_(allEffective, 'only', cfg);
    var studentDataMap = readAllStudentData_(cfg);
    var pfMap = CoreSalesforce.getStudentProductFunctionsMap_(cfg) || {};

    var deployments = studentRows.map(function (dep) {
      var sd = studentDataMap[dep.deploymentId] || {};
      return {
        rowIndex:         dep.rowIndex,
        deploymentId:     dep.deploymentId,
        accountName:      dep.accountName,
        deploymentName:   dep.deploymentName,
        partner:          dep.partner,
        overallStatus:    dep.overallStatus,
        health:           dep.health,
        phase:            dep.phase,
        mtpDate:          dep.mtpDate,
        registrationDate: sd.registrationDate || '',
        notes:            sd.notes || ''
      };
    });

    var totalActive   = deployments.filter(function (d) { return d.overallStatus === 'Active';   }).length;
    var totalComplete = deployments.filter(function (d) { return d.overallStatus === 'Complete'; }).length;
    var activeRows    = deployments.filter(function (d) { return d.overallStatus === 'Active'; });
    var healthActive  = { red: 0, yellow: 0, green: 0 };
    activeRows.forEach(function (d) {
      var h = String(d.health || '').trim().toLowerCase();
      if      (h === 'red')    healthActive.red++;
      else if (h === 'yellow') healthActive.yellow++;
      else if (h === 'green')  healthActive.green++;
    });

    return {
      deployments: deployments,
      products:    pfMap,
      kpis: {
        total:         deployments.length,
        totalActive:   totalActive,
        totalComplete: totalComplete,
        healthActive:  healthActive
      }
    };
  }

  /**
   * Save handler for Student-specific fields. Requires POWER_USER or ADMIN.
   * Validates notes length and date format. Stamps editor email + timestamp.
   *
   * @param {AppConfig} config
   * @param {string} deploymentId
   * @param {{registrationDate?:string, notes?:string}} patch
   * @return {{ok:boolean, row:Object}}
   */
  function saveStudentDeploymentFields(config, deploymentId, patch) {
    var cfg = CoreConfig.withDefaults(config);
    if (!cfg.student || cfg.student.enabled !== true) {
      throw new Error('saveStudentDeploymentFields: Student is not enabled for this app.');
    }
    CoreUsers.requirePowerUser_(cfg);

    var maxChars = (cfg.student.editModal && cfg.student.editModal.notesMaxChars) || 2000;
    var notes = patch && patch.notes !== undefined ? String(patch.notes || '') : null;
    if (notes !== null && notes.length > maxChars) {
      throw new Error('Notes exceeds maximum length of ' + maxChars + ' characters.');
    }

    if (patch && patch.registrationDate !== undefined && patch.registrationDate !== '') {
      var d = new Date(patch.registrationDate);
      if (isNaN(d.getTime())) {
        throw new Error('Invalid Registration Date: "' + patch.registrationDate + '".');
      }
    }

    var editor = '';
    try { editor = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); }
    catch (e) {}

    var row = writeStudentDataRow_(deploymentId, patch, editor, cfg);
    return { ok: true, row: row };
  }

  /**
   * Formats a date value (Date object or string) as 'M/D/YYYY' for display.
   * Returns '' if the value is blank or invalid.
   *
   * @param {*} rawDate
   * @return {string}
   * @private
   */
  function _formatStudentDate_(rawDate) {
    if (!rawDate) return '';
    var d = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
    if (isNaN(d.getTime())) return String(rawDate);
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  /**
   * N4: Returns data-freshness signal from the Auto Refresh Execution Log.
   * Reuses the bounded log-tab read pattern from _sfdcDataVersion_ (cols A/B/D).
   *
   * @param {AppConfig} config
   * @return {{ lastRefresh: string, ageHours: number|null, status: string,
   *           lastRefreshStatus: string, thresholds: Object, watchSheetFound: boolean }}
   */
  function getDataFreshness(config) {
  var cfg = CoreConfig.withDefaults(config);
  var cycle = cfg.freshness.refreshCycleHours;
  var grace = cfg.freshness.graceHours;
  var amber = cfg.freshness.amberHours != null ? cfg.freshness.amberHours : (cycle + grace);
  var red = cfg.freshness.redHours != null ? cfg.freshness.redHours : (2 * cycle + grace);
  var alert = cfg.freshness.alertHours != null ? cfg.freshness.alertHours : (3 * cycle);
  var thresholds = { amber: amber, red: red, alert: alert };

  var unknown = {
    lastRefresh: '',
    ageHours: null,
    status: 'unknown',
    lastRefreshStatus: '',
    thresholds: thresholds,
    watchSheetFound: false
  };

  try {
    var ss = getSpreadsheet_();
    var logSheetName = cfg.freshness.logSheet || 'Auto Refresh Execution Log';
    var sh = ss.getSheetByName(logSheetName);
    if (!sh) {
      Logger.log('CoreData.getDataFreshness: log sheet "' + logSheetName + '" not found.');
      return unknown;
    }
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return unknown;

    // Columns: A=Refresh Time, B=Sheet, D=Status (same layout as _sfdcDataVersion_).
    var vals = sh.getRange(2, 1, lastRow - 1, 4).getValues();
    var watchSheet = cfg.freshness.watchSheet || 'SFDC_Deployments';
    var latestOverallKey = 0;
    var latestWatchSuccessKey = 0;
    var latestWatchSuccessDate = null;
    var latestSuccessKey = 0;
    var latestSuccessDate = null;
    var runMap = {};

    for (var i = 0; i < vals.length; i++) {
      var ts = vals[i][0];
      if (!ts) continue;
      var sheetName = String(vals[i][1] || '').trim();
      var status = String(vals[i][3] || '').trim();
      var date = ts instanceof Date ? ts : new Date(ts);
      if (isNaN(date.getTime())) continue;
      var key = date.getTime();

      if (key > latestOverallKey) latestOverallKey = key;

      if (!runMap[key]) {
        runMap[key] = { date: date, statuses: [] };
      }
      runMap[key].statuses.push(status);

      if (sheetName === watchSheet && status === 'Success' && key > latestWatchSuccessKey) {
        latestWatchSuccessKey = key;
        latestWatchSuccessDate = date;
      }
    }

    if (latestOverallKey === 0) return unknown;

    for (var runKey in runMap) {
      var run = runMap[runKey];
      var allSuccess = true;
      for (var si = 0; si < run.statuses.length; si++) {
        if (run.statuses[si] !== 'Success') {
          allSuccess = false;
          break;
        }
      }
      var runKeyNum = Number(runKey);
      if (allSuccess && runKeyNum > latestSuccessKey) {
        latestSuccessKey = runKeyNum;
        latestSuccessDate = run.date;
      }
    }

    var watchSheetFound = latestWatchSuccessDate !== null;
    var lastRefreshDate = watchSheetFound ? latestWatchSuccessDate : latestSuccessDate;
    if (!lastRefreshDate) return unknown;

    var lastRefreshStatus = 'Success';
    var latestRun = runMap[latestOverallKey];
    if (latestRun) {
      for (var sj = 0; sj < latestRun.statuses.length; sj++) {
        if (latestRun.statuses[sj] !== 'Success') {
          lastRefreshStatus = latestRun.statuses[sj] || 'Failed';
          break;
        }
      }
    }

    var ageHours = (Date.now() - lastRefreshDate.getTime()) / 3600000;
    var freshnessStatus;
    if (lastRefreshStatus !== 'Success' || ageHours > red) {
      freshnessStatus = 'stale';
    } else if (ageHours > amber) {
      freshnessStatus = 'aging';
    } else {
      freshnessStatus = 'fresh';
    }

    return {
      lastRefresh: lastRefreshDate.toISOString(),
      ageHours: ageHours,
      status: freshnessStatus,
      lastRefreshStatus: lastRefreshStatus,
      thresholds: thresholds,
      watchSheetFound: watchSheetFound
    };
  } catch (e) {
    Logger.log('CoreData.getDataFreshness: ' + e);
    return unknown;
  }
  }

  /**
   * N4 L2: Time-trigger entry point — emails alertRecipient on stale episodes only.
   * Anti-spam: one email on ok→alerted, one recovery on alerted→ok; never on unknown.
   *
   * @param {AppConfig} config
   */
  function checkDataFreshnessAndAlert_(config) {
    try {
      var cfg = CoreConfig.withDefaults(config);
      if (!cfg.freshness.enabled) {
        Logger.log('CoreData.checkDataFreshnessAndAlert_: freshness disabled; skipped.');
        return;
      }

      var freshness = getDataFreshness(cfg);
      if (freshness.status === 'unknown') {
        Logger.log('CoreData.checkDataFreshnessAndAlert_: status unknown; no action.');
        return;
      }

      var appId = cfg.appId || 'default';
      var propKey = 'freshnessAlertState:' + appId;
      var props = PropertiesService.getScriptProperties();
      var prevState = props.getProperty(propKey) || 'ok';
      if (prevState !== 'ok' && prevState !== 'alerted') prevState = 'ok';

      var isAlert = freshness.lastRefreshStatus !== 'Success' ||
        (freshness.ageHours !== null && freshness.ageHours > freshness.thresholds.alert);

      var recipient = cfg.freshness.alertRecipient;
      if (!recipient) {
        Logger.log('CoreData.checkDataFreshnessAndAlert_: no alertRecipient; skipped.');
        return;
      }

      var ss = getSpreadsheet_();
      var logSheetName = cfg.freshness.logSheet || 'Auto Refresh Execution Log';
      var logTab = ss.getSheetByName(logSheetName);
      var logTabUrl = ss.getUrl();
      if (logTab) logTabUrl += '#gid=' + logTab.getSheetId();

      if (isAlert && prevState === 'ok') {
        var ageRounded = freshness.ageHours !== null ? Math.round(freshness.ageHours) : '?';
        var staleSubject = '[' + appId + '] DHM data STALE — ' + ageRounded + 'h old';
        var staleBody = [
          'App: ' + appId,
          'Last refresh: ' + (freshness.lastRefresh || 'n/a'),
          'Age (hours): ' + (freshness.ageHours !== null ? freshness.ageHours.toFixed(1) : 'n/a'),
          'Status: ' + freshness.status,
          'Last refresh status: ' + freshness.lastRefreshStatus,
          'Alert threshold (hours): ' + freshness.thresholds.alert,
          '',
          'Auto Refresh Execution Log: ' + logTabUrl
        ].join('\n');
        MailApp.sendEmail({ to: recipient, subject: staleSubject, body: staleBody });
        props.setProperty(propKey, 'alerted');
        Logger.log('CoreData.checkDataFreshnessAndAlert_: stale alert sent to ' + recipient);
      } else if (!isAlert && prevState === 'alerted') {
        var recoverySubject = '[' + appId + '] DHM data refresh RECOVERED';
        var recoveryBody = [
          'App: ' + appId,
          'Last refresh: ' + (freshness.lastRefresh || 'n/a'),
          'Age (hours): ' + (freshness.ageHours !== null ? freshness.ageHours.toFixed(1) : 'n/a'),
          'Status: ' + freshness.status,
          'Last refresh status: ' + freshness.lastRefreshStatus,
          'Alert threshold (hours): ' + freshness.thresholds.alert,
          '',
          'Auto Refresh Execution Log: ' + logTabUrl
        ].join('\n');
        MailApp.sendEmail({ to: recipient, subject: recoverySubject, body: recoveryBody });
        props.setProperty(propKey, 'ok');
        Logger.log('CoreData.checkDataFreshnessAndAlert_: recovery alert sent to ' + recipient);
      } else {
        Logger.log('CoreData.checkDataFreshnessAndAlert_: no state change (' +
                   prevState + ', isAlert=' + isAlert + '); no email.');
      }
    } catch (e) {
      Logger.log('CoreData.checkDataFreshnessAndAlert_: ' + e);
    }
  }

  // ===========================================================================
  // EXPORTS
  // ===========================================================================

  /**
   * Exported accessor for the SFDC data-version token (used by CoreSalesforce).
   * @param {AppConfig} cfg
   * @return {string}
   */
  function _dataVersion(cfg) {
    return _sfdcDataVersion_(cfg);
  }

  return {
    // Phase 1 surface — preserved unchanged for backward compatibility
    getActiveDeployments:                getActiveDeployments,
    getAllEffectiveDeployments:          getAllEffectiveDeployments,
    getActiveCountDeployments:           getActiveCountDeployments,
    _validateEffectiveDeployments:       _validateEffectiveDeployments,
    _validateProductModeActiveDeploymentsUnion: _validateProductModeActiveDeploymentsUnion,
    _debugProductModeActiveDeploymentsUnion: _debugProductModeActiveDeploymentsUnion,
    _debugProductModeDeploymentDisplayGrain: _debugProductModeDeploymentDisplayGrain,
    _debugProductModeCounts:             _debugProductModeCounts,
    _debugProductModeGoLiveEvents: _debugProductModeGoLiveEvents,
    _debugOverviewNextHighRisk: _debugOverviewNextHighRisk,
    _debugProductModeSources: _debugProductModeSources,
    resolveGoLiveDisplayDeploymentName_: resolveGoLiveDisplayDeploymentName_,
    resolveGoLiveProductFunctionSummary_: resolveGoLiveProductFunctionSummary_,
    readProductModePfRowsRaw_: readProductModePfRowsRaw_,
    beginReportBuildContext_: beginReportBuildContext_,
    endReportBuildContext_: endReportBuildContext_,
    _markReportBuildPhase_: _markReportBuildPhase_,
    _parentDeploymentLookupId_: _parentDeploymentLookupId_,
    getUpcomingGoLives:                  getUpcomingGoLives,
    updateDeploymentMeta:                updateDeploymentMeta,
    updateDeploymentOverride:            updateDeploymentOverride,
    updateDeploymentWithMetaAndOverride: updateDeploymentWithMetaAndOverride,
    updateGoLivesOverride:               updateGoLivesOverride,

    // Phase 2 additions
    getAllDeployments:           getAllDeployments,
    getAllDeploymentsForUI:      getAllDeploymentsForUI,
    getAllActiveOverrides:       getAllActiveOverrides,
    getOverrideAuditLog:         getOverrideAuditLog,
    setOverrideClassification:   setOverrideClassification,
    bulkClearMonthlyOverrides:   bulkClearMonthlyOverrides,
    bulkClearAllOverrides:       bulkClearAllOverrides,

    // Phase 3f addition
    getDeploymentAuditSummary:   getDeploymentAuditSummary,

    // Phase 3i additions
    getRecentGoLives:            getRecentGoLives,

    getRecentGoLivesForNotablePicker: getRecentGoLivesForNotablePicker,

    // MDS / PGL redesign (2026-06) — replaces getUpcomingSurveys
    getMdsPglBatchView:          getMdsPglBatchView,
    _debugMdsPglBatchView:       _debugMdsPglBatchView_,
    _debugMdsPglExceptions:      _debugMdsPglExceptions_,

    // V2.8: CSAT in-flight surveys + unified tab payload
    uploadCsatInFlightCsvForUI:  uploadCsatInFlightCsvForUI,
    getCsatTabDataForUI:         getCsatTabDataForUI,
    getDistributionLogDataForUI: getDistributionLogDataForUI,

    // Overview Snapshot (C11b)
    getOverviewSnapshot:         getOverviewSnapshot,
    _debugOverviewSnapshot:      _debugOverviewSnapshot_,

    // Performance Layer 2 additions
    _warmSfdcRows:               _warmSfdcRows,
    _getCachedSfdcRowCount:      _getCachedSfdcRowCount,
    _dataVersion:                _dataVersion,
    getDataFreshness:            getDataFreshness,
    checkDataFreshnessAndAlert_: checkDataFreshnessAndAlert_,

    // D1 diagnostic
    _debugDdFromContacts_:       _debugDdFromContacts_,
    _debugDeploymentHealthPlan:  _debugDeploymentHealthPlan,
    _debugWellnessData:          _debugWellnessData,

    // S1: Student data layer
    filterDeploymentsByStudent_: filterDeploymentsByStudent_,
    filterDeploymentsByProduct_: filterDeploymentsByProduct_,
    filterRowsByReportProductScope_: filterRowsByReportProductScope_,
    filterRowsExcludedFromReport_: filterRowsExcludedFromReport_,
    buildStudentTabData_:        buildStudentTabData_,
    saveStudentDeploymentFields: saveStudentDeploymentFields,

    // N7: MDS/PGL notifications (delegates to CoreNotify)
    getDeploymentContactsMap_:   getDeploymentContactsMap_,
    runNotifications:            function (c) { return CoreNotify.runNotifications(c); },
    validateNotificationConfig:  function (c) { return CoreNotify.validateNotificationConfig(c); },
    sendTestNotification:        function (c, k, r) { return CoreNotify.sendTestNotification(c, k, r); },
    initNotificationConfigSheet: function (c) { return CoreNotify.initNotificationConfigSheet(c); },
    getNotificationKeysForMenu:  function (c) { return CoreNotify.getNotificationKeysForMenu(c); }
  };
})();

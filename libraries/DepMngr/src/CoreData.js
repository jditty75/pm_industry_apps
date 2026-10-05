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
    notableEligibleByProduct: {}, // getNotableEligibleDeployments cache keyed by product chip
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
    reportBuildCtx: null,       // active monthly-report build context (per execution)
    goLivesExplorerUniverseByKey: {} // tier 1 for getGoLivesExplorerUniverse_
  };

  /**
   * Clears the in-memory cache. Called by every mutation function after
   * it writes to a source sheet, so subsequent reads in the same execution
   * see the new values.
   *
   * @param {AppConfig=} cfg Currently unused; kept for symmetry with Layer 2
   *                        (sheet-tab cache) which will use cfg.appId.
   */
  /**
   * Removes tier-2 CacheService entries for an app (overview snapshot, SFDC rows, etc.).
   * Mutations call this so pre-warmed overview payloads cannot outlive override clears.
   * @param {AppConfig} cfg
   * @private
   */
  function _invalidatePerfCacheTier2ForApp_(cfg) {
    if (!cfg) return;
    var appId = (cfg.appId) ? cfg.appId : 'default';
    var maxChunks = 200;
    var baseMap = {};
    _collectDeterministicPerfCacheBases_(cfg).forEach(function (k) { baseMap[k] = true; });
    _perfCacheRegistryRead_(appId).forEach(function (k) { baseMap[k] = true; });
    var baseKeys = Object.keys(baseMap);
    if (baseKeys.length === 0) return;

    var scriptCache = null;
    var documentCache = null;
    try { scriptCache = CacheService.getScriptCache(); } catch (eSc) {
      Logger.log('CoreData._invalidatePerfCacheTier2ForApp_: ScriptCache unavailable: ' + eSc);
    }
    try { documentCache = CacheService.getDocumentCache(); } catch (eDc) {
      Logger.log('CoreData._invalidatePerfCacheTier2ForApp_: DocumentCache unavailable: ' + eDc);
    }
    if (scriptCache) {
      _perfCacheRemoveBaseKeysFromCache_(scriptCache, baseKeys, maxChunks);
    }
    if (documentCache) {
      _perfCacheRemoveBaseKeysFromCache_(documentCache, baseKeys, maxChunks);
    }
    _perfCacheRegistryClear_(appId);
  }

  function _clearCache(cfg) {
    // Tier 1: in-memory.
    _cache.sfdcRows = null;
    _cache.pfRows = null;
    _cache.effectiveByProduct = {};
    _cache.notableEligibleByProduct = {};
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
    _cache.goLivesExplorerUniverseByKey = {};
    // Tier 2: keys written in this execution plus registered/deterministic app keys.
    _perfCacheClearAll_();
    try {
      _invalidatePerfCacheTier2ForApp_(cfg);
    } catch (err) {
      Logger.log('CoreData._clearCache: tier-2 invalidation failed: ' + err);
    }
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
    _cache.pfRows = null;
    try {
      if (usesProductModeParentAndPfUnion_(cfg)) {
        readSfdcDeploymentsRaw_(cfg);
        readSfdcProductFunctionsRaw_(cfg);
      } else if (usesProductModePfDataSource_(cfg)) {
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
   * @param {string=} registryAppId When set, records the base key for flushAppCaches.
   * @private
   */
  function _perfCacheWrite_(key, value, registryAppId) {
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
          if (registryAppId) _perfCacheRegistryAdd_(registryAppId, key);
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
        if (registryAppId) _perfCacheRegistryAdd_(registryAppId, key);
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

  var _PERF_CACHE_REGISTRY_MAX_KEYS = 100;
  var _PERF_CACHE_REGISTRY_PROP_PREFIX = 'perfCacheRegistry:';

  /**
   * Script property key holding tier-2 base keys written for an app.
   * @param {string} appId
   * @return {string}
   * @private
   */
  function _perfCacheRegistryPropertyKey_(appId) {
    return _PERF_CACHE_REGISTRY_PROP_PREFIX + (appId || 'default');
  }

  /**
   * @param {string} appId
   * @return {string[]}
   * @private
   */
  function _perfCacheRegistryRead_(appId) {
    try {
      var raw = PropertiesService.getScriptProperties().getProperty(_perfCacheRegistryPropertyKey_(appId));
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      Logger.log('CoreData._perfCacheRegistryRead_: ' + err);
      return [];
    }
  }

  /**
   * @param {string} appId
   * @param {string[]} baseKeys
   * @private
   */
  function _perfCacheRegistryWrite_(appId, baseKeys) {
    try {
      PropertiesService.getScriptProperties().setProperty(
        _perfCacheRegistryPropertyKey_(appId),
        JSON.stringify(baseKeys));
    } catch (err) {
      Logger.log('CoreData._perfCacheRegistryWrite_: ' + err);
    }
  }

  /**
   * @param {string} appId
   * @private
   */
  function _perfCacheRegistryClear_(appId) {
    try {
      PropertiesService.getScriptProperties().deleteProperty(_perfCacheRegistryPropertyKey_(appId));
    } catch (err) {
      Logger.log('CoreData._perfCacheRegistryClear_: ' + err);
    }
  }

  /**
   * Records a tier-2 base key (not chunk/manifest keys) for later flush.
   * @param {string} appId
   * @param {string} baseKey
   * @private
   */
  function _perfCacheRegistryAdd_(appId, baseKey) {
    if (!appId || !baseKey) return;
    var list = _perfCacheRegistryRead_(appId);
    if (list.indexOf(baseKey) >= 0) return;
    list.push(baseKey);
    while (list.length > _PERF_CACHE_REGISTRY_MAX_KEYS) {
      list.shift();
    }
    _perfCacheRegistryWrite_(appId, list);
  }

  /**
   * Expands a perf-cache base key into all CacheService keys to remove.
   * @param {GoogleAppsScript.Cache.Cache|null} cache
   * @param {string} baseKey
   * @param {number} maxChunks
   * @return {string[]}
   * @private
   */
  function _perfCacheExpandBaseKeyForRemoval_(cache, baseKey, maxChunks) {
    var out = {};
    out[baseKey] = true;
    out[baseKey + ':manifest'] = true;
    var manifestChunks = 0;
    if (cache) {
      try {
        var manifestRaw = cache.get(baseKey + ':manifest');
        if (manifestRaw) {
          var manifest = JSON.parse(manifestRaw);
          if (manifest && manifest.chunks > 0) manifestChunks = manifest.chunks;
        }
      } catch (e) {
        Logger.log('CoreData._perfCacheExpandBaseKeyForRemoval_: manifest read failed for ' + baseKey);
      }
    }
    var limit = Math.max(manifestChunks, maxChunks || 0);
    for (var i = 0; i < limit; i++) {
      out[baseKey + ':chunk:' + i] = true;
    }
    return Object.keys(out);
  }

  /**
   * @param {GoogleAppsScript.Cache.Cache|null} cache
   * @param {string[]} baseKeys
   * @param {number} maxChunks
   * @return {number} batch count
   * @private
   */
  function _perfCacheRemoveBaseKeysFromCache_(cache, baseKeys, maxChunks) {
    if (!cache || !baseKeys || baseKeys.length === 0) return 0;
    var all = {};
    for (var b = 0; b < baseKeys.length; b++) {
      var expanded = _perfCacheExpandBaseKeyForRemoval_(cache, baseKeys[b], maxChunks);
      for (var e = 0; e < expanded.length; e++) all[expanded[e]] = true;
    }
    var keys = Object.keys(all);
    var batches = 0;
    for (var start = 0; start < keys.length; start += 100) {
      cache.removeAll(keys.slice(start, start + 100));
      batches++;
    }
    return batches;
  }

  /**
   * Clears tier-1 in-memory caches for the current execution (no tier-2).
   * @param {AppConfig=} cfg
   * @return {string[]}
   * @private
   */
  function _flushAppCachesTier1_(cfg) {
    var cleared = ['CoreData._cache'];
    _cache.sfdcRows = null;
    _cache.pfRows = null;
    _cache.effectiveByProduct = {};
    _cache.notableEligibleByProduct = {};
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
    _cache.goLivesExplorerUniverseByKey = {};
    try { CoreSalesforce._clearEnrichmentSheetCache(); cleared.push('CoreSalesforce.enrichment'); } catch (e1) {}
    try { CoreSalesforce._clearDdContactsCache(); cleared.push('CoreSalesforce.ddContacts'); } catch (e2) {}
    try { CoreSalesforce._clearStudentCache_(); cleared.push('CoreSalesforce.student'); } catch (e3) {}
    return cleared;
  }

  /**
   * Known tier-2 logical prefixes (for reporting; keys are built per app/version).
   * @return {string[]}
   * @private
   */
  function _perfCacheLogicalPrefixes_() {
    return [
      'sfdcRows:',
      'mdsPglBatchView:',
      'overviewData:',
      'goLivesExplorerUniverse:',
      'enrichmentMap:',
      'ddContacts:',
      'studentDeploymentIds:',
      'studentProductFunctions:'
    ];
  }

  /**
   * Builds version-aware and legacy tier-2 base keys for an app config.
   * @param {AppConfig} cfg
   * @return {string[]}
   * @private
   */
  function _collectDeterministicPerfCacheBases_(cfg) {
    var appId = (cfg && cfg.appId) ? cfg.appId : 'default';
    var dataVer = _sfdcDataVersion_(cfg);
    var bases = {};
    var add = function (k) { if (k) bases[k] = true; };

    add(_perfKey_(cfg, 'sfdcRows'));
    add('sfdcRows:' + appId);
    if (dataVer) add('sfdcRows:' + appId + ':' + dataVer);

    add(_perfKey_(cfg, 'overviewData:v11:lifecycleDeploymentStage:overrideAware'));
    add(_perfKey_(cfg, 'overviewData:v13:lifecycleDeploymentStage:overrideAware'));
    add(_perfKey_(cfg, 'overviewData:v14:deploymentsKpiParity:lifecycleDeploymentStage:overrideAware'));
    add(_perfKey_(cfg, 'overviewData:v15:fullActiveKpiCounts:lifecycleDeploymentStage:overrideAware'));
    add(_perfKey_(cfg, 'overviewData:v16:overrideImpactContextParity:lifecycleDeploymentStage:overrideAware'));
    add('overviewData:' + appId);

    add(_perfKey_(cfg, 'mdsPglBatchView') + ':3');
    add(_perfKey_(cfg, 'mdsPglBatchView') + ':6');
    add('mdsPglBatchView:' + appId);
    add('mdsPglBatchView:' + appId + ':3');
    add('mdsPglBatchView:' + appId + ':6');

    add('enrichmentMap:' + appId);
    if (dataVer) add('enrichmentMap:' + appId + ':' + dataVer);

    add('ddContacts:' + appId);
    add('studentDeploymentIds:' + appId);
    add('studentProductFunctions:' + appId);

    var execKeys = Object.keys(_perfCacheKnownKeys);
    for (var i = 0; i < execKeys.length; i++) {
      if (execKeys[i].indexOf(':' + appId) !== -1 || execKeys[i].indexOf(':' + appId + ':') !== -1) {
        add(execKeys[i]);
      }
    }

    return Object.keys(bases);
  }

  /**
   * Robustly clears tier-1 and tier-2 CoreLib caches for the supplied app.
   * Intended to be called from each DM app's flushCache() wrapper.
   *
   * @param {AppConfig} config
   * @param {Object=} options
   * @param {number=} options.maxChunks Fallback chunk indices to clear per base key (default 200).
   * @return {Object} Structured flush summary.
   */
  function flushAppCaches(config, options) {
    var summary = {
      ok: true,
      appId: 'default',
      prefixes: _perfCacheLogicalPrefixes_(),
      deterministicBaseKeys: [],
      registeredBaseKeys: [],
      attemptedKeyCount: 0,
      scriptCacheBatches: 0,
      documentCacheBatches: 0,
      tier1Cleared: [],
      notes: [],
      errors: []
    };
    var cfg;
    try {
      cfg = CoreConfig.withDefaults(config);
    } catch (err) {
      summary.ok = false;
      summary.errors.push('CoreConfig.withDefaults failed: ' + err);
      return summary;
    }
    var appId = (cfg && cfg.appId) ? cfg.appId : 'default';
    summary.appId = appId;
    var opts = options || {};
    var maxChunks = (opts.maxChunks > 0) ? opts.maxChunks : 200;

    try {
      summary.tier1Cleared = _flushAppCachesTier1_();
    } catch (err) {
      summary.errors.push('tier-1 clear failed: ' + err);
    }

    var baseMap = {};
    var deterministic = _collectDeterministicPerfCacheBases_(cfg);
    summary.deterministicBaseKeys = deterministic;
    deterministic.forEach(function (k) { baseMap[k] = true; });

    var registered = _perfCacheRegistryRead_(appId);
    summary.registeredBaseKeys = registered;
    registered.forEach(function (k) { baseMap[k] = true; });

    var baseKeys = Object.keys(baseMap);
    summary.notes.push('Union of ' + baseKeys.length + ' tier-2 base keys before chunk expansion.');

    var scriptCache = null;
    var documentCache = null;
    try { scriptCache = CacheService.getScriptCache(); } catch (eSc) {
      summary.errors.push('ScriptCache unavailable: ' + eSc);
    }
    try { documentCache = CacheService.getDocumentCache(); } catch (eDc) {
      summary.notes.push('DocumentCache unavailable: ' + eDc);
    }

    if (scriptCache) {
      try {
        var expanded = {};
        for (var b = 0; b < baseKeys.length; b++) {
          var keysForBase = _perfCacheExpandBaseKeyForRemoval_(scriptCache, baseKeys[b], maxChunks);
          for (var x = 0; x < keysForBase.length; x++) expanded[keysForBase[x]] = true;
        }
        summary.attemptedKeyCount = Object.keys(expanded).length;
        summary.scriptCacheBatches = _perfCacheRemoveBaseKeysFromCache_(scriptCache, baseKeys, maxChunks);
      } catch (eRem) {
        summary.ok = false;
        summary.errors.push('ScriptCache remove failed: ' + eRem);
      }
    }

    if (documentCache) {
      try {
        summary.documentCacheBatches = _perfCacheRemoveBaseKeysFromCache_(documentCache, baseKeys, maxChunks);
      } catch (eDoc) {
        summary.errors.push('DocumentCache remove failed: ' + eDoc);
      }
    }

    try {
      _perfCacheClearAll_();
    } catch (ePc) {
      summary.errors.push('_perfCacheClearAll_ failed: ' + ePc);
    }

    try {
      _perfCacheRegistryClear_(appId);
    } catch (eReg) {
      summary.errors.push('registry clear failed: ' + eReg);
    }

    if (summary.errors.length > 0) summary.ok = false;
    Logger.log('CoreData.flushAppCaches(' + appId + '): attemptedKeyCount=' + summary.attemptedKeyCount +
               ', scriptCacheBatches=' + summary.scriptCacheBatches +
               ', documentCacheBatches=' + summary.documentCacheBatches);
    return summary;
  }

  // ===========================================================================
  // INTERNAL HELPERS
  // ===========================================================================

  /** When set, CSAT ingest and tenant reads target this workbook (EDM / automation). */
  var _spreadsheetIngestOverride_ = null;

  function getSpreadsheet_() {
    if (_spreadsheetIngestOverride_) {
      return _spreadsheetIngestOverride_;
    }
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  /**
   * Runs fn with SpreadsheetApp bound to spreadsheetId (container-bound callers omit id).
   * @param {string} [spreadsheetId]
   * @param {function(): *} fn
   * @return {*}
   * @private
   */
  function _runWithOptionalSpreadsheetId_(spreadsheetId, fn) {
    if (!spreadsheetId) {
      return fn();
    }
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var prev = _spreadsheetIngestOverride_;
    _spreadsheetIngestOverride_ = ss;
    _clearCache(null);
    try {
      return fn();
    } finally {
      _spreadsheetIngestOverride_ = prev;
      _clearCache(null);
    }
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
    var idxReason    = headers.indexOf('Reason');

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
        classification:        normalizeClassification_(idxClass >= 0 ? row[idxClass] : ''),
        reason:                idxReason   >= 0 ? (row[idxReason] || '') : ''
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
    var idxReason  = headers.indexOf('Reason');

    values.slice(1).forEach(function (row) {
      var acct = String(row[idxAcct] || '').trim();
      if (!acct) return;
      map[acct] = {
        exclude:         idxExclude >= 0 ? _boolFromSheetCell_(row[idxExclude]) : false,
        overrideDate:    idxDate    >= 0 ? row[idxDate] : null,
        overridePartner: idxPartner >= 0 ? (row[idxPartner] || '') : '',
        lastEditedBy:    idxUser    >= 0 ? (row[idxUser] || '') : '',
        lastEditedAt:    (idxTime   >= 0 && row[idxTime]) ? CoreUtils.formatDateToIsoString(row[idxTime]) : '',
        classification:  normalizeClassification_(idxClass >= 0 ? row[idxClass] : ''),
        reason:          idxReason  >= 0 ? (row[idxReason] || '') : ''
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
    'Classification',
    'Reason'
  ];

  /** @const {Array<string>} GoLivesOverrides sheet column headers (write order). */
  var _GOLIVES_OVERRIDE_HEADERS_ = [
    'AccountName',
    'Exclude_From_Report',
    'Override_GoLiveDate',
    'Override_Partner',
    'LastEditedBy',
    'LastEditedAt',
    'Classification',
    'Reason'
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
   * Builds override visibility metadata for a Go Lives explorer row.
   * @param {Object} row
   * @param {Object} depOv
   * @param {Object} glOv
   * @return {Object}
   * @private
   */
  function _buildGoLiveOverrideMeta_(row, depOv, glOv) {
    depOv = depOv || {};
    glOv = glOv || {};
    var meta = {};
    var operationalFields = 0;

    var sourceGoLiveDate = row.goLiveDate || row.lastGoLiveDate || row.nextGoLiveDate || row.mtpDate || '';
    var effectiveDateOverride = glOv.overrideDate || depOv.overrideMtp || null;
    var dateMeta = _buildFieldOverrideMeta_(
      sourceGoLiveDate,
      effectiveDateOverride,
      function (v) { return CoreUtils.formatDateToIsoString(v); }
    );
    if (dateMeta) { meta.goLiveDate = dateMeta; operationalFields++; }

    var partnerMeta = _buildFieldOverrideMeta_(row.partner || '', glOv.overridePartner);
    if (partnerMeta) { meta.partner = partnerMeta; operationalFields++; }

    var healthMeta = _buildFieldOverrideMeta_(row.health || '', depOv.overrideHealth);
    if (healthMeta) { meta.health = healthMeta; operationalFields++; }

    var stageMeta = _buildFieldOverrideMeta_(row.stage || '', depOv.overrideStage);
    if (stageMeta) { meta.stage = stageMeta; operationalFields++; }

    if (!dateMeta) {
      var mtpMeta = _buildFieldOverrideMeta_(
        row.mtpDate || sourceGoLiveDate,
        depOv.overrideMtp,
        function (v) { return CoreUtils.formatDateToIsoString(v); }
      );
      if (mtpMeta) { meta.mtpDate = mtpMeta; operationalFields++; }
    }

    var updateMeta = _buildFieldOverrideMeta_(row.currentUpdate || '', depOv.overrideCurrentUpdate);
    if (updateMeta) { meta.currentUpdate = updateMeta; operationalFields++; }

    var hasReportExclusion = !!(row.excludeFromReport || depOv.exclude || glOv.exclude);
    var hasOperationalOverride = operationalFields > 0;
    var hasAnyOverride = hasOperationalOverride || hasReportExclusion;
    if (!hasAnyOverride) return {};

    var primaryOv = glOv.lastEditedAt ? glOv : depOv;
    return {
      overrideMeta: meta,
      hasOperationalOverride: hasOperationalOverride,
      hasReportExclusion: hasReportExclusion,
      hasAnyOverride: hasAnyOverride,
      overrideFieldCount: operationalFields + (hasReportExclusion ? 1 : 0),
      overrideClassification: glOv.classification || depOv.classification || 'Monthly',
      overrideLastEditedBy: primaryOv.lastEditedBy || '',
      overrideLastEditedAt: primaryOv.lastEditedAt || '',
      overrideReason: glOv.reason || depOv.reason || ''
    };
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
  /**
   * Resolves DeploymentOverrides for a go-live row (event id or parent deployment id).
   * @param {Object} row
   * @param {Object} depMap
   * @return {Object}
   * @private
   */
  function _goLiveRowDeploymentOverride_(row, depMap) {
    if (!row) return {};
    var resolved = _resolveDeploymentOverrideEntry_(row, depMap || {});
    return resolved.ov || {};
  }

  function _enrichGoLiveRowsWithOverrides_(rows, deploymentOverridesMap, goLivesOverridesMap) {
    if (!Array.isArray(rows) || !rows.length) return rows || [];

    var depMap = deploymentOverridesMap || {};
    var glMap = goLivesOverridesMap || {};

    return rows.map(function (row) {
      var depOv = _goLiveRowDeploymentOverride_(row, depMap);
      var glOv = _lookupGoLivesOverrideForAccount_(row.accountName, glMap);
      var excluded = !!(
        row.excludeFromReport ||
        depOv.exclude ||
        glOv.exclude
      );
      var effectiveGoLiveDate = glOv.overrideDate
        ? CoreUtils.formatDateToIsoString(glOv.overrideDate)
        : (_hasOverrideCellValue_(depOv.overrideMtp)
          ? CoreUtils.formatDateToIsoString(depOv.overrideMtp)
          : (row.goLiveDate || row.lastGoLiveDate || row.nextGoLiveDate || row.mtpDate || ''));
      return Object.assign({}, row, {
        partner:           glOv.overridePartner || row.partner || '',
        health:            depOv.overrideHealth || row.health || '',
        stage:             depOv.overrideStage || row.stage || '',
        currentUpdate:     depOv.overrideCurrentUpdate || row.currentUpdate || '',
        excludeFromReport: excluded,
        goLiveDate:        effectiveGoLiveDate,
        lastGoLiveDate:    row.lastGoLiveDate || effectiveGoLiveDate
      }, _buildGoLiveOverrideMeta_(row, depOv, glOv));
    });
  }

  /**
   * Re-applies go-live + deployment override fields on cached explorer rows.
   * @param {Object} universe
   * @param {AppConfig} cfg
   * @return {Object}
   * @private
   */
  function _applyGoLiveExplorerOverrideLayer_(universe, cfg) {
    if (!universe || !Array.isArray(universe.rows)) return universe;
    universe.rows = _enrichGoLiveRowsWithOverrides_(
      universe.rows,
      getDeploymentOverridesMap_(cfg),
      getGoLivesOverridesMap_(cfg)
    );
    return universe;
  }

  /**
   * After go-live overrides are merged, align lastGoLiveDate with the effective
   * date and drop rows whose effective recent date falls outside the window.
   *
   * @param {AppConfig} cfg
   * @param {Array<Object>} rows
   * @param {number=} windowDaysOverride
   * @return {Array<Object>}
   * @private
   */
  function _finalizeRecentGoLivesAfterOverrides_(cfg, rows, windowDaysOverride) {
    if (!Array.isArray(rows) || !rows.length) return rows || [];

    var recentWindowDays =
      (typeof windowDaysOverride === 'number' && windowDaysOverride > 0)
        ? windowDaysOverride
        : (cfg.salesforce && cfg.salesforce.recentWindowDays) ||
          (cfg.ui && cfg.ui.goLivesTab && cfg.ui.goLivesTab.recentWindowDays) || 60;

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var tz = Session.getScriptTimeZone();
    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var windowStart = new Date(now.getTime() - recentWindowDays * 24 * 60 * 60 * 1000);
    var windowStartKey = Utilities.formatDate(windowStart, tz, 'yyyy-MM-dd');

    var out = [];
    rows.forEach(function (row) {
      var effectiveKey = String(row.goLiveDate || row.lastGoLiveDate || '').trim();
      if (effectiveKey.length >= 10) effectiveKey = effectiveKey.slice(0, 10);
      if (!effectiveKey) {
        out.push(row);
        return;
      }
      var merged = (row.lastGoLiveDate !== effectiveKey)
        ? Object.assign({}, row, { lastGoLiveDate: effectiveKey })
        : row;
      if (effectiveKey < windowStartKey || effectiveKey > todayKey) return;
      out.push(merged);
    });
    return out;
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
    if (usesProductModePfDataSource_(cfg) || usesProductModeParentAndPfUnion_(cfg)) {
      return 'parentDeployment';
    }
    var grain = cfg.activeDeployments && cfg.activeDeployments.productModeDisplayGrain;
    if (grain === 'parentDeployment' || grain === 'deploymentProduct') return grain;
    return 'pfRow';
  }

  /**
   * ProductMode count grain for Overview / analytics / portfolio KPI totals.
   * PF-sourced ProductMode apps always use parentDeployment (Deployment__r.Id).
   * @param {AppConfig} cfg
   * @return {'pfRow'|'parentDeployment'|'deploymentProduct'}
   * @private
   */
  function _getProductModeCountGrain_(cfg) {
    if (!isProductModeActiveDeploymentsUnionEnabled_(cfg)) return 'pfRow';
    if (usesProductModePfDataSource_(cfg) || usesProductModeParentAndPfUnion_(cfg)) {
      return 'parentDeployment';
    }
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
   * True when ProductMode uses the parent + PF canonical union builder.
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function usesProductModeParentAndPfUnion_(cfg) {
    return isProductModeActiveDeploymentsUnionEnabled_(cfg) &&
      _getProductModeSourceMode_(cfg) === 'parentAndProductFunctionUnion';
  }

  /**
   * Configured structured product areas for ProductMode portfolio membership.
   * Falls back to report.productScope.includeAreas when unset.
   * @param {AppConfig} cfg
   * @return {Array<string>}
   * @private
   */
  function getProductModeStructuredProductAreas_(cfg) {
    var ad = cfg.activeDeployments || {};
    if (Array.isArray(ad.productModeStructuredProductAreas) &&
        ad.productModeStructuredProductAreas.length) {
      return ad.productModeStructuredProductAreas.slice();
    }
    var scope = cfg.report && cfg.report.productScope;
    if (scope && Array.isArray(scope.includeAreas) && scope.includeAreas.length) {
      return scope.includeAreas.slice();
    }
    return [];
  }

  /**
   * Configured deployment-name tokens for ProductMode portfolio membership.
   * Falls back to report.productScope.nameTokens when unset.
   * @param {AppConfig} cfg
   * @return {Array<string>}
   * @private
   */
  function getProductModeDeploymentNameIncludes_(cfg) {
    var ad = cfg.activeDeployments || {};
    if (Array.isArray(ad.productModeDeploymentNameIncludes) &&
        ad.productModeDeploymentNameIncludes.length) {
      return ad.productModeDeploymentNameIncludes.slice();
    }
    var scope = cfg.report && cfg.report.productScope;
    if (scope && Array.isArray(scope.nameTokens) && scope.nameTokens.length) {
      return scope.nameTokens.slice();
    }
    return [];
  }

  /**
   * Lowercase set of configured structured product areas.
   * @param {AppConfig} cfg
   * @return {Object<string, boolean>}
   * @private
   */
  function _buildProductModeAreaSet_(cfg) {
    var areaSet = {};
    getProductModeStructuredProductAreas_(cfg).forEach(function (area) {
      var normalized = String(area || '').trim().toLowerCase();
      if (normalized) areaSet[normalized] = true;
    });
    return areaSet;
  }

  /**
   * @param {Object} pf
   * @param {Object<string, boolean>} areaSet
   * @return {boolean}
   * @private
   */
  function _pfMatchesStructuredProductArea_(pf, areaSet) {
    var pa = String((pf && pf.productArea) || '').trim().toLowerCase();
    return !!(pa && areaSet[pa]);
  }

  /**
   * @param {string} deploymentName
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function _deploymentNameMatchesProductModeToken_(deploymentName, cfg) {
    var tokens = getProductModeDeploymentNameIncludes_(cfg);
    if (!tokens.length) return false;
    var nameMatch = (cfg.activeDeployments && cfg.activeDeployments.productModeNameMatch) || {};
    var field = nameMatch.field || 'deploymentName';
    if (field !== 'deploymentName') return false;
    var haystack = String(deploymentName || '');
    if (!haystack) return false;
    if (nameMatch.caseInsensitive !== false) haystack = haystack.toLowerCase();
    for (var i = 0; i < tokens.length; i++) {
      var token = String(tokens[i] || '').trim();
      if (!token) continue;
      var needle = nameMatch.caseInsensitive !== false ? token.toLowerCase() : token;
      if (haystack.indexOf(needle) >= 0) return true;
    }
    return false;
  }

  /**
   * Configured deployment-name exclusion tokens for ProductMode portfolio membership.
   * @param {AppConfig} cfg
   * @return {Array<string>}
   * @private
   */
  function getProductModeDeploymentNameExcludeTokens_(cfg) {
    var ad = cfg.activeDeployments || {};
    if (Array.isArray(ad.productModeDeploymentNameExcludes)) {
      return ad.productModeDeploymentNameExcludes.slice();
    }
    return [];
  }

  /**
   * True when a deployment name matches any ProductMode exclusion token (deployment name only).
   * @param {AppConfig} cfg
   * @param {string} deploymentName
   * @return {boolean}
   * @private
   */
  function isProductModeExcludedDeploymentName_(cfg, deploymentName) {
    var tokens = getProductModeDeploymentNameExcludeTokens_(cfg);
    if (!tokens.length) return false;
    var haystack = String(deploymentName || '').trim();
    if (!haystack) return false;
    haystack = haystack.toLowerCase();
    for (var i = 0; i < tokens.length; i++) {
      var token = String(tokens[i] || '').trim();
      if (!token) continue;
      if (haystack.indexOf(token.toLowerCase()) >= 0) return true;
    }
    return false;
  }

  /**
   * Resolves parent deployment name for ProductMode union membership checks.
   * @param {Object=} parentRow
   * @param {Object=} pfRow
   * @return {string}
   * @private
   */
  function _resolveUnionParentDeploymentName_(parentRow, pfRow) {
    if (parentRow && parentRow.deploymentName) return String(parentRow.deploymentName).trim();
    if (pfRow && pfRow.deploymentName) return String(pfRow.deploymentName).trim();
    return '';
  }

  /**
   * Status scope for a ProductMode surface.
   * @param {AppConfig} cfg
   * @param {string} surfaceName  'default' | 'trends' | other
   * @return {Array<string>}
   * @private
   */
  function getProductModeSurfaceStatusScope_(cfg, surfaceName) {
    var ad = cfg.activeDeployments || {};
    if (surfaceName === 'trends' &&
        Array.isArray(ad.productModeTrendsStatuses) &&
        ad.productModeTrendsStatuses.length) {
      return ad.productModeTrendsStatuses.slice();
    }
    if (Array.isArray(ad.productModeDefaultSurfaceStatuses) &&
        ad.productModeDefaultSurfaceStatuses.length) {
      return ad.productModeDefaultSurfaceStatuses.slice();
    }
    return _getProductModeUnionStatuses_(cfg);
  }

  /**
   * @param {string} status
   * @param {Array<string>} statusScope
   * @return {boolean}
   * @private
   */
  function _statusInProductModeScope_(status, statusScope) {
    if (!Array.isArray(statusScope) || !statusScope.length) return true;
    var normalized = String(status || '').trim();
    if (!normalized) return false;
    return statusScope.indexOf(normalized) >= 0;
  }

  /**
   * Resolves parent deployment status preferring SFDC_Deployments.
   * @param {Object=} parentRow
   * @param {Object=} pfRow
   * @return {string}
   * @private
   */
  function _resolveUnionParentStatus_(parentRow, pfRow) {
    if (parentRow && parentRow.overallStatus) return String(parentRow.overallStatus).trim();
    if (pfRow && pfRow.overallStatus) return String(pfRow.overallStatus).trim();
    return '';
  }

  /**
   * @param {Array<Object>} parentRows
   * @return {Object<string, Object>}
   * @private
   */
  function _buildParentRowsById_(parentRows) {
    var map = {};
    (parentRows || []).forEach(function (row) {
      if (!row || !row.deploymentId) return;
      var canon = _canonicalId_(row.deploymentId);
      map[canon] = row;
      if (canon.length >= 15) map[canon.slice(0, 15)] = row;
    });
    return map;
  }

  /**
   * Collects parent deployment IDs with scoped PF product-area membership.
   * @param {AppConfig} cfg
   * @param {Array<Object>} pfRows
   * @param {Object<string, Object>} parentById
   * @param {Array<string>} statusScope
   * @return {Object<string, boolean>}
   * @private
   */
  function collectProductModeStructuredScopeDeploymentIds_(cfg, pfRows, parentById, statusScope) {
    var areaSet = _buildProductModeAreaSet_(cfg);
    var ids = {};
    (pfRows || []).forEach(function (pf) {
      if (!_pfMatchesStructuredProductArea_(pf, areaSet)) return;
      var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      if (!parentId) return;
      var parent = parentById[parentId] || parentById[parentId.slice(0, 15)] || null;
      var status = _resolveUnionParentStatus_(parent, pf);
      if (!_statusInProductModeScope_(status, statusScope)) return;
      var deploymentName = _resolveUnionParentDeploymentName_(parent, pf);
      if (isProductModeExcludedDeploymentName_(cfg, deploymentName)) return;
      ids[parentId] = true;
    });
    return ids;
  }

  /**
   * Collects parent deployment IDs from SFDC_Deployments name-token membership.
   * @param {AppConfig} cfg
   * @param {Array<Object>} deploymentRows
   * @param {Array<string>} statusScope
   * @return {Object<string, boolean>}
   * @private
   */
  function collectProductModeNameMatchedDeploymentIds_(cfg, deploymentRows, statusScope) {
    var ids = {};
    (deploymentRows || []).forEach(function (row) {
      if (!row || !row.deploymentId) return;
      if (!_deploymentNameMatchesProductModeToken_(row.deploymentName, cfg)) return;
      if (isProductModeExcludedDeploymentName_(cfg, row.deploymentName)) return;
      var status = String(row.overallStatus || '').trim();
      if (!_statusInProductModeScope_(status, statusScope)) return;
      ids[_canonicalId_(row.deploymentId)] = true;
    });
    return ids;
  }

  /**
   * Groups scoped PF rows by parent deployment ID.
   * @param {Array<Object>} pfRows
   * @param {Object<string, boolean>} areaSet
   * @return {Object<string, Array<Object>>}
   * @private
   */
  function _groupScopedPfRowsByParentId_(pfRows, areaSet) {
    var groups = {};
    (pfRows || []).forEach(function (pf) {
      if (!_pfMatchesStructuredProductArea_(pf, areaSet)) return;
      var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      if (!parentId) return;
      if (!groups[parentId]) groups[parentId] = [];
      groups[parentId].push(pf);
    });
    return groups;
  }

  /**
   * @param {Array<Object>} pfRows
   * @param {string} parentId
   * @return {Object|null}
   * @private
   */
  function _findPfRowForParent_(pfRows, parentId) {
    var target = _canonicalId_(parentId);
    var prefix = target.length >= 15 ? target.slice(0, 15) : target;
    for (var i = 0; i < (pfRows || []).length; i++) {
      var pf = pfRows[i];
      if (!pf) continue;
      var pid = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      if (pid === target || (prefix.length >= 15 && pid.slice(0, 15) === prefix)) return pf;
    }
    return null;
  }

  /**
   * @param {Object} inclusionMeta
   * @return {Array<string>}
   * @private
   */
  function _portfolioInclusionSourcesFromMeta_(inclusionMeta) {
    var sources = [];
    if (inclusionMeta && inclusionMeta.structuredScope) sources.push('structuredScope');
    if (inclusionMeta && inclusionMeta.nameMatch) sources.push('nameMatch');
    return sources;
  }

  /**
   * Builds one ProductMode union row from SFDC_Deployments parent fields.
   * @param {Object} parentRow
   * @param {Array<Object>} scopedPfRows
   * @param {AppConfig} cfg
   * @param {Object} metaMap
   * @param {Object} overridesMap
   * @param {Object} wellnessMap
   * @param {Object} inclusionMeta
   * @param {string} parentFieldSource
   * @param {string} parentMatchStatus
   * @return {Object}
   * @private
   */
  function _buildUnionRowFromParent_(
    parentRow, scopedPfRows, cfg, metaMap, overridesMap, wellnessMap,
    inclusionMeta, parentFieldSource, parentMatchStatus) {
    var parentId = _canonicalId_(parentRow.deploymentId);
    var meta = (metaMap && metaMap[parentId]) || {};
    var accountId = parentRow.accountId || '';
    var wKey = accountId ? accountId.slice(0, 15) : '';
    var wellness = (wellnessMap && wKey && wellnessMap[wKey]) || null;
    var base = Object.assign({}, parentRow, {
      rowIndex: parentRow.rowIndex || 0,
      deliveryDirector: meta.deliveryDirector || '',
      ddNotes: meta.ddNotes || '',
      metaUsername: meta.username || '',
      metaTimestamp: meta.timestamp || ''
    });
    _attachWellnessFieldsToRow_(base, wellness, cfg);

    var derived = buildEffectiveDeploymentRow_(base, overridesMap || {});
    derived.deploymentId = parentId;
    derived.parentDeploymentId = parentId;
    derived.deploymentFk = parentId;
    derived.deploymentRowSource = 'productModeUnion';
    derived.parentMatchStatus = parentMatchStatus;
    derived.parentFieldSource = parentFieldSource;
    derived.portfolioInclusionSources = _portfolioInclusionSourcesFromMeta_(inclusionMeta);

    var productFunctions = (scopedPfRows || []).map(function (pf) {
      return _buildPfDetailObject_(pf);
    });
    var functions = [];
    var productAreas = [];
    (scopedPfRows || []).forEach(function (pf) {
      var fa = String(pf.funcArea || '').trim();
      if (fa && functions.indexOf(fa) < 0) functions.push(fa);
      var pa = String(pf.productArea || '').trim();
      if (pa && productAreas.indexOf(pa) < 0) productAreas.push(pa);
    });

    derived.productFunctions = productFunctions;
    derived.productFunctionCount = productFunctions.length;
    derived.productAreas = productAreas;
    derived.functions = functions;
    derived.productArea = productAreas.join(', ');
    derived.funcArea = functions.join(', ');
    _backfillParentGeoFromPfRows_(derived, scopedPfRows);
    return derived;
  }

  /**
   * When a parent deployment row lacks Customer__r geo fields, backfill from scoped PF rows.
   * @param {Object} derived
   * @param {Array<Object>} scopedPfRows
   * @private
   */
  function _backfillParentGeoFromPfRows_(derived, scopedPfRows) {
    if (!derived || !scopedPfRows || !scopedPfRows.length) return;
    var geoFields = ['region', 'subRegion', 'subRegionAlt', 'industry'];
    geoFields.forEach(function (fieldName) {
      if (String(derived[fieldName] || '').trim()) return;
      for (var i = 0; i < scopedPfRows.length; i++) {
        var val = String((scopedPfRows[i] || {})[fieldName] || '').trim();
        if (val) {
          derived[fieldName] = val;
          break;
        }
      }
    });
  }

  /**
   * Builds one ProductMode union row from PF relationship fields when parent is missing.
   * @param {string} parentId
   * @param {Array<Object>} scopedPfRows
   * @param {Array<Object>} pfRows
   * @param {AppConfig} cfg
   * @param {Object} metaMap
   * @param {Object} overridesMap
   * @param {Object} wellnessMap
   * @param {Object} inclusionMeta
   * @return {Object|null}
   * @private
   */
  function _buildUnionRowFromPfFallback_(
    parentId, scopedPfRows, pfRows, cfg, metaMap, overridesMap, wellnessMap, inclusionMeta) {
    var pf = (scopedPfRows && scopedPfRows.length) ? scopedPfRows[0] :
      _findPfRowForParent_(pfRows, parentId);
    if (!pf) return null;

    var canonParentId = _canonicalId_(parentId);
    var meta = (metaMap && metaMap[canonParentId]) || {};
    var accountId = pf.accountId || '';
    var wKey = accountId ? accountId.slice(0, 15) : '';
    var wellness = (wellnessMap && wKey && wellnessMap[wKey]) || null;
    var base = {
      deploymentId: canonParentId,
      parentDeploymentId: canonParentId,
      deploymentFk: canonParentId,
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
      rowIndex: 0,
      deliveryDirector: meta.deliveryDirector || '',
      ddNotes: meta.ddNotes || '',
      metaUsername: meta.username || '',
      metaTimestamp: meta.timestamp || ''
    };
    _attachWellnessFieldsToRow_(base, wellness, cfg);

    return _buildUnionRowFromParent_(
      base, scopedPfRows || [], cfg, metaMap, overridesMap, wellnessMap,
      inclusionMeta, 'pfFallback', 'pfFallbackParent');
  }

  /**
   * Merges union parent IDs into canonical ProductMode deployment rows.
   * @param {AppConfig} cfg
   * @param {Object<string, Object>} inclusionById
   * @param {Object<string, Object>} parentById
   * @param {Object<string, Array<Object>>} pfByParent
   * @param {Array<Object>} pfRows
   * @param {Object} metaMap
   * @param {Object} overridesMap
   * @param {Object} wellnessMap
   * @return {Array<Object>}
   * @private
   */
  function mergeProductModeParentAndPfRows_(
    cfg, inclusionById, parentById, pfByParent, pfRows, metaMap, overridesMap, wellnessMap) {
    var rows = [];
    Object.keys(inclusionById || {}).forEach(function (parentId) {
      var inclusionMeta = inclusionById[parentId] || {};
      var scopedPfRows = (pfByParent && pfByParent[parentId]) || [];
      var parent = parentById[parentId] || parentById[parentId.slice(0, 15)] || null;
      var row;
      if (parent) {
        row = _buildUnionRowFromParent_(
          parent, scopedPfRows, cfg, metaMap, overridesMap, wellnessMap,
          inclusionMeta, 'sfdcDeployments', 'matchedParent');
      } else {
        row = _buildUnionRowFromPfFallback_(
          parentId, scopedPfRows, pfRows, cfg, metaMap, overridesMap, wellnessMap, inclusionMeta);
      }
      if (row && row.deploymentId &&
          !isProductModeExcludedDeploymentName_(cfg, row.deploymentName)) {
        rows.push(row);
      }
    });
    return rows;
  }

  /**
   * ProductMode canonical union: structured PF scope + SFDC_Deployments name match.
   * @param {AppConfig} cfg  Already-defaulted config.
   * @param {Object=} opts  { surface: string, productOpts: Object }
   * @return {Array<Object>}
   * @private
   */
  function buildProductModeCanonicalUnionRows_(cfg, opts) {
    opts = opts || {};
    var surface = opts.surface || 'default';
    var statusScope = getProductModeSurfaceStatusScope_(cfg, surface);

    var parentRows = [];
    var pfRows = [];
    try { parentRows = readSfdcDeploymentsRaw_(cfg) || []; } catch (e) {
      Logger.log('CoreData.buildProductModeCanonicalUnionRows_: readSfdcDeploymentsRaw_ failed: ' + e);
    }
    try { pfRows = readSfdcProductFunctionsRaw_(cfg) || []; } catch (e) {
      Logger.log('CoreData.buildProductModeCanonicalUnionRows_: readSfdcProductFunctionsRaw_ failed: ' + e);
    }

    var parentById = _buildParentRowsById_(parentRows);
    var areaSet = _buildProductModeAreaSet_(cfg);
    var pfByParent = _groupScopedPfRowsByParentId_(pfRows, areaSet);

    var structuredIds = collectProductModeStructuredScopeDeploymentIds_(
      cfg, pfRows, parentById, statusScope);
    var nameMatchedIds = collectProductModeNameMatchedDeploymentIds_(
      cfg, parentRows, statusScope);

    var inclusionById = {};
    Object.keys(structuredIds).forEach(function (id) {
      if (!inclusionById[id]) inclusionById[id] = { structuredScope: false, nameMatch: false };
      inclusionById[id].structuredScope = true;
    });
    Object.keys(nameMatchedIds).forEach(function (id) {
      if (!inclusionById[id]) inclusionById[id] = { structuredScope: false, nameMatch: false };
      inclusionById[id].nameMatch = true;
    });

    var metaMap = getDeploymentsMetaMap_(cfg);
    var overridesMap = getDeploymentOverridesMap_(cfg);
    var wellnessMap = {};
    try { wellnessMap = buildWellnessMap_(cfg) || {}; } catch (e) {
      Logger.log('CoreData.buildProductModeCanonicalUnionRows_: buildWellnessMap_ failed: ' + e);
    }

    var rows = mergeProductModeParentAndPfRows_(
      cfg, inclusionById, parentById, pfByParent, pfRows, metaMap, overridesMap, wellnessMap);
    var beforeNameExclude = rows.length;
    rows = rows.filter(function (row) {
      return !isProductModeExcludedDeploymentName_(cfg, row.deploymentName);
    });
    if (beforeNameExclude !== rows.length) {
      Logger.log('CoreData.buildProductModeCanonicalUnionRows_: excluded ' +
                 (beforeNameExclude - rows.length) + ' row(s) by deployment name.');
    }

    Logger.log('CoreData.buildProductModeCanonicalUnionRows_: ' + rows.length +
               ' rows (surface=' + surface + ', statuses=' + JSON.stringify(statusScope) +
               ', structured=' + Object.keys(structuredIds).length +
               ', nameMatch=' + Object.keys(nameMatchedIds).length +
               ', union=' + Object.keys(inclusionById).length + ').');
    return rows;
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

    // Parent-deployment health: rollup across all PF detail rows for this Deployment__r.Id.
    // Normally health is consistent at parent level; mixed child health is an extreme edge case.
    var parentOv = (overridesMap && overridesMap[parentId]) || {};
    if (parentOv.overrideHealth) {
      row.health = parentOv.overrideHealth;
    } else {
      var childHealths = groupItems.map(function (item) {
        return (item.pf && item.pf.health) || '';
      });
      row.health = _rollupParentDeploymentHealth_(childHealths);
    }

    // Re-attach override metadata so parent health overrides surface correct indicators.
    var metaBase = {
      deploymentId: parentId,
      parentDeploymentId: parentId,
      health: pf.health || '',
      mtpDate: pf.mtpDate || '',
      stage: pf.stage || '',
      currentUpdate: pf.currentUpdate || ''
    };
    _attachDeploymentOverrideMeta_(row, metaBase, overridesMap, {
      ov: parentOv,
      lookupId: parentId
    });

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
    var cacheKey = usesProductModeParentAndPfUnion_(cfg) ? ('hist:v2:' + pa) : ('hist:' + pa);
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
    if (usesProductModeParentAndPfUnion_(cfg)) {
      var areaSet = _buildProductModeAreaSet_(cfg);
      pfRows = (pfRows || []).filter(function (pf) {
        return _pfMatchesStructuredProductArea_(pf, areaSet);
      });
    } else {
      pfRows = filterRowsByReportProductScope_(pfRows, cfg);
    }
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
    if (usesProductModeParentAndPfUnion_(cfg)) {
      readSfdcDeploymentsRaw_(cfg);
      readSfdcProductFunctionsRaw_(cfg);
    } else if (usesProductModePfDataSource_(cfg)) {
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
    _attachWellnessFieldsToRow_(base, wellness, cfg);

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
    return getProductModeCanonicalDeployments(cfg, productOpts);
  }

  /**
   * ProductMode canonical active parent deployments from SFDC_DeploymentProductFunctions,
   * grouped by Deployment__r.Id (parentDeployment grain). One row per unique parent deployment.
   *
   * @param {AppConfig} config
   * @param {Object=} productOpts  { product: string }
   * @return {Array<Object>}
   */
  function getProductModeCanonicalDeployments(config, productOpts, surfaceOpts) {
    var cfg = CoreConfig.withDefaults(config);
    if (!usesProductModePfDataSource_(cfg) && !usesProductModeParentAndPfUnion_(cfg)) {
      return getAllEffectiveDeployments(cfg, productOpts);
    }

    var pa = (productOpts && productOpts.product) || 'all';
    var surface = (surfaceOpts && surfaceOpts.surface) || 'default';
    var cacheKey = usesProductModeParentAndPfUnion_(cfg)
      ? ('canonical:v4:parentAndPfUnionNameExcludes:' + surface + ':' + String(pa))
      : ('canonical:v2:parentDeployment:' + String(pa));
    if (_cache.countByProduct && _cache.countByProduct[cacheKey]) {
      return _cache.countByProduct[cacheKey];
    }

    var rows;
    if (usesProductModeParentAndPfUnion_(cfg)) {
      rows = buildProductModeCanonicalUnionRows_(cfg, {
        surface: surface,
        productOpts: productOpts
      });
    } else {
      rows = _buildProductModePfOnlyRowsAtGrain_(cfg, 'parentDeployment');
    }
    rows = _attachDdContactsToRows_(rows, cfg);
    rows = filterDeploymentsByProduct_(rows, pa, cfg);

    if (!_cache.countByProduct) _cache.countByProduct = {};
    _cache.countByProduct[cacheKey] = rows;
    return rows;
  }

  /**
   * ProductMode Trends population: corrected union with Active + Complete scope.
   *
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Array<Object>}
   */
  function getProductModeTrendsDeployments(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    if (!usesProductModeParentAndPfUnion_(cfg)) {
      return getAllDeployments(cfg, viewModeOpts, productOpts);
    }

    var pa = (productOpts && productOpts.product) || 'all';
    var cacheKey = 'trends:v4:parentAndPfUnionNameExcludes:' + String(pa);
    if (_cache.effectiveByProduct && _cache.effectiveByProduct[cacheKey]) {
      return applyViewModeFilter_(cfg, _cache.effectiveByProduct[cacheKey], viewModeOpts);
    }

    var rows = buildProductModeCanonicalUnionRows_(cfg, {
      surface: 'trends',
      productOpts: productOpts
    });
    rows = _attachDdContactsToRows_(rows, cfg);
    rows = filterDeploymentsByProduct_(rows, pa, cfg);
    rows = filterDeploymentsByStudent_(rows, 'exclude', cfg);

    if (!_cache.effectiveByProduct) _cache.effectiveByProduct = {};
    _cache.effectiveByProduct[cacheKey] = rows;
    return applyViewModeFilter_(cfg, rows, viewModeOpts);
  }

  /**
   * Portfolio grouping value for a deployment row (PS Region in ProductMode, Industry otherwise).
   *
   * @param {Object} row
   * @param {AppConfig} config
   * @return {string}
   */
  function getDeploymentGroupingValue(row, config) {
    var cfg = CoreConfig.withDefaults(config);
    var field = CoreConfig.getPortfolioGroupingField(cfg);
    var val = String((row && row[field]) || '').trim();
    return val || 'Unknown';
  }

  /**
   * Active rows for app-level KPI counts (Overview, analytics, portfolio totals).
   * ProductMode uses canonical parent-deployment grain; IndustryMode uses parent deployments.
   *
   * @param {AppConfig} config
   * @param {Object=} productOpts
   * @return {Array<Object>}
   */
  function getActiveCountDeployments(config, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    if (usesProductModePfDataSource_(cfg) || usesProductModeParentAndPfUnion_(cfg)) {
      return getProductModeCanonicalDeployments(cfg, productOpts, { surface: 'default' });
    }
    return getAllEffectiveDeployments(cfg, productOpts);
  }

  /**
   * True when a deployment row has at least one effective operational override field
   * (same rules as KPI impact summary / overrideMeta).
   * @param {Object} row
   * @return {boolean}
   */
  function rowHasEffectiveOperationalOverride_(row) {
    if (!row) return false;
    var meta = row.overrideMeta;
    if (meta) {
      return !!(
        (meta.health && meta.health.isOverridden) ||
        (meta.mtpDate && meta.mtpDate.isOverridden) ||
        (meta.stage && meta.stage.isOverridden) ||
        (meta.currentUpdate && meta.currentUpdate.isOverridden)
      );
    }
    return !!row.hasOperationalOverride;
  }

  /**
   * Canonical override impact summary for KPI footnotes and drill-down (server-side).
   * @param {Array<Object>} rows
   * @return {{ footnote: Object, summary: Object, affectedRows: Array<Object> }}
   */
  function buildOverrideImpactContext_(rows) {
    var affected = (Array.isArray(rows) ? rows : []).filter(rowHasEffectiveOperationalOverride_);
    var fieldCounts = { health: 0, mtpDate: 0, stage: 0, currentUpdate: 0 };
    affected.forEach(function (r) {
      var meta = r.overrideMeta || {};
      if (meta.health && meta.health.isOverridden) fieldCounts.health++;
      if (meta.mtpDate && meta.mtpDate.isOverridden) fieldCounts.mtpDate++;
      if (meta.stage && meta.stage.isOverridden) fieldCounts.stage++;
      if (meta.currentUpdate && meta.currentUpdate.isOverridden) fieldCounts.currentUpdate++;
    });
    var totalOverriddenFields = fieldCounts.health + fieldCounts.mtpDate +
      fieldCounts.stage + fieldCounts.currentUpdate;
    var n = affected.length;
    var footnote = (n <= 0 || totalOverriddenFields <= 0)
      ? { overrideAffectedCount: 0 }
      : {
        overrideAffectedCount: n,
        message: 'Counts reflect approved overrides.',
        detail: n === 1
          ? '1 operational override affects this view.'
          : (n + ' operational overrides affect this view.')
      };
    return {
      footnote: footnote,
      affectedRows: affected,
      summary: {
        totalDeployments: n,
        totalOverriddenFields: totalOverriddenFields,
        fieldCounts: fieldCounts
      }
    };
  }

  /**
   * Builds additive KPI footnote metadata for rows with operational overrides.
   * Report-exclusion-only rows are excluded from the count.
   *
   * @param {Array<Object>} rows
   * @return {{ overrideAffectedCount: number, message?: string, detail?: string }}
   */
  function buildOverrideFootnote_(rows) {
    return buildOverrideImpactContext_(rows).footnote;
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

  /**
   * Resolves override map entry for a deployment row (parent-keyed for ProductMode).
   * @param {Object} rawRow
   * @param {Object} overridesMap
   * @return {{ ov: Object, lookupId: string }}
   * @private
   */
  /**
   * Resolves a DeploymentOverrides map entry by id (18-char, 15-char prefix, or direct key).
   * @param {string} deploymentId
   * @param {Object} overridesMap
   * @return {{ ov: Object, lookupId: string }}
   * @private
   */
  function _lookupDeploymentOverrideById_(deploymentId, overridesMap) {
    var map = overridesMap || {};
    var target = _canonicalId_(deploymentId);
    if (!target) return { ov: {}, lookupId: '' };
    if (map[target]) return { ov: map[target], lookupId: target };

    var direct = map[deploymentId];
    if (direct) return { ov: direct, lookupId: String(deploymentId) };

    var prefix = target.length >= 15 ? target.slice(0, 15) : target;
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === target) return { ov: map[k], lookupId: k };
      var kp = k.length >= 15 ? k.slice(0, 15) : k;
      if (prefix && kp === prefix) return { ov: map[k], lookupId: k };
    }
    return { ov: {}, lookupId: target };
  }

  function _resolveDeploymentOverrideEntry_(rawRow, overridesMap) {
    var lookupId = _parentDeploymentLookupId_(rawRow);
    var resolved = _lookupDeploymentOverrideById_(lookupId, overridesMap);
    var ov = resolved.ov;
    lookupId = resolved.lookupId || lookupId;

    if (!ov.overrideHealth && !ov.exclude && !_hasOverrideCellValue_(ov.overrideMtp) &&
        !ov.overrideStage && !ov.overrideCurrentUpdate && rawRow.deploymentId &&
        _canonicalId_(rawRow.deploymentId) !== _canonicalId_(lookupId)) {
      var alt = _lookupDeploymentOverrideById_(rawRow.deploymentId, overridesMap);
      if (alt.ov && (alt.ov.overrideHealth || alt.ov.exclude || _hasOverrideCellValue_(alt.ov.overrideMtp) ||
          alt.ov.overrideStage || alt.ov.overrideCurrentUpdate)) {
        ov = alt.ov;
        lookupId = alt.lookupId;
      }
    }
    return { ov: ov, lookupId: lookupId };
  }

  /**
   * Resolves GoLivesOverrides entry for an account (trim + case-insensitive).
   * @param {string} accountName
   * @param {Object} goLivesOverridesMap
   * @return {Object}
   * @private
   */
  function _lookupGoLivesOverrideForAccount_(accountName, goLivesOverridesMap) {
    var glMap = goLivesOverridesMap || {};
    var acct = String(accountName || '').trim();
    if (!acct) return {};
    if (glMap[acct]) return glMap[acct];
    var lower = acct.toLowerCase();
    var keys = Object.keys(glMap);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return glMap[keys[i]];
    }
    return {};
  }

  /**
   * True when a non-empty override cell value is present.
   * @param {*} v
   * @return {boolean}
   * @private
   */
  function _hasOverrideCellValue_(v) {
    if (v === null || v === undefined) return false;
    if (v instanceof Date) return !isNaN(v.getTime());
    return String(v).trim() !== '';
  }

  /**
   * DeploymentOverrides entry for a PF/parent deployment id (parent-keyed lookup).
   * @param {string} parentDeploymentId
   * @param {Object} deploymentOverridesMap
   * @return {Object}
   * @private
   */
  function _deploymentOverrideForParentId_(parentDeploymentId, deploymentOverridesMap) {
    var parentId = _canonicalId_(parentDeploymentId);
    if (!parentId) return {};
    var resolved = _resolveDeploymentOverrideEntry_({
      deploymentId: parentId,
      parentDeploymentId: parentId,
      deploymentFk: parentId
    }, deploymentOverridesMap || {});
    return resolved.ov || {};
  }

  /**
   * Upcoming go-live date key for a PF row (GoLives override > deployment MTP override > PF target).
   * @param {Object} pf
   * @param {Object} glOv
   * @param {Object} depOv
   * @return {string} YYYY-MM-DD or ''
   * @private
   */
  function _resolvePfUpcomingGoLiveDateKey_(pf, glOv, depOv) {
    glOv = glOv || {};
    depOv = depOv || {};
    if (_hasOverrideCellValue_(glOv.overrideDate)) {
      return _toDateKey_(glOv.overrideDate);
    }
    if (_hasOverrideCellValue_(depOv.overrideMtp)) {
      return _toDateKey_(depOv.overrideMtp);
    }
    return _toDateKey_(pf.targetGoLive);
  }

  /**
   * Builds per-field override metadata for display.
   * @param {*} sourceVal
   * @param {*} overrideVal
   * @param {function(*): string=} formatEffective
   * @return {Object|null}
   * @private
   */
  function _buildFieldOverrideMeta_(sourceVal, overrideVal, formatEffective) {
    if (!_hasOverrideCellValue_(overrideVal)) return null;
    var effective = formatEffective ? formatEffective(overrideVal) : overrideVal;
    return {
      source:          sourceVal || '',
      effective:       effective,
      isOverridden:    true,
      overrideValue:   overrideVal instanceof Date
        ? CoreUtils.formatDateToIsoString(overrideVal)
        : overrideVal
    };
  }

  /**
   * Attaches override visibility metadata to an effective deployment row when overrides exist.
   * @param {Object} row
   * @param {Object} rawRow
   * @param {Object} overridesMap
   * @param {Object=} resolved  Optional pre-resolved { ov, lookupId }
   * @return {Object}
   * @private
   */
  function _attachDeploymentOverrideMeta_(row, rawRow, overridesMap, resolved) {
    resolved = resolved || _resolveDeploymentOverrideEntry_(rawRow, overridesMap);
    var ov = resolved.ov || {};
    var lookupId = resolved.lookupId || '';

    var operationalFields = 0;
    var meta = {};

    var healthMeta = _buildFieldOverrideMeta_(rawRow.health, ov.overrideHealth);
    if (healthMeta) { meta.health = healthMeta; operationalFields++; }

    var mtpMeta = _buildFieldOverrideMeta_(rawRow.mtpDate, ov.overrideMtp, function (v) {
      return CoreUtils.formatDateToIsoString(v);
    });
    if (mtpMeta) { meta.mtpDate = mtpMeta; operationalFields++; }

    var stageMeta = _buildFieldOverrideMeta_(rawRow.stage, ov.overrideStage);
    if (stageMeta) { meta.stage = stageMeta; operationalFields++; }

    var updateMeta = _buildFieldOverrideMeta_(rawRow.currentUpdate, ov.overrideCurrentUpdate);
    if (updateMeta) { meta.currentUpdate = updateMeta; operationalFields++; }

    var hasReportExclusion = !!ov.exclude;
    var hasOperationalOverride = operationalFields > 0;
    var hasAnyOverride = hasOperationalOverride || hasReportExclusion;

    if (!hasAnyOverride) return row;

    row.overrideMeta = meta;
    row.hasOperationalOverride = hasOperationalOverride;
    row.hasReportExclusion = hasReportExclusion;
    row.hasAnyOverride = hasAnyOverride;
    row.overrideFieldCount = operationalFields + (hasReportExclusion ? 1 : 0);
    row.overrideClassification = ov.classification || 'Monthly';
    row.overrideLastEditedBy = ov.lastEditedBy || '';
    row.overrideLastEditedAt = ov.lastEditedAt || '';
    row.overrideReason = ov.reason || '';
    row.overrideLookupId = lookupId;
    if (lookupId && lookupId !== _canonicalId_(rawRow.deploymentId)) {
      row.overrideCascadeNote = 'Operational overrides apply from parent deployment ' + lookupId + '.';
    }
    return row;
  }

  /**
   * True when a Monthly override was last edited before the current calendar month.
   * @param {string} classification
   * @param {string|Date} lastEditedAt
   * @return {boolean}
   * @private
   */
  function isStaleMonthlyOverride_(classification, lastEditedAt) {
    if (normalizeClassification_(classification) !== 'Monthly') return false;
    if (!lastEditedAt) return false;
    var d = (lastEditedAt instanceof Date) ? lastEditedAt : new Date(lastEditedAt);
    if (isNaN(d.getTime())) return false;
    return formatYearMonth_(d) < formatYearMonth_(new Date());
  }

  function buildEffectiveDeploymentRow_(rawRow, overridesMap) {
    var resolved = _resolveDeploymentOverrideEntry_(rawRow, overridesMap);
    var ov = resolved.ov;
    var derived = Object.assign({}, rawRow, {
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
    return _attachDeploymentOverrideMeta_(derived, rawRow, overridesMap, resolved);
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
   * SFDC-based effective deployments for Complete rows only (mirror of Active builder).
   * Reads SFDC_Deployments, applies meta + overrides. Used for Notable eligible union.
   *
   * @param {AppConfig} config
   * @return {Array<Object>}
   * @private
   */
  function buildEffectiveCompleteDeploymentsFromSfdc_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var statusValues = (cfg.salesforce && cfg.salesforce.statusValues) || {};
    var completeStatus = statusValues.complete || 'Complete';

    var sfdcRows = [];
    try {
      sfdcRows = readSfdcDeploymentsRaw_(cfg);
    } catch (err) {
      Logger.log('CoreData.buildEffectiveCompleteDeploymentsFromSfdc_: read failed: ' + err);
      return [];
    }
    sfdcRows = sfdcRows.filter(function (r) {
      return !r.overallStatus || r.overallStatus === completeStatus;
    });
    if (!sfdcRows || sfdcRows.length === 0) return [];

    var completeRaw = sfdcRows.filter(function (r) {
      var st = String(r.status || '').trim();
      var os = String(r.overallStatus || '').trim();
      if (os === completeStatus) return true;
      return st === completeStatus;
    });

    if (completeRaw.length === 0) {
      Logger.log('CoreData.buildEffectiveCompleteDeploymentsFromSfdc_: no Complete rows after status filter.');
      return [];
    }

    var metaMap = getDeploymentsMetaMap_(cfg);
    var overridesMap = getDeploymentOverridesMap_(cfg);

    var effective = completeRaw.map(function (r, index) {
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

    Logger.log('CoreData.buildEffectiveCompleteDeploymentsFromSfdc_: ' + effective.length + ' complete rows.');
    return effective;
  }

  /**
   * 15-char Deployment ID prefix used for Notable peer joins (matches CoreNotable).
   *
   * @param {string} deploymentId
   * @return {string}
   * @private
   */
  function _notableDeploymentShortId_(deploymentId) {
    return String(deploymentId || '').trim().slice(0, 15);
  }

  /**
   * Merges Active and Complete effective deployment rows for Notable matching.
   * Active rows win when the same 15-char Deployment ID exists in both sources.
   *
   * @param {Array<Object>} activeRows
   * @param {Array<Object>} completeRows
   * @return {{ rows: Array<Object>, resolutionByShortId: Object<string, string> }}
   * @private
   */
  function mergeNotableEligibleDeployments_(activeRows, completeRows) {
    var map = {};
    var order = [];
    var resolutionByShortId = {};

    function addRow(row, source) {
      var shortId = _notableDeploymentShortId_(row && row.deploymentId);
      if (!shortId) return;
      if (map[shortId]) {
        if (source === 'active') {
          map[shortId] = row;
        }
        resolutionByShortId[shortId] = 'active_and_complete_overlap_active_wins';
        return;
      }
      map[shortId] = row;
      resolutionByShortId[shortId] = source;
      order.push(shortId);
    }

    (activeRows || []).forEach(function (r) { addRow(r, 'active'); });
    (completeRows || []).forEach(function (r) { addRow(r, 'complete'); });

    var rows = order.map(function (id) { return map[id]; });
    return { rows: rows, resolutionByShortId: resolutionByShortId };
  }

  /**
   * Active ∪ Complete effective deployments for Notable peer-sheet joins.
   * Deduplicated by 15-char Deployment ID; Active record wins on overlap.
   *
   * @param {AppConfig} config
   * @param {Object=} productOpts
   * @return {Array<Object>}
   */
  function getNotableEligibleDeployments(config, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var pa = (productOpts && productOpts.product) || 'all';
    var cacheKey = String(pa);
    if (_cache.notableEligibleByProduct && _cache.notableEligibleByProduct[cacheKey]) {
      return _cache.notableEligibleByProduct[cacheKey];
    }

    var active = getAllEffectiveDeployments(cfg, productOpts) || [];
    var complete = [];
    try {
      complete = buildEffectiveCompleteDeploymentsFromSfdc_(cfg) || [];
    } catch (err) {
      Logger.log('CoreData.getNotableEligibleDeployments: complete path threw: ' + err);
      complete = [];
    }
    complete = _attachDdContactsToRows_(complete, cfg);
    complete = filterDeploymentsByProduct_(complete, pa, cfg);

    var merged = mergeNotableEligibleDeployments_(active, complete);
    var eligible = merged.rows;

    if (!_cache.notableEligibleByProduct) _cache.notableEligibleByProduct = {};
    _cache.notableEligibleByProduct[cacheKey] = eligible;
    Logger.log('CoreData.getNotableEligibleDeployments: active=' + active.length +
               ', complete=' + complete.length + ', merged=' + eligible.length);
    return eligible;
  }

  /**
   * Read-only map of Notable eligible deployment resolution by 15-char Deployment ID.
   * Values: active | complete | active_and_complete_overlap_active_wins
   *
   * @param {AppConfig} config
   * @param {Object=} productOpts
   * @return {Object<string, string>}
   */
  function debugNotableEligibleResolutionByShortId(config, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var pa = (productOpts && productOpts.product) || 'all';
    var active = getAllEffectiveDeployments(cfg, productOpts) || [];
    var complete = [];
    try {
      complete = buildEffectiveCompleteDeploymentsFromSfdc_(cfg) || [];
    } catch (err) {
      Logger.log('CoreData.debugNotableEligibleResolutionByShortId: complete path threw: ' + err);
    }
    complete = filterDeploymentsByProduct_(complete, pa, cfg);
    return mergeNotableEligibleDeployments_(active, complete).resolutionByShortId;
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
        if (sourceMode === 'parentAndProductFunctionUnion') {
          effective = getProductModeCanonicalDeployments(cfg, productOpts, { surface: 'default' });
          if (!_cache.effectiveByProduct) _cache.effectiveByProduct = {};
          _cache.effectiveByProduct[cacheKey] = effective;
          return effective;
        }
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
      ddMap = _canonicalizeDdAssignmentsMap_(getDdAssignmentsFromContacts_(cfg) || {});
    } catch (e) {
      Logger.log('CoreData._attachDdContactsToRows_: getDdAssignmentsFromContacts_ failed: ' + e);
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var lookupId = _canonicalId_(row.parentDeploymentId || row.deploymentId);
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
      executiveWatchEnabled: CoreConfig.isExecutiveWatchEnabled(cfg),
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
   * Collects ProductMode parent deployment IDs excluded by deployment-name tokens.
   * @param {AppConfig} cfg
   * @param {Array<Object>} parentRows
   * @param {Array<Object>} pfRows
   * @param {Object<string, Object>} parentById
   * @param {Array<string>} statusScope
   * @return {Object<string, Object>}
   * @private
   */
  function _collectProductModeNameExcludedByScope_(cfg, parentRows, pfRows, parentById, statusScope) {
    var excluded = {};
    var areaSet = _buildProductModeAreaSet_(cfg);

    (pfRows || []).forEach(function (pf) {
      if (!_pfMatchesStructuredProductArea_(pf, areaSet)) return;
      var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      if (!parentId) return;
      var parent = parentById[parentId] || parentById[parentId.slice(0, 15)] || null;
      var status = _resolveUnionParentStatus_(parent, pf);
      if (!_statusInProductModeScope_(status, statusScope)) return;
      var deploymentName = _resolveUnionParentDeploymentName_(parent, pf);
      if (!isProductModeExcludedDeploymentName_(cfg, deploymentName)) return;
      var parentFieldSource = parent ? 'sfdcDeployments' : 'pfFallback';
      if (!excluded[parentId]) {
        excluded[parentId] = {
          deploymentId: parentId,
          accountName: (parent && parent.accountName) || pf.accountName || '',
          deploymentName: deploymentName,
          overallStatus: status,
          health: (parent && parent.health) || pf.health || '',
          source: 'structuredScope',
          parentFieldSource: parentFieldSource
        };
      }
    });

    (parentRows || []).forEach(function (row) {
      if (!row || !row.deploymentId) return;
      if (!_deploymentNameMatchesProductModeToken_(row.deploymentName, cfg)) return;
      var status = String(row.overallStatus || '').trim();
      if (!_statusInProductModeScope_(status, statusScope)) return;
      if (!isProductModeExcludedDeploymentName_(cfg, row.deploymentName)) return;
      var parentId = _canonicalId_(row.deploymentId);
      if (!excluded[parentId]) {
        excluded[parentId] = {
          deploymentId: parentId,
          accountName: row.accountName || '',
          deploymentName: row.deploymentName || '',
          overallStatus: status,
          health: row.health || '',
          source: 'nameMatch',
          parentFieldSource: 'sfdcDeployments'
        };
      } else if (excluded[parentId].source === 'structuredScope') {
        excluded[parentId].source = 'structuredScope+nameMatch';
      }
    });

    return excluded;
  }

  /**
   * ProductMode canonical union count diagnostic for EVI/AI validation.
   * @param {AppConfig} config
   * @param {number=} sampleLimit
   * @return {Object}
   */
  function _debugProductModeCanonicalUnionCounts(config, sampleLimit) {
    var cfg = CoreConfig.withDefaults(config);
    var limit = sampleLimit || 5;
    var activeScope = getProductModeSurfaceStatusScope_(cfg, 'default');
    var trendsScope = getProductModeSurfaceStatusScope_(cfg, 'trends');

    var parentRows = [];
    var pfRows = [];
    try { parentRows = readSfdcDeploymentsRaw_(cfg) || []; } catch (e) {}
    try { pfRows = readSfdcProductFunctionsRaw_(cfg) || []; } catch (e) {}
    var parentById = _buildParentRowsById_(parentRows);

    var structuredActive = collectProductModeStructuredScopeDeploymentIds_(
      cfg, pfRows, parentById, activeScope);
    var nameActive = collectProductModeNameMatchedDeploymentIds_(
      cfg, parentRows, activeScope);
    var structuredTrends = collectProductModeStructuredScopeDeploymentIds_(
      cfg, pfRows, parentById, trendsScope);
    var nameTrends = collectProductModeNameMatchedDeploymentIds_(
      cfg, parentRows, trendsScope);

    function countOverlap_(a, b) {
      var n = 0;
      Object.keys(a).forEach(function (id) { if (b[id]) n++; });
      return n;
    }
    function onlyInFirst_(a, b) {
      var out = [];
      Object.keys(a).forEach(function (id) {
        if (!b[id]) out.push(id);
      });
      return out;
    }
    function unionCount_(a, b) {
      var set = {};
      Object.keys(a).forEach(function (id) { set[id] = true; });
      Object.keys(b).forEach(function (id) { set[id] = true; });
      return Object.keys(set).length;
    }

    var overlapActive = countOverlap_(structuredActive, nameActive);
    var structuredOnlyIds = onlyInFirst_(structuredActive, nameActive);
    var nameOnlyIds = onlyInFirst_(nameActive, structuredActive);

    var excludedActiveByName = _collectProductModeNameExcludedByScope_(
      cfg, parentRows, pfRows, parentById, activeScope);
    var excludedTrendsByName = _collectProductModeNameExcludedByScope_(
      cfg, parentRows, pfRows, parentById, trendsScope);
    var excludedActiveIds = Object.keys(excludedActiveByName);
    var excludedTrendsIds = Object.keys(excludedTrendsByName);

    var finalUnionActiveRows = [];
    try {
      finalUnionActiveRows = buildProductModeCanonicalUnionRows_(cfg, { surface: 'default' }) || [];
    } catch (e) {
      Logger.log('_debugProductModeCanonicalUnionCounts: build failed: ' + e);
    }
    var finalUnionTrendsRows = [];
    try {
      finalUnionTrendsRows = buildProductModeCanonicalUnionRows_(cfg, { surface: 'trends' }) || [];
    } catch (e) {
      Logger.log('_debugProductModeCanonicalUnionCounts: trends build failed: ' + e);
    }

    var healthCounts = { Red: 0, Yellow: 0, Green: 0, Other: 0 };
    finalUnionActiveRows.forEach(function (row) {
      var h = String(row.health || '').trim();
      if (healthCounts[h] !== undefined) healthCounts[h]++;
      else healthCounts.Other++;
    });

    var pfFallbackParentCount = 0;
    finalUnionActiveRows.forEach(function (row) {
      if (row.parentFieldSource === 'pfFallback' || row.parentMatchStatus === 'pfFallbackParent') {
        pfFallbackParentCount++;
      }
    });

    function sampleRows_(ids, rowsById, label) {
      return ids.slice(0, limit).map(function (id) {
        var row = rowsById[id] || parentById[id] || parentById[id.slice(0, 15)] || null;
        return {
          deploymentId: id,
          accountName: row ? (row.accountName || '') : '',
          deploymentName: row ? (row.deploymentName || '') : '',
          overallStatus: row ? (row.overallStatus || '') : '',
          health: row ? (row.health || '') : '',
          source: label
        };
      });
    }

    var activeRowsById = {};
    finalUnionActiveRows.forEach(function (row) {
      activeRowsById[_canonicalId_(row.deploymentId)] = row;
    });

    var sampleCanonicalRows = finalUnionActiveRows.slice(0, limit).map(function (row) {
      return {
        deploymentId: row.deploymentId || '',
        accountName: row.accountName || '',
        deploymentName: row.deploymentName || '',
        region: row.region || '',
        wdEngManager: row.wdEngManager || '',
        reviewUsername: row.reviewUsername || '',
        reviewTimestamp: row.reviewTimestamp || '',
        parentFieldSource: row.parentFieldSource || '',
        parentMatchStatus: row.parentMatchStatus || ''
      };
    });

    var report = {
      appId: cfg.appId || '',
      productModeSourceMode: _getProductModeSourceMode_(cfg),
      clientUiDefaults: {
        isProductModeApp: !!(cfg.ui && cfg.ui.isProductModeApp),
        metaInfoMode: (cfg.ui && cfg.ui.deploymentsTable && cfg.ui.deploymentsTable.metaInfoMode) || '',
        showMissingDDHighlight: !!(cfg.ui && cfg.ui.deploymentsTable &&
          cfg.ui.deploymentsTable.showMissingDDHighlight),
        hideDeliveryDirectorColumn: !!(cfg.ui && cfg.ui.deploymentsTable &&
          cfg.ui.deploymentsTable.hideDeliveryDirectorColumn)
      },
      activeScope: activeScope,
      trendsScope: trendsScope,
      structuredScopeActiveParentCount: Object.keys(structuredActive).length,
      nameMatchActiveParentCount: Object.keys(nameActive).length,
      overlapActiveCount: overlapActive,
      structuredOnlyActiveCount: structuredOnlyIds.length,
      nameOnlyActiveCount: nameOnlyIds.length,
      finalUnionActiveCount: finalUnionActiveRows.length,
      finalUnionActiveHealthCounts: healthCounts,
      structuredScopeActiveCompleteParentCount: Object.keys(structuredTrends).length,
      nameMatchActiveCompleteParentCount: Object.keys(nameTrends).length,
      finalUnionActiveCompleteCount: finalUnionTrendsRows.length,
      pfFallbackParentCount: pfFallbackParentCount,
      sampleStructuredOnly: sampleRows_(structuredOnlyIds, activeRowsById, 'structuredOnly'),
      sampleNameOnly: sampleRows_(nameOnlyIds, activeRowsById, 'nameOnly'),
      sampleOverlap: sampleRows_(
        Object.keys(structuredActive).filter(function (id) { return nameActive[id]; }),
        activeRowsById,
        'overlap'
      ),
      excludedByNameTokens: getProductModeDeploymentNameExcludeTokens_(cfg),
      excludedByNameActiveCount: excludedActiveIds.length,
      excludedByNameActiveCompleteCount: excludedTrendsIds.length,
      sampleExcludedByName: excludedActiveIds.slice(0, limit).map(function (id) {
        return excludedActiveByName[id];
      }),
      sampleCanonicalRows: sampleCanonicalRows,
      canonicalRowsWithRegion: finalUnionActiveRows.filter(function (row) {
        return String(row.region || '').trim();
      }).length,
      canonicalRowsMissingRegion: finalUnionActiveRows.filter(function (row) {
        return !String(row.region || '').trim();
      }).length
    };

    if ((cfg.appId || '') === 'EVI_DM' || (cfg.appId || '') === 'EVI') {
      report.eviWorkbookBaseline = {
        structuredScopeActiveParentCount: 129,
        nameMatchActiveParentCount: 132,
        overlapActiveCount: 86,
        finalUnionActiveCount: 175,
        finalUnionActiveHealthCounts: { Red: 4, Yellow: 7, Green: 164, Other: 0 },
        excludedByNameActiveCount: 1
      };
      report.eviBaselineMatch = {
        structuredScopeActiveParentCount:
          report.structuredScopeActiveParentCount === 129,
        nameMatchActiveParentCount:
          report.nameMatchActiveParentCount === 132,
        overlapActiveCount: report.overlapActiveCount === 86,
        finalUnionActiveCount: report.finalUnionActiveCount === 175,
        healthRed: healthCounts.Red === 4,
        healthYellow: healthCounts.Yellow === 7,
        healthGreen: healthCounts.Green === 164,
        excludedByNameActiveCount: report.excludedByNameActiveCount >= 1
      };
    }

    Logger.log('=== _debugProductModeCanonicalUnionCounts(' + (cfg.appId || '?') + ') ===');
    Logger.log('  report=' + JSON.stringify(report));
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
  function readWellnessPlansRaw_(cfg, options) {
    options = options || {};
    var bypassGate = options.bypassExecutiveWatchGate === true;
    if (!bypassGate && !CoreConfig.isExecutiveWatchEnabled(cfg)) {
      if (_cache.wellnessRows === null) _cache.wellnessRows = [];
      return _cache.wellnessRows;
    }
    if (_cache.wellnessRows !== null && !bypassGate) return _cache.wellnessRows;

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
  function _attachWellnessFieldsToRow_(row, wellness, cfg) {
    if (!row) return row;
    if (cfg && !CoreConfig.isExecutiveWatchEnabled(cfg)) {
      row.isExecutiveWatch = false;
      row.wellnessData = null;
      row.customerWellness = null;
      return row;
    }
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
  function buildWellnessMap_(cfg, options) {
    options = options || {};
    var bypassGate = options.bypassExecutiveWatchGate === true;
    if (!bypassGate && !CoreConfig.isExecutiveWatchEnabled(cfg)) {
      if (_cache.wellnessMap === null) _cache.wellnessMap = {};
      return _cache.wellnessMap;
    }
    if (_cache.wellnessMap !== null && !bypassGate) return _cache.wellnessMap;

    var rawRows = [];
    try {
      rawRows = readWellnessPlansRaw_(cfg, options) || [];
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
    var ewEnabled = CoreConfig.isExecutiveWatchEnabled(cfg);
    var sheetName = (cfg.sheets && cfg.sheets.wellness) || 'SFDC_Wellness';
    var sheetExists = false;
    try {
      sheetExists = !!getSpreadsheet_().getSheetByName(sheetName);
    } catch (e) { /* no-op */ }

    var bypassOpts = { bypassExecutiveWatchGate: true };
    _cache.wellnessRows = null;
    _cache.wellnessMap = null;
    var rawRows = readWellnessPlansRaw_(cfg, bypassOpts) || [];
    var map = buildWellnessMap_(cfg, bypassOpts) || {};

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

    var shadowDeploymentRowsWithExecutiveWatch = 0;
    var shadowSample = [];
    var shadowRows = [];
    try {
      shadowRows = getActiveCountDeployments(cfg, { product: 'all' }) || [];
    } catch (e) {
      Logger.log('CoreData._debugWellnessData: getActiveCountDeployments failed: ' + e);
    }
    shadowRows.forEach(function(row) {
      var wKey = (row.accountId || '').slice(0, 15);
      if (!wKey || !map[wKey]) return;
      shadowDeploymentRowsWithExecutiveWatch++;
      if (shadowSample.length < 5) {
        var wellness = map[wKey];
        shadowSample.push({
          accountName: row.accountName || '',
          accountId: row.accountId || '',
          isExecutiveWatch: true,
          cxLeader: wellness.cxLeader || '',
          overallHealthStatus: wellness.overallHealthStatus || '',
          issueCategories: (wellness.issueCategories || []).slice()
        });
      }
    });

    var result = {
      appName: cfg.appId || '',
      executiveWatchEnabled: ewEnabled,
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
      runtimeExecutiveWatchRows: enrichedCount,
      deploymentRowsWithExecutiveWatch: enrichedCount,
      shadowDeploymentRowsWithExecutiveWatch: shadowDeploymentRowsWithExecutiveWatch,
      sampleShadowEnrichedRows: shadowSample,
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
      executiveWatchEnabled: CoreConfig.isExecutiveWatchEnabled(cfg),
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
   * True when two Salesforce deployment ids refer to the same record (18-char or 15-char prefix).
   * @param {any} a
   * @param {any} b
   * @return {boolean}
   * @private
   */
  function _deploymentIdEquals_(a, b) {
    var left = String(a || '').trim();
    var right = String(b || '').trim();
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.toLowerCase() === right.toLowerCase()) return true;
    var lp = left.length >= 15 ? left.slice(0, 15) : left;
    var rp = right.length >= 15 ? right.slice(0, 15) : right;
    return lp.toLowerCase() === rp.toLowerCase();
  }

  /**
   * Normalizes a deployment id for trace comparisons (trim + lower case).
   * @param {any} id
   * @return {string}
   * @private
   */
  function _normalizeDeploymentIdForTrace_(id) {
    return String(id || '').trim().toLowerCase();
  }

  /**
   * 15- and 18-character Salesforce id forms for trace output.
   * @param {any} id
   * @return {{ raw: string, id15: string, id18: string|null }}
   * @private
   */
  function _salesforceIdFormsForTrace_(id) {
    var raw = String(id || '').trim();
    var id15 = raw.length >= 15 ? raw.slice(0, 15) : raw;
    var id18 = raw.length >= 18 ? raw.slice(0, 18) : null;
    return { raw: raw, id15: id15, id18: id18 };
  }

  /** @const {Array<string>} Row property names checked for deployment id matches in traces. */
  var _TRACE_DEPLOYMENT_ID_KEYS_ = [
    'deploymentId', 'id', 'Id', 'DeploymentID', 'DEPLOYMENT_ID',
    'salesforceId', 'sfId', 'parentDeploymentId'
  ];

  /**
   * Collects non-empty id-like values from a deployment row object.
   * @param {Object} row
   * @return {Array<string>}
   * @private
   */
  function _collectDeploymentIdCandidatesFromRow_(row) {
    if (!row) return [];
    var out = [];
    var seen = {};
    _TRACE_DEPLOYMENT_ID_KEYS_.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) return;
      var val = String(row[key] || '').trim();
      if (!val || seen[val]) return;
      seen[val] = true;
      out.push(val);
    });
    return out;
  }

  /**
   * True when any id-like field on the row matches the target deployment id.
   * @param {Object} row
   * @param {string} deploymentId
   * @return {boolean}
   * @private
   */
  function _rowMatchesTargetDeploymentId_(row, deploymentId) {
    if (!row || !deploymentId) return false;
    var candidates = _collectDeploymentIdCandidatesFromRow_(row);
    for (var i = 0; i < candidates.length; i++) {
      if (_deploymentIdEquals_(candidates[i], deploymentId)) return true;
    }
    return false;
  }

  /**
   * Name-based row match for trace fallback (exact trim, case-insensitive).
   * @param {Object} row
   * @param {string} accountName
   * @param {string} deploymentName
   * @return {boolean}
   * @private
   */
  function _rowMatchesTraceNames_(row, accountName, deploymentName) {
    if (!row) return false;
    var wantAccount = String(accountName || '').trim().toLowerCase();
    var wantDeploy = String(deploymentName || '').trim().toLowerCase();
    if (!wantAccount || !wantDeploy) return false;
    var gotAccount = String(row.accountName || '').trim().toLowerCase();
    var gotDeploy = String(row.deploymentName || '').trim().toLowerCase();
    return gotAccount === wantAccount && gotDeploy === wantDeploy;
  }

  /**
   * @param {Array<Object>} rows
   * @param {string} accountName
   * @param {string} deploymentName
   * @return {Array<Object>}
   * @private
   */
  function _rowsMatchingByNameForTrace_(rows, accountName, deploymentName) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(function (r) {
      return _rowMatchesTraceNames_(r, accountName, deploymentName);
    });
  }

  /**
   * Compact preview object for deployment trace output.
   * @param {Object|null} row
   * @return {Object|null}
   * @private
   */
  function _deploymentTracePreview_(row) {
    if (!row) return null;
    return {
      deploymentId: row.deploymentId || '',
      accountName: row.accountName || '',
      deploymentName: row.deploymentName || '',
      health: row.health || '',
      phase: row.phase || '',
      stage: row.stage || '',
      status: row.status || row.overallStatus || '',
      partner: row.partner || '',
      industry: row.industry || '',
      region: row.region || '',
      excludeFromReport: !!row.excludeFromReport,
      deploymentRowSource: row.deploymentRowSource || ''
    };
  }

  /**
   * Finds the first row whose deploymentId matches (15/18-char tolerant).
   * @param {Array<Object>} rows
   * @param {string} deploymentId
   * @return {Object|null}
   * @private
   */
  function _findDeploymentInRows_(rows, deploymentId) {
    if (!Array.isArray(rows) || !deploymentId) return null;
    for (var i = 0; i < rows.length; i++) {
      var candidate = rows[i];
      if (!candidate) continue;
      if (_rowMatchesTargetDeploymentId_(candidate, deploymentId)) return candidate;
    }
    return null;
  }

  /**
   * Reads SFDC_Deployments sheet row + cfg.columns parse for one deployment id.
   * @param {AppConfig} cfg
   * @param {string} deploymentId
   * @return {{ sourceRowNumber: number, rawByHeader: Object, parsedFromConfigColumns: Object, headers: Array<string> }|null}
   * @private
   */
  function _readSfdcDeploymentsSourceMatch_(cfg, deploymentId) {
    var target = String(deploymentId || '').trim();
    if (!target) return null;

    var sheetName = cfg.sheets.deployments || 'SFDC_Deployments';
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return null;

    var lastCol = sheet.getLastColumn();
    var allValues = sheet.getRange(1, 1, sheet.getLastRow(), lastCol).getValues();
    var headers = allValues[0].map(function (h) { return String(h || '').trim(); });
    var lowerH = headers.map(function (h) { return h.toLowerCase(); });

    var colId = -1;
    for (var hi = 0; hi < lowerH.length; hi++) {
      if (lowerH[hi] === 'id' || lowerH[hi].indexOf('id') === 0) {
        colId = hi;
        break;
      }
    }
    if (colId < 0) colId = 0;

    var cols = cfg.columns || {};
    function cellAt_(row, colNum) {
      if (!colNum || colNum < 1) return '';
      var idx = colNum - 1;
      if (idx >= row.length) return '';
      var raw = row[idx];
      if (raw instanceof Date) {
        return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      return String(raw || '').trim();
    }

    for (var r = 1; r < allValues.length; r++) {
      var dataRow = allValues[r];
      var rowId = String(dataRow[colId] || '').trim();
      if (!_deploymentIdEquals_(rowId, target)) continue;

      var rawByHeader = {};
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        var val = dataRow[c];
        if (val instanceof Date) {
          rawByHeader[headers[c]] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          rawByHeader[headers[c]] = val;
        }
      }

      var parsedFromConfigColumns = {
        deploymentId: cellAt_(dataRow, cols.DEPLOYMENT_ID),
        deploymentName: cellAt_(dataRow, cols.DEPLOYMENT_NAME),
        accountId: cellAt_(dataRow, cols.ACCOUNT_ID),
        accountName: cellAt_(dataRow, cols.ACCOUNT_NAME),
        industry: cellAt_(dataRow, cols.INDUSTRY),
        region: cellAt_(dataRow, cols.REGION),
        subRegion: cellAt_(dataRow, cols.SUB_REGION),
        status: cellAt_(dataRow, cols.OVERALL_STATUS),
        phase: cellAt_(dataRow, cols.DEPLOYMENT_PHASE),
        stage: cellAt_(dataRow, cols.DEPLOYMENT_STAGE),
        health: cellAt_(dataRow, cols.DEPLOYMENT_HEALTH),
        startDate: cellAt_(dataRow, cols.DEPLOYMENT_START_DATE),
        currentMtpDate: cellAt_(dataRow, cols.CURRENT_MTP_DATE),
        firstMtpDate: cellAt_(dataRow, cols.FIRST_MTP_DATE),
        completionDate: cellAt_(dataRow, cols.COMPLETION_DATE),
        partner: cellAt_(dataRow, cols.PARTNER),
        currentDeploymentUpdate: cellAt_(dataRow, cols.CURRENT_DEPLOYMENT_UPDATE)
      };

      return {
        sourceRowNumber: r + 1,
        rawByHeader: rawByHeader,
        parsedFromConfigColumns: parsedFromConfigColumns,
        headers: headers
      };
    }
    return null;
  }

  /**
   * Temporary diagnostic: trace one deployment id through IndustryMode (and ProductMode)
   * SFDC → effective → getAllDeploymentsForUI pipeline and report exclusion stage.
   *
   * @param {AppConfig} config
   * @param {string} deploymentId
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  function debugTraceDeploymentInUiPipeline(config, deploymentId, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var targetId = String(deploymentId || '').trim();
    var vmOpts = viewModeOpts || { viewMode: 'all', ddDisplayName: '' };
    var prodOpts = productOpts || { product: 'all' };
    var possibleExclusionReasons = [];
    var pipelineCounts = {};

    var sourceSheetName = cfg.sheets.deployments || 'SFDC_Deployments';
    var sourceMatch = _readSfdcDeploymentsSourceMatch_(cfg, targetId);
    var foundInSfdcDeployments = !!sourceMatch;

    var parsedKeyFields = null;
    if (sourceMatch) {
      parsedKeyFields = Object.assign({}, sourceMatch.parsedFromConfigColumns);
    }

    var rawRowEmission = null;
    if (sourceMatch && sourceMatch.sourceRowNumber) {
      try {
        var ssDiag = getSpreadsheet_();
        var shDiag = ssDiag.getSheetByName(sourceSheetName);
        if (shDiag && shDiag.getLastRow() >= 2) {
          var diagValues = shDiag.getRange(1, 1, shDiag.getLastRow(), shDiag.getLastColumn()).getValues();
          var diagHeaders = diagValues[0].map(function (h) { return String(h || '').trim(); });
          rawRowEmission = _diagnoseSfdcRawRowEmission_(
            cfg, sourceMatch.sourceRowNumber, diagValues, diagHeaders);
        }
      } catch (eDiag) {
        rawRowEmission = { error: String(eDiag) };
      }
    }

    // Authoritative raw read: bypass tier-1/tier-2 cache and instrument the target row in-loop.
    _cache.sfdcRows = null;
    var rawReaderInstrumentation = {};
    var sfdcParsedRows = [];
    try {
      sfdcParsedRows = readSfdcDeploymentsRaw_(cfg, {
        bypassCache: true,
        targetDeploymentId: targetId,
        sourceRowNumber: sourceMatch ? sourceMatch.sourceRowNumber : null,
        instrumentation: rawReaderInstrumentation
      }) || [];
    } catch (e) {
      possibleExclusionReasons.push('readSfdcDeploymentsRaw_ threw: ' + e);
    }
    pipelineCounts.readSfdcDeploymentsRaw = sfdcParsedRows.length;

    var rawParsedRow = _findDeploymentInRows_(sfdcParsedRows, targetId);
    var idMatchFailedDespiteEmit =
      !!rawReaderInstrumentation.emitted && !rawParsedRow;
    if (idMatchFailedDespiteEmit) {
      possibleExclusionReasons.push(
        'emitted_raw_but_id_match_failed: row pushed in readSfdcDeploymentsRaw_ but trace id match missed — ' +
        'emitted deploymentId "' + (rawReaderInstrumentation.emittedRowPreview &&
          rawReaderInstrumentation.emittedRowPreview.deploymentId || '') + '"; ' +
        'candidates ' + JSON.stringify(rawReaderInstrumentation.emittedRowIdCandidates || []) + '.');
    }
    if (rawReaderInstrumentation.readPath === 'tier2_sheet_tab') {
      possibleExclusionReasons.push(
        'unexpected: bypassCache read still used tier2_sheet_tab (instrumentation bug).');
    }

    var traceAccountName = (parsedKeyFields && parsedKeyFields.accountName) ||
      'The Ohio State University';
    var traceDeploymentName = (parsedKeyFields && parsedKeyFields.deploymentName) ||
      'Subsequent - Adhoc - Evisort/CLM';
    var rawRowsMatchingByName = _rowsMatchingByNameForTrace_(
      sfdcParsedRows, traceAccountName, traceDeploymentName).map(_deploymentTracePreview_);
    var effectiveRowsMatchingByName = [];
    var finalRowsMatchingByName = [];
    if (foundInSfdcDeployments && !rawParsedRow && !rawReaderInstrumentation.emitted) {
      if (rawReaderInstrumentation.skipReason) {
        possibleExclusionReasons.push(
          'readSfdcDeploymentsRaw_ (in-loop): ' + rawReaderInstrumentation.skipReason +
          ' at sheet row ' + (rawReaderInstrumentation.physicalSheetRowNumber || sourceMatch.sourceRowNumber) + '.');
      } else if (rawRowEmission && rawRowEmission.wouldSkipEmptyReaderId) {
        possibleExclusionReasons.push(
          'readSfdcDeploymentsRaw_: skipped row ' + sourceMatch.sourceRowNumber +
          ' — deploymentId empty at reader colId index ' + rawRowEmission.readerColumnIndices.colId +
          ' (header "' + (rawRowEmission.readerColumnHeaders.colId || '') + '"); cfg DEPLOYMENT_ID col has "' +
          (rawRowEmission.deploymentIdFromCfgCol || '') + '".');
      } else if (rawRowEmission && rawRowEmission.deploymentIdFromReaderCol &&
          !_deploymentIdEquals_(rawRowEmission.deploymentIdFromReaderCol, targetId)) {
        possibleExclusionReasons.push(
          'readSfdcDeploymentsRaw_: row ' + sourceMatch.sourceRowNumber +
          ' emitted under different id "' + rawRowEmission.deploymentIdFromReaderCol +
          '" (reader colId) than sheet target "' + targetId + '".');
      } else {
        possibleExclusionReasons.push(
          'Row exists on sheet but readSfdcDeploymentsRaw_ did not emit it (see readSfdcDeploymentsRawTargetInstrumentation).');
      }
    }

    var statusValues = (cfg.salesforce && cfg.salesforce.statusValues) || {};
    var activeStatus = statusValues.active || 'Active';
    var gateDiagnostics = {
      passesOverallStatusGate: null,
      passesLegacyStatusGate: null,
      passesIdentityGate: null,
      overallStatusValue: '',
      legacyStatusValue: '',
      activeStatusExpected: activeStatus,
      rawRowEmission: rawRowEmission,
      readSfdcDeploymentsRawTargetInstrumentation: rawReaderInstrumentation,
      includedInRawEmittedRows: !!(rawParsedRow || rawReaderInstrumentation.emitted)
    };

    if (rawParsedRow) {
      gateDiagnostics.overallStatusValue = rawParsedRow.overallStatus || '';
      gateDiagnostics.legacyStatusValue = rawParsedRow.status || '';
      gateDiagnostics.passesOverallStatusGate =
        !rawParsedRow.overallStatus || rawParsedRow.overallStatus === 'Active';
      if (!gateDiagnostics.passesOverallStatusGate) {
        possibleExclusionReasons.push(
          'buildEffectiveDeploymentsFromSfdc_: overallStatus "' + rawParsedRow.overallStatus +
          '" is not Active (Overall_Status__c gate).');
      }
      gateDiagnostics.passesLegacyStatusGate =
        !rawParsedRow.status || rawParsedRow.status === activeStatus;
      if (rawParsedRow.status && rawParsedRow.status !== activeStatus) {
        possibleExclusionReasons.push(
          'buildEffectiveDeploymentsFromSfdc_: status "' + rawParsedRow.status +
          '" !== "' + activeStatus + '".');
      }
      gateDiagnostics.passesIdentityGate =
        !!(rawParsedRow.deploymentId && (rawParsedRow.accountName || rawParsedRow.deploymentName));
      if (!rawParsedRow.deploymentId) {
        possibleExclusionReasons.push('parse_failed: empty deploymentId after readSfdcDeploymentsRaw_.');
      }
      if (!rawParsedRow.accountName && !rawParsedRow.deploymentName) {
        possibleExclusionReasons.push(
          'buildEffectiveDeploymentsFromSfdc_: missing both accountName and deploymentName after parse.');
      }
    } else if (rawRowEmission && !rawRowEmission.error) {
      gateDiagnostics.overallStatusValue = rawRowEmission.overallStatusFromReaderCol || '';
      gateDiagnostics.legacyStatusValue = rawRowEmission.overallStatusFromReaderCol || '';
      gateDiagnostics.passesOverallStatusGate = rawRowEmission.passesBuildEffectiveOverallGate;
      gateDiagnostics.passesLegacyStatusGate = rawRowEmission.passesBuildEffectiveLegacyStatusGate;
      if (gateDiagnostics.passesOverallStatusGate === false) {
        possibleExclusionReasons.push(
          'buildEffectiveDeploymentsFromSfdc_: overallStatus "' + gateDiagnostics.overallStatusValue +
          '" is not Active (Overall_Status__c gate).');
      }
      var emittedReaderId = rawRowEmission.deploymentIdFromReaderCol || '';
      var cfgParsed = sourceMatch && sourceMatch.parsedFromConfigColumns;
      var cfgAccountName = cfgParsed ? (cfgParsed.accountName || '') : '';
      var cfgDeploymentName = cfgParsed ? (cfgParsed.deploymentName || '') : '';
      if (!emittedReaderId) {
        possibleExclusionReasons.push('parse_failed: empty deploymentId after readSfdcDeploymentsRaw_.');
      }
      if (!cfgAccountName && !cfgDeploymentName) {
        possibleExclusionReasons.push(
          'buildEffectiveDeploymentsFromSfdc_: missing both accountName and deploymentName after parse.');
      }
      gateDiagnostics.passesIdentityGate =
        !!(emittedReaderId && (cfgAccountName || cfgDeploymentName));
    }

    var effectiveFromSfdc = [];
    try {
      effectiveFromSfdc = buildEffectiveDeploymentsFromSfdc_(cfg) || [];
    } catch (e2) {
      possibleExclusionReasons.push('buildEffectiveDeploymentsFromSfdc_ threw: ' + e2);
    }
    pipelineCounts.buildEffectiveDeploymentsFromSfdc = effectiveFromSfdc.length;

    var effectiveRow = _findDeploymentInRows_(effectiveFromSfdc, targetId);
    var includedInEffectiveRows = !!effectiveRow;
    effectiveRowsMatchingByName = _rowsMatchingByNameForTrace_(
      effectiveFromSfdc, traceAccountName, traceDeploymentName).map(_deploymentTracePreview_);

    if (rawParsedRow && !includedInEffectiveRows) {
      if (gateDiagnostics.passesOverallStatusGate === false ||
          gateDiagnostics.passesLegacyStatusGate === false ||
          gateDiagnostics.passesIdentityGate === false) {
        /* reasons already pushed */
      } else {
        possibleExclusionReasons.push(
          'excluded_before_effective: passed visible gates but absent from buildEffectiveDeploymentsFromSfdc_ output ' +
          '(check overrides/meta transform or id mismatch).');
      }
    }

    var allEffective = [];
    try {
      allEffective = getAllEffectiveDeployments(cfg, prodOpts) || [];
    } catch (e3) {
      possibleExclusionReasons.push('getAllEffectiveDeployments threw: ' + e3);
    }
    pipelineCounts.getAllEffectiveDeployments = allEffective.length;

    var inAllEffective = _findDeploymentInRows_(allEffective, targetId);
    if (includedInEffectiveRows && !inAllEffective) {
      var pa = (prodOpts && prodOpts.product) || 'all';
      if (cfg.ui && cfg.ui.productFilter && cfg.ui.productFilter.enabled === true &&
          pa && pa !== 'all') {
        possibleExclusionReasons.push('filterDeploymentsByProduct_: product="' + pa + '".');
      } else {
        possibleExclusionReasons.push(
          'getAllEffectiveDeployments: row dropped after buildEffectiveDeploymentsFromSfdc_ ' +
          '(unexpected — compare product filter / ProductMode union path).');
      }
    }

    var postEffectiveSteps = [];
    var rowForPost = inAllEffective || effectiveRow;
    if (rowForPost) {
      var afterStudent = filterDeploymentsByStudent_([rowForPost], 'exclude', cfg);
      var studentIds = {};
      if (cfg.student && cfg.student.enabled === true) {
        try {
          studentIds = CoreSalesforce.getStudentDeploymentIds_(cfg) || {};
        } catch (eSt) {
          possibleExclusionReasons.push('getStudentDeploymentIds_ failed: ' + eSt);
        }
      }
      var studentExact = !!(studentIds[rowForPost.deploymentId]);
      var studentByPrefix = false;
      if (!studentExact && rowForPost.deploymentId) {
        var depPrefix = String(rowForPost.deploymentId).trim();
        depPrefix = depPrefix.length >= 15 ? depPrefix.slice(0, 15) : depPrefix;
        Object.keys(studentIds).forEach(function (sid) {
          if (studentByPrefix) return;
          var sp = sid.length >= 15 ? sid.slice(0, 15) : sid;
          if (sp === depPrefix) studentByPrefix = true;
        });
      }
      postEffectiveSteps.push({
        step: 'filterDeploymentsByStudent_(exclude)',
        passed: afterStudent.length > 0,
        studentFeatureEnabled: !!(cfg.student && cfg.student.enabled === true),
        studentIdExactMatch: studentExact,
        studentIdPrefixMatch: studentByPrefix
      });
      if (!afterStudent.length) {
        possibleExclusionReasons.push(
          'filterDeploymentsByStudent_: deployment linked to Product_Area Student on SFDC_DeploymentProductFunctions.');
      }

      var afterView = applyViewModeFilter_(cfg, afterStudent.length ? afterStudent : [rowForPost], vmOpts);
      postEffectiveSteps.push({
        step: 'applyViewModeFilter_',
        passed: afterView.length > 0,
        viewMode: vmOpts.viewMode || 'all',
        ddDisplayName: vmOpts.ddDisplayName || ''
      });
      if (afterStudent.length && !afterView.length) {
        possibleExclusionReasons.push(
          'applyViewModeFilter_: viewMode "' + (vmOpts.viewMode || 'all') +
          '" / DD "' + (vmOpts.ddDisplayName || '') + '".');
      }
    }

    var allDeploymentsRows = [];
    try {
      allDeploymentsRows = getAllDeployments(cfg, vmOpts, prodOpts) || [];
    } catch (e4) {
      possibleExclusionReasons.push('getAllDeployments threw: ' + e4);
    }
    pipelineCounts.getAllDeployments = allDeploymentsRows.length;

    var uiPayload = null;
    var uiRows = [];
    try {
      uiPayload = getAllDeploymentsForUI(cfg, vmOpts, prodOpts);
      uiRows = Array.isArray(uiPayload) ? uiPayload : (uiPayload && uiPayload.rows) || [];
    } catch (e5) {
      possibleExclusionReasons.push('getAllDeploymentsForUI threw: ' + e5);
    }
    pipelineCounts.getAllDeploymentsForUI = uiRows.length;

    var finalUiRow = _findDeploymentInRows_(uiRows, targetId);
    var includedInFinalUiRows = !!finalUiRow;
    finalRowsMatchingByName = _rowsMatchingByNameForTrace_(
      uiRows, traceAccountName, traceDeploymentName).map(_deploymentTracePreview_);

    if (rowForPost && !includedInFinalUiRows && includedInEffectiveRows) {
      possibleExclusionReasons.push(
        'excluded_after_effective: present in effective rows but absent from getAllDeployments / UI payload.');
    }

    var clientSideNotes = [];
    var defaultHealth = (cfg.ui && cfg.ui.deploymentsTable && cfg.ui.deploymentsTable.defaultHealthFilter);
    if (!Array.isArray(defaultHealth)) defaultHealth = ['Red', 'Yellow'];
    var rowForClient = finalUiRow || rowForPost;
    if (rowForClient && defaultHealth.length && defaultHealth.indexOf(rowForClient.health) === -1) {
      clientSideNotes.push(
        'client defaultHealthFilter would hide row: health "' + (rowForClient.health || '') +
        '" not in ' + JSON.stringify(defaultHealth));
    }
    if (includedInFinalUiRows && clientSideNotes.length) {
      possibleExclusionReasons = possibleExclusionReasons.concat(clientSideNotes);
    }

    if (rowForPost && String(rowForPost.phase || '').trim().toLowerCase() === 'adhoc') {
      possibleExclusionReasons.push(
        'note: phase Adhoc is not filtered server-side in IndustryMode getAllDeployments; ' +
        'SOQL connector may omit Adhoc before sheet ingest.');
    }

    var includedInRawEmittedRows = !!(rawParsedRow || rawReaderInstrumentation.emitted);
    var exclusionStage = 'included';
    if (!foundInSfdcDeployments) {
      exclusionStage = 'source_not_found';
    } else if (!includedInRawEmittedRows) {
      exclusionStage = 'excluded_in_raw_reader';
    } else if (idMatchFailedDespiteEmit) {
      exclusionStage = 'emitted_raw_but_id_match_failed';
    } else if (!includedInEffectiveRows) {
      exclusionStage = 'excluded_during_effective_build';
    } else if (!includedInFinalUiRows) {
      exclusionStage = 'excluded_after_effective';
    } else if (clientSideNotes.length) {
      exclusionStage = 'included';
    }

    var studentDeploymentFlag = null;
    if (rowForPost && cfg.student && cfg.student.enabled === true) {
      try {
        var sidMapTop = CoreSalesforce.getStudentDeploymentIds_(cfg) || {};
        studentDeploymentFlag = !!sidMapTop[rowForPost.deploymentId];
        if (!studentDeploymentFlag && rowForPost.deploymentId) {
          var dpTop = String(rowForPost.deploymentId).trim();
          dpTop = dpTop.length >= 15 ? dpTop.slice(0, 15) : dpTop;
          Object.keys(sidMapTop).forEach(function (k) {
            if (studentDeploymentFlag) return;
            var kpTop = k.length >= 15 ? k.slice(0, 15) : k;
            if (kpTop === dpTop) studentDeploymentFlag = true;
          });
        }
      } catch (eSidTop) { /* ignore */ }
    }

    var result = {
      deploymentId: targetId,
      appId: cfg.appId || '',
      sourceSheetName: sourceSheetName,
      foundInSfdcDeployments: foundInSfdcDeployments,
      sourceRowNumber: sourceMatch ? sourceMatch.sourceRowNumber : null,
      rawByHeader: sourceMatch ? sourceMatch.rawByHeader : null,
      parsedFromConfigColumns: sourceMatch ? sourceMatch.parsedFromConfigColumns : null,
      parsedKeyFields: parsedKeyFields || (rawParsedRow ? {
        deploymentId: rawParsedRow.deploymentId,
        deploymentName: rawParsedRow.deploymentName,
        accountId: rawParsedRow.accountId,
        accountName: rawParsedRow.accountName,
        industry: rawParsedRow.industry,
        region: rawParsedRow.region,
        subRegion: rawParsedRow.subRegion,
        status: rawParsedRow.status || rawParsedRow.overallStatus,
        phase: rawParsedRow.phase,
        stage: rawParsedRow.stage,
        health: rawParsedRow.health,
        startDate: rawParsedRow.deploymentStartDate,
        currentMtpDate: rawParsedRow.mtpDate,
        firstMtpDate: rawParsedRow.firstMtpDate,
        completionDate: rawParsedRow.completionDate,
        partner: rawParsedRow.partner,
        currentDeploymentUpdate: rawParsedRow.currentUpdate
      } : null),
      gateDiagnostics: gateDiagnostics,
      pipelineCounts: pipelineCounts,
      includedInRawEmittedRows: includedInRawEmittedRows,
      idMatchDiagnostics: {
        targetIdForms: _salesforceIdFormsForTrace_(targetId),
        idMatchFailedDespiteEmit: idMatchFailedDespiteEmit,
        rawRowsMatchingByName: rawRowsMatchingByName,
        effectiveRowsMatchingByName: effectiveRowsMatchingByName,
        finalRowsMatchingByName: finalRowsMatchingByName,
        traceAccountName: traceAccountName,
        traceDeploymentName: traceDeploymentName
      },
      duplicateSuppression: {
        inRawReader: false,
        duplicateKey: rawReaderInstrumentation.duplicateKey || null,
        firstRowKeptPreview: rawReaderInstrumentation.firstRowKeptPreview || null,
        skippedRowPreview: rawReaderInstrumentation.skippedRowPreview || null,
        reason: rawReaderInstrumentation.duplicatePreferReason || ''
      },
      includedInEffectiveRows: includedInEffectiveRows,
      effectiveRowPreview: _deploymentTracePreview_(effectiveRow),
      includedInFinalUiRows: includedInFinalUiRows,
      finalUiRowPreview: _deploymentTracePreview_(finalUiRow),
      postEffectiveSteps: postEffectiveSteps,
      isStudentDeployment: studentDeploymentFlag,
      clientSideWouldHideWithDefaultFilters: clientSideNotes.length > 0,
      exclusionStage: exclusionStage,
      possibleExclusionReasons: possibleExclusionReasons
    };

    Logger.log('=== debugTraceDeploymentInUiPipeline(' + (cfg.appId || '?') + ', ' + targetId + ') ===');
    Logger.log(JSON.stringify(result, null, 2));
    Logger.log('=== end debugTraceDeploymentInUiPipeline ===');
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
    if (usesProductModePfDataSource_(cfg) || usesProductModeParentAndPfUnion_(cfg)) {
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
   * Resolves 0-based column indices for SFDC_Deployments.
   * Salesforce export tabs (Id, Overall_Status__c, …) use header keyword detection
   * when those headers are present. cfg.columns positional mapping is used only when
   * DEPLOYMENT_ID / OVERALL_STATUS indexes validate against the actual header row
   * and the sheet does not look like a standard SFDC export layout.
   *
   * @param {AppConfig} cfg
   * @param {Array<string>} headers  Trimmed header row.
   * @return {{ indices: Object, source: string, headerByKey: Object }}
   * @private
   */
  function _resolveSfdcDeploymentsColumnIndices_(cfg, headers) {
    var lowerH = headers.map(function (h) { return String(h || '').trim().toLowerCase(); });

    function findExact_(headerName) {
      var target = String(headerName || '').trim().toLowerCase();
      for (var ei = 0; ei < lowerH.length; ei++) {
        if (lowerH[ei] === target) return ei;
      }
      return -1;
    }

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

    function resolveCol_(exactHeader, keywordFallbacks, positionalFallback) {
      var exact = findExact_(exactHeader);
      if (exact >= 0) return exact;
      return detect_(keywordFallbacks || [], positionalFallback);
    }

    function idxFromCfg_(colNum) {
      if (!colNum || colNum < 1) return -1;
      var idx = colNum - 1;
      return idx < headers.length ? idx : -1;
    }

    function headerLooksLikeDeploymentId_(header) {
      var h = String(header || '').trim().toLowerCase();
      if (h === 'id') return true;
      if (h.indexOf('deployment') !== -1 && h.indexOf('id') !== -1) return true;
      return false;
    }

    function headerLooksLikeOverallStatus_(header) {
      var h = String(header || '').trim().toLowerCase();
      if (h === 'overall_status__c') return true;
      if (h.indexOf('overall') !== -1 && h.indexOf('status') !== -1) return true;
      return false;
    }

    /** Standard Salesforce SFDC_Deployments export header signatures. */
    function hasRecognizableSfdcExportHeaders_() {
      if (findExact_('Id') >= 0) return true;
      if (findExact_('Overall_Status__c') >= 0) return true;
      if (findExact_('Customer__r.Name') >= 0) return true;
      if (findExact_('Deployment_Start_Date__c') >= 0) return true;
      if (findExact_('Current_MTP_Date__c') >= 0) return true;
      if (findExact_('Deployment_Phase__c') >= 0) return true;
      if (findExact_('Deployment_Stage__c') >= 0) return true;
      if (findExact_('Overall_Health__c') >= 0) return true;
      if (findExact_('Name') >= 0 && detect_(['overall_status'], -1) >= 0) return true;
      return false;
    }

    function buildHeaderKeywordIndices_() {
      var colIdDetected = findExact_('Id');
      if (colIdDetected < 0) colIdDetected = detect_(['id'], 0);
      return {
        colId:             colIdDetected,
        colName:           detect_(['name'], 1),
        colAccountId:      resolveCol_('Customer__c', ['customer__c'], 2),
        colCustomerRId:    resolveCol_('Customer__r.Id', ['customer__r.id'], -1),
        colAccountName:    resolveCol_('Customer__r.Name', ['customer__r.name'], 3),
        colIndustry:       resolveCol_('Customer__r.Industry', ['customer__r.industry', 'industry'], 4),
        colRegion:         resolveCol_('Customer__r.PS_Region_New__c',
          ['ps_region_new__c', 'ps_region_new', 'region_new'], 5),
        colSubRegion:      resolveCol_('Customer__r.PS_Sub_Region__c',
          ['ps_sub_region__c', 'ps_sub_region', 'sub_region'], 6),
        colSubRegionAlt:   resolveCol_('Customer__r.SubRegion__c', ['subregion__c', 'subregion'], 7),
        colCustomerObject: findExact_('Customer__r'),
        colBillingState:   detect_(['billingstate', 'billing_state'], 8),
        colBillingCity:    detect_(['billingcity', 'billing_city'], 9),
        colStartDate:      detect_(['deployment_start_date'], 10),
        colMtpDate:        detect_(['current_mtp_date'], 11),
        colFirstMtpActual: detect_(['first_move_to_production_date_actual',
          'move_to_production_date_actual', 'first_mtp_date_actual'], -1),
        colFirstMtp:       detect_(['first_move_to_production', 'first_mtp'], 12),
        colStatus:         detect_(['overall_status'], 13),
        colPhase:          detect_(['deployment_phase'], 14),
        colStage:          detect_(['deployment_stage'], 15),
        colHealth:         detect_(['overall_health'], 16),
        colCompletionDate: detect_(['deployment_completion_date', 'completion_date'], 17),
        colEM:             detect_(['workday_engagement_manager__r.full_name__c',
          'workday_engagement_manager__r', 'engagement_manager', 'wdengmanager'], 18),
        colDAM:            detect_(['delivery_assurance_manager__r.full_name__c',
          'delivery_assurance_manager__r', 'delivery_assurance', 'dam'], 19),
        colPrimingPartner: detect_(['priming_partner'], 20),
        colImplPartner:    detect_(['implementation_partner'], 21),
        colPartner:        detect_(['deployment_partner_name', 'partner'], 22),
        colSummary:        detect_(['deployment_summary'], 23)
      };
    }

    function buildCfgColumnIndices_(cfgId, cfgStatus) {
      var cols = cfg.columns || {};
      return {
        colId:             cfgId,
        colName:           idxFromCfg_(cols.DEPLOYMENT_NAME),
        colAccountId:      idxFromCfg_(cols.ACCOUNT_ID),
        colCustomerRId:    resolveCol_('Customer__r.Id', ['customer__r.id'], -1),
        colAccountName:    idxFromCfg_(cols.ACCOUNT_NAME),
        colIndustry:       idxFromCfg_(cols.INDUSTRY),
        colRegion:         idxFromCfg_(cols.REGION),
        colSubRegion:      idxFromCfg_(cols.SUB_REGION),
        colSubRegionAlt:   idxFromCfg_(cols.SUB_REGION_ALT),
        colCustomerObject: findExact_('Customer__r'),
        colBillingState:   idxFromCfg_(cols.BILLING_STATE),
        colBillingCity:    idxFromCfg_(cols.BILLING_CITY),
        colStartDate:      idxFromCfg_(cols.DEPLOYMENT_START_DATE),
        colMtpDate:        idxFromCfg_(cols.CURRENT_MTP_DATE),
        colFirstMtpActual: detect_(['first_move_to_production_date_actual',
          'move_to_production_date_actual', 'first_mtp_date_actual'], -1),
        colFirstMtp:       idxFromCfg_(cols.FIRST_MTP_DATE),
        colStatus:         cfgStatus,
        colPhase:          idxFromCfg_(cols.DEPLOYMENT_PHASE),
        colStage:          idxFromCfg_(cols.DEPLOYMENT_STAGE),
        colHealth:         idxFromCfg_(cols.DEPLOYMENT_HEALTH),
        colCompletionDate: idxFromCfg_(cols.COMPLETION_DATE),
        colEM:             idxFromCfg_(cols.WD_ENG_MANAGER),
        colDAM:            idxFromCfg_(cols.DAM_FULL_NAME),
        colPrimingPartner: idxFromCfg_(cols.PRIMING_PARTNER),
        colImplPartner:    idxFromCfg_(cols.IMPL_PARTNER),
        colPartner:        idxFromCfg_(cols.PARTNER),
        colSummary:        idxFromCfg_(cols.CURRENT_DEPLOYMENT_UPDATE)
      };
    }

    var cols = cfg.columns || {};
    var cfgId = idxFromCfg_(cols.DEPLOYMENT_ID);
    var cfgStatus = idxFromCfg_(cols.OVERALL_STATUS);
    var cfgLooksConfigured = cfgId >= 0 && cfgStatus >= 0;
    var cfgValid = cfgLooksConfigured &&
      headerLooksLikeDeploymentId_(headers[cfgId]) &&
      headerLooksLikeOverallStatus_(headers[cfgStatus]);

    var recognizableExport = hasRecognizableSfdcExportHeaders_();
    var indices;
    var source;

    if (recognizableExport) {
      indices = buildHeaderKeywordIndices_();
      if (cfgLooksConfigured && !cfgValid) {
        source = 'cfg.columns_rejected_header_mismatch';
      } else {
        source = 'header_keywords';
      }
    } else if (cfgValid) {
      indices = buildCfgColumnIndices_(cfgId, cfgStatus);
      source = 'cfg.columns_validated';
    } else {
      indices = buildHeaderKeywordIndices_();
      source = cfgLooksConfigured ? 'cfg.columns_rejected_header_mismatch' : 'header_keywords';
    }

    var headerByKey = {};
    Object.keys(indices).forEach(function (key) {
      var idx = indices[key];
      headerByKey[key] = idx >= 0 ? (headers[idx] || '') : '';
    });

    return {
      indices: indices,
      source: source,
      headerByKey: headerByKey
    };
  }

  /**
   * For diagnostics: how readSfdcDeploymentsRaw_ would treat one sheet row.
   *
   * @param {AppConfig} cfg
   * @param {number} sourceRowNumber  1-based sheet row (header = 1).
   * @param {Array<Array>} allValues  Full sheet values including header.
   * @param {Array<string>} headers
   * @return {Object}
   * @private
   */
  function _diagnoseSfdcRawRowEmission_(cfg, sourceRowNumber, allValues, headers) {
    var resolved = _resolveSfdcDeploymentsColumnIndices_(cfg, headers);
    var idx = resolved.indices;
    var dataRowIndex = sourceRowNumber - 1;
    if (dataRowIndex < 1 || dataRowIndex >= allValues.length) {
      return { error: 'sourceRowNumber out of range' };
    }
    var row = allValues[dataRowIndex];
    var colId = idx.colId;
    var deploymentIdFromReaderCol = colId >= 0 ? String(row[colId] || '').trim() : '';
    var deploymentIdFromCfgCol = '';
    var cols = cfg.columns || {};
    if (cols.DEPLOYMENT_ID >= 1) {
      var cfgIdx = cols.DEPLOYMENT_ID - 1;
      if (cfgIdx < row.length) deploymentIdFromCfgCol = String(row[cfgIdx] || '').trim();
    }
    var overallFromReader = idx.colStatus >= 0 ? String(row[idx.colStatus] || '').trim() : '';
    return {
      columnSource: resolved.source,
      readerColumnIndices: resolved.indices,
      readerColumnHeaders: resolved.headerByKey,
      deploymentIdFromReaderCol: deploymentIdFromReaderCol,
      deploymentIdFromCfgCol: deploymentIdFromCfgCol,
      wouldSkipEmptyReaderId: !deploymentIdFromReaderCol,
      overallStatusFromReaderCol: overallFromReader,
      passesBuildEffectiveOverallGate:
        !overallFromReader || overallFromReader === 'Active',
      passesBuildEffectiveLegacyStatusGate: true
    };
  }

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
   * @param {Object=} readOpts  Optional diagnostics: { bypassCache, targetDeploymentId,
   *   sourceRowNumber, instrumentation }.
   * @return {Array<Object>}  Raw deployment rows; may be empty if sheet missing.
   * @private
   */
  function readSfdcDeploymentsRaw_(cfg, readOpts) {
    readOpts = readOpts || {};
    var traceTargetId = readOpts.targetDeploymentId
      ? String(readOpts.targetDeploymentId).trim() : '';
    var bypassCache = !!readOpts.bypassCache || !!traceTargetId;
    var instr = readOpts.instrumentation || null;
    if (instr) {
      instr.bypassCache = bypassCache;
      instr.targetDeploymentId = traceTargetId;
      instr.sourceRowNumberHint = readOpts.sourceRowNumber || null;
      instr.readPath = '';
      instr.duplicateSuppressionInReader = false;
      instr.duplicateKey = null;
      instr.firstRowKeptPreview = null;
      instr.skippedRowPreview = null;
      instr.duplicatePreferReason = 'readSfdcDeploymentsRaw_ does not de-duplicate rows; only skip is empty Id at reader colId.';
      instr.gatesChecked = [];
      instr.emitted = null;
      instr.skipReason = null;
      instr.emittedRowPreview = null;
    }

    // Performance Layer 1: tier 1 (in-memory).
    if (!bypassCache && _cache.sfdcRows !== null) {
      if (instr) instr.readPath = 'tier1_memory';
      return _cache.sfdcRows;
    }
    // Performance Layer 2: tier 2 (sheet-tab cache).
    var cacheKey = _perfKey_(cfg, 'sfdcRows');
    if (!bypassCache) {
      var cached = _perfCacheRead_(cacheKey);
      if (cached !== null) {
        if (instr) instr.readPath = 'tier2_sheet_tab';
        _cache.sfdcRows = cached; // hoist to tier 1 for the rest of this execution
        return cached;
      }
    } else if (instr) {
      instr.readPath = 'sheet_fresh';
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
    var colResolved = _resolveSfdcDeploymentsColumnIndices_(cfg, headers);
    var colId             = colResolved.indices.colId;
    var colName           = colResolved.indices.colName;
    var colAccountId      = colResolved.indices.colAccountId;
    var colCustomerRId    = colResolved.indices.colCustomerRId;
    var colAccountName    = colResolved.indices.colAccountName;
    var colIndustry       = colResolved.indices.colIndustry;
    var colRegion         = colResolved.indices.colRegion;
    var colSubRegion      = colResolved.indices.colSubRegion;
    var colSubRegionAlt   = colResolved.indices.colSubRegionAlt;
    var colCustomerObject = colResolved.indices.colCustomerObject;
    var colBillingState   = colResolved.indices.colBillingState;
    var colBillingCity    = colResolved.indices.colBillingCity;
    var colStartDate      = colResolved.indices.colStartDate;
    var colMtpDate        = colResolved.indices.colMtpDate;
    var colFirstMtpActual = colResolved.indices.colFirstMtpActual;
    var colFirstMtp       = colResolved.indices.colFirstMtp;
    var colStatus         = colResolved.indices.colStatus;
    var colPhase          = colResolved.indices.colPhase;
    var colStage          = colResolved.indices.colStage;
    var colHealth         = colResolved.indices.colHealth;
    var colCompletionDate = colResolved.indices.colCompletionDate;
    var colEM             = colResolved.indices.colEM;
    var colDAM            = colResolved.indices.colDAM;
    var colPrimingPartner = colResolved.indices.colPrimingPartner;
    var colImplPartner    = colResolved.indices.colImplPartner;
    var colPartner        = colResolved.indices.colPartner;
    var colSummary        = colResolved.indices.colSummary;

    Logger.log('CoreData.readSfdcDeploymentsRaw_: column resolution mode=' +
               colResolved.source + ' for "' + sheetName + '".');
    if (colResolved.source === 'cfg.columns_rejected_header_mismatch') {
      var rejCols = cfg.columns || {};
      var rejIdIdx = (rejCols.DEPLOYMENT_ID >= 1) ? rejCols.DEPLOYMENT_ID - 1 : -1;
      var rejStIdx = (rejCols.OVERALL_STATUS >= 1) ? rejCols.OVERALL_STATUS - 1 : -1;
      Logger.log('CoreData.readSfdcDeploymentsRaw_: cfg.columns rejected — DEPLOYMENT_ID col ' +
                 rejCols.DEPLOYMENT_ID + ' header="' + (rejIdIdx >= 0 ? headers[rejIdIdx] : '') +
                 '", OVERALL_STATUS col ' + rejCols.OVERALL_STATUS + ' header="' +
                 (rejStIdx >= 0 ? headers[rejStIdx] : '') + '"; using header detection.');
    }

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
    var emittedIdIndex = {};
    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];
      var physicalRowNumber = r + 1;
      var isTraceRow = false;
      if (traceTargetId || readOpts.sourceRowNumber) {
        if (readOpts.sourceRowNumber && physicalRowNumber === readOpts.sourceRowNumber) {
          isTraceRow = true;
        }
      }

      function cellStr_(col) { return col >= 0 ? String(row[col] || '').trim() : ''; }
      function cellDate_(col) {
        if (col < 0) return '';
        return _sheetCellToDateKey_(row[col], tz);
      }
      function resolveField_(flatCol, objectCol, objectField) {
        var flat = cellStr_(flatCol);
        if (flat) {
          return normalizeSalesforceRelatedName_(flat, objectField);
        }
        if (objectCol >= 0 && objectField) {
          return normalizeSalesforceRelatedName_(row[objectCol], objectField);
        }
        return '';
      }
      function resolveAccountId_() {
        var direct = cellStr_(colAccountId);
        if (direct) return direct;
        var fromCustomerRId = cellStr_(colCustomerRId);
        if (fromCustomerRId) return fromCustomerRId;
        if (colCustomerObject >= 0) {
          return _parseSfdcAccountIdFromCustomerObject_(row[colCustomerObject]);
        }
        return '';
      }

      var deploymentId = cellStr_(colId);
      if (traceTargetId && _deploymentIdEquals_(deploymentId, traceTargetId)) {
        isTraceRow = true;
      }
      if (isTraceRow && instr && !instr.physicalSheetRowNumber) {
        instr.physicalSheetRowNumber = physicalRowNumber;
        instr.resolvedColumnIndices = colResolved.indices;
        instr.resolvedColumnHeaders = colResolved.headerByKey;
        instr.columnResolutionSource = colResolved.source;
        instr.rawDeploymentIdFromReaderCol = deploymentId;
        instr.normalizedDeploymentId = _normalizeDeploymentIdForTrace_(deploymentId);
        var idForms = _salesforceIdFormsForTrace_(deploymentId);
        instr.deploymentId15 = idForms.id15;
        instr.deploymentId18 = idForms.id18;
        instr.deploymentName = cellStr_(colName);
        instr.accountId = resolveAccountId_();
        instr.accountName = resolveField_(colAccountName, colCustomerObject, 'Name');
        instr.industry = resolveField_(colIndustry, colCustomerObject, 'Industry');
        instr.region = resolveField_(colRegion, colCustomerObject, 'PS_Region_New__c');
        instr.subRegion = resolveField_(colSubRegion, colCustomerObject, 'PS_Sub_Region__c');
        instr.overallStatus = cellStr_(colStatus);
        instr.status = cellStr_(colStatus);
        instr.phase = cellStr_(colPhase);
        instr.stage = cellStr_(colStage);
        instr.health = cellStr_(colHealth);
        instr.mtpDate = cellStr_(colMtpDate);
        instr.currentUpdate = cellStr_(colSummary);
        instr.gatesChecked = [];
      }
      if (isTraceRow && instr) {
        instr.gatesChecked.push({
          gate: 'deploymentId_non_empty_at_reader_colId',
          passed: !!deploymentId,
          readerColIndex: colId,
          readerColHeader: colResolved.headerByKey.colId || ''
        });
      }
      if (!deploymentId) {
        if (isTraceRow && instr) {
          instr.emitted = false;
          instr.skipReason = 'empty_deployment_id_at_reader_colId';
        }
        continue; // skip rows with no SF Id
      }

      var rowObj = {
        deploymentId:        deploymentId,
        deploymentName:      cellStr_(colName),
        accountId:           resolveAccountId_(),
        accountName:         resolveField_(colAccountName, colCustomerObject, 'Name'),
        industry:            resolveField_(colIndustry, colCustomerObject, 'Industry'),
        region:              resolveField_(colRegion, colCustomerObject, 'PS_Region_New__c'),
        subRegion:           resolveField_(colSubRegion, colCustomerObject, 'PS_Sub_Region__c'),
        subRegionAlt:        resolveField_(colSubRegionAlt, colCustomerObject, 'SubRegion__c'),
        billingState:        cellStr_(colBillingState),
        billingCity:         cellStr_(colBillingCity),
        deploymentStartDate: cellStr_(colStartDate),
        mtpDate:             cellStr_(colMtpDate),
        firstMtpDate:        cellStr_(colFirstMtp),
        firstMtpDateActual:  cellDate_(colFirstMtpActual),
        overallStatus:       cellStr_(colStatus),
        status:              cellStr_(colStatus),
        phase:               cellStr_(colPhase),
        stage:               cellStr_(colStage),
        health:              cellStr_(colHealth),
        completionDate:      cellStr_(colCompletionDate),
        wdEngManager:        normalizeSalesforceRelatedName_(cellStr_(colEM), 'Full_Name__c'),
        damFullName:         normalizeSalesforceRelatedName_(cellStr_(colDAM), 'Full_Name__c'),
        primingPartner:      cellStr_(colPrimingPartner),
        implPartner:         cellStr_(colImplPartner),
        partner:             cellStr_(colPartner),
        currentUpdate:       cellStr_(colSummary)
      };
      var _wKey = (rowObj.accountId || '').slice(0, 15);
      var _wellness = _wellnessMap[_wKey] || null;
      _attachWellnessFieldsToRow_(rowObj, _wellness, cfg);
      if (isTraceRow && instr) {
        var dupKey = _normalizeDeploymentIdForTrace_(rowObj.deploymentId);
        if (dupKey && emittedIdIndex[dupKey] !== undefined) {
          instr.duplicateKey = dupKey;
          instr.firstRowKeptPreview = _deploymentTracePreview_(rows[emittedIdIndex[dupKey]]);
          instr.skippedRowPreview = _deploymentTracePreview_(rowObj);
          instr.duplicatePreferReason =
            'Not suppressed — readSfdcDeploymentsRaw_ emits all rows with non-empty Id; earlier row index ' +
            emittedIdIndex[dupKey] + ' and this row both present in output.';
        } else if (dupKey) {
          emittedIdIndex[dupKey] = rows.length;
        }
        instr.emitted = true;
        instr.skipReason = null;
        instr.emittedRowPreview = _deploymentTracePreview_(rowObj);
        instr.emittedRowIdCandidates = _collectDeploymentIdCandidatesFromRow_(rowObj);
        instr.emittedRowIdForms = _salesforceIdFormsForTrace_(rowObj.deploymentId);
      }
      rows.push(rowObj);
    }

    if (instr && traceTargetId && instr.physicalSheetRowNumber == null) {
      instr.emitted = false;
      instr.skipReason = instr.skipReason || 'target_row_not_seen_in_sheet_loop';
    }

    Logger.log('CoreData.readSfdcDeploymentsRaw_: read ' + rows.length +
               ' rows from "' + sheetName + '".');
    if (instr && traceTargetId) {
      Logger.log('CoreData.readSfdcDeploymentsRaw_: target instrumentation ' +
        JSON.stringify(instr));
    }
    // Performance Layer 1: tier 1 (in-memory).
    _cache.sfdcRows = rows;
    // Performance Layer 2: tier 2 (sheet-tab cache).
    _perfCacheWrite_(cacheKey, rows, cfg.appId);
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
      Classification:         row.classification || 'Monthly',
      Reason:                 row.reason || ''
    };
  }

  function snapshotGoLivesOverride_(cfg, accountName) {
    var map = getGoLivesOverridesMap_(cfg);
    var row = _lookupGoLivesOverrideForAccount_(accountName, map);
    if (!row || (!row.overrideDate && !row.overridePartner && !row.exclude)) return { isEmpty: true };
    return {
      isEmpty: false,
      Override_GoLiveDate: row.overrideDate ? CoreUtils.formatDateToIsoString(row.overrideDate) : '',
      Override_Partner:    row.overridePartner || '',
      Exclude_From_Report: !!row.exclude,
      Classification:      row.classification || 'Monthly',
      Reason:              row.reason || ''
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
    var perfStart = Date.now();
    var cfg = CoreConfig.withDefaults(config);

    // Base effective view — includes SFDC-vs-legacy fallback, Active-only filter,
    // meta application, overrides application, and D1 ddContacts/ddFromContacts.
    var tEffective = Date.now();
    var allEffective = getAllEffectiveDeployments(cfg, productOpts);
    var effectiveMs = Date.now() - tEffective;
    var tDhp = Date.now();
    allEffective = applyDeploymentHealthPlansToRows_(allEffective, cfg);
    var dhpMs = Date.now() - tDhp;

    // Phase 3a: enrich with isPhased, upcomingDates, nextGoLiveDate.
    // Degrade gracefully when the enrichment sheet is absent.
    var enrichmentMap = {};
    var tEnrichRead = Date.now();
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData.getAllDeployments: CoreSalesforce enrichment failed — ' +
                 'isPhased will default to false. Error: ' + err);
    }
    var enrichReadMs = Date.now() - tEnrichRead;

    var tEnrichMerge = Date.now();
    var enriched = allEffective.map(function (row) {
      var lookupId = row.parentDeploymentId || row.deploymentId;
      var enrichment = enrichmentMap[row.deploymentId] || enrichmentMap[lookupId];
      return Object.assign({}, row, {
        isPhased:       enrichment ? !!enrichment.isPhased : false,
        upcomingDates:  enrichment ? (enrichment.upcomingDates || []) : [],
        nextGoLiveDate: enrichment ? (enrichment.nextGoLiveDate || null) : null
      });
    });
    var enrichMergeMs = Date.now() - tEnrichMerge;

    // S1: exclude Student deployments from the Deployments tab view (HENP only).
    enriched = filterDeploymentsByStudent_(enriched, 'exclude', cfg);

    // Health-rank sort: Red -> Yellow -> Green -> other; tiebreak by accountName.
    var tSort = Date.now();
    var sorted = enriched.sort(function (a, b) {
      var rank = { 'Red': 0, 'Yellow': 1, 'Green': 2 };
      var ar = rank[a.health] !== undefined ? rank[a.health] : 99;
      var br = rank[b.health] !== undefined ? rank[b.health] : 99;
      if (ar !== br) return ar - br;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });
    var sortMs = Date.now() - tSort;
    var tView = Date.now();
    var result = applyViewModeFilter_(cfg, sorted, viewModeOpts);
    var viewMs = Date.now() - tView;
    var totalMs = Date.now() - perfStart;
    if (totalMs >= 3000 || (cfg.ui && cfg.ui.logServerTimings)) {
      Logger.log('CoreData.getAllDeployments(' + (cfg.appId || '?') + '): rows=' + result.length +
        ' effective=' + (effectiveMs / 1000).toFixed(1) + 's dhp=' + (dhpMs / 1000).toFixed(1) +
        's enrichRead=' + (enrichReadMs / 1000).toFixed(1) + 's enrichMerge=' + (enrichMergeMs / 1000).toFixed(1) +
        's sort=' + (sortMs / 1000).toFixed(1) + 's viewFilter=' + (viewMs / 1000).toFixed(1) +
        's total=' + (totalMs / 1000).toFixed(1) + 's');
    }
    return result;
  }

  /**
   * True when ProductMode KPI totals should use count grain, not display grain.
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {boolean}
   * @private
   */
  function _productModeUsesSeparateCountGrain_(cfg) {
    return false;
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
    var totalStart = Date.now();
    var cfg = CoreConfig.withDefaults(config);
    var displayRows = getAllDeployments(cfg, viewModeOpts, productOpts);

    if (!_productModeUsesSeparateCountGrain_(cfg)) {
      var simpleMs = Date.now() - totalStart;
      if (simpleMs >= 3000 || (cfg.ui && cfg.ui.logServerTimings)) {
        Logger.log('CoreData.getAllDeploymentsForUI(' + (cfg.appId || '?') + '): displayRows=' +
          (displayRows ? displayRows.length : 0) + ' total=' + (simpleMs / 1000).toFixed(1) + 's');
      }
      return displayRows;
    }

    var tCount = Date.now();
    var countRows = getActiveCountDeployments(cfg, productOpts) || [];
    countRows = filterDeploymentsByStudent_(countRows, 'exclude', cfg);
    countRows = applyViewModeFilter_(cfg, countRows, viewModeOpts);
    var countMs = Date.now() - tCount;
    var totalMs = Date.now() - totalStart;
    if (totalMs >= 3000 || (cfg.ui && cfg.ui.logServerTimings)) {
      Logger.log('CoreData.getAllDeploymentsForUI(' + (cfg.appId || '?') + '): displayRows=' +
        (displayRows ? displayRows.length : 0) + ' countRows=' + countRows.length +
        ' countGrain=' + (countMs / 1000).toFixed(1) + 's total=' + (totalMs / 1000).toFixed(1) + 's');
    }

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
        phase:          dep.phase || '',
        servicesApproach: dep.phase || dep.servicesApproach || '',
        deploymentPhase:  dep.phase || dep.deploymentPhase || '',
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
    results = _finalizeRecentGoLivesAfterOverrides_(cfg, results, windowDaysOverride);

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
   * Rolls up health across grouped PF rows: Red > Yellow > Green > blank/unknown.
   * Mixed child health within one Deployment__r.Id group is an extreme edge case.
   * @param {Array<string>} healths
   * @return {string}
   * @private
   */
  function _rollupParentDeploymentHealth_(healths) {
    return _rollupGoLiveHealth_(healths);
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
      servicesApproach: first.phase || '',
      deploymentPhase: first.phase || '',
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
   * @param {Object=} deploymentOverrides  getDeploymentOverridesMap_(cfg)
   * @return {Array<Object>}
   * @private
   */
  function _collectProductModeGoLivePfDetails_(pfRows, cfg, goLiveType, windowStartKey, windowEndKey, goLivesOverrides, deploymentOverrides) {
    var activeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                        cfg.salesforce.statusValues.active) || 'Active';
    var normalizedType = _normalizeProductModeGoLiveType_(goLiveType) || goLiveType;
    var depMap = deploymentOverrides || {};
    var details = [];
    (pfRows || []).forEach(function (pf) {
      if (!pf || (!pf.deploymentFk && !pf.parentDeploymentId)) return;
      var ov = (goLivesOverrides && goLivesOverrides[pf.accountName]) || {};
      if (ov.exclude) return;

      var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      var depOv = _deploymentOverrideForParentId_(parentId, depMap);
      if (depOv.exclude) return;

      var dateKey = null;
      if (normalizedType === 'actual') {
        dateKey = _toDateKey_(pf.actualGoLive);
      } else if (normalizedType === 'target') {
        var status = String(pf.overallStatus || '').trim();
        if (status && status !== activeStatus) return;
        dateKey = _resolvePfUpcomingGoLiveDateKey_(pf, ov, depOv);
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
    var deploymentOverrides = getDeploymentOverridesMap_(cfg);
    var recentRaw = _collectProductModeGoLivePfDetails_(
      pfRows, cfg, 'actual', recentStartKey, todayKey, goLivesOverrides, deploymentOverrides);
    var upcomingRaw = _collectProductModeGoLivePfDetails_(
      pfRows, cfg, 'target', todayKey, upcomingEndKey, goLivesOverrides, deploymentOverrides);
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
   * Adds parent-level go-live events for union members without scoped PF date rows.
   * @param {AppConfig} cfg
   * @param {Array<Object>} results
   * @param {Object} options
   * @param {string} goLiveType
   * @param {string} windowStartKey
   * @param {string} windowEndKey
   * @return {Array<Object>}
   * @private
   */
  function _appendUnionParentGoLiveFallbacks_(cfg, results, options, goLiveType, windowStartKey, windowEndKey) {
    if (!usesProductModeParentAndPfUnion_(cfg)) return results || [];
    results = results || [];
    var goLivesOverrides = getGoLivesOverridesMap_(cfg);
    var deploymentOverrides = getDeploymentOverridesMap_(cfg);
    var unionRows = buildProductModeCanonicalUnionRows_(cfg, {
      surface: goLiveType === 'actual' ? 'trends' : 'default',
      productOpts: options.productOpts
    });
    var seenParents = {};
    results.forEach(function (row) {
      var pid = _canonicalId_(row.parentDeploymentId || row.deploymentId);
      if (pid) seenParents[pid] = true;
    });

    unionRows.forEach(function (dep) {
      var parentId = _canonicalId_(dep.parentDeploymentId || dep.deploymentId);
      if (!parentId || seenParents[parentId]) return;
      var ov = goLivesOverrides[dep.accountName] || {};
      if (ov.exclude) return;
      var depOv = _deploymentOverrideForParentId_(parentId, deploymentOverrides);
      if (depOv.exclude) return;

      var dateKey = null;
      if (goLiveType === 'actual') {
        dateKey = _toDateKey_(dep.firstMtpDateActual);
      } else {
        var activeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                            cfg.salesforce.statusValues.active) || 'Active';
        var status = String(dep.overallStatus || '').trim();
        if (status && status !== activeStatus) return;
        if (_hasOverrideCellValue_(ov.overrideDate)) {
          dateKey = _toDateKey_(ov.overrideDate);
        } else if (_hasOverrideCellValue_(depOv.overrideMtp)) {
          dateKey = _toDateKey_(depOv.overrideMtp);
        } else {
          dateKey = _toDateKey_(dep.mtpDate);
        }
      }
      if (!dateKey || !_dateKeyInRange_(dateKey, windowStartKey, windowEndKey)) return;

      var eventRow = {
        deploymentId: parentId,
        parentDeploymentId: parentId,
        deploymentFk: parentId,
        accountId: dep.accountId || '',
        accountName: dep.accountName || '',
        deploymentName: dep.deploymentName || '',
        partner: ov.overridePartner || dep.partner || '',
        industry: dep.industry || '',
        region: dep.region || '',
        subRegion: dep.subRegion || '',
        health: dep.health || '',
        goLiveDate: dateKey,
        goLiveType: goLiveType,
        productFunctions: [],
        productFunctionCount: 0,
        productAreas: [],
        functions: [],
        deploymentRowSource: 'productModeUnionParentFallback',
        parentMatchStatus: dep.parentMatchStatus || 'matchedParent',
        dateSource: goLiveType === 'actual' ? 'Parent Actual MTP' : 'Parent Current MTP'
      };
      if (goLiveType === 'actual') {
        eventRow.recentDates = [{ date: dateKey, products: [] }];
        eventRow.lastGoLiveDate = dateKey;
      } else {
        eventRow.upcomingDates = [{ date: dateKey, products: [] }];
        eventRow.nextGoLiveDate = dateKey;
        eventRow.mtpDate = dateKey;
      }
      results.push(eventRow);
      seenParents[parentId] = true;
    });
    return results;
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
    var deploymentOverrides = getDeploymentOverridesMap_(cfg);
    var rawDetails = _collectProductModeGoLivePfDetails_(
      pfRows, cfg, goLiveType, windowStartKey, windowEndKey, goLivesOverrides, deploymentOverrides);
    var grouped = _groupProductModeGoLivePfDetails_(rawDetails);
    var results = _appendUnionParentGoLiveFallbacks_(
      cfg, grouped.events, options, goLiveType, windowStartKey, windowEndKey);

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
   * Debug-only: normalize a date-ish value to YYYY-MM-DD (same rules as go-live pipeline).
   * @param {*} val
   * @return {string}
   */
  function formatShortDateForDebug_(val) {
    return _toDateKey_(val);
  }

  /**
   * Self-check for calendar date-key normalization (run from Apps Script editor).
   * @param {AppConfig=} config
   * @return {{ allPass: boolean, results: Array<Object> }}
   */
  function debugCalendarDateKeyNormalization_(config) {
    var cases = [
      { label: 'date-only string', input: '2026-10-23', expect: '2026-10-23' },
      { label: 'UTC midnight ISO', input: '2026-10-23T00:00:00.000Z', expect: '2026-10-23' },
      { label: 'prior day string', input: '2026-10-22', expect: '2026-10-22' }
    ];
    var results = cases.map(function (c) {
      var once = _toDateKey_(c.input);
      var twice = _toDateKey_(once);
      return {
        label: c.label,
        input: c.input,
        once: once,
        twice: twice,
        expect: c.expect,
        pass: once === c.expect && twice === c.expect
      };
    });
    var allPass = results.every(function (r) { return r.pass; });
    Logger.log('CoreData.debugCalendarDateKeyNormalization_: allPass=' + allPass +
               ' results=' + JSON.stringify(results));
    return { allPass: allPass, results: results };
  }

  /**
   * Read-only trace of PF / override inputs for an upcoming go-live report row.
   * @param {AppConfig} config
   * @param {string=} optionalTokenOrDeploymentId
   * @return {Object}
   */
  function debugUpcomingGoLiveReportRowSource_(config, optionalTokenOrDeploymentId) {
    var cfg = CoreConfig.withDefaults(config);
    var token = String(optionalTokenOrDeploymentId || '').trim();
    var tokenLower = token.toLowerCase();
    var histKey = usesProductModeParentAndPfUnion_(cfg) ? 'hist:v2:all' : 'hist:all';

    function idMatches_(id) {
      if (!token) return true;
      var s = String(id || '').trim().toLowerCase();
      if (!s) return false;
      if (s === tokenLower || s.indexOf(tokenLower) >= 0) return true;
      if (tokenLower.length >= 15 && s.indexOf(tokenLower.slice(0, 15)) >= 0) return true;
      return false;
    }

    function describeRawDate_(val) {
      return {
        raw: val instanceof Date ? val.toISOString() : val,
        type: val instanceof Date ? 'Date' : typeof val,
        dateKey: _toDateKey_(val)
      };
    }

    var depOverrides = getDeploymentOverridesMap_(cfg);
    var glOverrides = getGoLivesOverridesMap_(cfg);
    var deploymentOverrideForToken = null;
    Object.keys(depOverrides).forEach(function (depId) {
      if (!idMatches_(depId)) return;
      var ov = depOverrides[depId];
      deploymentOverrideForToken = {
        deploymentId: depId,
        overrideMtp: describeRawDate_(ov.overrideMtp),
        excludeFromReport: !!ov.exclude,
        overrideCurrentUpdate: ov.overrideCurrentUpdate || ''
      };
    });

    var pfRows = getProductModeHistoricalPfRows_(cfg, { product: 'all' }) || [];
    var matchingPfRows = [];
    pfRows.forEach(function (pf) {
      if (!pf) return;
      var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
      if (token && !idMatches_(parentId) && !idMatches_(pf.pfRowId) &&
          String(pf.accountName || '').toLowerCase().indexOf(tokenLower) < 0) {
        return;
      }
      matchingPfRows.push({
        pfRowId: pf.pfRowId || '',
        parentDeploymentId: parentId,
        accountName: pf.accountName || '',
        deploymentName: pf.deploymentName || '',
        productArea: pf.productArea || '',
        funcArea: pf.funcArea || '',
        overallStatus: pf.overallStatus || '',
        targetGoLive: describeRawDate_(pf.targetGoLive),
        actualGoLive: describeRawDate_(pf.actualGoLive)
      });
    });

    var effectiveParent = null;
    if (token) {
      try {
        var effective = getAllEffectiveDeployments(cfg, { product: 'all' }) || [];
        effective.forEach(function (dep) {
          if (!idMatches_(dep.deploymentId) && !idMatches_(dep.parentDeploymentId)) return;
          effectiveParent = {
            deploymentId: dep.deploymentId || '',
            parentDeploymentId: dep.parentDeploymentId || '',
            accountName: dep.accountName || '',
            mtpDate: describeRawDate_(dep.mtpDate),
            deploymentRowSource: dep.deploymentRowSource || ''
          };
        });
      } catch (effErr) {
        Logger.log('CoreData.debugUpcomingGoLiveReportRowSource_: effective lookup failed: ' + effErr);
      }
    }

    var glOvForAccount = null;
    if (effectiveParent && effectiveParent.accountName) {
      glOvForAccount = glOverrides[effectiveParent.accountName] || null;
    } else if (matchingPfRows.length && matchingPfRows[0].accountName) {
      glOvForAccount = glOverrides[matchingPfRows[0].accountName] || null;
    }
    if (glOvForAccount) {
      glOvForAccount = {
        overrideDate: describeRawDate_(glOvForAccount.overrideDate),
        exclude: !!glOvForAccount.exclude,
        overridePartner: glOvForAccount.overridePartner || ''
      };
    }

    return {
      token: token || null,
      usesProductModePfGoLiveSource: usesProductModePfGoLiveSource_(cfg),
      usesProductModeParentUnion: usesProductModeParentAndPfUnion_(cfg),
      deploymentOverrideForToken: deploymentOverrideForToken,
      goLivesOverrideForAccount: glOvForAccount,
      effectiveParentDeployment: effectiveParent,
      matchingPfRows: matchingPfRows,
      rawPfRowCount: matchingPfRows.length,
      cacheLayer: {
        historicalPfRowsFromExecutionCache: !!(
          _cache.historicalPfByProduct && _cache.historicalPfByProduct[histKey]
        ),
        deploymentOverridesFromExecutionCache: _cache.overridesMap !== null,
        goLivesOverridesFromExecutionCache: _cache.goLivesOverridesMap !== null,
        reportBuildContextActive: !!_cache.reportBuildCtx,
        note: 'Per-execution in-memory cache only; no stale cross-run report row cache.'
      }
    };
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
    results = _finalizeRecentGoLivesAfterOverrides_(cfg, results, windowDaysOverride);
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
    if (overrideData.overrideAccount !== undefined) {
      setCell('Override_Account', overrideData.overrideAccount);
    }
    if (overrideData.overrideDeployment !== undefined) {
      setCell('Override_Deployment', overrideData.overrideDeployment);
    }
    setCell('Override_CurrentUpdate', overrideData.overrideCurrentUpdate);
    setCell('Exclude_From_Report', overrideData.excludeFromReport);
    // Phase 2: classification
    if (overrideData.classification !== undefined) {
      setCell('Classification', normalizeClassification_(overrideData.classification));
    }
    if (notes !== undefined && notes !== null) {
      setCell('Reason', String(notes || ''));
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
    if (notes !== undefined && notes !== null) {
      setCell('Reason', String(notes || ''));
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
   * Builds lookup sets for orphan detection in getAllActiveOverrides.
   * @param {AppConfig} cfg
   * @return {{ deploymentIds: Object, accountNames: Object }}
   * @private
   */
  function _buildOverrideUniverseLookups_(cfg) {
    var deploymentIds = {};
    var accountNames = {};

    try {
      var sfdcRows = readSfdcDeploymentsRaw_(cfg) || [];
      sfdcRows.forEach(function (r) {
        var id = _canonicalId_(r.deploymentId);
        if (id) deploymentIds[id] = true;
        if (r.accountName) accountNames[String(r.accountName).trim()] = true;
      });
    } catch (err) {
      Logger.log('_buildOverrideUniverseLookups_: readSfdcDeploymentsRaw_ failed: ' + err);
    }

    try {
      var pfRows = readSfdcProductFunctionsRaw_(cfg) || [];
      pfRows.forEach(function (pf) {
        var parentId = _canonicalId_(pf.parentDeploymentId || pf.deploymentFk);
        if (parentId) deploymentIds[parentId] = true;
        if (pf.accountName) accountNames[String(pf.accountName).trim()] = true;
      });
    } catch (err) {
      Logger.log('_buildOverrideUniverseLookups_: readSfdcProductFunctionsRaw_ failed: ' + err);
    }

    return { deploymentIds: deploymentIds, accountNames: accountNames };
  }

  /**
   * True when an override key no longer exists in the current deployment/go-live universe.
   * @param {string} type
   * @param {string} key
   * @param {Object} universe
   * @return {boolean}
   * @private
   */
  function _isOrphanedOverride_(type, key, universe) {
    var k = String(key || '').trim();
    if (!k) return true;
    if (type === 'golives') {
      return !universe.accountNames[k];
    }
    var canon = _canonicalId_(k);
    if (universe.deploymentIds[canon]) return false;
    var prefix = canon.length >= 15 ? canon.slice(0, 15) : canon;
    return !Object.keys(universe.deploymentIds).some(function (id) {
      return id === canon || (id.length >= 15 && id.slice(0, 15) === prefix);
    });
  }

  /**
   * Resolves a display deployment name for an override row.
   * @param {AppConfig} cfg
   * @param {string} deploymentId
   * @param {Object} ovRow
   * @return {string}
   * @private
   */
  function _lookupDeploymentNameForOverride_(cfg, deploymentId, ovRow) {
    if (ovRow && ovRow.overrideName) return ovRow.overrideName;
    try {
      var rows = readSfdcDeploymentsRaw_(cfg) || [];
      var target = String(deploymentId || '').trim();
      var prefix = target.length >= 15 ? target.slice(0, 15) : target;
      for (var i = 0; i < rows.length; i++) {
        var id = _canonicalId_(rows[i].deploymentId);
        if (id === target || (id.length >= 15 && id.slice(0, 15) === prefix)) {
          return String(rows[i].deploymentName || '');
        }
      }
    } catch (err) {
      Logger.log('_lookupDeploymentNameForOverride_: read failed: ' + err);
    }
    return '';
  }

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
   *     deploymentName: string,
   *     fieldsSet: Array<string>,  // names of override fields that are non-empty
   *     currentValues: Object,  // the override values
   *     sourceValues: Object,
   *     effectiveValues: Object,
   *     setBy: string,
   *     setAt: string (ISO),
   *     classification: 'Monthly' | 'Structural',
   *     reason: string,
   *     hasOperationalOverride: boolean,
   *     hasReportExclusion: boolean,
   *     isStaleMonthly: boolean,
   *     isOrphaned: boolean,
   *     category: 'operational' | 'report' | 'mixed'
   *   }
   */
  function getAllActiveOverrides(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var out = [];
    var universe = _buildOverrideUniverseLookups_(cfg);

    var depMap = getDeploymentOverridesMap_(cfg);
    Object.keys(depMap).forEach(function (id) {
      var row = depMap[id];
      var fieldsSet = [];
      var hasOperational = false;
      if (row.overrideHealth)        { fieldsSet.push('Override_Health'); hasOperational = true; }
      if (row.overrideMtp)           { fieldsSet.push('Override_MTPDate'); hasOperational = true; }
      if (row.overrideStage)         { fieldsSet.push('Override_Stage'); hasOperational = true; }
      if (row.overrideAccount)       { fieldsSet.push('Override_Account'); hasOperational = true; }
      if (row.overrideName)          { fieldsSet.push('Override_Deployment'); hasOperational = true; }
      if (row.overrideCurrentUpdate) { fieldsSet.push('Override_CurrentUpdate'); hasOperational = true; }
      if (row.exclude)               fieldsSet.push('Exclude_From_Report');
      if (fieldsSet.length === 0) return;

      var accountName = lookupAccountForDeployment_(cfg, id);
      var deploymentName = _lookupDeploymentNameForOverride_(cfg, id, row);
      var sourceRow = null;
      try {
        var sfdcRows = readSfdcDeploymentsRaw_(cfg) || [];
        var target = String(id).trim();
        var prefix = target.length >= 15 ? target.slice(0, 15) : target;
        for (var si = 0; si < sfdcRows.length; si++) {
          var sid = _canonicalId_(sfdcRows[si].deploymentId);
          if (sid === target || (sid.length >= 15 && sid.slice(0, 15) === prefix)) {
            sourceRow = sfdcRows[si];
            break;
          }
        }
      } catch (ignore) { /* best effort */ }

      var sourceValues = {
        health:        sourceRow ? (sourceRow.health || '') : '',
        mtpDate:       sourceRow && sourceRow.mtpDate ? CoreUtils.formatDateToIsoString(sourceRow.mtpDate) : '',
        stage:         sourceRow ? (sourceRow.stage || '') : '',
        account:       sourceRow ? (sourceRow.accountName || '') : accountName,
        deployment:    sourceRow ? (sourceRow.deploymentName || '') : deploymentName,
        currentUpdate: sourceRow ? (sourceRow.currentUpdate || '') : ''
      };
      var effectiveValues = {
        health:            row.overrideHealth || sourceValues.health,
        mtpDate:           row.overrideMtp ? CoreUtils.formatDateToIsoString(row.overrideMtp) : sourceValues.mtpDate,
        stage:             row.overrideStage || sourceValues.stage,
        account:           row.overrideAccount || sourceValues.account,
        deployment:        row.overrideName || sourceValues.deployment,
        currentUpdate:     row.overrideCurrentUpdate || sourceValues.currentUpdate,
        excludeFromReport: !!row.exclude
      };

      var category = 'operational';
      if (row.exclude && !hasOperational) category = 'report';
      else if (row.exclude && hasOperational) category = 'mixed';

      out.push({
        type:                   'deployment',
        accountName:            accountName,
        deploymentId:           id,
        deploymentName:         deploymentName,
        fieldsSet:              fieldsSet,
        currentValues: {
          health:            row.overrideHealth || '',
          mtpDate:           row.overrideMtp ? CoreUtils.formatDateToIsoString(row.overrideMtp) : '',
          stage:             row.overrideStage || '',
          account:           row.overrideAccount || '',
          deployment:        row.overrideName || '',
          currentUpdate:     row.overrideCurrentUpdate || '',
          excludeFromReport: !!row.exclude
        },
        sourceValues:           sourceValues,
        effectiveValues:        effectiveValues,
        setBy:                  row.lastEditedBy || '',
        setAt:                  row.lastEditedAt || '',
        classification:         row.classification || 'Monthly',
        reason:                 row.reason || '',
        hasOperationalOverride: hasOperational,
        hasReportExclusion:     !!row.exclude,
        isStaleMonthly:         isStaleMonthlyOverride_(row.classification, row.lastEditedAt),
        isOrphaned:             _isOrphanedOverride_('deployment', id, universe),
        category:               category
      });
    });

    var golivesMap = getGoLivesOverridesMap_(cfg);
    Object.keys(golivesMap).forEach(function (acct) {
      var row = golivesMap[acct];
      var fieldsSet = [];
      var hasOperational = false;
      if (row.overrideDate)    { fieldsSet.push('Override_GoLiveDate'); hasOperational = true; }
      if (row.overridePartner) { fieldsSet.push('Override_Partner'); hasOperational = true; }
      if (row.exclude)         fieldsSet.push('Exclude_From_Report');
      if (fieldsSet.length === 0) return;

      var category = 'operational';
      if (row.exclude && !hasOperational) category = 'report';
      else if (row.exclude && hasOperational) category = 'mixed';

      out.push({
        type:                   'golives',
        accountName:            acct,
        deploymentId:           acct,
        deploymentName:         '',
        fieldsSet:              fieldsSet,
        currentValues: {
          goLiveDate:        row.overrideDate ? CoreUtils.formatDateToIsoString(row.overrideDate) : '',
          partner:           row.overridePartner || '',
          excludeFromReport: !!row.exclude
        },
        sourceValues:           {},
        effectiveValues: {
          goLiveDate:        row.overrideDate ? CoreUtils.formatDateToIsoString(row.overrideDate) : '',
          partner:           row.overridePartner || '',
          excludeFromReport: !!row.exclude
        },
        setBy:                  row.lastEditedBy || '',
        setAt:                  row.lastEditedAt || '',
        classification:         row.classification || 'Monthly',
        reason:                 row.reason || '',
        hasOperationalOverride: hasOperational,
        hasReportExclusion:     !!row.exclude,
        isStaleMonthly:         isStaleMonthlyOverride_(row.classification, row.lastEditedAt),
        isOrphaned:             _isOrphanedOverride_('golives', acct, universe),
        category:               category
      });
    });

    // Sort by setAt (most recent first)
    out.sort(function (a, b) {
      var ta = a.setAt ? new Date(a.setAt).getTime() : 0;
      var tb = b.setAt ? new Date(b.setAt).getTime() : 0;
      return tb - ta;
    });

    out = applyViewModeFilter_(cfg, out, viewModeOpts);
    if (productOpts && productOpts.product) {
      out = filterDeploymentsByProduct_(out, productOpts.product, cfg);
    }
    return out;
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

  /**
   * Clears a single override row (deployment or go lives) and writes an audit entry.
   * Power-user gated; uses the same audit pattern as bulk clear.
   *
   * @param {AppConfig} config
   * @param {string} type  'deployment' | 'golives'
   * @param {string} idOrAccount  DeploymentID or AccountName
   * @return {{ success: boolean, cleared: number }}
   */
  function clearSingleOverride(config, type, idOrAccount) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    if (!type || !idOrAccount) throw new Error('type and idOrAccount required');

    var target = String(idOrAccount).trim();
    var sheetName = type === 'deployment'
      ? cfg.sheets.deploymentOverrides
      : cfg.sheets.goLivesOverrides;
    var keyHeader = type === 'deployment' ? 'DeploymentID' : 'AccountName';

    var cleared = clearOverrideRowsByPredicate_(
      cfg,
      sheetName,
      type,
      function (row, headers) {
        var idxKey = headers.indexOf(keyHeader);
        if (idxKey < 0) return false;
        var rowKey = String(row[idxKey] || '').trim();
        if (type === 'deployment') {
          if (rowKey === target) return true;
          var targetPrefix = target.length >= 15 ? target.slice(0, 15) : target;
          var rowPrefix = rowKey.length >= 15 ? rowKey.slice(0, 15) : rowKey;
          return rowPrefix === targetPrefix;
        }
        return rowKey === target;
      }
    );

    _clearCache(cfg);
    return { success: cleared > 0, cleared: cleared };
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
   * Normalizes a Salesforce related-object export to a clean display name.
   * Handles blank values, already-clean strings, and object-like strings with
   * Full_Name__c=... (attributes may appear before or after the name field).
   *
   * @param {any} value
   * @param {string=} fieldName  Field to extract when value is object-like. Default Full_Name__c.
   * @return {string}
   * @private
   */
  function normalizeSalesforceRelatedName_(value, fieldName) {
    var s = String(value || '').trim();
    if (!s) return '';
    var target = String(fieldName || 'Full_Name__c').trim();
    if (s.indexOf('{') >= 0 || s.indexOf(target + '=') >= 0) {
      var parsed = _parseSfdcObjectField_(s, target);
      if (parsed) return parsed;
    }
    return s;
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
        return _sheetCellToDateKey_(row[col], tz);
      }
      function resolveField_(flatCol, objectCol, objectField) {
        var flat = cellStr_(flatCol);
        if (flat) {
          return normalizeSalesforceRelatedName_(flat, objectField);
        }
        if (objectCol >= 0 && objectField) {
          return normalizeSalesforceRelatedName_(row[objectCol], objectField);
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
   * Whole calendar days between two normalized date keys (non-negative).
   * @param {string} startKey 'YYYY-MM-DD'
   * @param {string} endKey   'YYYY-MM-DD'
   * @return {number}
   * @private
   */
  function _calendarDaysBetweenKeys_(startKey, endKey) {
    var a = _toDateKey_(startKey);
    var b = _toDateKey_(endKey);
    if (!a || !b) return NaN;
    var pa = a.split('-');
    var pb = b.split('-');
    if (pa.length !== 3 || pb.length !== 3) return NaN;
    var t1 = Date.UTC(parseInt(pa[0], 10), parseInt(pa[1], 10) - 1, parseInt(pa[2], 10));
    var t2 = Date.UTC(parseInt(pb[0], 10), parseInt(pb[1], 10) - 1, parseInt(pb[2], 10));
    return Math.round(Math.abs(t2 - t1) / 86400000);
  }

  /**
   * Union of calendar date keys, sorted ascending.
   * @param {Array<string>} a
   * @param {Array<string>} b
   * @return {Array<string>}
   * @private
   */
  function _mergeMdsPglSourceEventDateKeys_(a, b) {
    var seen = {};
    var out = [];
    (a || []).concat(b || []).forEach(function (d) {
      var key = _toDateKey_(d) || String(d || '').trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    out.sort();
    return out;
  }

  /**
   * Clusters same-kind go-live events when adjacent sorted dates are within thresholdDays.
   * @param {Array<Object>} events
   * @param {number} thresholdDays
   * @param {Object} deploymentRow
   * @param {string} kind  'MDS'|'PGL'
   * @return {Array<Object>}
   * @private
   */
  function _clusterMdsPglEventsOfKind_(events, thresholdDays, deploymentRow, kind) {
    if (!events || events.length === 0) return [];

    var normalized = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var dateKey = _toDateKey_(ev.eventDate) || String(ev.eventDate || '').trim();
      if (!dateKey) continue;
      normalized.push({ event: ev, dateKey: dateKey });
    }
    normalized.sort(function (a, b) {
      return a.dateKey.localeCompare(b.dateKey);
    });
    if (!normalized.length) return [];

    var clusters = [];
    var current = null;
    normalized.forEach(function (item) {
      if (!current) {
        current = { dateKeys: [item.dateKey], events: [item.event] };
        return;
      }
      var lastKey = current.dateKeys[current.dateKeys.length - 1];
      var gap = _calendarDaysBetweenKeys_(lastKey, item.dateKey);
      if (!isNaN(gap) && gap <= thresholdDays) {
        current.dateKeys.push(item.dateKey);
        current.events.push(item.event);
      } else {
        clusters.push(current);
        current = { dateKeys: [item.dateKey], events: [item.event] };
      }
    });
    if (current) clusters.push(current);

    return clusters.map(function (cl) {
      var sourceDates = cl.dateKeys.slice().sort();
      var repKey = sourceDates[0];
      var mergedProducts = [];
      for (var pi = 0; pi < cl.events.length; pi++) {
        mergedProducts = _mergeMdsPglProductLabels_(mergedProducts, cl.events[pi].products);
      }
      var oneThird = null;
      if (kind === 'MDS') {
        oneThird = _computeOneThird_(deploymentRow.deploymentStartDate, repKey);
        if (!oneThird) {
          for (var oi = 0; oi < cl.events.length; oi++) {
            if (cl.events[oi].oneThirdPoint) {
              oneThird = cl.events[oi].oneThirdPoint;
              break;
            }
          }
        }
      }
      return {
        kind: kind,
        eventDate: repKey,
        oneThirdPoint: oneThird,
        products: mergedProducts,
        sourceEventDates: sourceDates,
        clusteredEventDates: sourceDates,
        clusteredFromMultipleEventDates: sourceDates.length > 1
      };
    });
  }

  /**
   * Applies configurable calendar-day clustering to MDS/PGL go-live events for one deployment.
   * @param {Array<Object>} events
   * @param {number} clusterDays
   * @param {Object} deploymentRow
   * @return {Array<Object>}
   * @private
   */
  function _clusterMdsPglGoLiveEvents_(events, clusterDays, deploymentRow) {
    var threshold = (clusterDays == null) ? 0 : Math.max(0, parseInt(String(clusterDays), 10) || 0);
    if (!events || events.length === 0) return [];

    if (threshold <= 0) {
      return events.map(function (ev) {
        var key = _toDateKey_(ev.eventDate) || String(ev.eventDate || '').trim();
        var dates = key ? [key] : [];
        return Object.assign({}, ev, {
          eventDate: key || ev.eventDate,
          sourceEventDates: dates,
          clusteredEventDates: dates,
          clusteredFromMultipleEventDates: false
        });
      });
    }

    var byKind = { MDS: [], PGL: [] };
    events.forEach(function (ev) {
      if (ev.kind === 'MDS' || ev.kind === 'PGL') byKind[ev.kind].push(ev);
    });

    var out = [];
    out = out.concat(_clusterMdsPglEventsOfKind_(byKind.MDS, threshold, deploymentRow, 'MDS'));
    out = out.concat(_clusterMdsPglEventsOfKind_(byKind.PGL, threshold, deploymentRow, 'PGL'));
    return out;
  }

  /**
   * Builds the go-live events for one Active deployment.
   * Returns one MDS event per distinct target date + one PGL event per distinct
   * actual date (falling back to MTP when no actuals exist).
   *
   * @param {Object} deploymentRow  Raw row from readSfdcDeploymentsRaw_.
   * @param {Array}  productRows    Array from readSfdcProductFunctionsRaw_ for this dep (may be undefined/empty).
   * @param {number=} clusterDays   mgmPglTab.goLiveEventClusterDays (0 = exact dates only).
   * @return {Array<{ kind:'MDS'|'PGL', eventDate:string, oneThirdPoint:string|null, products:string[] }>}
   * @private
   */
  function _buildGoLiveEvents_(deploymentRow, productRows, clusterDays) {
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

    events = _dedupeEvents_(events);
    return _clusterMdsPglGoLiveEvents_(events, clusterDays, deploymentRow);
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
      var canonDep = _canonicalId_(depId);
      var depStart = r.deploymentStartDate || '';
      var depEnd   = r.mtpDate             || '';
      var products = productRowsByDep[canonDep] || productRowsByDep[depId] || [];

      function pushException_(missingType, hasProducts) {
        if (exceptionSeen[canonDep]) return;
        exceptionSeen[canonDep] = true;
        exceptionRows.push({
          deploymentId:        canonDep || depId,
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
   * Richness score for choosing one Active deployment row per canonical Salesforce Id.
   * @param {Object} r
   * @return {number}
   * @private
   */
  function _mdsPglActiveRowRichnessScore_(r) {
    if (!r) return 0;
    var score = 0;
    if (r.deploymentName) score += 4;
    if (r.accountName) score += 4;
    if (r.mtpDate) score += 3;
    if (r.deploymentStartDate) score += 2;
    if (r.partner) score += 2;
    if (r.overallStatus) score += 1;
    if (r.phase) score += 1;
    if (r.stage) score += 1;
    if (r.health) score += 1;
    if (String(r.deploymentId || '').length >= 18) score += 2;
    return score;
  }

  /**
   * Collapses Active deployment rows to one row per canonical deployment Id.
   * @param {Array<Object>} rows
   * @return {{ rows: Array<Object>, sourceActiveCount: number, canonicalActiveCount: number, duplicateCanonicalIds: Array<Object> }}
   * @private
   */
  function _collapseMdsPglActiveRowsByCanonicalId_(rows) {
    var sourceActiveCount = Array.isArray(rows) ? rows.length : 0;
    if (!sourceActiveCount) {
      return {
        rows: [],
        sourceActiveCount: 0,
        canonicalActiveCount: 0,
        duplicateCanonicalIds: []
      };
    }

    var canonCounts = {};
    var byCanon = {};
    var order = [];

    rows.forEach(function (r) {
      var canon = _canonicalId_(r.deploymentId);
      if (!canon) return;
      canonCounts[canon] = (canonCounts[canon] || 0) + 1;
      if (!byCanon[canon]) {
        byCanon[canon] = r;
        order.push(canon);
        return;
      }
      var prevScore = _mdsPglActiveRowRichnessScore_(byCanon[canon]);
      var nextScore = _mdsPglActiveRowRichnessScore_(r);
      if (nextScore > prevScore) {
        byCanon[canon] = r;
      }
    });

    var duplicateCanonicalIds = [];
    Object.keys(canonCounts).forEach(function (canon) {
      if (canonCounts[canon] > 1) {
        duplicateCanonicalIds.push({
          canonicalDeploymentId: canon,
          sourceRowCount: canonCounts[canon]
        });
      }
    });

    var collapsed = order.map(function (canon) {
      var row = byCanon[canon];
      if (_canonicalId_(row.deploymentId) !== canon) {
        return Object.assign({}, row, { deploymentId: canon });
      }
      if (row.deploymentId !== canon && String(row.deploymentId || '').length < 18) {
        return Object.assign({}, row, { deploymentId: canon });
      }
      return row;
    });

    return {
      rows: collapsed,
      sourceActiveCount: sourceActiveCount,
      canonicalActiveCount: collapsed.length,
      duplicateCanonicalIds: duplicateCanonicalIds
    };
  }

  /**
   * Merges product-function arrays under canonical deployment FK keys.
   * @param {Object} productRowsByDep
   * @return {Object}
   * @private
   */
  function _canonicalizeProductRowsByDep_(productRowsByDep) {
    var out = {};
    if (!productRowsByDep) return out;
    Object.keys(productRowsByDep).forEach(function (fk) {
      var canon = _canonicalId_(fk);
      if (!canon) return;
      if (!out[canon]) out[canon] = [];
      var chunk = productRowsByDep[fk] || [];
      for (var i = 0; i < chunk.length; i++) {
        out[canon].push(chunk[i]);
      }
    });
    return out;
  }

  /**
   * Merges deployment contact buckets under canonical deployment Id keys.
   * @param {Object} contactsMap
   * @return {Object}
   * @private
   */
  function _canonicalizeContactsMapForMdsPgl_(contactsMap) {
    var out = {};
    if (!contactsMap) return out;
    Object.keys(contactsMap).forEach(function (depId) {
      var canon = _canonicalId_(depId);
      if (!canon) return;
      if (!out[canon]) {
        out[canon] = contactsMap[depId];
        return;
      }
      out[canon] = _mergeMdsPglContactsObjects_(out[canon], contactsMap[depId]);
    });
    return out;
  }

  /**
   * Merges DD assignment lists under canonical deployment Id keys (15/18-char safe).
   * @param {Object} ddMap
   * @return {Object<string, Array<{email:string,name:string}>>}
   * @private
   */
  function _canonicalizeDdAssignmentsMap_(ddMap) {
    var out = {};
    if (!ddMap) return out;
    Object.keys(ddMap).forEach(function (depId) {
      var canon = _canonicalId_(depId);
      if (!canon) return;
      var chunk = ddMap[depId] || [];
      if (!out[canon]) {
        out[canon] = chunk.slice();
        return;
      }
      out[canon] = out[canon].concat(chunk);
    });
    return out;
  }

  /**
   * @param {Object|null} a
   * @param {Object|null} b
   * @return {Object|null}
   * @private
   */
  function _mergeMdsPglContactsObjects_(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;

    function mergeList_(la, lb) {
      var seen = {};
      var out = [];
      (la || []).concat(lb || []).forEach(function (c) {
        if (!c) return;
        var k = String(c.email || '').toLowerCase() + '|' + String(c.name || '').toLowerCase();
        if (seen[k]) return;
        seen[k] = true;
        out.push(c);
      });
      return out;
    }

    var wd = a.wdSponsor;
    if (b.wdSponsor) {
      if (!wd || (!wd.email && b.wdSponsor.email)) wd = b.wdSponsor;
    }

    return {
      projectManagers:    mergeList_(a.projectManagers, b.projectManagers),
      execSponsors:       mergeList_(a.execSponsors, b.execSponsors),
      wdSponsor:          wd,
      engagementManagers: mergeList_(a.engagementManagers, b.engagementManagers)
    };
  }

  /**
   * Emit-time dedupe key for one MDS/PGL survey row (includes batch month).
   * @param {Object} row
   * @return {string}
   * @private
   */
  function _mdsPglSurveyRowEmitKey_(row) {
    var canonDep = _canonicalId_(row.deploymentId);
    var surveyType = String(row.surveyType || '');
    var eventKey = _toDateKey_(row.eventDate) || String(row.eventDate || '').trim();
    var batchYm = String(row._batchYearMonth || '');
    return canonDep + '|' + surveyType + '|' + eventKey + '|' + batchYm;
  }

  /**
   * @param {Array<string>} a
   * @param {Array<string>} b
   * @return {Array<string>}
   * @private
   */
  function _mergeMdsPglProductLabels_(a, b) {
    var seen = {};
    var out = [];
    (a || []).concat(b || []).forEach(function (p) {
      var label = String(p || '').trim();
      if (!label || seen[label]) return;
      seen[label] = true;
      out.push(label);
    });
    return out.sort();
  }

  /**
   * Merges duplicate MDS/PGL survey rows sharing the same emit key.
   * @param {Object} base
   * @param {Object} extra
   * @return {Object}
   * @private
   */
  function _mergeMdsPglSurveyRow_(base, extra) {
    base.products = _mergeMdsPglProductLabels_(base.products, extra.products);
    base.isMultipleGoLives = !!(base.isMultipleGoLives || extra.isMultipleGoLives);
    base.sourceEventDates = _mergeMdsPglSourceEventDateKeys_(
      base.sourceEventDates, extra.sourceEventDates);
    base.clusteredEventDates = _mergeMdsPglSourceEventDateKeys_(
      base.clusteredEventDates, extra.clusteredEventDates);
    if (!base.sourceEventDates || !base.sourceEventDates.length) {
      base.sourceEventDates = _mergeMdsPglSourceEventDateKeys_(
        [], [_toDateKey_(base.eventDate) || base.eventDate]);
    }
    base.clusteredEventDates = base.sourceEventDates.slice();
    base.clusteredFromMultipleEventDates = (base.sourceEventDates || []).length > 1;
    if (base.clusteredFromMultipleEventDates) base.isMultipleGoLives = true;
    if (!base.contacts && extra.contacts) base.contacts = extra.contacts;
    else if (base.contacts && extra.contacts) {
      base.contacts = _mergeMdsPglContactsObjects_(base.contacts, extra.contacts);
    }
    var fields = [
      'accountName', 'deploymentName', 'deliveryDirector', 'partner',
      'eventDate', 'oneThirdPoint', 'startDate', 'currentMtp'
    ];
    fields.forEach(function (field) {
      if ((!base[field] || base[field] === '\u2014') && extra[field]) {
        base[field] = extra[field];
      }
    });
    base.isExecutiveWatch = !!(base.isExecutiveWatch || extra.isExecutiveWatch);
    return base;
  }

  /**
   * Dedupes emitted MDS/PGL rows by canonical deployment + survey type + event date + batch month.
   * @param {Array<Object>} rows
   * @return {{ rows: Array<Object>, beforeCount: number, afterCount: number, duplicateRowKeys: Array<string> }}
   * @private
   */
  function _dedupeMdsPglSurveyRows_(rows) {
    var beforeCount = Array.isArray(rows) ? rows.length : 0;
    if (!beforeCount) {
      return { rows: [], beforeCount: 0, afterCount: 0, duplicateRowKeys: [] };
    }

    var seen = {};
    var order = [];
    var duplicateRowKeys = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var key = _mdsPglSurveyRowEmitKey_(row);
      if (seen[key]) {
        seen[key] = _mergeMdsPglSurveyRow_(seen[key], row);
        if (duplicateRowKeys.indexOf(key) === -1) duplicateRowKeys.push(key);
      } else {
        seen[key] = row;
        order.push(key);
      }
    }

    var deduped = order.map(function (k) { return seen[k]; });
    return {
      rows: deduped,
      beforeCount: beforeCount,
      afterCount: deduped.length,
      duplicateRowKeys: duplicateRowKeys
    };
  }

  /**
   * Loads Active deployment rows for MDS/PGL (standard + product-mode paths).
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function _resolveMdsPglActiveRows_(cfg) {
    var activeRows = [];
    try {
      if (usesProductModeParentAndPfUnion_(cfg)) {
        activeRows = getActiveCountDeployments(cfg) || [];
        activeRows = filterDeploymentsByStudent_(activeRows, 'exclude', cfg);
      } else if (usesProductModePfDataSource_(cfg)) {
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
      Logger.log('CoreData._resolveMdsPglActiveRows_: failed: ' + e);
    }
    return activeRows;
  }

  /**
   * Display name for Deployment Sponsor contacts (D1 / DD digest grouping).
   * @param {Object|null} contactsEntry  getDeploymentContactsMap_ bucket
   * @param {Array<{email:string,name:string}>|null} ddList  getDdAssignmentsFromContacts_ list
   * @return {string}
   * @private
   */
  function _deploymentSponsorDisplayName_(contactsEntry, ddList) {
    var list = (ddList && ddList.length) ? ddList : null;
    if (!list && contactsEntry && contactsEntry.wdSponsor) {
      var ws = contactsEntry.wdSponsor;
      var solo = String(ws.name || '').trim() || String(ws.email || '').trim();
      return solo;
    }
    if (!list || !list.length) return '';
    if (list.length === 1) {
      return String(list[0].name || list[0].email || '').trim();
    }
    return list.map(function (c) { return c.name || c.email; }).filter(Boolean).join(', ');
  }

  /**
   * Resolves Delivery Director label for MDS/PGL rows (matches UI precedence where possible).
   * Precedence: DeploymentsMeta > row.deliveryDirector > ddFromContacts > Deployment Sponsor
   * contacts > SFDC DAM (damFullName).
   *
   * @param {Object} r  Active deployment row
   * @param {Object} metaEntry  DeploymentsMeta entry for canonical deployment Id
   * @param {Object|null} contactsEntry
   * @param {Array<{email:string,name:string}>|null} ddList
   * @return {{name: string, source: string}}
   * @private
   */
  function _resolveMdsPglDeliveryDirector_(r, metaEntry, contactsEntry, ddList) {
    var fromMeta = metaEntry && String(metaEntry.deliveryDirector || '').trim();
    if (fromMeta) return { name: fromMeta, source: 'meta' };

    var fromRow = String(r.deliveryDirector || '').trim();
    if (fromRow) return { name: fromRow, source: 'rowDeliveryDirector' };

    if (r.ddFromContacts && String(r.ddFromContacts).trim()) {
      return { name: String(r.ddFromContacts).trim(), source: 'ddFromContacts' };
    }

    var sponsor = _deploymentSponsorDisplayName_(contactsEntry, ddList);
    if (sponsor) return { name: sponsor, source: 'deploymentSponsor' };

    var dam = String(r.damFullName || '').trim();
    if (dam) return { name: dam, source: 'damFullName' };

    return { name: '', source: 'none' };
  }

  /**
   * Builds flat MDS/PGL survey rows for collapsed Active deployments.
   * @param {AppConfig} cfg
   * @param {Array<Object>} activeRows
   * @param {Object} productRowsByDep
   * @param {Object} contactsMap
   * @param {Array<Object>} scheduleByMonth
   * @param {Object} metaMap
   * @param {Object} ddMap
   * @return {Array<Object>}
   * @private
   */
  function _buildMdsPglSurveyRowsFromActive_(cfg, activeRows, productRowsByDep, contactsMap, scheduleByMonth, metaMap, ddMap) {
    var clusterDays = CoreConfig.getMgmPglGoLiveEventClusterDays(cfg);
    var allRows = [];
    activeRows.forEach(function (r) {
      var canonDep = _canonicalId_(r.deploymentId);
      if (!canonDep) return;
      var prRows = productRowsByDep[canonDep] || [];
      var events = _buildGoLiveEvents_(r, prRows, clusterDays);

      var mdsCount = 0;
      var pglCount = 0;
      for (var ei = 0; ei < events.length; ei++) {
        if (events[ei].kind === 'MDS') mdsCount++;
        else pglCount++;
      }
      var deploymentMultipleGoLives = (mdsCount > 1) || (pglCount > 1);

      for (var evi = 0; evi < events.length; evi++) {
        var ev = events[evi];
        var targetDate = (ev.kind === 'MDS') ? ev.oneThirdPoint : ev.eventDate;
        if (!targetDate) continue;

        var scheduleEntry = null;
        for (var si = 0; si < scheduleByMonth.length; si++) {
          var s = scheduleByMonth[si];
          var win = (ev.kind === 'MDS') ? s.mdsOneThirdWindow : s.pglFirstMtpWindow;
          if (targetDate >= win.start && targetDate <= win.end) {
            scheduleEntry = s;
            break;
          }
        }
        if (!scheduleEntry) continue;

        var sourceDates = ev.sourceEventDates ||
          _mergeMdsPglSourceEventDateKeys_([], [_toDateKey_(ev.eventDate) || ev.eventDate]);
        var rowMultipleGoLives = deploymentMultipleGoLives ||
          !!ev.clusteredFromMultipleEventDates ||
          sourceDates.length > 1 ||
          ((ev.products || []).length > 1);

        var metaEntry = (metaMap && metaMap[canonDep]) || {};
        var contactsEntry = contactsMap[canonDep] || null;
        var ddList = (ddMap && (ddMap[canonDep] || ddMap[r.deploymentId])) || [];
        var ddResolved = _resolveMdsPglDeliveryDirector_(r, metaEntry, contactsEntry, ddList);

        allRows.push({
          deploymentId:      canonDep,
          accountName:       r.accountName,
          deploymentName:    r.deploymentName,
          deliveryDirector:  ddResolved.name,
          partner:           r.partner || '',
          isExecutiveWatch:  CoreConfig.isExecutiveWatchEnabled(cfg) && !!r.isExecutiveWatch,
          surveyType:        ev.kind,
          eventDate:         _coerceUiDateField_(ev.eventDate),
          sourceEventDates:  sourceDates,
          clusteredEventDates: ev.clusteredEventDates || sourceDates,
          clusteredFromMultipleEventDates: !!ev.clusteredFromMultipleEventDates,
          products:          ev.products,
          isMultipleGoLives: rowMultipleGoLives,
          oneThirdPoint:     _coerceUiDateField_(ev.oneThirdPoint, null),
          startDate:         _coerceUiDateField_(r.deploymentStartDate, null),
          currentMtp:        _coerceUiDateField_(r.mtpDate, null),
          contacts:          contactsMap[canonDep] || null,
          _batchYearMonth:   scheduleEntry.yearMonth
        });
      }
    });
    return allRows;
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
    var activeRows = _resolveMdsPglActiveRows_(cfg);
    var collapsedActive = _collapseMdsPglActiveRowsByCanonicalId_(activeRows);
    activeRows = collapsedActive.rows;
    if (collapsedActive.duplicateCanonicalIds.length > 0) {
      Logger.log('CoreData.getMdsPglBatchView: collapsed ' +
                 collapsedActive.sourceActiveCount + ' Active rows to ' +
                 collapsedActive.canonicalActiveCount + ' canonical deployments (' +
                 collapsedActive.duplicateCanonicalIds.length + ' duplicate id groups).');
    }

    // Product-function rows grouped by canonical deploymentFk.
    var productRowsByDep = {};
    try {
      var pfRows = readSfdcProductFunctionsRaw_(cfg);
      var rawProductRowsByDep = {};
      pfRows.forEach(function (pf) {
        if (!pf.deploymentFk) return;
        if (!rawProductRowsByDep[pf.deploymentFk]) rawProductRowsByDep[pf.deploymentFk] = [];
        rawProductRowsByDep[pf.deploymentFk].push(pf);
      });
      productRowsByDep = _canonicalizeProductRowsByDep_(rawProductRowsByDep);
    } catch (e) {
      Logger.log('CoreData.getMdsPglBatchView: readSfdcProductFunctionsRaw_ failed: ' + e);
    }

    // Contacts map (canonical deployment Id keys).
    var contactsMap = {};
    try {
      contactsMap = _canonicalizeContactsMapForMdsPgl_(getDeploymentContactsMap_(cfg));
    } catch (e) {
      Logger.log('CoreData.getMdsPglBatchView: getDeploymentContactsMap_ failed: ' + e);
    }

    var metaMap = getDeploymentsMetaMap_(cfg) || {};
    var ddMap = {};
    try {
      ddMap = _canonicalizeDdAssignmentsMap_(getDdAssignmentsFromContacts_(cfg) || {});
    } catch (e) {
      Logger.log('CoreData.getMdsPglBatchView: getDdAssignmentsFromContacts_ failed: ' + e);
    }

    // Exceptions list (verbatim logic from prior getUpcomingSurveys).
    var exceptions = _buildMgmPglExceptions_(cfg, activeRows, productRowsByDep);

    // Build all rows, then emit-time dedupe.
    var builtRows = _buildMdsPglSurveyRowsFromActive_(
      cfg, activeRows, productRowsByDep, contactsMap, scheduleByMonth, metaMap, ddMap);
    var dedupeResult = _dedupeMdsPglSurveyRows_(builtRows);
    var allRows = dedupeResult.rows;
    if (dedupeResult.beforeCount !== dedupeResult.afterCount) {
      Logger.log('CoreData.getMdsPglBatchView: emit dedupe ' +
                 dedupeResult.beforeCount + ' -> ' + dedupeResult.afterCount + ' rows (' +
                 dedupeResult.duplicateRowKeys.length + ' duplicate keys).');
    }

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
    _perfCacheWrite_(t2Key, payload, cfg.appId);

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
    var cfgD = CoreConfig.withDefaults(cfg);
    var sourceActive = _resolveMdsPglActiveRows_(cfgD);
    var collapsed = _collapseMdsPglActiveRowsByCanonicalId_(sourceActive);
    Logger.log('Active rows: source=' + collapsed.sourceActiveCount +
               ', canonical=' + collapsed.canonicalActiveCount +
               ', duplicateIdGroups=' + collapsed.duplicateCanonicalIds.length);

    var payload = getMdsPglBatchView(cfgD, null, 3);
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
   * Diagnostic for duplicate MDS/PGL rows — token matches account or deployment name.
   *
   * @param {AppConfig} config
   * @param {string=} token  e.g. "Tenet Business Services Corporation"
   * @param {number=} windowMonths  3 or 6
   * @return {Object}
   */
  function debugMdsPglRowsForUI(config, token, windowMonths) {
    var cfg = CoreConfig.withDefaults(config);
    var horizonMonths = (windowMonths === 6) ? 6 : 3;
    var goLiveEventClusterDays = CoreConfig.getMgmPglGoLiveEventClusterDays(cfg);
    var needle = String(token || '').trim().toLowerCase();

    var tz = Session.getScriptTimeZone();
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var monthKeys = [];
    for (var mi = 0; mi < horizonMonths; mi++) {
      var md = new Date(now.getFullYear(), now.getMonth() + mi, 1);
      monthKeys.push(Utilities.formatDate(md, tz, 'yyyy-MM'));
    }
    var scheduleByMonth = monthKeys.map(function (ym) {
      return CoreSurveySchedule.resolve(ym);
    });

    var sourceActive = _resolveMdsPglActiveRows_(cfg);
    var collapsed = _collapseMdsPglActiveRowsByCanonicalId_(sourceActive);
    var activeRows = collapsed.rows;

    var productRowsByDep = {};
    try {
      var pfRows = readSfdcProductFunctionsRaw_(cfg);
      var rawProductRowsByDep = {};
      pfRows.forEach(function (pf) {
        if (!pf.deploymentFk) return;
        if (!rawProductRowsByDep[pf.deploymentFk]) rawProductRowsByDep[pf.deploymentFk] = [];
        rawProductRowsByDep[pf.deploymentFk].push(pf);
      });
      productRowsByDep = _canonicalizeProductRowsByDep_(rawProductRowsByDep);
    } catch (e) {
      Logger.log('CoreData.debugMdsPglRowsForUI: pf read failed: ' + e);
    }

    var contactsMap = {};
    try {
      contactsMap = _canonicalizeContactsMapForMdsPgl_(getDeploymentContactsMap_(cfg));
    } catch (e) {
      Logger.log('CoreData.debugMdsPglRowsForUI: contacts read failed: ' + e);
    }

    var beforeRows = _buildMdsPglSurveyRowsFromActive_(
      cfg, activeRows, productRowsByDep, contactsMap, scheduleByMonth);
    var dedupeResult = _dedupeMdsPglSurveyRows_(beforeRows);

    function rowMatches_(row) {
      if (!needle) return true;
      var hay = ((row.accountName || '') + ' ' + (row.deploymentName || '')).toLowerCase();
      return hay.indexOf(needle) !== -1;
    }

    function summarizeRow_(row, index) {
      var contacts = row.contacts;
      var contactCount = 0;
      if (contacts) {
        contactCount = (contacts.projectManagers || []).length +
          (contacts.execSponsors || []).length +
          (contacts.engagementManagers || []).length +
          (contacts.wdSponsor ? 1 : 0);
      }
      return {
        rowIndex: index,
        surveyType: row.surveyType,
        canonicalDeploymentId: _canonicalId_(row.deploymentId),
        deploymentId: row.deploymentId,
        accountName: row.accountName,
        deploymentName: row.deploymentName,
        eventDate: row.eventDate,
        eventDateKey: _toDateKey_(row.eventDate),
        sourceEventDates: row.sourceEventDates || [],
        clusteredEventDates: row.clusteredEventDates || row.sourceEventDates || [],
        clusteredFromMultipleEventDates: !!row.clusteredFromMultipleEventDates,
        currentMtp: row.currentMtp,
        batchYearMonth: row._batchYearMonth,
        dedupeKey: _mdsPglSurveyRowEmitKey_(row),
        productCount: (row.products || []).length,
        contactCount: contactCount,
        isMultipleGoLives: !!row.isMultipleGoLives
      };
    }

    var matchingBefore = [];
    for (var bi = 0; bi < beforeRows.length; bi++) {
      if (rowMatches_(beforeRows[bi])) matchingBefore.push(summarizeRow_(beforeRows[bi], bi));
    }
    var matchingAfter = [];
    for (var ai = 0; ai < dedupeResult.rows.length; ai++) {
      if (rowMatches_(dedupeResult.rows[ai])) {
        matchingAfter.push(summarizeRow_(dedupeResult.rows[ai], ai));
      }
    }

    var keyCounts = {};
    matchingAfter.forEach(function (m) {
      keyCounts[m.dedupeKey] = (keyCounts[m.dedupeKey] || 0) + 1;
    });
    var duplicateFinalRowKeys = Object.keys(keyCounts).filter(function (k) {
      return keyCounts[k] > 1;
    });

    Logger.log('CoreData.debugMdsPglRowsForUI: token="' + (token || '') + '" before=' +
               dedupeResult.beforeCount + ' after=' + dedupeResult.afterCount);

    return {
      token: token || '',
      horizonMonths: horizonMonths,
      goLiveEventClusterDays: goLiveEventClusterDays,
      sourceActiveCount: collapsed.sourceActiveCount,
      canonicalActiveCount: collapsed.canonicalActiveCount,
      duplicateActiveDeploymentIds: collapsed.duplicateCanonicalIds,
      finalAllRowsBeforeDedupe: dedupeResult.beforeCount,
      finalAllRowsAfterDedupe: dedupeResult.afterCount,
      duplicateFinalRowKeys: dedupeResult.duplicateRowKeys,
      duplicateMatchingFinalRowKeys: duplicateFinalRowKeys,
      matchingRowsBeforeDedupe: matchingBefore,
      matchingRowsAfterDedupe: matchingAfter
    };
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
  var _CSAT_INFLIGHT_COLUMNS_ = CoreCsatIngest.CSAT_INFLIGHT_COLUMNS;

  /**
   * Sheet cell → YYYY-MM-DD without UTC-shifting date-only strings.
   * @param {*} raw
   * @param {string} tz
   * @return {string}
   * @private
   */
  function _sheetCellToDateKey_(raw, tz) {
    if (!raw) return '';
    var key = CoreUtils.toCalendarDateKey(raw, tz);
    return key || '';
  }

  /**
   * Sanitizes ISO or locale date strings into YYYY-MM-DD.
   * Date-only YYYY-MM-DD (and ISO prefixes) preserve the calendar date exactly.
   * @param {*} dVal
   * @return {string}
   * @private
   */
  function formatShortDate_(dVal) {
    if (!dVal || dVal === '\u2014' || dVal === 'null' || dVal === 'undefined') return '\u2014';
    var key = CoreUtils.toCalendarDateKey(dVal, Session.getScriptTimeZone());
    if (key) return key;
    var str = String(dVal).trim();
    return str || '\u2014';
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
    var ss = getSpreadsheet_();
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
    var ss = getSpreadsheet_();
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
   * Replaces CSAT_InFlight without clear-then-write gap; restores prior data on failure.
   * @param {AppConfig} cfg
   * @param {Array<Object>} storageRows
   * @return {{ written: number, verification: Object }}
   * @private
   */
  function _replaceCsatInFlightSafely_(cfg, storageRows) {
    var sheet = _getOrCreateCsatInFlightSheet_(cfg);
    var cols = _CSAT_INFLIGHT_COLUMNS_;
    var matrix = CoreCsatIngest.buildInFlightValueMatrix(storageRows || []);
    var priorLastRow = sheet.getLastRow();
    var priorData = null;
    if (priorLastRow >= 2) {
      priorData = sheet.getRange(2, 1, priorLastRow, cols.length).getValues();
    }

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) {
      throw new Error('CoreData._replaceCsatInFlightSafely_: could not acquire document lock');
    }
    try {
      var fullMatrix = [cols].concat(matrix);
      sheet.getRange(1, 1, fullMatrix.length, cols.length).setValues(fullMatrix);
      var plan = CoreCsatIngest.planTrailingClear(priorLastRow, matrix.length);
      if (plan.clearFromRow != null && plan.clearThroughRow >= plan.clearFromRow) {
        sheet.getRange(plan.clearFromRow, 1, plan.clearThroughRow, cols.length).clearContent();
      }
      var hdr = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
      var verify = CoreCsatIngest.verifyInFlightHeaders(hdr, matrix.length);
      var lastRow = sheet.getLastRow();
      if (matrix.length > 0 && lastRow < 1 + matrix.length) {
        verify = { ok: false, errors: (verify.errors || []).concat(['row count']) };
      }
      if (!verify.ok) {
        throw new Error('CSAT_InFlight verification failed: ' + (verify.errors || []).join(', '));
      }
      return {
        written: matrix.length,
        verification: { ok: true, headerOk: true, rowCount: matrix.length }
      };
    } catch (writeErr) {
      Logger.log('CoreData._replaceCsatInFlightSafely_: restore after failure: ' + writeErr);
      try {
        sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
        if (priorData && priorData.length) {
          sheet.getRange(2, 1, 1 + priorData.length, cols.length).setValues(priorData);
        } else if (priorLastRow > 1) {
          sheet.getRange(2, 1, priorLastRow, cols.length).clearContent();
        }
      } catch (restoreErr) {
        Logger.log('CoreData._replaceCsatInFlightSafely_: restore failed: ' + restoreErr);
      }
      throw writeErr;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * @param {AppConfig} cfg
   * @param {string} csvText
   * @param {Object=} metadata
   * @private
   */
  function _backupCsatImport_(cfg, csvText, metadata) {
    metadata = metadata || {};
    var tz = Session.getScriptTimeZone();
    var ts = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmmss');
    var appId = cfg.appId || 'DHM';
    var jobSuffix = metadata.jobId ? String(metadata.jobId).slice(0, 24) : ts;
    var fileName = 'CSAT_Import_' + appId + '_' + ts + '_' + jobSuffix + '.csv';
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
    if (cfg.appId === 'HC' || cfg.appId === 'HC_DM') {
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
   * @param {AppConfig} cfg
   * @param {Array<Object>} parsedRows survey_normalized-shaped rows
   * @return {Object}
   * @private
   */
  function _buildCsatStorageFromParsed_(cfg, parsedRows) {
    var allowedIds = _csatAllowedDeploymentIds_(cfg);
    var deps = {
      canonicalId: _canonicalId_,
      normalizeTrackingStatus: _normalizeCsatTrackingStatus_,
      formatShortDate: formatShortDate_
    };
    return CoreCsatIngest.buildStorageRowsFromParsed(parsedRows, allowedIds, deps);
  }

  /**
   * Canonical CSAT in-flight ingest (normalized Qualtrics rows or pre-parsed CSV rows).
   *
   * @param {AppConfig} config
   * @param {Array<Object>} rows normalized Qualtrics rows (default) or parsed CSV rows when metadata.rowFormat='parsed_csv'
   * @param {Object=} metadata { source, jobId, backupCsvText, skipBackup, rowFormat }
   * @param {Object=} context { spreadsheetId }
   * @return {Object}
   */
  function ingestCsatInFlight(config, rows, metadata, context) {
    metadata = metadata || {};
    context = context || {};
    var cfg = CoreConfig.withDefaults(config);
    var parsedRows = metadata.rowFormat === 'parsed_csv'
      ? (rows || [])
      : CoreCsatIngest.mapNormalizedQualtricsRowsToParsed(rows || []);

    var built = _buildCsatStorageFromParsed_(cfg, parsedRows);
    if (!built.storageRows.length && built.totalInput > 0) {
      Logger.log('CoreData.ingestCsatInFlight: zero eligible rows for appId=' + cfg.appId);
    }

    var runIngest = function () {
      if (metadata.backupCsvText && !metadata.skipBackup) {
        try {
          _backupCsatImport_(cfg, metadata.backupCsvText, metadata);
        } catch (e) {
          Logger.log('CoreData.ingestCsatInFlight: backup failed: ' + e);
        }
      }
      var replaceResult = _replaceCsatInFlightSafely_(cfg, built.storageRows);
      _setCsatLastImportAt_(cfg);
      _clearCache(cfg);
      return replaceResult;
    };

    var replaceResult;
    try {
      replaceResult = _runWithOptionalSpreadsheetId_(context.spreadsheetId, runIngest);
    } catch (e) {
      Logger.log('CoreData.ingestCsatInFlight: failed appId=' + cfg.appId + ': ' + e);
      return {
        success: false,
        imported: 0,
        discarded: built.discarded,
        totalInput: built.totalInput,
        eligibleCount: built.matched,
        writtenCount: 0,
        excludedCount: built.discarded,
        verification: { ok: false, error: String(e) },
        message: 'CSAT ingest failed: ' + e
      };
    }

    Logger.log('CoreData.ingestCsatInFlight [' + cfg.appId + ']: input=' + built.totalInput +
               ', written=' + replaceResult.written);
    return {
      success: true,
      imported: built.matched,
      discarded: built.discarded,
      totalInput: built.totalInput,
      eligibleCount: built.matched,
      writtenCount: replaceResult.written,
      excludedCount: built.discarded,
      count: built.matched,
      verification: replaceResult.verification,
      message: 'Ingested ' + built.matched + ' of ' + built.totalInput + ' survey rows.'
    };
  }

  /**
   * V2.8: Parses and ingests a survey_normalized CSV export (manual UI path).
   *
   * @param {AppConfig} config
   * @param {string} csvText
   * @return {{success:boolean, imported:number, discarded:number, totalInput:number, count:number, message:string}}
   */
  function uploadCsatInFlightCsvForUI(config, csvText) {
    var cfg = CoreConfig.withDefaults(config);
    var parsedRows = _parseCsatInFlightCsv_(csvText);
    try {
      _backupCsatImport_(cfg, csvText, { source: 'ui' });
    } catch (e) {
      Logger.log('CSAT backup failed: ' + e);
    }
    return ingestCsatInFlight(cfg, parsedRows, {
      source: 'ui',
      rowFormat: 'parsed_csv',
      skipBackup: true
    }, {});
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
      .replace(/&/g, ' and ')
      .replace(/-/g, ' ')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Maps a deployment stage to its lifecycle bucket.
   * Unmatched, blank, or unexpected values fold into Building (no Other bucket).
   * @param {string} stage
   * @return {'starting'|'building'|'landing'}
   * @private
   */
  function _bucketForStage_(stage) {
    var s = _normalizeStage_(stage);
    if (!s) return 'building';
    if (s === 'on boarding' || s === 'onboarding' || s === 'plan') return 'starting';
    if (s === 'architect and configure' || s === 'configure and prototype' || s === 'test') {
      return 'building';
    }
    if (s === 'deploy' || s === 'post prod' || s === 'post production') return 'landing';
    return 'building';
  }

  /** Canonical stage labels shown under each lifecycle bucket in Overview. */
  var _LIFECYCLE_CANONICAL_STAGES_ = {
    starting: ['On-Boarding', 'Plan'],
    building: ['Architect & Configure', 'Configure and Prototype', 'Test'],
    landing: ['Deploy', 'Post Prod']
  };

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
   * Deployments tab KPI row source (same payload as getAllDeploymentsForUI, before client filters).
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Array<Object>}
   * @private
   */
  function _resolveDeploymentsTabKpiRows_(cfg, viewModeOpts, productOpts) {
    var payload = getAllDeploymentsForUI(cfg, viewModeOpts, productOpts);
    if (Array.isArray(payload)) return payload;
    if (payload && payload.useCountGrainForKpis && payload.countRows && payload.countRows.length) {
      return payload.countRows;
    }
    return (payload && payload.rows) ? payload.rows : [];
  }

  /**
   * Mirrors Deployments tab default health chips (client deploymentRowMatchesFilters_).
   * @param {Array<Object>} rows
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function _applyDeploymentsTableDefaultHealthFilter_(rows, cfg) {
    if (!Array.isArray(rows)) return [];
    var healthList = cfg.ui && cfg.ui.deploymentsTable && cfg.ui.deploymentsTable.defaultHealthFilter;
    if (!Array.isArray(healthList) || healthList.length === 0) return rows;
    return rows.filter(function (r) {
      return healthList.indexOf(r.health) >= 0;
    });
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

    // KPI totals: full active portfolio (override-aware, Student-integrated via getAllDeployments pipeline).
    // Do not apply Deployments tab defaultHealthFilter — Overview "Total Active" is all Red+Yellow+Green.
    var activeRows = _resolveDeploymentsTabKpiRows_(cfg, viewModeOpts, productOpts);
    var overrideFootnote = buildOverrideImpactContext_(activeRows).footnote;

    // TOTALS
    var totalActive    = activeRows.length;
    var redCount       = activeRows.filter(function(r) { return r.health === 'Red'; }).length;
    var yellowCount    = activeRows.filter(function(r) { return r.health === 'Yellow'; }).length;
    var greenCount     = activeRows.filter(function(r) { return r.health === 'Green'; }).length;
    var ewEnabled      = CoreConfig.isExecutiveWatchEnabled(cfg);
    var ewCount        = ewEnabled
      ? activeRows.filter(function(r) { return r.isExecutiveWatch; }).length
      : 0;

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

    // LIFECYCLE BUCKETS — Deployment Stage mapped to Starting / Building / Landing.
    var buckets = {
      starting: { count: 0 },
      building: { count: 0 },
      landing:  { count: 0 }
    };
    activeRows.forEach(function(r) {
      var key = _bucketForStage_(r.stage);
      buckets[key].count++;
    });
    var lifecycleBuckets = {};
    ['starting', 'building', 'landing'].forEach(function(key) {
      var b = buckets[key];
      lifecycleBuckets[key] = {
        count:   b.count,
        percent: totalActive > 0 ? Math.round(b.count / totalActive * 100) : 0,
        stages:  _LIFECYCLE_CANONICAL_STAGES_[key] || []
      };
    });

    return {
      executiveWatchEnabled: ewEnabled,
      totals: {
        totalActive:    totalActive,
        red:            redCount,
        yellow:         yellowCount,
        green:          greenCount,
        executiveWatch: ewCount
      },
      overrideFootnote: overrideFootnote,
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
    var overviewCacheBase = 'overviewData:v16:overrideImpactContextParity:lifecycleDeploymentStage:overrideAware';
    var cacheKey = _perfKey_(cfg, overviewCacheBase);

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
      _perfCacheWrite_(cacheKey, payload, cfg.appId);
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
      var deploymentOverrides = getDeploymentOverridesMap_(cfg);
      var rawDetails = _collectProductModeGoLivePfDetails_(
        pfRows, cfg, 'target', todayKey, highRiskEndKey, goLivesOverrides, deploymentOverrides);
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
   * Compares Overview KPI totals (full active) vs Deployments tab default-filtered KPIs.
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  function debugOverviewVsDeploymentsCountsForUI(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var vm = viewModeOpts || { viewMode: 'all', ddDisplayName: '' };
    var po = productOpts || { product: 'all' };

    var fullActiveRows = _resolveDeploymentsTabKpiRows_(cfg, vm, po);
    var defaultFilteredRows = _applyDeploymentsTableDefaultHealthFilter_(fullActiveRows, cfg);
    var snap = _computeOverviewSnapshot_(cfg, vm, po);
    var ot = (snap && snap.totals) ? snap.totals : {};

    function healthCounts(rows) {
      var out = { total: rows.length, red: 0, yellow: 0, green: 0 };
      (rows || []).forEach(function (r) {
        var h = r && r.health;
        if (h === 'Red') out.red++;
        else if (h === 'Yellow') out.yellow++;
        else if (h === 'Green') out.green++;
      });
      return out;
    }

    function countStudent(rows) {
      var n = 0;
      (rows || []).forEach(function (r) {
        if (r && r.isStudentDeployment) n++;
      });
      return n;
    }

    var overviewAllActiveCounts = {
      total: ot.totalActive || 0,
      red: ot.red || 0,
      yellow: ot.yellow || 0,
      green: ot.green || 0
    };
    var deploymentsDefaultFilteredCounts = healthCounts(defaultFilteredRows);
    var fullCounts = healthCounts(fullActiveRows);

    var report = {
      appId: cfg.appId || '',
      studentMode: (cfg.student && cfg.student.mode) || null,
      note: 'Overview KPIs intentionally count all active deployments (Red+Yellow+Green). ' +
        'Deployments tab KPI cards apply cfg.ui.deploymentsTable.defaultHealthFilter client-side.',
      overviewAllActiveCounts: overviewAllActiveCounts,
      deploymentsDefaultFilteredCounts: deploymentsDefaultFilteredCounts,
      fullActiveRowCount: fullActiveRows.length,
      defaultFilteredRowCount: defaultFilteredRows.length,
      studentRowsInOverview: countStudent(fullActiveRows),
      studentRowsInDeployments: countStudent(defaultFilteredRows),
      overviewTotalsMatchFullActivePipeline: overviewAllActiveCounts.total === fullCounts.total &&
        overviewAllActiveCounts.red === fullCounts.red &&
        overviewAllActiveCounts.yellow === fullCounts.yellow &&
        overviewAllActiveCounts.green === fullCounts.green,
      overviewTotalEqualsRedYellowGreen: overviewAllActiveCounts.total ===
        (overviewAllActiveCounts.red + overviewAllActiveCounts.yellow + overviewAllActiveCounts.green)
    };

    Logger.log('debugOverviewVsDeploymentsCountsForUI: ' + JSON.stringify(report));
    return report;
  }

  /**
   * Diagnostic: logs the overview snapshot payload shape.
   * @param {AppConfig} config
   */

  /**
   * Diagnostic: Overview KPI override banner vs impact summary parity.
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  function debugOverviewOverrideContextForUI(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var vm = viewModeOpts || { viewMode: 'all', ddDisplayName: '' };
    var po = productOpts || { product: 'all' };
    var pa = (po && po.product) || 'all';
    var overviewCacheBase = 'overviewData:v16:overrideImpactContextParity:lifecycleDeploymentStage:overrideAware';
    var cacheKey = _perfKey_(cfg, overviewCacheBase);

    var kpiRows = _resolveDeploymentsTabKpiRows_(cfg, vm, po);
    var impactCtx = buildOverrideImpactContext_(kpiRows);
    var snap = getOverviewSnapshot(cfg, vm, po);
    var bannerFootnote = (snap && snap.overrideFootnote) ? snap.overrideFootnote : {};
    var overviewBannerCount = bannerFootnote.overrideAffectedCount || 0;
    var summaryCount = impactCtx.summary.totalDeployments || 0;

    var depMap = getDeploymentOverridesMap_(cfg);
    var glMap = getGoLivesOverridesMap_(cfg);
    var rawDeploymentOverrideRowCount = Object.keys(depMap).length;
    var rawGoLivesOverrideRowCount = Object.keys(glMap).length;

    var clearedBlankOverrideRowCount = 0;
    Object.keys(depMap).forEach(function (id) {
      var row = depMap[id];
      var hasOp = !!(row.overrideHealth || row.overrideMtp || row.overrideStage ||
        row.overrideCurrentUpdate || row.overrideAccount || row.overrideName);
      if (!hasOp && !row.exclude) clearedBlankOverrideRowCount++;
    });
    Object.keys(glMap).forEach(function (acct) {
      var row = glMap[acct];
      var hasOp = !!(row.overrideDate || row.overridePartner);
      if (!hasOp && !row.exclude) clearedBlankOverrideRowCount++;
    });

    var mismatchReason = '';
    if (overviewBannerCount !== summaryCount) {
      mismatchReason = 'Cached or snapshot overrideFootnote (' + overviewBannerCount +
        ') differs from live KPI row impact summary (' + summaryCount + ').';
    }

    var sampleBannerRows = (kpiRows || []).filter(function (r) {
      return r && r.hasOperationalOverride;
    }).slice(0, 5).map(function (r) {
      return {
        deploymentId: r.deploymentId,
        accountName: r.accountName,
        hasOperationalOverride: !!r.hasOperationalOverride,
        effective: rowHasEffectiveOperationalOverride_(r)
      };
    });
    var sampleSummaryRows = (impactCtx.affectedRows || []).slice(0, 5).map(function (r) {
      return {
        deploymentId: r.deploymentId,
        accountName: r.accountName,
        overrideMeta: r.overrideMeta || null
      };
    });

    return {
      appId: cfg.appId || '',
      overviewBannerCount: overviewBannerCount,
      summaryCount: summaryCount,
      summaryDetails: impactCtx.summary,
      rawDeploymentOverrideRowCount: rawDeploymentOverrideRowCount,
      rawGoLivesOverrideRowCount: rawGoLivesOverrideRowCount,
      effectiveOverrideCount: summaryCount,
      clearedBlankOverrideRowCount: clearedBlankOverrideRowCount,
      cacheKey: cacheKey,
      cacheVersion: overviewCacheBase,
      sampleRowsCountedByBanner: sampleBannerRows,
      sampleRowsShownInSummary: sampleSummaryRows,
      mismatchReason: mismatchReason
    };
  }

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
  // DD Digest partner filter (IndustryMode apps — config-driven, N7)
  // ===========================================================================

  /**
   * Normalizes deployment partner names for DD Digest allow-list matching.
   * @param {string} raw
   * @return {string}
   * @private
   */
  function _normalizePartnerNameForFilter_(raw) {
    var s = String(raw || '').toLowerCase().trim();
    s = s.replace(/[.,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.endsWith(' llc')) {
      s = s.slice(0, -4).trim();
    }
    return s;
  }

  /**
   * @param {AppConfig} cfg
   * @return {{ partnerFilterEnabled: boolean, partnerNames: Array<string> }}
   * @private
   */
  function _ddDigestPartnerFilterConfig_(cfg) {
    var dd = (cfg.notify && cfg.notify.ddDigest) || {};
    return {
      partnerFilterEnabled: !!dd.partnerFilterEnabled,
      partnerNames: Array.isArray(dd.partnerNames) ? dd.partnerNames : []
    };
  }

  /**
   * True when row partner matches one of notify.ddDigest.partnerNames (normalized).
   * When partnerFilterEnabled is false, all rows match.
   *
   * @param {AppConfig} cfg
   * @param {string} partnerRaw
   * @return {boolean}
   */
  function matchesDdDigestPartnerFilter(config, partnerRaw) {
    var cfg = CoreConfig.withDefaults(config);
    var filterCfg = _ddDigestPartnerFilterConfig_(cfg);
    if (!filterCfg.partnerFilterEnabled) return true;
    if (!filterCfg.partnerNames.length) return true;

    var normPartner = _normalizePartnerNameForFilter_(partnerRaw);
    if (!normPartner) return false;

    for (var i = 0; i < filterCfg.partnerNames.length; i++) {
      var normFilter = _normalizePartnerNameForFilter_(filterCfg.partnerNames[i]);
      if (normFilter && normPartner === normFilter) return true;
    }
    return false;
  }

  /**
   * Filters MDS/PGL batch rows for DD Digest when notify.ddDigest.partnerFilterEnabled.
   *
   * @param {AppConfig} config
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   */
  function filterMdsPglRowsForDdDigestPartner(config, rows) {
    var cfg = CoreConfig.withDefaults(config);
    var filterCfg = _ddDigestPartnerFilterConfig_(cfg);
    if (!filterCfg.partnerFilterEnabled) return rows;

    return (rows || []).filter(function (row) {
      return matchesDdDigestPartnerFilter(cfg, row.partner);
    });
  }

  /**
   * @param {Array<Object>} rows
   * @return {Array<string>}
   * @private
   */
  function _distinctPartnerNamesFromMdsPglRows_(rows) {
    var seen = {};
    (rows || []).forEach(function (row) {
      var p = String(row.partner || '').trim();
      if (p) seen[p] = true;
    });
    return Object.keys(seen).sort();
  }

  // ===========================================================================
  // D1: DIAGNOSTIC HELPER
  // ===========================================================================

  /**
   * No-send diagnostic for DD Digest grouping: config, DD map size, horizon rows,
   * assigned vs unassigned counts, and sample unassigned rows with reason hints.
   *
   * @param {AppConfig} config
   * @param {number=} windowDays  Default 30
   * @return {Object}
   */
  function debugDdDigestAssignmentsForUI(config, windowDays) {
    var cfg = CoreConfig.withDefaults(config);
    var appId = cfg.appId || 'default';
    var horizonDays = parseInt(windowDays, 10) || 30;
    var sheets = cfg.sheets || {};

    var ddMapRaw = {};
    try { ddMapRaw = getDdAssignmentsFromContacts_(cfg) || {}; }
    catch (e) {
      Logger.log('debugDdDigestAssignmentsForUI: getDdAssignmentsFromContacts_ failed: ' + e);
    }
    var ddMap = _canonicalizeDdAssignmentsMap_(ddMapRaw);

    var contactsMap = {};
    try {
      contactsMap = _canonicalizeContactsMapForMdsPgl_(getDeploymentContactsMap_(cfg));
    } catch (e) {
      Logger.log('debugDdDigestAssignmentsForUI: getDeploymentContactsMap_ failed: ' + e);
    }

    var metaMap = getDeploymentsMetaMap_(cfg) || {};
    var activeByCanon = {};
    try {
      (_resolveMdsPglActiveRows_(cfg) || []).forEach(function (r) {
        var canon = _canonicalId_(r.deploymentId);
        if (canon) activeByCanon[canon] = r;
      });
    } catch (e) {
      Logger.log('debugDdDigestAssignmentsForUI: _resolveMdsPglActiveRows_ failed: ' + e);
    }

    var payload = getMdsPglBatchView(cfg, null, 6);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var batchRows = [];
    (payload.groups || []).forEach(function (g) {
      batchRows = batchRows.concat(g.mdsRows || [], g.pglRows || []);
    });

    var upcoming = batchRows.filter(function (row) {
      if (!row.eventDate) return false;
      var ev = new Date(row.eventDate);
      ev.setHours(0, 0, 0, 0);
      var du = Math.round((ev.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      return du >= 0 && du <= horizonDays;
    });

    var filterCfg = _ddDigestPartnerFilterConfig_(cfg);
    var productModeUnion = !!(cfg.activeDeployments &&
      cfg.activeDeployments.productModeUnionEnabled);
    var distinctPartnersBefore = _distinctPartnerNamesFromMdsPglRows_(upcoming);
    var rawMdsPglRowCount = upcoming.length;
    var excludedByPartnerSamples = [];
    var upcomingFiltered = filterMdsPglRowsForDdDigestPartner(cfg, upcoming);
    if (filterCfg.partnerFilterEnabled) {
      upcoming.forEach(function (row) {
        if (!matchesDdDigestPartnerFilter(cfg, row.partner) &&
            excludedByPartnerSamples.length < 8) {
          excludedByPartnerSamples.push({
            accountName: row.accountName || '',
            deploymentName: row.deploymentName || '',
            partner: row.partner || '',
            surveyType: row.surveyType || '',
            eventDate: row.eventDate || null,
            deliveryDirector: row.deliveryDirector || ''
          });
        }
      });
    }
    upcoming = upcomingFiltered;

    var displayMergeKeyCounts = {};
    upcoming.forEach(function (row) {
      var canon = _canonicalId_(row.deploymentId);
      var eventKey = _toDateKey_(row.eventDate) || 'nodate';
      var depName = String(row.deploymentName || '').trim().toLowerCase();
      var dd = String(row.deliveryDirector || '(Unassigned)').trim().toLowerCase() || '(unassigned)';
      var mergeKey = canon ?
        (canon + '|' + eventKey + '|' + depName + '|' + dd) :
        ('nodep|' + String(row.accountName || '').trim().toLowerCase() + '|' + depName +
          '|' + eventKey + '|' + String(row.partner || '').trim().toLowerCase() + '|' + dd);
      displayMergeKeyCounts[mergeKey] = (displayMergeKeyCounts[mergeKey] || 0) + 1;
    });
    var displayMergeExtraRows = 0;
    Object.keys(displayMergeKeyCounts).forEach(function (mk) {
      if (displayMergeKeyCounts[mk] > 1) {
        displayMergeExtraRows += displayMergeKeyCounts[mk] - 1;
      }
    });

    var assigned = 0;
    var unassigned = 0;
    var distinctDdNames = {};
    var unassignedReasons = {
      missingDeploymentId: 0,
      noResolvableSource: 0,
      damOnlyWouldAssign: 0
    };
    var unassignedSamples = [];

    upcoming.forEach(function (row) {
      var canon = _canonicalId_(row.deploymentId);
      var label = String(row.deliveryDirector || '').trim();
      if (label) {
        assigned++;
        distinctDdNames[label] = true;
        return;
      }
      unassigned++;
      if (!canon) {
        unassignedReasons.missingDeploymentId++;
      } else {
        var active = activeByCanon[canon];
        var meta = metaMap[canon] || {};
        var contacts = contactsMap[canon] || null;
        var ddList = ddMap[canon] || [];
        var resolved = active ?
          _resolveMdsPglDeliveryDirector_(active, meta, contacts, ddList) :
          { name: '', source: 'none' };
        if (resolved.source === 'none') {
          unassignedReasons.noResolvableSource++;
          if (active && String(active.damFullName || '').trim()) {
            unassignedReasons.damOnlyWouldAssign++;
          }
        }
      }
      if (unassignedSamples.length < 8) {
        unassignedSamples.push({
          accountName: row.accountName || '',
          deploymentName: row.deploymentName || '',
          deploymentId: row.deploymentId || '',
          surveyType: row.surveyType || '',
          eventDate: row.eventDate || null,
          deliveryDirectorOnRow: row.deliveryDirector || ''
        });
      }
    });

    var sponsorDeployments = 0;
    Object.keys(contactsMap).forEach(function (k) {
      if (contactsMap[k] && contactsMap[k].wdSponsor) sponsorDeployments++;
    });

    var summary = {
      appId: appId,
      productModeUnionEnabled: productModeUnion,
      partnerFilterEnabled: filterCfg.partnerFilterEnabled,
      partnerNames: filterCfg.partnerNames,
      rawMdsPglRowCount: rawMdsPglRowCount,
      postPartnerFilterRowCount: upcoming.length,
      excludedByPartnerCount: rawMdsPglRowCount - upcoming.length,
      mdsPglDisplayMergeExtraRows: displayMergeExtraRows,
      distinctPartnerNamesBeforeFilter: distinctPartnersBefore,
      distinctPartnerNamesAfterFilter: _distinctPartnerNamesFromMdsPglRows_(upcoming),
      sampleExcludedByPartner: excludedByPartnerSamples,
      deploymentContactsSheet: sheets.deploymentContacts || '',
      sfdcContactsSheet: sheets.sfdcContacts || '',
      ddAssignmentMapDeployments: Object.keys(ddMap).length,
      ddAssignmentMapDeploymentsRaw: Object.keys(ddMapRaw).length,
      contactsMapDeployments: Object.keys(contactsMap).length,
      contactsWithDeploymentSponsor: sponsorDeployments,
      horizonDays: horizonDays,
      upcomingMdsPglRows: upcoming.length,
      assignedToDd: assigned,
      unassigned: unassigned,
      distinctDeliveryDirectorNames: Object.keys(distinctDdNames).sort(),
      unassignedReasons: unassignedReasons,
      unassignedSamples: unassignedSamples
    };

    Logger.log('debugDdDigestAssignmentsForUI(' + appId + '): ' + JSON.stringify(summary));
    return summary;
  }

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
      return rows.filter(function (r) { return !!studentIds[r.deploymentId]; })
        .map(function (r) {
          return Object.assign({}, r, { isStudentDeployment: true });
        });
    }
    var studentMode = cfg.student.mode || 'separate';
    var tagged = rows.map(function (r) {
      return Object.assign({}, r, { isStudentDeployment: !!studentIds[r.deploymentId] });
    });
    if (studentMode === 'integrated') return tagged;
    return tagged.filter(function (r) { return !r.isStudentDeployment; });
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
   * Target go-live for the Student Records product function on a deployment (YYYY-MM-DD).
   *
   * @param {string} deploymentId
   * @param {Object<string, Array<{function:string, targetGoLive:string}>>} pfMap
   * @return {string}
   * @private
   */
  function _studentRecordsTargetDateFromPfMap_(deploymentId, pfMap) {
    var prods = (pfMap && pfMap[deploymentId]) ? pfMap[deploymentId] : [];
    var want = 'student records';
    for (var i = 0; i < prods.length; i++) {
      var fn = String(prods[i]['function'] || '').trim().toLowerCase();
      if (fn === want) {
        return prods[i].targetGoLive || '';
      }
    }
    return '';
  }

  /**
   * Calendar YYYY-MM-DD for Student tab payloads (no timezone shift on date-only strings).
   *
   * @param {*} rawDate
   * @return {string}
   * @private
   */
  function _studentTabCalendarDateField_(rawDate) {
    if (rawDate == null || rawDate === '') return '';
    var key = CoreUtils.toCalendarDateKey(rawDate);
    if (key) return key;
    var iso = CoreUtils.extractIsoCalendarDateKey(rawDate);
    return iso || '';
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
        rowIndex:              dep.rowIndex,
        deploymentId:          dep.deploymentId,
        accountName:           dep.accountName,
        deploymentName:        dep.deploymentName,
        partner:               dep.partner,
        overallStatus:         dep.overallStatus,
        health:                dep.health,
        phase:                 dep.phase,
        mtpDate:               _studentTabCalendarDateField_(dep.mtpDate),
        studentRecordsMtpDate: _studentTabCalendarDateField_(
          _studentRecordsTargetDateFromPfMap_(dep.deploymentId, pfMap)
        ),
        registrationDate:      sd.registrationDate || '',
        notes:                 sd.notes || ''
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
   * Formats a date for UI display (matches CoreUI formatDate: "Sep 14, 2026").
   *
   * @param {*} rawDate
   * @return {string}
   * @private
   */
  function _formatUiShortDate_(rawDate) {
    if (rawDate === null || rawDate === undefined || rawDate === '') return '';
    var d = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy');
  }

  /**
   * HENP-only diagnostic: Student tab row dates vs expanded Student Products (calendar keys).
   *
   * @param {AppConfig} config
   * @param {string=} optionalToken Filter on account, deployment name, or id.
   * @return {{appId:string, rowCount:number, rows:Array<Object>, error?:string}}
   */
  function debugHenpStudentRowForUI(config, optionalToken) {
    var cfg = CoreConfig.withDefaults(config);
    if (String(cfg.appId || '').toUpperCase() !== 'HENP') {
      return { appId: cfg.appId || '', rowCount: 0, rows: [], error: 'debugHenpStudentRowForUI is HENP-only.' };
    }
    if (!cfg.student || cfg.student.enabled !== true) {
      return { appId: cfg.appId || 'HENP', rowCount: 0, rows: [], error: 'Student is not enabled.' };
    }

    var token = optionalToken ? String(optionalToken).trim().toLowerCase() : '';
    var tabPayload = buildStudentTabData_(cfg);
    var deployments = (tabPayload && tabPayload.deployments) ? tabPayload.deployments : [];
    var pfMap = (tabPayload && tabPayload.products) ? tabPayload.products : {};

    var filtered = deployments;
    if (token) {
      filtered = deployments.filter(function (d) {
        var hay = [
          String(d.accountName || '').toLowerCase(),
          String(d.deploymentName || '').toLowerCase(),
          String(d.deploymentId || '').toLowerCase()
        ].join(' ');
        return hay.indexOf(token) >= 0;
      });
    }

    var rows = filtered.slice(0, 20).map(function (d) {
      var srRaw = _studentRecordsTargetDateFromPfMap_(d.deploymentId, pfMap);
      var prods = pfMap[d.deploymentId] || [];
      var studentRecordsPf = null;
      for (var i = 0; i < prods.length; i++) {
        var fn = String(prods[i]['function'] || '').trim().toLowerCase();
        if (fn === 'student records') {
          studentRecordsPf = prods[i];
          break;
        }
      }
      var productsDetail = prods.map(function (p) {
        var tgt = p.targetGoLive || '';
        return {
          function: p['function'] || '',
          targetGoLiveRaw: tgt,
          targetGoLiveDateKey: _studentTabCalendarDateField_(tgt),
          targetGoLiveDisplay: _formatUiShortDate_(tgt)
        };
      });

      return {
        accountName: d.accountName || '',
        deploymentName: d.deploymentName || '',
        deploymentId: d.deploymentId || '',
        mtpDate: {
          payloadRaw: d.mtpDate || '',
          dateKey: _studentTabCalendarDateField_(d.mtpDate),
          display: _formatUiShortDate_(d.mtpDate)
        },
        studentRecordsMtpDate: {
          payloadRaw: d.studentRecordsMtpDate || '',
          dateKey: _studentTabCalendarDateField_(d.studentRecordsMtpDate),
          display: _formatUiShortDate_(d.studentRecordsMtpDate),
          derivedFromPfTargetRaw: srRaw || '',
          derivedFromPfDateKey: _studentTabCalendarDateField_(srRaw),
          matchesStudentRecordsPfRow: !!(studentRecordsPf &&
            _studentTabCalendarDateField_(d.studentRecordsMtpDate) ===
            _studentTabCalendarDateField_(studentRecordsPf.targetGoLive || ''))
        },
        studentProducts: productsDetail
      };
    });

    Logger.log('debugHenpStudentRowForUI: rows=' + rows.length + (token ? ', token=' + token : ''));
    return { appId: cfg.appId || 'HENP', rowCount: filtered.length, rows: rows };
  }

  /**
   * HENP-only diagnostic: trace Student tab MTP Date from SFDC sheet → effective row → UI payload.
   * Non-mutating. Returns null fields when Student is disabled or app is not HENP.
   *
   * @param {AppConfig} config
   * @param {string=} optionalAccountOrDeploymentToken Optional filter on account, deployment name, or id.
   * @return {{appId:string, rowCount:number, sampleRows:Array<Object>, error?:string}}
   */
  function debugHenpStudentMtpDateTraceForUI(config, optionalAccountOrDeploymentToken) {
    var cfg = CoreConfig.withDefaults(config);
    if (String(cfg.appId || '').toUpperCase() !== 'HENP') {
      return {
        appId: cfg.appId || '',
        rowCount: 0,
        sampleRows: [],
        error: 'debugHenpStudentMtpDateTraceForUI is HENP-only.'
      };
    }
    if (!cfg.student || cfg.student.enabled !== true) {
      return {
        appId: cfg.appId || 'HENP',
        rowCount: 0,
        sampleRows: [],
        error: 'Student is not enabled for this app.'
      };
    }

    var token = optionalAccountOrDeploymentToken
      ? String(optionalAccountOrDeploymentToken).trim().toLowerCase()
      : '';
    var sheetName = (cfg.sheets && cfg.sheets.deployments) || 'SFDC_Deployments';
    var sfdcField = 'Deployment__r.Current_MTP_Date__c';
    var sfdcColumnKey = 'CURRENT_MTP_DATE';

    var sfdcRows = [];
    try {
      sfdcRows = readSfdcDeploymentsRaw_(cfg) || [];
    } catch (readErr) {
      Logger.log('debugHenpStudentMtpDateTraceForUI: SFDC read failed: ' + readErr);
    }
    var sfdcById = {};
    sfdcRows.forEach(function (r) {
      if (r && r.deploymentId) sfdcById[r.deploymentId] = r;
    });

    var overridesMap = getDeploymentOverridesMap_(cfg);
    var tabPayload = buildStudentTabData_(cfg);
    var deployments = (tabPayload && tabPayload.deployments) ? tabPayload.deployments : [];
    var pfMap = CoreSalesforce.getStudentProductFunctionsMap_(cfg) || {};

    var filtered = deployments;
    if (token) {
      filtered = deployments.filter(function (d) {
        var acct = String(d.accountName || '').toLowerCase();
        var dep = String(d.deploymentName || '').toLowerCase();
        var id = String(d.deploymentId || '').toLowerCase();
        return acct.indexOf(token) >= 0 || dep.indexOf(token) >= 0 || id.indexOf(token) >= 0;
      });
    }

    var sampleRows = filtered.slice(0, 20).map(function (d) {
      var rawRow = sfdcById[d.deploymentId] || null;
      var resolved = rawRow
        ? _resolveDeploymentOverrideEntry_(rawRow, overridesMap)
        : { ov: {}, lookupId: '' };
      var ov = resolved.ov || {};
      var hasOverride = !!(ov && ov.overrideMtp);
      var rawSourceValue = hasOverride ? ov.overrideMtp : (rawRow ? rawRow.mtpDate : '');
      var sourceFieldName = hasOverride ? 'DeploymentOverrides.Override_MTPDate' : sfdcField;
      var sourceSheetName = hasOverride
        ? ((cfg.sheets && cfg.sheets.deploymentOverrides) || 'DeploymentOverrides')
        : sheetName;

      var displayed = d.mtpDate;
      var displayedType = displayed === null || displayed === undefined || displayed === ''
        ? 'empty'
        : (displayed instanceof Date ? 'Date' : typeof displayed);

      var parsedDateValue = '';
      if (displayed !== null && displayed !== undefined && displayed !== '') {
        var pd = displayed instanceof Date ? displayed : new Date(String(displayed));
        if (!isNaN(pd.getTime())) {
          parsedDateValue = CoreUtils.formatDateToIsoString(pd);
        }
      }

      var prods = pfMap[d.deploymentId] || [];
      var productFunction = prods.length
        ? prods.map(function (p) { return p['function'] || p.function || ''; }).filter(Boolean).join('; ')
        : '';

      return {
        accountName: d.accountName || '',
        deploymentName: d.deploymentName || '',
        deploymentId: d.deploymentId || '',
        productFunction: productFunction,
        displayedMtpDateValue: displayed === null || displayed === undefined ? '' : String(displayed),
        displayedMtpDateType: displayedType,
        sourceFieldName: sourceFieldName,
        sourceSheetName: sourceSheetName,
        sourceColumnKey: hasOverride ? 'Override_MTPDate' : sfdcColumnKey,
        rawSourceValue: rawSourceValue === null || rawSourceValue === undefined
          ? ''
          : (rawSourceValue instanceof Date ? rawSourceValue.toISOString() : String(rawSourceValue)),
        rawSourceValueType: rawSourceValue === null || rawSourceValue === undefined
          ? 'empty'
          : (rawSourceValue instanceof Date ? 'Date' : typeof rawSourceValue),
        overrideApplied: hasOverride,
        parsedDateValue: parsedDateValue,
        formattedShortDate: _formatUiShortDate_(displayed)
      };
    });

    Logger.log('debugHenpStudentMtpDateTraceForUI: rowCount=' + deployments.length +
               ', samples=' + sampleRows.length + (token ? ', token=' + token : ''));

    return {
      appId: cfg.appId || 'HENP',
      rowCount: deployments.length,
      sampleRows: sampleRows
    };
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
  // GO-LIVE EXPLORER (bounded period + filters + KPI strip)
  // ===========================================================================

  /**
   * Workday fiscal year start calendar year for a date (FY runs Feb 1 – Jan 31).
   * @param {Date} date
   * @return {number}
   * @private
   */
  function _workdayFiscalYearStartYear_(date) {
    var m = date.getMonth();
    var y = date.getFullYear();
    return m === 0 ? y - 1 : y;
  }

  /**
   * Workday fiscal quarter (1–4) for a date.
   * Q1 Feb–Apr, Q2 May–Jul, Q3 Aug–Oct, Q4 Nov–Jan.
   * @param {Date} date
   * @return {number}
   * @private
   */
  function _workdayFiscalQuarterOfDate_(date) {
    var m = date.getMonth();
    if (m >= 1 && m <= 3) return 1;
    if (m >= 4 && m <= 6) return 2;
    if (m >= 7 && m <= 9) return 3;
    return 4;
  }

  /**
   * Workday fiscal year end label year (FY named for calendar year in which it ends).
   * @param {Date} date
   * @return {number}
   * @private
   */
  function _workdayFiscalYearEndYear_(date) {
    return _workdayFiscalYearStartYear_(date) + 1;
  }

  /**
   * Inclusive start/end date keys for a full Workday fiscal year.
   * @param {number} fiscalYearStart  Calendar year in which FY starts (Feb 1).
   * @return {{startKey: string, endKey: string}}
   * @private
   */
  function _workdayFiscalYearRangeKeys_(fiscalYearStart) {
    var tz = Session.getScriptTimeZone();
    var start = new Date(fiscalYearStart, 1, 1);
    var end = new Date(fiscalYearStart + 1, 0, 31);
    return {
      startKey: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
      endKey: Utilities.formatDate(end, tz, 'yyyy-MM-dd')
    };
  }

  /**
   * Parses explorer fiscal year filter to FY end-year number.
   * @param {*} raw
   * @return {number}
   * @private
   */
  function _parseExplorerFiscalYearEnd_(raw) {
    if (raw === undefined || raw === null || raw === '') return NaN;
    if (typeof raw === 'number' && !isNaN(raw)) return raw;
    var m = String(raw).match(/FY?(\d{4})/i);
    return m ? parseInt(m[1], 10) : NaN;
  }

  /**
   * Inclusive start/end date keys for a Workday fiscal quarter.
   * @param {number} fiscalYearStart  Calendar year in which FY starts (Feb 1).
   * @param {number} quarter          1–4
   * @return {{startKey: string, endKey: string}}
   * @private
   */
  function _workdayFiscalQuarterRangeKeys_(fiscalYearStart, quarter) {
    var tz = Session.getScriptTimeZone();
    var ranges = {
      1: { sm: 1, sd: 1, em: 3, ed: 30, ey: fiscalYearStart },
      2: { sm: 4, sd: 1, em: 6, ed: 31, ey: fiscalYearStart },
      3: { sm: 7, sd: 1, em: 9, ed: 30, ey: fiscalYearStart },
      4: { sm: 10, sd: 1, em: 0, ed: 31, ey: fiscalYearStart + 1 }
    };
    var r = ranges[quarter] || ranges[1];
    var start = new Date(fiscalYearStart, r.sm, r.sd);
    var end = new Date(r.ey, r.em, r.ed);
    return {
      startKey: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
      endKey: Utilities.formatDate(end, tz, 'yyyy-MM-dd')
    };
  }

  /**
   * Formats a date key as "Mon D, YYYY" for explorer labels.
   * @param {string} dateKey
   * @return {string}
   * @private
   */
  function _formatExplorerDisplayDate_(dateKey) {
    if (!dateKey) return '';
    var parts = String(dateKey).split('-');
    if (parts.length !== 3) return dateKey;
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var m = parseInt(parts[1], 10);
    return months[m - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }

  /**
   * Resolves explorer time-period filter to inclusive date keys + label.
   * @param {Object} filterState
   * @param {AppConfig} cfg
   * @return {{valid: boolean, error: string, startKey: string, endKey: string, periodLabel: string}}
   * @private
   */
  function _resolveGoLivesExplorerPeriod_(filterState, cfg) {
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var glt = (cfg.ui && cfg.ui.goLivesTab) || {};
    var period = (filterState && filterState.timePeriod) || glt.defaultTimePeriod || 'next90';
    var startKey = '';
    var endKey = '';
    var periodLabel = '';

    function monthRange_(y, m) {
      var start = new Date(y, m, 1);
      var end = new Date(y, m + 1, 0);
      return {
        startKey: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
        endKey: Utilities.formatDate(end, tz, 'yyyy-MM-dd')
      };
    }

    if (period === 'custom') {
      startKey = _toDateKey_(filterState.customStart);
      endKey = _toDateKey_(filterState.customEnd);
      if (!startKey || !endKey) {
        return { valid: false, error: 'Custom range requires both From and To dates.', startKey: '', endKey: '', periodLabel: '' };
      }
      if (startKey > endKey) {
        return { valid: false, error: 'Custom range From date must be before To date.', startKey: '', endKey: '', periodLabel: '' };
      }
      var maxMonths = glt.customRangeMaxMonths || 12;
      var startD = new Date(startKey);
      var limitD = new Date(startD.getFullYear(), startD.getMonth() + maxMonths, startD.getDate());
      var endD = new Date(endKey);
      if (endD > limitD) {
        return { valid: false, error: 'Custom range cannot exceed ' + maxMonths + ' months.', startKey: '', endKey: '', periodLabel: '' };
      }
      periodLabel = _formatExplorerDisplayDate_(startKey) + ' \u2013 ' + _formatExplorerDisplayDate_(endKey);
    } else if (period === 'last60') {
      startKey = _addDaysToKey_(todayKey, -60);
      endKey = todayKey;
      periodLabel = 'Last 60 Days';
    } else if (period === 'next90') {
      startKey = todayKey;
      endKey = _addDaysToKey_(todayKey, 90);
      periodLabel = 'Next 90 Days';
    } else if (period === 'fiscalYearQuarter') {
      var fyEndYear = _parseExplorerFiscalYearEnd_(filterState.fiscalYear);
      if (isNaN(fyEndYear)) {
        fyEndYear = _workdayFiscalYearEndYear_(now);
      }
      var fyStart = fyEndYear - 1;
      var quarterRaw = (filterState.fiscalQuarter || 'All').toString().trim();
      var quarterNorm = quarterRaw.toUpperCase();
      if (!quarterRaw || quarterNorm === 'ALL') {
        var fyRange = _workdayFiscalYearRangeKeys_(fyStart);
        startKey = fyRange.startKey;
        endKey = fyRange.endKey;
        periodLabel = 'FY' + fyEndYear;
      } else {
        var qNum = parseInt(quarterNorm.replace(/^Q/, ''), 10);
        if (isNaN(qNum) || qNum < 1 || qNum > 4) qNum = 1;
        var qRange = _workdayFiscalQuarterRangeKeys_(fyStart, qNum);
        startKey = qRange.startKey;
        endKey = qRange.endKey;
        periodLabel = 'FY' + fyEndYear + ' Q' + qNum;
      }
    } else if (period === 'rolling12') {
      startKey = _addDaysToKey_(todayKey, -365);
      endKey = todayKey;
      periodLabel = 'Rolling 12 Months';
    } else if (period === 'currentMonth') {
      var cm = monthRange_(now.getFullYear(), now.getMonth());
      startKey = cm.startKey;
      endKey = cm.endKey;
      periodLabel = 'Current Month';
    } else if (period === 'previousMonth') {
      var pm = monthRange_(now.getFullYear(), now.getMonth() - 1);
      startKey = pm.startKey;
      endKey = pm.endKey;
      periodLabel = 'Previous Month';
    } else if (period === 'nextMonth') {
      var nm = monthRange_(now.getFullYear(), now.getMonth() + 1);
      startKey = nm.startKey;
      endKey = nm.endKey;
      periodLabel = 'Next Month';
    } else if (period === 'currentFQ') {
      var fy = _workdayFiscalYearStartYear_(now);
      var fq = _workdayFiscalQuarterOfDate_(now);
      var cqr = _workdayFiscalQuarterRangeKeys_(fy, fq);
      startKey = cqr.startKey;
      endKey = cqr.endKey;
      periodLabel = 'Current Fiscal Quarter';
    } else if (period === 'nextFQ') {
      var fy2 = _workdayFiscalYearStartYear_(now);
      var fq2 = _workdayFiscalQuarterOfDate_(now);
      var nfy = fy2;
      var nfq = fq2 + 1;
      if (nfq > 4) { nfq = 1; nfy = fy2 + 1; }
      var nqr = _workdayFiscalQuarterRangeKeys_(nfy, nfq);
      startKey = nqr.startKey;
      endKey = nqr.endKey;
      periodLabel = 'Next Fiscal Quarter';
    } else if (period === 'currentFY') {
      var fy3 = _workdayFiscalYearStartYear_(now);
      startKey = Utilities.formatDate(new Date(fy3, 1, 1), tz, 'yyyy-MM-dd');
      endKey = Utilities.formatDate(new Date(fy3 + 1, 0, 31), tz, 'yyyy-MM-dd');
      periodLabel = 'Current Fiscal Year';
    } else if (period === 'nextFY') {
      var fy4 = _workdayFiscalYearStartYear_(now) + 1;
      startKey = Utilities.formatDate(new Date(fy4, 1, 1), tz, 'yyyy-MM-dd');
      endKey = Utilities.formatDate(new Date(fy4 + 1, 0, 31), tz, 'yyyy-MM-dd');
      periodLabel = 'Next Fiscal Year';
    } else {
      startKey = todayKey;
      endKey = _addDaysToKey_(todayKey, 90);
      periodLabel = 'Next 90 Days';
    }

    return { valid: true, error: '', startKey: startKey, endKey: endKey, periodLabel: periodLabel };
  }

  /**
   * Classifies a resolved explorer period relative to today.
   * Past when periodEnd &lt; today; future when periodStart &gt; today; mixed otherwise.
   * @param {string} startKey
   * @param {string} endKey
   * @param {string} todayKey
   * @return {'past'|'future'|'mixed'}
   * @private
   */
  function _resolveGoLivesPeriodPosition_(startKey, endKey, todayKey) {
    if (!startKey || !endKey || !todayKey) return 'mixed';
    if (endKey < todayKey) return 'past';
    if (startKey > todayKey) return 'future';
    return 'mixed';
  }

  /**
   * Normalizes Go-Live Type for the resolved period (defensive server alignment).
   * @param {string} requestedType
   * @param {'past'|'future'|'mixed'} periodPosition
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function _normalizeGoLivesTypeForPeriod_(requestedType, periodPosition, cfg, timePeriod) {
    var defaultType = (cfg.ui && cfg.ui.goLivesTab && cfg.ui.goLivesTab.defaultGoLiveType) || 'upcoming';
    var type = (requestedType || defaultType).toLowerCase();
    var period = (timePeriod || '').toLowerCase();
    if (period === 'last60' || period === 'previousmonth') return 'completed';
    if (period === 'next90' || period === 'nextmonth' || period === 'nextfq' || period === 'nextfy') return 'upcoming';
    if (periodPosition === 'past') return 'completed';
    if (periodPosition === 'future') return 'upcoming';
    if (type === 'all' || type === 'upcoming' || type === 'completed') return type;
    if (period === 'rolling12' || period === 'currentmonth' || period === 'currentfq' ||
        period === 'currentfy' || period === 'fiscalyearquarter') return 'all';
    return defaultType;
  }

  /**
   * @param {number} count
   * @param {number} denom
   * @return {string}
   * @private
   */
  function _formatExplorerPercent_(count, denom) {
    if (!denom) return count ? '0%' : '\u2014';
    var pct = (count / denom) * 100;
    if (pct === 100) return '100%';
    if (Math.abs(pct - Math.round(pct)) < 0.05) return Math.round(pct) + '%';
    return pct.toFixed(1) + '%';
  }

  /**
   * Industry-mode completed (actual) go-lives in an inclusive date range.
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {string} windowStartKey
   * @param {string} windowEndKey
   * @return {Array<Object>}
   * @private
   */
  function _getIndustryModeCompletedGoLivesInRange_(cfg, viewModeOpts, productOpts, windowStartKey, windowEndKey) {
    var pa = (productOpts && productOpts.product) || 'all';
    var sfdcRows = [];
    try {
      sfdcRows = readSfdcDeploymentsRaw_(cfg);
    } catch (err) {
      Logger.log('CoreData._getIndustryModeCompletedGoLivesInRange_: read failed — ' + err);
      return [];
    }
    sfdcRows = filterDeploymentsByProduct_(sfdcRows, pa, cfg);
    var enrichmentMap = {};
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData._getIndustryModeCompletedGoLivesInRange_: enrichment failed — ' + err);
    }

    var results = [];
    sfdcRows.forEach(function (dep) {
      var enrichment = enrichmentMap[dep.deploymentId];
      var allRecentDates = enrichment ? (enrichment.recentDates || []) : [];
      var recentMatch = _latestRecentDateInRange_(dep, allRecentDates, windowStartKey, windowEndKey);
      if (!recentMatch) return;
      results.push({
        deploymentId: dep.deploymentId,
        accountId: dep.accountId,
        accountName: dep.accountName,
        deploymentName: dep.deploymentName,
        partner: dep.partner,
        industry: dep.industry,
        region: dep.region || dep.industry || '',
        subRegion: dep.subRegion,
        health: dep.health,
        wdEngManager: dep.wdEngManager,
        recentDates: recentMatch.filteredRecentDates,
        lastGoLiveDate: recentMatch.lastGoLiveDate,
        recordType: 'completed',
        goLiveDate: recentMatch.lastGoLiveDate
      });
    });

    results = filterDeploymentsByStudent_(results, 'exclude', cfg);
    results = _enrichGoLiveRowsWithOverrides_(results, getDeploymentOverridesMap_(cfg), getGoLivesOverridesMap_(cfg));
    return applyViewModeFilter_(cfg, results, viewModeOpts);
  }

  /**
   * Industry-mode upcoming (target/MTP) go-lives in an inclusive date range.
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {string} windowStartKey
   * @param {string} windowEndKey
   * @return {Array<Object>}
   * @private
   */
  function _getIndustryModeUpcomingGoLivesInRange_(cfg, viewModeOpts, productOpts, windowStartKey, windowEndKey) {
    var allEffective = getAllEffectiveDeployments(cfg, productOpts);
    var goLivesOverrides = getGoLivesOverridesMap_(cfg);
    var enrichmentMap = {};
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData._getIndustryModeUpcomingGoLivesInRange_: enrichment failed — ' + err);
    }

    var results = [];
    var seenDeploymentIds = {};

    allEffective.forEach(function (dep) {
      if (!dep.deploymentId) return;
      var enrichment = enrichmentMap[dep.deploymentId];
      if (!enrichment) return;
      var ov = goLivesOverrides[dep.accountName] || {};
      if (ov.exclude) return;

      var datesInWindow = (enrichment.upcomingDates || []).filter(function (ud) {
        var key = _toDateKey_(ud && ud.date);
        return key && _dateKeyInRange_(key, windowStartKey, windowEndKey);
      });
      if (datesInWindow.length === 0) return;

      var nextGoLiveDate = ov.overrideDate
        ? CoreUtils.formatDateToIsoString(ov.overrideDate)
        : datesInWindow[0].date;
      seenDeploymentIds[dep.deploymentId] = true;
      results.push({
        rowIndex: dep.rowIndex,
        deploymentId: dep.deploymentId,
        accountId: dep.accountId,
        accountName: dep.accountName,
        deploymentName: dep.deploymentName,
        industry: dep.industry,
        region: dep.region || dep.industry || '',
        subRegion: dep.subRegion,
        partner: ov.overridePartner || dep.partner,
        health: dep.health,
        wdEngManager: dep.wdEngManager,
        upcomingDates: datesInWindow,
        isPhased: enrichment.isPhased,
        nextGoLiveDate: nextGoLiveDate,
        mtpDate: nextGoLiveDate,
        recordType: 'upcoming',
        goLiveDate: nextGoLiveDate
      });
    });

    allEffective.forEach(function (dep) {
      if (!dep.deploymentId || seenDeploymentIds[dep.deploymentId]) return;
      var ov = goLivesOverrides[dep.accountName] || {};
      if (ov.exclude) return;
      var mtpDate = ov.overrideDate
        ? CoreUtils.formatDateToIsoString(ov.overrideDate)
        : dep.mtpDate;
      var key = _toDateKey_(mtpDate);
      if (!key || !_dateKeyInRange_(key, windowStartKey, windowEndKey)) return;
      results.push({
        rowIndex: dep.rowIndex,
        deploymentId: dep.deploymentId,
        accountId: dep.accountId,
        accountName: dep.accountName,
        deploymentName: dep.deploymentName,
        industry: dep.industry,
        region: dep.region || dep.industry || '',
        subRegion: dep.subRegion,
        partner: ov.overridePartner || dep.partner,
        health: dep.health,
        wdEngManager: dep.wdEngManager,
        upcomingDates: [{ date: mtpDate, products: [] }],
        isPhased: false,
        nextGoLiveDate: mtpDate,
        mtpDate: mtpDate,
        recordType: 'upcoming',
        goLiveDate: mtpDate
      });
    });

    results = filterDeploymentsByStudent_(results, 'exclude', cfg);
    results = _enrichGoLiveRowsWithOverrides_(results, getDeploymentOverridesMap_(cfg), getGoLivesOverridesMap_(cfg));
    return applyViewModeFilter_(cfg, results, viewModeOpts);
  }

  /**
   * Fetches completed + upcoming explorer rows for a period (both modes).
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {string} windowStartKey
   * @param {string} windowEndKey
   * @return {{completed: Array<Object>, upcoming: Array<Object>}}
   * @private
   */
  function _fetchGoLivesExplorerBaseRows_(cfg, viewModeOpts, productOpts, windowStartKey, windowEndKey) {
    var completed = [];
    var upcoming = [];
    if (usesProductModePfGoLiveSource_(cfg)) {
      completed = getProductModeGoLiveEvents_(cfg, {
        type: 'recent',
        startDate: windowStartKey,
        endDate: windowEndKey,
        productOpts: productOpts
      }) || [];
      upcoming = getProductModeGoLiveEvents_(cfg, {
        type: 'upcoming',
        startDate: windowStartKey,
        endDate: windowEndKey,
        productOpts: productOpts
      }) || [];
      completed = completed.map(function (r) {
        var dateKey = r.goLiveDate || r.lastGoLiveDate || '';
        return Object.assign({}, r, { recordType: 'completed', goLiveDate: dateKey });
      });
      upcoming = upcoming.map(function (r) {
        var dateKey = r.goLiveDate || r.nextGoLiveDate || r.mtpDate || '';
        return Object.assign({}, r, { recordType: 'upcoming', goLiveDate: dateKey });
      });
      completed = filterDeploymentsByStudent_(completed, 'exclude', cfg);
      upcoming = filterDeploymentsByStudent_(upcoming, 'exclude', cfg);
      completed = _enrichGoLiveRowsWithOverrides_(completed, getDeploymentOverridesMap_(cfg), getGoLivesOverridesMap_(cfg));
      upcoming = _enrichGoLiveRowsWithOverrides_(upcoming, getDeploymentOverridesMap_(cfg), getGoLivesOverridesMap_(cfg));
      completed = applyViewModeFilter_(cfg, completed, viewModeOpts);
      upcoming = applyViewModeFilter_(cfg, upcoming, viewModeOpts);
    } else {
      completed = _getIndustryModeCompletedGoLivesInRange_(cfg, viewModeOpts, productOpts, windowStartKey, windowEndKey);
      upcoming = _getIndustryModeUpcomingGoLivesInRange_(cfg, viewModeOpts, productOpts, windowStartKey, windowEndKey);
    }
    return { completed: completed, upcoming: upcoming };
  }

  /**
   * @param {string} val
   * @return {string|null}
   * @private
   */
  function _normalizeExplorerFilterValue_(val) {
    if (val === undefined || val === null) return null;
    var s = String(val).trim();
    if (!s || s === 'All') return null;
    return s;
  }

  /**
   * @param {Object} row
   * @param {string} term
   * @param {boolean} isProductMode
   * @return {boolean}
   * @private
   */
  function _goLivesExplorerRowMatchesSearch_(row, term, isProductMode) {
    if (!term) return true;
    var q = term.toLowerCase();
    var fields = [
      row.accountName, row.deploymentName, row.partner, row.wdEngManager,
      row.industry, row.region, row.subRegion, row.productArea, row.funcArea,
      row.displayDeploymentName, row.displayProductFunction, row.displayLabel
    ];
    if (row.productAreas && row.productAreas.length) {
      fields = fields.concat(row.productAreas);
    }
    if (row.productFunctions && row.productFunctions.length) {
      row.productFunctions.forEach(function (pf) {
        fields.push(pf.productArea, pf.funcArea, pf.deploymentName);
      });
    }
    for (var i = 0; i < fields.length; i++) {
      if ((fields[i] || '').toString().toLowerCase().indexOf(q) !== -1) return true;
    }
    if (row.recentDates) {
      for (var ri = 0; ri < row.recentDates.length; ri++) {
        var prods = row.recentDates[ri].products || [];
        for (var pi = 0; pi < prods.length; pi++) {
          if (prods[pi].toLowerCase().indexOf(q) !== -1) return true;
        }
      }
    }
    return false;
  }

  /**
   * @param {Object} row
   * @param {Object} filterState
   * @param {boolean} isProductMode
   * @return {boolean}
   * @private
   */
  function _goLivesExplorerRowMatchesAdvancedFilters_(row, filterState, isProductMode) {
    var partner = _normalizeExplorerFilterValue_(filterState.partner);
    var health = _normalizeExplorerFilterValue_(filterState.health);
    var region = _normalizeExplorerFilterValue_(filterState.region);
    var productArea = _normalizeExplorerFilterValue_(filterState.productArea);
    var em = _normalizeExplorerFilterValue_(filterState.engagementManager);

    if (partner && (row.partner || '') !== partner) return false;
    if (health && (row.health || '') !== health) return false;
    if (region) {
      var rowRegion = isProductMode ? (row.region || '') : (row.region || row.industry || '');
      if (rowRegion !== region) return false;
    }
    if (productArea) {
      var areas = row.productAreas || [];
      if (areas.indexOf(productArea) < 0 && (row.productArea || '') !== productArea) {
        var matched = false;
        if (row.productFunctions) {
          for (var i = 0; i < row.productFunctions.length; i++) {
            if ((row.productFunctions[i].productArea || '') === productArea) { matched = true; break; }
          }
        }
        if (!matched) return false;
      }
    }
    if (em && (row.wdEngManager || '') !== em) return false;
    return true;
  }

  /**
   * @param {Array<Object>} rows
   * @param {boolean} isProductMode
   * @return {Object}
   * @private
   */
  var _GO_LIVES_EXPLORER_UNIVERSE_VER = 'v1';
  var _GO_LIVES_EXPLORER_UNIVERSE_YEARS_BACK = 15;
  var _GO_LIVES_EXPLORER_UNIVERSE_YEARS_FORWARD = 10;

  /**
   * Cache key for the Go Lives Explorer base universe (app/product/view-mode/data-version).
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {string}
   * @private
   */
  function _goLivesExplorerUniverseCacheKey_(cfg, viewModeOpts, productOpts) {
    var pa = (productOpts && productOpts.product) || 'all';
    var vm = (viewModeOpts && viewModeOpts.viewMode) || 'all';
    var dd = String((viewModeOpts && viewModeOpts.ddDisplayName) || '').trim();
    var baseName = 'goLivesExplorerUniverse:' + _GO_LIVES_EXPLORER_UNIVERSE_VER +
      ':vm=' + vm + ':dd=' + dd + ':product=' + pa;
    return _perfKey_(cfg, baseName);
  }

  /**
   * Wide date window used to build the explorer base universe (fiscal-year coverage).
   * @return {{startKey: string, endKey: string}}
   * @private
   */
  function _goLivesExplorerUniverseWindow_() {
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var wideStart = Utilities.formatDate(
      new Date(now.getFullYear() - _GO_LIVES_EXPLORER_UNIVERSE_YEARS_BACK, 0, 1), tz, 'yyyy-MM-dd');
    var wideEnd = Utilities.formatDate(
      new Date(now.getFullYear() + _GO_LIVES_EXPLORER_UNIVERSE_YEARS_FORWARD, 11, 31), tz, 'yyyy-MM-dd');
    return { startKey: wideStart, endKey: wideEnd };
  }

  /**
   * Collects distinct Workday fiscal years (FY labels) from explorer rows.
   * @param {Array<Object>} rows
   * @return {Array<string>}
   * @private
   */
  function _collectGoLivesExplorerFiscalYearsFromRows_(rows) {
    var years = {};

    function addDateKey_(dk) {
      if (!dk) return;
      var d = new Date(dk);
      if (isNaN(d.getTime())) return;
      var fyEnd = _workdayFiscalYearEndYear_(d);
      years[fyEnd] = 'FY' + fyEnd;
    }

    (rows || []).forEach(function (row) {
      addDateKey_(row.goLiveDate || row.lastGoLiveDate || row.nextGoLiveDate || row.mtpDate);
    });

    return Object.keys(years).map(function (k) { return parseInt(k, 10); })
      .sort(function (a, b) { return b - a; })
      .map(function (y) { return years[y]; });
  }

  /**
   * Filters explorer rows to an inclusive date window.
   * @param {Array<Object>} rows
   * @param {string} startKey
   * @param {string} endKey
   * @return {Array<Object>}
   * @private
   */
  function _filterGoLivesExplorerRowsByPeriod_(rows, startKey, endKey) {
    return (rows || []).filter(function (row) {
      var dk = _toDateKey_(row.goLiveDate || row.lastGoLiveDate || row.nextGoLiveDate || row.mtpDate);
      return dk && _dateKeyInRange_(dk, startKey, endKey);
    });
  }

  /**
   * Builds and caches the Go Lives Explorer base universe once per app/product/view mode.
   * Does not apply time-period, search, go-live-type, or advanced filters.
   *
   * Tier 1: in-memory per execution. Tier 2: _PerfCache (same pattern as getOverviewSnapshot;
   * cross-execution reads may miss when CacheService binds to the library project).
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {{rows: Array<Object>, fiscalYears: Array<string>, windowStart: string, windowEnd: string}}
   * @private
   */
  function getGoLivesExplorerUniverse_(cfg, viewModeOpts, productOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    var cacheKey = _goLivesExplorerUniverseCacheKey_(cfg, viewModeOpts, productOpts);

    if (!_cache.goLivesExplorerUniverseByKey) _cache.goLivesExplorerUniverseByKey = {};
    if (_cache.goLivesExplorerUniverseByKey[cacheKey]) {
      return _applyGoLiveExplorerOverrideLayer_(_cache.goLivesExplorerUniverseByKey[cacheKey], cfg);
    }

    var cached = _perfCacheRead_(cacheKey);
    if (cached !== null) {
      _cache.goLivesExplorerUniverseByKey[cacheKey] = cached;
      return _applyGoLiveExplorerOverrideLayer_(cached, cfg);
    }

    var win = _goLivesExplorerUniverseWindow_();
    var base = _fetchGoLivesExplorerBaseRows_(cfg, viewModeOpts, productOpts, win.startKey, win.endKey);
    var allRows = base.completed.concat(base.upcoming);
    allRows = applyDeploymentHealthPlansToRows_(allRows, cfg);
    var fiscalYears = _collectGoLivesExplorerFiscalYearsFromRows_(allRows);

    var universe = {
      rows: allRows,
      fiscalYears: fiscalYears,
      windowStart: win.startKey,
      windowEnd: win.endKey
    };
    _cache.goLivesExplorerUniverseByKey[cacheKey] = universe;
    _perfCacheWrite_(cacheKey, universe, cfg.appId);
    return _applyGoLiveExplorerOverrideLayer_(universe, cfg);
  }

  function _collectGoLivesExplorerFilterOptions_(rows, isProductMode) {
    var partners = {};
    var health = {};
    var regions = {};
    var productAreas = {};
    var ems = {};
    (rows || []).forEach(function (row) {
      var p = (row.partner || '').trim();
      if (p) partners[p] = true;
      var h = (row.health || '').trim();
      if (h) health[h] = true;
      var r = isProductMode ? (row.region || '').trim() : (row.region || row.industry || '').trim();
      if (r) regions[r] = true;
      if (row.productAreas && row.productAreas.length) {
        row.productAreas.forEach(function (pa) { if (pa) productAreas[pa] = true; });
      } else if (row.productArea) {
        productAreas[row.productArea] = true;
      }
      var em = (row.wdEngManager || '').trim();
      if (em) ems[em] = true;
    });
    function sorted_(obj) {
      return Object.keys(obj).sort();
    }
    return {
      partners: sorted_(partners),
      health: sorted_(health),
      regions: sorted_(regions),
      productAreas: sorted_(productAreas),
      engagementManagers: sorted_(ems)
    };
  }

  /**
   * @param {Object} row
   * @param {string} timelineMode 'upcoming'|'completed'|'combined'
   * @return {string}
   * @private
   */
  function _explorerRowTimelineDateKey_(row, timelineMode) {
    if (timelineMode === 'completed' && row.recordType === 'completed') {
      return _toDateKey_(row.goLiveDate || row.lastGoLiveDate);
    }
    if (timelineMode === 'upcoming' && row.recordType === 'upcoming') {
      return _toDateKey_(row.goLiveDate || row.nextGoLiveDate || row.mtpDate);
    }
    return _toDateKey_(row.goLiveDate || row.lastGoLiveDate || row.nextGoLiveDate || row.mtpDate);
  }

  /**
   * @param {Array<Object>} rows
   * @param {string} startKey
   * @param {string} endKey
   * @param {string} timelineMode
   * @param {string} todayKey
   * @return {Array<Object>}
   * @private
   */
  function _computeGoLivesExplorerTimeline_(rows, startKey, endKey, timelineMode, todayKey) {
    var tz = Session.getScriptTimeZone();
    var buckets = {};
    (rows || []).forEach(function (row) {
      var dk = _explorerRowTimelineDateKey_(row, timelineMode);
      if (!dk || !_dateKeyInRange_(dk, startKey, endKey)) return;
      var monthKey = dk.slice(0, 7);
      buckets[monthKey] = (buckets[monthKey] || 0) + 1;
    });

    var months = [];
    var cursor = new Date(startKey);
    var endD = new Date(endKey);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    var guard = 0;
    while (cursor <= endD && guard < 12) {
      var mk = Utilities.formatDate(cursor, tz, 'yyyy-MM');
      var monthStart = Utilities.formatDate(cursor, tz, 'yyyy-MM-dd');
      var monthEnd = Utilities.formatDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), tz, 'yyyy-MM-dd');
      var label = Utilities.formatDate(cursor, tz, 'MMM');
      var isCurrent = todayKey >= monthStart && todayKey <= monthEnd;
      var isFuture = monthStart > todayKey;
      months.push({
        monthKey: mk,
        label: label,
        count: buckets[mk] || 0,
        isCurrent: isCurrent,
        isFuture: isFuture
      });
      cursor.setMonth(cursor.getMonth() + 1);
      guard++;
    }
    return months;
  }

  /**
   * @param {Array<Object>} rows
   * @param {Object} filterState
   * @param {string} periodLabel
   * @param {boolean} searchActive
   * @param {AppConfig} cfg
   * @param {string} todayKey
   * @return {Object}
   * @private
   */
  function _computeGoLivesExplorerKpiSummary_(rows, effectiveGoLiveType, periodLabel, searchActive, cfg, todayKey) {
    var workdayPartner = (cfg.report && cfg.report.portfolioHealth && cfg.report.portfolioHealth.workdayPartner) ||
      'Workday Professional Services';
    var goLiveType = (effectiveGoLiveType || 'upcoming').toLowerCase();
    var completed = rows.filter(function (r) { return r.recordType === 'completed'; });
    var upcoming = rows.filter(function (r) { return r.recordType === 'upcoming'; });
    var atRisk = upcoming.filter(function (r) {
      return r.health === 'Red' || r.health === 'Yellow';
    });
    var next30End = _addDaysToKey_(todayKey, 30);
    var next30 = upcoming.filter(function (r) {
      var dk = _toDateKey_(r.goLiveDate || r.nextGoLiveDate || r.mtpDate);
      return dk && _dateKeyInRange_(dk, todayKey, next30End);
    });
    var openHp = upcoming.filter(function (r) { return !!r.hasHealthPlan; });
    var wdLed = completed.filter(function (r) { return (r.partner || '').trim() === workdayPartner; });
    var partnerLed = completed.filter(function (r) {
      var p = (r.partner || '').trim();
      return p && p !== workdayPartner;
    });
    var completedHp = completed.filter(function (r) { return !!r.hasHealthPlan; });

    var cards = [];
    var contextLine = '';

    if (searchActive) {
      contextLine = 'Summary reflects search results across all go-live types in the selected time period.';
      var total = rows.length;
      cards = [
        { label: 'Matching Records', count: total, percent: _formatExplorerPercent_(total, total), subtext: periodLabel, risk: false },
        { label: 'Completed', count: completed.length, percent: _formatExplorerPercent_(completed.length, total), subtext: 'Actual go-lives', risk: false },
        { label: 'Upcoming', count: upcoming.length, percent: _formatExplorerPercent_(upcoming.length, total), subtext: 'Target/current dates', risk: false },
        { label: 'At-Risk Upcoming', count: atRisk.length, percent: _formatExplorerPercent_(atRisk.length, upcoming.length), subtext: 'Red/Yellow of upcoming', risk: true }
      ];
    } else if (goLiveType === 'all') {
      contextLine = 'Summary reflects all go-live records in the selected time period and filters.';
      var allTotal = rows.length;
      cards = [
        { label: 'Total Go-Live Records', count: allTotal, percent: _formatExplorerPercent_(allTotal, allTotal), subtext: periodLabel, risk: false },
        { label: 'Completed', count: completed.length, percent: _formatExplorerPercent_(completed.length, allTotal), subtext: 'Actual go-lives', risk: false },
        { label: 'Upcoming', count: upcoming.length, percent: _formatExplorerPercent_(upcoming.length, allTotal), subtext: 'Target/current dates', risk: false },
        { label: 'At-Risk Upcoming', count: atRisk.length, percent: _formatExplorerPercent_(atRisk.length, upcoming.length), subtext: 'Red/Yellow of upcoming', risk: true }
      ];
    } else if (goLiveType === 'upcoming') {
      contextLine = 'Summary reflects upcoming go-lives in the selected time period and filters.';
      var upTotal = upcoming.length;
      cards = [
        { label: 'Upcoming Go-Lives', count: upTotal, percent: _formatExplorerPercent_(upTotal, upTotal), subtext: periodLabel, risk: false },
        { label: 'Next 30 Days', count: next30.length, percent: _formatExplorerPercent_(next30.length, upTotal), subtext: 'Near-term', risk: false },
        { label: 'At-Risk Upcoming', count: atRisk.length, percent: _formatExplorerPercent_(atRisk.length, upTotal), subtext: 'Red/Yellow', risk: true },
        { label: 'Open Health Plans', count: openHp.length, percent: _formatExplorerPercent_(openHp.length, upTotal), subtext: 'Active plans', risk: false }
      ];
    } else {
      contextLine = 'Summary reflects completed go-lives in the selected time period and filters.';
      var compTotal = completed.length;
      cards = [
        { label: 'Completed Go-Lives', count: compTotal, percent: _formatExplorerPercent_(compTotal, compTotal), subtext: periodLabel, risk: false },
        { label: 'Workday-Led', count: wdLed.length, percent: _formatExplorerPercent_(wdLed.length, compTotal), subtext: 'Delivery ownership', risk: false },
        { label: 'Partner-Led', count: partnerLed.length, percent: _formatExplorerPercent_(partnerLed.length, compTotal), subtext: 'Delivery ownership', risk: false },
        { label: 'With Health Plans', count: completedHp.length, percent: _formatExplorerPercent_(completedHp.length, compTotal), subtext: 'Post go-live', risk: false }
      ];
    }

    return { contextLine: contextLine, cards: cards };
  }

  /**
   * Sorts explorer rows by date (and account name tie-break).
   * @param {Array<Object>} rows
   * @param {string} sortField
   * @param {string} sortDirection
   * @return {Array<Object>}
   * @private
   */
  function _sortGoLivesExplorerRows_(rows, sortField, sortDirection) {
    var asc = (sortDirection || 'asc').toLowerCase() === 'asc';
    var field = sortField || 'goLiveDate';
    rows.sort(function (a, b) {
      var da = _toDateKey_(a[field] || a.goLiveDate);
      var db = _toDateKey_(b[field] || b.goLiveDate);
      var ta = da ? new Date(da).getTime() : NaN;
      var tb = db ? new Date(db).getTime() : NaN;
      var aInv = !da || isNaN(ta);
      var bInv = !db || isNaN(tb);
      if (aInv && bInv) return String(a.accountName || '').localeCompare(String(b.accountName || ''));
      if (aInv) return 1;
      if (bInv) return -1;
      if (ta < tb) return asc ? -1 : 1;
      if (ta > tb) return asc ? 1 : -1;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });
    return rows;
  }

  /**
   * Bounded Go-Live Explorer payload for the web UI.
   *
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {Object=} filterState
   * @return {Object}
   */
  function getGoLivesExplorerData(config, viewModeOpts, productOpts, filterState) {
    var totalStart = Date.now();
    var cfg = CoreConfig.withDefaults(config);
    filterState = filterState || {};
    var includeFilterOptions = filterState.includeFilterOptions !== false;
    var period = _resolveGoLivesExplorerPeriod_(filterState, cfg);
    if (!period.valid) {
      return {
        valid: false,
        error: period.error,
        rows: [],
        totalCount: 0,
        kpiSummary: { contextLine: '', cards: [] },
        timeline: [],
        filterOptions: { partners: [], health: [], regions: [], productAreas: [], engagementManagers: [], fiscalYears: [] },
        periodLabel: '',
        searchActive: false,
        effectiveGoLiveType: '',
        resolvedPeriodStart: '',
        resolvedPeriodEnd: '',
        periodPosition: 'mixed'
      };
    }

    var tz = Session.getScriptTimeZone();
    var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var periodPosition = _resolveGoLivesPeriodPosition_(period.startKey, period.endKey, todayKey);
    var effectiveGoLiveType = _normalizeGoLivesTypeForPeriod_(
      filterState.goLiveType, periodPosition, cfg, filterState.timePeriod);

    var universeStart = Date.now();
    var universe = getGoLivesExplorerUniverse_(cfg, viewModeOpts, productOpts);
    var universeMs = Date.now() - universeStart;

    var periodStart = Date.now();
    var isPM = usesProductModePfGoLiveSource_(cfg);
    var periodRows = _filterGoLivesExplorerRowsByPeriod_(universe.rows, period.startKey, period.endKey);
    var periodMs = Date.now() - periodStart;

    var filtersStart = Date.now();
    var searchTerm = _normalizeExplorerFilterValue_(filterState.searchTerm);
    var searchActive = !!searchTerm;
    var goLiveType = effectiveGoLiveType;

    var filtered = periodRows.filter(function (row) {
      if (!_goLivesExplorerRowMatchesAdvancedFilters_(row, filterState, isPM)) return false;
      if (searchActive) {
        return _goLivesExplorerRowMatchesSearch_(row, searchTerm, isPM);
      }
      if (goLiveType === 'all') return true;
      if (goLiveType === 'completed') return row.recordType === 'completed';
      if (goLiveType === 'upcoming') return row.recordType === 'upcoming';
      return true;
    });
    var filtersMs = Date.now() - filtersStart;

    var kpisStart = Date.now();
    var kpiSummary = _computeGoLivesExplorerKpiSummary_(
      filtered, effectiveGoLiveType, period.periodLabel, searchActive, cfg, todayKey);
    var kpisMs = Date.now() - kpisStart;

    var timelineStart = Date.now();
    var timelineMode = searchActive ? 'combined' : goLiveType;
    if (timelineMode === 'completed') timelineMode = 'completed';
    else if (timelineMode === 'upcoming') timelineMode = 'upcoming';
    else timelineMode = 'combined';
    var timeline = _computeGoLivesExplorerTimeline_(
      filtered, period.startKey, period.endKey, timelineMode, todayKey);
    var timelineMs = Date.now() - timelineStart;

    var optionsStart = Date.now();
    var filterOptions = { partners: [], health: [], regions: [], productAreas: [], engagementManagers: [], fiscalYears: [] };
    if (includeFilterOptions) {
      filterOptions = _collectGoLivesExplorerFilterOptions_(periodRows, isPM);
      filterOptions.fiscalYears = universe.fiscalYears || [];
    }
    var optionsMs = Date.now() - optionsStart;

    var sortStart = Date.now();
    filtered = _sortGoLivesExplorerRows_(filtered, filterState.sortField, filterState.sortDirection);
    var searchCap = (cfg.ui.goLivesTab && cfg.ui.goLivesTab.searchResultCap) || 250;
    var totalCount = filtered.length;
    if (searchActive && filtered.length > searchCap) {
      filtered = filtered.slice(0, searchCap);
    }
    var sortMs = Date.now() - sortStart;
    var totalMs = Date.now() - totalStart;

    Logger.log('CoreData.getGoLivesExplorerData timings: universe=' + (universeMs / 1000).toFixed(1) + 's, ' +
               'period=' + (periodMs / 1000).toFixed(1) + 's, filters=' + (filtersMs / 1000).toFixed(1) + 's, ' +
               'kpis=' + (kpisMs / 1000).toFixed(1) + 's, timeline=' + (timelineMs / 1000).toFixed(1) + 's, ' +
               'options=' + (optionsMs / 1000).toFixed(1) + 's, sort=' + (sortMs / 1000).toFixed(1) + 's, ' +
               'total=' + (totalMs / 1000).toFixed(1) + 's (' + filtered.length + '/' + totalCount +
               ' rows, universe=' + (universe.rows ? universe.rows.length : 0) +
               ', period=' + periodRows.length + ', type=' + effectiveGoLiveType +
               ', search=' + searchActive + ', options=' + includeFilterOptions + ')');

    return {
      valid: true,
      error: '',
      rows: filtered,
      totalCount: totalCount,
      kpiSummary: kpiSummary,
      timeline: timeline,
      filterOptions: filterOptions,
      periodLabel: period.periodLabel,
      searchActive: searchActive,
      effectiveGoLiveType: effectiveGoLiveType,
      resolvedPeriodStart: period.startKey,
      resolvedPeriodEnd: period.endKey,
      periodPosition: periodPosition
    };
  }

  /**
   * Diagnostic: cold vs warm getGoLivesExplorerData timings for the same filter state.
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {Object=} filterState
   * @return {Object}
   */
  function _debugGoLivesExplorerPerformance(config, viewModeOpts, productOpts, filterState) {
    var cfg = CoreConfig.withDefaults(config);
    filterState = filterState || { timePeriod: 'next90', goLiveType: 'upcoming' };
    _cache.goLivesExplorerUniverseByKey = {};
    var coldStart = Date.now();
    var cold = getGoLivesExplorerData(cfg, viewModeOpts, productOpts, filterState);
    var coldMs = Date.now() - coldStart;
    var warmStart = Date.now();
    var warm = getGoLivesExplorerData(cfg, viewModeOpts, productOpts, filterState);
    var warmMs = Date.now() - warmStart;
    var cacheKey = _goLivesExplorerUniverseCacheKey_(cfg, viewModeOpts, productOpts);
    return {
      appId: cfg.appId,
      cacheKey: cacheKey,
      coldMs: coldMs,
      warmMs: warmMs,
      coldRowCount: cold.totalCount,
      warmRowCount: warm.totalCount,
      universeRowCount: (_cache.goLivesExplorerUniverseByKey[cacheKey] || {}).rows
        ? _cache.goLivesExplorerUniverseByKey[cacheKey].rows.length : 0
    };
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
    getNotableEligibleDeployments:       getNotableEligibleDeployments,
    debugNotableEligibleResolutionByShortId: debugNotableEligibleResolutionByShortId,
    getActiveCountDeployments:           getActiveCountDeployments,
    buildOverrideFootnote_:                buildOverrideFootnote_,
    buildOverrideImpactContext_:           buildOverrideImpactContext_,
    rowHasEffectiveOperationalOverride_:   rowHasEffectiveOperationalOverride_,
    getProductModeCanonicalDeployments:  getProductModeCanonicalDeployments,
    getProductModeTrendsDeployments:     getProductModeTrendsDeployments,
    _debugProductModeCanonicalUnionCounts: _debugProductModeCanonicalUnionCounts,
    getDeploymentGroupingValue:          getDeploymentGroupingValue,
    _validateEffectiveDeployments:       _validateEffectiveDeployments,
    _validateProductModeActiveDeploymentsUnion: _validateProductModeActiveDeploymentsUnion,
    _debugProductModeActiveDeploymentsUnion: _debugProductModeActiveDeploymentsUnion,
    _debugProductModeDeploymentDisplayGrain: _debugProductModeDeploymentDisplayGrain,
    _debugProductModeCounts:             _debugProductModeCounts,
    _debugProductModeGoLiveEvents: _debugProductModeGoLiveEvents,
    formatShortDateForDebug_: formatShortDateForDebug_,
    debugCalendarDateKeyNormalization_: debugCalendarDateKeyNormalization_,
    debugUpcomingGoLiveReportRowSource_: debugUpcomingGoLiveReportRowSource_,
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
    clearSingleOverride:         clearSingleOverride,

    // Phase 3f addition
    getDeploymentAuditSummary:   getDeploymentAuditSummary,

    // Phase 3i additions
    getRecentGoLives:            getRecentGoLives,
    getGoLivesExplorerData:      getGoLivesExplorerData,
    _debugGoLivesExplorerPerformance: _debugGoLivesExplorerPerformance,

    getRecentGoLivesForNotablePicker: getRecentGoLivesForNotablePicker,

    // MDS / PGL redesign (2026-06) — replaces getUpcomingSurveys
    getMdsPglBatchView:          getMdsPglBatchView,
    _debugMdsPglBatchView:       _debugMdsPglBatchView_,
    _debugMdsPglExceptions:      _debugMdsPglExceptions_,
    debugMdsPglRowsForUI:        debugMdsPglRowsForUI,
    debugDdDigestAssignmentsForUI: debugDdDigestAssignmentsForUI,
    filterMdsPglRowsForDdDigestPartner: filterMdsPglRowsForDdDigestPartner,
    matchesDdDigestPartnerFilter: matchesDdDigestPartnerFilter,

    // V2.8: CSAT in-flight surveys + unified tab payload
    ingestCsatInFlight:          ingestCsatInFlight,
    uploadCsatInFlightCsvForUI:  uploadCsatInFlightCsvForUI,
    getCsatTabDataForUI:         getCsatTabDataForUI,
    getDistributionLogDataForUI: getDistributionLogDataForUI,

    // Overview Snapshot (C11b)
    getOverviewSnapshot:         getOverviewSnapshot,
    debugOverviewVsDeploymentsCountsForUI: debugOverviewVsDeploymentsCountsForUI,
    debugOverviewOverrideContextForUI:   debugOverviewOverrideContextForUI,
    _debugOverviewSnapshot:      _debugOverviewSnapshot_,

    // Performance Layer 2 additions
    flushAppCaches:              flushAppCaches,
    _warmSfdcRows:               _warmSfdcRows,
    _getCachedSfdcRowCount:      _getCachedSfdcRowCount,
    _dataVersion:                _dataVersion,
    getDataFreshness:            getDataFreshness,
    checkDataFreshnessAndAlert_: checkDataFreshnessAndAlert_,

    // D1 diagnostic
    _debugDdFromContacts_:       _debugDdFromContacts_,
    _debugDeploymentHealthPlan:  _debugDeploymentHealthPlan,
    debugTraceDeploymentInUiPipeline: debugTraceDeploymentInUiPipeline,
    _debugWellnessData:          _debugWellnessData,

    // S1: Student data layer
    filterDeploymentsByStudent_: filterDeploymentsByStudent_,
    filterDeploymentsByProduct_: filterDeploymentsByProduct_,
    filterRowsByReportProductScope_: filterRowsByReportProductScope_,
    filterRowsExcludedFromReport_: filterRowsExcludedFromReport_,
    buildStudentTabData_:        buildStudentTabData_,
    saveStudentDeploymentFields: saveStudentDeploymentFields,
    debugHenpStudentMtpDateTraceForUI: debugHenpStudentMtpDateTraceForUI,
    debugHenpStudentRowForUI:          debugHenpStudentRowForUI,

    // N7: MDS/PGL notifications (delegates to CoreNotify)
    getDeploymentContactsMap_:   getDeploymentContactsMap_,
    runNotifications:            function (c) { return CoreNotify.runNotifications(c); },
    validateNotificationConfig:  function (c) { return CoreNotify.validateNotificationConfig(c); },
    sendTestNotification:        function (c, k, r) { return CoreNotify.sendTestNotification(c, k, r); },
    initNotificationConfigSheet: function (c) { return CoreNotify.initNotificationConfigSheet(c); },
    getNotificationKeysForMenu:  function (c) { return CoreNotify.getNotificationKeysForMenu(c); }
  };
})();

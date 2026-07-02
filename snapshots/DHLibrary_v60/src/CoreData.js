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
    metaMap: null,            // result of getDeploymentsMetaMap_
    overridesMap: null,       // result of getDeploymentOverridesMap_
    goLivesOverridesMap: null, // result of getGoLivesOverridesMap_
    mdsPglBatchView: {},       // { '<windowMonths>': payload } — tier 1 for getMdsPglBatchView
    overviewSnapshot: null     // tier 1 for getOverviewSnapshot
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
    _cache.metaMap = null;
    _cache.overridesMap = null;
    _cache.goLivesOverridesMap = null;
    _cache.mdsPglBatchView = {};
    _cache.overviewSnapshot = null;
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
      readSfdcDeploymentsRaw_(cfg);
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
  // PERFORMANCE LAYER 2: SHEET-TAB CACHE (cross-execution persistence)
  // ---------------------------------------------------------------------------
  // Stores computed values in a per-app _PerfCache sheet so they survive
  // across Apps Script executions. 5-minute TTL. Cleared on writes via
  // _clearCache(cfg). Reads check tier 1 (in-memory) -> tier 2 (sheet) ->
  // tier 3 (live recompute). Sheet name is _PerfCache; each row is a key,
  // a JSON blob, and a timestamp.
  // ===========================================================================

  var _PERF_CACHE_SHEET = '_PerfCache';
  var _PERF_CACHE_TTL_SEC = 300; // 5 minutes

  /**
   * Returns the active spreadsheet's _PerfCache sheet, creating it if missing.
   * @return {Sheet}
   * @private
   */
  function _getPerfCacheSheet_() {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(_PERF_CACHE_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(_PERF_CACHE_SHEET);
      sheet.getRange(1, 1, 1, 3).setValues([['Key', 'ValueJson', 'Timestamp']]);
      sheet.setFrozenRows(1);
      sheet.hideSheet(); // keep clutter out of the user's view
    }
    return sheet;
  }

  /**
   * Reads a value from the sheet-tab cache. Returns null if missing or stale.
   * @param {string} key
   * @return {*} the parsed JSON value or null
   * @private
   */
    // Layer 2.5: chunk size = 45000 chars (under 50k cell limit with safety margin).
    var _PERF_CACHE_CHUNK_SIZE = 45000;

    function _perfCacheRead_(key) {
      try {
        var sheet = _getPerfCacheSheet_();
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) return null;
        var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  
        // Collect any matching rows: either a single-row entry (key matches exactly)
        // or chunk entries (key starts with "<key>:chunk:<idx>").
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
        if (!tsMs || Date.now() - tsMs > _PERF_CACHE_TTL_SEC * 1000) {
          return null; // stale or no rows found
        }
  
        // Single-row entry path: defensively parse, return null on any error.
        if (single !== null && chunks.length === 0) {
          if (!single) return null;
          try {
            return JSON.parse(single);
          } catch (parseErr) {
            Logger.log('CoreData._perfCacheRead_: malformed single-row JSON for key=' + key +
                       '; treating as cache miss. Error: ' + parseErr);
            return null;
          }
        }
  
        // Chunked entry path.
        if (chunks.length > 0) {
          chunks.sort(function (a, b) { return a.idx - b.idx; });
          // Validate chunks are contiguous (no gaps from idx 0 to N-1).
          for (var ci = 0; ci < chunks.length; ci++) {
            if (chunks[ci].idx !== ci) {
              Logger.log('CoreData._perfCacheRead_: chunk gap at idx ' + ci +
                         ' for key=' + key + '; treating as cache miss.');
              return null;
            }
          }
          var combined = chunks.map(function (c) { return c.data; }).join('');
          if (!combined) return null;
          try {
            return JSON.parse(combined);
          } catch (parseErr) {
            Logger.log('CoreData._perfCacheRead_: malformed reassembled JSON for key=' + key +
                       '; treating as cache miss. Error: ' + parseErr);
            return null;
          }
        }
  
        return null;
      } catch (err) {
        Logger.log('CoreData._perfCacheRead_: ' + err);
        return null;
      }
    }

  /**
   * Writes a value to the sheet-tab cache. Overwrites any existing row with
   * the same key. Best-effort: failures are logged but never throw.
   * @param {string} key
   * @param {*} value any JSON-serializable value
   * @private
   */
    // Layer 2.5: chunk size = 45000 chars (under 50k cell limit with safety margin).
    var _PERF_CACHE_CHUNK_SIZE = 45000;

    function _perfCacheWrite_(key, value) {
      try {
        var sheet = _getPerfCacheSheet_();
        var json = JSON.stringify(value);
        var now = new Date();
  
        // First, delete any existing rows for this key (both single and chunked).
        _perfCacheDeleteKey_(sheet, key);
  
        // If the JSON fits in one cell, write as a single row.
        if (json.length <= _PERF_CACHE_CHUNK_SIZE) {
          sheet.appendRow([key, json, now]);
          return;
        }
  
        // Otherwise, chunk it. Each chunk gets its own row keyed as <key>:chunk:<idx>.
        var chunkCount = Math.ceil(json.length / _PERF_CACHE_CHUNK_SIZE);
        var rows = [];
        for (var i = 0; i < chunkCount; i++) {
          var start = i * _PERF_CACHE_CHUNK_SIZE;
          var chunk = json.substring(start, start + _PERF_CACHE_CHUNK_SIZE);
          rows.push([key + ':chunk:' + i, chunk, now]);
        }
        // Append all chunks in one batch write.
        var firstRow = sheet.getLastRow() + 1;
        var targetRow = firstRow + rows.length - 1;
        if (targetRow > sheet.getMaxRows()) {
          sheet.insertRowsAfter(
            sheet.getMaxRows(),
            targetRow - sheet.getMaxRows() + 50
          );
        }
        sheet.getRange(firstRow, 1, rows.length, 3).setValues(rows);
        Logger.log('CoreData._perfCacheWrite_: chunked key=' + key + ' into ' + chunkCount + ' rows.');
      } catch (err) {
        Logger.log('CoreData._perfCacheWrite_: failed for key=' + key + ': ' + err);
      }
    }
  
    /**
     * Removes all rows from the cache sheet matching the given key (whether
     * single-row or chunked across multiple rows).
     * @private
     */
    function _perfCacheDeleteKey_(sheet, key) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      var chunkPrefix = key + ':chunk:';
      // Iterate bottom-to-top so deletes don't shift indices.
      for (var i = keys.length - 1; i >= 0; i--) {
        var k = String(keys[i][0]);
        if (k === key || k.indexOf(chunkPrefix) === 0) {
          sheet.deleteRow(i + 2);
        }
      }
    }

  /**
   * Removes all rows from the cache sheet matching the given key (whether
   * single-row or chunked across multiple rows).
   * @private
   */
  function _perfCacheDeleteKey_(sheet, key) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var chunkPrefix = key + ':chunk:';
    // Iterate bottom-to-top so deletes don't shift indices.
    for (var i = keys.length - 1; i >= 0; i--) {
      var k = String(keys[i][0]);
      if (k === key || k.indexOf(chunkPrefix) === 0) {
        sheet.deleteRow(i + 2);
      }
    }
  }

  /**
   * Removes all rows from the sheet-tab cache. Called by _clearCache(cfg)
   * when a mutation invalidates the data.
   * @private
   */
  function _perfCacheClearAll_() {
    try {
      var sheet = _getPerfCacheSheet_();
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      sheet.deleteRows(2, lastRow - 1);
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
        exclude:               idxExclude  >= 0 ? Boolean(row[idxExclude]) : false,
        lastEditedBy:          idxUser     >= 0 ? (row[idxUser] || '') : '',
        lastEditedAt:          (idxTime    >= 0 && row[idxTime]) ? CoreUtils.formatDateToIsoString(row[idxTime]) : '',
        classification:        normalizeClassification_(idxClass >= 0 ? row[idxClass] : '')
      };
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
        exclude:         idxExclude >= 0 ? Boolean(row[idxExclude]) : false,
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

  function getAllEffectiveDeploymentsLegacy_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.activeDeployments);
    if (!sheet) {
      throw new Error('ActiveDeployments sheet not found: ' + cfg.sheets.activeDeployments);
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var metaMap = getDeploymentsMetaMap_(cfg);
    var overridesMap = getDeploymentOverridesMap_(cfg);

    var cols = cfg.columns.deployments;
    var lastCol = sheet.getLastColumn();
    var usedCols = Math.max(lastCol, cols.DEPLOYMENT_ID);
    var dataRange = sheet.getRange(2, 1, lastRow - 1, usedCols);
    var values = dataRange.getValues();

    // Phase 3b: honour DEPLOYMENT_PHASE as a fallback when SERVICES_APPROACH is
    // not defined in the app's column config (e.g. SLG uses DEPLOYMENT_PHASE).
    var approachColNum = cols.SERVICES_APPROACH || cols.DEPLOYMENT_PHASE;

    var raw = values.map(function (row, index) {
      var deploymentId = String(row[cols.DEPLOYMENT_ID - 1] || '').trim();
      var meta = metaMap[deploymentId] || {};
      return {
        rowIndex:         index + 2,
        deploymentId:     deploymentId,
        accountName:      String(row[cols.ACCOUNT_NAME - 1] || ''),
        deploymentName:   String(row[cols.DEPLOYMENT_NAME - 1] || ''),
        servicesApproach: approachColNum ? String(row[approachColNum - 1] || '') : '',
        industry:         String(row[cols.INDUSTRY - 1] || ''),
        subRegion:        String(row[cols.SUB_REGION - 1] || ''),
        partner:          String(row[cols.PARTNER - 1] || ''),
        stage:            String(row[cols.DEPLOYMENT_STAGE - 1] || ''),
        health:           String(row[cols.DEPLOYMENT_HEALTH - 1] || ''),
        mtpDate:          row[cols.CURRENT_MTP_DATE - 1] ? CoreUtils.formatDateToIsoString(row[cols.CURRENT_MTP_DATE - 1]) : '',
        dam:              String(row[cols.DAM_FULL_NAME - 1] || ''),
        wdEngManager:     String(row[cols.WD_ENG_MANAGER - 1] || ''),
        currentUpdate:    String(row[cols.CURRENT_DEPLOYMENT_UPDATE - 1] || ''),
        deliveryDirector: meta.deliveryDirector || '',
        ddNotes:          meta.ddNotes || '',
        metaUsername:     meta.username || '',
        metaTimestamp:    meta.timestamp || ''
      };
    });

    return raw
      .map(function (r) { return buildEffectiveDeploymentRow_(r, overridesMap); })
      .filter(function (r) {
        if (!r || !r.deploymentId) return false;
        return !!(r.accountName || r.deploymentName);
      });
  }

  /**
   * Phase 3j: SFDC-based effective deployments builder.
   * Reads SFDC_Deployments (Active only), applies meta + overrides.
   * Returns the same row shape as the legacy ActiveDeployments builder.
   *
   * Callers should not invoke this directly; use getAllEffectiveDeployments(),
   * which handles fallback to the legacy reader.
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
   * Phase 3j: Canonical effective deployments view.
   *
   * Behavior:
   * 1. Try SFDC_Deployments (with meta + overrides).
   * 2. If SFDC returns empty or throws, fall back to legacy ActiveDeployments.
   *
   * @param {AppConfig} config
   * @return {Array<Object>}
   */
  function getAllEffectiveDeployments(config) {
    var cfg = CoreConfig.withDefaults(config);
    var effective = [];
    try {
      effective = buildEffectiveDeploymentsFromSfdc_(cfg);
    } catch (err) {
      Logger.log('CoreData.getAllEffectiveDeployments: SFDC path threw, falling back. Error: ' + err);
      effective = [];
    }
    if (!effective || !effective.length) {
      try {
        effective = getAllEffectiveDeploymentsLegacy_(cfg);
      } catch (err) {
        Logger.log('CoreData.getAllEffectiveDeployments: legacy fallback also failed: ' + err);
        effective = [];
      }
    }

    // D1: attach ddContacts and ddFromContacts to each effective row.
    var _ddMap = {};
    try {
      _ddMap = getDdAssignmentsFromContacts_(cfg) || {};
    } catch (e) {
      Logger.log('CoreData.getAllEffectiveDeployments: getDdAssignmentsFromContacts_ failed: ' + e);
    }
    for (var _di = 0; _di < effective.length; _di++) {
      var _dr = effective[_di];
      var _dc = (_ddMap[_dr.deploymentId] || []);
      _dr.ddContacts = _dc;
      _dr.ddFromContacts = _dc.length === 0 ? null
        : _dc.length === 1 ? (_dc[0].name || _dc[0].email)
        : _dc.map(function (c) { return c.name || c.email; }).filter(Boolean).join(', ');
    }

    return effective;
  }

  /**
   * Phase 3j diagnostic: compare SFDC-based and legacy effective views.
   * Logs counts and sample mismatches.
   *
   * @param {AppConfig} config
   * @param {number=} sampleLimit Number of mismatched rows to log per side (default 20).
   * @return {{ sfdcCount:number, legacyCount:number, onlyInSfdc:number, onlyInLegacy:number }}
   */
  function _validateEffectiveDeployments(config, sampleLimit) {
    var cfg = CoreConfig.withDefaults(config);
    var limit = sampleLimit || 20;

    var sfdcRows = [];
    try { sfdcRows = buildEffectiveDeploymentsFromSfdc_(cfg) || []; }
    catch (err) { Logger.log('SFDC path threw: ' + err); }

    var legacyRows = [];
    try { legacyRows = getAllEffectiveDeploymentsLegacy_(cfg) || []; }
    catch (err) { Logger.log('Legacy path threw: ' + err); }

    var toKey = function (r) {
      var id = String(r.deploymentId || '').trim();
      return id.length >= 15 ? id.slice(0, 15) : id;
    };

    var sfdcMap = {};
    sfdcRows.forEach(function (r) { var k = toKey(r); if (k) sfdcMap[k] = r; });
    var legacyMap = {};
    legacyRows.forEach(function (r) { var k = toKey(r); if (k) legacyMap[k] = r; });

    var onlyInSfdc = [];
    Object.keys(sfdcMap).forEach(function (k) {
      if (!legacyMap[k]) onlyInSfdc.push(sfdcMap[k]);
    });
    var onlyInLegacy = [];
    Object.keys(legacyMap).forEach(function (k) {
      if (!sfdcMap[k]) onlyInLegacy.push(legacyMap[k]);
    });

    Logger.log('=== _validateEffectiveDeployments(' + (cfg.appId || '?') + ') ===');
    Logger.log('  sfdcCount=' + sfdcRows.length +
               ', legacyCount=' + legacyRows.length +
               ', onlyInSfdc=' + onlyInSfdc.length +
               ', onlyInLegacy=' + onlyInLegacy.length);

    var healthOf = function (rows) {
      var c = { Green: 0, Yellow: 0, Red: 0, Other: 0 };
      rows.forEach(function (r) {
        var h = String(r.health || '').trim();
        if (c[h] !== undefined) c[h]++; else c.Other++;
      });
      return c;
    };
    Logger.log('  SFDC   health: ' + JSON.stringify(healthOf(sfdcRows)));
    Logger.log('  Legacy health: ' + JSON.stringify(healthOf(legacyRows)));

    onlyInSfdc.slice(0, limit).forEach(function (r, i) {
      Logger.log('  onlyInSfdc[' + i + ']: ' + (r.accountName || '') +
                 ' [' + r.deploymentId + '] ' + (r.deploymentName || '') +
                 ' (' + (r.health || '') + ')');
    });
    onlyInLegacy.slice(0, limit).forEach(function (r, i) {
      Logger.log('  onlyInLegacy[' + i + ']: ' + (r.accountName || '') +
                 ' [' + r.deploymentId + '] ' + (r.deploymentName || '') +
                 ' (' + (r.health || '') + ')');
    });

    return {
      sfdcCount: sfdcRows.length,
      legacyCount: legacyRows.length,
      onlyInSfdc: onlyInSfdc.length,
      onlyInLegacy: onlyInLegacy.length
    };
  }

  // ===========================================================================
  // WELLNESS MAP
  // ===========================================================================

  /**
   * Builds a map of accountId (15-char) → { cxLeaderName, executiveSummary }
   * from the SFDC_Wellness sheet. Returns {} if the sheet is absent or empty.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Object}
   * @private
   */
  function buildWellnessMap_(cfg) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(cfg.sheets.wellness || 'SFDC_Wellness');
      if (!sheet || sheet.getLastRow() < 2) return {};
      if (sheet.getLastColumn() === 0) return {};
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                                sheet.getLastColumn()).getValues();
      var map = {};
      rows.forEach(function(r) {
        var accountId = (r[1] || '').toString().slice(0, 15); // Account__c col 2
        if (!accountId) return;
        map[accountId] = {
          cxLeaderName:     (r[3] || '').toString(), // CX_Leader_Assignment__r.Name col 4
          executiveSummary: (r[4] || '').toString()  // Executive_Summary__c col 5
        };
      });
      return map;
    } catch(e) {
      Logger.log('buildWellnessMap_ error: ' + e);
      return {};
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
    var cacheKey = 'sfdcRows:' + (cfg && cfg.appId ? cfg.appId : 'default');
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
      rowObj.isExecutiveWatch = !!_wellness;
      rowObj.wellnessData     = _wellness;
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
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.activeDeployments);
    if (!sheet) return '';
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return '';
    var cols = cfg.columns.deployments;
    var idValues   = sheet.getRange(2, cols.DEPLOYMENT_ID, lastRow - 1, 1).getValues();
    var acctValues = sheet.getRange(2, cols.ACCOUNT_NAME,  lastRow - 1, 1).getValues();
    var target = String(deploymentId).trim();
    for (var i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0]).trim() === target) {
        return String(acctValues[i][0] || '');
      }
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

  function getActiveDeployments(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var allEffective = getAllEffectiveDeployments(cfg);

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
  function getAllDeployments(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);

    // Base effective view — includes SFDC-vs-legacy fallback, Active-only filter,
    // meta application, overrides application, and D1 ddContacts/ddFromContacts.
    var allEffective = getAllEffectiveDeployments(cfg);

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
      var enrichment = enrichmentMap[row.deploymentId];
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

  // ===========================================================================
  // PUBLIC: GO LIVES
  // ===========================================================================

  // DEPRECATED in Phase 3i. Reads from the legacy 'Go Lives' sheet which is no
  // longer being updated by the Salesforce Connector. Use getRecentGoLives()
  // for all new callers. This function is kept in place until the Go Lives sheet
  // is manually deleted by Jeff (post-validation per Phase 3i acceptance criteria).
  function getGoLives(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.goLives);
    if (!sheet) throw new Error('Go Lives sheet not found: ' + cfg.sheets.goLives);

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var dataRange = sheet.getRange(2, 1, lastRow - 1, 10);
    var values = dataRange.getValues();
    var cols = cfg.columns.goLives;

    var now = new Date();
    var windowDays = cfg.report.goLivesWindowDays;
    var windowStart = null;
    var windowEnd = null;
    if (windowDays && windowDays > 0) {
      windowEnd = now;
      windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    }

    var allGoLives = values
      .map(function (row, index) {
        var rawDate = row[cols.GO_LIVE_DATE_ACTUAL - 1];
        var dateObj = null;
        var dateString = '';
        if (rawDate) {
          dateObj = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
          if (!isNaN(dateObj.getTime())) {
            dateString = CoreUtils.formatDateToIsoString(dateObj);
          }
        }
        return {
          rowIndex:         index + 2,
          accountName:      String(row[cols.ACCOUNT_NAME - 1] || ''),
          industry:         String(row[cols.INDUSTRY - 1] || ''),
          dam:              String(row[cols.DAM_FULL_NAME - 1] || ''),
          wdEngManager:     String(row[cols.WD_ENG_MANAGER - 1] || ''),
          partner:          String(row[cols.PARTNER - 1] || ''),
          deploymentName:   String(row[cols.DEPLOYMENT_NAME - 1] || ''),
          approach:         String(row[cols.SERVICES_APPROACH - 1] || ''),
          productArea:      String(row[cols.PRODUCT_AREA - 1] || ''),
          dateObj:          dateObj,
          goLiveDateString: dateString,
          inProduction:     String(row[cols.IN_PRODUCTION - 1] || '')
        };
      })
      .filter(function (row) {
        if (!(row.accountName || row.deploymentName) || !row.dateObj) return false;
        if (isNaN(row.dateObj.getTime())) return false;
        if (windowStart && windowEnd) {
          return row.dateObj >= windowStart && row.dateObj <= windowEnd;
        }
        return true;
      });

    var groupedByAccount = {};
    allGoLives.forEach(function (row) {
      var key = row.accountName;
      if (!groupedByAccount[key]) {
        groupedByAccount[key] = {
          accountName:        row.accountName,
          industry:           row.industry,
          dam:                row.dam,
          wdEngManager:       row.wdEngManager,
          partner:            row.partner,
          deploymentName:     row.deploymentName,
          approach:           row.approach,
          productAreas:       [],
          earliestDate:       row.dateObj,
          earliestDateString: row.goLiveDateString,
          inProduction:       row.inProduction
        };
      }
      if (row.productArea && groupedByAccount[key].productAreas.indexOf(row.productArea) === -1) {
        groupedByAccount[key].productAreas.push(row.productArea);
      }
      if (row.dateObj && row.dateObj < groupedByAccount[key].earliestDate) {
        groupedByAccount[key].earliestDate = row.dateObj;
        groupedByAccount[key].earliestDateString = row.goLiveDateString;
      }
    });

    var overrides = getGoLivesOverridesMap_(cfg);
    var effective = Object.keys(groupedByAccount)
      .map(function (acct) {
        var row = groupedByAccount[acct];
        var ov = overrides[acct] || {};
        if (ov.exclude) return null;
        var effDate = ov.overrideDate
          ? CoreUtils.formatDateToIsoString(ov.overrideDate)
          : row.earliestDateString;
        return {
          accountName:       row.accountName,
          industry:          row.industry,
          dam:               row.dam,
          wdEngManager:      row.wdEngManager,
          partner:           ov.overridePartner || row.partner,
          deploymentName:    row.deploymentName,
          approach:          row.approach,
          productArea:       row.productAreas.join(', '),
          goLiveDate:        effDate,
          inProduction:      row.inProduction,
          excludeFromReport: !!ov.exclude,
          reviewUsername:    ov.lastEditedBy || '',
          reviewTimestamp:   ov.lastEditedAt || ''
        };
      })
      .filter(Boolean)
      .sort(function (a, b) { return new Date(a.goLiveDate) - new Date(b.goLiveDate); });

    return applyViewModeFilter_(cfg, effective, viewModeOpts);
  }

  /**
   * Phase 3a: Returns upcoming go-live rows for the 90-day window.
   *
   * Strategy:
   *   Pass 1 — deployments found in the CoreSalesforce enrichment map:
   *     One row per deployment, with upcomingDates[], isPhased, nextGoLiveDate.
   *   Pass 2 — fallback for deployments NOT in the enrichment map:
   *     Use Current_MTP_Date__c from ActiveDeployments (preserves Phase 1/2 behavior).
   *     upcomingDates = single-entry array, isPhased = false.
   *
   * GoLivesOverrides (exclusion + partner/date override) are applied in both passes.
   *
   * Backward-compatible output shape — adds new fields alongside existing ones:
   *   { ...existing..., deploymentId, upcomingDates[], isPhased, nextGoLiveDate }
   *   mtpDate is set to nextGoLiveDate for backward compatibility with callers
   *   that still use row.mtpDate.
   */
  function getUpcomingGoLives(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);

    // Get the effective view of all deployments (post-meta + post-overrides).
    var allEffective = getAllEffectiveDeployments(cfg);

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
        excludeFromReport: !!ov.exclude,
        reviewUsername:    ov.lastEditedBy || dep.reviewUsername || '',
        reviewTimestamp:   ov.lastEditedAt || dep.reviewTimestamp || ''
      });
    });

    // -----------------------------------------------------------------------
    // Pass 2: fallback — deployments not in the enrichment map,
    // using Current_MTP_Date__c from ActiveDeployments.
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
        excludeFromReport: !!ov.exclude,
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
   * @param {Object=}   viewModeOpts  Phase 2 viewMode options (same shape as getUpcomingGoLives).
   * @return {Array<Object>}
   */
  function getRecentGoLives(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);

    // Recent window: default 60 days (matches ui.goLivesTab.recentWindowDays).
    var recentWindowDays = (cfg.salesforce && cfg.salesforce.recentWindowDays) ||
                           (cfg.ui && cfg.ui.goLivesTab && cfg.ui.goLivesTab.recentWindowDays) ||
                           60;

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

      // --- Date-level window filter ---
      // Keep only Actual dates that fall within [windowStartKey, todayKey].
      var filteredRecentDates = allRecentDates.filter(function (rd) {
        return rd.date >= windowStartKey && rd.date <= todayKey;
      });

      // Fallback: if no product-function Actual dates landed in the window, try
      // the deployment-level First_Move_to_Production_Date_Actual__c field.
      if (filteredRecentDates.length === 0 && dep.firstMtpDateActual) {
        var fb = dep.firstMtpDateActual;
        if (fb >= windowStartKey && fb <= todayKey) {
          filteredRecentDates = [{ date: fb, products: [] }];
        }
      }

      // Skip deployments with no in-window dates.
      if (filteredRecentDates.length === 0) return;

      // lastGoLiveDate = max in-window date (not the all-time last Actual date).
      var lastGoLiveDate = filteredRecentDates.reduce(function (max, rd) {
        return rd.date > max ? rd.date : max;
      }, '');

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

    Logger.log('CoreData.getRecentGoLives: ' + results.length +
               ' deployments with in-window go-live dates (last ' +
               recentWindowDays + ' days, Active + Complete).');

    return applyViewModeFilter_(cfg, results, viewModeOpts);
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

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentOverrides);
    if (!sheet) throw new Error('DeploymentOverrides sheet not found: ' + cfg.sheets.deploymentOverrides);

    // Capture before-snapshot for audit
    var before = snapshotDeploymentOverride_(cfg, deploymentId);
    var accountName = lookupAccountForDeployment_(cfg, deploymentId);

    var values = sheet.getDataRange().getValues();
    var rowIndex = -1;
    if (values.length > 1) {
      var ids = values.slice(1).map(function (r) { return String(r[0] || '').trim(); });
      var idx = ids.indexOf(String(deploymentId).trim());
      if (idx >= 0) rowIndex = idx + 2;
    }
    if (rowIndex === -1) {
      var lastRow = sheet.getLastRow();
      rowIndex = (lastRow >= 1) ? lastRow + 1 : 2;
      sheet.getRange(rowIndex, 1).setValue(deploymentId);
    }

    var headers = values[0] || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var setCell = function (header, value) {
      var col = headers.indexOf(header);
      if (col >= 0 && value !== undefined) {
        sheet.getRange(rowIndex, col + 1).setValue(value);
      }
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
    var after = snapshotDeploymentOverride_(cfg, deploymentId);
    var changed = diffSnapshotFields_(before, after);
    writeAuditRow_(cfg, {
      action:           before.isEmpty ? 'CREATE' : 'UPDATE',
      overrideType:     'deployment',
      deploymentId:     deploymentId,
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

    var headers = values[0] || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var setCell = function (header, value) {
      var col = headers.indexOf(header);
      if (col >= 0 && value !== undefined) {
        sheet.getRange(rowIndex, col + 1).setValue(value);
      }
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
  function getAllActiveOverrides(config, viewModeOpts) {
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
   * Reads SFDC_DeploymentProductFunctions and returns flat rows with per-product
   * target and actual go-live dates. Used exclusively by getUpcomingSurveys.
   *
   * @param {AppConfig} cfg  Already-defaulted config.
   * @return {Array<Object>}  { deploymentFk, productArea, targetGoLive, actualGoLive }
   * @private
   */
  function readSfdcProductFunctionsRaw_(cfg) {
    var sheetName = cfg.sheets.sfdcDeploymentProductFunctions ||
                    'SFDC_DeploymentProductFunctions';
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log('CoreData.readSfdcProductFunctionsRaw_: sheet "' + sheetName + '" not found.');
      return [];
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

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

    // FK column: contains 'deployment' but no dot notation (not a traversal).
    var colFk = -1;
    for (var i = 0; i < lowerH.length; i++) {
      if (lowerH[i].indexOf('deployment') !== -1 && lowerH[i].indexOf('.') === -1) {
        colFk = i;
        break;
      }
    }
    if (colFk < 0) colFk = detect_(['deployment__c'], 5);

    var colProductArea  = detect_(['product_area'],                                                1);
    var colFunctionArea = detect_(['function__c', 'function'],                                     2);
    var colTargetGoLive = detect_(['production_move_date_target', 'move_date_target'],             3);
    var colActualGoLive = detect_(['production_move_date_actual', 'move_date_actual'],             4);

    var tz   = Session.getScriptTimeZone();
    var rows = [];

    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];
      var fk  = colFk >= 0 ? String(row[colFk] || '').trim() : '';
      if (!fk) continue;

      var productArea = colProductArea  >= 0 ? String(row[colProductArea]  || '').trim() : '';
      var funcArea    = colFunctionArea >= 0 ? String(row[colFunctionArea] || '').trim() : '';

      function cellDate_(col) {
        if (col < 0) return '';
        var raw = row[col];
        if (!raw) return '';
        var d = (raw instanceof Date) ? raw : new Date(raw);
        if (isNaN(d.getTime())) return '';
        return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      }

      rows.push({
        deploymentFk: fk,
        productArea:  productArea,
        funcArea:     funcArea,
        targetGoLive: cellDate_(colTargetGoLive),
        actualGoLive: cellDate_(colActualGoLive)
      });
    }

    Logger.log('CoreData.readSfdcProductFunctionsRaw_: ' + rows.length +
               ' product-function rows from "' + sheetName + '".');
    return rows;
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
  function getMdsPglBatchView(config, viewModeOpts, windowMonths) {
    var cfg = CoreConfig.withDefaults(config);
    var horizonMonths = (windowMonths === 6) ? 6 : 3;

    // Tier 1 cache check.
    var t1Key = String(horizonMonths);
    if (_cache.mdsPglBatchView[t1Key]) {
      Logger.log('CoreData.getMdsPglBatchView: tier 1 hit for window=' + horizonMonths);
      var cached1 = _cache.mdsPglBatchView[t1Key];
      return _applyViewModeFilterToPayload_(cfg, cached1, viewModeOpts, horizonMonths);
    }

    // Tier 2 (_PerfCache) check.
    var t2Key = 'mdsPglBatchView:' + cfg.appId + ':' + horizonMonths;
    var cached2 = _perfCacheRead_(t2Key);
    if (cached2) {
      Logger.log('CoreData.getMdsPglBatchView: tier 2 hit for window=' + horizonMonths);
      _cache.mdsPglBatchView[t1Key] = cached2;
      return _applyViewModeFilterToPayload_(cfg, cached2, viewModeOpts, horizonMonths);
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
      var rawRows = readSfdcDeploymentsRaw_(cfg);
      activeRows = rawRows.filter(function (r) {
        return r.overallStatus === 'Active';
      });
      // S1: exclude Student deployments from MDS/PGL batch view (HENP only).
      activeRows = filterDeploymentsByStudent_(activeRows, 'exclude', cfg);
    } catch (e) {
      Logger.log('CoreData.getMdsPglBatchView: readSfdcDeploymentsRaw_ failed: ' + e);
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
          eventDate:        ev.eventDate,
          products:         ev.products,
          isMultipleGoLives: isMultipleGoLives,
          oneThirdPoint:    ev.oneThirdPoint || null,
          startDate:        r.deploymentStartDate || null,
          currentMtp:       r.mtpDate             || null,
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

    return _applyViewModeFilterToPayload_(cfg, payload, viewModeOpts, horizonMonths);
  }

  /**
   * Applies viewMode filtering to a cached batch-view payload.
   * Returns a shallow copy of the payload with filtered row arrays.
   * @private
   */
  function _applyViewModeFilterToPayload_(cfg, payload, viewModeOpts, horizonMonths) {
    if (!viewModeOpts || !viewModeOpts.viewMode || viewModeOpts.viewMode === 'all') {
      return payload;
    }

    // Deep-copy groups and filter rows within each group.
    var filteredGroups = payload.groups.map(function (g) {
      // We need to apply the filter to the combined row pool, then re-split.
      var combined = g.mdsRows.concat(g.pglRows);
      var filtered = applyViewModeFilter_(cfg, combined, viewModeOpts);
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
  function _computeOverviewSnapshot_(cfg) {
    var tz = Session.getScriptTimeZone();
    var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    var allRows = readSfdcDeploymentsRaw_(cfg);
    // S1: exclude Student deployments from Overview tab (HENP only).
    allRows = filterDeploymentsByStudent_(allRows, 'exclude', cfg);
    var activeRows = allRows.filter(function(r) { return r.overallStatus === 'Active'; });

    // TOTALS
    var totalActive    = activeRows.length;
    var redCount       = activeRows.filter(function(r) { return r.health === 'Red'; }).length;
    var yellowCount    = activeRows.filter(function(r) { return r.health === 'Yellow'; }).length;
    var greenCount     = activeRows.filter(function(r) { return r.health === 'Green'; }).length;
    var ewCount        = activeRows.filter(function(r) { return r.isExecutiveWatch; }).length;

    // TOP HIGH RISK — sort MTP ascending only; Red/Yellow mix freely by date (C12 fix)
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
    var topHighRisk = highRiskCandidates.slice(0, 5).map(function(r) {
      return {
        deploymentId:   r.deploymentId,
        accountName:    r.accountName,
        deploymentName: r.deploymentName,
        partner:        r.partner,
        health:         r.health,
        currentMtp:     r.mtpDate
      };
    });

    // UPCOMING GO LIVES — delegate to getUpcomingGoLives for parity with the Go Lives tab (C12 fix).
    // getUpcomingGoLives handles phased deployments (per-product target dates), override exclusions,
    // and partner overrides — matching exactly what the Go Lives tab's upcoming view shows.
    var upcomingGoLivesPayload = [];
    try {
      upcomingGoLivesPayload = getUpcomingGoLives(cfg, null) || [];
    } catch (err) {
      Logger.log('_computeOverviewSnapshot_: getUpcomingGoLives threw — upcoming card will render empty. Error: ' + err);
    }
    var thirtyAhead = _addDaysToKey_(todayKey, 30);
    var upcomingIn30 = upcomingGoLivesPayload.filter(function(r) {
      if (!r || !r.nextGoLiveDate) return false;
      return r.nextGoLiveDate >= todayKey && r.nextGoLiveDate <= thirtyAhead;
    });
    upcomingIn30.sort(function(a, b) {
      return a.nextGoLiveDate < b.nextGoLiveDate ? -1 : a.nextGoLiveDate > b.nextGoLiveDate ? 1 : 0;
    });
    var upcomingItems = upcomingIn30.slice(0, 5).map(function(r) {
      return {
        deploymentId:   r.deploymentId || '',
        accountName:    r.accountName  || '',
        deploymentName: r.deploymentName || '',
        currentMtp:     r.nextGoLiveDate || ''
      };
    });
    var upcomingGoLivesBlock = { total: upcomingIn30.length, items: upcomingItems };

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
  function getOverviewSnapshot(config) {
    var cfg      = CoreConfig.withDefaults(config);
    var cacheKey = 'overviewData:v2:' + cfg.appId;

    if (_cache.overviewSnapshot !== null) return _cache.overviewSnapshot;

    var cached = _perfCacheRead_(cacheKey);
    if (cached !== null) {
      _cache.overviewSnapshot = cached;
      return cached;
    }

    var payload = _computeOverviewSnapshot_(cfg);
    _cache.overviewSnapshot = payload;
    _perfCacheWrite_(cacheKey, payload);
    Logger.log('CoreData.getOverviewSnapshot(' + cfg.appId + '): computed fresh snapshot. totalActive=' +
               (payload.totals && payload.totals.totalActive));
    return payload;
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
   *                  healthActive:{red:number,yellow:number,green:number,blue:number}}}}
   */
  function buildStudentTabData_(config) {
    var cfg = CoreConfig.withDefaults(config);
    if (!cfg.student || cfg.student.enabled !== true) return null;

    var allEffective = getAllEffectiveDeployments(cfg);
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
    var healthActive  = { red: 0, yellow: 0, green: 0, blue: 0 };
    activeRows.forEach(function (d) {
      var h = String(d.health || '').trim().toLowerCase();
      if      (h === 'red')    healthActive.red++;
      else if (h === 'yellow') healthActive.yellow++;
      else if (h === 'green')  healthActive.green++;
      else if (h === 'blue')   healthActive.blue++;
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

  // ===========================================================================
  // EXPORTS
  // ===========================================================================

  return {
    // Phase 1 surface — preserved unchanged for backward compatibility
    getActiveDeployments:                getActiveDeployments,
    getAllEffectiveDeployments:          getAllEffectiveDeployments,
    _validateEffectiveDeployments:       _validateEffectiveDeployments,
    getGoLives:                          getGoLives,
    getUpcomingGoLives:                  getUpcomingGoLives,
    updateDeploymentMeta:                updateDeploymentMeta,
    updateDeploymentOverride:            updateDeploymentOverride,
    updateDeploymentWithMetaAndOverride: updateDeploymentWithMetaAndOverride,
    updateGoLivesOverride:               updateGoLivesOverride,

    // Phase 2 additions
    getAllDeployments:           getAllDeployments,
    getAllActiveOverrides:       getAllActiveOverrides,
    getOverrideAuditLog:         getOverrideAuditLog,
    setOverrideClassification:   setOverrideClassification,
    bulkClearMonthlyOverrides:   bulkClearMonthlyOverrides,
    bulkClearAllOverrides:       bulkClearAllOverrides,

    // Phase 3f addition
    getDeploymentAuditSummary:   getDeploymentAuditSummary,

    // Phase 3i additions
    getRecentGoLives:            getRecentGoLives,

    // MDS / PGL redesign (2026-06) — replaces getUpcomingSurveys
    getMdsPglBatchView:          getMdsPglBatchView,
    _debugMdsPglBatchView:       _debugMdsPglBatchView_,
    _debugMdsPglExceptions:      _debugMdsPglExceptions_,

    // Overview Snapshot (C11b)
    getOverviewSnapshot:         getOverviewSnapshot,
    _debugOverviewSnapshot:      _debugOverviewSnapshot_,

    // Performance Layer 2 additions
    _warmSfdcRows:               _warmSfdcRows,
    _getCachedSfdcRowCount:      _getCachedSfdcRowCount,

    // D1 diagnostic
    _debugDdFromContacts_:       _debugDdFromContacts_,

    // S1: Student data layer
    filterDeploymentsByStudent_: filterDeploymentsByStudent_,
    buildStudentTabData_:        buildStudentTabData_,
    saveStudentDeploymentFields: saveStudentDeploymentFields
  };
})();
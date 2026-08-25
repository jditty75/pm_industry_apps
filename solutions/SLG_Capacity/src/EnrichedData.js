// ============================================================
// EnrichedData.gs — shared computation layer (Drop 5)
//
// Cache invalidation chain:
//
//   1. Direct sheet writes → individual cachedRead_ entries invalidated
//      by Util.gs helpers (writeTable_, appendRow_, updateRow_).
//
//   2. Enriched layer → invalidated by bumping the config version counter
//      via invalidateEnrichedCaches_(). All three enriched-cache keys embed
//      the version, so a bump makes every cached payload stale without
//      needing per-key deletes.
//
//   3. Triggers for invalidateEnrichedCaches_():
//      (a) Explicit call from api_flushCaches
//      (b) normalizeStaff() completion
//      (c) normalizeOpportunities() completion
//      (d) Any save to one of the four config tabs that feeds enrichment:
//          Config_Roles, Config_Resource_Type, Config_Worker_Role_Overrides,
//          Config_Practice_Managers — wired inside the relevant api_save*
//          endpoints in Api.gs.
//
// Three pure-read functions, each backed by script-cache keyed on the
// upstream sheet name plus a config version stamp. Payload is chunked
// identically to cachedRead_ (_CACHE_CHUNK_BYTES).
// ============================================================

// ============================================================
// Config-version counter
// ============================================================

function _getEnrichedCacheVersion_() {
  try {
    return PropertiesService.getScriptProperties()
             .getProperty('enriched_cache_version') || '1';
  } catch (e) {
    return '1';
  }
}

/**
 * Bump the config version counter, effectively invalidating all enriched
 * caches without needing per-key deletes. Cheap and atomic (single property
 * write).
 */
function invalidateEnrichedCaches_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var v = Number(props.getProperty('enriched_cache_version') || '0') + 1;
    props.setProperty('enriched_cache_version', String(v));
    // Track invalidations for _dbg_enrichedCacheStats.
    props.setProperty('enriched_cache_last_invalidated', new Date().toISOString());
  } catch (e) {
    Logger.log('invalidateEnrichedCaches_: ' + e.message);
  }
}

// ============================================================
// Internal chunked cache helpers (mirrors cachedRead_ pattern)
// ============================================================

function _enrichedCacheRead_(cacheKey) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(cacheKey + ':meta');
    if (!meta) return null;
    var chunkCount = Number(meta);
    if (chunkCount <= 0) return null;
    var keys = [];
    for (var i = 0; i < chunkCount; i++) keys.push(cacheKey + ':' + i);
    var all = cache.getAll(keys);
    var combined = '';
    var ok = true;
    for (var j = 0; j < chunkCount; j++) {
      var part = all[cacheKey + ':' + j];
      if (part === null || part === undefined) { ok = false; break; }
      combined += part;
    }
    if (!ok) return null;
    // Track hits for _dbg_enrichedCacheStats.
    try {
      var props = PropertiesService.getScriptProperties();
      var hits = Number(props.getProperty('enriched_hits') || '0') + 1;
      props.setProperty('enriched_hits', String(hits));
    } catch (e2) {}
    return JSON.parse(combined);
  } catch (e) {
    return null;
  }
}

function _enrichedCacheWrite_(cacheKey, data, ttl) {
  try {
    var cache = CacheService.getScriptCache();
    var payload = JSON.stringify(data);
    var chunkCount = Math.ceil(payload.length / _CACHE_CHUNK_BYTES);
    if (chunkCount <= 0 || chunkCount > 50) return;
    var writes = {};
    for (var i = 0; i < chunkCount; i++) {
      var start = i * _CACHE_CHUNK_BYTES;
      writes[cacheKey + ':' + i] = payload.slice(start, start + _CACHE_CHUNK_BYTES);
    }
    writes[cacheKey + ':meta'] = String(chunkCount);
    cache.putAll(writes, ttl || 21600);
    // Track misses for _dbg_enrichedCacheStats.
    try {
      var props = PropertiesService.getScriptProperties();
      var misses = Number(props.getProperty('enriched_misses') || '0') + 1;
      props.setProperty('enriched_misses', String(misses));
      props.setProperty('enriched_last_payload_kb', String(Math.round(payload.length / 1024)));
    } catch (e2) {}
  } catch (e) {
    Logger.log('_enrichedCacheWrite_: ' + e.message);
  }
}

// ============================================================
// Unified team resolver (5.2)
// ============================================================

/**
 * Single canonical team-label resolver. Replaces:
 *   _resolveTeamForBucket_ (Engine.gs)
 *   _classifyTeam_         (Api.gs)  ← now a thin wrapper
 *   _normalizedTeam_       (Engine.gs) ← now a thin wrapper
 *
 * @param {Object} row        Any row-like object. Field names tolerated:
 *                            worker_class, icp_role / icp / ICP_role,
 *                            role_category, job_profile, project_role,
 *                            resource_type.
 * @param {Object} ctx        Pre-loaded config maps + memoization state.
 *                            Build via resolveTeamLabel_.buildCtx_().
 * @returns {string}          Leadership-facing team label or 'Unclassified'.
 */
function resolveTeamLabel_(row, ctx) {
  if (!row || !ctx) return 'Unclassified';

  // Build memoization key from the relevant classification inputs.
  var wc   = String(row.worker_class || '');
  var icp  = String(row.icp_role || row.icp || row.ICP_role || '');
  var rc   = String(row.role_category  || '');
  var jp   = String(row.job_profile    || '');
  var pr   = String(row.project_role   || '');
  var rt   = String(row.resource_type  || '');

  var memoKey = wc + '|' + icp + '|' + rc + '|' + jp + '|' + pr + '|' + rt;
  if (ctx._memo.hasOwnProperty(memoKey)) return ctx._memo[memoKey];

  var result;

  if (wc === 'SLG_Real' || wc === 'SLG_Generic') {
    // SLG workers: resolve via Config_Roles.team_label keyed on ICP role.
    result = ctx.roleTeamLabels[icp] || '';
    // Drop 7 fix: SLG_Generic workers have no ICP role. When icp is blank,
    // fall back to the resource_type lookup (same chain used for External
    // workers). This ensures generic workers classified as e.g. "Functional"
    // resolve to "Functional Consulting" and appear in Team-filtered views.
    if (!result && wc === 'SLG_Generic' && rt) {
      result = ctx.rtTeamMap[rt.trim().toLowerCase()] || '';
    }
    result = result || 'Unclassified';
  } else {
    // External workers: case-insensitive chain lookup in rtTeamMap.
    function tryKey(v) {
      if (!v) return '';
      var k = v.trim().toLowerCase();
      if (!k) return '';
      return ctx.rtTeamMap[k] || '';
    }
    result = (
      tryKey(rc) ||
      tryKey(jp) ||
      tryKey(pr) ||
      tryKey(rt) ||
      // Legacy hardcoded fallback (mirrors _normalizedTeamForApi_)
      _normalizedTeamFallback_(rt) ||
      'Unclassified'
    );
  }

  ctx._memo[memoKey] = result;
  return result;
}

/**
 * Build a ctx object for resolveTeamLabel_.
 * Preloads both config maps so callers pay the I/O cost once per request.
 *
 * @param {Object} [roleTeamLabels]  Optional pre-loaded map.
 * @param {Object} [rtTeamMap]       Optional pre-loaded map.
 */
resolveTeamLabel_.buildCtx_ = function (roleTeamLabels, rtTeamMap) {
  var rtl = roleTeamLabels || (typeof readRoleTeamLabels_ === 'function' ? readRoleTeamLabels_() : {});
  var rtm;
  if (rtTeamMap) {
    // Normalize keys to lowercase.
    rtm = {};
    Object.keys(rtTeamMap).forEach(function (k) { rtm[k.toLowerCase()] = rtTeamMap[k]; });
  } else if (typeof _readResourceTypeTeamMap_ === 'function') {
    // _readResourceTypeTeamMap_ already lowercases keys.
    rtm = _readResourceTypeTeamMap_();
  } else {
    rtm = {};
  }
  return { roleTeamLabels: rtl, rtTeamMap: rtm, _memo: {} };
};

/**
 * Hardcoded fallback for legacy External resource_type strings not yet in
 * Config_Resource_Type. Mirrors _normalizedTeamForApi_ in Api.gs.
 */
function _normalizedTeamFallback_(resourceType) {
  var rt = String(resourceType || '').toUpperCase().trim();
  if (rt === 'FUNCTIONAL') return 'Functional Consulting';
  if (rt === 'INTEGRATIONS') return 'Technical Consulting';
  if (rt === 'REPORTING & ANALYTICS PS') return 'Technical Consulting';
  if (rt === 'DATA CONVERSION') return 'Technical Consulting';
  if (rt === 'ENGAGEMENT MANAGER') return 'Delivery';
  return '';
}

// ============================================================
// Shared cached getters (5.1)
// ============================================================

/**
 * Enriched form of Allocations_Normalized (weekly grain,
 * weekly-forecast-migration). Each row has all original fields plus:
 *   week_key       -- canonical 'YYYY-MM-DD' id, ALWAYS recomputed from
 *                      week_start (WFM.13: never trusted from the stored
 *                      cell, which could hold a raw Date object if a prior
 *                      write was auto-converted by Sheets -- see
 *                      writeTable_, Util.gs)
 *   month_key      -- 'YYYY-MM' of week_start; a single "primary month"
 *                      stamp for quick client-side monthly filtering. This
 *                      is NOT the proportional week->month split used by
 *                      Engine.gs's monthly rollups (splitWeekAcrossMonths_)
 *                      -- it's a simple denormalized convenience field.
 *   fiscal_quarter -- 'Q1'..'Q4' per the Feb-anchored fiscal mapping
 *   team_label     -- resolved via unified resolver (unchanged)
 * Cached 6 hours, keyed on the config version stamp so cache invalidation
 * is a single property write.
 */
function getEnrichedAllocations_() {
  var version = _getEnrichedCacheVersion_();
  var cacheKey = 'enriched:alloc:v2:' + version;

  var cached = _enrichedCacheRead_(cacheKey);
  if (cached) return cached;

  var rows = cachedRead_(ALLOC_NORM);
  var ctx  = resolveTeamLabel_.buildCtx_();

  // WFM-PERF.2: compute one weekStart_-normalized Date per row and derive
  // week_key/month_key/fiscal_quarter from its local components directly,
  // instead of each helper (weekKey_/monthKey_/fiscalQuarter_) re-wrapping
  // r.week_start in its own `new Date(...)`. Output is identical to the
  // helper-based version -- verified via _dbg_verifyFastDateParity.
  var enriched = rows.map(function (r) {
    var row = {};
    Object.keys(r).forEach(function (k) { row[k] = r[k]; });
    var ws = r.week_start ? weekStart_(r.week_start) : null;
    if (ws && !isNaN(ws.getTime())) {
      row.week_key = _fastYmd_(ws);
      row.month_key = ws.getFullYear() + '-' + (ws.getMonth() + 1 < 10 ? '0' : '') + (ws.getMonth() + 1);
      row.fiscal_quarter = FISCAL_QUARTER_BY_CALENDAR_MONTH[ws.getMonth() + 1];
    } else {
      row.week_key = ''; row.month_key = ''; row.fiscal_quarter = '';
    }
    row.team_label = resolveTeamLabel_(row, ctx);
    return row;
  });

  _enrichedCacheWrite_(cacheKey, enriched);
  return enriched;
}

/**
 * Assignments enriched with each worker's class, ICP role, team_label, and
 * manager_org from the resource index. Cached 6 hours.
 */
function getEnrichedAssignments_() {
  var version  = _getEnrichedCacheVersion_();
  var cacheKey = 'enriched:assign:v1:' + version;

  var cached = _enrichedCacheRead_(cacheKey);
  if (cached) return cached;

  var assigns = cachedRead_(ASSIGNMENTS);
  var resIdx  = getResourceIndex_();
  var ctx     = resolveTeamLabel_.buildCtx_();

  var enriched = assigns.map(function (a) {
    var assign = {};
    Object.keys(a).forEach(function (k) { assign[k] = a[k]; });
    var info = resIdx[a.resource_name] || {};
    assign.worker_class   = assign.worker_class   || info.worker_class  || '';
    assign.icp_role       = assign.icp_role       || info.icp           || '';
    assign.team_label     = resolveTeamLabel_({
      worker_class:  assign.worker_class,
      icp_role:      assign.icp_role,
      role_category: info.role_category || '',
      job_profile:   info.job_profile   || '',
      project_role:  info.project_role  || '',
      resource_type: info.resource_type || ''
    }, ctx);
    assign.manager_org    = assign.manager_org    || info.manager_org   || '';
    assign.role_category  = assign.role_category  || info.role_category || '';
    assign.job_profile    = assign.job_profile    || info.job_profile   || '';
    assign.resource_type  = assign.resource_type  || info.resource_type || '';
    return assign;
  });

  _enrichedCacheWrite_(cacheKey, enriched);
  return enriched;
}

/**
 * Cached wrapper around _resourceIndex_(alloc). Cold call builds the index
 * once; every subsequent call (across all endpoints in the same hour) hits
 * the shared script cache. Each resource is also enriched with resolved_team
 * (from the unified resolver).
 */
function getResourceIndex_() {
  var version  = _getEnrichedCacheVersion_();
  var cacheKey = 'enriched:resindex:v1:' + version;

  var cached = _enrichedCacheRead_(cacheKey);
  if (cached) return cached;

  // _resourceIndex_ is defined in Engine.gs and takes the alloc array.
  var alloc = cachedRead_(ALLOC_NORM);
  var idx   = (typeof _resourceIndex_ === 'function')
    ? _resourceIndex_(alloc) : {};

  // Enrich each resource with resolved_team via the unified resolver.
  if (Object.keys(idx).length > 0) {
    var ctx = resolveTeamLabel_.buildCtx_();
    Object.values(idx).forEach(function (res) {
      res.resolved_team = resolveTeamLabel_({
        worker_class:  res.worker_class  || '',
        icp_role:      res.icp           || '',
        role_category: res.role_category || '',
        job_profile:   res.job_profile   || '',
        project_role:  res.project_role  || '',
        resource_type: res.resource_type || ''
      }, ctx);
    });
  }

  _enrichedCacheWrite_(cacheKey, idx);
  return idx;
}

/**
 * Aggregate Actuals_Normalized rows (worker×week×project grain) to worker×week
 * totals. Sums actual_icp_hours — never overwrites when multiple project rows
 * share the same worker and week. week_key is canonicalized from week_start.
 * @param {Array<Object>} rows
 * @return {{byEmployeeId: Object<string, Object<string, number>>,
 *           byResourceName: Object<string, Object<string, number>>}}
 * @private
 */
function _aggregateActualIcHoursByWorkerWeek_(rows) {
  var byEmployeeId = {};
  var byResourceName = {};
  (rows || []).forEach(function (r) {
    var wk = '';
    if (r.week_start) {
      try { wk = weekKey_(r.week_start); } catch (e) { wk = ''; }
    }
    if (!wk && r.week_key) wk = String(r.week_key).trim();
    if (!wk) return;
    var hrs = Number(r.actual_icp_hours) || 0;
    var eid = String(r.employee_id || '').trim();
    var name = String(r.resource_name || '').trim();
    if (eid) {
      if (!byEmployeeId[eid]) byEmployeeId[eid] = {};
      byEmployeeId[eid][wk] = (byEmployeeId[eid][wk] || 0) + hrs;
    }
    if (name) {
      if (!byResourceName[name]) byResourceName[name] = {};
      byResourceName[name][wk] = (byResourceName[name][wk] || 0) + hrs;
    }
  });
  return { byEmployeeId: byEmployeeId, byResourceName: byResourceName };
}

/**
 * Resolve per-week actual ICP hours for a forecast worker row.
 * Prefers employee_id join; falls back to resource_name.
 * @param {{employeeId?:string, resource?:string}} worker
 * @param {Object<string, Object<string, number>>} byEmployeeId
 * @param {Object<string, Object<string, number>>} byResourceName
 * @return {Object<string, number>}
 */
function _workerWeeklyActualsMap_(worker, byEmployeeId, byResourceName) {
  byEmployeeId = byEmployeeId || {};
  byResourceName = byResourceName || {};
  var eid = String((worker && worker.employeeId) || '').trim();
  var name = String((worker && worker.resource) || '').trim();
  if (eid && byEmployeeId[eid]) return byEmployeeId[eid];
  if (name && byResourceName[name]) return byResourceName[name];
  return {};
}

/**
 * Cached Actuals_Normalized aggregates for blend-at-read (multi-row-per-week safe).
 * @return {{byEmployeeId: Object<string, Object<string, number>>,
 *           byResourceName: Object<string, Object<string, number>>}}
 */
function getActualsAggregated_() {
  var version = _getEnrichedCacheVersion_();
  var cacheKey = 'enriched:actuals:v2:' + version;
  var cached = _enrichedCacheRead_(cacheKey);
  if (cached) return cached;
  var rows = cachedRead_(ACTUALS_NORM);
  var agg = _aggregateActualIcHoursByWorkerWeek_(rows);
  _enrichedCacheWrite_(cacheKey, agg);
  return agg;
}

/**
 * Actuals keyed for blend: { employee_id: { week_key: actual_icp_hours } }.
 * Sums all project rows per worker×week. Cached on the config-version stamp.
 * @return {Object<string, Object<string, number>>}
 */
function getActualsByWorkerWeek_() {
  return getActualsAggregated_().byEmployeeId;
}

/**
 * Distinct canonical week_keys from Actuals_Normalized aggregate for one fiscal quarter.
 * Uses getActualsAggregated_() — does not re-read or re-group raw sheet rows.
 * Quarter assignment uses fiscalQuarterKeyFromWeekStart_ (Saturday week_start − 1 day).
 * @param {string} quarterKey e.g. 'FY27-Q3'
 * @return {string[]} sorted ascending (ISO week_key order)
 */
function getActualWeekKeysForQuarter_(quarterKey) {
  quarterKey = String(quarterKey || '').trim();
  if (!quarterKey) return [];
  var agg = getActualsAggregated_();
  var keySet = {};
  [agg.byEmployeeId, agg.byResourceName].forEach(function (byWorker) {
    if (!byWorker) return;
    Object.keys(byWorker).forEach(function (workerKey) {
      Object.keys(byWorker[workerKey] || {}).forEach(function (wk) {
        keySet[String(wk)] = true;
      });
    });
  });
  var out = [];
  Object.keys(keySet).forEach(function (wk) {
    var ws = _weekStartFromWeekKey_(wk);
    if (!ws) return;
    if (fiscalQuarterKeyFromWeekStart_(ws) !== quarterKey) return;
    out.push(wk);
  });
  out.sort();
  return out;
}

/**
 * Actuals worker summary keyed by employee_id. Cached on config version.
 * @return {Object<string, {employee_id:string, resource_name:string,
 *   qtd_actual_icp_hours:number, qtd_icp_plus_forecast_hours:number,
 *   bonus_target_billable_hours_eoq:number}>}
 */
function getActualsSummaryByEmployee_() {
  var version = _getEnrichedCacheVersion_();
  var cacheKey = 'enriched:actuals_summary:v1:' + version;
  var cached = _enrichedCacheRead_(cacheKey);
  if (cached) return cached;
  var rows = cachedRead_(ACTUALS_SUMMARY);
  var map = {};
  rows.forEach(function (r) {
    var eid = String(r.employee_id || '').trim();
    if (!eid) return;
    map[eid] = {
      employee_id: eid,
      resource_name: String(r.resource_name || '').trim(),
      qtd_actual_icp_hours: Number(r.qtd_actual_icp_hours) || 0,
      qtd_icp_plus_forecast_hours: Number(r.qtd_icp_plus_forecast_hours) || 0,
      bonus_target_billable_hours_eoq: Number(r.bonus_target_billable_hours_eoq) || 0
    };
  });
  _enrichedCacheWrite_(cacheKey, map);
  return map;
}

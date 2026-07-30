// ============================================================
// Api.gs — doGet + client-callable api_* functions
// All responses sanitized for google.script.run transport.
// Applies worker exclusions via readExclusions_() where appropriate.
//
// Manager filtering:
//   SLG rows      → filtered by direct manager_org against effectiveManagers.
//   External rows → filtered by practice-based ownership via
//                   resolveOwnersForRow_ (Util.gs). If any owner is in
//                   effectiveManagers, the row is included.
//
// Team filtering (Priority 2):
//   When params.teamLabel is set on the dashboard or reporting endpoints,
//   it OVERRIDES manager filtering (effectiveManagers is forced null)
//   and scopes data to workers whose resolved team matches teamLabel.
//   SLG workers resolve team via Config_Roles.team_label (by ICP_role).
//   External workers resolve via Config_Resource_Type.team_label
//   (using the existing _classifyTeam_ fallback chain).
// ============================================================

function doGet() {
  // Desktop-first viewport (weekly-forecast-migration §9/§11): the app is no
  // longer mobile-responsive, so we drop the mobile-oriented
  // width=device-width directive and pin a desktop-sized initial layout
  // viewport instead.
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('SLG Delivery Capacity Planner')
    .addMetaTag('viewport', 'width=1280, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Capacity Planner')
    .addItem('Bootstrap (first run)', 'bootstrap')
    .addSeparator()
    .addItem('Normalize Staff', 'normalizeStaff')
    .addItem('Normalize Opportunities', 'normalizeOpportunities')
    .addSeparator()
    .addItem('Flush all caches', 'api_flushCaches')
    .addToUi();
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function _toIso_(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function _normalizedTeamForApi_(resourceType) {
  const rt = String(resourceType || '').toUpperCase().trim();
  if (rt === 'FUNCTIONAL') return 'Functional Consulting';
  if (rt === 'INTEGRATIONS') return 'Technical Consulting';
  if (rt === 'REPORTING & ANALYTICS PS') return 'Technical Consulting';
  if (rt === 'DATA CONVERSION') return 'Technical Consulting';
  if (rt === 'ENGAGEMENT MANAGER') return 'Delivery';
  return null;
}

function readConfigResourceType_() {
  var ss = SpreadsheetApp.getActive();

  function readSheetAsMap_(sheetName) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return null;
    var values = sh.getDataRange().getValues();
    if (!values || values.length < 2) return {};

    var header = values[0].map(function (h) {
      return String(h || '').trim().toLowerCase();
    });

    var iKey = header.indexOf('resource_type');
    var iTeam = header.indexOf('team_label');
    if (iKey < 0) iKey = header.indexOf('project_role_category');
    if (iKey < 0) iKey = header.indexOf('key');
    if (iTeam < 0) iTeam = header.indexOf('team');
    if (iTeam < 0) iTeam = header.indexOf('label');

    if (iKey < 0 || iTeam < 0) {
      Logger.log(
        'readConfigResourceType_: could not locate key/team columns in '
        + sheetName + '. Header was: ' + JSON.stringify(values[0])
      );
      return {};
    }

    var map = {};
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var key = String(row[iKey] || '').trim();
      var team = String(row[iTeam] || '').trim();
      if (!key || !team) continue;
      map[key] = team;
    }
    return map;
  }

  var primary = readSheetAsMap_('Config_Resource_Type');
  if (primary && Object.keys(primary).length) return primary;

  var legacy = readSheetAsMap_('Config_ResourceType_Map');
  if (legacy && Object.keys(legacy).length) return legacy;

  Logger.log('readConfigResourceType_: returning empty map — no usable config sheet found.');
  return {};
}

/**
 * Legacy team classifier. Thin wrapper around resolveTeamLabel_
 * (EnrichedData.gs) for backward compatibility. The wrapper passes rtMap
 * so callers that pre-built it don't pay a double-read.
 */
function _classifyTeam_(row, rtMap) {
  if (typeof resolveTeamLabel_ === 'function') {
    var ctx = resolveTeamLabel_.buildCtx_(undefined, rtMap);
    return resolveTeamLabel_(row, ctx);
  }
  // Fallback if EnrichedData.gs not yet loaded.
  if (!_classifyTeam_._lowerIdx || _classifyTeam_._mapRef !== rtMap) {
    var idx = {};
    Object.keys(rtMap).forEach(function (k) { idx[k.toLowerCase()] = rtMap[k]; });
    _classifyTeam_._lowerIdx = idx;
    _classifyTeam_._mapRef = rtMap;
  }
  var lowerIdx = _classifyTeam_._lowerIdx;
  function tryKey(v) {
    if (!v) return null;
    var k = String(v).trim();
    if (!k) return null;
    if (rtMap[k]) return rtMap[k];
    return lowerIdx[k.toLowerCase()] || null;
  }
  return (
    tryKey(row.role_category) ||
    tryKey(row.job_profile) ||
    tryKey(row.project_role) ||
    tryKey(row.resource_type) ||
    _normalizedTeamForApi_(row.resource_type) ||
    'Unclassified'
  );
}

function _classifyAnyTeam_(row, rtMap) {
  return _classifyTeam_(row, rtMap);
}

/**
 * Resolve the logged-in user's identity for the client.
 *
 * WFM-FIX.1: rewritten to (a) read Config_Settings.admin_emails instead of
 * the legacy recognized_non_manager_emails key -- AccessControl.gs's
 * isAuthorized_ and _migrateAdminEmailsSetting_ already moved to
 * admin_emails; this function had been left behind reading the old key --
 * and (b) surface teamLabel/isAdmin so the client can boot into a
 * personalized default (see applyAutoManagerDefaults_, JavaScript.html)
 * instead of the old hardcoded default_team_filter.
 *
 * Matching no longer short-circuits on the manager match: an admin who
 * also happens to have a Config_SLG_Managers row still gets isAdmin=true.
 *
 *   { email, matchedManager, teamLabel, isAdmin, recognized }
 */
function _resolveLoggedInUser_() {
  var email = '';
  try { email = (getUserEmail_ ? getUserEmail_() : '') || ''; }
  catch (e) { email = ''; }
  var emailLc = String(email || '').trim().toLowerCase();

  var result = {
    email: email,
    matchedManager: null,
    teamLabel: '',      // NEW — matched manager's Config_SLG_Managers.team_label
    isAdmin: false,     // NEW — email is in Config_Settings.admin_emails
    recognized: false
  };
  if (!emailLc) return result;

  // 1) Match against Config_SLG_Managers (name + team_label).
  try {
    var mgrRows = (typeof readConfigSlgManagers_ === 'function') ? readConfigSlgManagers_() : [];
    for (var i = 0; i < mgrRows.length; i++) {
      var rowEmail = String(mgrRows[i].email || '').trim().toLowerCase();
      if (rowEmail && rowEmail === emailLc) {
        result.matchedManager = mgrRows[i].manager_name;
        result.teamLabel = String(mgrRows[i].team_label || '').trim(); // NEW
        result.recognized = true;
        break; // do not return — still resolve admin flag below
      }
    }
  } catch (e) {
    Logger.log('_resolveLoggedInUser_: manager lookup failed — ' + e);
  }

  // 2) Admin check: Config_Settings.admin_emails (comma-separated, case-insensitive).
  try {
    var settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
    var raw = String(settings['admin_emails'] || '');
    if (raw) {
      var isAdmin = raw.split(',').some(function (e) {
        return String(e || '').trim().toLowerCase() === emailLc;
      });
      if (isAdmin) {
        result.isAdmin = true;
        result.recognized = true;
      }
    }
  } catch (e) {
    Logger.log('_resolveLoggedInUser_: admin lookup failed — ' + e);
  }

  return result;
}

/**
 * Read the leadership-facing team labels available in Config_Roles.
 * Returns a sorted, deduped list of distinct non-blank team_label values,
 * with 'Unclassified' excluded (it's a diagnostic state, not a leadership
 * rollup — exclusion confirmed for Priority 2 Team filter).
 *
 * Used by api_getReference to populate the topbar Team dropdown.
 */
function _readTeamLabelOptions_() {
  var labels = {};
  try {
    if (typeof readRoleTeamLabels_ === 'function') {
      var roleTeamLabels = readRoleTeamLabels_();
      Object.keys(roleTeamLabels).forEach(function (role) {
        var team = String(roleTeamLabels[role] || '').trim();
        if (team && team !== 'Unclassified') {
          labels[team] = true;
        }
      });
    }
  } catch (e) {
    Logger.log('_readTeamLabelOptions_: failed — ' + e);
  }
  return Object.keys(labels).sort();
}

/**
 * Build a resource → team resolver function for use in api_getReference.
 *
 * Returns a function (resource) -> teamLabel string.
 *
 * Two branches:
 *   SLG workers (SLG_Real / SLG_Generic): resolve via
 *     Config_Roles.team_label keyed on the worker's ICP role.
 *     Mirrors _resolveTeamForBucket_ in Engine.gs and the
 *     Headcount Gap aggregator. This is the canonical SLG
 *     team lookup — based on who the worker is, not what
 *     project they happen to be on.
 *
 *   External workers (External_NonSLG / External_Contractor):
 *     resolve via _classifyTeam_'s lookup chain (role_category
 *     -> job_profile -> resource_type), with the
 *     _normalizedTeamForApi_ safety net. Mirrors Reporting view.
 *
 * The SLG branch is critical: without it, the External chain
 * may classify an SLG worker based on their current project's
 * work type, diverging from the Dashboard Team filter. See
 * Desiree Smalls (CS_FUNC, currently on a Technical project)
 * as the proof case.
 *
 * Used by Priority 3 to let Capacity Explorer client-side
 * filter the resource list by Team without server round-trips.
 */
/**
 * Drop 5: now a thin factory that delegates to the unified resolver.
 * The returned function closes over a single ctx so callers pay the
 * config-read cost once rather than once per resource.
 */
function _buildResourceTeamResolver_() {
  if (typeof resolveTeamLabel_ === 'function') {
    var ctx = resolveTeamLabel_.buildCtx_();
    return function (resource) {
      if (!resource) return 'Unclassified';
      return resolveTeamLabel_(resource, ctx);
    };
  }
  // Fallback if EnrichedData.gs not yet loaded.
  var rtMap = readConfigResourceType_();
  var roleTeamLabels = (typeof readRoleTeamLabels_ === 'function')
    ? readRoleTeamLabels_() : {};
  var rtTeamMapFallback = (typeof _readResourceTypeTeamMap_ === 'function')
    ? _readResourceTypeTeamMap_() : {};
  return function (resource) {
    if (!resource) return 'Unclassified';
    var wc = String(resource.worker_class || '');
    if (wc === 'SLG_Real' || wc === 'SLG_Generic') {
      var tLabel = roleTeamLabels[String(resource.icp || '')] || '';
      // Drop 7: SLG_Generic fallback via resource_type when icp is blank.
      if (!tLabel && wc === 'SLG_Generic' && resource.resource_type) {
        tLabel = rtTeamMapFallback[String(resource.resource_type).trim().toLowerCase()] || '';
      }
      return tLabel || 'Unclassified';
    }
    return _classifyTeam_({
      role_category: resource.role_category || '',
      job_profile:   resource.job_profile   || '',
      project_role:  '',
      resource_type: resource.resource_type || ''
    }, rtMap);
  };
}

/**
 * Priority 4: derive ICP role from a team_label by inverting Config_Roles.
 *
 * Returns the single ICP role that maps to the given team_label IF AND ONLY
 * IF exactly one ICP role maps there. Otherwise returns ''.
 *
 * Examples with the current Config_Roles:
 *   'Functional Consulting' → 'CS_FUNC'   (unambiguous, sole mapping)
 *   'Technical Consulting'  → 'CS_TECH'   (unambiguous, sole mapping)
 *   'Delivery'              → ''          (ambiguous: EM, PD, DA)
 *   'Unclassified' or blank → ''
 *
 * Returns '' (empty string) for any ambiguous, unknown, or empty team_label.
 * The caller is responsible for storing the empty value as-is.
 *
 * Used by Assignments.gs at save time to populate the `role` column.
 */
function _resolveIcpRoleFromTeamLabel_(teamLabel) {
  var label = String(teamLabel || '').trim();
  if (!label || label === 'Unclassified') return '';

  var roleTeamLabels = (typeof readRoleTeamLabels_ === 'function')
    ? readRoleTeamLabels_() : {};

  // Invert: collect all ICP roles that map to this team_label.
  var matches = [];
  Object.keys(roleTeamLabels).forEach(function (icp) {
    if (String(roleTeamLabels[icp] || '').trim() === label) {
      matches.push(icp);
    }
  });

  // Only return if exactly one ICP role maps to this team (unambiguous).
  return matches.length === 1 ? matches[0] : '';
}

/**
 * Priority 4: build a sorted list of unique resource_type values from
 * Config_Resource_Type for the Assign drawer's Role dropdown.
 *
 * Reads directly via readConfigResourceType_ which is the same source
 * used by _classifyTeam_ — single source of truth.
 *
 * Returns a deduped alphabetical list. Roughly 121 entries today.
 */
function _readResourceTypeOptions_() {
  try {
    var rtMap = readConfigResourceType_();
    var seen = {};
    Object.keys(rtMap).forEach(function (k) {
      var key = String(k || '').trim();
      if (key) seen[key] = true;
    });
    return Object.keys(seen).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
  } catch (e) {
    Logger.log('_readResourceTypeOptions_: failed — ' + e);
    return [];
  }
}

// ------------------------------------------------------------
// Cache management

function api_flushCaches() {
  if (typeof invalidateAllCaches_ === 'function') {
    invalidateAllCaches_();
  }
  // Drop 5: also bump the enriched-data cache version.
  if (typeof invalidateEnrichedCaches_ === 'function') {
    invalidateEnrichedCaches_();
  }
  invalidateSoftBookingBaselineCache_();
  return { ok: true, flushedAt: new Date().toISOString() };
}

// ------------------------------------------------------------
// Dashboard / Engine
// ------------------------------------------------------------

function api_getDashboard(params) {
  _requireAuthorized_();
  params = params || {};
  const filterParams = dashboardKpiFilterParams_(params);
  const result = computeUtilization(Object.assign({}, filterParams, {
    quarter: params.quarter
  }));
  const blendedKpis = computeBlendedWindowKpis_(filterParams);
  result.kpis = Object.assign({}, result.kpis, {
    avgIcpProductiveUtilization: Number(blendedKpis.avgIcpProductiveUtilization) || 0,
    avgFinancialUtilization: Number(blendedKpis.avgFinancialUtilization) || 0,
    totalProductiveHours: Number(blendedKpis.totalProductiveHours) || 0,
    totalIcpAvailableHours: Number(blendedKpis.totalIcpAvailableHours) || 0,
    totalRawCapacityHours: Number(blendedKpis.totalRawCapacityHours) || 0,
    scenarioDemandHours: Number(blendedKpis.scenarioDemandHours) || 0,
    overUtilized: blendedKpis.overUtilized || [],
    underUtilized: blendedKpis.underUtilized || [],
    overUtilizedCount: Number(blendedKpis.overUtilizedCount) || 0,
    underUtilizedCount: Number(blendedKpis.underUtilizedCount) || 0,
    windowLabel: String(blendedKpis.windowLabel || ''),
    headcount: Number(blendedKpis.headcount) || 0
  });
  return result;
}

// WFM.18-deprecated: legacy Explorer endpoint. Retained for rollback;
// no callers after WFM.18. Use api_getResourceDetailV2 instead.
function api_getResourceDetail(params) {
  _requireAuthorized_();
  return computeResourceDetail(params);
}

/**
 * WFM.18: Capacity Explorer detail on the canonical weekly/quarter path.
 * @param {Object} params resource + standard filter shape
 * @return {Object}
 */
function api_getResourceDetailV2(params) {
  _requireAuthorized_();
  params = params || {};
  const resourceName = String(params.resource || '');

  const emptyPayload = {
    resource: resourceName,
    found: false,
    weeks: [],
    quarters: [],
    projects: [],
    blendedSummary: null
  };
  if (!resourceName) return emptyPayload;

  const forecast = computeWeeklyForecast_({
    viewMode: params.viewMode,
    scenarioId: params.scenarioId,
    teams: params.teams,
    teamLabel: params.teamLabel,
    workerScope: params.workerScope,
    includeMyManagers: params.includeMyManagers,
    includeTimeOff: params.includeTimeOff
  });

  const w = (forecast.workers || []).find(function (worker) {
    return worker.resource === resourceName;
  });
  if (!w) return emptyPayload;

  const visibleWeeks = _deriveVisibleWeeksFiscal_(forecast.weeks);
  const rawCapacity = Number(forecast.rawCapacity) || 40;
  const holidayHoursByWeek = forecast.holidayHoursByWeek || {};
  const icpTarget = Number(w.icpTarget) || 0;

  const weeksOut = visibleWeeks.map(function (vw) {
    const labelDate = new Date(
      vw.week_start.getFullYear(),
      vw.week_start.getMonth(),
      vw.week_start.getDate() + 1
    );
    const cell = (w.blendedWeekly && w.blendedWeekly[vw.week_key]) || { hours: 0, isActual: false };
    const hours = Number(cell.hours) || 0;
    const holidayHours = Number(holidayHoursByWeek[vw.week_key] || 0);
    const icpAvailable = rawCapacity - holidayHours;
    const icpUtil = icpAvailable > 0 ? (hours / icpAvailable) : 0;
    const financeUtil = rawCapacity > 0 ? (hours / rawCapacity) : 0;
    const ratioToTarget = icpTarget > 0 ? (icpUtil / icpTarget) : 0;
    return {
      weekKey: String(vw.week_key),
      weekStart: _toIso_(vw.week_start),
      label: Utilities.formatDate(labelDate, Session.getScriptTimeZone() || 'Etc/UTC', 'MM/dd/yy'),
      fiscalQuarter: String(vw.fiscal_quarter || ''),
      fiscalQuarterKey: String(fiscalQuarterKey_(vw.week_start) || ''),
      hours: Number(hours) || 0,
      icpUtil: Number(icpUtil) || 0,
      financeUtil: Number(financeUtil) || 0,
      icpTarget: Number(icpTarget) || 0,
      ratioToTarget: Number(ratioToTarget) || 0,
      icpAvailable: Number(icpAvailable) || 0,
      holidayHours: Number(holidayHours) || 0,
      isActual: !!cell.isActual
    };
  });

  const holidays = readHolidays_();
  const actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
    ? getActualsSummaryByEmployee_() : {};
  const settings = readSettings_();
  const curQ = fiscalQuarterKey_(new Date());
  const quartersOut = buildWorkerQuarters_(
    w,
    rollingQuarterKeys_(4),
    forecast.weeks,
    holidays,
    actualsSummary,
    settings,
    curQ
  );

  const projectsOut = Object.keys(w.projects || {}).sort().map(function (proj) {
    return {
      project: String(proj),
      weekly: visibleWeeks.map(function (vw) {
        return {
          weekKey: String(vw.week_key),
          hours: Number((w.projects[proj] || {})[vw.week_key] || 0) || 0
        };
      })
    };
  });

  let totalProductive = 0;
  let totalIcpAvailable = 0;
  let totalRawCapacity = 0;
  visibleWeeks.forEach(function (vw) {
    const wk = vw.week_key;
    const prod = productiveHoursForWeek_(w, wk);
    const holidayHrs = Number(holidayHoursByWeek[wk] || 0);
    const icpAvail = rawCapacity - holidayHrs;
    totalProductive += prod;
    totalIcpAvailable += icpAvail;
    totalRawCapacity += rawCapacity;
  });

  let peakWeekKey = '';
  let peakIcpUtil = 0;
  weeksOut.forEach(function (cell) {
    if (cell.icpUtil > peakIcpUtil) {
      peakIcpUtil = cell.icpUtil;
      peakWeekKey = cell.weekKey;
    }
  });

  const avgIcpProductiveUtilization = totalIcpAvailable > 0 ? totalProductive / totalIcpAvailable : 0;
  const avgFinancialUtilization = totalRawCapacity > 0 ? totalProductive / totalRawCapacity : 0;
  const blendedRatioToTarget = icpTarget > 0 ? avgIcpProductiveUtilization / icpTarget : 0;

  return {
    resource: resourceName,
    found: true,
    weeks: weeksOut,
    quarters: quartersOut,
    projects: projectsOut,
    blendedSummary: {
      avgIcpProductiveUtilization: Number(avgIcpProductiveUtilization) || 0,
      avgFinancialUtilization: Number(avgFinancialUtilization) || 0,
      totalProductiveHours: Number(totalProductive) || 0,
      isOverUtilized: blendedRatioToTarget > 1.05,
      isUnderUtilized: blendedRatioToTarget < 0.75,
      peakWeek: {
        weekKey: String(peakWeekKey || ''),
        icpUtil: Number(peakIcpUtil) || 0
      },
      windowLabel: String(blendedFiscalWindowLabel_() || '')
    }
  };
}

/**
 * WFM.17: Team quarterly scorecard (rolling four fiscal quarters).
 * @param {Object} params same shape as api_getDashboard
 * @return {Object}
 */
function api_getQuarterlyScorecard(params) {
  _requireAuthorized_();
  return computeQuarterlyScorecard_(params || {});
}

// ------------------------------------------------------------
// WFM.23 — Soft booking projection (Stage 1)
// ------------------------------------------------------------

/** Per-execution baseline forecast cache keyed on filter signature (§9a). */
var _softBookingBaselineCache_ = { signature: '', forecast: null };

/**
 * Clear WFM.23 projection baseline cache (called from api_flushCaches).
 */
function invalidateSoftBookingBaselineCache_() {
  _softBookingBaselineCache_.signature = '';
  _softBookingBaselineCache_.forecast = null;
}

/**
 * Stable filter signature for projection baseline caching.
 * Mirrors computeWeeklyForecast_ param defaults.
 * @param {Object} params
 * @return {string}
 */
function _projectionFilterSignature_(params) {
  params = params || {};
  return JSON.stringify({
    viewMode: params.viewMode || 'Committed',
    scenarioId: params.scenarioId || null,
    teams: params.teams || null,
    teamLabel: params.teamLabel ? String(params.teamLabel).trim() : '',
    workerScope: params.workerScope || 'SLG',
    includeMyManagers: !!params.includeMyManagers,
    includeTimeOff: params.includeTimeOff !== false
  });
}

/**
 * Baseline computeWeeklyForecast_ with per-signature in-memory cache.
 * @param {Object} forecastParams
 * @return {{forecast:Object, cacheHit:boolean}}
 */
function _getCachedBaselineForecast_(forecastParams) {
  var sig = _projectionFilterSignature_(forecastParams);
  if (_softBookingBaselineCache_.signature === sig && _softBookingBaselineCache_.forecast) {
    return { forecast: _softBookingBaselineCache_.forecast, cacheHit: true };
  }
  var forecast = computeWeeklyForecast_(forecastParams);
  _softBookingBaselineCache_.signature = sig;
  _softBookingBaselineCache_.forecast = forecast;
  return { forecast: forecast, cacheHit: false };
}

/**
 * Fiscal quarter keys touched by soft-booking date ranges (dynamic, cap 8).
 * Empty bookings ⇒ rolling four quarters (Explorer default window).
 * @param {Array<{start_date:*, end_date:*}>} softBookings
 * @return {string[]}
 */
function _quarterKeysForSoftBookings_(softBookings) {
  if (!softBookings || !softBookings.length) {
    return rollingQuarterKeys_(4);
  }
  var minDate = null;
  var maxDate = null;
  softBookings.forEach(function (sb) {
    var s = sb.start_date ? new Date(sb.start_date) : null;
    var e = sb.end_date ? new Date(sb.end_date) : null;
    if (s && !isNaN(s.getTime()) && (!minDate || s < minDate)) minDate = s;
    if (e && !isNaN(e.getTime()) && (!maxDate || e > maxDate)) maxDate = e;
  });
  if (!minDate || !maxDate) return rollingQuarterKeys_(4);

  var keys = [];
  var qk = fiscalQuarterKey_(minDate);
  var endQk = fiscalQuarterKey_(maxDate);
  var safety = 0;
  while (safety < 12) {
    keys.push(qk);
    if (qk === endQk) break;
    var bounds = fiscalQuarterBounds_(qk);
    var nextStart = new Date(bounds.end.getFullYear(), bounds.end.getMonth() + 1, 1);
    qk = fiscalQuarterKey_(nextStart);
    safety++;
  }
  if (keys.indexOf(endQk) < 0) keys.push(endQk);
  return keys.slice(0, 8);
}

/**
 * Quarter capacity for soft-booking projection. Quarters beyond the last
 * configured holiday year are holiday-free with approximate:true (D4a).
 * @param {string} quarterKey
 * @param {Array<{date:Date, hours:number}>} holidays
 * @return {{icpAvailableHours:number, rawCapacityHours:number, approximate:boolean}}
 */
function _quarterCapacityForProjection_(quarterKey, holidays) {
  var maxHolidayYear = 0;
  (holidays || []).forEach(function (h) {
    if (h.date) {
      var y = h.date.getFullYear();
      if (y > maxHolidayYear) maxHolidayYear = y;
    }
  });
  var bounds = fiscalQuarterBounds_(quarterKey);
  var approximate = bounds.end.getFullYear() > maxHolidayYear;
  var effectiveHolidays = approximate ? [] : holidays;
  var wd = quarterWorkdaySummary_(quarterKey, effectiveHolidays);
  return {
    icpAvailableHours: Number(wd.icpAvailableHours) || 0,
    rawCapacityHours: Number(wd.rawCapacityHours) || 0,
    approximate: approximate
  };
}

/**
 * Build worker / team / org-team quarterly aggregates from a forecast.
 * @param {Object} forecast computeWeeklyForecast_ result
 * @param {string[]} quarterKeys
 * @param {Array<{date:Date, hours:number}>} holidays
 * @return {{worker:Object[], team:Object, orgTeams:Object[]}}
 */
function _aggregateSoftBookingProjection_(forecast, quarterKeys, holidays) {
  var weeks = forecast.weeks || [];
  var workers = forecast.workers || [];

  function quarterCell_(productiveHours, qk) {
    var qinfo = _quarterCapacityForProjection_(qk, holidays);
    var icpAvail = qinfo.icpAvailableHours;
    var rawCap = qinfo.rawCapacityHours;
    var prod = Number(productiveHours) || 0;
    return {
      quarterKey: String(qk),
      productiveHours: prod,
      icpAvailableHours: icpAvail,
      rawCapacityHours: rawCap,
      icpUtil: icpAvail > 0 ? prod / icpAvail : 0,
      financeUtil: rawCap > 0 ? prod / rawCap : 0,
      approximate: !!qinfo.approximate
    };
  }

  var workerOut = workers.map(function (w) {
    return {
      employeeId: String(w.employeeId || ''),
      resourceName: String(w.resource || ''),
      teamLabel: String(w.teamLabel || ''),
      managerOrg: String(w.managerOrg || ''),
      quarters: quarterKeys.map(function (qk) {
        return quarterCell_(sumForecastProductiveForQuarter_(w, qk, weeks), qk);
      })
    };
  });

  var teamQuarters = quarterKeys.map(function (qk) {
    var sumProd = 0;
    var sumIcpAvail = 0;
    var sumRawCap = 0;
    var approx = false;
    workers.forEach(function (w) {
      sumProd += sumForecastProductiveForQuarter_(w, qk, weeks);
      var qinfo = _quarterCapacityForProjection_(qk, holidays);
      sumIcpAvail += qinfo.icpAvailableHours;
      sumRawCap += qinfo.rawCapacityHours;
      if (qinfo.approximate) approx = true;
    });
    return {
      quarterKey: String(qk),
      productiveHours: Number(sumProd) || 0,
      icpAvailableHours: Number(sumIcpAvail) || 0,
      rawCapacityHours: Number(sumRawCap) || 0,
      icpUtil: sumIcpAvail > 0 ? sumProd / sumIcpAvail : 0,
      financeUtil: sumRawCap > 0 ? sumProd / sumRawCap : 0,
      approximate: approx
    };
  });

  var byLabel = {};
  workers.forEach(function (w) {
    var label = String(w.teamLabel || 'Unclassified');
    if (!byLabel[label]) byLabel[label] = [];
    byLabel[label].push(w);
  });
  var orgTeamsOut = Object.keys(byLabel).sort().map(function (label) {
    var group = byLabel[label];
    var quarters = quarterKeys.map(function (qk) {
      var sumProd = 0;
      var sumIcpAvail = 0;
      var sumRawCap = 0;
      var approx = false;
      group.forEach(function (w) {
        sumProd += sumForecastProductiveForQuarter_(w, qk, weeks);
        var qinfo = _quarterCapacityForProjection_(qk, holidays);
        sumIcpAvail += qinfo.icpAvailableHours;
        sumRawCap += qinfo.rawCapacityHours;
        if (qinfo.approximate) approx = true;
      });
      return {
        quarterKey: String(qk),
        productiveHours: Number(sumProd) || 0,
        icpAvailableHours: Number(sumIcpAvail) || 0,
        rawCapacityHours: Number(sumRawCap) || 0,
        icpUtil: sumIcpAvail > 0 ? sumProd / sumIcpAvail : 0,
        financeUtil: sumRawCap > 0 ? sumProd / sumRawCap : 0,
        approximate: approx
      };
    });
    return { teamLabel: String(label), quarters: quarters };
  });

  return {
    worker: workerOut,
    team: { quarters: teamQuarters },
    orgTeams: orgTeamsOut
  };
}

/**
 * WFM.23: project soft-booking overlay utilization at worker / team /
 * org-team levels. Empty softBookings ⇒ projected deep-equals baseline.
 * @param {Object} params standard buildServerParams_ shape
 * @param {Array<{employee_id:string, resource_name:string, start_date:*, end_date:*, total_hours:number}>} softBookings
 * @return {{baseline:Object, projected:Object}}
 */
function api_projectSoftBookings(params, softBookings) {
  _requireAuthorized_();
  var t0 = Date.now();
  params = params || {};
  softBookings = softBookings || [];

  var forecastParams = {
    viewMode: params.viewMode,
    scenarioId: params.scenarioId,
    teams: params.teams,
    teamLabel: params.teamLabel,
    workerScope: params.workerScope,
    includeMyManagers: params.includeMyManagers,
    includeTimeOff: params.includeTimeOff
  };

  var baselineCached = _getCachedBaselineForecast_(forecastParams);
  var baselineForecast = baselineCached.forecast;
  var baselineCacheHit = baselineCached.cacheHit;
  var holidays = readHolidays_();
  var quarterKeys = _quarterKeysForSoftBookings_(softBookings);

  var inMemoryModeledAssignments = softBookings.map(function (sb) {
    return {
      resource_name: String(sb.resource_name || ''),
      employee_id: String(sb.employee_id || ''),
      start_date: sb.start_date ? new Date(sb.start_date) : null,
      end_date: sb.end_date ? new Date(sb.end_date) : null,
      estimated_hours: Number(sb.total_hours) || 0,
      distribution: 'Even',
      status: 'Modeled'
    };
  }).filter(function (a) {
    return a.resource_name && a.start_date && a.end_date && !isNaN(a.start_date.getTime()) &&
      !isNaN(a.end_date.getTime()) && a.estimated_hours > 0;
  });

  var projectedForecast = baselineForecast;
  if (inMemoryModeledAssignments.length) {
    var projectedParams = Object.assign({}, forecastParams, {
      inMemoryModeledAssignments: inMemoryModeledAssignments
    });
    projectedForecast = computeWeeklyForecast_(projectedParams);
  }

  var result = {
    baseline: _aggregateSoftBookingProjection_(baselineForecast, quarterKeys, holidays),
    projected: _aggregateSoftBookingProjection_(projectedForecast, quarterKeys, holidays)
  };

  Logger.log('api_projectSoftBookings: elapsed ' + (Date.now() - t0) + 'ms' +
    ' baselineCache=' + (baselineCacheHit ? 'hit' : 'miss') +
    ' workers=' + (baselineForecast.workers || []).length +
    ' quarters=' + quarterKeys.length +
    ' bookings=' + softBookings.length);
  return result;
}

// ------------------------------------------------------------
// Weekly Forecast Table (weekly-forecast-migration §8)
//
// Powers the redesigned Dashboard's weekly table. Built on
// computeWeeklyForecast_ (Engine.gs) + the same buildServerParams_-style
// filter pass-through as api_getDashboard. Visible weeks are DERIVED from
// planning_window_months (§4.6, locked) rather than a separate weeks
// setting, to minimize config churn.
// ------------------------------------------------------------

/**
 * Derive the visible week set from the planning-window-months setting
 * (locked derivation, §4.6): weeks whose week_start falls within
 * [first of current month, first of current month + windowMonths).
 * Mirrors buildPlanningWindow_'s month-window math (Engine.gs).
 * @param {Array<{week_start:Date}>} weeks sorted calendar weeks (readCalendar_().weeks)
 * @param {number} windowMonths
 * @return {Array} the subset of weeks within the window, in order
 */
function _deriveVisibleWeeks_(weeks, windowMonths) {
  const now = new Date();
  const winStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const winEnd = new Date(now.getFullYear(), now.getMonth() + windowMonths, 1);
  return (weeks || []).filter(w => w.week_start >= winStart && w.week_start < winEnd);
}

/**
 * Visible weeks for the blended forecast table: current fiscal quarter
 * (captures QTD actuals) through the end of the next fiscal quarter.
 * Fiscal quarters are Feb-anchored (see fiscalQuarterKey_ / Constants).
 */
function _deriveVisibleWeeksFiscal_(weeks) {
  const today = new Date();
  const curQ = fiscalQuarterKey_(today);          // e.g. 'FY27-Q2'
  // Next fiscal quarter key: advance ~3 months and recompute.
  const nextQDate = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  const nextQ = fiscalQuarterKey_(nextQDate);
  return (weeks || []).filter(function (w) {
    const qk = fiscalQuarterKey_(w.week_start);
    return qk === curQ || qk === nextQ;
  });
}

/**
 * WFM.15: cell metrics are now the Productive Utilization Model --
 * icpUtil (PRIMARY, nets holiday hours out of available capacity) and
 * financeUtil (SECONDARY, no holiday netting) computed from productive
 * demand (PTO/Holiday allocation rows excluded from the numerator).
 * ratioToTarget = icpUtil / icpTarget drives client coloring (bands
 * unchanged; WFM.14 moves them to config later). Displayed `hours` stays
 * PTO/Holiday-inclusive per the includeTimeOff toggle -- calc/display
 * divergence is intentional.
 * @param {Object} params same shape as api_getDashboard's params
 * @return {{
 *   weeks: Array<{weekKey:string, weekStart:string, label:string, fiscalQuarter:string, fiscalQuarterKey:string}>,
 *   rows: Array<{worker:string, level:string, jobProfile:string, manager:string, managersManager:string,
 *                icpTarget:number, rawCapacity:number,
 *                workerWeekly: Array<{weekKey:string, hours:number, icpUtil:number, financeUtil:number,
 *                                     icpTarget:number, ratioToTarget:number, icpAvailable:number,
 *                                     holidayHours:number}>,
 *                projects: Array<{project:string, weekly: Array<{weekKey:string, hours:number}>}>}>,
 *   planningWindowWeeks: number
 * }}
 */
function api_getForecastTable(params) {
  _requireAuthorized_();
  params = params || {};

  const forecast = computeWeeklyForecast_({
    viewMode: params.viewMode,
    scenarioId: params.scenarioId,
    teams: params.teams,
    teamLabel: params.teamLabel,
    workerScope: params.workerScope,
    includeMyManagers: params.includeMyManagers,
    includeTimeOff: params.includeTimeOff
  });

  const windowMonths = (typeof readPlanningWindowMonths_ === 'function')
    ? readPlanningWindowMonths_() : 6;
  const visibleWeeks = _deriveVisibleWeeksFiscal_(forecast.weeks);

  const weeksOut = visibleWeeks.map(w => {
    // Display label shows the SUNDAY of the week (week_start is the Saturday
    // export anchor). Data stays Saturday-anchored; this is display-only.
    const labelDate = new Date(
      w.week_start.getFullYear(),
      w.week_start.getMonth(),
      w.week_start.getDate() + 1
    );
    return {
      weekKey: String(w.week_key),
      weekStart: _toIso_(w.week_start),
      label: Utilities.formatDate(labelDate, Session.getScriptTimeZone() || 'Etc/UTC', 'MM/dd/yy'),
      fiscalQuarter: String(w.fiscal_quarter || ''),
      fiscalQuarterKey: fiscalQuarterKey_(w.week_start)
    };
  });

  const rawCapacity = Number(forecast.rawCapacity) || 40;
  const holidayHoursByWeek = forecast.holidayHoursByWeek || {};

  const rowsOut = forecast.workers.map(w => {
    const icpTarget = Number(w.icpTarget) || 0;
    const workerWeekly = visibleWeeks.map(vw => {
      const cell = (w.blendedWeekly && w.blendedWeekly[vw.week_key]) || { hours: 0, isActual: false };
      const hours = Number(cell.hours) || 0;
      const holidayHours = Number(holidayHoursByWeek[vw.week_key] || 0);
      const icpAvailable = rawCapacity - holidayHours;
      const icpUtil = icpAvailable > 0 ? (hours / icpAvailable) : 0;
      const financeUtil = rawCapacity > 0 ? (hours / rawCapacity) : 0;
      const ratioToTarget = icpTarget > 0 ? (icpUtil / icpTarget) : 0;
      return {
        weekKey:       String(vw.week_key),
        hours:         Number(hours) || 0,
        icpUtil:       Number(icpUtil) || 0,
        financeUtil:   Number(financeUtil) || 0,
        icpTarget:     Number(icpTarget) || 0,
        ratioToTarget: Number(ratioToTarget) || 0,
        icpAvailable:  Number(icpAvailable) || 0,
        holidayHours:  Number(holidayHours) || 0,
        isActual:      !!cell.isActual
      };
    });
    const projects = Object.keys(w.projects).sort().map(proj => ({
      project: String(proj),
      weekly: visibleWeeks.map(vw => ({
        weekKey: String(vw.week_key),
        hours:   Number(w.projects[proj][vw.week_key] || 0)
      }))
    }));
    return {
      worker:          String(w.resource),
      level:           String(w.level || ''),
      jobProfile:      String(w.jobProfile || ''),
      manager:         String(w.managerOrg || ''),
      managersManager: String(w.managersManager || ''),
      icpTarget:       icpTarget,
      rawCapacity:     rawCapacity,
      workerWeekly:    workerWeekly,
      projects:        projects
    };
  });

  let seamWeekKey = '';
  visibleWeeks.forEach(function (vw) {
    const wk = String(vw.week_key);
    const hasActual = rowsOut.some(function (row) {
      const cell = row.workerWeekly.find(function (c) { return c.weekKey === wk; });
      return cell && cell.isActual;
    });
    if (hasActual) seamWeekKey = wk;
  });

  return {
    weeks:               weeksOut,
    rows:                rowsOut,
    planningWindowWeeks: visibleWeeks.length,
    seamWeekKey:         seamWeekKey
  };
}

// ------------------------------------------------------------
// Reporting & Metrics summary
//
// Practice-based attribution for External rows is enabled here.
//   SLG rows: filtered by direct manager_org match against effectiveManagers.
//   External rows: filtered by resolved practice owners; if any owner is
//     in effectiveManagers, the row passes.
//
// Priority 2 — Team filter:
//   When params.teamLabel is set, manager filtering is suppressed
//   (effectiveManagers forced null) and rows are filtered by their
//   resolved team_label via _classifyTeam_.
// ------------------------------------------------------------

function api_getReportingSummary(params) {
  _requireAuthorized_();
  params = params || {};
  const workerScope = String(params.workerScope || 'All');
  const viewMode = String(params.viewMode || 'Committed');
  const scenarioId = params.scenarioId || null;

  // Priority 2: Team filter. When set, overrides Manager filter.
  const teamLabelFilter = params.teamLabel
    ? String(params.teamLabel).trim()
    : '';

  const KNOWN_SCOPES = {
    SLG: 1, NonSLG: 1, Partners: 1, WorkdayOnly: 1, All: 1, External: 1, Both: 1
  };
  if (!KNOWN_SCOPES[workerScope]) {
    Logger.log('api_getReportingSummary: unrecognized workerScope "' + workerScope + '"; returning empty-ish result.');
  }

  // ----- Filter setup -----
  const teamsFilter = params.teams && params.teams.length ? new Set(params.teams) : null;
  const excluded = (typeof readExclusions_ === 'function') ? readExclusions_() : new Set();

  const windowMonths = (typeof readPlanningWindowMonths_ === 'function')
    ? readPlanningWindowMonths_() : 6;
  const windowKeys = {};
  const now = new Date();
  for (let i = 0; i < windowMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    windowKeys[key] = true;
  }

  // Fiscal quarter filter (weekly-forecast-migration §4/§13): params.quarter
  // is now a fiscal quarter key ('FY<yy>-Q<n>', e.g. 'FY27-Q2'), matching
  // fiscalQuarterKey_ / api_getReference's quarters list / the client's
  // #quarterFilter. Replaces the old calendar Math.floor(month/3) mapping.
  let quarterKeys = null;
  if (params.quarter) {
    quarterKeys = {};
    Object.keys(windowKeys).forEach(mk => {
      const d = monthKeyToDate_(mk);
      if (fiscalQuarterKey_(d) === params.quarter) quarterKeys[mk] = true;
    });
    if (!Object.keys(quarterKeys).length) quarterKeys = null;
  }

  function monthKeyOf_(d) {
    if (!d) return '';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
  }
  function inWindow_(mk) {
    if (!mk) return false;
    if (quarterKeys) return !!quarterKeys[mk];
    return !!windowKeys[mk];
  }
  const monthsInScope = Object.keys(quarterKeys || windowKeys).length;

  // Manager hierarchy — suppressed when teamLabelFilter is set.
  let effectiveManagers = null;
  if (teamsFilter && !teamLabelFilter) {
    let mgrRows = [];
    try {
      if (typeof readConfigSlgManagers_ === 'function') {
        mgrRows = readConfigSlgManagers_();
      }
    } catch (e) { mgrRows = []; }
    const managersByName = {};
    mgrRows.forEach(r => { managersByName[r.manager_name] = r; });

    let descendants = {};
    try {
      if (typeof buildManagerDescendants_ === 'function') {
        descendants = buildManagerDescendants_(mgrRows);
      }
    } catch (e) { descendants = {}; }

    effectiveManagers = {};
    teamsFilter.forEach(name => {
      effectiveManagers[name] = true;
      if (params.includeMyManagers) {
        const row = managersByName[name];
        if (row && String(row.include_descendants || '').toUpperCase() === 'Y') {
          (descendants[name] || []).forEach(m => { effectiveManagers[m] = true; });
        }
      }
    });
  }

  function inScopeWorkerClass_(wcRaw) {
    const cls = String(wcRaw || '');
    if (!cls) return false;
    switch (workerScope) {
      case 'SLG': return cls === 'SLG_Real' || cls === 'SLG_Generic';
      case 'NonSLG': return cls === 'External_NonSLG';
      case 'Partners': return cls === 'External_Contractor';
      case 'WorkdayOnly':
        return cls === 'SLG_Real' || cls === 'SLG_Generic' || cls === 'External_NonSLG';
      case 'All':
        return cls === 'SLG_Real' || cls === 'SLG_Generic' ||
               cls === 'External_NonSLG' || cls === 'External_Contractor';
      case 'External':
        return cls === 'External_NonSLG' || cls === 'External_Contractor';
      case 'Both':
        return cls === 'SLG_Real' || cls === 'SLG_Generic' ||
               cls === 'External_NonSLG' || cls === 'External_Contractor';
      default:
        return false;
    }
  }

  let settings = {};
  try {
    if (typeof readSettings_ === 'function') settings = readSettings_() || {};
  } catch (e) { settings = {}; }
  const hideAllExternal = String(settings['hide_all_external'] || '')
    .trim().toLowerCase() === 'true';
  // weekly-forecast-migration: PSA rows and assignment expansion are now
  // weekly-grain; roll each week's hours up to the calendar month(s) it
  // overlaps via splitWeekAcrossMonths_ (proportional, sum-exact) so the
  // rest of this reporting function is unchanged (out of scope for redesign).
  const splitBasis = String(settings.week_month_split_basis || 'calendar');

  function effectiveInScope_(wc) {
    if (hideAllExternal && String(wc || '').indexOf('External_') === 0) return false;
    return inScopeWorkerClass_(wc);
  }

  // ----- Data sources -----
  // Drop 5: use enriched alloc rows to avoid rebuilding per-worker enrichment
  // in the assignments overlay below. Falls back to raw read if EnrichedData.gs
  // not yet available.
  const rows = (typeof getEnrichedAllocations_ === 'function')
    ? getEnrichedAllocations_() : readTable_(ALLOC_NORM);
  const rtMap = readConfigResourceType_();

  // Drop 5: build unified resolver ctx once per request.
  const _repCtx_ = (typeof resolveTeamLabel_ === 'function')
    ? resolveTeamLabel_.buildCtx_(
        typeof readRoleTeamLabels_ === 'function' ? readRoleTeamLabels_() : {},
        rtMap
      )
    : null;

  const rtRichMap = (typeof readConfigResourceTypeRich_ === 'function')
    ? readConfigResourceTypeRich_() : {};
  const practiceMgrMap = (typeof readConfigPracticeManagers_ === 'function' &&
                          typeof buildPracticeManagerMap_ === 'function')
    ? buildPracticeManagerMap_(readConfigPracticeManagers_())
    : {};

  let roleCap = {};
  try {
    if (typeof readRoleCapacity_ === 'function') roleCap = readRoleCapacity_() || {};
  } catch (e) { roleCap = {}; }

  // ----- Row predicate combining manager filter + team filter -----
  // Returns { pass, viaPractice }. teamLabelFilter is checked first;
  // if it fails, no need to check manager. If teamLabelFilter is set,
  // effectiveManagers is null and the manager-filter branch is a no-op.
  function _rowPassesManagerFilter_(row) {
    // Team filter check (Priority 2)
    // Drop 5: use unified resolver when available; fall back to _classifyTeam_.
    if (teamLabelFilter) {
      const rowTeam = (_repCtx_ && typeof resolveTeamLabel_ === 'function')
        ? resolveTeamLabel_(row, _repCtx_)
        : _classifyTeam_(row, rtMap);
      if (rowTeam !== teamLabelFilter) {
        return { pass: false, viaPractice: false };
      }
    }

    if (!effectiveManagers) return { pass: true, viaPractice: false };

    const wc = String((row && row.worker_class) || '');
    const isExternal = wc.indexOf('External_') === 0;

    const raw = String((row && row.manager_org) || '');
    const mgrNorm = (typeof normalizeManagerName_ === 'function')
      ? normalizeManagerName_(raw) : raw;
    const directMatch = !!effectiveManagers[mgrNorm];

    if (!isExternal) {
      return { pass: directMatch, viaPractice: false };
    }

    let practiceMatch = false;
    if (typeof resolveOwnersForRow_ === 'function') {
      const owners = resolveOwnersForRow_(row, rtRichMap, practiceMgrMap) || [];
      for (let i = 0; i < owners.length; i++) {
        const ownerNorm = (typeof normalizeManagerName_ === 'function')
          ? normalizeManagerName_(owners[i] || '')
          : (owners[i] || '');
        if (ownerNorm && ownerNorm !== mgrNorm && effectiveManagers[ownerNorm]) {
          practiceMatch = true;
          break;
        }
      }
    }

    if (directMatch) return { pass: true, viaPractice: false };
    if (practiceMatch) return { pass: true, viaPractice: true };
    return { pass: false, viaPractice: false };
  }

  // ----- Accumulators -----
  const wcBucket = { SLG_Real: 0, SLG_Generic: 0, External_NonSLG: 0, External_Contractor: 0 };
  let scopeFilteredOutHours = 0;
  let externalHoursByPracticeOwnership = 0;

  const byTeamHours = {};
  const byAcctHours = {};
  const byRoleCategoryHrs = {};
  const byJobProfileHrs = {};

  const teamRC = {};
  const teamAccts = {};
  const teamProjs = {};
  const teamWC = {};

  const acctRoles = {};
  const acctProjs = {};
  const acctWC = {};

  const unmappedSamples = {};
  const blankClassWorkers = {};
  const distinctWorkers = {};
  const distinctCapacity = {};

  function addBreakdown_(map, outerKey, innerKey, h) {
    if (!map[outerKey]) map[outerKey] = {};
    map[outerKey][innerKey] = (map[outerKey][innerKey] || 0) + h;
  }

  function roleForCapacity_(row) {
    return String(row.ICP_role || row.role_category || row.resource_type || 'Unclassified');
  }

  // ----- PSA rows -----
  // weekly-forecast-migration: r.hours is now a WEEK's hours (r.week_start).
  // Roll each row's hours up to whichever calendar month(s) the window
  // check cares about via splitWeekAcrossMonths_, then sum the in-window
  // portion into hWindow. All downstream accumulators below are flat sums
  // (not month-keyed), so a single hWindow-scaled pass reproduces the exact
  // same shape as before while reconciling exactly against weekly totals.
  rows.forEach(r => {
    const h = Number(r.hours) || 0;
    if (!h || !r.week_start) return;
    const parts = splitWeekAcrossMonths_(r.week_start, h, splitBasis);
    const hWindow = parts.reduce((s, p) => s + (inWindow_(p.monthKey) ? p.hours : 0), 0);
    if (!hWindow) return;
    if (excluded.has(_exclusionKey_(r.resource_name))) return;

    const mgrCheck = _rowPassesManagerFilter_(r);
    if (!mgrCheck.pass) return;

    const wc = String(r.worker_class || '');
    if (!wc) {
      blankClassWorkers[r.resource_name] = (blankClassWorkers[r.resource_name] || 0) + hWindow;
    }

    if (!effectiveInScope_(wc)) {
      scopeFilteredOutHours += hWindow;
      return;
    }

    if (wcBucket[wc] !== undefined) { wcBucket[wc] += hWindow; }
    if (mgrCheck.viaPractice && wc.indexOf('External_') === 0) {
      externalHoursByPracticeOwnership += hWindow;
    }

    // Drop 5: use enriched team_label if present, otherwise resolve via unified resolver.
    const teamKey = (r.team_label) ||
      ((_repCtx_ && typeof resolveTeamLabel_ === 'function')
        ? resolveTeamLabel_(r, _repCtx_)
        : _classifyTeam_(r, rtMap));
    if (teamKey === 'Unclassified') {
      const sig = (r.role_category || '(blank)') + ' | ' + (r.resource_type || '(blank)');
      unmappedSamples[sig] = (unmappedSamples[sig] || 0) + hWindow;
    }
    const acct = String(r.account_name || '') || '(No account)';
    const proj = String(r.project_name || '') || '(No project)';
    const roleCat = String(r.role_category || 'Unclassified');
    const jobProf = String(r.job_profile || 'Unspecified');
    const roleCapKey = roleForCapacity_(r);

    byTeamHours[teamKey] = (byTeamHours[teamKey] || 0) + hWindow;
    byAcctHours[acct] = (byAcctHours[acct] || 0) + hWindow;
    byRoleCategoryHrs[roleCat] = (byRoleCategoryHrs[roleCat] || 0) + hWindow;
    byJobProfileHrs[jobProf] = (byJobProfileHrs[jobProf] || 0) + hWindow;

    addBreakdown_(teamRC, teamKey, roleCat, hWindow);
    addBreakdown_(teamAccts, teamKey, acct, hWindow);
    addBreakdown_(teamProjs, teamKey, acct + '||' + proj, hWindow);
    addBreakdown_(teamWC, teamKey, wc, hWindow);

    addBreakdown_(acctRoles, acct, roleCat, hWindow);
    addBreakdown_(acctProjs, acct, proj, hWindow);
    addBreakdown_(acctWC, acct, wc, hWindow);

    distinctWorkers[r.resource_name] = true;
    if (!distinctCapacity[r.resource_name]) {
      const cap = roleCap[roleCapKey] || roleCap[r.resource_type] || 160;
      distinctCapacity[r.resource_name] = { capacity: cap };
    }
  });

  // ----- Assignments overlay -----
  if (viewMode !== 'Actual') {
    // Drop 5: use enriched assignments when available — each assignment already
    // carries the worker's class and enrichment, eliminating the redundant
    // alloc-scan below. Fall back to raw read + rebuild for safety.
    let assigns = [];
    const useEnrichedAssigns = typeof getEnrichedAssignments_ === 'function';
    try {
      assigns = useEnrichedAssigns
        ? getEnrichedAssignments_()
        : (readTable_(ASSIGNMENTS) || []);
    } catch (e) { assigns = []; }

    // Build per-worker enrichment from alloc rows (only needed when not using
    // enriched assignments, e.g. during the first deploy before the cache warms).
    const workerClassByName = {};
    const workerEnrichmentByName = {};
    if (!useEnrichedAssigns) {
      rows.forEach(r => {
        const n = r.resource_name;
        if (n && !workerClassByName[n]) {
          workerClassByName[n] = String(r.worker_class || '');
          workerEnrichmentByName[n] = {
            role_category: r.role_category || '',
            job_profile: r.job_profile || '',
            project_role: r.project_role || '',
            resource_type: r.resource_type || '',
            account_name: r.account_name || '',
            ICP_role: r.ICP_role || '',
            manager_org: r.manager_org || ''
          };
        }
      });
    } else {
      // Enriched assignments carry all worker fields directly.
      rows.forEach(r => {
        const n = r.resource_name;
        if (n && !workerClassByName[n]) {
          workerClassByName[n] = String(r.worker_class || '');
        }
      });
    }
    try {
      if (typeof readGenericResources_ === 'function') {
        readGenericResources_().forEach(g => {
          if (g.name && !workerClassByName[g.name]) {
            workerClassByName[g.name] = 'SLG_Generic';
          }
        });
      }
    } catch (e) {}

    let calendar = {};
    try {
      if (typeof readCalendar_ === 'function') calendar = readCalendar_() || {};
    } catch (e) { calendar = {}; }

    assigns.forEach(a => {
      if (!a.resource_name) return;
      if (excluded.has(_exclusionKey_(a.resource_name))) return;

      // Drop 5: enriched assignments carry all worker fields directly;
      // fall back to the per-worker lookup maps for non-enriched path.
      const wc = a.worker_class || workerClassByName[a.resource_name] || '';
      const enrichment = useEnrichedAssigns ? a : (workerEnrichmentByName[a.resource_name] || {});

      const fakeRow = {
        worker_class:  wc,
        team_label:    a.team_label || undefined,
        icp_role:      a.icp_role   || enrichment.ICP_role || '',
        manager_org:   a.manager_org   || enrichment.manager_org   || '',
        role_category: a.role_category || enrichment.role_category || '',
        job_profile:   a.job_profile   || enrichment.job_profile   || '',
        project_role:  a.project_role  || enrichment.project_role  || '',
        resource_type: a.resource_type || enrichment.resource_type || '',
        account_name:  a.account_name  || enrichment.account_name  || '',
        ICP_role:      a.icp_role      || enrichment.ICP_role       || ''
      };

      const mgrCheck = _rowPassesManagerFilter_(fakeRow);
      if (!mgrCheck.pass) return;

      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!scenarioId || a.scenario_id === scenarioId));
      if (!include) return;

      let weekly = [];
      try {
        weekly = expandAssignmentToWeekly_(a, calendar) || [];
      } catch (e) { weekly = []; }

      // weekly-forecast-migration: roll each expanded week up to the
      // calendar month(s) it overlaps before applying the inWindow_ check,
      // same proportional-split pattern as the PSA rows loop above.
      const monthly = [];
      weekly.forEach(w => {
        const wHrs = Number(w.hours) || 0;
        if (!wHrs) return;
        splitWeekAcrossMonths_(w.week_start, wHrs, splitBasis).forEach(m => {
          monthly.push(m);
        });
      });

      monthly.forEach(m => {
        const hrs = Number(m.hours) || 0;
        if (!hrs) return;
        const mk = m.monthKey;
        if (!inWindow_(mk)) return;

        if (!effectiveInScope_(wc)) {
          scopeFilteredOutHours += hrs;
          return;
        }
        if (wcBucket[wc] !== undefined) { wcBucket[wc] += hrs; }
        if (mgrCheck.viaPractice && wc.indexOf('External_') === 0) {
          externalHoursByPracticeOwnership += hrs;
        }

        const teamKey = (fakeRow.team_label) ||
          ((_repCtx_ && typeof resolveTeamLabel_ === 'function')
            ? resolveTeamLabel_(fakeRow, _repCtx_)
            : _classifyTeam_(fakeRow, rtMap));
        if (teamKey === 'Unclassified') {
          const sig = (fakeRow.role_category || '(blank)') + ' | ' + (fakeRow.resource_type || '(blank)');
          unmappedSamples[sig] = (unmappedSamples[sig] || 0) + hrs;
        }
        const acct = String(fakeRow.account_name) || '(No account)';
        const proj = '(Assignment)';
        const roleCat = String(fakeRow.role_category || 'Unclassified');
        const jobProf = String(fakeRow.job_profile || 'Unspecified');
        const roleCapKey = roleForCapacity_(fakeRow);

        byTeamHours[teamKey] = (byTeamHours[teamKey] || 0) + hrs;
        byAcctHours[acct] = (byAcctHours[acct] || 0) + hrs;
        byRoleCategoryHrs[roleCat] = (byRoleCategoryHrs[roleCat] || 0) + hrs;
        byJobProfileHrs[jobProf] = (byJobProfileHrs[jobProf] || 0) + hrs;

        addBreakdown_(teamRC, teamKey, roleCat, hrs);
        addBreakdown_(teamAccts, teamKey, acct, hrs);
        addBreakdown_(teamProjs, teamKey, acct + '||' + proj, hrs);
        addBreakdown_(teamWC, teamKey, wc, hrs);

        addBreakdown_(acctRoles, acct, roleCat, hrs);
        addBreakdown_(acctProjs, acct, proj, hrs);
        addBreakdown_(acctWC, acct, wc, hrs);

        distinctWorkers[a.resource_name] = true;
        if (!distinctCapacity[a.resource_name]) {
          const cap = roleCap[roleCapKey] || roleCap[fakeRow.resource_type] || 160;
          distinctCapacity[a.resource_name] = { capacity: cap };
        }
      });
    });
  }

  // ----- Aggregates -----
  const slgRealHours = wcBucket.SLG_Real;
  const slgGenericHours = wcBucket.SLG_Generic;
  const slgHours = slgRealHours + slgGenericHours;
  const nonSlgHours = wcBucket.External_NonSLG;
  const partnerHours = wcBucket.External_Contractor;
  const totalHours = slgHours + nonSlgHours + partnerHours;

  function pct_(num, den) { return den > 0 ? (num / den) : 0; }

  let capacityHoursTotal = 0;
  Object.keys(distinctCapacity).forEach(n => {
    capacityHoursTotal += (distinctCapacity[n].capacity || 0) * monthsInScope;
  });
  const avgUtilization = capacityHoursTotal > 0 ? (totalHours / capacityHoursTotal) : 0;

  function buildTopN_(hoursByKey, total, topN) {
    const sorted = Object.keys(hoursByKey)
      .map(k => ({ key: k, label: k, hours: Number(hoursByKey[k] || 0) }))
      .filter(x => x.hours > 0)
      .sort((a, b) => b.hours - a.hours);
    const all = sorted.map(x => ({
      key: String(x.key),
      label: String(x.label),
      hours: x.hours,
      pct: pct_(x.hours, total)
    }));
    if (all.length <= topN) return { items: all, all: all };
    const top = all.slice(0, topN);
    const rest = all.slice(topN);
    const restHours = rest.reduce((s, x) => s + x.hours, 0);
    top.push({
      key: '__OTHER__',
      label: 'Other (' + rest.length + ' items)',
      hours: restHours,
      pct: pct_(restHours, total),
      isOther: true,
      otherCount: rest.length
    });
    return { items: top, all: all };
  }

  function wcPayload_(map) {
    const m = map || {};
    return {
      slg: Number(m.SLG_Real || 0),
      slgGeneric: Number(m.SLG_Generic || 0),
      nonSlg: Number(m.External_NonSLG || 0),
      partner: Number(m.External_Contractor || 0)
    };
  }

  // ----- byTeam -----
  const CANONICAL_TEAMS = ['Functional Consulting', 'Technical Consulting', 'Delivery', 'Unclassified'];
  const byTeam = Object.keys(byTeamHours)
    .sort((a, b) => {
      const ai = CANONICAL_TEAMS.indexOf(a);
      const bi = CANONICAL_TEAMS.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    })
    .map(team => {
      const teamTotal = Number(byTeamHours[team] || 0);
      const rc = buildTopN_(teamRC[team] || {}, teamTotal, 5);
      const ac = buildTopN_(teamAccts[team] || {}, teamTotal, 5);
      const projHours = teamProjs[team] || {};
      const projForList = {};
      Object.keys(projHours).forEach(k => {
        const parts = k.split('||');
        const label = parts[1] || '(No project)';
        projForList[label] = (projForList[label] || 0) + projHours[k];
      });
      const pj = buildTopN_(projForList, teamTotal, 5);
      return {
        team: team,
        hours: teamTotal,
        pctOfTotal: pct_(teamTotal, totalHours),
        workerClassBreakdown: wcPayload_(teamWC[team]),
        topRoleCategories: rc.items,
        topAccounts: ac.items,
        topProjects: pj.items,
        allRoleCategories: rc.all,
        allAccounts: ac.all,
        allProjects: pj.all
      };
    });

  // ----- byAccount -----
  const allAcctSorted = Object.keys(byAcctHours)
    .map(k => ({ key: k, hours: Number(byAcctHours[k] || 0) }))
    .filter(x => x.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  const byAccount = allAcctSorted.map(a => {
    const acct = a.key;
    const acctTotal = a.hours;
    const rls = buildTopN_(acctRoles[acct] || {}, acctTotal, 5);
    const pjs = buildTopN_(acctProjs[acct] || {}, acctTotal, 5);
    return {
      account: acct,
      hours: acctTotal,
      pctOfTotal: pct_(acctTotal, totalHours),
      workerClassBreakdown: wcPayload_(acctWC[acct]),
      topRoles: rls.items,
      topProjects: pjs.items,
      allRoles: rls.all,
      allProjects: pjs.all
    };
  });

  // ----- byRoleCategory / byJobProfile -----
  const byRoleCategory = Object.keys(byRoleCategoryHrs)
    .map(k => ({ key: k, hours: Number(byRoleCategoryHrs[k] || 0) }))
    .filter(r => r.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .map(r => ({
      roleCategory: r.key,
      hours: r.hours,
      pctOfTotal: pct_(r.hours, totalHours)
    }));

  const byJobProfile = Object.keys(byJobProfileHrs)
    .map(k => ({ key: k, hours: Number(byJobProfileHrs[k] || 0) }))
    .filter(r => r.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .map(r => ({
      jobProfile: r.key,
      hours: r.hours,
      pctOfTotal: pct_(r.hours, totalHours)
    }));

  // ----- Top 5 lists -----
  const topAccounts = byAccount.slice(0, 5).map(a => ({
    label: a.account, hours: a.hours, pct: a.pctOfTotal
  }));
  const topRoles = byRoleCategory.slice(0, 5).map(r => ({
    label: r.roleCategory, hours: r.hours, pct: r.pctOfTotal
  }));

  // ----- Reconciliation -----
  const teamSum = byTeam.reduce((s, r) => s + r.hours, 0);
  const acctSum = byAccount.reduce((s, r) => s + r.hours, 0);
  const wcSum = slgHours + nonSlgHours + partnerHours;
  const EPS = 0.01;
  const checks = {
    teamMatches: Math.abs(teamSum - totalHours) < EPS,
    accountMatches: Math.abs(acctSum - totalHours) < EPS,
    workerClassMatches: Math.abs(wcSum - totalHours) < EPS
  };
  const reconcileOk = checks.teamMatches && checks.accountMatches && checks.workerClassMatches;
  const reconciliationDetail = {
    totalHours: totalHours,
    teamSum: teamSum,
    accountSum: acctSum,
    workerClassSum: wcSum,
    checks: checks
  };

  // ----- Diagnostics -----
  const blankNames = Object.keys(blankClassWorkers);
  const blankSample = blankNames
    .sort((a, b) => blankClassWorkers[b] - blankClassWorkers[a])
    .slice(0, 10)
    .map(n => ({ name: n, hours: Number(blankClassWorkers[n] || 0) }));

  const diagnostics = {
    unmapped: Object.keys(unmappedSamples)
      .sort((a, b) => unmappedSamples[b] - unmappedSamples[a])
      .map(k => ({ key: k, hours: Number(unmappedSamples[k] || 0) })),
    blankClassWorkers: {
      count: blankNames.length,
      totalHours: blankNames.reduce((s, n) => s + Number(blankClassWorkers[n] || 0), 0),
      sampleNames: blankSample
    }
  };

  return {
    totals: {
      totalHours: totalHours,
      slgHours: slgHours,
      slgRealHours: slgRealHours,
      slgGenericHours: slgGenericHours,
      nonSlgHours: nonSlgHours,
      partnerHours: partnerHours,
      slgPct: pct_(slgHours, totalHours),
      slgRealPct: pct_(slgRealHours, totalHours),
      slgGenericPct: pct_(slgGenericHours, totalHours),
      nonSlgPct: pct_(nonSlgHours, totalHours),
      partnerPct: pct_(partnerHours, totalHours),
      avgUtilization: avgUtilization,
      capacityHours: capacityHoursTotal,
      headcount: Object.keys(distinctWorkers).length,
      monthsInScope: monthsInScope,
      workerScope: workerScope,
      teamLabelFilter: teamLabelFilter || null,
      managerFilterSuppressed: !!teamLabelFilter && !!(params.teams && params.teams.length),
      scopeFilteredOutHours: scopeFilteredOutHours,
      externalHoursByPracticeOwnership: externalHoursByPracticeOwnership,
      reconcileOk: reconcileOk,
      reconciliationDetail: reconciliationDetail
    },
    byTeam: byTeam,
    byAccount: byAccount,
    byRoleCategory: byRoleCategory,
    byJobProfile: byJobProfile,
    topAccounts: topAccounts,
    topRoles: topRoles,
    diagnostics: diagnostics
  };
}

// ------------------------------------------------------------
// Reference data for UI filters (respects exclusions)
//
// Includes the logged-in user's resolved identity:
//   user            - the user's email
//   matchedManager  - manager_name if email matched, else null
//   recognized      - true if matched as manager OR listed in
//                     Config_Settings.recognized_non_manager_emails
//
// Also includes (Priority 2):
//   teamLabels      - sorted list of distinct team_label values from
//                     Config_Roles, with 'Unclassified' excluded.
//                     Drives the topbar Team dropdown.
// ------------------------------------------------------------

function api_getReference() {
  _requireAuthorized_();
  // Per-user 60-second cache wrapper. api_getReference is hit on every
  // page load and reads 5 sheets. Caching the response cuts dashboard
  // load time. Cache is per-user so different users see their own
  // resolved identity in the response. Cache invalidates automatically
  // via TTL; for forced refresh, call api_flushCaches.
  const cache = CacheService.getUserCache();
  const cacheKey = 'api_getReference_v1';
  try {
    const hit = cache.get(cacheKey);
    if (hit) {
      return JSON.parse(hit);
    }
  } catch (e) {
    // Fall through to fresh computation on any cache read error.
  }

  const alloc = readTable_(ALLOC_NORM);
  const excluded = readExclusions_ ? readExclusions_() : new Set();
  const resIndex = _resourceIndex_(alloc);

  const teamTypes = {};
  const subteams = {};
  Object.values(resIndex).forEach(r => {
    if (excluded.has(_exclusionKey_(r.name))) return;
    if (r.teamType) teamTypes[r.teamType] = true;
    if (r.subteam) subteams[r.subteam] = true;
  });

    // Priority 3: build the team resolver once, then attach resolvedTeam
  // to each resource so the Capacity Explorer can filter client-side
  // without server round-trips.
  const resolveResourceTeam = _buildResourceTeamResolver_();

  const resources = Object.values(resIndex)
    .filter(r => !excluded.has(_exclusionKey_(r.name)))
    .map(r => ({
      name: r.name,
      team: r.team || '',
      manager_org: r.manager_org || '',
      icp: r.icp || '',
      resource_type: r.resource_type || '',
      worker_class: r.worker_class || '',
      job_profile: r.job_profile || '',
      role_category: r.role_category || '',
      resolvedTeam: resolveResourceTeam(r)        // Priority 3
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let managerOrgs = [];
  try {
    if (typeof readConfigSlgManagers_ === 'function') {
      const mgrRows = readConfigSlgManagers_();
      managerOrgs = Array.from(
        new Set(mgrRows.map(r => String(r.manager_name || '').trim()).filter(Boolean))
      ).sort();
    }
  } catch (e) {
    managerOrgs = [];
  }
  if (!managerOrgs.length) {
    managerOrgs = Array.from(new Set(
      resources.map(r => r.manager_org).filter(Boolean)
    )).sort();
  }

  // Fiscal quarters (weekly-forecast-migration §4/§13): Workday fiscal year,
  // Feb-anchored (fiscalQuarterKey_ format 'FY<yy>-Q<n>', e.g. 'FY27-Q2').
  // Replaces the old calendar-quarter 'YYYY-Qn' generation.
  const quarters = {};
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    quarters[fiscalQuarterKey_(d)] = true;
  }
  const quartersSorted = Object.keys(quarters).sort();

  let icp = [];
  try {
    icp = readTable_(CFG_ICP).map(r => ({
      role: String(r.role || ''),
      target_utilization: Number(r.target_utilization) || 0,
      red_threshold: Number(r.red_threshold) || 0
    }));
  } catch (e) { icp = []; }

  let roles = [];
  try {
    roles = readTable_(CFG_ROLES).map(r => ({
      role: String(r.role || ''),
      monthly_capacity_hours: Number(r.monthly_capacity_hours) || 160
    }));
  } catch (e) { roles = []; }

  const planningWindowMonths = (typeof readPlanningWindowMonths_ === 'function')
    ? readPlanningWindowMonths_() : 6;

    const userResolution = _resolveLoggedInUser_();
  const teamLabels = _readTeamLabelOptions_();  // Priority 2

  // Priority 3: manager descendants map for client-side hierarchy
  // expansion in the Capacity Explorer resource list.
  let managerDescendants = {};
  try {
    if (typeof readConfigSlgManagers_ === 'function' &&
        typeof buildManagerDescendants_ === 'function') {
      const mgrRows = readConfigSlgManagers_();
      managerDescendants = buildManagerDescendants_(mgrRows) || {};
    }
  } catch (e) {
    Logger.log('api_getReference: managerDescendants build failed — ' + e);
    managerDescendants = {};
  }

  // Priority 4: resource_type options for the Assign drawer's Role dropdown.
  const resourceTypeOptions = _readResourceTypeOptions_();

  const response = {
    user: userResolution.email,
    matchedManager: userResolution.matchedManager,
    userTeamLabel: userResolution.teamLabel || '',   // NEW
    userIsAdmin: !!userResolution.isAdmin,            // NEW
    recognized: !!userResolution.recognized,
    resources: resources,
    managerOrgs: managerOrgs,
    managerDescendants: managerDescendants,       // Priority 3
    teamLabels: teamLabels,                       // Priority 2
    resourceTypeOptions: resourceTypeOptions,     // Priority 4
    quarters: quartersSorted,
    teamTypes: Object.keys(teamTypes).sort(),
    subteams: Object.keys(subteams).sort(),
    icp: icp,
    roles: roles,
    planningWindowMonths: planningWindowMonths,
    // WFM-FIX.1: no longer used to drive boot behavior (see
    // applyAutoManagerDefaults_, JavaScript.html, which now personalizes
    // the boot default off matchedManager/userIsAdmin instead). Left in
    // the response for backward-compat.
    defaultTeamFilter: (function () {
      try {
        const settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
        return String(settings['default_team_filter'] || '').trim();
      } catch (e) {
        return '';
      }
    })()
  };

  try {
    cache.put(cacheKey, JSON.stringify(response), 60);
  } catch (e) {
    // Payload may exceed 100KB. Skip caching; correctness preserved.
  }

  return response;
}

// ------------------------------------------------------------
// Opportunities / Pipeline / Deployments / Assignments / Scenarios /
// Generic Resources / Worker Exclusions / Refresh logs / PSA upload
// ------------------------------------------------------------

function api_listOpportunities(filter) {
  _requireAuthorized_();
  filter = filter || {};
  let rows = readTable_(OPPS_NORM);
  if (filter.segment) {
    rows = rows.filter(r => r.segment === filter.segment);
  }
  if (filter.stageMin) {
    rows = rows.filter(r => Number(r.stage_num) >= Number(filter.stageMin));
  }
  if (filter.search) {
    const q = String(filter.search).toLowerCase();
    rows = rows.filter(r =>
      String(r.opportunity_name).toLowerCase().indexOf(q) >= 0 ||
      String(r.account).toLowerCase().indexOf(q) >= 0
    );
  }
  rows.sort((a, b) => {
    const pd = (Number(b.probability) || 0) - (Number(a.probability) || 0);
    if (pd !== 0) return pd;
    return new Date(a.expected_start || 0) - new Date(b.expected_start || 0);
  });

  // Filtering above happens against source (pre-override) values.
  // Display values below are post-override. Users filter on canonical
  // Salesforce data but see corrected display values.
  const pipelineOverrides = readActiveOverrides_('Pipeline');
  const overrideIndex = buildOverrideIndex_(pipelineOverrides);

  return rows.map(r => {
    const out = {
      opportunity_id: String(r.opportunity_id || ''),
      opportunity_name: String(r.opportunity_name || ''),
      account: String(r.account || ''),
      stage: String(r.stage || ''),
      stage_num: Number(r.stage_num) || 0,
      probability: Number(r.probability) || 0,
      acv: Number(r.acv) || 0,
      expected_start: _toIso_(r.expected_start),
      expected_end: _toIso_(r.expected_end),
      ee_count: Number(r.ee_count) || 0,
      services: String(r.services || ''),
      segment: String(r.segment || ''),
      deal_type: String(r.deal_type || ''),
      deployment_approach: String(r.deployment_approach || '')
    };
    applyOverridesToRecord_(out, out.opportunity_id, overrideIndex, 'Pipeline');
    return out;
  });
}

/**
 * Normalize a project/deployment name string for matching.
 * Lowercases, collapses whitespace, strips # symbols.
 * Keeps commas, slashes, and parens (semantically meaningful).
 * Applied symmetrically to both sides of a comparison so matches are consistent.
 * @param {string} s
 * @return {string}
 */
function _normalizeProjectName_(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/#/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function api_listDeployments() {
  _requireAuthorized_();
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(DEPLOYMENTS_SHEET);
  if (!sh) return [];

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values.shift();
  const idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });

  function v(row, name) {
    const i = idx[name];
    return i >= 0 ? row[i] : '';
  }

  const out = [];
  values.forEach(function (row) {
    const account = v(row, 'Account Name');
    const depName = v(row, 'Deployment Name');
    const depId   = v(row, 'Deployment ID');
    if (!account && !depName) return;

    const partner = String(v(row, 'Priming Partner: Account Name') || '');
    out.push({
      account_name:            String(account || ''),
      deployment_name:         String(depName || ''),
      psa_project_name:        String(v(row, 'PSA Project Name') || ''),
      services_approach:       String(v(row, 'Services Approach') || ''),
      industry:                String(v(row, 'Industry') || ''),
      priming_partner_account: partner,
      partner:                 partner,
      deployment_stage:        String(v(row, 'Deployment Stage') || ''),
      deployment_health:       String(v(row, 'Deployment Health') || ''),
      start_date:              _toIso_(v(row, 'Start Date')),
      current_mtp_date:        _toIso_(v(row, 'Current MTP Date')),
      dam_name:                String(v(row, 'Delivery Assurance Manager: Full Name') || ''),
      em_name:                 String(v(row, 'Workday Engagement Manager: Full Name') || ''),
      current_update:          String(v(row, 'Current Deployment Update') || ''),
      deployment_id:           String(depId || ''),
      psa_worker_count:        0,
      match_type:              'none'
    });
  });

  const deploymentOverrides = readActiveOverrides_('Deployments');
  const overrideIndex = buildOverrideIndex_(deploymentOverrides);
  out.forEach(function (item) {
    applyOverridesToRecord_(item, item.deployment_id, overrideIndex, 'Deployments');
  });

  // Compute psa_worker_count + match_type per deployment using two-tier matching.
  // Single walk over ALLOC_NORM builds both indexes for all deployments.
  try {
    const PSA_TYPES  = { Billable: true, Internal: true, Education: true };
    const allocs     = cachedRead_(ALLOC_NORM);

    // Index 1: normalized project_name → Set<resource_name>
    const byProject  = {};
    // Index 2: account_name → Set<resource_name>
    const byAccount  = {};
    allocs.forEach(function (row) {
      if (!PSA_TYPES[String(row.allocation_type || '')]) return;
      const rn   = String(row.resource_name  || '').trim();
      const pn   = _normalizeProjectName_(row.project_name);
      const acct = String(row.account_name   || '').trim();
      if (!rn) return;
      if (pn)   { if (!byProject[pn])   byProject[pn]   = new Set(); byProject[pn].add(rn);   }
      if (acct) { if (!byAccount[acct]) byAccount[acct] = new Set(); byAccount[acct].add(rn); }
    });

    out.forEach(function (dep) {
      // Tier 1: precise project match via psa_project_name
      if (dep.psa_project_name) {
        const norm = _normalizeProjectName_(dep.psa_project_name);
        const ws   = byProject[norm];
        if (ws && ws.size > 0) {
          dep.psa_worker_count = ws.size;
          dep.match_type = 'project';
          return;
        }
      }
      // Tier 2: account fallback
      if (dep.account_name) {
        const ws = byAccount[dep.account_name];
        if (ws && ws.size > 0) {
          dep.psa_worker_count = ws.size;
          dep.match_type = 'account';
          return;
        }
      }
      dep.psa_worker_count = 0;
      dep.match_type = 'none';
    });
  } catch (e) {
    Logger.log('api_listDeployments: psa_worker_count failed — ' + e);
  }

  return out;
}

// Sanitize an assignment record for google.script.run transport.
// Date fields (start_date, end_date, created_at, modified_at) convert to
// ISO strings so the client bridge doesn't silently return null.
// Mirrors _sanitizeScenarioForWire_ — same root-cause class.
function _sanitizeAssignmentForWire_(a) {
  if (!a) return null;
  return {
    assignment_id: String(a.assignment_id || ''),
    opportunity_id: String(a.opportunity_id || ''),
    role: String(a.role || ''),
    resource_name: String(a.resource_name || ''),
    team: String(a.team || ''),
    start_date: _toIso_(a.start_date),
    end_date: _toIso_(a.end_date),
    estimated_hours: Number(a.estimated_hours) || 0,
    distribution: String(a.distribution || ''),
    custom_monthly_json: String(a.custom_monthly_json || ''),
    status: String(a.status || ''),
    scenario_id: String(a.scenario_id || ''),
    notes: String(a.notes || ''),
    created_by: String(a.created_by || ''),
    created_at: _toIso_(a.created_at),
    modified_by: String(a.modified_by || ''),
    modified_at: _toIso_(a.modified_at),
    resource_type: String(a.resource_type || ''),  // Priority 4
    team_label: String(a.team_label || '')          // Priority 4
  };
}

function api_listAssignments(params) {
  _requireAuthorized_();
  const rows = listAssignments_(params) || [];
  return rows.map(_sanitizeAssignmentForWire_);
}

function api_saveAssignment(a) {
  _requireAuthorized_();
  const saved = saveAssignment_(a);
  return _sanitizeAssignmentForWire_(saved);
}

function api_previewAssignment(a) {
  _requireAuthorized_();
  return previewAssignmentWeekly_(a).map(m => ({
    monthKey: m.monthKey,
    hours: Math.round(m.hours)
  }));
}

// Sanitize a scenario record for google.script.run transport.
// Specifically converts Date fields (created_at, modified_at) to ISO strings
// so the client bridge doesn't silently mangle the entire return value to null.
function _sanitizeScenarioForWire_(s) {
  if (!s) return null;
  return {
    scenario_id: String(s.scenario_id || ''),
    name: String(s.name || ''),
    description: String(s.description || ''),
    status: String(s.status || ''),
    created_by: String(s.created_by || ''),
    created_at: _toIso_(s.created_at),
    modified_by: String(s.modified_by || ''),
    modified_at: _toIso_(s.modified_at)
  };
}

function api_listScenarios() {
  _requireAuthorized_();
  const rows = listScenarios_() || [];
  return rows.map(_sanitizeScenarioForWire_);
}

function api_saveScenario(s) {
  _requireAuthorized_();
  const saved = saveScenario_(s);
  return _sanitizeScenarioForWire_(saved);
}
function api_commitScenario(id) { _requireAuthorized_(); return commitScenario_(id); }
function api_archiveScenario(id) { _requireAuthorized_(); return archiveScenario_(id); }

function api_restoreScenario(id) {
  _requireAuthorized_();
  const out = restoreScenario_(id);
  return { scenario_id: String(out.scenario_id || ''), status: String(out.status || '') };
}

/**
 * Return per-account billable hours for a single worker × single month.
 * Reads from Allocations_Normalized where allocation_type='Billable'.
 *
 * @param {Object} params
 * @param {string} params.resource_name  - Worker name (required)
 * @param {string} params.monthKey       - 'YYYY-MM' (required)
 * @returns {Object} { resource_name, monthKey, totalHours, rows: [{ account_name, hours }] }
 *                   rows sorted by hours descending. Account names with no
 *                   value are reported as '(No account)'.
 */
function api_getWorkerBillableByAccount(params) {
  _requireAuthorized_();
  params = params || {};
  const resourceName = String(params.resource_name || '');
  const monthKey = String(params.monthKey || '');
  if (!resourceName || !monthKey) return { resource_name: resourceName, monthKey: monthKey, totalHours: 0, rows: [] };

  // PSA hours by account for this worker × month.
  // weekly-forecast-migration: alloc rows are weekly (week_start/hours);
  // roll each row up to the requested calendar month via
  // splitWeekAcrossMonths_ and take only the portion attributable to it.
  const alloc = cachedRead_(ALLOC_NORM);
  const _wbaSettings = readSettings_();
  const _wbaSplitBasis = String(_wbaSettings.week_month_split_basis || 'calendar');
  const psaByAccount = {};
  alloc.forEach(function(a) {
    if (a.resource_name !== resourceName) return;
    if (String(a.allocation_type || '') !== 'Billable') return;
    if (!a.week_start) return;
    var h = Number(a.hours) || 0;
    if (!h) return;
    var parts = splitWeekAcrossMonths_(a.week_start, h, _wbaSplitBasis);
    var hrs = parts.reduce(function (s, p) { return s + (p.monthKey === monthKey ? p.hours : 0); }, 0);
    if (!hrs) return;
    var acct = String(a.account_name || '') || '(No account)';
    psaByAccount[acct] = (psaByAccount[acct] || 0) + hrs;
  });

  // Active adjustments for this worker — accumulate signed hours_reduction per account.
  // adjMeta tracks reason and adjustment_ids per account for the badge tooltip.
  var adjByAccount = {};   // account → signed hours_reduction sum
  var adjMeta     = {};    // account → { reasons: Set, adjustment_ids: [], direction_last }
  try {
    var calendar = readCalendar_();
    var adjRows = cachedRead_(CAPACITY_ADJUSTMENTS_SHEET).filter(function (adj) {
      if (adj.resource_name !== resourceName) return false;
      if (!adj.deployment_id) return false;
      var s = String(adj.status || 'Modeled');
      return s === 'Modeled' || s === 'Committed';
    });
    adjRows.forEach(function (adj) {
      var ref = _resolveDeploymentRef_(String(adj.deployment_id));
      if (!ref) return;
      var acct = ref.account_name || '(No account)';
      var weeks = expandAdjustmentToWeekly_(adj, calendar);
      weeks.forEach(function (w) {
        var wHrs = Number(w.hours_reduction) || 0;
        if (!wHrs) return;
        var parts = splitWeekAcrossMonths_(w.week_start, wHrs, _wbaSplitBasis);
        var hrs = parts.reduce(function (s, p) { return s + (p.monthKey === monthKey ? p.hours : 0); }, 0);
        if (!hrs) return;
        adjByAccount[acct] = (adjByAccount[acct] || 0) + hrs;
        if (!adjMeta[acct]) adjMeta[acct] = { reasons: [], adjustment_ids: [] };
        var reason = String(adj.reason || '');
        if (reason && adjMeta[acct].reasons.indexOf(reason) < 0) adjMeta[acct].reasons.push(reason);
        var aid = String(adj.adjustment_id || '');
        if (aid && adjMeta[acct].adjustment_ids.indexOf(aid) < 0) adjMeta[acct].adjustment_ids.push(aid);
      });
    });
  } catch (e) {
    Logger.log('api_getWorkerBillableByAccount: adjustment join error — ' + e);
  }

  // Build unified account list (PSA accounts + any adjustment-only accounts).
  var allAccounts = Object.keys(psaByAccount);
  Object.keys(adjByAccount).forEach(function (a) {
    if (allAccounts.indexOf(a) < 0) allAccounts.push(a);
  });

  var totalHours = 0;
  var rows = allAccounts.map(function (acct) {
    var psa = psaByAccount[acct] || 0;
    var signedAdj = adjByAccount[acct] || 0;
    // working = psa - signedAdj: subtracting positive reduces, subtracting negative adds.
    var working = psa - signedAdj;
    totalHours += working;
    var adjInfo = null;
    if (signedAdj !== 0) {
      var meta = adjMeta[acct] || { reasons: [], adjustment_ids: [] };
      adjInfo = {
        signed_hours:    signedAdj,
        direction:       signedAdj > 0 ? 'reduce' : 'add',
        magnitude:       Math.abs(signedAdj),
        reason:          meta.reasons.join(', '),
        adjustment_ids:  meta.adjustment_ids
      };
    }
    return {
      account_name: acct,
      hours:        working,
      psa_hours:    psa,
      adjustment:   adjInfo
    };
  }).sort(function (a, b) { return b.hours - a.hours; });

  return {
    resource_name: resourceName,
    monthKey:      monthKey,
    totalHours:    totalHours,
    rows:          rows
  };
}

/**
 * For the quick-adjust Edit button: given (worker, account, month), return all
 * deployments where this worker has active PSA allocations.
 * Tier 1: match Deployments rows whose PSA Project Name is in the worker's project set.
 * Tier 2 fallback: if Tier 1 returns zero hits, return ALL deployments for the account.
 * @param {{ resource_name: string, account_name: string, monthKey: string }} params
 * @return {{ deployment_id: string, deployment_name: string, account_name: string, match_type: string }[]}
 */
function api_getDeploymentsForWorkerAccount(params) {
  _requireAuthorized_();
  params = params || {};
  const resourceName = String(params.resource_name || '');
  const accountName  = String(params.account_name  || '');
  const monthKey     = String(params.monthKey       || '');
  if (!resourceName || !accountName || !monthKey) return [];

  // Build set of project_name values from ALLOC_NORM for this worker × account × month.
  // weekly-forecast-migration: roll each weekly row up to the target month
  // via splitWeekAcrossMonths_ before matching.
  const projectSet = {};
  try {
    var _dfwaSettings = readSettings_();
    var _dfwaSplitBasis = String(_dfwaSettings.week_month_split_basis || 'calendar');
    cachedRead_(ALLOC_NORM).forEach(function (a) {
      if (a.resource_name !== resourceName) return;
      if (String(a.account_name || '') !== accountName) return;
      if (!a.week_start) return;
      var hrs = Number(a.hours) || 0;
      if (!hrs) return;
      var parts = splitWeekAcrossMonths_(a.week_start, hrs, _dfwaSplitBasis);
      var inMonth = parts.some(function (p) { return p.monthKey === monthKey && p.hours > 0; });
      if (!inMonth) return;
      var proj = String(a.project_name || '').trim();
      if (proj) projectSet[proj] = true;
    });
  } catch (e) {
    Logger.log('api_getDeploymentsForWorkerAccount: alloc read error — ' + e);
  }

  // Read Deployments sheet.
  var tier1 = [];
  var tier2 = [];
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(DEPLOYMENTS_SHEET);
    if (sh) {
      var vals = sh.getDataRange().getValues();
      var hdr  = vals[0];
      var hIdx = {};
      hdr.forEach(function (h, i) { hIdx[String(h).trim()] = i; });
      function vd(row, name) { var i = hIdx[name]; return i >= 0 ? String(row[i] || '').trim() : ''; }
      for (var ri = 1; ri < vals.length; ri++) {
        var row = vals[ri];
        var acct    = vd(row, 'Account Name');
        var depName = vd(row, 'Deployment Name');
        var depId   = vd(row, 'Deployment ID');
        var psaProj = vd(row, 'PSA Project Name');
        if (!acct && !depName) continue;
        if (acct !== accountName) continue;
        var result = { deployment_id: depId, deployment_name: depName, account_name: acct, match_type: 'account' };
        if (psaProj && projectSet[psaProj]) {
          result.match_type = 'project';
          tier1.push(result);
        } else {
          tier2.push(result);
        }
      }
    }
  } catch (e) {
    Logger.log('api_getDeploymentsForWorkerAccount: deployments read error — ' + e);
  }

  return tier1.length ? tier1 : tier2;
}

/**
 * For the quick-adjust modal PSA field: return PSA hours for a worker × deployment × month.
 * Tier 1: match ALLOC_NORM rows by project_name = deployment's psa_project_name.
 * Tier 2: when psa_project_name blank, match by account_name.
 * @param {{ resource_name: string, deployment_id: string, monthKey: string }} params
 * @return {{ psa_hours: number }}
 */
function api_getPsaHoursForWorkerDeploymentMonth(params) {
  _requireAuthorized_();
  params = params || {};
  const resourceName  = String(params.resource_name  || '');
  const deploymentId  = String(params.deployment_id  || '');
  const monthKey      = String(params.monthKey        || '');
  if (!resourceName || !deploymentId || !monthKey) return { psa_hours: 0 };

  var ref = _resolveDeploymentRef_(deploymentId);
  if (!ref) return { psa_hours: 0 };
  var psaProject = String(ref.psa_project_name || '').trim();
  var accountName = String(ref.account_name    || '').trim();

  // weekly-forecast-migration: alloc rows are weekly; roll up to the
  // target month via splitWeekAcrossMonths_ and sum only that portion.
  var total = 0;
  try {
    var _phSettings = readSettings_();
    var _phSplitBasis = String(_phSettings.week_month_split_basis || 'calendar');
    cachedRead_(ALLOC_NORM).forEach(function (a) {
      if (a.resource_name !== resourceName) return;
      if (String(a.allocation_type || '') !== 'Billable') return;
      if (!a.week_start) return;
      var proj = String(a.project_name  || '').trim();
      var acct = String(a.account_name  || '').trim();
      // Tier 1: match by PSA project name; Tier 2: match by account when psa_project_name is blank.
      var matches = psaProject ? (proj === psaProject) : (acct === accountName);
      if (!matches) return;
      var h = Number(a.hours) || 0;
      if (!h) return;
      var parts = splitWeekAcrossMonths_(a.week_start, h, _phSplitBasis);
      total += parts.reduce(function (s, p) { return s + (p.monthKey === monthKey ? p.hours : 0); }, 0);
    });
  } catch (e) {
    Logger.log('api_getPsaHoursForWorkerDeploymentMonth: ' + e);
  }
  return { psa_hours: total };
}

function api_saveIcp(rows) {
  _requireAuthorized_();
  writeTable_(CFG_ICP, ICP_HEADERS, rows);
  if (typeof invalidateCache_ === 'function') invalidateCache_(CFG_ICP);
  return { ok: true };
}

function api_saveRoles(rows) {
  _requireAuthorized_();
  writeTable_(CFG_ROLES, ROLE_HEADERS, rows);
  if (typeof invalidateCache_ === 'function') invalidateCache_(CFG_ROLES);
  return { ok: true };
}

function api_listGenericResources() {
  _requireAuthorized_();
  try { return readGenericResources_(); } catch (e) { return []; }
}

/** Admin variant — returns all rows including Inactive so the admin table can manage them. */
/**
 * Return resource_type keys grouped by team_label for the cascading
 * Team → Resource Type dropdowns in Generic Resources admin.
 *
 * Shape: { "Delivery": ["Engagement Manager", ...], "Functional Consulting": [...], ... }
 * Teams sorted alphabetically; resource_type arrays sorted alphabetically within each team.
 *
 * @return {Object}
 */
function api_getResourceTypeOptions() {
  _requireAuthorized_();
  var rtMap = readConfigResourceType_();
  var grouped = {};
  Object.keys(rtMap).forEach(function (rt) {
    var team = String(rtMap[rt] || '').trim();
    if (!team) return;
    if (!grouped[team]) grouped[team] = [];
    grouped[team].push(rt);
  });
  // Sort resource_types within each team
  Object.keys(grouped).forEach(function (team) {
    grouped[team].sort();
  });
  // Return as plain object; JSON serialization preserves insertion order
  // (GAS sorts string keys alphabetically in V8 for non-numeric keys).
  var sorted = {};
  Object.keys(grouped).sort().forEach(function (team) {
    sorted[team] = grouped[team];
  });
  return sorted;
}

/**
 * Return deployments where the given worker has PSA allocations
 * (Billable, Internal, or Education allocation types).
 * Used to scope the deployment dropdown in the reduction drawer.
 *
 * @param {string} resourceName
 * @return {{ deployment_id: string, label: string }[]}  sorted alphabetically by label
 */
function api_getDeploymentsForWorker(resourceName) {
  _requireAuthorized_();
  if (!resourceName) return [];

  // 1. Collect distinct project_names for this worker from ALLOC_NORM.
  var allocs;
  try { allocs = cachedRead_(ALLOC_NORM); } catch (e) { allocs = []; }

  var PSA_TYPES = { Billable: true, Internal: true, Education: true };
  var projectNames = {};
  allocs.forEach(function (row) {
    if (String(row.resource_name || '') !== resourceName) return;
    if (!PSA_TYPES[String(row.allocation_type || '')]) return;
    var pn = String(row.project_name || '').trim();
    if (pn) projectNames[pn] = true;
  });

  // 2. Build a name-indexed map of Deployments tab rows.
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(DEPLOYMENTS_SHEET);
  var depByName = {};
  if (sh) {
    var vals = sh.getDataRange().getValues();
    if (vals.length > 1) {
      var hdr = vals[0];
      var hIdx = {};
      hdr.forEach(function (h, i) { hIdx[String(h).trim()] = i; });
      for (var ri = 1; ri < vals.length; ri++) {
        var row = vals[ri];
        var name = String(hIdx['Deployment Name'] >= 0 ? row[hIdx['Deployment Name']] : '').trim();
        var account = String(hIdx['Account Name'] >= 0 ? row[hIdx['Account Name']] : '').trim();
        var id = String(hIdx['Deployment ID'] >= 0 ? row[hIdx['Deployment ID']] : '').trim();
        if (!name) continue;
        depByName[name] = { deployment_id: id || name, account_name: account };
      }
    }
  }

  // 3. For each distinct project_name, resolve to a deployment entry.
  var out = [];
  Object.keys(projectNames).forEach(function (pn) {
    var dep = depByName[pn];
    if (dep) {
      out.push({
        deployment_id: dep.deployment_id || pn,
        label: (dep.account_name ? dep.account_name + ' \u2014 ' : '') + pn
      });
    } else {
      out.push({
        deployment_id: pn,
        label: pn + ' (no matching deployment)'
      });
    }
  });

  out.sort(function (a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; });
  return out;
}

/**
 * Return workers who have PSA allocations on the given deployment,
 * along with their total hours on that deployment.
 * Used to populate the Worker dropdown in the deployment-scoped reduction drawer.
 *
 * @param {string} deploymentId
 * @return {{ resource_name: string, hours_on_deployment: number }[]}  sorted by hours desc
 */
/**
 * Return workers who have PSA allocations on the given deployment,
 * along with their total hours using two-tier matching.
 *
 * @param {string} deploymentId
 * @return {{ workers: {resource_name:string, hours:number}[], match_type: string }}
 */
function api_getWorkersForDeployment(deploymentId) {
  _requireAuthorized_();
  if (!deploymentId) return { workers: [], match_type: 'none' };

  const depRef = _resolveDeploymentRef_(deploymentId);
  if (!depRef) return { workers: [], match_type: 'none' };

  var allocs;
  try { allocs = cachedRead_(ALLOC_NORM); } catch (e) { allocs = []; }

  const PSA_TYPES = { Billable: true, Internal: true, Education: true };
  // Filter to PSA work rows within the planning window.
  // weekly-forecast-migration: a weekly row can straddle two calendar
  // months, so treat it as in-window if ANY of its proportional
  // month-split parts falls in the window (boolean membership check,
  // not an hours sum -- see api_getResourceBaselineForDeployment below
  // for the hours-summing case, which uses the full split).
  const pw = buildPlanningWindow_(readPlanningWindowMonths_());
  const _wfdSettings = readSettings_();
  const _wfdSplitBasis = String(_wfdSettings.week_month_split_basis || 'calendar');
  const relevant = allocs.filter(function (a) {
    if (!PSA_TYPES[String(a.allocation_type || '')]) return false;
    if (!a.week_start) return false;
    var parts = splitWeekAcrossMonths_(a.week_start, Number(a.hours) || 0, _wfdSplitBasis);
    return parts.some(function (p) { return !!pw.monthKeys[p.monthKey]; });
  });

  // Tier 1: precise project match via psa_project_name
  var matched = [];
  var matchType = 'none';
  if (depRef.psa_project_name) {
    const targetNorm = _normalizeProjectName_(depRef.psa_project_name);
    matched = relevant.filter(function (a) {
      return _normalizeProjectName_(a.project_name) === targetNorm;
    });
    if (matched.length > 0) matchType = 'project';
  }

  // Tier 2: account fallback
  if (matched.length === 0 && depRef.account_name) {
    matched = relevant.filter(function (a) {
      return String(a.account_name || '') === depRef.account_name;
    });
    if (matched.length > 0) matchType = 'account';
  }

  const byWorker = {};
  matched.forEach(function (a) {
    const rn = String(a.resource_name || '').trim();
    if (!rn) return;
    byWorker[rn] = (byWorker[rn] || 0) + (Number(a.hours) || 0);
  });

  const workers = Object.keys(byWorker).map(function (n) {
    return { resource_name: n, hours: Math.round(byWorker[n]) };
  });
  workers.sort(function (a, b) { return b.hours - a.hours; });
  return { workers: workers, match_type: matchType };
}

/**
 * Return per-month PSA baseline for a worker, split into total vs. deployment-matched hours.
 * Uses the same two-tier matching as api_getWorkersForDeployment.
 *
 * @param {string} resourceName
 * @param {string} deploymentId
 * @return {{ months: {monthKey:string, total_psa_hours:number, matched_hours:number}[], match_type: string }}
 */
function api_getResourceBaselineForDeployment(resourceName, deploymentId) {
  _requireAuthorized_();
  if (!resourceName || !deploymentId) return { months: [], match_type: 'none' };

  const depRef = _resolveDeploymentRef_(deploymentId);
  if (!depRef) return { months: [], match_type: 'none' };

  const PSA_TYPES = { Billable: true, Internal: true, Education: true };
  var allocs;
  try { allocs = cachedRead_(ALLOC_NORM); } catch (e) { allocs = []; }

  // Determine match type using same tier logic as api_getWorkersForDeployment
  // (but for this specific worker across all months)
  var matchType = 'none';
  var matchFn;
  if (depRef.psa_project_name) {
    const targetNorm = _normalizeProjectName_(depRef.psa_project_name);
    const projectMatchCount = allocs.filter(function (a) {
      return String(a.resource_name || '') === resourceName &&
             PSA_TYPES[String(a.allocation_type || '')] &&
             _normalizeProjectName_(a.project_name) === targetNorm;
    }).length;
    if (projectMatchCount > 0) {
      matchType = 'project';
      matchFn = function (a) { return _normalizeProjectName_(a.project_name) === targetNorm; };
    }
  }
  if (matchType === 'none' && depRef.account_name) {
    const acctMatchCount = allocs.filter(function (a) {
      return String(a.resource_name || '') === resourceName &&
             PSA_TYPES[String(a.allocation_type || '')] &&
             String(a.account_name || '') === depRef.account_name;
    }).length;
    if (acctMatchCount > 0) {
      matchType = 'account';
      matchFn = function (a) { return String(a.account_name || '') === depRef.account_name; };
    }
  }
  if (!matchFn) matchFn = function () { return false; };

  // weekly-forecast-migration: rows are weekly; roll each row's hours up
  // to the calendar month(s) it overlaps via splitWeekAcrossMonths_
  // (proportional, sum-exact) so byMonth totals reconcile against the
  // underlying weekly hours.
  const _rbSettings = readSettings_();
  const _rbSplitBasis = String(_rbSettings.week_month_split_basis || 'calendar');
  const byMonth = {};
  allocs.forEach(function (row) {
    if (String(row.resource_name || '') !== resourceName) return;
    if (!PSA_TYPES[String(row.allocation_type || '')]) return;
    if (!row.week_start) return;
    const h = Number(row.hours) || 0;
    if (!h) return;
    const isMatched = matchFn(row);
    splitWeekAcrossMonths_(row.week_start, h, _rbSplitBasis).forEach(function (p) {
      const k = p.monthKey;
      if (!byMonth[k]) byMonth[k] = { total: 0, matched: 0 };
      byMonth[k].total += p.hours;
      if (isMatched) byMonth[k].matched += p.hours;
    });
  });

  const months = Object.keys(byMonth).sort().map(function (k) {
    return {
      monthKey:        k,
      total_psa_hours: Math.round(byMonth[k].total),
      matched_hours:   Math.round(byMonth[k].matched)
    };
  });
  return { months: months, match_type: matchType };
}

/**
 * Resolve a deployment_id to its key fields, or null if not found.
 * Reads the Deployments tab directly (no cache needed — called infrequently).
 *
 * @param {string} deploymentId
 * @return {{ account_name: string, deployment_name: string, psa_project_name: string }|null}
 */
function _resolveDeploymentRef_(deploymentId) {
  if (!deploymentId) return null;
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(DEPLOYMENTS_SHEET);
    if (!sh) return null;
    const vals = sh.getDataRange().getValues();
    if (vals.length < 2) return null;
    const hdr = vals[0];
    const hIdx = {};
    hdr.forEach(function (h, i) { hIdx[String(h).trim()] = i; });
    for (let ri = 1; ri < vals.length; ri++) {
      const row = vals[ri];
      const dId   = String(hIdx['Deployment ID']      >= 0 ? row[hIdx['Deployment ID']]      : '').trim();
      const dName = String(hIdx['Deployment Name']    >= 0 ? row[hIdx['Deployment Name']]    : '').trim();
      const dAcct = String(hIdx['Account Name']       >= 0 ? row[hIdx['Account Name']]       : '').trim();
      const dPsa  = String(hIdx['PSA Project Name']   >= 0 ? row[hIdx['PSA Project Name']]   : '').trim();
      // Match by Deployment ID; also match by Deployment Name for cases
      // where deployment_id was stored as the project_name directly.
      if ((dId && dId === deploymentId) || dName === deploymentId) {
        return { account_name: dAcct, deployment_name: dName, psa_project_name: dPsa };
      }
    }
    return null;
  } catch (e) {
    Logger.log('_resolveDeploymentRef_: ' + e);
    return null;
  }
}

function api_listAllGenericResources() {
  _requireAuthorized_();
  try {
    let rows;
    try { rows = cachedRead_(CFG_GENERIC); } catch (e) { return []; }
    return rows.map(r => ({
      name:           String(r.name || ''),
      resource_type:  String(r.resource_type || ''),
      project_role:   String(r.project_role || ''),
      manager_org:    String(r.manager_org || ''),
      team:           String(r.team || ''),
      practice:       String(r.practice || ''),
      start_date:     r.start_date || '',
      end_date:       r.end_date || '',
      capacity_hours: Number(r.capacity_hours) || 160,
      status:         String(r.status || 'Active'),
      notes:          String(r.notes || '')
    })).filter(g => g.name);
  } catch (e) { return []; }
}

function api_saveGenericResources(payload) {
  _requireAuthorized_();
  const rawRows = (payload && payload.resources) || [];
  // Server-side name uniqueness check — catches client bugs / concurrent edits.
  const names = rawRows.map(function (r) {
    return String(Array.isArray(r) ? (r[0] || '') : (r.name || '')).trim().toLowerCase();
  }).filter(Boolean);
  const seen = {};
  names.forEach(function (n) {
    if (seen[n]) throw new Error('Duplicate generic worker name: ' + n);
    seen[n] = true;
  });

  // Patch: validate team / resource_type combinations against Config_Resource_Type.
  const rtMap = readConfigResourceType_(); // { resource_type: team_label }
  // Build reverse: { team_label: Set<resource_type> }
  const teamToRts = {};
  Object.keys(rtMap).forEach(function (rt) {
    const team = String(rtMap[rt] || '').trim();
    if (!team) return;
    if (!teamToRts[team]) teamToRts[team] = new Set ? new Set() : {};
    if (teamToRts[team].add) teamToRts[team].add(rt);
    else teamToRts[team][rt] = true;
  });
  const validTeams = new Set ? new Set(Object.keys(teamToRts)) : {};
  if (!validTeams.has) {
    // Fallback for GAS without Set.has (shouldn't occur in V8)
    Object.keys(teamToRts).forEach(function (t) { validTeams[t] = true; });
    validTeams.has = function (v) { return !!validTeams[v]; };
  }
  const errors = [];
  rawRows.forEach(function (r) {
    if (Array.isArray(r)) return; // skip 2D-array rows (legacy format)
    const rowName = String(r.name || '').trim() || '(unnamed)';
    const rowTeam = String(r.team || '').trim();
    const rowRt   = String(r.resource_type || '').trim();
    if (!rowTeam && !rowRt) return; // blanks allowed
    if (rowTeam) {
      var teamRtSet = teamToRts[rowTeam];
      var validRt = teamRtSet
        ? (teamRtSet.has ? teamRtSet.has(rowRt) : !!teamRtSet[rowRt])
        : false;
      if (!validTeams.has(rowTeam)) {
        errors.push('"' + rowName + '": team "' + rowTeam + '" is not in Config_Resource_Type.');
      } else if (rowRt && !validRt) {
        errors.push('"' + rowName + '": resource_type "' + rowRt + '" is not valid for team "' + rowTeam + '".');
      }
    } else if (rowRt) {
      // resource_type set but team blank — only validate rt exists
      if (!rtMap[rowRt]) {
        errors.push('"' + rowName + '": resource_type "' + rowRt + '" does not exist in Config_Resource_Type.');
      }
    }
  });
  if (errors.length) {
    throw new Error('Validation failed:\n' + errors.join('\n'));
  }

  // Normalize: accept both arrays of objects and arrays of arrays so that
  // writeTable_'s setValues() receives the 2-D format GAS requires.
  const rows = rawRows.map(function (r) {
    if (Array.isArray(r)) return r;
    return GENERIC_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
  });
  writeTable_(CFG_GENERIC, GENERIC_HEADERS, rows);
  if (typeof invalidateCache_ === 'function') invalidateCache_(CFG_GENERIC);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  // Bust the per-user api_getReference cache so the Capacity Explorer
  // resource list reflects new generic workers immediately on next load.
  try { CacheService.getUserCache().remove('api_getReference_v1'); } catch (e) {}
  return { ok: true, count: rows.length };
}

// ============================================================
// Drop 6: Capacity Adjustments API
// ============================================================

/**
 * Wire format sanitizer — mirrors _sanitizeAssignmentForWire_.
 * Converts Date fields to ISO strings and coerces all other fields
 * to primitive types safe for JSON serialization.
 */
function _sanitizeAdjustmentForWire_(a) {
  if (!a) return a;
  const out = {};
  ADJUSTMENT_HEADERS.forEach(function (h) {
    let v = a[h];
    if (v instanceof Date) {
      out[h] = v.toISOString().slice(0, 10);
    } else if (v === null || v === undefined) {
      out[h] = '';
    } else {
      out[h] = v;
    }
  });
  return out;
}

/**
 * List capacity adjustments. Optionally filter by resource_name,
 * scenario_id, or status.
 */
function api_listCapacityAdjustments(filter) {
  _requireAuthorized_();
  try {
    const rows = listCapacityAdjustments_(filter || {});
    return rows.map(_sanitizeAdjustmentForWire_);
  } catch (e) {
    Logger.log('api_listCapacityAdjustments: ' + e);
    return [];
  }
}

/** Create or update a capacity adjustment. */
function api_saveCapacityAdjustment(adj) {
  _requireAuthorized_();
  const saved = saveCapacityAdjustment_(adj);
  return _sanitizeAdjustmentForWire_(saved);
}

/** Hard-delete a capacity adjustment row. */
function api_deleteCapacityAdjustment(adjustment_id) {
  _requireAuthorized_();
  return deleteCapacityAdjustment_(adjustment_id);
}

/**
 * Preview weekly expansion (rolled up to months for the chart) for the
 * reduction drawer. Mirrors api_previewAssignment. Uses
 * splitWeekAcrossMonths_ so monthly totals reconcile with the weekly
 * expansion (weekly-forecast-migration).
 * @return {{ monthKey: string, hours_reduction: number }[]}
 */
function api_previewCapacityAdjustment(adj) {
  _requireAuthorized_();
  if (adj.start_date) adj.start_date = new Date(adj.start_date);
  if (adj.end_date)   adj.end_date   = new Date(adj.end_date);
  adj.hours_reduction = Number(adj.hours_reduction) || 0;
  const settings = readSettings_();
  const basis = settings['week_month_split_basis'] || 'calendar';
  const weekly = expandAdjustmentToWeekly_(adj, readCalendar_());
  const byMonth = {};
  weekly.forEach(w => {
    splitWeekAcrossMonths_(w.week_start, w.hours_reduction, basis).forEach(part => {
      byMonth[part.monthKey] = (byMonth[part.monthKey] || 0) + part.hours;
    });
  });
  return Object.keys(byMonth).sort().map(mk => ({ monthKey: mk, hours_reduction: byMonth[mk] }));
}

/**
 * Return per-month PSA committed hours for a resource over the planning
 * window. Used by the reduction drawer's baseline context panel so
 * Delivery Directors can see the "current PSA forecast" they are modeling
 * against.
 * @param {string} resource_name
 * @return {{ monthKey: string, committed_hours: number }[]}
 */
function api_getResourceBaseline(resource_name) {
  _requireAuthorized_();
  if (!resource_name) return [];
  try {
    const alloc = cachedRead_(ALLOC_NORM).filter(a =>
      a.resource_name === resource_name && a.allocation_type === 'Billable'
    );
    const settings = readSettings_();
    const basis = String(settings.week_month_split_basis || 'calendar');
    const byMonth = {};
    alloc.forEach(a => {
      if (!a.week_start) return;
      const h = Number(a.hours) || 0;
      if (!h) return;
      splitWeekAcrossMonths_(a.week_start, h, basis).forEach(p => {
        byMonth[p.monthKey] = (byMonth[p.monthKey] || 0) + p.hours;
      });
    });
    return Object.keys(byMonth).sort().map(k => ({
      monthKey: k,
      committed_hours: byMonth[k]
    }));
  } catch (e) {
    Logger.log('api_getResourceBaseline: ' + e);
    return [];
  }
}

function api_getExclusions() {
  _requireAuthorized_();
  try { return readTable_(CFG_WORKER_EXCLUSIONS) || []; } catch (e) { return []; }
}

/**
 * WFM-FIX.3: Config_Worker_Exclusions gained source/override columns that
 * this endpoint's client UI does not edit (worker_name/manager_org/reason/
 * active only). Previously this wrote a fixed 4-column headers list, which
 * -- combined with writeTable_'s clear-then-rewrite -- would silently
 * blank the source/override columns' data on every save from the Admin
 * panel, undoing rule stamps and human overrides alike. Each row's
 * existing source/override (looked up by _exclusionKey_) is now carried
 * forward unless the payload explicitly supplies a value.
 */
function api_saveExclusions(payload) {
  _requireAuthorized_();
  const rows = (payload && payload.workers) || [];

  const existing = {};
  try {
    (readTable_(CFG_WORKER_EXCLUSIONS) || []).forEach(r => {
      const k = _exclusionKey_(r.worker_name);
      if (k) existing[k] = r;
    });
  } catch (e) { /* fall through with an empty existing map */ }

  const merged = rows.map(r => {
    const prev = existing[_exclusionKey_(r.worker_name)] || {};
    return {
      worker_name: r.worker_name || '',
      manager_org: r.manager_org || '',
      reason: r.reason || '',
      active: r.active || '',
      source: (r.source !== undefined ? r.source : prev.source) || '',
      override: (r.override !== undefined ? r.override : prev.override) || ''
    };
  });

  writeTable_(CFG_WORKER_EXCLUSIONS, WORKER_EXCLUSION_HEADERS,
    merged.map(r => WORKER_EXCLUSION_HEADERS.map(h => r[h] !== undefined ? r[h] : '')));
  if (typeof invalidateCache_ === 'function') {
    invalidateCache_(CFG_WORKER_EXCLUSIONS);
  }
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  // Bust per-user api_getReference cache so excluded workers disappear
  // from Capacity Explorer immediately on next reference fetch.
  try { CacheService.getUserCache().remove('api_getReference_v1'); } catch (e) {}
  return { ok: true, count: merged.length };
}

function api_listAllWorkers() {
  _requireAuthorized_();
  const alloc = readTable_(ALLOC_NORM);
  const idx = _resourceIndex_(alloc);
  return Object.values(idx)
    .map(r => ({
      name: r.name,
      manager_org: r.manager_org || '',
      worker_class: r.worker_class || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function api_uploadStaffFile(base64, filename) {
  _requireAuthorized_();
  return uploadStaffFile(base64, filename);
}

function api_uploadActualsFile(base64, filename) {
  _requireAuthorized_();
  return uploadActualsFile(base64, filename);
}

function api_refreshOpportunities() {
  _requireAuthorized_();
  return normalizeOpportunities();
}

function api_getRefreshLog() {
  _requireAuthorized_();
  try {
    const rows = readTable_(REFRESH_LOG) || [];
    return rows
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 25)
      .map(function (r) {
        return {
          timestamp: _toIso_(r.timestamp),
          source: String(r.source || ''),
          rows_in: Number(r.rows_in) || 0,
          rows_out: Number(r.rows_out) || 0,
          weeks_detected: Number(r.weeks_detected) || 0,
          user: String(r.user || ''),
          warnings: String(r.warnings || '')
        };
      });
  } catch (e) {
    return [];
  }
}

function api_getPipelineRefreshLog() {
  _requireAuthorized_();
  try {
    // Salesforce connector-managed tab. The connector owns the name
    // 'Auto Refresh Execution Log 1' (with trailing 1) and renames it
    // back if changed externally. Hardcoded here because Constants.gs
    // may not be updated yet in this manual patch context.
    const sh = SpreadsheetApp.getActive().getSheetByName('Auto Refresh Execution Log 1');
    if (!sh) return [];
    const values = sh.getDataRange().getValues();
    if (!values || values.length < 2) return [];
    const header = values[0].map(function (h) { return String(h || '').trim(); });
    const out = [];
    for (let i = 1; i < values.length; i++) {
      const row = {};
      header.forEach(function (h, j) { row[h] = values[i][j]; });
      out.push(row);
    }
    return out
      .sort(function (a, b) {
        return new Date(b['Refresh Time']) - new Date(a['Refresh Time']);
      })
      .slice(0, 10)
      .map(function (r) {
        // Coerce every field to a primitive. Dates become ISO strings;
        // everything else becomes a string. This prevents google.script.run
        // from delivering null to the client when the payload contains
        // un-serializable Date objects.
        const sanitized = {};
        Object.keys(r).forEach(function (key) {
          const v = r[key];
          if (v === null || v === undefined) {
            sanitized[key] = '';
          } else if (v instanceof Date) {
            sanitized[key] = _toIso_(v);
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            sanitized[key] = v;
          } else {
            sanitized[key] = String(v);
          }
        });
        return sanitized;
      });
  } catch (e) {
    return [];
  }
}

function api_checkPsaAssignment(name) {
  _requireAuthorized_();
  const alloc = readTable_(ALLOC_NORM);
  const found = alloc.some(r => r.resource_name === name);
  return { found: found };
}

// ============================================================
// Drop 3: Source Overrides API endpoints
// ============================================================

function _sanitizeOverrideForWire_(o) {
  if (!o) return null;
  return {
    override_id:    String(o.override_id    || ''),
    source:         String(o.source         || ''),
    record_id:      String(o.record_id      || ''),
    field:          String(o.field          || ''),
    original_value: String(o.original_value || ''),
    override_value: String(o.override_value || ''),
    reason:         String(o.reason         || ''),
    expires_at:     _toIso_(o.expires_at),
    status:         String(o.status         || ''),
    created_by:     String(o.created_by     || ''),
    created_at:     _toIso_(o.created_at),
    modified_by:    String(o.modified_by    || ''),
    modified_at:    _toIso_(o.modified_at)
  };
}

function _sanitizeOverrideAuditForWire_(a) {
  if (!a) return null;
  return {
    audit_id:    String(a.audit_id    || ''),
    timestamp:   _toIso_(a.timestamp),
    actor:       String(a.actor       || ''),
    action:      String(a.action      || ''),
    override_id: String(a.override_id || ''),
    source:      String(a.source      || ''),
    record_id:   String(a.record_id   || ''),
    field:       String(a.field       || ''),
    before_json: a.before_json != null ? String(a.before_json) : null,
    after_json:  a.after_json  != null ? String(a.after_json)  : null,
    notes:       String(a.notes       || '')
  };
}

function api_listOverrides(filter) {
  _requireAuthorized_();
  return listOverrides_(filter).map(_sanitizeOverrideForWire_);
}

function api_saveOverride(o) {
  _requireAuthorized_();
  const saved = saveOverride_(o);
  return _sanitizeOverrideForWire_(saved);
}

function api_deleteOverride(override_id, reason) {
  _requireAuthorized_();
  return deleteOverride_(override_id, reason);
}

function api_listOverridableFields() {
  _requireAuthorized_();
  return readOverridableFields_();
}

function api_getOverrideAudit(filter) {
  _requireAuthorized_();
  filter = filter || {};
  const limit  = Math.min(Number(filter.limit)  || 100, 500);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const queryFilter = {};
  if (filter.source)      queryFilter.source      = filter.source;
  if (filter.record_id)   queryFilter.record_id   = filter.record_id;
  if (filter.override_id) queryFilter.override_id = filter.override_id;
  if (filter.actor)       queryFilter.actor       = filter.actor;
  const rows = listOverrideAudit_(queryFilter);
  const total = rows.length;
  const page  = rows.slice(offset, offset + limit).map(_sanitizeOverrideAuditForWire_);
  return { total: total, offset: offset, limit: limit, rows: page };
}

function api_runOverrideHygiene() {
  _requireAuthorized_();
  const expired = expireOverdueOverrides_();
  const stale   = findStaleOverrides_();
  return { expired: expired, stale: stale, ranAt: new Date().toISOString() };
}

function api_bulkDeleteOverrides(ids, reason) {
  _requireAuthorized_();
  return bulkDeleteOverrides_(ids, reason);
}

function api_exportOverridesCsv(filter) {
  _requireAuthorized_();
  return exportOverridesCsv_(filter);
}

function api_importOverridesCsv(matrix) {
  _requireAuthorized_();
  return importOverridesCsv_(matrix);
}

function api_getOverrideHygieneSummary() {
  _requireAuthorized_();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 30);
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const active = listOverrides_({ status: 'Active' });
  const activeTotal = active.length;
  const expiringSoon = active.filter(function (o) {
    if (!o.expires_at) return false;
    const d = new Date(o.expires_at);
    if (isNaN(d.getTime())) return false;
    d.setHours(0, 0, 0, 0);
    return d >= today && d <= soon;
  }).length;
  const longRunning = active.filter(function (o) {
    if (o.expires_at) return false;
    if (!o.created_at) return false;
    const d = new Date(o.created_at);
    if (isNaN(d.getTime())) return false;
    return d < ninetyDaysAgo;
  }).length;
  const stale = findStaleOverrides_().length;
  return { activeTotal: activeTotal, expiringSoon: expiringSoon, longRunning: longRunning, stale: stale };
}

function api_saveSettings(rows) {
  _requireAuthorized_();
  const existing = readTable_(CFG_SETTINGS);
  const existingByKey = {};
  existing.forEach(function (r) { existingByKey[String(r.key || '')] = r; });
  (rows || []).forEach(function (item) {
    const k = String(item.key || '').trim();
    if (!k) return;
    existingByKey[k] = { key: k, value: String(item.value !== undefined ? item.value : '') };
  });
  const matrix = Object.values(existingByKey).map(function (r) { return [r.key, r.value]; });
  writeTable_(CFG_SETTINGS, ['key', 'value'], matrix);
  return { ok: true, count: matrix.length };
}

/**
 * Return metadata for all known Config_Settings keys, including current values
 * and whether each key is using its default.
 * Used by the Admin → Planning Config → Settings card.
 */
function api_listSettings() {
  _requireAuthorized_();

  const KNOWN_SETTINGS = [
    { key: 'planning_window_months', label: 'Planning window (months)',    description: 'Number of months shown in the planning window heatmap.', defaultValue: '6'    },
    { key: 'hide_all_external',      label: 'Hide all external workers',   description: 'When true, External workers are excluded from all views.', defaultValue: 'false' },
    { key: 'default_team_filter',    label: 'Default team filter',         description: 'Pre-select this team in the Team dropdown on load.',    defaultValue: ''     },
    { key: 'admin_emails',           label: 'Admin emails',                description: 'Comma-separated emails granted admin access (in addition to SLG managers).', defaultValue: '' },
    { key: 'app_access_restricted',  label: 'Restrict app to authorized users', description: 'When true, only emails in Config_SLG_Managers or admin_emails can access the app. Default false for safe deploys.', defaultValue: 'false' },
    { key: 'weekly_target_default',   label: 'Weekly target hours (default)',  description: 'Default weekly capacity target hours per worker (weekly-forecast-migration).', defaultValue: '32.8' },
    { key: 'weekly_target_P6',        label: 'Weekly target hours (P6)',       description: 'Weekly capacity target hours for P6-level workers (Job Profile starts with P6).', defaultValue: '26.0' },
    { key: 'week_month_split_basis',  label: 'Week\u2192month split basis',    description: '"calendar" splits a week\'s hours across months by calendar days; "weekday" splits by Mon\u2013Fri days only.', defaultValue: 'calendar' },
    { key: 'fiscal_year_start_month', label: 'Fiscal year start month',        description: '1-indexed calendar month the fiscal year starts in (2 = February, Workday\u2019s fiscal anchor).', defaultValue: '2' }
  ];
  const currentSettings = readSettings_();
  return KNOWN_SETTINGS.map(function (s) {
    const inSheet = currentSettings.hasOwnProperty(s.key);
    return {
      key:         s.key,
      label:       s.label,
      description: s.description,
      value:       inSheet ? currentSettings[s.key] : s.defaultValue,
      isDefault:   !inSheet
    };
  });
}

// ============================================================
// Drop 7: Worker Planning Detail API
// ============================================================

/**
 * Return combined, sorted assignments + capacity adjustments for one worker.
 * Joins opportunity names and scenario names server-side so the client
 * doesn't need secondary lookups.
 *
 * @param {string} resourceName
 * @param {{ status?: string, type?: string, scenario_id?: string }} filter
 * @return {Object[]}
 */
function api_getWorkerPlanning(resourceName, filter) {
  _requireAuthorized_();
  filter = filter || {};
  if (!resourceName) return [];

  const assigns = listAssignments_({ resource_name: resourceName });
  let adjs = [];
  try { adjs = listCapacityAdjustments_({ resource_name: resourceName }); } catch (e) { adjs = []; }

  // Build opportunity name index from OPPS_NORM (opportunistic — missing = blank).
  const oppIndex = {};
  try {
    readTable_(OPPS_NORM).forEach(function (o) {
      if (o.opportunity_id) oppIndex[o.opportunity_id] = { name: o.opportunity_name || '', account: o.account || '' };
    });
  } catch (e) {}

  // Build scenario name index.
  const scenIndex = {};
  try {
    readTable_(SCENARIOS).forEach(function (s) {
      if (s.scenario_id) scenIndex[s.scenario_id] = s.name || '';
    });
  } catch (e) {}

  // Build deployment index keyed by deployment_id and by deployment_name
  // for resolving a reduction's deployment_id to a human-readable label.
  const depIndex = {}; // deployment_id  → { account_name, deployment_name }
  const depByName = {}; // deployment_name → deployment_id
  try {
    const depSh = SpreadsheetApp.getActive().getSheetByName(DEPLOYMENTS_SHEET);
    if (depSh) {
      const dVals = depSh.getDataRange().getValues();
      if (dVals.length > 1) {
        const dHdr = dVals[0];
        const dIdx = {};
        dHdr.forEach(function (h, i) { dIdx[String(h).trim()] = i; });
        for (let ri = 1; ri < dVals.length; ri++) {
          const dr = dVals[ri];
          const dName = String(dIdx['Deployment Name'] >= 0 ? dr[dIdx['Deployment Name']] : '').trim();
          const dAcct = String(dIdx['Account Name']   >= 0 ? dr[dIdx['Account Name']]   : '').trim();
          const dId   = String(dIdx['Deployment ID']  >= 0 ? dr[dIdx['Deployment ID']]  : '').trim();
          if (!dName) continue;
          const key = dId || dName;
          depIndex[key]  = { account_name: dAcct, deployment_name: dName };
          depByName[dName] = key;
        }
      }
    }
  } catch (e) {}

  function _resolveDepSubtitle_(deploymentId) {
    if (!deploymentId) return { subtitle: '', orphaned: false };
    const entry = depIndex[deploymentId];
    if (entry) {
      return {
        subtitle: entry.account_name
          ? entry.account_name + ' \u2014 ' + entry.deployment_name
          : entry.deployment_name,
        orphaned: false
      };
    }
    // deployment_id set but not found in Deployments tab → orphaned
    return { subtitle: '(no longer active)', orphaned: true };
  }

  function _toIsoDate_(v) {
    if (!v) return '';
    try { return new Date(v).toISOString().slice(0,10); } catch (e) { return String(v).slice(0,10); }
  }

  let rows = [];

  assigns.forEach(function (a) {
    const oppData = oppIndex[a.opportunity_id];
    const assignOrphaned = !!a.opportunity_id && !oppData;
    rows.push({
      type:          'assignment',
      id:            String(a.assignment_id || ''),
      title:         (oppData || {}).name || a.opportunity_id || '',
      subtitle:      assignOrphaned ? '(no longer active)' : ((oppData || {}).account || ''),
      orphaned:      assignOrphaned,
      start_date:    _toIsoDate_(a.start_date),
      end_date:      _toIsoDate_(a.end_date),
      hours:         Number(a.estimated_hours) || 0,
      distribution:  String(a.distribution || 'Even'),
      status:        String(a.status || 'Modeled'),
      scenario_id:   String(a.scenario_id || ''),
      scenario_name: a.scenario_id ? (scenIndex[a.scenario_id] || a.scenario_id) : '',
      opportunity_id: String(a.opportunity_id || ''),
      reason:        null,
      created_by:    String(a.created_by || ''),
      created_at:    _toIsoDate_(a.created_at),
      modified_at:   _toIsoDate_(a.modified_at)
    });
  });

  adjs.forEach(function (adj) {
    const depResult = _resolveDepSubtitle_(String(adj.deployment_id || ''));
    rows.push({
      type:          'reduction',
      id:            String(adj.adjustment_id || ''),
      title:         'Reduction',
      subtitle:      depResult.subtitle,
      orphaned:      depResult.orphaned,
      start_date:    _toIsoDate_(adj.start_date),
      end_date:      _toIsoDate_(adj.end_date),
      hours:         Number(adj.hours_reduction) || 0,
      distribution:  String(adj.distribution || 'Even'),
      status:        String(adj.status || 'Modeled'),
      scenario_id:   String(adj.scenario_id || ''),
      scenario_name: adj.scenario_id ? (scenIndex[adj.scenario_id] || adj.scenario_id) : '',
      opportunity_id: '',
      reason:        String(adj.reason || ''),
      created_by:    String(adj.created_by || ''),
      created_at:    _toIsoDate_(adj.created_at),
      modified_at:   _toIsoDate_(adj.modified_at)
    });
  });

  // Client-side filter pass (applied here so server response is filtered).
  if (filter.status)      rows = rows.filter(function (r) { return r.status === filter.status; });
  if (filter.type)        rows = rows.filter(function (r) { return r.type === filter.type; });
  if (filter.scenario_id) rows = rows.filter(function (r) { return r.scenario_id === filter.scenario_id; });

  // Sort newest start_date first.
  rows.sort(function (a, b) { return (b.start_date || '').localeCompare(a.start_date || ''); });
  return rows;
}

/**
 * Return footer summary aggregates for the Planning Detail card.
 * @param {string} resourceName
 * @return {{ totalAssignedHours, totalReductionHours, netHours, distinctProjects, distinctScenarios }}
 */
function api_getWorkerPlanningSummary(resourceName) {
  _requireAuthorized_();
  if (!resourceName) return { totalAssignedHours: 0, totalReductionHours: 0, netHours: 0, distinctProjects: 0, distinctScenarios: 0 };
  const assigns = listAssignments_({ resource_name: resourceName }).filter(function (a) { return a.status !== 'Archived'; });
  let adjs = [];
  try { adjs = listCapacityAdjustments_({ resource_name: resourceName }).filter(function (a) { return a.status !== 'Archived'; }); } catch (e) {}

  const totalAssigned  = assigns.reduce(function (s, a) { return s + (Number(a.estimated_hours) || 0); }, 0);
  const totalReduction = adjs.reduce(function (s, a) { return s + (Number(a.hours_reduction) || 0); }, 0);
  const distinctProjects  = new Set(assigns.map(function (a) { return a.opportunity_id; }).filter(Boolean)).size;
  const distinctScenarios = new Set(
    [...assigns, ...adjs].map(function (a) { return a.scenario_id; }).filter(Boolean)
  ).size;
  return {
    totalAssignedHours:  Math.round(totalAssigned),
    totalReductionHours: Math.round(totalReduction),
    netHours:            Math.round(totalAssigned - totalReduction),
    distinctProjects:    distinctProjects,
    distinctScenarios:   distinctScenarios
  };
}

/** Soft-delete an assignment by setting status='Archived'. */
function api_archiveAssignment(assignment_id) {
  _requireAuthorized_();
  return setAssignmentStatus_(assignment_id, 'Archived');
}

/** Flip a Committed assignment back to Modeled. */
function api_revertAssignmentToModeled(assignment_id) {
  _requireAuthorized_();
  return setAssignmentStatus_(assignment_id, 'Modeled');
}

/** Flip a Modeled assignment to Committed (per-row, not whole-scenario). */
function api_commitAssignment(assignment_id) {
  _requireAuthorized_();
  return setAssignmentStatus_(assignment_id, 'Committed');
}

/** Flip a Modeled capacity adjustment to Committed. */
function api_commitCapacityAdjustment(adjustment_id) {
  _requireAuthorized_();
  return setAdjustmentStatus_(adjustment_id, 'Committed');
}

/** Flip a Committed capacity adjustment back to Modeled. */
function api_revertCapacityAdjustmentToModeled(adjustment_id) {
  _requireAuthorized_();
  return setAdjustmentStatus_(adjustment_id, 'Modeled');
}

/**
 * List Capacity_Adjustments_Audit rows, newest first.
 * Optional filter: adjustment_id, resource_name, actor, action, limit.
 * @param {{ adjustment_id?: string, resource_name?: string, actor?: string, action?: string, limit?: number }} filter
 * @return {Object[]}
 */
function api_listCapacityAdjustmentAudit(filter) {
  _requireAuthorized_();
  filter = filter || {};
  let rows = readTable_(CAPACITY_ADJUSTMENTS_AUDIT_SHEET);
  if (filter.adjustment_id) rows = rows.filter(function (r) { return String(r.adjustment_id) === String(filter.adjustment_id); });
  if (filter.resource_name) rows = rows.filter(function (r) { return r.resource_name === filter.resource_name; });
  if (filter.actor)         rows = rows.filter(function (r) { return r.actor === filter.actor; });
  if (filter.action)        rows = rows.filter(function (r) { return r.action === filter.action; });
  rows.sort(function (a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });
  if (filter.limit) rows = rows.slice(0, Number(filter.limit) || 100);
  return rows.map(function (r) {
    return {
      audit_id:      String(r.audit_id      || ''),
      timestamp:     _toIso_(r.timestamp),
      actor:         String(r.actor         || ''),
      action:        String(r.action        || ''),
      adjustment_id: String(r.adjustment_id || ''),
      resource_name: String(r.resource_name || ''),
      deployment_id: String(r.deployment_id || ''),
      before_json:   r.before_json || null,
      after_json:    r.after_json  || null,
      notes:         String(r.notes         || '')
    };
  });
}
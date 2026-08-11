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
  if (typeof _resetProjectionMemos_ === 'function') _resetProjectionMemos_();
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
    roleCategoryRollup: [],
    specialtyPracticeRollup: [],
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
    scorecardWindowKeys_(),
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

  const roleCategoryPayload = buildResourceRoleCategoryRollup_(
    resourceName, projectsOut, curQ, visibleWeeks
  );
  const roleCategoryRollup = roleCategoryPayload.rollup;
  const specialtyPracticeRollup = buildResourceSpecialtyPracticeRollup_(
    resourceName, curQ, visibleWeeks
  );
  const projectNameEnrichment = enrichResourceProjectNames_(resourceName, projectsOut);
  projectsOut.forEach(function (p, i) {
    p.roleCategory = roleCategoryPayload.roleCategories[i] || 'Unclassified';
    p.account_name = projectNameEnrichment[i].account_name;
    p.project_name = projectNameEnrichment[i].project_name;
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
    roleCategoryRollup: roleCategoryRollup,
    specialtyPracticeRollup: specialtyPracticeRollup,
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
 * ADD-ONLY: passthrough Project Role Category rollup for api_getResourceDetailV2.
 * Maps project hours to role_category from allocation rows; does not alter hours.
 * @param {string} resourceName
 * @param {Array<{project:string, weekly:Array}>} projectsOut
 * @param {string} curQ current fiscal quarter key
 * @param {Array<{week_key:string, week_start:Date}>} visibleWeeks
 * @return {{rollup: Array<{roleCategory:string, currentQuarterHours:number}>, roleCategories: string[]}}
 */
function buildResourceRoleCategoryRollup_(resourceName, projectsOut, curQ, visibleWeeks) {
  var curWeekKeys = {};
  (visibleWeeks || []).forEach(function (vw) {
    if (fiscalQuarterKey_(vw.week_start) === curQ) {
      curWeekKeys[String(vw.week_key)] = true;
    }
  });

  var projRoleVotes = {};
  var workerRoleVotes = {};
  var allocRows = [];
  try {
    allocRows = cachedRead_(ALLOC_NORM);
  } catch (e) {
    allocRows = [];
  }
  allocRows.forEach(function (a) {
    if (String(a.resource_name || '') !== resourceName) return;
    var rc = String(a.role_category || '').trim() || 'Unclassified';
    workerRoleVotes[rc] = (workerRoleVotes[rc] || 0) + 1;
    var proj = String(a.project_name || '').trim();
    if (!proj) return;
    if (!projRoleVotes[proj]) projRoleVotes[proj] = {};
    projRoleVotes[proj][rc] = (projRoleVotes[proj][rc] || 0) + 1;
  });

  function pickTop_(counts) {
    var keys = Object.keys(counts || {});
    if (!keys.length) return '';
    keys.sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0); });
    return keys[0];
  }

  var workerDefaultRole = pickTop_(workerRoleVotes) || 'Unclassified';
  var roleCategories = (projectsOut || []).map(function (p) {
    return pickTop_(projRoleVotes[p.project]) || workerDefaultRole;
  });

  var roleCatHours = {};
  (projectsOut || []).forEach(function (p, idx) {
    var rc = roleCategories[idx] || workerDefaultRole;
    (p.weekly || []).forEach(function (wk) {
      if (!curWeekKeys[wk.weekKey]) return;
      var hrs = Number(wk.hours) || 0;
      if (!hrs) return;
      roleCatHours[rc] = (roleCatHours[rc] || 0) + hrs;
    });
  });

  var rollup = Object.keys(roleCatHours).map(function (rc) {
    return {
      roleCategory: rc,
      currentQuarterHours: Number(roleCatHours[rc]) || 0
    };
  }).sort(function (a, b) {
    return b.currentQuarterHours - a.currentQuarterHours;
  });

  return { rollup: rollup, roleCategories: roleCategories };
}

/**
 * ADD-ONLY: passthrough Specialty Practice rollup for api_getResourceDetailV2.
 * Sums allocation-row hours by raw specialty_practice for the current quarter.
 * @param {string} resourceName
 * @param {string} curQ current fiscal quarter key
 * @param {Array<{week_key:string, week_start:Date}>} visibleWeeks
 * @return {Array<{specialtyPractice:string, currentQuarterHours:number}>}
 */
function buildResourceSpecialtyPracticeRollup_(resourceName, curQ, visibleWeeks) {
  var curWeekKeys = {};
  (visibleWeeks || []).forEach(function (vw) {
    if (fiscalQuarterKey_(vw.week_start) === curQ) {
      curWeekKeys[String(vw.week_key)] = true;
    }
  });

  var specialtyHours = {};
  var allocRows = [];
  try {
    allocRows = cachedRead_(ALLOC_NORM);
  } catch (e) {
    allocRows = [];
  }
  allocRows.forEach(function (a) {
    if (String(a.resource_name || '') !== resourceName) return;
    var wk = String(a.week_key || '');
    if (!curWeekKeys[wk]) return;
    var hrs = Number(a.hours) || 0;
    if (!hrs) return;
    var sp = String(a.specialty_practice || '').trim() || 'Unclassified';
    specialtyHours[sp] = (specialtyHours[sp] || 0) + hrs;
  });

  return Object.keys(specialtyHours).map(function (sp) {
    return {
      specialtyPractice: sp,
      currentQuarterHours: Number(specialtyHours[sp]) || 0
    };
  }).sort(function (a, b) {
    return b.currentQuarterHours - a.currentQuarterHours;
  });
}

/**
 * Vote worker specialty_practice from Allocations_Normalized hours (verbatim passthrough).
 * @param {Array<Object>} allocRows
 * @return {Object<string,string>} resourceName → specialtyPractice
 */
function buildWorkerSpecialtyPracticeMap_(allocRows) {
  var votes = {};
  (allocRows || []).forEach(function (a) {
    var res = String(a.resource_name || '');
    if (!res) return;
    var hrs = Number(a.hours) || 0;
    if (!hrs) return;
    var sp = String(a.specialty_practice || '').trim() || 'Unclassified';
    if (!votes[res]) votes[res] = {};
    votes[res][sp] = (votes[res][sp] || 0) + hrs;
  });
  var out = {};
  Object.keys(votes).forEach(function (res) {
    var counts = votes[res];
    var keys = Object.keys(counts);
    keys.sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0); });
    out[res] = keys[0] || 'Unclassified';
  });
  return out;
}

/**
 * ADD-ONLY: passthrough account_name + project_name for api_getResourceDetailV2 projects[].
 * Votes from Allocations_Normalized rows; does not alter hours or existing fields.
 * @param {string} resourceName
 * @param {Array<{project:string}>} projectsOut
 * @return {Array<{account_name:string, project_name:string}>}
 */
function enrichResourceProjectNames_(resourceName, projectsOut) {
  var projMeta = {};
  var allocRows = [];
  try {
    allocRows = cachedRead_(ALLOC_NORM);
  } catch (e) {
    allocRows = [];
  }
  allocRows.forEach(function (a) {
    if (String(a.resource_name || '') !== resourceName) return;
    var proj = String(a.project_name || '').trim();
    if (!proj) return;
    if (!projMeta[proj]) projMeta[proj] = { accountVotes: {} };
    var acct = String(a.account_name || '').trim();
    if (acct) {
      projMeta[proj].accountVotes[acct] = (projMeta[proj].accountVotes[acct] || 0) + 1;
    }
  });

  function pickTop_(counts) {
    var keys = Object.keys(counts || {});
    if (!keys.length) return '';
    keys.sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0); });
    return keys[0];
  }

  return (projectsOut || []).map(function (p) {
    var meta = projMeta[p.project] || {};
    return {
      account_name: pickTop_(meta.accountVotes) || '',
      project_name: String(p.project || '')
    };
  });
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

/**
 * WFM.25 Stage 4: Historical worker-type hours for Mix & Trend.
 * Reads Actuals_History; aggregates by fiscal quarter and display class.
 * @param {Object} [params] reserved for future filter params
 * @return {Object}
 */
function api_getWorkerTypeHistory(params) {
  _requireAuthorized_();
  return getWorkerTypeHistory_(params || {});
}

/**
 * WFM.25: Cross-org + contractor quarterly forecast aggregate (read-only).
 * Scoped to the scorecard forward window (current + next fiscal quarters).
 * @param {Object} [params] reserved for future filter params
 * @return {Object}
 */
function api_getXorgForecast(params) {
  _requireAuthorized_();
  return getXorgForecast_(params || {});
}

/**
 * Read Xorg_Forecast_Aggregate and shape for Hours & Capacity + Mix & Trend forward views.
 * @param {Object} [params]
 * @return {Object}
 */
function getXorgForecast_(params) {
  var windowKeys = scorecardWindowKeys_();
  var forwardKeys = windowKeys.length >= 3
    ? [windowKeys[1], windowKeys[2]]
    : windowKeys.slice(1);
  var forwardSet = {};
  forwardKeys.forEach(function (qk) { forwardSet[qk] = true; });

  var rows = readTable_(XORG_FORECAST_AGGREGATE) || [];
  var out = [];
  var byGroupQuarter = {};
  var regionByQuarter = {};

  rows.forEach(function (r) {
    var fq = String(r.fiscal_quarter || '').trim();
    if (!fq || !forwardSet[fq]) return;
    var workerGroup = String(r.worker_group || '').trim();
    if (!workerGroup) return;
    var region = String(r.region || '').trim();
    var hrs = Number(r.forecast_hours) || 0;
    if (!hrs) return;

    out.push({
      workerGroup: workerGroup,
      region: region,
      fiscalQuarter: fq,
      forecastHours: hrs
    });

    if (!byGroupQuarter[workerGroup]) byGroupQuarter[workerGroup] = {};
    byGroupQuarter[workerGroup][fq] = (byGroupQuarter[workerGroup][fq] || 0) + hrs;

    if (workerGroup === 'Workday Regions') {
      if (!regionByQuarter[fq]) regionByQuarter[fq] = {};
      var rk = region || 'Unclassified';
      regionByQuarter[fq][rk] = (regionByQuarter[fq][rk] || 0) + hrs;
    }
  });

  return {
    rows: out,
    quarterKeys: windowKeys,
    forwardQuarterKeys: forwardKeys,
    byGroupQuarter: byGroupQuarter,
    regionByQuarter: regionByQuarter
  };
}

/**
 * Aggregate Actuals_History into Mix & Trend wire payload.
 * Storage worker_class → display class: SLG, Workday Regions, Contractor.
 * @param {Object} [params]
 * @return {Object}
 */
function getWorkerTypeHistory_(params) {
  var rows = readTable_(ACTUALS_HISTORY) || [];
  var quarterTotals = {};
  var quarterClasses = {};
  var quarterRegions = {};
  var grandTotal = 0;

  rows.forEach(function (r) {
    var fq = String(r.fiscal_quarter || '').trim();
    if (!fq) return;
    var hrs = Number(r.worked_hours) || 0;
    if (!hrs) return;

    var displayClass = historyDisplayClass_(r.worker_class);
    if (!displayClass) return;

    grandTotal += hrs;
    quarterTotals[fq] = (quarterTotals[fq] || 0) + hrs;

    if (!quarterClasses[fq]) quarterClasses[fq] = {};
    quarterClasses[fq][displayClass] = (quarterClasses[fq][displayClass] || 0) + hrs;

    if (displayClass === 'Workday Regions') {
      var region = String(r.workday_region_as_of_date_worked || '').trim();
      if (!region) region = 'Unclassified';
      if (!quarterRegions[fq]) quarterRegions[fq] = {};
      quarterRegions[fq][region] = (quarterRegions[fq][region] || 0) + hrs;
    }
  });

  var fiscalQuarters = Object.keys(quarterTotals).sort(compareFiscalQuarterKeys_);
  var summaries = buildWorkerTypeHistorySummaries_(
    fiscalQuarters, quarterTotals, quarterClasses, quarterRegions
  );

  return {
    fiscalQuarters: fiscalQuarters,
    quarterTotals: quarterTotals,
    quarterClasses: quarterClasses,
    quarterRegions: quarterRegions,
    grandTotal: grandTotal,
    quarters: summaries.quarters,
    categoryByQuarter: summaries.categoryByQuarter,
    regionByQuarter: summaries.regionByQuarter,
    bannerSummary: summaries.bannerSummary
  };
}

/**
 * Pre-aggregated Mix & Trend summaries for banner sparklines and drill-down.
 * Historical actual quarters only (caller supplies Actuals_History aggregates).
 * @param {string[]} fiscalQuarters
 * @param {Object<string,number>} quarterTotals
 * @param {Object<string,Object<string,number>>} quarterClasses
 * @param {Object<string,Object<string,number>>} quarterRegions
 * @return {Object}
 * @private
 */
function buildWorkerTypeHistorySummaries_(fiscalQuarters, quarterTotals, quarterClasses, quarterRegions) {
  var DISPLAY_CLASSES = ['SLG', 'Workday Regions', 'Contractor'];

  var quarters = fiscalQuarters.map(function (fq) {
    return { fiscalQuarter: fq, totalHours: Number(quarterTotals[fq]) || 0 };
  });

  var categoryByQuarter = fiscalQuarters.map(function (fq) {
    var cls = quarterClasses[fq] || {};
    return {
      fiscalQuarter: fq,
      slgHours: Number(cls['SLG']) || 0,
      workdayRegionsHours: Number(cls['Workday Regions']) || 0,
      contractorHours: Number(cls['Contractor']) || 0
    };
  });

  var regionByQuarter = {};
  fiscalQuarters.forEach(function (fq) {
    var regions = quarterRegions[fq] || {};
    var rows = Object.keys(regions).map(function (rk) {
      return { workdayRegion: rk, hours: Number(regions[rk]) || 0 };
    });
    rows.sort(function (a, b) { return b.hours - a.hours; });
    regionByQuarter[fq] = rows;
  });

  var n = fiscalQuarters.length;
  var latestQ = n ? fiscalQuarters[n - 1] : '';
  var priorQ = n > 1 ? fiscalQuarters[n - 2] : '';
  var latestHours = n ? (Number(quarterTotals[latestQ]) || 0) : 0;
  var priorHours = n > 1 ? (Number(quarterTotals[priorQ]) || 0) : 0;
  var qoqAbs = latestHours - priorHours;
  var qoqPct = priorHours > 0 ? qoqAbs / priorHours : 0;

  var histGrand = 0;
  var catTotals = { 'SLG': 0, 'Workday Regions': 0, 'Contractor': 0 };
  fiscalQuarters.forEach(function (fq) {
    histGrand += Number(quarterTotals[fq]) || 0;
    var cls = quarterClasses[fq] || {};
    DISPLAY_CLASSES.forEach(function (c) {
      catTotals[c] += Number(cls[c]) || 0;
    });
  });
  var avgQuarterlyHours = n > 0 ? histGrand / n : 0;

  var shareSeriesSLG = [];
  var shareSeriesWorkdayRegions = [];
  var shareSeriesContractor = [];
  var totalHoursSeries = [];

  fiscalQuarters.forEach(function (fq) {
    var total = Number(quarterTotals[fq]) || 0;
    var cls = quarterClasses[fq] || {};
    totalHoursSeries.push(total);
    if (total > 0) {
      shareSeriesSLG.push((Number(cls['SLG']) || 0) / total);
      shareSeriesWorkdayRegions.push((Number(cls['Workday Regions']) || 0) / total);
      shareSeriesContractor.push((Number(cls['Contractor']) || 0) / total);
    } else {
      shareSeriesSLG.push(0);
      shareSeriesWorkdayRegions.push(0);
      shareSeriesContractor.push(0);
    }
  });

  return {
    quarters: quarters,
    categoryByQuarter: categoryByQuarter,
    regionByQuarter: regionByQuarter,
    bannerSummary: {
      latestQuarter: latestQ,
      latestQuarterHours: latestHours,
      priorQuarter: priorQ,
      qoqAbsHours: qoqAbs,
      qoqPct: qoqPct,
      avgQuarterlyHours: avgQuarterlyHours,
      pooledShareSLG: histGrand > 0 ? catTotals['SLG'] / histGrand : 0,
      pooledShareWorkdayRegions: histGrand > 0 ? catTotals['Workday Regions'] / histGrand : 0,
      pooledShareContractor: histGrand > 0 ? catTotals['Contractor'] / histGrand : 0,
      shareSeriesSLG: shareSeriesSLG,
      shareSeriesWorkdayRegions: shareSeriesWorkdayRegions,
      shareSeriesContractor: shareSeriesContractor,
      totalHoursSeries: totalHoursSeries
    }
  };
}

/**
 * Map Actuals_History storage worker_class to Mix & Trend display class.
 * @param {string} storageClass
 * @return {string|null}
 */
function historyDisplayClass_(storageClass) {
  var wc = String(storageClass || '').trim();
  if (wc === 'SLG' || wc === 'SLG_Real' || wc === 'SLG_Generic') return 'SLG';
  if (wc === 'Non-SLG' || wc === 'External_NonSLG') return 'Workday Regions';
  if (wc === 'Contractor' || wc === 'External_Contractor') return 'Contractor';
  return null;
}

/**
 * Compare fiscal-quarter keys chronologically (e.g. FY26-Q1 < FY26-Q4).
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
function compareFiscalQuarterKeys_(a, b) {
  var ma = String(a || '').match(/^FY(\d{2})-(Q[1-4])$/);
  var mb = String(b || '').match(/^FY(\d{2})-(Q[1-4])$/);
  if (!ma || !mb) return String(a).localeCompare(String(b));
  var ya = parseInt(ma[1], 10);
  var yb = parseInt(mb[1], 10);
  if (ya !== yb) return ya - yb;
  return parseInt(ma[2].charAt(1), 10) - parseInt(mb[2].charAt(1), 10);
}

// ------------------------------------------------------------
// WFM.23 — Soft booking projection (Stage 1)
// ------------------------------------------------------------

/** Per-execution L1 baseline forecast cache (L2 = CacheService). */
var _softBookingBaselineCache_ = { signature: '', forecast: null };

/**
 * Clear WFM.23 projection L1 baseline cache (called from api_flushCaches).
 * L2 entries are keyed on _getEnrichedCacheVersion_() and invalidate via
 * invalidateEnrichedCaches_() version bump.
 */
function invalidateSoftBookingBaselineCache_() {
  _softBookingBaselineCache_.signature = '';
  _softBookingBaselineCache_.forecast = null;
}

/**
 * CacheService key for a projection baseline (version + filter signature).
 * @param {Object} forecastParams
 * @return {string}
 */
function _projectionBaselineCacheKey_(forecastParams) {
  var sig = _projectionFilterSignature_(forecastParams);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig, Utilities.Charset.UTF_8);
  var hex = digest.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
  return 'wfm23:baseline:v' + _getEnrichedCacheVersion_() + ':' + hex;
}

/**
 * Pre-compute per-quarter productive hours for lean baseline caching.
 * @param {Object} worker computeWeeklyForecast_ worker row
 * @param {Array<{week_start:Date, week_key:string}>} weeks
 * @return {Object<string, number>}
 */
function _quarterProductiveForWorker_(worker, weeks) {
  var qp = {};
  (weeks || []).forEach(function (wk) {
    var qk = fiscalQuarterKey_(wk.week_start);
    qp[qk] = (qp[qk] || 0) + productiveHoursForWeek_(worker, wk.week_key);
  });
  return qp;
}

/**
 * Productive hours for one worker-quarter (lean cache or live weekly maps).
 * @param {Object} worker
 * @param {string} qk
 * @param {Array<{week_start:Date, week_key:string}>} weeks
 * @return {number}
 */
function _workerQuarterProductive_(worker, qk, weeks) {
  if (worker.blendedWeekly || worker.productiveWeekly) {
    return sumForecastProductiveForQuarter_(worker, qk, weeks);
  }
  if (worker.quarterProductive && worker.quarterProductive.hasOwnProperty(qk)) {
    return Number(worker.quarterProductive[qk]) || 0;
  }
  return sumForecastProductiveForQuarter_(worker, qk, weeks);
}

/**
 * Lean worker row for L2 baseline cache (quarter sums only; no weekly maps).
 * @param {Object} worker
 * @param {Array<{week_start:Date, week_key:string}>} weeks
 * @return {Object}
 */
function _leanWorkerForCache_(worker, weeks) {
  return {
    resource: worker.resource,
    jobProfile: worker.jobProfile,
    level: worker.level,
    managerOrg: worker.managerOrg,
    managersManager: worker.managersManager,
    icpRole: worker.icpRole,
    teamLabel: worker.teamLabel,
    workerClass: worker.workerClass,
    icpTarget: worker.icpTarget,
    employeeId: worker.employeeId,
    quarterProductive: _quarterProductiveForWorker_(worker, weeks)
  };
}

/**
 * JSON-safe lean forecast payload for CacheService (no Date objects, no
 * per-worker weekly maps — quarterProductive only; must stay <100KB).
 * @param {Object} forecast
 * @return {Object}
 */
function _serializeForecastForCache_(forecast) {
  var weeks = forecast.weeks || [];
  return {
    weeks: weeks.map(function (w) {
      return {
        week_start: _toIso_(w.week_start),
        week_key: String(w.week_key || ''),
        fiscal_year: Number(w.fiscal_year) || 0,
        fiscal_quarter: String(w.fiscal_quarter || ''),
        workdays_in_week: Number(w.workdays_in_week) || 5,
        holiday_hours: Number(w.holiday_hours) || 0
      };
    }),
    workers: (forecast.workers || []).map(function (w) {
      return _leanWorkerForCache_(w, weeks);
    }),
    icp: forecast.icp,
    rawCapacity: Number(forecast.rawCapacity) || 40,
    holidayHoursByWeek: forecast.holidayHoursByWeek || {}
  };
}

/**
 * Rehydrate a cached forecast (week_start → Date).
 * @param {Object} cached
 * @return {Object|null}
 */
function _deserializeForecastFromCache_(cached) {
  if (!cached) return null;
  return {
    weeks: (cached.weeks || []).map(function (w) {
      return {
        week_start: w.week_start ? new Date(w.week_start) : null,
        week_key: String(w.week_key || ''),
        fiscal_year: Number(w.fiscal_year) || 0,
        fiscal_quarter: String(w.fiscal_quarter || ''),
        workdays_in_week: Number(w.workdays_in_week) || 5,
        holiday_hours: Number(w.holiday_hours) || 0
      };
    }),
    workers: cached.workers || [],
    icp: cached.icp,
    rawCapacity: Number(cached.rawCapacity) || 40,
    holidayHoursByWeek: cached.holidayHoursByWeek || {}
  };
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
 * Baseline computeWeeklyForecast_ with L1 (per-execution) + L2 (CacheService).
 * @param {Object} forecastParams
 * @return {{forecast:Object, cacheHit:boolean, l2Hit:boolean}}
 */
function _getCachedBaselineForecast_(forecastParams) {
  var sig = _projectionFilterSignature_(forecastParams);

  if (_softBookingBaselineCache_.signature === sig && _softBookingBaselineCache_.forecast) {
    return {
      forecast: _softBookingBaselineCache_.forecast,
      cacheHit: true,
      l2Hit: false
    };
  }

  var cacheKey = _projectionBaselineCacheKey_(forecastParams);
  var cached = _enrichedCacheRead_(cacheKey);
  if (cached) {
    var fromL2 = _deserializeForecastFromCache_(cached);
    if (fromL2) {
      _softBookingBaselineCache_.signature = sig;
      _softBookingBaselineCache_.forecast = fromL2;
      return { forecast: fromL2, cacheHit: true, l2Hit: true };
    }
  }

  var forecast = computeWeeklyForecast_(forecastParams);
  var serialized = _serializeForecastForCache_(forecast);
  var serializedBytes = JSON.stringify(serialized).length;
  Logger.log('_getCachedBaselineForecast_: serializedBytes=' + serializedBytes +
    ' workers=' + (forecast.workers || []).length +
    (serializedBytes < 100000 ? '' : ' OVER_LIMIT'));
  _enrichedCacheWrite_(cacheKey, serialized, 21600);
  _softBookingBaselineCache_.signature = sig;
  _softBookingBaselineCache_.forecast = forecast;
  return { forecast: forecast, cacheHit: false, l2Hit: false };
}

/**
 * Fiscal quarter keys touched by soft-booking date ranges (dynamic, cap 8).
 * Empty bookings ⇒ scorecard planning window (previous / current / next).
 * @param {Array<{start_date:*, end_date:*}>} softBookings
 * @return {string[]}
 */
function _quarterKeysForSoftBookings_(softBookings) {
  if (!softBookings || !softBookings.length) {
    return scorecardWindowKeys_();
  }
  var minDate = null;
  var maxDate = null;
  softBookings.forEach(function (sb) {
    var s = sb.start_date ? new Date(sb.start_date) : null;
    var e = sb.end_date ? new Date(sb.end_date) : null;
    if (s && !isNaN(s.getTime()) && (!minDate || s < minDate)) minDate = s;
    if (e && !isNaN(e.getTime()) && (!maxDate || e > maxDate)) maxDate = e;
  });
  if (!minDate || !maxDate) return scorecardWindowKeys_();

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
 * On-demand weekly maps for projection-affected workers when the L2
 * baseline is lean (no workerWeekly / blendedWeekly). Scoped to named
 * resources only — avoids a full computeWeeklyForecast_ rebuild.
 * @param {Object} forecast baseline or projected forecast (mutates workers in place)
 * @param {string[]} resourceNames
 * @param {Object} forecastParams computeWeeklyForecast_ params
 * @param {{forceRefresh?:boolean}} [options] when true, rebuild weekly maps even if blendedWeekly exists
 */
function _hydrateWorkersWeeklyForProjection_(forecast, resourceNames, forecastParams, options) {
  if (!forecast || !resourceNames || !resourceNames.length) return;
  options = options || {};
  var forceRefresh = !!options.forceRefresh;
  var targets = {};
  resourceNames.forEach(function (rn) {
    rn = String(rn || '').trim();
    if (rn) targets[rn] = true;
  });
  if (!Object.keys(targets).length) return;

  var needs = false;
  (forecast.workers || []).forEach(function (w) {
    if (targets[w.resource] && (!w.blendedWeekly || forceRefresh)) needs = true;
  });
  if (!needs) return;

  forecastParams = forecastParams || {};
  var viewMode = forecastParams.viewMode || 'Committed';
  var includePto = forecastParams.includeTimeOff !== false;
  var excluded = readExclusions_();
  var calendar = readCalendar_();
  var assignsRaw = (typeof getEnrichedAssignments_ === 'function')
    ? getEnrichedAssignments_() : cachedRead_(ASSIGNMENTS);
  var allocRaw = (typeof getEnrichedAllocations_ === 'function')
    ? getEnrichedAllocations_() : cachedRead_(ALLOC_NORM);
  var actualsByWorker = (typeof getActualsByWorkerWeek_ === 'function')
    ? getActualsByWorkerWeek_() : {};

  var workerByName = {};
  (forecast.workers || []).forEach(function (w) {
    if (!targets[w.resource] || (w.blendedWeekly && !forceRefresh)) return;
    w.workerWeekly = {};
    w.productiveWeekly = {};
    w.projects = {};
    delete w.quarterProductive;
    workerByName[w.resource] = w;
  });

  function addHours(resourceName, weekKey, project, hours, isProductive) {
    var w = workerByName[resourceName];
    if (!w || !hours) return;
    w.workerWeekly[weekKey] = (w.workerWeekly[weekKey] || 0) + hours;
    if (isProductive) {
      w.productiveWeekly[weekKey] = (w.productiveWeekly[weekKey] || 0) + hours;
    }
    var proj = project || 'Unassigned';
    if (!w.projects[proj]) w.projects[proj] = {};
    w.projects[proj][weekKey] = (w.projects[proj][weekKey] || 0) + hours;
  }

  allocRaw.forEach(function (a) {
    if (!a.resource_name || !targets[a.resource_name] || !a.week_key) return;
    if (excluded.has(_exclusionKey_(a.resource_name))) return;
    if (a.allocation_type === 'PTO_Holiday' && !includePto) return;
    var h = Number(a.hours) || 0;
    if (!h) return;
    addHours(a.resource_name, a.week_key, a.project_name, h, a.allocation_type !== 'PTO_Holiday');
  });

  if (viewMode !== 'Actual') {
    assignsRaw.forEach(function (a) {
      if (!a.resource_name || !targets[a.resource_name]) return;
      if (excluded.has(_exclusionKey_(a.resource_name))) return;
      var isCommitted = (a.status === 'Committed');
      var isScenario = (a.status === 'Modeled');
      var include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!forecastParams.scenarioId || a.scenario_id === forecastParams.scenarioId));
      if (!include) return;
      var label = 'Assignment' + (a.opportunity_id ? (' — ' + a.opportunity_id) : '');
      expandAssignmentToWeekly_(a, calendar).forEach(function (wk) {
        addHours(a.resource_name, wk.week_key, label, wk.hours, true);
      });
    });
  }

  Object.keys(workerByName).forEach(function (rn) {
    _blendWorkerWeeklyMaps_(workerByName[rn], actualsByWorker);
  });

  if (viewMode !== 'Actual') {
    var adjRows = [];
    try { adjRows = cachedRead_(CAPACITY_ADJUSTMENTS_SHEET); } catch (e) { adjRows = []; }
    adjRows.forEach(function (adj) {
      if (!adj.resource_name || !targets[adj.resource_name]) return;
      if (excluded.has(_exclusionKey_(adj.resource_name))) return;
      var isCommitted = (adj.status === 'Committed');
      var isModeled = (adj.status === 'Modeled');
      var include = isCommitted ||
        (viewMode === 'Scenario' && isModeled &&
         (!forecastParams.scenarioId || adj.scenario_id === forecastParams.scenarioId));
      if (!include) return;
      applyCapacityAdjustmentWeekly_(function (rn) {
        return workerByName[rn];
      }, adj, calendar);
    });
    Object.keys(workerByName).forEach(function (rn) {
      _syncBlendedWeeklyForecastCells_(workerByName[rn]);
    });
  }
}

/**
 * Weekly capacity cells for soft-booking projection (mirrors api_getResourceDetailV2 /
 * api_getForecastTable weekly grain). Reuses forecast rawCapacity and holidayHoursByWeek.
 * @param {Object} worker forecast worker row
 * @param {Array<{week_key:string}>} visibleWeeks from _deriveVisibleWeeksFiscal_
 * @param {Object} forecast computeWeeklyForecast_ result
 * @return {Array<{weekKey:string, hours:number, icpUtil:number, icpAvailable:number, isActual:boolean}>}
 */
function _workerWeeklyCellsForProjection_(worker, visibleWeeks, forecast) {
  var rawCapacity = Number(forecast.rawCapacity) || 40;
  var holidayHoursByWeek = forecast.holidayHoursByWeek || {};
  return (visibleWeeks || []).map(function (vw) {
    var cell = (worker.blendedWeekly && worker.blendedWeekly[vw.week_key]) ||
      { hours: 0, isActual: false };
    var hours = Number(cell.hours) || 0;
    var holidayHours = Number(holidayHoursByWeek[vw.week_key] || 0);
    var icpAvailable = rawCapacity - holidayHours;
    var icpUtil = icpAvailable > 0 ? (hours / icpAvailable) : 0;
    return {
      weekKey: String(vw.week_key),
      hours: Number(hours) || 0,
      icpUtil: Number(icpUtil) || 0,
      icpAvailable: Number(icpAvailable) || 0,
      isActual: !!cell.isActual
    };
  });
}

/**
 * Build worker / team / org-team quarterly aggregates from a forecast.
 * Current-quarter icpUtil uses D8 bonus-scale pairing (matching buildWorkerQuarters_)
 * when actuals summary provides qtd_icp_plus_forecast_hours and bonus_target.
 * @param {Object} forecast computeWeeklyForecast_ result
 * @param {string[]} quarterKeys
 * @param {Array<{date:Date, hours:number}>} holidays
 * @param {Object} actualsSummary from getActualsSummaryByEmployee_()
 * @param {string} curQ fiscal quarter key for calendar today
 * @param {Object} [baselineForecast] baseline forecast (projected path only; for curQ draft delta)
 * @param {Object} [weeklyWorkerNames] map resourceName→true for workers needing weeks[]
 * @param {Array<{week_key:string}>} [visibleWeeks] visible week window (_deriveVisibleWeeksFiscal_)
 * @return {{worker:Object[], team:Object, orgTeams:Object[]}}
 */
function _aggregateSoftBookingProjection_(forecast, quarterKeys, holidays, actualsSummary, curQ, baselineForecast, weeklyWorkerNames, visibleWeeks) {
  var weeks = forecast.weeks || [];
  var workers = forecast.workers || [];
  actualsSummary = actualsSummary || {};
  curQ = curQ || fiscalQuarterKey_(new Date());
  var calendar = readCalendar_();
  committedAssignmentQuarterIndex_(calendar);
  _wowQuarterTargetIndex_();

  var baselineByEmployeeId = {};
  if (baselineForecast) {
    (baselineForecast.workers || []).forEach(function (bw) {
      baselineByEmployeeId[String(bw.employeeId || '')] = bw;
    });
  }

  /**
   * WFM.25: target-based icpUtil numerator/denominator for one worker-quarter,
   * or null when target_hours <= 0 (excluded from team roll-ups).
   * @param {Object} worker forecast worker row
   * @param {number} productiveHours forecast productive hours for the quarter
   * @param {string} qk
   * @return {{num:number, den:number}|null}
   */
  function icpUtilPair_(worker, productiveHours, qk) {
    var employeeId = String(worker.employeeId || '');
    var den = employeeId ? quarterTargetFromWoW_(employeeId, qk) : null;
    if (den == null || den <= 0) return null;

    var summary = employeeId ? actualsSummary[employeeId] : null;
    var prod = Number(productiveHours) || 0;
    var committedHrs = committedAssignmentHoursForQuarter_(worker.resource, qk, calendar);
    var num;

    if (qk === curQ && summary && summary.qtd_icp_plus_forecast_hours > 0 &&
        summary.bonus_target_billable_hours_eoq > 0) {
      num = (Number(summary.qtd_icp_plus_forecast_hours) || 0) + committedHrs;
      if (baselineForecast) {
        var baseWorker = baselineByEmployeeId[employeeId];
        if (baseWorker) {
          var baseProd = _workerQuarterProductive_(baseWorker, qk, baselineForecast.weeks || []);
          num += prod - baseProd;
        }
      }
    } else if (compareFiscalQuarterKeys_(qk, curQ) < 0) {
      var actual = quarterActualIcpFromWoW_(employeeId, qk);
      num = actual != null ? actual : 0;
    } else {
      var wowFc = quarterForecastIcpFromWoW_(employeeId, qk);
      num = (wowFc != null ? wowFc : prod) + committedHrs;
      if (baselineForecast) {
        var baseWorkerFwd = baselineByEmployeeId[employeeId];
        if (baseWorkerFwd) {
          var baseProdFwd = _workerQuarterProductive_(baseWorkerFwd, qk, baselineForecast.weeks || []);
          num += prod - baseProdFwd;
        }
      }
    }
    return { num: num, den: den };
  }

  function quarterCell_(worker, productiveHours, qk) {
    var qinfo = _quarterCapacityForProjection_(qk, holidays);
    var icpAvail = qinfo.icpAvailableHours;
    var rawCap = qinfo.rawCapacityHours;
    var prod = Number(productiveHours) || 0;
    var pair = icpUtilPair_(worker, prod, qk);
    var displayProd = pair ? pair.num : prod;
    var icpUtil = pair ? (pair.den > 0 ? pair.num / pair.den : null) : null;
    return {
      quarterKey: String(qk),
      productiveHours: displayProd,
      icpAvailableHours: icpAvail,
      rawCapacityHours: rawCap,
      icpUtil: icpUtil,
      financeUtil: rawCap > 0 ? displayProd / rawCap : 0,
      approximate: !!qinfo.approximate
    };
  }

  function aggregateQuarters_(group) {
    return quarterKeys.map(function (qk) {
      var sumProd = 0;
      var sumIcpAvail = 0;
      var sumRawCap = 0;
      var sumIcpNum = 0;
      var sumIcpDen = 0;
      var approx = false;
      group.forEach(function (w) {
        var prod = _workerQuarterProductive_(w, qk, weeks);
        var qinfo = _quarterCapacityForProjection_(qk, holidays);
        sumIcpAvail += qinfo.icpAvailableHours;
        sumRawCap += qinfo.rawCapacityHours;
        if (qinfo.approximate) approx = true;
        var pair = icpUtilPair_(w, prod, qk);
        if (pair) {
          sumProd += pair.num;
          sumIcpNum += pair.num;
          sumIcpDen += pair.den;
        } else {
          sumProd += prod;
        }
      });
      var icpUtil = sumIcpDen > 0 ? sumIcpNum / sumIcpDen : null;
      return {
        quarterKey: String(qk),
        productiveHours: Number(sumProd) || 0,
        icpAvailableHours: Number(sumIcpAvail) || 0,
        rawCapacityHours: Number(sumRawCap) || 0,
        icpUtil: icpUtil,
        financeUtil: sumRawCap > 0 ? sumProd / sumRawCap : 0,
        approximate: approx
      };
    });
  }

  var workerOut = workers.map(function (w) {
    var row = {
      employeeId: String(w.employeeId || ''),
      resourceName: String(w.resource || ''),
      teamLabel: String(w.teamLabel || ''),
      managerOrg: String(w.managerOrg || ''),
      quarters: quarterKeys.map(function (qk) {
        return quarterCell_(w, _workerQuarterProductive_(w, qk, weeks), qk);
      })
    };
    if (weeklyWorkerNames && weeklyWorkerNames[w.resource] && visibleWeeks && visibleWeeks.length) {
      row.weeks = _workerWeeklyCellsForProjection_(w, visibleWeeks, forecast);
    }
    return row;
  });

  return {
    worker: workerOut,
    team: { quarters: aggregateQuarters_(workers) },
    orgTeams: (function () {
      var byLabel = {};
      workers.forEach(function (w) {
        var label = String(w.teamLabel || 'Unclassified');
        if (!byLabel[label]) byLabel[label] = [];
        byLabel[label].push(w);
      });
      return Object.keys(byLabel).sort().map(function (label) {
        return { teamLabel: String(label), quarters: aggregateQuarters_(byLabel[label]) };
      });
    })()
  };
}

/**
 * WFM.23 Stage 1.5: apply soft-booking hours as a delta on the cached
 * baseline forecast — clone affected workers only; baseline objects are
 * never mutated (gate check 2).
 * @param {Object} baselineForecast computeWeeklyForecast_ result
 * @param {Array<Object>} assignments in-memory Modeled assignment shapes
 * @return {{forecast:Object, affectedWorkers:number}}
 */
function _buildProjectedForecastDelta_(baselineForecast, assignments) {
  if (!assignments || !assignments.length) {
    return { forecast: baselineForecast, affectedWorkers: 0 };
  }
  var calendar = readCalendar_();
  var workerByName = {};
  (baselineForecast.workers || []).forEach(function (w) {
    workerByName[w.resource] = w;
  });

  var deltasByResource = {};
  assignments.forEach(function (a) {
    if (!a.resource_name || !workerByName[a.resource_name]) return;
    expandAssignmentToWeekly_(a, calendar).forEach(function (w) {
      var rn = a.resource_name;
      if (!deltasByResource[rn]) deltasByResource[rn] = {};
      var hrs = Number(w.hours) || 0;
      if (!hrs) return;
      deltasByResource[rn][w.week_key] = (deltasByResource[rn][w.week_key] || 0) + hrs;
    });
  });

  var affectedNames = Object.keys(deltasByResource);
  if (!affectedNames.length) {
    return { forecast: baselineForecast, affectedWorkers: 0 };
  }

  var projectedWorkers = (baselineForecast.workers || []).map(function (w) {
    var delta = deltasByResource[w.resource];
    if (!delta) return w;
    var clone = {
      resource: w.resource,
      jobProfile: w.jobProfile,
      level: w.level,
      managerOrg: w.managerOrg,
      managersManager: w.managersManager,
      icpRole: w.icpRole,
      teamLabel: w.teamLabel,
      workerClass: w.workerClass,
      icpTarget: w.icpTarget,
      employeeId: w.employeeId,
      workerWeekly: Object.assign({}, w.workerWeekly || {}),
      productiveWeekly: Object.assign({}, w.productiveWeekly || {}),
      projects: JSON.parse(JSON.stringify(w.projects || {})),
      blendedWeekly: JSON.parse(JSON.stringify(w.blendedWeekly || {}))
    };
    Object.keys(delta).forEach(function (wk) {
      var hrs = delta[wk];
      clone.productiveWeekly[wk] = (clone.productiveWeekly[wk] || 0) + hrs;
      clone.workerWeekly[wk] = (clone.workerWeekly[wk] || 0) + hrs;
    });
    _syncBlendedWeeklyForecastCells_(clone);
    return clone;
  });

  return {
    forecast: {
      weeks: baselineForecast.weeks,
      workers: projectedWorkers,
      icp: baselineForecast.icp,
      rawCapacity: baselineForecast.rawCapacity,
      holidayHoursByWeek: baselineForecast.holidayHoursByWeek
    },
    affectedWorkers: affectedNames.length
  };
}

/**
 * WFM.25: apply draft reduction hours as a subtractive delta on the cached
 * baseline forecast — per-week zero-clamp on productive hours (never Modeled).
 * @param {Object} baselineForecast computeWeeklyForecast_ result
 * @param {Array<Object>} adjustments in-memory reduction shapes (hours_reduction > 0)
 * @return {{forecast:Object, affectedWorkers:number}}
 */
function _buildProjectedReductionDelta_(baselineForecast, adjustments) {
  if (!adjustments || !adjustments.length) {
    return { forecast: baselineForecast, affectedWorkers: 0 };
  }
  var calendar = readCalendar_();
  var workerByName = {};
  (baselineForecast.workers || []).forEach(function (w) {
    workerByName[w.resource] = w;
  });

  var affectedNames = [];
  adjustments.forEach(function (adj) {
    if (!adj.resource_name || !workerByName[adj.resource_name]) return;
    if (affectedNames.indexOf(adj.resource_name) < 0) affectedNames.push(adj.resource_name);
  });

  if (!affectedNames.length) {
    return { forecast: baselineForecast, affectedWorkers: 0 };
  }

  var projectedWorkers = (baselineForecast.workers || []).map(function (w) {
    if (affectedNames.indexOf(w.resource) < 0) return w;
    var clone = {
      resource: w.resource,
      jobProfile: w.jobProfile,
      level: w.level,
      managerOrg: w.managerOrg,
      managersManager: w.managersManager,
      icpRole: w.icpRole,
      teamLabel: w.teamLabel,
      workerClass: w.workerClass,
      icpTarget: w.icpTarget,
      employeeId: w.employeeId,
      workerWeekly: Object.assign({}, w.workerWeekly || {}),
      productiveWeekly: Object.assign({}, w.productiveWeekly || {}),
      projects: JSON.parse(JSON.stringify(w.projects || {})),
      blendedWeekly: JSON.parse(JSON.stringify(w.blendedWeekly || {}))
    };
    delete clone.quarterProductive;
    adjustments.forEach(function (adj) {
      if (adj.resource_name !== w.resource) return;
      applyCapacityAdjustmentWeekly_(function () { return clone; }, adj, calendar);
    });
    _syncBlendedWeeklyForecastCells_(clone);
    return clone;
  });

  return {
    forecast: {
      weeks: baselineForecast.weeks,
      workers: projectedWorkers,
      icp: baselineForecast.icp,
      rawCapacity: baselineForecast.rawCapacity,
      holidayHoursByWeek: baselineForecast.holidayHoursByWeek
    },
    affectedWorkers: affectedNames.length
  };
}

/**
 * Summarize per-resource clamp for draft reductions (requested vs applied totals).
 * @param {Object} baselineForecast
 * @param {Array<Object>} adjustments
 * @return {Array<{resource_name:string, requested_hours:number, effective_hours:number}>}
 */
function _reductionClampWarnings_(baselineForecast, adjustments) {
  if (!adjustments || !adjustments.length) return [];
  var calendar = readCalendar_();
  var actualsByWorker = (typeof getActualsByWorkerWeek_ === 'function')
    ? getActualsByWorkerWeek_() : {};
  var workerByName = {};
  (baselineForecast.workers || []).forEach(function (w) {
    workerByName[w.resource] = w;
  });
  var warnings = [];
  adjustments.forEach(function (adj) {
    if (!adj.resource_name || !workerByName[adj.resource_name]) return;
    var src = workerByName[adj.resource_name];
    var snap = {
      employeeId: src.employeeId,
      productiveWeekly: Object.assign({}, src.productiveWeekly || {}),
      workerWeekly: Object.assign({}, src.workerWeekly || {}),
      projects: JSON.parse(JSON.stringify(src.projects || {})),
      blendedWeekly: src.blendedWeekly
        ? JSON.parse(JSON.stringify(src.blendedWeekly))
        : undefined
    };
    if (!snap.blendedWeekly) {
      _blendWorkerWeeklyMaps_(snap, actualsByWorker);
    }
    var clamped = expandClampedAdjustmentWeekly_(snap, adj, calendar, false);
    if (clamped.requested > clamped.applied + 0.05) {
      warnings.push({
        resource_name: String(adj.resource_name),
        requested_hours: clamped.requested,
        effective_hours: clamped.applied
      });
    }
  });
  return warnings;
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
  var baselineCacheHit = baselineCached.l2Hit;
  var holidays = readHolidays_();
  var quarterKeys = _quarterKeysForSoftBookings_(softBookings);

  var inMemoryModeledAssignments = softBookings.filter(function (sb) {
    return String(sb.direction || 'add') !== 'reduce';
  }).map(function (sb) {
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

  var inMemoryDraftReductions = softBookings.filter(function (sb) {
    return String(sb.direction || 'add') === 'reduce';
  }).map(function (sb) {
    return {
      resource_name: String(sb.resource_name || ''),
      start_date: sb.start_date ? new Date(sb.start_date) : null,
      end_date: sb.end_date ? new Date(sb.end_date) : null,
      hours_reduction: Number(sb.total_hours) || 0,
      distribution: 'Even'
    };
  }).filter(function (a) {
    return a.resource_name && a.start_date && a.end_date && !isNaN(a.start_date.getTime()) &&
      !isNaN(a.end_date.getTime()) && a.hours_reduction > 0;
  });

  var actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
    ? getActualsSummaryByEmployee_() : {};
  var curQ = fiscalQuarterKey_(new Date());
  var visibleWeeks = _deriveVisibleWeeksFiscal_(baselineForecast.weeks);
  var weeklyWorkerNames = {};
  softBookings.forEach(function (sb) {
    var rn = String(sb.resource_name || '');
    if (rn) weeklyWorkerNames[rn] = true;
  });
  if (inMemoryModeledAssignments.length || inMemoryDraftReductions.length) {
    var baselineByName = {};
    (baselineForecast.workers || []).forEach(function (w) {
      baselineByName[w.resource] = w;
    });
    inMemoryModeledAssignments.forEach(function (a) {
      if (a.resource_name && baselineByName[a.resource_name]) {
        weeklyWorkerNames[a.resource_name] = true;
      }
    });
    inMemoryDraftReductions.forEach(function (a) {
      if (a.resource_name && baselineByName[a.resource_name]) {
        weeklyWorkerNames[a.resource_name] = true;
      }
    });
  }

  var hydrateNames = Object.keys(weeklyWorkerNames);
  if (hydrateNames.length) {
    _hydrateWorkersWeeklyForProjection_(baselineForecast, hydrateNames, forecastParams, {
      forceRefresh: inMemoryDraftReductions.length > 0
    });
  }

  var projectedForecast = baselineForecast;
  var affectedWorkerCount = 0;
  var projectedMode = 'baseline';
  var clampWarnings = [];
  if (inMemoryModeledAssignments.length) {
    var deltaResult = _buildProjectedForecastDelta_(baselineForecast, inMemoryModeledAssignments);
    projectedForecast = deltaResult.forecast;
    affectedWorkerCount = deltaResult.affectedWorkers;
    projectedMode = 'targeted';
  }
  if (inMemoryDraftReductions.length) {
    clampWarnings = _reductionClampWarnings_(projectedForecast, inMemoryDraftReductions);
    var reduceResult = _buildProjectedReductionDelta_(projectedForecast, inMemoryDraftReductions);
    projectedForecast = reduceResult.forecast;
    affectedWorkerCount = Math.max(affectedWorkerCount, reduceResult.affectedWorkers);
    projectedMode = 'targeted';
  }

  var result = {
    baseline: _aggregateSoftBookingProjection_(
      baselineForecast, quarterKeys, holidays, actualsSummary, curQ, null, weeklyWorkerNames, visibleWeeks),
    projected: _aggregateSoftBookingProjection_(
      projectedForecast, quarterKeys, holidays, actualsSummary, curQ, baselineForecast, weeklyWorkerNames, visibleWeeks),
    clampWarnings: clampWarnings
  };

  Logger.log('api_projectSoftBookings: elapsed ' + (Date.now() - t0) + 'ms' +
    ' baselineCache=' + (baselineCacheHit ? 'hit' : 'miss') +
    ' projectedMode=' + projectedMode +
    ' affectedWorkers=' + affectedWorkerCount +
    ' workers=' + (baselineForecast.workers || []).length +
    ' quarters=' + quarterKeys.length +
    ' bookings=' + softBookings.length);
  return result;
}

/**
 * Resolve resource_type for a soft-booking commit. Uses the booking payload
 * when present; otherwise looks up the worker in the resource index by name
 * or employee_id. Blank-safe — returns '' when no type is known.
 * @param {Object} booking
 * @return {string}
 */
function _resolveBookingResourceType_(booking) {
  var fromBooking = String((booking && booking.resource_type) || '').trim();
  if (fromBooking) return fromBooking;

  var resourceName = String((booking && booking.resource_name) || '').trim();
  var employeeId = String((booking && booking.employee_id) || '').trim();
  if (!resourceName && !employeeId) return '';

  var resIndex = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_()
    : _resourceIndex_(cachedRead_(ALLOC_NORM));

  var info = null;
  if (resourceName && resIndex[resourceName]) {
    info = resIndex[resourceName];
  } else if (employeeId) {
    Object.keys(resIndex).some(function (k) {
      if (String(resIndex[k].employee_id || '').trim() === employeeId) {
        info = resIndex[k];
        return true;
      }
      return false;
    });
  }

  return info ? String(info.resource_type || '').trim() : '';
}

/**
 * WFM.23 Stage 3 / WFM.25 two-state: promote soft-booking drafts to Committed assignments.
 * @param {string} scenarioName non-empty → always creates a NEW scenario via saveScenario_
 * @param {Array<Object>} bookings
 * @return {{scenario_id:string, committed:Object[], count:number}}
 */
function api_commitSoftBookings(scenarioName, bookings) {
  _requireAuthorized_();
  scenarioName = String(scenarioName || '').trim();
  bookings = bookings || [];

  var scenarioId = '';
  if (scenarioName) {
    var scen = saveScenario_({
      name: scenarioName,
      description: 'WFM.23 soft-booking submit-all',
      status: 'Active'
    });
    scenarioId = scen ? String(scen.scenario_id || '') : '';
  }

  var committed = [];
  bookings.forEach(function (b) {
    var direction = String(b.direction || 'add').toLowerCase();
    var what = b.what || {};
    var whatType = String(what.type || '');
    var notes = '';
    var identity = (typeof resolveBookingProjectIdentity_ === 'function')
      ? resolveBookingProjectIdentity_(b) : {
        project_id_type: '', project_id: '', project_label: '',
        opportunity_id: '', deployment_id: ''
      };

    if (whatType === 'label') {
      notes = 'Soft-book label: ' + String(what.label || '');
    } else if (identity.deployment_id && !identity.project_label) {
      notes = 'Soft-book deployment: ' + identity.deployment_id;
    } else if (identity.opportunity_id && !identity.project_label) {
      notes = 'Opportunity: ' + identity.opportunity_id;
    }

    var resolvedResourceType = _resolveBookingResourceType_(b);

    if (direction === 'reduce') {
      var savedAdj = saveCapacityAdjustment_({
        resource_name: String(b.resource_name || ''),
        start_date: b.start_date,
        end_date: b.end_date,
        hours_reduction: Number(b.total_hours) || 0,
        direction: 'reduce',
        distribution: 'Even',
        status: 'Committed',
        scenario_id: scenarioId,
        deployment_id: identity.deployment_id || '',
        reason: notes || identity.project_label || ''
      });
      committed.push({
        resource_name: String(savedAdj.resource_name || b.resource_name || ''),
        adjustment_id: String(savedAdj.adjustment_id || ''),
        direction: 'reduce'
      });
      return;
    }

    var saved = saveAssignment_({
      opportunity_id: identity.opportunity_id || '',
      project_id_type: identity.project_id_type || '',
      project_id: identity.project_id || '',
      project_label: identity.project_label || '',
      resource_name: String(b.resource_name || ''),
      resource_type: resolvedResourceType,
      start_date: b.start_date,
      end_date: b.end_date,
      estimated_hours: Number(b.total_hours) || 0,
      distribution: 'Even',
      status: 'Committed',
      scenario_id: scenarioId,
      notes: notes
    });
    committed.push({
      resource_name: String(saved.resource_name || b.resource_name || ''),
      assignment_id: String(saved.assignment_id || ''),
      direction: 'add'
    });
  });

  invalidateCache_(ASSIGNMENTS);
  invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  if (typeof _resetProjectionMemos_ === 'function') _resetProjectionMemos_();
  invalidateSoftBookingBaselineCache_();

  Logger.log('api_commitSoftBookings: scenario_id=' + scenarioId + ' count=' + committed.length);
  return {
    scenario_id: scenarioId,
    committed: committed,
    count: committed.length
  };
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

/**
 * Map specialty values to leadership team labels from Config_Resource_Type.
 * Keys on resource_type (full WoW specialty strings); unmapped values resolve at lookup time.
 * @return {Object<string,string>} resource_type -> team_label
 */
function buildSpecialtyTeamMap_() {
  return readConfigResourceType_();
}

/**
 * Resolve a specialty practice to a leadership team label for demand grouping.
 * @param {string} specialtyPractice
 * @param {Object<string,string>} teamMap
 * @return {string}
 */
function resolveSpecialtyTeamLabel_(specialtyPractice, teamMap) {
  var sp = String(specialtyPractice || '').trim();
  if (!sp || sp === 'Unclassified' || sp === 'Student') return 'Other / Unmapped';
  if (!teamMap) return 'Other / Unmapped';

  var team = teamMap[sp];
  if (!team) {
    var lower = sp.toLowerCase();
    Object.keys(teamMap).forEach(function (k) {
      if (!team && k.toLowerCase() === lower) team = teamMap[k];
    });
  }
  if (!team || team === 'Unclassified') return 'Other / Unmapped';
  return team;
}

/**
 * Sort specialty demand rows: totalHours desc; Unclassified last.
 * @param {Array} rows
 * @return {Array}
 */
function sortSpecialtyDemandRows_(rows) {
  rows.sort(function (a, b) {
    if (a.specialtyPractice === 'Unclassified' && b.specialtyPractice !== 'Unclassified') return 1;
    if (b.specialtyPractice === 'Unclassified' && a.specialtyPractice !== 'Unclassified') return -1;
    return (Number(b.totalHours) || 0) - (Number(a.totalHours) || 0);
  });
  return rows;
}

/**
 * Sort sub-specialty rows: totalHours desc; Unclassified last.
 * @param {Array} rows
 * @return {Array}
 */
function sortSpecialtySubRows_(rows) {
  rows.sort(function (a, b) {
    if (a.subSpecialtyPractice === 'Unclassified' && b.subSpecialtyPractice !== 'Unclassified') return 1;
    if (b.subSpecialtyPractice === 'Unclassified' && a.subSpecialtyPractice !== 'Unclassified') return -1;
    return (Number(b.totalHours) || 0) - (Number(a.totalHours) || 0);
  });
  return rows;
}

/**
 * Whether an Actuals_History row counts toward SLG-scoped specialty demand.
 * Actuals_History uses flat worker_class ('SLG' / 'Non-SLG' / 'Contractor'), not
 * roster vocabulary (SLG_Real / SLG_Generic). Aligns with historyDisplayClass_.
 * When worker_class is absent, excludes Corporate region (cross-org marker).
 * @param {Object} row Actuals_History row
 * @return {boolean}
 */
function specialtyActualsRowInSlgScope_(row) {
  var wc = String((row && row.worker_class) || '').trim();
  if (wc) {
    return historyDisplayClass_(wc) === 'SLG';
  }
  var region = String((row && row.workday_region_as_of_date_worked) || '').trim();
  return region !== 'Corporate';
}

/**
 * WFM.25 Pass 3C: historical worked hours by specialty practice × fiscal quarter.
 * Read-only aggregation over Actuals_History; no reconciliation changes.
 * SLG delivery scope only (reuses worker-scope classification).
 * @param {Object} [params] reserved for future filter params
 * @return {{
 *   quarters: string[],
 *   rows: Array<{specialtyPractice:string, hoursByQuarter:Object<string,number>, totalHours:number,
 *     subRows:Array<{subSpecialtyPractice:string, hoursByQuarter:Object<string,number>, totalHours:number}>}>,
 *   grandTotalByQuarter: Object<string,number>,
 *   grandTotal: number,
 *   specialtyTeamMap: Object<string,string>
 * }}
 */
function api_getSpecialtyActuals(params) {
  _requireAuthorized_();
  params = params || {};

  var histRows = readTable_(ACTUALS_HISTORY) || [];
  var quarterSet = {};
  var spBucket = {};
  var grandTotalByQuarter = {};
  var grandTotal = 0;

  histRows.forEach(function (r) {
    if (!specialtyActualsRowInSlgScope_(r)) return;

    var fq = String(r.fiscal_quarter || '').trim();
    if (!fq) return;
    var hrs = Number(r.worked_hours) || 0;
    if (!hrs) return;

    var sp = String(r.specialty_practice || '').trim() || 'Unclassified';
    var subSp = String(r.sub_specialty_practice || '').trim() || 'Unclassified';

    quarterSet[fq] = true;
    grandTotalByQuarter[fq] = (grandTotalByQuarter[fq] || 0) + hrs;
    grandTotal += hrs;

    if (!spBucket[sp]) {
      spBucket[sp] = { hoursByQuarter: {}, sub: {} };
    }
    spBucket[sp].hoursByQuarter[fq] = (spBucket[sp].hoursByQuarter[fq] || 0) + hrs;

    if (!spBucket[sp].sub[subSp]) {
      spBucket[sp].sub[subSp] = {};
    }
    spBucket[sp].sub[subSp][fq] = (spBucket[sp].sub[subSp][fq] || 0) + hrs;
  });

  var quarters = Object.keys(quarterSet).sort(compareFiscalQuarterKeys_);

  var rows = Object.keys(spBucket).map(function (sp) {
    var entry = spBucket[sp];
    var hoursByQuarter = {};
    var totalHours = 0;
    quarters.forEach(function (qk) {
      var h = Number(entry.hoursByQuarter[qk]) || 0;
      hoursByQuarter[qk] = h;
      totalHours += h;
    });

    var subRows = Object.keys(entry.sub || {}).map(function (subSp) {
      var subEntry = entry.sub[subSp];
      var subHoursByQuarter = {};
      var subTotal = 0;
      quarters.forEach(function (qk) {
        var sh = Number(subEntry[qk]) || 0;
        subHoursByQuarter[qk] = sh;
        subTotal += sh;
      });
      return {
        subSpecialtyPractice: subSp,
        hoursByQuarter: subHoursByQuarter,
        totalHours: subTotal
      };
    });
    sortSpecialtySubRows_(subRows);

    return {
      specialtyPractice: sp,
      hoursByQuarter: hoursByQuarter,
      totalHours: totalHours,
      subRows: subRows
    };
  });
  sortSpecialtyDemandRows_(rows);

  return {
    quarters: quarters,
    rows: rows,
    grandTotalByQuarter: grandTotalByQuarter,
    grandTotal: grandTotal,
    specialtyTeamMap: buildSpecialtyTeamMap_()
  };
}

/**
 * WFM.25 Pass 3B: org-level forecast demand hours by specialty practice × fiscal quarter.
 * Read-only aggregation over computeWeeklyForecast_ productive hours; no reconciliation changes.
 * SLG delivery scope only (reuses worker-scope classification).
 * @param {Object} params same filter shape as api_getForecastTable
 * @return {{
 *   quarters: string[],
 *   currentQuarterKey: string,
 *   rows: Array<{specialtyPractice:string, hoursByQuarter:Object<string,number>, totalHours:number}>,
 *   grandTotalByQuarter: Object<string,number>,
 *   grandTotal: number,
 *   specialtyTeamMap: Object<string,string>
 * }}
 */
function api_getSpecialtyDemand(params) {
  _requireAuthorized_();
  params = params || {};

  var forecast = computeWeeklyForecast_({
    viewMode: params.viewMode,
    scenarioId: params.scenarioId,
    teams: params.teams,
    teamLabel: params.teamLabel,
    workerScope: 'SLG',
    includeMyManagers: params.includeMyManagers,
    includeTimeOff: params.includeTimeOff
  });

  var quarterKeys = scorecardWindowKeys_();
  var curQ = fiscalQuarterKey_(new Date());
  var weeks = forecast.weeks || [];

  var allocRows = [];
  try {
    allocRows = cachedRead_(ALLOC_NORM);
  } catch (e) {
    allocRows = [];
  }
  var workerSpMap = buildWorkerSpecialtyPracticeMap_(allocRows);

  var bucket = {};
  var grandTotalByQuarter = {};
  quarterKeys.forEach(function (qk) { grandTotalByQuarter[qk] = 0; });
  var grandTotal = 0;

  (forecast.workers || []).forEach(function (worker) {
    var sp = workerSpMap[worker.resource] || 'Unclassified';
    if (!bucket[sp]) {
      bucket[sp] = {};
      quarterKeys.forEach(function (qk) { bucket[sp][qk] = 0; });
    }
    quarterKeys.forEach(function (qk) {
      var hrs = sumForecastProductiveForQuarter_(worker, qk, weeks);
      bucket[sp][qk] += hrs;
      grandTotalByQuarter[qk] += hrs;
      grandTotal += hrs;
    });
  });

  var rows = Object.keys(bucket).map(function (sp) {
    var hoursByQuarter = {};
    var totalHours = 0;
    quarterKeys.forEach(function (qk) {
      var h = Number(bucket[sp][qk]) || 0;
      hoursByQuarter[qk] = h;
      totalHours += h;
    });
    return {
      specialtyPractice: sp,
      hoursByQuarter: hoursByQuarter,
      totalHours: totalHours
    };
  });

  rows.sort(function (a, b) {
    if (a.specialtyPractice === 'Unclassified' && b.specialtyPractice !== 'Unclassified') return 1;
    if (b.specialtyPractice === 'Unclassified' && a.specialtyPractice !== 'Unclassified') return -1;
    return b.totalHours - a.totalHours;
  });

  return {
    quarters: quarterKeys,
    currentQuarterKey: curQ,
    rows: rows,
    grandTotalByQuarter: grandTotalByQuarter,
    grandTotal: grandTotal,
    specialtyTeamMap: buildSpecialtyTeamMap_()
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

/**
 * Read WFM.25 unified utilization color band edges from Config_Settings.
 * Falls back to UTIL_BAND_DEFAULTS when a key is blank or bands are malformed.
 * @returns {{coldMax:number, ontargetMax:number, warmMax:number}}
 */
function _readUtilBandSettings_() {
  const defaults = UTIL_BAND_DEFAULTS;
  const keys = UTIL_BAND_SETTING_KEYS;
  try {
    const settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
    const read = function (settingKey, fallback) {
      const raw = String(settings[settingKey] || '').trim();
      const v = raw ? Number(raw) : NaN;
      return (v > 0) ? v : fallback;
    };
    const bands = {
      coldMax: read(keys.coldMax, defaults.coldMax),
      ontargetMax: read(keys.ontargetMax, defaults.ontargetMax),
      warmMax: read(keys.warmMax, defaults.warmMax)
    };
    if (!(bands.coldMax < bands.ontargetMax && bands.ontargetMax < bands.warmMax)) {
      Logger.log('_readUtilBandSettings_: malformed util_band config — using defaults');
      return Object.assign({}, defaults);
    }
    return bands;
  } catch (e) {
    return Object.assign({}, defaults);
  }
}

/**
 * Validate a Config_Settings util band color (#RGB or #RRGGBB).
 * @param {string} value
 * @returns {boolean}
 */
function _isValidUtilHexColor_(value) {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(String(value || '').trim());
}

/**
 * Read WFM.25 unified utilization band colors from Config_Settings.
 * Falls back to UTIL_COLOR_DEFAULTS when a key is blank or malformed.
 * @returns {{coldBg:string, coldFg:string, ontargetBg:string, ontargetFg:string, warmBg:string, warmFg:string, hotBg:string, hotFg:string}}
 */
function _readUtilColorSettings_() {
  const defaults = UTIL_COLOR_DEFAULTS;
  const keys = UTIL_COLOR_SETTING_KEYS;
  try {
    const settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
    const read = function (settingKey, fallback) {
      const raw = String(settings[settingKey] || '').trim();
      if (_isValidUtilHexColor_(raw)) return raw;
      if (raw) {
        Logger.log('_readUtilColorSettings_: malformed ' + settingKey + '="' + raw + '" — using fallback');
      }
      return fallback;
    };
    return {
      coldBg: read(keys.coldBg, defaults.coldBg),
      coldFg: read(keys.coldFg, defaults.coldFg),
      ontargetBg: read(keys.ontargetBg, defaults.ontargetBg),
      ontargetFg: read(keys.ontargetFg, defaults.ontargetFg),
      warmBg: read(keys.warmBg, defaults.warmBg),
      warmFg: read(keys.warmFg, defaults.warmFg),
      hotBg: read(keys.hotBg, defaults.hotBg),
      hotFg: read(keys.hotFg, defaults.hotFg)
    };
  } catch (e) {
    return Object.assign({}, defaults);
  }
}

/**
 * Read WFM.25 exception-glyph settings from Config_Settings (read-only).
 * Falls back to UTIL_GLYPH_DEFAULTS when a key is blank.
 * @returns {{fire:string, cold:string, enabled:string}}
 */
function _readUtilGlyphSettings_() {
  const defaults = UTIL_GLYPH_DEFAULTS;
  const keys = UTIL_GLYPH_SETTING_KEYS;
  try {
    const settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
    const read = function (settingKey, fallback) {
      const raw = String(settings[settingKey] || '').trim();
      return raw || fallback;
    };
    return {
      fire: read(keys.fire, defaults.fire),
      cold: read(keys.cold, defaults.cold),
      enabled: read(keys.enabled, defaults.enabled)
    };
  } catch (e) {
    return Object.assign({}, defaults);
  }
}

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

  const utilBands = _readUtilBandSettings_();
  const utilColors = _readUtilColorSettings_();
  const utilGlyphs = _readUtilGlyphSettings_();

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
    allocOverRatio: (function () {
      try {
        const settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
        const raw = String(settings.alloc_over_ratio || '').trim();
        const v = raw ? Number(raw) : NaN;
        return (v > 0) ? v : 1.10;
      } catch (e) {
        return 1.10;
      }
    })(),
    allocUnderRatio: (function () {
      try {
        const settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
        const raw = String(settings.alloc_under_ratio || '').trim();
        const v = raw ? Number(raw) : NaN;
        return (v > 0) ? v : 0.85;
      } catch (e) {
        return 0.85;
      }
    })(),
    utilBandColdMax: utilBands.coldMax,
    utilBandOntargetMax: utilBands.ontargetMax,
    utilBandWarmMax: utilBands.warmMax,
    utilColorColdBg: utilColors.coldBg,
    utilColorColdFg: utilColors.coldFg,
    utilColorOntargetBg: utilColors.ontargetBg,
    utilColorOntargetFg: utilColors.ontargetFg,
    utilColorWarmBg: utilColors.warmBg,
    utilColorWarmFg: utilColors.warmFg,
    utilColorHotBg: utilColors.hotBg,
    utilColorHotFg: utilColors.hotFg,
    utilGlyphFire: utilGlyphs.fire,
    utilGlyphCold: utilGlyphs.cold,
    utilGlyphEnabled: utilGlyphs.enabled,
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
    team_label: String(a.team_label || ''),          // Priority 4
    project_id_type: String(a.project_id_type || ''),
    project_id: String(a.project_id || ''),
    project_label: String(a.project_label || '')
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
      override: (r.override !== undefined ? r.override : prev.override) || '',
      return_date: (r.return_date !== undefined ? r.return_date : prev.return_date) || '',
      modified_by: (r.modified_by !== undefined ? r.modified_by : prev.modified_by) || '',
      modified_at: (r.modified_at !== undefined ? r.modified_at : prev.modified_at) || ''
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

/**
 * Read-only directory search for WFM.25 global search overlay.
 * Matches teams, workers, and roles from enriched resource index — no writes.
 * @param {string} query
 * @return {{teams:Object[], workers:Object[], roles:Object[]}}
 */
function api_searchDirectory(query) {
  _requireAuthorized_();
  var q = String(query || '').trim().toLowerCase();
  if (!q) return { teams: [], workers: [], roles: [] };

  var resIndex = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_()
    : _resourceIndex_(readTable_(ALLOC_NORM));

  var teamSet = {};
  var workers = [];
  var roleMap = {};
  var workerCap = 12;
  var teamCap = 8;
  var roleCap = 8;

  Object.keys(resIndex || {}).forEach(function (key) {
    var res = resIndex[key];
    if (!res) return;
    var name = String(res.name || '').trim();
    var team = String(res.resolved_team || '').trim();
    var role = String(res.role_category || res.icp || '').trim();
    if (!name) return;

    if (team && team.toLowerCase().indexOf(q) >= 0) {
      teamSet[team] = true;
    }
    if (name.toLowerCase().indexOf(q) >= 0 && workers.length < workerCap) {
      workers.push({
        name: name,
        teamLabel: team,
        roleCategory: role
      });
    }
    if (role && role.toLowerCase().indexOf(q) >= 0) {
      if (!roleMap[role]) {
        roleMap[role] = { label: role, count: 0, sampleTeam: team || '' };
      }
      roleMap[role].count++;
      if (!roleMap[role].sampleTeam && team) roleMap[role].sampleTeam = team;
    }
  });

  var teams = Object.keys(teamSet).sort(function (a, b) { return a.localeCompare(b); })
    .slice(0, teamCap)
    .map(function (label) { return { label: label }; });

  var roles = Object.keys(roleMap).sort(function (a, b) { return a.localeCompare(b); })
    .slice(0, roleCap)
    .map(function (k) { return roleMap[k]; });

  return { teams: teams, workers: workers, roles: roles };
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

/**
 * Build a wire-safe freshness event (ISO timestamp + detail string).
 * @param {Date|string|number} when
 * @param {string} detail
 * @return {{when:string, detail:string}}
 */
function _dataFreshnessEvent_(when, detail) {
  var whenStr = '';
  try {
    if (when instanceof Date) whenStr = _toIso_(when);
    else if (when) whenStr = _toIso_(new Date(when));
  } catch (e) {
    whenStr = String(when || '');
  }
  return {
    when: whenStr,
    detail: String(detail || '')
  };
}

/**
 * @return {{lastSuccess:Object|null, lastFailure:Object|null}}
 */
function _dataFreshnessNullFeed_() {
  return { lastSuccess: null, lastFailure: null };
}

/**
 * @param {Date|string|number} when
 * @return {boolean}
 */
function _isWithin7Days_(when) {
  if (!when) return false;
  try {
    var d = when instanceof Date ? when : new Date(when);
    if (isNaN(d.getTime())) return false;
    return (Date.now() - d.getTime()) <= 7 * 24 * 60 * 60 * 1000;
  } catch (e) {
    return false;
  }
}

/**
 * WoW ingest freshness from Normalization_Log source='staff'.
 * @return {{lastSuccess:Object|null, lastFailure:Object|null}}
 */
function _dataFreshnessWowIngest_() {
  var out = _dataFreshnessNullFeed_();
  try {
    var rows = (readTable_(REFRESH_LOG) || []).filter(function (r) {
      return String(r.source || '').trim() === 'staff';
    }).sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    rows.some(function (r) {
      if (Number(r.rows_out) > 0) {
        out.lastSuccess = _dataFreshnessEvent_(r.timestamp,
          String(Number(r.rows_out) || 0) + ' rows');
        return true;
      }
      return false;
    });
    rows.some(function (r) {
      var rowsOut = Number(r.rows_out) || 0;
      var warnings = String(r.warnings || '').trim();
      if (rowsOut === 0 || warnings) {
        if (_isWithin7Days_(r.timestamp)) {
          out.lastFailure = _dataFreshnessEvent_(r.timestamp,
            warnings || 'ingest produced 0 rows');
          return true;
        }
      }
      return false;
    });
  } catch (e) {
    Logger.log('_dataFreshnessWowIngest_ failed — ' + e);
  }
  return out;
}

/**
 * Read SF pipeline refresh log rows as wire-safe primitives.
 * @return {Object[]}
 */
function _readSfPipelineRefreshRows_() {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SF_PIPELINE_REFRESH_LOG);
    if (!sh) return [];
    var values = sh.getDataRange().getValues();
    if (!values || values.length < 2) return [];
    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var row = {};
      header.forEach(function (h, j) {
        var v = values[i][j];
        if (v === null || v === undefined) row[h] = '';
        else if (v instanceof Date) row[h] = _toIso_(v);
        else if (typeof v === 'number' || typeof v === 'boolean') row[h] = v;
        else row[h] = String(v);
      });
      out.push(row);
    }
    return out.sort(function (a, b) {
      return new Date(b['Refresh Time']) - new Date(a['Refresh Time']);
    });
  } catch (e) {
    Logger.log('_readSfPipelineRefreshRows_ failed — ' + e);
    return [];
  }
}

/**
 * Pipeline or Deployments freshness from Auto Refresh Execution Log 1.
 * @param {string} sheetName 'Pipeline' | 'Deployments'
 * @return {{lastSuccess:Object|null, lastFailure:Object|null}}
 */
function _dataFreshnessSfFeed_(sheetName) {
  var out = _dataFreshnessNullFeed_();
  var rows = _readSfPipelineRefreshRows_().filter(function (r) {
    return String(r['Sheet'] || '').trim() === sheetName;
  });
  rows.some(function (r) {
    if (String(r['Status'] || '').trim() === 'Success') {
      var detail = String(r['Operation'] || '').trim() || 'Success';
      out.lastSuccess = _dataFreshnessEvent_(r['Refresh Time'], detail);
      return true;
    }
    return false;
  });
  rows.some(function (r) {
    if (String(r['Status'] || '').trim() !== 'Success') {
      if (_isWithin7Days_(r['Refresh Time'])) {
        var status = String(r['Status'] || '').trim() || 'failed';
        var op = String(r['Operation'] || '').trim();
        var detail = op ? (op + ' — ' + status) : status;
        out.lastFailure = _dataFreshnessEvent_(r['Refresh Time'], detail);
        return true;
      }
    }
    return false;
  });
  return out;
}

/**
 * WFM.23 D9: compact data-freshness summary for Admin Operations tab.
 * Self-computing from Normalization_Log + SF pipeline refresh log.
 * Wire-safe: no Date objects in the response.
 * @return {{wowIngest:Object, pipeline:Object, deployments:Object}}
 */
function api_getDataFreshness() {
  _requireAuthorized_();
  return {
    wowIngest: _dataFreshnessWowIngest_(),
    pipeline: _dataFreshnessSfFeed_('Pipeline'),
    deployments: _dataFreshnessSfFeed_('Deployments')
  };
}

/**
 * WFM.25: Config_Settings tunable staleness thresholds (days) for data-freshness UI.
 * Keys: data_freshness_wow_days (default 7), data_freshness_pipeline_days (2),
 * data_freshness_deployments_days (2).
 * @return {{wowIngestDays:number, pipelineDays:number, deploymentsDays:number}}
 */
function api_getDataFreshnessThresholds() {
  _requireAuthorized_();
  var settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
  function days_(key, fallback) {
    var v = Number(String(settings[key] || '').trim());
    return (v > 0) ? v : fallback;
  }
  return {
    wowIngestDays: days_('data_freshness_wow_days', 7),
    pipelineDays: days_('data_freshness_pipeline_days', 2),
    deploymentsDays: days_('data_freshness_deployments_days', 2)
  };
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
    { key: 'fiscal_year_start_month', label: 'Fiscal year start month',        description: '1-indexed calendar month the fiscal year starts in (2 = February, Workday\u2019s fiscal anchor).', defaultValue: '2' },
    { key: 'alloc_over_ratio',        label: 'Over-allocation ratio threshold', description: 'Ratio-to-target at or above which a worker counts as over-allocated in the Utilization allocation banner.', defaultValue: '1.10' },
    { key: 'alloc_under_ratio',       label: 'Under-allocation ratio threshold', description: 'Ratio-to-target below which a worker counts as under-allocated in the Utilization allocation banner.', defaultValue: '0.85' }
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

/** Soft-void a committed assignment (audit action 'void'). */
function api_voidAssignment(assignment_id, notes) {
  _requireAuthorized_();
  return voidAssignment_(assignment_id, notes || '');
}

/** Soft-void a committed adjustment (audit action 'void'). */
function api_voidCapacityAdjustment(adjustment_id, notes) {
  _requireAuthorized_();
  return voidCapacityAdjustment_(adjustment_id, notes || '');
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

// ------------------------------------------------------------
// WFM.25 — On Leave roster + return-date API (display-only math)
// ------------------------------------------------------------

/**
 * @param {*} v
 * @return {string} YYYY-MM-DD or ''
 */
function _toDateWire_(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * @param {Object} r
 * @return {Object}
 */
function _sanitizeOnLeaveForWire_(r) {
  return {
    worker_key:   String(r.worker_key   || ''),
    worker_name:  String(r.worker_name  || ''),
    team_label:   String(r.team_label   || ''),
    manager_org:  String(r.manager_org  || ''),
    source:       String(r.source       || ''),
    return_date:  _toDateWire_(r.return_date),
    modified_by:  String(r.modified_by  || ''),
    modified_at:  _toIso_(r.modified_at)
  };
}

/**
 * Admin on-leave list with return dates from Config_Worker_Exclusions.
 * @return {Object[]}
 */
function api_getOnLeaveList() {
  _requireAuthorized_();
  return listOnLeave_().map(_sanitizeOnLeaveForWire_);
}

/**
 * Save return date for an on-leave worker (authorized).
 * @param {string} worker_key
 * @param {*} return_date valid date or blank to clear
 * @param {*} [modified_at] optimistic-lock stamp from prior read
 * @return {Object}
 */
function api_saveOnLeaveReturnDate(worker_key, return_date, modified_at) {
  _requireAuthorized_();
  const saved = saveOnLeaveReturnDate_(worker_key, return_date, modified_at);
  return _sanitizeOnLeaveForWire_(saved);
}

/**
 * Per-team on-leave roster sidecar for Utilization display (no hours math).
 * @return {Object<string, {name:string, return_date:string}[]>}
 */
function api_getOnLeaveRoster() {
  _requireAuthorized_();
  var roster = getOnLeaveByTeam_();
  Object.keys(roster).forEach(function (tl) {
    roster[tl] = roster[tl].map(function (entry) {
      return {
        name: String(entry.name || ''),
        return_date: _toDateWire_(entry.return_date)
      };
    });
  });
  return roster;
}

/**
 * WFM.25: read-only passthrough of the Unstaffed_Demand tab (verbatim WoW rows).
 * Display-layer only — no normalization, no capacity math.
 * @return {Object[]}
 */
function api_getUnstaffedDemand() {
  _requireAuthorized_();
  try {
    return readTable_(UNSTAFFED_DEMAND_SHEET) || [];
  } catch (e) {
    Logger.log('api_getUnstaffedDemand: ' + e);
    return [];
  }
}

// ------------------------------------------------------------
// WFM.25 — Commitments ledger (union assignments + adjustments)
// ------------------------------------------------------------

/**
 * Sanitize a ledger entry for google.script.run transport.
 * @param {Object} e
 * @return {Object}
 */
function _sanitizeCommitmentLedgerForWire_(e) {
  if (!e) return null;
  return {
    ledger_key: String(e.ledger_key || ''),
    object_type: String(e.object_type || ''),
    object_id: String(e.object_id || ''),
    worker: String(e.worker || ''),
    team: String(e.team || ''),
    project_label: String(e.project_label || ''),
    booking_type: String(e.booking_type || ''),
    committed_hours: Number(e.committed_hours) || 0,
    locked_hours: Number(e.locked_hours) || 0,
    reducible_hours: Number(e.reducible_hours) || 0,
    start_date: String(e.start_date || ''),
    end_date: String(e.end_date || ''),
    quarters: (e.quarters || []).map(String),
    status: String(e.status || ''),
    scenario_id: String(e.scenario_id || ''),
    scenario_name: String(e.scenario_name || ''),
    committed_by: String(e.committed_by || ''),
    committed_at: String(e.committed_at || ''),
    opportunity_id: String(e.opportunity_id || ''),
    weekly_detail: (e.weekly_detail || []).map(function (w) {
      return {
        week_key: String(w.week_key || ''),
        week_start: String(w.week_start || ''),
        hours: Number(w.hours) || 0,
        locked: !!w.locked
      };
    }),
    resource_type: String(e.resource_type || ''),
    distribution: String(e.distribution || 'Even'),
    estimated_hours: Number(e.estimated_hours) || 0,
    hours_reduction: Number(e.hours_reduction) || 0,
    direction: String(e.direction || ''),
    reason: String(e.reason || '')
  };
}

/**
 * Full commitments ledger (Committed + Archived-void rows).
 * @return {Object[]}
 */
function api_getCommitmentsLedger() {
  _requireAuthorized_();
  return listCommitmentsLedger_().map(_sanitizeCommitmentLedgerForWire_);
}

/**
 * Scenario rollups for the By Scenario pivot.
 * @return {Object[]}
 */
function api_getCommitmentsScenarioRollups() {
  _requireAuthorized_();
  return listCommitmentsScenarioRollups_();
}

/**
 * Modify forecast-remaining hours on a committed booking.
 * @param {string} object_type 'assignment' | 'adjustment'
 * @param {string} object_id
 * @param {number} newTotalHours total committed hours (unsigned)
 * @return {Object}
 */
function api_modifyCommitment(object_type, object_id, newTotalHours) {
  _requireAuthorized_();
  if (object_type === 'assignment') {
    var saved = modifyCommittedAssignmentHours_(object_id, newTotalHours);
    return _sanitizeAssignmentForWire_(saved);
  }
  if (object_type === 'adjustment') {
    var adj = modifyCommittedAdjustmentHours_(object_id, newTotalHours);
    return _sanitizeAdjustmentForWire_(adj);
  }
  throw new Error('object_type must be assignment or adjustment');
}
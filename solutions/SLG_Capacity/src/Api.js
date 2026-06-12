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
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('SLG Delivery Capacity Planner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
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

function _classifyTeam_(row, rtMap) {
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
    var hit = lowerIdx[k.toLowerCase()];
    return hit || null;
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
 * Three outcomes, in priority order:
 *   1) Email matches a row in Config_SLG_Managers.email
 *      → { email, matchedManager: '<name>', recognized: true }
 *   2) Email is listed in Config_Settings.recognized_non_manager_emails
 *      (comma-separated, case-insensitive)
 *      → { email, matchedManager: null, recognized: true }
 *   3) Neither match
 *      → { email, matchedManager: null, recognized: false }
 */
function _resolveLoggedInUser_() {
  var email = '';
  try { email = (getUserEmail_ ? getUserEmail_() : '') || ''; } catch (e) { email = ''; }
  var emailLc = String(email || '').trim().toLowerCase();

  var result = { email: email, matchedManager: null, recognized: false };

  if (!emailLc) return result;

  try {
    var mgrRows = (typeof readConfigSlgManagers_ === 'function')
      ? readConfigSlgManagers_() : [];
    for (var i = 0; i < mgrRows.length; i++) {
      var rowEmail = String(mgrRows[i].email || '').trim().toLowerCase();
      if (rowEmail && rowEmail === emailLc) {
        result.matchedManager = mgrRows[i].manager_name;
        result.recognized = true;
        return result;
      }
    }
  } catch (e) {
    Logger.log('_resolveLoggedInUser_: manager lookup failed — ' + e);
  }

  try {
    var settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
    var raw = String(settings['recognized_non_manager_emails'] || '');
    if (raw) {
      var allowSet = {};
      raw.split(',').forEach(function (e) {
        var v = String(e || '').trim().toLowerCase();
        if (v) allowSet[v] = true;
      });
      if (allowSet[emailLc]) {
        result.recognized = true;
        return result;
      }
    }
  } catch (e) {
    Logger.log('_resolveLoggedInUser_: settings lookup failed — ' + e);
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
function _buildResourceTeamResolver_() {
  var rtMap = readConfigResourceType_();
  var roleTeamLabels = (typeof readRoleTeamLabels_ === 'function')
    ? readRoleTeamLabels_() : {};

  return function (resource) {
    if (!resource) return 'Unclassified';
    var wc = String(resource.worker_class || '');

    // SLG workers: resolve via Config_Roles.team_label keyed on ICP role.
    if (wc === 'SLG_Real' || wc === 'SLG_Generic') {
      var icp = String(resource.icp || '');
      return roleTeamLabels[icp] || 'Unclassified';
    }

    // External workers: resolve via _classifyTeam_'s lookup chain.
    return _classifyTeam_({
      role_category: resource.role_category || '',
      job_profile: resource.job_profile || '',
      project_role: '',  // not on the resource index; safe to omit
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
  return { ok: true, flushedAt: new Date().toISOString() };
}

// ------------------------------------------------------------
// Dashboard / Engine
// ------------------------------------------------------------

function api_getDashboard(params) {
  params = params || {};
  return computeUtilization({
    viewMode: params.viewMode,
    groupBy: params.groupBy,
    scenarioId: params.scenarioId,
    teams: params.teams,
    teamLabel: params.teamLabel,                    // Priority 2 pass-through
    workerScope: params.workerScope,
    includeMyManagers: params.includeMyManagers,
    quarter: params.quarter,
    includeTimeOff: !!params.includeTimeOff
  });
}

function api_getResourceDetail(params) {
  return computeResourceDetail(params);
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

  let quarterKeys = null;
  if (params.quarter) {
    quarterKeys = {};
    Object.keys(windowKeys).forEach(mk => {
      const parts = mk.split('-');
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const q = 'Q' + (Math.floor((m - 1) / 3) + 1);
      if (y + '-' + q === params.quarter) quarterKeys[mk] = true;
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

  function effectiveInScope_(wc) {
    if (hideAllExternal && String(wc || '').indexOf('External_') === 0) return false;
    return inScopeWorkerClass_(wc);
  }

  // ----- Data sources -----
  const rows = readTable_(ALLOC_NORM);
  const rtMap = readConfigResourceType_();

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
    if (teamLabelFilter) {
      const rowTeam = _classifyTeam_(row, rtMap);
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
  rows.forEach(r => {
    const h = Number(r.hours) || 0;
    if (!h) return;
    const mk = monthKeyOf_(r.period_start);
    if (!inWindow_(mk)) return;
    if (excluded.has(r.resource_name)) return;

    const mgrCheck = _rowPassesManagerFilter_(r);
    if (!mgrCheck.pass) return;

    const wc = String(r.worker_class || '');
    if (!wc) {
      blankClassWorkers[r.resource_name] = (blankClassWorkers[r.resource_name] || 0) + h;
    }

    if (!effectiveInScope_(wc)) {
      scopeFilteredOutHours += h;
      return;
    }

    if (wcBucket[wc] !== undefined) { wcBucket[wc] += h; }
    if (mgrCheck.viaPractice && wc.indexOf('External_') === 0) {
      externalHoursByPracticeOwnership += h;
    }

    const teamKey = _classifyTeam_(r, rtMap);
    if (teamKey === 'Unclassified') {
      const sig = (r.role_category || '(blank)') + ' | ' + (r.resource_type || '(blank)');
      unmappedSamples[sig] = (unmappedSamples[sig] || 0) + h;
    }
    const acct = String(r.account_name || '') || '(No account)';
    const proj = String(r.project_name || '') || '(No project)';
    const roleCat = String(r.role_category || 'Unclassified');
    const jobProf = String(r.job_profile || 'Unspecified');
    const roleCapKey = roleForCapacity_(r);

    byTeamHours[teamKey] = (byTeamHours[teamKey] || 0) + h;
    byAcctHours[acct] = (byAcctHours[acct] || 0) + h;
    byRoleCategoryHrs[roleCat] = (byRoleCategoryHrs[roleCat] || 0) + h;
    byJobProfileHrs[jobProf] = (byJobProfileHrs[jobProf] || 0) + h;

    addBreakdown_(teamRC, teamKey, roleCat, h);
    addBreakdown_(teamAccts, teamKey, acct, h);
    addBreakdown_(teamProjs, teamKey, acct + '||' + proj, h);
    addBreakdown_(teamWC, teamKey, wc, h);

    addBreakdown_(acctRoles, acct, roleCat, h);
    addBreakdown_(acctProjs, acct, proj, h);
    addBreakdown_(acctWC, acct, wc, h);

    distinctWorkers[r.resource_name] = true;
    if (!distinctCapacity[r.resource_name]) {
      const cap = roleCap[roleCapKey] || roleCap[r.resource_type] || 160;
      distinctCapacity[r.resource_name] = { capacity: cap };
    }
  });

  // ----- Assignments overlay -----
  if (viewMode !== 'Actual') {
    let assigns = [];
    try { assigns = readTable_(ASSIGNMENTS) || []; } catch (e) { assigns = []; }
    const workerClassByName = {};
    const workerEnrichmentByName = {};
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
      if (excluded.has(a.resource_name)) return;

      const wc = workerClassByName[a.resource_name] || '';
      const enrichment = workerEnrichmentByName[a.resource_name] || {};

      const fakeRow = {
        worker_class: wc,
        manager_org: enrichment.manager_org || '',
        role_category: enrichment.role_category || '',
        job_profile: enrichment.job_profile || '',
        project_role: enrichment.project_role || '',
        resource_type: enrichment.resource_type || '',
        account_name: a.account_name || enrichment.account_name || '',
        ICP_role: enrichment.ICP_role || ''
      };

      const mgrCheck = _rowPassesManagerFilter_(fakeRow);
      if (!mgrCheck.pass) return;

      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!scenarioId || a.scenario_id === scenarioId));
      if (!include) return;

      let monthly = [];
      try {
        if (typeof expandAssignmentToMonthly_ === 'function') {
          monthly = expandAssignmentToMonthly_(a, calendar) || [];
        }
      } catch (e) { monthly = []; }

      monthly.forEach(m => {
        const hrs = Number(m.hours) || 0;
        if (!hrs) return;
        const mk = monthKeyOf_(m.period_start);
        if (!inWindow_(mk)) return;

        if (!effectiveInScope_(wc)) {
          scopeFilteredOutHours += hrs;
          return;
        }
        if (wcBucket[wc] !== undefined) { wcBucket[wc] += hrs; }
        if (mgrCheck.viaPractice && wc.indexOf('External_') === 0) {
          externalHoursByPracticeOwnership += hrs;
        }

        const teamKey = _classifyTeam_(fakeRow, rtMap);
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
    if (excluded.has(r.name)) return;
    if (r.teamType) teamTypes[r.teamType] = true;
    if (r.subteam) subteams[r.subteam] = true;
  });

    // Priority 3: build the team resolver once, then attach resolvedTeam
  // to each resource so the Capacity Explorer can filter client-side
  // without server round-trips.
  const resolveResourceTeam = _buildResourceTeamResolver_();

  const resources = Object.values(resIndex)
    .filter(r => !excluded.has(r.name))
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

  const quarters = {};
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    quarters[d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1)] = true;
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
    return rows.map(r => ({
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
  }));
}

function api_listDeployments() {
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
    const depId = v(row, 'Deployment ID');
    if (!account && !depName) return;

    out.push({
      account_name: String(account || ''),
      deployment_name: String(depName || ''),
      services_approach: String(v(row, 'Services Approach') || ''),
      industry: String(v(row, 'Industry') || ''),
      sub_region: String(v(row, 'Sub-Region') || ''),
      priming_partner_account: String(v(row, 'Priming Partner: Account Name') || ''),
      deployment_stage: String(v(row, 'Deployment Stage') || ''),
      deployment_health: String(v(row, 'Deployment Health') || ''),
      current_mtp_date: _toIso_(v(row, 'Current MTP Date')),
      ps_locations: String(v(row, 'Professional Services Locations') || ''),
      ps_locations_details: String(v(row, 'Professional Services Locations Details') || ''),
      dam_name: String(v(row, 'Delivery Assurance Manager: Full Name') || ''),
      em_name: String(v(row, 'Workday Engagement Manager: Full Name') || ''),
      current_update: String(v(row, 'Current Deployment Update') || ''),
      deployment_id: String(depId || '')
    });
  });
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
  const rows = listAssignments_(params) || [];
  return rows.map(_sanitizeAssignmentForWire_);
}

function api_saveAssignment(a) {
  const saved = saveAssignment_(a);
  return _sanitizeAssignmentForWire_(saved);
}

function api_previewAssignment(a) {
  const calendar = readCalendar_();
  return expandAssignmentToMonthly_(a, calendar).map(m => ({
    monthKey: monthKey_(m.period_start),
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
  const rows = listScenarios_() || [];
  return rows.map(_sanitizeScenarioForWire_);
}

function api_saveScenario(s) {
  const saved = saveScenario_(s);
  return _sanitizeScenarioForWire_(saved);
}
function api_commitScenario(id) { return commitScenario_(id); }
function api_archiveScenario(id) { return archiveScenario_(id); }

function api_saveIcp(rows) {
  writeTable_(CFG_ICP, ICP_HEADERS, rows);
  if (typeof invalidateCache_ === 'function') invalidateCache_(CFG_ICP);
  return { ok: true };
}

function api_saveRoles(rows) {
  writeTable_(CFG_ROLES, ROLE_HEADERS, rows);
  if (typeof invalidateCache_ === 'function') invalidateCache_(CFG_ROLES);
  return { ok: true };
}

function api_listGenericResources() {
  try { return readGenericResources_(); } catch (e) { return []; }
}

function api_saveGenericResources(payload) {
  const rows = (payload && payload.resources) || [];
  const headers = [
    'name', 'resource_type', 'project_role', 'manager_org', 'team', 'practice',
    'start_date', 'end_date', 'capacity_hours', 'status', 'notes'
  ];
  writeTable_(CFG_GENERIC, headers, rows);
  if (typeof invalidateCache_ === 'function') invalidateCache_(CFG_GENERIC);
  return { ok: true, count: rows.length };
}

function api_getExclusions() {
  try { return readTable_('Config_Worker_Exclusions') || []; } catch (e) { return []; }
}

function api_saveExclusions(payload) {
  const rows = (payload && payload.workers) || [];
  const headers = ['worker_name', 'manager_org', 'reason', 'active'];
  writeTable_('Config_Worker_Exclusions', headers, rows);
  if (typeof invalidateCache_ === 'function') {
    invalidateCache_('Config_Worker_Exclusions');
  }
  return { ok: true, count: rows.length };
}

function api_listAllWorkers() {
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
  return uploadStaffFile(base64, filename);
}

function api_refreshOpportunities() {
  return normalizeOpportunities();
}

function api_getRefreshLog() {
  try {
    const rows = readTable_(REFRESH_LOG) || [];
    return rows
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 25);
  } catch (e) { return []; }
}

function api_getPipelineRefreshLog() {
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName('Auto Refresh Execution Log');
    if (!sh) return [];
    const values = sh.getDataRange().getValues();
    if (!values || values.length < 2) return [];
    const header = values[0].map(h => String(h || '').trim());
    const out = [];
    for (let i = 1; i < values.length; i++) {
      const row = {};
      header.forEach((h, j) => { row[h] = values[i][j]; });
      out.push(row);
    }
    return out
      .sort((a, b) => new Date(b['Refresh Time']) - new Date(a['Refresh Time']))
      .slice(0, 10);
  } catch (e) { return []; }
}

function api_checkPsaAssignment(name) {
  const alloc = readTable_(ALLOC_NORM);
  const found = alloc.some(r => r.resource_name === name);
  return { found: found };
}
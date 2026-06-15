// ============================================================
// Engine.gs — capacity / demand / utilization math
// - Uses cachedRead_ for normalized/config tables.
// - Applies worker exclusions from Config_Worker_Exclusions.
// - Filters by manager (teams) only; quarter is handled on the client.
// - When params.teamLabel is set:
//     * Manager filter is suppressed (Team overrides Manager).
//     * Buckets are filtered to workers whose resolved team matches.
// - Returns:
//     * kpis (basic, mostly preserved for backward-compat)
//     * heatmap (team/role/etc aggregates)
//     * trend (aggregate utilization per month)
//     * byResource (per-worker per-month metrics, incl. scenario hours)
//     * headcountByTeam (SLG-only headcount gap KPI, per team)
// All responses are sanitized for google.script.run transport.
// ============================================================

function readIcp_() {
  const rows = cachedRead_(CFG_ICP);
  const m = {};
  rows.forEach(r => {
    m[r.role] = {
      target: Number(r.target_utilization),
      red: Number(r.red_threshold)
    };
  });
  return m;
}

function readRoleCapacity_() {
  const rows = cachedRead_(CFG_ROLES);
  const m = {};
  rows.forEach(r => {
    m[r.role] = Number(r.monthly_capacity_hours) || 160;
  });
  return m;
}

function readRoleTeamLabels_() {
  const rows = cachedRead_(CFG_ROLES);
  const m = {};
  rows.forEach(r => {
    const role = String(r.role || '').trim();
    if (!role) return;
    const team = String(r.team_label || '').trim();
    if (!team) return;
    m[role] = team;
  });
  return m;
}

function readCalendar_() {
  const rows = cachedRead_(CFG_CAL);
  const m = {};
  rows.forEach(r => {
    const k = monthKey_(r.period_start);
    m[k] = { workdays: Number(r.workdays) || 20, quarter: r.quarter };
  });
  return m;
}

function readSettings_() {
  let rows;
  try { rows = cachedRead_(CFG_SETTINGS); } catch (e) { return {}; }
  const m = {};
  rows.forEach(r => {
    const key = String(r.key || '').trim();
    if (!key) return;
    m[key] = String(r.value || '').trim();
  });
  return m;
}

function readPlanningWindowMonths_() {
  const settings = readSettings_();
  const raw = settings.planning_window_months;
  let n = Number(raw);
  if (!isFinite(n) || n < 1) n = 6;
  if (n > 24) n = 24;
  return Math.floor(n);
}

function buildPlanningWindow_(windowMonths) {
  const set = {};
  const list = [];
  const now = new Date();
  for (let i = 0; i < windowMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    set[key] = true;
    list.push(key);
  }
  return { monthKeys: set, monthsList: list };
}

function readExclusions_() {
  const rows = cachedRead_
    ? cachedRead_('Config_Worker_Exclusions')
    : readTable_('Config_Worker_Exclusions');

  function _normCell_(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }
  const TRUTHY = {
    'yes': 1, 'y': 1, 'true': 1, 't': 1,
    '1': 1, 'x': 1, 'active': 1, 'on': 1
  };

  const set = new Set();
  rows.forEach(r => {
    const name = _normCell_(r.worker_name);
    if (!name) return;
    const raw = r.active === '' || r.active === null || r.active === undefined
      ? 'Yes'
      : r.active;
    const active = _normCell_(raw).toLowerCase();
    if (TRUTHY[active]) {
      set.add(name);
    }
  });
  return set;
}

function readGenericResources_() {
  let rows;
  try { rows = cachedRead_(CFG_GENERIC); } catch (e) { return []; }
  return rows.map(r => ({
    name: String(r.name || ''),
    resource_type: String(r.resource_type || ''),
    project_role: String(r.project_role || ''),
    manager_org: String(r.manager_org || ''),
    team: String(r.team || ''),
    practice: String(r.practice || ''),
    start_date: r.start_date || '',
    end_date: r.end_date || '',
    capacity_hours: Number(r.capacity_hours) || 160,
    status: String(r.status || 'Active'),
    notes: String(r.notes || '')
  })).filter(g => g.name && g.status !== 'Inactive');
}

function readConfigSlgManagers_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CFG_SLG_MGRS);
  if (!sh) {
    Logger.log('readConfigSlgManagers_: sheet "' + CFG_SLG_MGRS + '" not found.');
    return [];
  }
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  var header = values[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
  var iName = header.indexOf('manager_name');
  var iParent = header.indexOf('parent_manager');
  var iIncDesc = header.indexOf('include_descendants');
  var iSource = header.indexOf('hierarchy_source');
  var iEmail = header.indexOf('email');

  if (iName < 0) {
    Logger.log(
      'readConfigSlgManagers_: required header "manager_name" not found. ' +
      'Have: ' + JSON.stringify(values[0])
    );
    return [];
  }

  function _normCell_(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = _normCell_(row[iName]);
    if (!name) continue;
    var email = iEmail >= 0 ? _normCell_(row[iEmail]).toLowerCase() : '';
    out.push({
      manager_name: name,
      parent_manager: iParent >= 0 ? _normCell_(row[iParent]) : '',
      include_descendants: iIncDesc >= 0 ? _normCell_(row[iIncDesc]) : '',
      hierarchy_source: iSource >= 0 ? _normCell_(row[iSource]) : '',
      email: email
    });
  }
  return out;
}

function buildManagerDescendants_(mgrRows) {
  var childrenByParent = {};
  mgrRows.forEach(function(row) {
    var parent = row.parent_manager;
    var child = row.manager_name;
    if (!parent || !child) return;
    if (!childrenByParent[parent]) childrenByParent[parent] = [];
    childrenByParent[parent].push(child);
  });

  function getAllDescendants(root) {
    var seen = {};
    var stack = childrenByParent[root] ? childrenByParent[root].slice() : [];
    while (stack.length) {
      var child = stack.pop();
      if (seen[child]) continue;
      seen[child] = true;
      if (childrenByParent[child]) {
        stack.push.apply(stack, childrenByParent[child]);
      }
    }
    return Object.keys(seen);
  }

  var descendants = {};
  mgrRows.forEach(function(row) {
    var name = row.manager_name;
    descendants[name] = getAllDescendants(name);
  });
  return descendants;
}

function buildEffectiveManagers_(selectedName, includeMyManagers, managersByName, managerDescendants) {
  var name = (selectedName || '').trim();
  if (!name) return null;
  var set = {};
  set[name] = true;
  var row = managersByName[name];
  if (includeMyManagers && row) {
    var flag = String(row.include_descendants || '').toUpperCase();
    if (flag === 'Y') {
      var desc = managerDescendants[name] || [];
      desc.forEach(function(m) { set[m] = true; });
    }
  }
  return set;
}

function expandAssignmentToMonthly_(a, calendar) {
  if (!a.start_date || !a.end_date) return [];
  const start = new Date(a.start_date);
  const end = new Date(a.end_date);
  const months = monthsBetween_(start, end);
  if (!months.length) return [];

  const total = Number(a.estimated_hours) || 0;

  if (a.distribution === 'Custom' && a.custom_monthly_json) {
    let custom = {};
    try { custom = JSON.parse(a.custom_monthly_json); } catch (e) { custom = {}; }
    return months.map(m => ({
      period_start: m,
      hours: Number(custom[monthKey_(m)] || 0)
    }));
  }

  const wdTotal = months.reduce(
    (s, m) => s + ((calendar[monthKey_(m)] || {}).workdays || 20),
    0
  );
  const n = months.length;
  let weights = months.map(
    m => (((calendar[monthKey_(m)] || {}).workdays || 20) / wdTotal)
  );

  if (a.distribution === 'Front-loaded' || a.distribution === 'Back-loaded') {
    const ramp = months.map((_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      return a.distribution === 'Front-loaded' ? (1.5 - t) : (0.5 + t);
    });
    const rsum = ramp.reduce((s, x) => s + x, 0);
    weights = weights.map((w, i) => ramp[i] / rsum);
  }

  return months.map((m, i) => ({
    period_start: m,
    hours: total * weights[i]
  }));
}

function _normalizedTeam_(resourceType) {
  const rt = String(resourceType || '').toUpperCase().trim();
  if (rt === 'FUNCTIONAL') return 'Functional Consulting';
  if (rt === 'INTEGRATIONS') return 'Technical Consulting';
  if (rt === 'REPORTING & ANALYTICS PS') return 'Technical Consulting';
  if (rt === 'DATA CONVERSION') return 'Technical Consulting';
  if (rt === 'ENGAGEMENT MANAGER') return 'Delivery';
  return resourceType || 'Unclassified';
}

function _resourceIndex_(alloc) {
  const map = {};
  const teamCfg = readTeamsConfig_();
  alloc.forEach(a => {
    if (!a.resource_name) return;
    const k = a.resource_name;
    map[k] = map[k] || {
      name: k, icp: '', resource_type: '', worker_class: '',
      teamCounts: {}, mgrCounts: {}, practiceCounts: {},
      teamTypeCounts: {}, subteamCounts: {},
      jobProfileCounts: {}, roleCategoryCounts: {}
    };
    if (a.ICP_role) map[k].icp = map[k].icp || a.ICP_role;
    if (a.resource_type) map[k].resource_type = map[k].resource_type || a.resource_type;
    if (a.worker_class) map[k].worker_class = map[k].worker_class || a.worker_class;
    if (a.team) map[k].teamCounts[a.team] = (map[k].teamCounts[a.team] || 0) + 1;
    if (a.manager_org) map[k].mgrCounts[a.manager_org] = (map[k].mgrCounts[a.manager_org] || 0) + 1;
    if (a.practice) map[k].practiceCounts[a.practice] = (map[k].practiceCounts[a.practice] || 0) + 1;
    if (a.job_profile) map[k].jobProfileCounts[a.job_profile] = (map[k].jobProfileCounts[a.job_profile] || 0) + 1;
    if (a.role_category) map[k].roleCategoryCounts[a.role_category] = (map[k].roleCategoryCounts[a.role_category] || 0) + 1;

    const klass = classifyTeamForAllocation_(a, teamCfg);
    if (klass.teamType) {
      map[k].teamTypeCounts[klass.teamType] = (map[k].teamTypeCounts[klass.teamType] || 0) + 1;
    }
    if (klass.subteam) {
      map[k].subteamCounts[klass.subteam] = (map[k].subteamCounts[klass.subteam] || 0) + 1;
    }
  });

  const generics = readGenericResources_();
  generics.forEach(g => {
    const k = g.name;
    if (!k) return;
    if (!map[k]) {
      map[k] = {
        name: k, icp: '', resource_type: '', worker_class: '',
        teamCounts: {}, mgrCounts: {}, practiceCounts: {},
        teamTypeCounts: {}, subteamCounts: {},
        jobProfileCounts: {}, roleCategoryCounts: {}
      };
    }
    map[k].worker_class = map[k].worker_class || 'SLG_Generic';
    if (g.resource_type) map[k].resource_type = map[k].resource_type || g.resource_type;
    if (g.team) map[k].teamCounts[g.team] = (map[k].teamCounts[g.team] || 0) + 1;
    if (g.manager_org) map[k].mgrCounts[g.manager_org] = (map[k].mgrCounts[g.manager_org] || 0) + 1;
    if (g.practice) map[k].practiceCounts[g.practice] = (map[k].practiceCounts[g.practice] || 0) + 1;
  });

  const pickTop = counts =>
    Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';

  Object.values(map).forEach(r => {
    r.team = pickTop(r.teamCounts);
    r.manager_org = pickTop(r.mgrCounts);
    r.practice = pickTop(r.practiceCounts);
    r.teamType = pickTop(r.teamTypeCounts);
    r.subteam = pickTop(r.subteamCounts);
    r.job_profile = pickTop(r.jobProfileCounts);
    r.role_category = pickTop(r.roleCategoryCounts);
  });

  return map;
}

function _groupKey_(bucket, groupBy) {
  switch (groupBy) {
    case 'Role':
      return bucket.job_profile || 'Unclassified';
    case 'Team':
      return (
        _normalizedTeam_(bucket.resource_type) ||
        bucket.subteam ||
        bucket.teamType ||
        bucket.manager_org ||
        bucket.team ||
        bucket.practice ||
        'Unclassified'
      );
    case 'Function':
      return bucket.role_category || 'Unclassified';
    default:
      return bucket.resource || 'Unclassified';
  }
}

function _workerClassInScope_(workerClass, workerScope) {
  const cls = String(workerClass || '');
  if (!cls) return false;
  const scope = String(workerScope || 'SLG');
  switch (scope) {
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

/**
 * Build a case-insensitive lookup map for Config_Resource_Type.team_label,
 * read directly from the sheet (no cachedRead_) so newly-added columns
 * can't be silently dropped (cf. resolved bug #1).
 *
 * Returns: { '<lowercased key>': '<team_label>' }
 *
 * Keys covered: resource_type / project_role_category / key (whichever
 * column the sheet uses to identify the resource role). Same lookup
 * shape as readConfigResourceType_ in Api.gs.
 *
 * Used by _resolveTeamForBucket_ below to resolve External rows to
 * their leadership-facing team for the Team filter (Priority 2).
 */
function _readResourceTypeTeamMap_() {
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

    if (iKey < 0 || iTeam < 0) return {};

    var map = {};
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var key = String(row[iKey] || '').trim();
      var team = String(row[iTeam] || '').trim();
      if (!key || !team) continue;
      map[key.toLowerCase()] = team;
    }
    return map;
  }

  var primary = readSheetAsMap_('Config_Resource_Type');
  if (primary && Object.keys(primary).length) return primary;
  var legacy = readSheetAsMap_('Config_ResourceType_Map');
  if (legacy && Object.keys(legacy).length) return legacy;
  return {};
}

/**
 * Resolve a bucket's leadership-facing team for the Team filter.
 *
 * SLG workers (SLG_Real / SLG_Generic):
 *   icp_role -> Config_Roles.team_label. Falls through to 'Unclassified'
 *   if the role isn't mapped.
 *
 * External workers (External_NonSLG / External_Contractor):
 *   role_category -> job_profile -> project_role -> resource_type, looked
 *   up case-insensitively against Config_Resource_Type.team_label.
 *   Falls through to 'Unclassified' if no key matches.
 *
 * Mirrors the lookup chain used by Api.gs _classifyTeam_ for External rows
 * and by computeUtilization's Headcount Gap aggregator for SLG rows.
 * Duplicated rather than shared to keep the blast radius small.
 */
function _resolveTeamForBucket_(bucket, roleTeamLabels, rtTeamMap) {
  var wc = String((bucket && bucket.worker_class) || '');
  if (wc === 'SLG_Real' || wc === 'SLG_Generic') {
    var icp = bucket.icp || '';
    return roleTeamLabels[icp] || 'Unclassified';
  }

  function tryKey(v) {
    if (!v) return '';
    var k = String(v).trim().toLowerCase();
    if (!k) return '';
    return rtTeamMap[k] || '';
  }
  return (
    tryKey(bucket.role_category) ||
    tryKey(bucket.job_profile) ||
    tryKey(bucket.project_role) ||
    tryKey(bucket.resource_type) ||
    'Unclassified'
  );
}

function computeUtilization(params) {
  params = params || {};
  const viewMode = params.viewMode || 'Committed';
  const groupBy = params.groupBy || 'Function';
  const workerScope = params.workerScope || 'SLG';
  const includePto = !!params.includeTimeOff;

  // Priority 2: Team filter. When set, overrides Manager filter
  // and scopes buckets to workers whose resolved team matches.
  const teamLabelFilter = params.teamLabel
    ? String(params.teamLabel).trim()
    : '';

  // Planning window (configurable via Config_Settings.planning_window_months)
  const windowMonths = readPlanningWindowMonths_();
  const planningWindow = buildPlanningWindow_(windowMonths);
  const planningMonthKeys = planningWindow.monthKeys;
  const planningMonthsList = planningWindow.monthsList;

  // ICP role -> Team label, from Config_Roles.team_label
  const roleTeamLabels = readRoleTeamLabels_();

  // External resource_type/role_category -> Team label, for Team-filter
  // bucket resolution. Lowercased keys.
  const rtTeamMap = _readResourceTypeTeamMap_();

  const settings = readSettings_();
  const hideAllExternal = String(settings['hide_all_external'] || '')
    .trim().toLowerCase() === 'true';

  const mgrRows = readConfigSlgManagers_();
  const managerDescendants = buildManagerDescendants_(mgrRows);
  const managersByName = {};
  mgrRows.forEach(function(r) { managersByName[r.manager_name] = r; });

  // Priority 2: Team filter overrides Manager filter.
  // If teamLabelFilter is set, force effectiveManagers to null so the
  // manager-filter step in (4) below is a no-op for every bucket.
  const selectedManager = (params.teams && params.teams.length) ? params.teams[0] : null;
  const effectiveManagers = teamLabelFilter
    ? null
    : buildEffectiveManagers_(
        selectedManager,
        !!params.includeMyManagers,
        managersByName,
        managerDescendants
      );

  const allocRaw = cachedRead_(ALLOC_NORM);
  const assignsRaw = cachedRead_(ASSIGNMENTS);
  const excluded = readExclusions_();
  const resIndex = _resourceIndex_(allocRaw);

  function inScope(workerName) {
    const info = resIndex[workerName] || {};
    const cls = String(info.worker_class || '');
    if (hideAllExternal && cls.startsWith('External_')) return false;
    return _workerClassInScope_(cls, workerScope);
  }

  const alloc = allocRaw.filter(a => {
    if (!a.resource_name) return false;
    if (excluded.has(a.resource_name)) return false;
    return inScope(a.resource_name);
  });
  const assigns = assignsRaw.filter(a => {
    if (!a.resource_name) return false;
    if (excluded.has(a.resource_name)) return false;
    return inScope(a.resource_name);
  });

  const icp = readIcp_();
  const calendar = readCalendar_();
  const roleCap = readRoleCapacity_();

  const buckets = {};
  function bucket(resourceName, period) {
    const k = resourceName + '|' + monthKey_(period);
    if (!buckets[k]) {
      const info = resIndex[resourceName] || {};
      buckets[k] = {
        resource: resourceName,
        period: firstOfMonth_(period),
        team: info.team || '',
        manager_org: info.manager_org || '',
        icp: info.icp || '',
        resource_type: info.resource_type || '',
        worker_class: info.worker_class || '',
        job_profile: info.job_profile || '',
        role_category: info.role_category || '',
        project_role: info.project_role || '',
        committed: 0, billable: 0, scenario: 0,
        timeOff: 0, education: 0, unassigned: 0
      };
    }
    return buckets[k];
  }

  // 1) Actual allocations from PSA
  alloc.forEach(a => {
    if (!a.resource_name || !a.period_start) return;
    const b = bucket(a.resource_name, a.period_start);
    const h = Number(a.hours) || 0;
    if (!h) return;
    if (a.allocation_type === 'PTO_Holiday') {
      b.timeOff += h;
    } else if (a.allocation_type === 'Education') {
      b.education += h;
      b.committed += h;
    } else if (a.allocation_type === 'Billable') {
      b.billable += h;
      b.committed += h;
    } else {
      b.committed += h;
      if (a.allocation_type && a.allocation_type !== '') {
        b.unassigned += h;
      }
    }
  });

  // 2) Assignments
  if (viewMode !== 'Actual') {
    assigns.forEach(a => {
      if (!a.resource_name) return;
      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!params.scenarioId || a.scenario_id === params.scenarioId));
      if (!include) return;
      expandAssignmentToMonthly_(a, calendar).forEach(m => {
        const b = bucket(a.resource_name, m.period_start);
        if (isCommitted) {
          b.billable += m.hours;
          b.committed += m.hours;
        } else if (isScenario) {
          b.scenario += m.hours;
        }
      });
    });
  }

  // 3) Compute per-bucket utilization, capacity, etc.
  Object.values(buckets).forEach(b => {
    const cap = roleCap[b.icp] || roleCap[b.resource_type] || 160;
    const usedWork = (groupBy === 'Function')
      ? b.billable
      : (b.committed + b.timeOff);
    b.capacity = cap;
    b.available = Math.max(cap - usedWork, 0);
    b.utilization = cap > 0 ? (usedWork / cap) : 0;
  });

  // Local memoization cache for _resolveTeamForBucket_ (Drop 1).
  // Keyed by the tuple of fields that determine the resolved team.
  // Same inputs always produce the same output, so this is safe across
  // both call sites in this function (team filter and headcount gap).
  const _teamResolveCache_ = {};
  function _resolveTeamCached_(b) {
    const k = (b.worker_class || '') + '|' + (b.icp || '') + '|' +
              (b.role_category || '') + '|' + (b.job_profile || '') + '|' +
              (b.project_role || '') + '|' + (b.resource_type || '');
    if (!_teamResolveCache_.hasOwnProperty(k)) {
      _teamResolveCache_[k] = _resolveTeamForBucket_(b, roleTeamLabels, rtTeamMap);
    }
    return _teamResolveCache_[k];
  }

  // 4) Apply manager filter AND Priority 2 team filter.
  //    Team filter overrides manager (effectiveManagers is null when
  //    teamLabelFilter is set, see above).
  const filtered = Object.values(buckets).filter(b => {
    if (effectiveManagers) {
      const mgrNorm = normalizeManagerName_(b.manager_org || '');
      if (!effectiveManagers[mgrNorm]) return false;
    }
    if (teamLabelFilter) {
      const bucketTeam = _resolveTeamCached_(b);
      if (bucketTeam !== teamLabelFilter) return false;
    }
    return true;
  });

  // 5) Group-by rollup for heatmap
  const groupMonth = {};
  const allRows = {};
  const allMonths = {};

  filtered.forEach(b => {
    const rowKey = _groupKey_(b, groupBy);
    if (!rowKey) return;
    const mk = monthKey_(b.period);
    const k = rowKey + '|' + mk;
    if (!groupMonth[k]) {
      groupMonth[k] = {
        rowKey: rowKey, period: b.period, monthKey: mk,
        committed: 0, billable: 0, scenario: 0,
        timeOff: 0, capacity: 0, headcount: 0,
        icpRoles: {}, resources: {}
      };
    }
    const g = groupMonth[k];
    g.committed += b.committed;
    g.billable += b.billable;
    g.scenario += b.scenario;
    g.timeOff += b.timeOff;
    g.capacity += b.capacity;
    if (!g.resources[b.resource]) {
      g.resources[b.resource] = true;
      g.headcount += 1;
    }
    if (b.icp && icp[b.icp]) {
      g.icpRoles[b.icp] = (g.icpRoles[b.icp] || 0) + 1;
    }
    allRows[rowKey] = true;
    allMonths[mk] = b.period;
  });

  Object.values(groupMonth).forEach(g => {
    const usedForUtil = (groupBy === 'Function')
      ? g.billable
      : (g.committed + g.timeOff);
    g.utilization = g.capacity > 0 ? (usedForUtil / g.capacity) : 0;
    let num = 0, den = 0;
    Object.keys(g.icpRoles).forEach(r => {
      if (icp[r]) {
        num += icp[r].target * g.icpRoles[r];
        den += g.icpRoles[r];
      }
    });
    g.icpTarget = den > 0 ? num / den : 0.70;
    g.gapHours = usedForUtil - (g.icpTarget * g.capacity);
  });

  // 6) Individual mode cap to avoid huge payloads
  let rows = Object.keys(allRows).sort();
  if (groupBy === 'Individual' && rows.length > 100) {
    const peak = {};
    Object.values(groupMonth).forEach(g => {
      peak[g.rowKey] = Math.max(peak[g.rowKey] || 0, g.utilization);
    });
    rows = rows
      .sort((a, b) => (peak[b] || 0) - (peak[a] || 0))
      .slice(0, 100);
  }
  const rowSet = {};
  rows.forEach(r => (rowSet[r] = true));
  const cells = Object.values(groupMonth).filter(g => rowSet[g.rowKey]);

  // 7) KPI-friendly aggregates
  let totCommittedWork = 0, totPto = 0, totCap = 0, totScenario = 0, totBillable = 0;
  const seenRes = {};
  filtered.forEach(b => {
    totCommittedWork += b.committed;
    totPto += b.timeOff;
    totCap += b.capacity;
    totScenario += b.scenario;
    totBillable += b.billable;
    seenRes[b.resource] = true;
  });
  const usedForKpi = (groupBy === 'Function') ? totBillable : (totCommittedWork + totPto);
  const avgUtil = totCap > 0 ? (usedForKpi / totCap) : 0;
  const availableFte = (totCap - usedForKpi) / 160;
  const scenarioFte = totScenario / 160;
  const gapFte = scenarioFte - availableFte;

  // 8) Trend
  const by = {};
  cells.forEach(g => {
    by[g.monthKey] = by[g.monthKey] || { util: 0, count: 0 };
    by[g.monthKey].util += g.utilization;
    by[g.monthKey].count += 1;
  });
  const trend = Object.keys(by).sort().map(k => ({
    monthKey: k,
    utilization: by[k].util / by[k].count
  }));

  // 9) Build per-resource summary for client KPIs
  const byResource = {};
  filtered.forEach(b => {
    const key = b.resource;
    if (!key) return;
    const mk = monthKey_(b.period);
    byResource[key] = byResource[key] || {
      resource: b.resource,
      manager_org: b.manager_org || '',
      icpRole: b.icp || '',
      months: []
    };
    byResource[key].months.push({
      monthKey: mk,
      utilization: b.utilization,
      capacity: b.capacity,
      timeOff: b.timeOff,
      committed: b.committed,
      scenario: b.scenario
    });
  });

  // ============================================================
  // 10) SLG-only Headcount Gap by Team (per-month, planning window)
  //
  // Headcount gap = max(0, demandFte - capacityFte). Real shortfall only.
  //
  // Note: when teamLabelFilter is set, `filtered` already excludes
  // workers outside that team, so this aggregator naturally produces
  // a single-row card. No special-case code needed.
  // ============================================================
  const HEADCOUNT_FTE_BASE = 160;
  const teamMonthAgg = {};

  filtered.forEach(b => {
    const wc = String(b.worker_class || '');
    if (wc !== 'SLG_Real' && wc !== 'SLG_Generic') return;
    const mk = monthKey_(b.period);
    if (!planningMonthKeys[mk]) return;

    const roleKey = b.icp || '';
    let teamKey = roleTeamLabels[roleKey] || '';
    if (!teamKey) teamKey = 'Unclassified';

    if (!teamMonthAgg[teamKey]) teamMonthAgg[teamKey] = {};
    if (!teamMonthAgg[teamKey][mk]) {
      teamMonthAgg[teamKey][mk] = { capHrs: 0, demandHrs: 0 };
    }
    const agg = teamMonthAgg[teamKey][mk];

    const committedWork = Number(b.committed) || 0;
    const timeOff = Number(b.timeOff) || 0;
    const scen = Number(b.scenario) || 0;
    const cap = Number(b.capacity) || 0;

    let demandHrs = committedWork;
    if (viewMode === 'Scenario') demandHrs += scen;
    if (includePto) demandHrs += timeOff;

    agg.capHrs += cap;
    agg.demandHrs += demandHrs;
  });

  const CANONICAL_TEAM_ORDER = [
    'Delivery',
    'Functional Consulting',
    'Technical Consulting',
    'Unclassified'
  ];
  const headcountByTeam = Object.keys(teamMonthAgg)
    .sort((a, b) => {
      const ia = CANONICAL_TEAM_ORDER.indexOf(a);
      const ib = CANONICAL_TEAM_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    })
    .map(teamKey => {
      const monthMap = teamMonthAgg[teamKey];
      const monthly = planningMonthsList.map(mk => {
        const a = monthMap[mk] || { capHrs: 0, demandHrs: 0 };
        const capFte = a.capHrs / HEADCOUNT_FTE_BASE;
        const demandFte = a.demandHrs / HEADCOUNT_FTE_BASE;
        const gap = Math.max(0, demandFte - capFte);
        const util = capFte > 0 ? (demandFte / capFte) : 0;
        return { monthKey: mk, capFte: capFte, demandFte: demandFte, gap: gap, util: util };
      });

      let peakIdx = 0;
      for (let i = 1; i < monthly.length; i++) {
        if (monthly[i].demandFte > monthly[peakIdx].demandFte) peakIdx = i;
      }
      const peak = monthly[peakIdx] || { monthKey: '', capFte: 0, demandFte: 0, gap: 0, util: 0 };

      const monthsInScope = monthly.length || 1;
      const sumCap = monthly.reduce((s, m) => s + m.capFte, 0);
      const sumDemand = monthly.reduce((s, m) => s + m.demandFte, 0);
      const sumGap = monthly.reduce((s, m) => s + m.gap, 0);
      const avgCapFte = sumCap / monthsInScope;
      const avgDemandFte = sumDemand / monthsInScope;
      const avgGap = sumGap / monthsInScope;
      const avgUtil = avgCapFte > 0 ? (avgDemandFte / avgCapFte) : 0;

      return {
        team: teamKey,
        capacityFte: Number(avgCapFte) || 0,
        peakDemandFte: Number(peak.demandFte) || 0,
        peakUtil: Number(peak.util) || 0,
        peakGap: Number(peak.gap) || 0,
        peakMonth: String(peak.monthKey || ''),
        avgDemandFte: Number(avgDemandFte) || 0,
        avgUtil: Number(avgUtil) || 0,
        avgGap: Number(avgGap) || 0,
        suggestedHeads: Math.ceil(Number(peak.gap) || 0),
        monthsInScope: monthsInScope,
        monthly: monthly.map(m => ({
          monthKey: String(m.monthKey),
          capFte: Number(m.capFte) || 0,
          demandFte: Number(m.demandFte) || 0,
          gap: Number(m.gap) || 0,
          util: Number(m.util) || 0
        }))
      };
    });

  const sanitizedCells = cells.map(c => ({
    rowKey: String(c.rowKey),
    monthKey: String(c.monthKey),
    utilization: Number(c.utilization) || 0,
    icpTarget: Number(c.icpTarget) || 0,
    committed: Number(c.committed) || 0,
    capacity: Number(c.capacity) || 0,
    timeOff: Number(c.timeOff) || 0,
    gapHours: Number(c.gapHours) || 0,
    headcount: Number(c.headcount) || 0
  }));
  const sanitizedTrend = trend.map(t => ({
    monthKey: String(t.monthKey),
    utilization: Number(t.utilization) || 0
  }));
  const byResourceArr = Object.values(byResource).map(r => ({
    resource: String(r.resource),
    manager_org: String(r.manager_org),
    icpRole: String(r.icpRole),
    months: r.months.map(m => ({
      monthKey: String(m.monthKey),
      utilization: Number(m.utilization) || 0,
      capacity: Number(m.capacity) || 0,
      timeOff: Number(m.timeOff) || 0,
      committed: Number(m.committed) || 0,
      scenario: Number(m.scenario) || 0
    }))
  }));

  return {
    viewMode: String(viewMode),
    groupBy: String(groupBy),
    planningWindowMonths: windowMonths,
    teamLabelFilter: teamLabelFilter || null,
    managerFilterSuppressed: !!teamLabelFilter && !!selectedManager,
    kpis: {
      avgUtilization: Number(avgUtil) || 0,
      availableFte: Number(availableFte) || 0,
      scenarioDemandFte: Number(scenarioFte) || 0,
      gapFte: Number(gapFte) || 0,
      headcount: Object.keys(seenRes).length
    },
    heatmap: {
      rows: rows.map(String),
      months: Object.keys(allMonths).sort(),
      cells: sanitizedCells
    },
    trend: sanitizedTrend,
    byResource: byResourceArr,
    headcountByTeam: headcountByTeam
  };
}

function computeResourceDetail(params) {
  params = params || {};
  const resource = params.resource;
  if (!resource) return [];
  const excluded = readExclusions_();
  if (excluded.has(resource)) return [];

  const viewMode = params.viewMode || 'Committed';
  const alloc = cachedRead_(ALLOC_NORM).filter(a => a.resource_name === resource);
  const assigns = cachedRead_(ASSIGNMENTS).filter(a => a.resource_name === resource);
  const calendar = readCalendar_();
  const months = {};

  alloc.forEach(a => {
    const k = monthKey_(a.period_start);
    months[k] = months[k] || { billable: 0, internal: 0, education: 0, pto: 0, scenario: 0 };
    const h = Number(a.hours) || 0;
    if (a.allocation_type === 'Billable') months[k].billable += h;
    else if (a.allocation_type === 'Internal') months[k].internal += h;
    else if (a.allocation_type === 'Education') months[k].education += h;
    else if (a.allocation_type === 'PTO_Holiday') months[k].pto += h;
  });

  if (viewMode !== 'Actual') {
    assigns.forEach(a => {
      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!params.scenarioId || a.scenario_id === params.scenarioId));
      if (!include) return;
      expandAssignmentToMonthly_(a, calendar).forEach(m => {
        const k = monthKey_(m.period_start);
        months[k] = months[k] || { billable: 0, internal: 0, education: 0, pto: 0, scenario: 0 };
        if (isCommitted) {
          months[k].billable += m.hours;
        } else if (isScenario) {
          months[k].scenario += m.hours;
        }
      });
    });
  }

  return Object.keys(months).sort().map(k => ({
    monthKey: String(k),
    billable: Number(months[k].billable) || 0,
    internal: Number(months[k].internal) || 0,
    education: Number(months[k].education) || 0,
    pto: Number(months[k].pto) || 0,
    scenario: Number(months[k].scenario) || 0
  }));
}
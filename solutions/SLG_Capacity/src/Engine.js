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

// ============================================================
// Weekly capacity targets (weekly-forecast-migration).
//
// Distinct from readRoleCapacity_ above -- that MONTHLY roleCap model is
// preserved as-is for the legacy computeUtilization/computeResourceDetail
// Explorer/Reporting outputs (out of scope for this migration). These
// WEEKLY targets power the new computeWeeklyForecast_ / api_getForecastTable
// path only.
// ============================================================

/**
 * Level = Job Profile.substring(0, 2), e.g. 'P3'..'P6'. Blank-safe.
 * @param {string} jobProfile
 * @return {string}
 */
function deriveLevel_(jobProfile) {
  return String(jobProfile || '').trim().substring(0, 2);
}

/**
 * Weekly capacity targets from Config_Settings (weekly_target_default,
 * weekly_target_P6), falling back to the LOCKED defaults (32.8 / 26.0)
 * when a key is missing or non-numeric.
 * @param {Object} [settings] output of readSettings_(); read fresh if omitted
 * @return {{default:number, p6:number}}
 */
function readWeeklyTargets_(settings) {
  settings = settings || readSettings_();
  const def = Number(settings.weekly_target_default);
  const p6  = Number(settings.weekly_target_P6);
  return {
    default: (isFinite(def) && def > 0) ? def : 32.8,
    p6:      (isFinite(p6)  && p6  > 0) ? p6  : 26.0
  };
}

/**
 * Resolve a worker's weekly capacity target. P6-level workers (Level ===
 * 'P6', derived from Job Profile) use weekly_target_P6; everyone else
 * uses weekly_target_default.
 * @param {string} jobProfile
 * @param {{default:number, p6:number}} weeklyTargets output of readWeeklyTargets_()
 * @return {number}
 */
function weeklyTargetFor_(jobProfile, weeklyTargets) {
  return deriveLevel_(jobProfile) === 'P6' ? weeklyTargets.p6 : weeklyTargets.default;
}

// ============================================================
// Productive Utilization Model (WFM.15).
//
// Supersedes the conflated weekly_target_* model above (readWeeklyTargets_/
// weeklyTargetFor_ are left defined but UNCALLED per WFM.15 §6 -- deprecated,
// not removed, so the sheet keys and rollback path stay intact) with
// decoupled raw capacity + a per-role-family x level target table, plus a
// holiday calendar that reduces available hours. Two metrics:
//   ICP util     = productive demand / ICP available (available nets out
//                  holiday hours -- the PRIMARY metric, drives coloring)
//   Finance util = productive demand / raw capacity (no holiday netting --
//                  SECONDARY, for future Reporting use)
// "Productive demand" excludes PTO_Holiday allocation rows from the
// numerator; the visual layer (weekly table cells, heatmap, Explorer)
// still displays PTO/Holiday hours per the existing includeTimeOff toggle
// -- that calc/display divergence is intentional (WFM.15 spec).
// ============================================================

/**
 * Raw weekly capacity hours, same for every worker. Config_Settings key
 * raw_weekly_capacity, falling back to the LOCKED default (40) when
 * missing or non-numeric.
 * @param {Object} [settings] output of readSettings_(); read fresh if omitted
 * @return {number}
 */
function readRawCapacity_(settings) {
  settings = settings || readSettings_();
  const c = Number(settings.raw_weekly_capacity);
  return (isFinite(c) && c > 0) ? c : 40;
}

/**
 * Role family for the WFM.15 target table. Consulting = {CS_FUNC, CS_TECH};
 * Delivery = {EM, DA, PD}. Everything else (blank/Unclassified/etc.) has no
 * family -- icpTargetFor_ falls back to icp_target_default for those.
 * @param {string} icpRole
 * @return {string} 'consulting' | 'delivery' | ''
 */
function roleFamily_(icpRole) {
  const r = String(icpRole || '').trim().toUpperCase();
  if (r === 'CS_FUNC' || r === 'CS_TECH') return 'consulting';
  if (r === 'EM' || r === 'DA' || r === 'PD') return 'delivery';
  return '';
}

/**
 * ICP target utilization for a worker, per the WFM.15 4-cell table
 * (role family x level), read from Config_Settings:
 *   icp_target_consulting_P3_P5, icp_target_consulting_P6,
 *   icp_target_delivery_P3_P5,   icp_target_delivery_P6,
 *   icp_target_default (fallback when no role family resolves; logs a
 *   warning since that's the "should not normally happen" path).
 * @param {string} icpRole
 * @param {string} jobProfile
 * @param {Object} [settings] output of readSettings_(); read fresh if omitted
 * @return {number}
 */
function icpTargetFor_(icpRole, jobProfile, settings) {
  settings = settings || readSettings_();
  const fam = roleFamily_(icpRole);
  const isP6 = deriveLevel_(jobProfile) === 'P6';
  function num(k, d) { const v = Number(settings[k]); return (isFinite(v) && v > 0) ? v : d; }
  if (fam === 'consulting') return isP6 ? num('icp_target_consulting_P6', 0.61) : num('icp_target_consulting_P3_P5', 0.77);
  if (fam === 'delivery')   return isP6 ? num('icp_target_delivery_P6', 0.61)   : num('icp_target_delivery_P3_P5', 0.69);
  Logger.log('icpTargetFor_: no role family for icp="' + icpRole + '" — using icp_target_default');
  return num('icp_target_default', 0.72);
}

/**
 * Read the active Config_Holidays rows. Each holiday's date is normalized
 * via weekStart_ (local midnight, no snapping) so date-range comparisons
 * in holidayHoursForWeek_ are exact-day matches, not off by time-of-day.
 * @return {Array<{date:Date, hours:number}>}
 */
function readHolidays_() {
  let rows;
  try { rows = cachedRead_(CFG_HOLIDAYS); } catch (e) { return []; }
  const TRUTHY = { 'yes':1,'y':1,'true':1,'t':1,'1':1,'x':1,'active':1,'on':1 };
  return (rows || []).map(function (r) {
    const active = String(r.active === '' || r.active == null ? 'true' : r.active).trim().toLowerCase();
    if (!TRUTHY[active]) return null;
    const d = r.holiday_date ? new Date(r.holiday_date) : null;
    if (!d || isNaN(d.getTime())) return null;
    const h = Number(r.hours);
    return { date: weekStart_(d), hours: (isFinite(h) && h > 0) ? h : 8 };
  }).filter(Boolean);
}

/**
 * Total holiday hours falling within a week's [week_start, week_start+6]
 * range. Multiple holidays in the same week SUM (e.g. Thanksgiving + the
 * Day After = 16h; Christmas Eve + Christmas Day = 16h). Flat hours per
 * holiday, applied to every worker -- no per-worker eligibility.
 * @param {Date|string|number} weekStartDate
 * @param {Array<{date:Date, hours:number}>} holidays output of readHolidays_()
 * @return {number}
 */
function holidayHoursForWeek_(weekStartDate, holidays) {
  const ws = weekStart_(weekStartDate);
  const we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
  let total = 0;
  (holidays || []).forEach(function (h) { if (h.date >= ws && h.date <= we) total += h.hours; });
  return total;   // sums multiple holidays in one week (Thanksgiving+Day After = 16)
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

/**
 * Read Config_Calendar (weekly grain, weekly-forecast-migration). Returns
 * both a keyed lookup and a sorted array -- the array is what
 * expandAssignmentToWeekly_/expandAdjustmentToWeekly_ use to find the real
 * calendar weeks overlapping an assignment's date range (NOT a naive
 * 7-day stepper from the assignment's own start_date, which would not
 * align with the PSA-ingested week grid).
 *
 * WFM.13: week_key is always RECOMPUTED from week_start here, never trusted
 * from the stored cell -- a week_key cell corrupted by Sheets' auto-Date-
 * conversion (see writeTable_, Util.gs) would otherwise flow through as a
 * raw Date object instead of the canonical 'YYYY-MM-DD' string.
 *
 * @return {{byWeekKey: Object, weeks: Array<{week_start:Date, week_key:string, fiscal_year:number, fiscal_quarter:string, workdays_in_week:number, holiday_hours:number}>}}
 */
function readCalendar_() {
  const rows = cachedRead_(CFG_CAL);
  const byWeekKey = {};
  const weeks = [];
  rows.forEach(r => {
    const ws = weekStart_(r.week_start);
    const wk = weekKey_(ws);
    const entry = {
      week_start: ws,
      week_key: wk,
      fiscal_year: Number(r.fiscal_year) || fiscalYear_(ws),
      fiscal_quarter: r.fiscal_quarter || fiscalQuarter_(ws),
      workdays_in_week: Number(r.workdays_in_week) || 5,
      holiday_hours: Number(r.holiday_hours) || 0
    };
    byWeekKey[wk] = entry;
    weeks.push(entry);
  });
  weeks.sort((a, b) => a.week_start - b.week_start);
  return { byWeekKey: byWeekKey, weeks: weeks };
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

/**
 * WFM-FIX.3: Config_Worker_Exclusions is now code-maintained (see
 * reconcileWorkerExclusions_, Ingest.gs) with a locked precedence, keyed by
 * _exclusionKey_ (Util.gs) everywhere -- not the raw worker_name string --
 * so suffix/spacing/case drift (e.g. an "(On Leave)" tag appearing or
 * disappearing between exports) can't silently break matching.
 *
 * Precedence, per worker:
 *   1) any row with override='include' -> NOT excluded (wins over everything)
 *   2) else any row with override='exclude' -> excluded
 *   3) else excluded if a rule:* row exists, OR a manual row with active=Yes exists
 *
 * @return {Set<string>} set of _exclusionKey_ values that ARE excluded
 */
function readExclusions_() {
  var rows;
  try { rows = cachedRead_(CFG_WORKER_EXCLUSIONS); }
  catch (e) { rows = readTable_(CFG_WORKER_EXCLUSIONS); }
  var TRUTHY = {'yes':1,'y':1,'true':1,'t':1,'1':1,'x':1,'active':1,'on':1};
  var forceInclude = {}, excluded = {};
  (rows || []).forEach(function (r) {
    var k = _exclusionKey_(r.worker_name);
    if (!k) return;
    var ovr = String(r.override || '').trim().toLowerCase();
    if (ovr === 'include') { forceInclude[k] = true; return; }
    if (ovr === 'exclude') { excluded[k] = true; return; }
    var src = String(r.source || '').trim();
    var isRule = src.indexOf('rule:') === 0 || src.indexOf('rule:') > 0;
    var activeRaw = (r.active === '' || r.active == null) ? 'Yes' : r.active;
    var active = String(activeRaw).replace(/\u00A0/g,' ').trim().toLowerCase();
    if (isRule || TRUTHY[active]) excluded[k] = true;
  });
  var set = new Set();
  Object.keys(excluded).forEach(function (k) { if (!forceInclude[k]) set.add(k); });
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
  var iTeamLabel = header.indexOf('team_label');

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
      email: email,
      team_label: iTeamLabel >= 0 ? _normCell_(row[iTeamLabel]) : ''
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

/**
 * WFM-FIX.1: expand descendants whenever includeMyManagers is set, for
 * ANY selected manager -- the prior per-row include_descendants === 'Y'
 * gate meant managers without that flag (e.g. Steve, Roman, Lakshmi)
 * could never see their full org, and it was also the reason a manager
 * with the flag set (Marie, Katie) still appeared direct-reports-only
 * whenever a stale includeMyManagers:false slipped through from a prior
 * drawer Apply / Clear All. The include_descendants column stays in the
 * sheet (still read by readConfigSlgManagers_) but no longer gates this.
 * managersByName is retained in the signature so call sites need no change,
 * even though it is no longer read.
 */
function buildEffectiveManagers_(selectedName, includeMyManagers, managersByName, managerDescendants) {
  var name = (selectedName || '').trim();
  if (!name) return null;
  var set = {};
  set[name] = true;
  if (includeMyManagers) {
    var desc = managerDescendants[name] || [];
    desc.forEach(function (m) { set[m] = true; });
  }
  return set;
}

/**
 * Expand an assignment into per-week hours, aligned to the REAL
 * Config_Calendar week grid (weekly-forecast-migration). Replaces
 * expandAssignmentToMonthly_. Filters calendar.weeks to those overlapping
 * [a.start_date, a.end_date] rather than stepping 7 days from
 * a.start_date, so weekly buckets line up with PSA-ingested weeks.
 *
 * 'Custom' distribution was removed in WFM.12 (client collected
 * month-keyed custom_monthly_json while this function looked up
 * week_key, silently zeroing every week). Any distribution value outside
 * DISTRIBUTIONS -- e.g. a legacy 'Custom' row -- is defensively treated
 * as Even, with a logged warning; never silently produces all-zero weeks.
 *
 * @param {Object} a assignment row (start_date, end_date, estimated_hours, distribution)
 * @param {{weeks: Array}} calendar output of readCalendar_()
 * @return {Array<{week_start:Date, week_key:string, hours:number}>}
 */
function expandAssignmentToWeekly_(a, calendar) {
  if (!a.start_date || !a.end_date) return [];
  const start = weekStart_(a.start_date);
  const end = weekStart_(a.end_date);

  const weeks = ((calendar && calendar.weeks) || []).filter(w => {
    const weekEnd = new Date(w.week_start.getFullYear(), w.week_start.getMonth(), w.week_start.getDate() + 6);
    return weekEnd >= start && w.week_start <= end;
  });
  if (!weeks.length) return [];

  const total = Number(a.estimated_hours) || 0;

  let dist = a.distribution;
  if (DISTRIBUTIONS.indexOf(dist) === -1) {
    Logger.log('expandAssignmentToWeekly_: unrecognized distribution "' + dist +
      '" for assignment ' + (a.assignment_id || '(no id)') + ' -- defaulting to Even');
    dist = 'Even';
  }

  const wdTotal = weeks.reduce((s, w) => s + (w.workdays_in_week || 5), 0) || 1;
  const n = weeks.length;
  let weights = weeks.map(w => (w.workdays_in_week || 5) / wdTotal);

  if (dist === 'Front-loaded' || dist === 'Back-loaded') {
    const ramp = weeks.map((_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      return dist === 'Front-loaded' ? (1.5 - t) : (0.5 + t);
    });
    const rsum = ramp.reduce((s, x) => s + x, 0);
    weights = weights.map((w, i) => ramp[i] / rsum);
  }

  return weeks.map((w, i) => ({
    week_start: w.week_start,
    week_key: w.week_key,
    hours: total * weights[i]
  }));
}

/**
 * Legacy wrapper. Retained for backward compatibility.
 * All callers inside this file now use resolveTeamLabel_ (EnrichedData.gs).
 */
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
      name: k, employee_id: '', icp: '', resource_type: '', worker_class: '',
      teamCounts: {}, mgrCounts: {}, practiceCounts: {},
      teamTypeCounts: {}, subteamCounts: {},
      jobProfileCounts: {}, roleCategoryCounts: {}
    };
    if (a.employee_id) map[k].employee_id = map[k].employee_id || a.employee_id;
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
      // Drop 5: use the resolved team_label stamped on every bucket by
      // computeUtilization via the unified resolveTeamLabel_ (EnrichedData.gs).
      // Falls back to the legacy chain for callers that don't stamp it.
      return (
        bucket.team_label ||
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
 * Legacy resolver. Retained as a thin wrapper around resolveTeamLabel_
 * (EnrichedData.gs) for backward compatibility.
 * computeUtilization now calls resolveTeamLabel_ directly via ctx.
 */
function _resolveTeamForBucket_(bucket, roleTeamLabels, rtTeamMap) {
  if (typeof resolveTeamLabel_ === 'function') {
    var ctx = resolveTeamLabel_.buildCtx_(roleTeamLabels, rtTeamMap);
    return resolveTeamLabel_(bucket, ctx);
  }
  // Fallback if EnrichedData.gs not yet available.
  var wc = String((bucket && bucket.worker_class) || '');
  if (wc === 'SLG_Real' || wc === 'SLG_Generic') {
    var teamLabel = (roleTeamLabels || {})[bucket.icp || ''] || '';
    // Drop 7: SLG_Generic fallback via resource_type when icp is blank.
    if (!teamLabel && wc === 'SLG_Generic' && bucket.resource_type) {
      var rtKey = String(bucket.resource_type).trim().toLowerCase();
      teamLabel = (rtTeamMap || {})[rtKey] || '';
    }
    return teamLabel || 'Unclassified';
  }
  function tryKey(v) {
    if (!v) return '';
    var k = String(v).trim().toLowerCase();
    return (rtTeamMap || {})[k] || '';
  }
  return tryKey(bucket.role_category) || tryKey(bucket.job_profile) ||
    tryKey(bucket.project_role) || tryKey(bucket.resource_type) || 'Unclassified';
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

  // Drop 5: use shared cached getters to avoid redundant reads across endpoints.
  const allocRaw = (typeof getEnrichedAllocations_ === 'function')
    ? getEnrichedAllocations_() : cachedRead_(ALLOC_NORM);
  const assignsRaw = (typeof getEnrichedAssignments_ === 'function')
    ? getEnrichedAssignments_() : cachedRead_(ASSIGNMENTS);
  const excluded = readExclusions_();
  const resIndex = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_() : _resourceIndex_(allocRaw);

  function inScope(workerName) {
    const info = resIndex[workerName] || {};
    const cls = String(info.worker_class || '');
    if (hideAllExternal && cls.startsWith('External_')) return false;
    return _workerClassInScope_(cls, workerScope);
  }

  const alloc = allocRaw.filter(a => {
    if (!a.resource_name) return false;
    if (excluded.has(_exclusionKey_(a.resource_name))) return false;
    return inScope(a.resource_name);
  });
  const assigns = assignsRaw.filter(a => {
    if (!a.resource_name) return false;
    if (excluded.has(_exclusionKey_(a.resource_name))) return false;
    return inScope(a.resource_name);
  });

  const icp = readIcp_();
  const calendar = readCalendar_();
  const roleCap = readRoleCapacity_();

  // Drop 5: build unified resolver ctx once per request.
  const _resolverCtx_ = (typeof resolveTeamLabel_ === 'function')
    ? resolveTeamLabel_.buildCtx_(roleTeamLabels, rtTeamMap)
    : null;

  const buckets = {};
  function bucket(resourceName, period) {
    const k = resourceName + '|' + monthKey_(period);
    if (!buckets[k]) {
      const info = resIndex[resourceName] || {};
      // Resolve team_label once per resource+period bucket via unified resolver.
      const teamLabel = _resolverCtx_
        ? resolveTeamLabel_({
            worker_class:  info.worker_class  || '',
            icp_role:      info.icp           || '',
            role_category: info.role_category || '',
            job_profile:   info.job_profile   || '',
            project_role:  info.project_role  || '',
            resource_type: info.resource_type || ''
          }, _resolverCtx_)
        : 'Unclassified';
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
        team_label: teamLabel,
        committed: 0, billable: 0, scenario: 0,
        timeOff: 0, education: 0, unassigned: 0,
        reduction: 0
      };
    }
    return buckets[k];
  }

  // weekly-forecast-migration: Allocations_Normalized/assignments/
  // adjustments are now sourced at WEEKLY grain. This legacy monthly
  // aggregator rolls each week's hours up to the calendar month(s) it
  // overlaps via splitWeekAcrossMonths_ (proportional, sum-exact) so the
  // rest of computeUtilization (steps 3-10 below) is unchanged -- it still
  // consumes monthly buckets keyed by resource_name + '|' + monthKey.
  const splitBasis = String(settings.week_month_split_basis || 'calendar');

  // 1) Actual allocations from PSA
  alloc.forEach(a => {
    if (!a.resource_name || !a.week_start) return;
    const h = Number(a.hours) || 0;
    if (!h) return;
    splitWeekAcrossMonths_(a.week_start, h, splitBasis).forEach(m => {
      const b = bucket(a.resource_name, monthKeyToDate_(m.monthKey));
      const hrs = m.hours;
      if (a.allocation_type === 'PTO_Holiday') {
        b.timeOff += hrs;
      } else if (a.allocation_type === 'Education') {
        b.education += hrs;
        b.committed += hrs;
      } else if (a.allocation_type === 'Billable') {
        b.billable += hrs;
        b.committed += hrs;
      } else {
        b.committed += hrs;
        if (a.allocation_type && a.allocation_type !== '') {
          b.unassigned += hrs;
        }
      }
    });
  });

  // 2) Assignments -- expand weekly against the real calendar grid, then
  // roll each week's hours up to month(s) via proportional split.
  if (viewMode !== 'Actual') {
    assigns.forEach(a => {
      if (!a.resource_name) return;
      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!params.scenarioId || a.scenario_id === params.scenarioId));
      if (!include) return;
      expandAssignmentToWeekly_(a, calendar).forEach(w => {
        splitWeekAcrossMonths_(w.week_start, w.hours, splitBasis).forEach(m => {
          const b = bucket(a.resource_name, monthKeyToDate_(m.monthKey));
          if (isCommitted) {
            b.billable += m.hours;
            b.committed += m.hours;
          } else if (isScenario) {
            b.scenario += m.hours;
          }
        });
      });
    });
  }

  // 2.5) Capacity adjustments (worker-scoped reductions — Drop 6)
  if (viewMode !== 'Actual') {
    let adjRows = [];
    try { adjRows = cachedRead_(CAPACITY_ADJUSTMENTS_SHEET); } catch (e) { adjRows = []; }
    adjRows.forEach(adj => {
      if (!adj.resource_name) return;
      if (excluded.has(_exclusionKey_(adj.resource_name))) return;
      const isCommitted = (adj.status === 'Committed');
      const isModeled   = (adj.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isModeled &&
         (!params.scenarioId || adj.scenario_id === params.scenarioId));
      if (!include) return;
      expandAdjustmentToWeekly_(adj, calendar).forEach(w => {
        splitWeekAcrossMonths_(w.week_start, w.hours_reduction, splitBasis).forEach(m => {
          const b = bucket(adj.resource_name, monthKeyToDate_(m.monthKey));
          const hrs = m.hours;
          b.reduction += hrs;
          if (isCommitted) {
            b.billable  = Math.max(0, b.billable  - hrs);
            b.committed = Math.max(0, b.committed - hrs);
          } else if (isModeled) {
            b.scenario = b.scenario - hrs; // can go negative (net reduction)
          }
        });
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

  // 4) Apply manager filter AND Priority 2 team filter.
  //    Team filter overrides manager (effectiveManagers is null when
  //    teamLabelFilter is set, see above).
  //    Drop 5: team_label is already stamped on every bucket via the unified
  //    resolver ctx above, so no separate resolution step is needed here.
  //    Drop 1 local teamCache removed — resolveTeamLabel_ memoizes internally.
  const filtered = Object.values(buckets).filter(b => {
    if (effectiveManagers) {
      const mgrNorm = normalizeManagerName_(b.manager_org || '');
      if (!effectiveManagers[mgrNorm]) return false;
    }
    if (teamLabelFilter) {
      const bucketTeam = b.team_label || 'Unclassified';
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
  // WFM.15 §6: Headcount Gap FTE capacity converges onto the weekly
  // raw-capacity model (Config_Settings.raw_weekly_capacity, 40/wk default)
  // instead of the legacy monthly roleCap (Config_Roles, 160/mo default),
  // via the standard 52/12 weeks-per-month conversion. Every SLG_Real/
  // SLG_Generic worker contributes the SAME flat monthly-equivalent -- raw
  // capacity has no per-role/per-worker variation (WFM.15 locked design).
  // This WILL move FTE numbers vs. pre-WFM.15 (see _dbg_reconcileWFM15's
  // before/after log, Diagnostics.gs) -- HEADCOUNT_FTE_BASE (the demand-
  // side FTE-hours convention) is unchanged; only the capacity-hours
  // SOURCE converges.
  const rawCapacityMonthlyEquiv = readRawCapacity_(settings) * (52 / 12);
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
    const cap = rawCapacityMonthlyEquiv;

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
      totalCommittedHours: Number(usedForKpi) || 0,
      scenarioDemandHours: Number(totScenario) || 0,
      scenarioDemandFte: Number(scenarioFte) || 0,
      availableFte: Number(availableFte) || 0,
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

// ============================================================
// Weekly-native forecast computation (weekly-forecast-migration).
//
// Powers api_getForecastTable / the redesigned Dashboard weekly table.
// Distinct from computeUtilization above (which stays monthly-shaped for
// the out-of-scope legacy Explorer/Reporting views). Buckets by
// resource_name + '|' + week_key using the WFM.15 Productive Utilization
// Model (readRawCapacity_/icpTargetFor_/readHolidays_), not the monthly
// roleCap model and not the deprecated weekly_target_* model.
//
// Applies the same filter pipeline as computeUtilization: exclusions,
// manager hierarchy (+descendants), Team override, worker scope,
// viewMode, scenario, PTO toggle, worker-class logic.
// ============================================================

/**
 * @param {Object} params same shape as computeUtilization's params
 * @return {{
 *   weeks: Array<{week_start:Date, week_key:string, fiscal_year:number, fiscal_quarter:string, workdays_in_week:number}>,
 *   workers: Array<{
 *     resource:string, jobProfile:string, level:string, managerOrg:string,
 *     managersManager:string, teamLabel:string, icpRole:string,
 *     icpTarget:number,
 *     workerWeekly: Object<string, number>,
 *     productiveWeekly: Object<string, number>,
 *     projects: Object<string, Object<string, number>>
 *   }>,
 *   icp: Object,
 *   rawCapacity: number,
 *   holidayHoursByWeek: Object<string, number>
 * }}
 */
/**
 * Build blendedWeekly on a worker from forecast weekly maps + actuals overlay.
 * Must run before reduction clamp so actual weeks are non-reducible (WFM.25).
 * @param {Object} worker
 * @param {Object} actualsByWorker employeeId → { weekKey: hours }
 */
function _blendWorkerWeeklyMaps_(worker, actualsByWorker) {
  actualsByWorker = actualsByWorker || {};
  var wActuals = (worker.employeeId && actualsByWorker[worker.employeeId])
    ? actualsByWorker[worker.employeeId] : {};
  worker.blendedWeekly = {};
  var allWeekKeys = {};
  Object.keys(worker.workerWeekly || {}).forEach(function (k) { allWeekKeys[k] = true; });
  Object.keys(wActuals).forEach(function (k) { allWeekKeys[k] = true; });
  Object.keys(allWeekKeys).forEach(function (wk) {
    if (wActuals.hasOwnProperty(wk)) {
      worker.blendedWeekly[wk] = { hours: wActuals[wk], isActual: true };
      // Actual weeks are non-reducible; zero forecast productive so clamp cannot
      // consume assignment hours on weeks already closed in D8 actuals.
      worker.productiveWeekly[wk] = 0;
    } else {
      worker.blendedWeekly[wk] = {
        hours: worker.workerWeekly[wk] || 0,
        isActual: false
      };
    }
  });
}

/**
 * Sync non-actual blendedWeekly cells from productiveWeekly after reductions.
 * @param {Object} worker
 */
function _syncBlendedWeeklyForecastCells_(worker) {
  Object.keys(worker.blendedWeekly || {}).forEach(function (wk) {
    var cell = worker.blendedWeekly[wk];
    if (!cell || cell.isActual) return;
    cell.hours = Math.max(0, Number(worker.productiveWeekly[wk]) || 0);
  });
}

/**
 * Forecast-remaining productive hours for per-week reduction zero-clamp (WFM.25).
 * Single basis for preview and committed: actual weeks (D8 blended) are not
 * reducible; forecast weeks clamp on productiveWeekly only, never workerWeekly.
 * @param {Object} worker forecast worker row (blendedWeekly should be built first)
 * @param {string} weekKey
 * @param {Object} [actualsByWorker] optional preloaded map from getActualsByWorkerWeek_()
 * @return {number}
 */
function productiveHoursAvailableForReductionClamp_(worker, weekKey, actualsByWorker, weekStart) {
  // WFM.25 item 3: current-quarter weeks are D8 actuals-driven and non-reducible.
  if (weekStart && fiscalQuarterKey_(weekStart) === fiscalQuarterKey_(new Date())) return 0;
  var blended = worker.blendedWeekly && worker.blendedWeekly[weekKey];
  if (blended && blended.isActual) return 0;
  if (!blended && worker.employeeId && actualsByWorker) {
    var wActuals = actualsByWorker[worker.employeeId];
    if (wActuals && wActuals.hasOwnProperty(weekKey)) return 0;
  }
  return Math.max(0, Number(worker.productiveWeekly && worker.productiveWeekly[weekKey]) || 0);
}

/**
 * Sum forecast-remaining productive hours reducible in a fiscal quarter (WFM.25).
 * Single basis for clamp expected totals: actual/closed weeks contribute 0.
 * @param {Object} worker computeWeeklyForecast_ worker row (blendedWeekly built)
 * @param {string} quarterKey
 * @param {Array<{week_start:Date, week_key:string}>} weeks
 * @param {Object} [actualsByWorker] optional preloaded map from getActualsByWorkerWeek_()
 * @return {number}
 */
function forecastRemainingProductiveForQuarter_(worker, quarterKey, weeks, actualsByWorker) {
  if (quarterKey === fiscalQuarterKey_(new Date())) return 0;
  var sum = 0;
  (weeks || []).forEach(function (wk) {
    if (fiscalQuarterKey_(wk.week_start) !== quarterKey) return;
    sum += productiveHoursAvailableForReductionClamp_(worker, wk.week_key, actualsByWorker, wk.week_start);
  });
  return sum;
}

/**
 * Expand an adjustment to weekly rows with per-week zero-clamp on productive hours.
 * Sequential: each week clamps against productive hours remaining after prior weeks.
 * @param {Object} worker forecast worker row (mutated when apply is true)
 * @param {Object} adj
 * @param {{weeks:Array}} calendar
 * @param {boolean} [apply] when true, write clamped deltas to worker weekly maps
 * @return {{
 *   weeks: Array<{week_key:string, week_start:Date, hours_reduction:number}>,
 *   applied: number,
 *   requested: number
 * }}
 */
function expandClampedAdjustmentWeekly_(worker, adj, calendar, apply) {
  const out = { weeks: [], applied: 0, requested: 0 };
  if (!worker || !adj) return out;
  var actualsByWorker = null;
  const projLabel = 'Capacity Adjustment';
  expandAdjustmentToWeekly_(adj, calendar).forEach(function (wk) {
    const hrs = Number(wk.hours_reduction) || 0;
    if (!hrs) return;
    const weekKey = wk.week_key;
    if (hrs > 0) {
      out.requested += hrs;
      if (!worker.blendedWeekly && worker.employeeId && actualsByWorker === null) {
        actualsByWorker = (typeof getActualsByWorkerWeek_ === 'function')
          ? getActualsByWorkerWeek_() : {};
      }
      const currentProd = productiveHoursAvailableForReductionClamp_(
        worker, weekKey, actualsByWorker, wk.week_start);
      const weekApplied = Math.min(hrs, currentProd);
      if (!weekApplied) return;
      out.applied += weekApplied;
      out.weeks.push({
        week_key: weekKey,
        week_start: wk.week_start,
        hours_reduction: weekApplied
      });
      if (!apply) return;
      worker.workerWeekly[weekKey] = Math.max(0, (worker.workerWeekly[weekKey] || 0) - weekApplied);
      worker.productiveWeekly[weekKey] = currentProd - weekApplied;
      if (!worker.projects[projLabel]) worker.projects[projLabel] = {};
      worker.projects[projLabel][weekKey] = (worker.projects[projLabel][weekKey] || 0) - weekApplied;
    } else {
      const addAmt = -hrs;
      out.requested += addAmt;
      out.applied += addAmt;
      out.weeks.push({
        week_key: weekKey,
        week_start: wk.week_start,
        hours_reduction: -addAmt
      });
      if (!apply) return;
      worker.workerWeekly[weekKey] = (worker.workerWeekly[weekKey] || 0) + addAmt;
      worker.productiveWeekly[weekKey] = (worker.productiveWeekly[weekKey] || 0) + addAmt;
      if (!worker.projects[projLabel]) worker.projects[projLabel] = {};
      worker.projects[projLabel][weekKey] = (worker.projects[projLabel][weekKey] || 0) + addAmt;
    }
  });
  return out;
}

/**
 * Apply weekly expansion of a capacity adjustment to worker weekly maps.
 * Reductions (positive hours_reduction) are zero-clamped per week on productive hours.
 * @param {function(string):Object} ensureWorker
 * @param {Object} adj
 * @param {{weeks:Array}} calendar
 * @return {{applied:number, requested:number}}
 */
function applyCapacityAdjustmentWeekly_(ensureWorker, adj, calendar) {
  if (!adj || !adj.resource_name) return { applied: 0, requested: 0 };
  const w = ensureWorker(adj.resource_name);
  const result = expandClampedAdjustmentWeekly_(w, adj, calendar, true);
  return { applied: result.applied, requested: result.requested };
}

function computeWeeklyForecast_(params) {
  params = params || {};
  const viewMode = params.viewMode || 'Committed';
  const workerScope = params.workerScope || 'SLG';
  const includePto = params.includeTimeOff !== false; // default TRUE per spec §3

  const teamLabelFilter = params.teamLabel ? String(params.teamLabel).trim() : '';

  const roleTeamLabels = readRoleTeamLabels_();
  const rtTeamMap = _readResourceTypeTeamMap_();
  const settings = readSettings_();
  const hideAllExternal = String(settings['hide_all_external'] || '').trim().toLowerCase() === 'true';
  // WFM.15: raw capacity + holiday calendar replace the weekly_target_*
  // model for this path (readWeeklyTargets_/weeklyTargetFor_ deprecated,
  // left defined but uncalled -- see §6 of the WFM.15 spec).
  const rawCapacity = readRawCapacity_(settings);
  const holidays = readHolidays_();

  const mgrRows = readConfigSlgManagers_();
  const managerDescendants = buildManagerDescendants_(mgrRows);
  const managersByName = {};
  mgrRows.forEach(function (r) { managersByName[r.manager_name] = r; });

  const selectedManager = (params.teams && params.teams.length) ? params.teams[0] : null;
  const effectiveManagers = teamLabelFilter
    ? null
    : buildEffectiveManagers_(
        selectedManager,
        !!params.includeMyManagers,
        managersByName,
        managerDescendants
      );

  const allocRaw = (typeof getEnrichedAllocations_ === 'function')
    ? getEnrichedAllocations_() : cachedRead_(ALLOC_NORM);
  const assignsRaw = (typeof getEnrichedAssignments_ === 'function')
    ? getEnrichedAssignments_() : cachedRead_(ASSIGNMENTS);
  const excluded = readExclusions_();
  const resIndex = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_() : _resourceIndex_(allocRaw);

  var actualsByWorker = (typeof getActualsByWorkerWeek_ === 'function') ? getActualsByWorkerWeek_() : {};

  function inScope(workerName) {
    const info = resIndex[workerName] || {};
    const cls = String(info.worker_class || '');
    if (hideAllExternal && cls.startsWith('External_')) return false;
    return _workerClassInScope_(cls, workerScope);
  }

  const alloc = allocRaw.filter(a => {
    if (!a.resource_name) return false;
    if (excluded.has(_exclusionKey_(a.resource_name))) return false;
    return inScope(a.resource_name);
  });
  const assigns = assignsRaw.filter(a => {
    if (!a.resource_name) return false;
    if (excluded.has(_exclusionKey_(a.resource_name))) return false;
    return inScope(a.resource_name);
  });

  const icp = readIcp_();
  const calendar = readCalendar_();

  // WFM.15: precompute {week_key: holidayHours} once from the real
  // calendar weeks (never a naive 7-day stepper) so per-worker per-week
  // ICP-available math below is a cheap lookup, not a re-scan of
  // Config_Holidays per cell.
  const holidayHoursByWeek = {};
  calendar.weeks.forEach(function (wk) {
    holidayHoursByWeek[wk.week_key] = holidayHoursForWeek_(wk.week_start, holidays);
  });

  const _resolverCtx_ = (typeof resolveTeamLabel_ === 'function')
    ? resolveTeamLabel_.buildCtx_(roleTeamLabels, rtTeamMap)
    : null;

  const managersManagerByName = {};
  mgrRows.forEach(function (r) { managersManagerByName[r.manager_name] = r.parent_manager || ''; });

  const workers = {};

  function ensureWorker(resourceName) {
    if (!workers[resourceName]) {
      const info = resIndex[resourceName] || {};
      const teamLabel = _resolverCtx_
        ? resolveTeamLabel_({
            worker_class:  info.worker_class  || '',
            icp_role:      info.icp           || '',
            role_category: info.role_category || '',
            job_profile:   info.job_profile   || '',
            project_role:  info.project_role  || '',
            resource_type: info.resource_type || ''
          }, _resolverCtx_)
        : 'Unclassified';
      const managerOrgNorm = normalizeManagerName_(info.manager_org || '');
      workers[resourceName] = {
        resource: resourceName,
        jobProfile: info.job_profile || '',
        level: deriveLevel_(info.job_profile || ''),
        managerOrg: info.manager_org || '',
        managersManager: managersManagerByName[managerOrgNorm] || '',
        icpRole: info.icp || '',
        teamLabel: teamLabel,
        workerClass: info.worker_class || '',
        icpTarget: icpTargetFor_(info.icp || '', info.job_profile || '', settings),
        employeeId: info.employee_id || '',
        workerWeekly: {},     // weekKey -> hours (DISPLAY: PTO/Holiday-inclusive per toggle)
        productiveWeekly: {}, // weekKey -> hours (CALC: excludes PTO_Holiday -- WFM.15)
        projects: {}          // project -> { weekKey -> hours }
      };
    }
    return workers[resourceName];
  }

  // isProductive: false only for PSA PTO_Holiday rows -- assignments and
  // capacity adjustments are inherently committed/billable (never PTO), so
  // they always count toward productive demand (WFM.15).
  function addHours(resourceName, weekKey, project, hours, isProductive) {
    if (!hours) return;
    const w = ensureWorker(resourceName);
    w.workerWeekly[weekKey] = (w.workerWeekly[weekKey] || 0) + hours;
    if (isProductive) {
      w.productiveWeekly[weekKey] = (w.productiveWeekly[weekKey] || 0) + hours;
    }
    const proj = project || 'Unassigned';
    if (!w.projects[proj]) w.projects[proj] = {};
    w.projects[proj][weekKey] = (w.projects[proj][weekKey] || 0) + hours;
  }

  // 1) PSA allocations -- native weekly grain, no rollup needed.
  alloc.forEach(a => {
    if (!a.resource_name || !a.week_key) return;
    if (a.allocation_type === 'PTO_Holiday' && !includePto) return;
    const h = Number(a.hours) || 0;
    if (!h) return;
    addHours(a.resource_name, a.week_key, a.project_name, h, a.allocation_type !== 'PTO_Holiday');
  });

  // 2) Assignments -- weekly expansion aligned to the real calendar grid.
  if (viewMode !== 'Actual') {
    assigns.forEach(a => {
      if (!a.resource_name) return;
      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!params.scenarioId || a.scenario_id === params.scenarioId));
      if (!include) return;
      const label = 'Assignment' + (a.opportunity_id ? (' — ' + a.opportunity_id) : '');
      expandAssignmentToWeekly_(a, calendar).forEach(w => {
        addHours(a.resource_name, w.week_key, label, w.hours, true);
      });
    });

    // WFM.23: in-memory soft booking overlay (additive; never persisted).
    (params.inMemoryModeledAssignments || []).forEach(function (a) {
      if (!a.resource_name) return;
      expandAssignmentToWeekly_(a, calendar).forEach(function (w) {
        addHours(a.resource_name, w.week_key, 'Soft Booking', w.hours, true);
      });
    });
  }

  // Blend actuals before reductions so the clamp uses forecast-remaining only
  // (actual weeks are non-reducible — WFM.25 current-quarter D8 parity).
  Object.values(workers).forEach(function (w) {
    _blendWorkerWeeklyMaps_(w, actualsByWorker);
  });

  // 2.5) Capacity adjustments — committed reductions zero-clamped per week (WFM.25).
  if (viewMode !== 'Actual') {
    let adjRows = [];
    try { adjRows = cachedRead_(CAPACITY_ADJUSTMENTS_SHEET); } catch (e) { adjRows = []; }
    adjRows.forEach(adj => {
      if (!adj.resource_name) return;
      if (excluded.has(_exclusionKey_(adj.resource_name))) return;
      const isCommitted = (adj.status === 'Committed');
      const isModeled   = (adj.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isModeled &&
         (!params.scenarioId || adj.scenario_id === params.scenarioId));
      if (!include) return;
      applyCapacityAdjustmentWeekly_(ensureWorker, adj, calendar);
    });
    Object.values(workers).forEach(function (w) {
      _syncBlendedWeeklyForecastCells_(w);
    });
  }

  // 3) Apply manager + Team filters (same semantics as computeUtilization).
  const filteredWorkers = Object.values(workers).filter(w => {
    if (effectiveManagers) {
      const mgrNorm = normalizeManagerName_(w.managerOrg || '');
      if (!effectiveManagers[mgrNorm]) return false;
    }
    if (teamLabelFilter) {
      const t = w.teamLabel || 'Unclassified';
      if (t !== teamLabelFilter) return false;
    }
    return true;
  });

  // Default sort: Worker ascending.
  filteredWorkers.sort((a, b) => String(a.resource).localeCompare(String(b.resource)));

  return {
    weeks: calendar.weeks,
    workers: filteredWorkers,
    icp: icp,
    rawCapacity: rawCapacity,
    holidayHoursByWeek: holidayHoursByWeek
  };
}

// WFM.18-deprecated: legacy Explorer monthly path. Retained for rollback;
// no callers after WFM.18. Use api_getResourceDetailV2 instead.
function computeResourceDetail(params) {
  params = params || {};
  const resource = params.resource;
  if (!resource) return { months: [], summary: null };
  const excluded = readExclusions_();
  if (excluded.has(_exclusionKey_(resource))) return { months: [], summary: null };

  const viewMode = params.viewMode || 'Committed';
  const alloc = cachedRead_(ALLOC_NORM).filter(a => a.resource_name === resource);
  const assigns = cachedRead_(ASSIGNMENTS).filter(a => a.resource_name === resource);
  const calendar = readCalendar_();
  const settings = readSettings_();
  const splitBasis = String(settings.week_month_split_basis || 'calendar');
  const months = {};

  function ensureMonth_(k) {
    if (!months[k]) months[k] = {
      billable: 0, internal: 0, education: 0, pto: 0, scenario: 0,
      reduction: 0,
      reductionByStatus: { committed: 0, modeled: 0 }
    };
  }

  // weekly-forecast-migration: alloc rows are weekly (week_start/hours);
  // roll each week's hours up to the calendar month(s) it overlaps via
  // splitWeekAcrossMonths_ so this Explorer chart's monthly shape is
  // unchanged (out of scope for redesign) while being fed by real weekly
  // source data.
  alloc.forEach(a => {
    if (!a.week_start) return;
    const h = Number(a.hours) || 0;
    if (!h) return;
    splitWeekAcrossMonths_(a.week_start, h, splitBasis).forEach(sp => {
      const k = sp.monthKey;
      ensureMonth_(k);
      if (a.allocation_type === 'Billable') months[k].billable += sp.hours;
      else if (a.allocation_type === 'Internal') months[k].internal += sp.hours;
      else if (a.allocation_type === 'Education') months[k].education += sp.hours;
      else if (a.allocation_type === 'PTO_Holiday') months[k].pto += sp.hours;
    });
  });

  if (viewMode !== 'Actual') {
    assigns.forEach(a => {
      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (viewMode === 'Scenario' && isScenario &&
         (!params.scenarioId || a.scenario_id === params.scenarioId));
      if (!include) return;
      expandAssignmentToWeekly_(a, calendar).forEach(w => {
        splitWeekAcrossMonths_(w.week_start, w.hours, splitBasis).forEach(sp => {
          const k = sp.monthKey;
          ensureMonth_(k);
          if (isCommitted) {
            months[k].billable += sp.hours;
          } else if (isScenario) {
            months[k].scenario += sp.hours;
          }
        });
      });
    });
  }

  // Drop 7: ALWAYS surface reductions regardless of viewMode or scenario.
  // The Explorer chart shows all adjustments so Directors see the full
  // picture. reductionByStatus lets the client colour-code by status.
  let adjRows = [];
  try { adjRows = cachedRead_(CAPACITY_ADJUSTMENTS_SHEET).filter(a => a.resource_name === resource); } catch (e) { adjRows = []; }
  adjRows.forEach(adj => {
    const status = String(adj.status || 'Modeled');
    expandAdjustmentToWeekly_(adj, calendar).forEach(w => {
      splitWeekAcrossMonths_(w.week_start, w.hours_reduction, splitBasis).forEach(sp => {
        const k = sp.monthKey;
        ensureMonth_(k);
        const hrs = sp.hours;
        months[k].reduction += hrs;
        if (status === 'Committed') {
          months[k].reductionByStatus.committed += hrs;
        } else {
          months[k].reductionByStatus.modeled += hrs;
        }
      });
    });
  });

  const monthsArr = Object.keys(months).sort().map(k => ({
    monthKey:          String(k),
    billable:          Number(months[k].billable)  || 0,
    internal:          Number(months[k].internal)  || 0,
    education:         Number(months[k].education) || 0,
    pto:               Number(months[k].pto)       || 0,
    scenario:          Number(months[k].scenario)  || 0,
    reduction:         Number(months[k].reduction) || 0,
    reductionByStatus: {
      committed: Number(months[k].reductionByStatus.committed) || 0,
      modeled:   Number(months[k].reductionByStatus.modeled)   || 0
    }
  }));

  // ----------------------------------------------------------------
  // Patch: Worker Utilization Summary — worst-case view including ALL
  // modeled work regardless of viewMode/scenario (Explorer card).
  // ----------------------------------------------------------------
  const _roleCap      = readRoleCapacity_();
  const _windowMos    = readPlanningWindowMonths_();
  const _planWindow   = buildPlanningWindow_(_windowMos);

  // Derive worker's monthly capacity from ICP role or resource_type.
  const _allocRow     = alloc.length ? alloc[0] : null;
  const _workerIcp    = _allocRow ? String(_allocRow.ICP_role || '') : '';
  const _workerRt     = _allocRow ? String(_allocRow.resource_type || '') : '';
  const _monthlyHours = _roleCap[_workerIcp] || _roleCap[_workerRt] || 160;

  // Per-month summary buckets (independent of chart months map).
  const _sm = {};
  function _ensureSm_(k) {
    if (!_sm[k]) _sm[k] = {
      psaBillable: 0, psaInternal: 0, psaEducation: 0, psaPto: 0,
      committedAssign: 0, modeledAssign: 0,
      committedReduction: 0, modeledReduction: 0
    };
  }

  alloc.forEach(a => {
    if (!a.week_start) return;
    const h = Number(a.hours) || 0;
    if (!h) return;
    splitWeekAcrossMonths_(a.week_start, h, splitBasis).forEach(sp => {
      const k = sp.monthKey;
      _ensureSm_(k);
      if (a.allocation_type === 'Billable')     _sm[k].psaBillable  += sp.hours;
      else if (a.allocation_type === 'Internal')  _sm[k].psaInternal  += sp.hours;
      else if (a.allocation_type === 'Education') _sm[k].psaEducation += sp.hours;
      else if (a.allocation_type === 'PTO_Holiday') _sm[k].psaPto    += sp.hours;
    });
  });

  // Include ALL assignments (Committed + Modeled) regardless of viewMode.
  // When multiple scenarios have modeled work for the same month, they all
  // accumulate — worst-case semantics for the "see everything" summary.
  assigns.forEach(a => {
    if (a.status !== 'Committed' && a.status !== 'Modeled') return;
    expandAssignmentToWeekly_(a, calendar).forEach(w => {
      splitWeekAcrossMonths_(w.week_start, w.hours, splitBasis).forEach(sp => {
        const k = sp.monthKey;
        _ensureSm_(k);
        if (a.status === 'Committed') _sm[k].committedAssign += sp.hours;
        else _sm[k].modeledAssign += sp.hours;
      });
    });
  });

  adjRows.forEach(adj => {
    const status = String(adj.status || 'Modeled');
    expandAdjustmentToWeekly_(adj, calendar).forEach(w => {
      splitWeekAcrossMonths_(w.week_start, w.hours_reduction, splitBasis).forEach(sp => {
        const k = sp.monthKey;
        _ensureSm_(k);
        const hrs = sp.hours;
        if (status === 'Committed') _sm[k].committedReduction += hrs;
        else _sm[k].modeledReduction += hrs;
      });
    });
  });

  const _includeTimeOff = !!params.includeTimeOff;
  let _sumCU = 0, _peakCU = 0, _peakCUKey = '';
  let _sumSU = 0, _peakSU = 0, _peakSUKey = '';
  let _planMoCount = 0;
  const _comp = {
    psaBillable: 0, psaInternal: 0, psaEducation: 0, psaPto: 0,
    committedAssignments: 0, modeledAssignments: 0,
    committedReductions: 0, modeledReductions: 0
  };

  _planWindow.monthsList.forEach(k => {
    const m = _sm[k] || { psaBillable: 0, psaInternal: 0, psaEducation: 0, psaPto: 0, committedAssign: 0, modeledAssign: 0, committedReduction: 0, modeledReduction: 0 };
    _planMoCount++;
    const _to = _includeTimeOff ? (m.psaInternal + m.psaEducation + m.psaPto) : 0;
    const _cH = m.psaBillable + _to + m.committedAssign - m.committedReduction;
    const _sH = _cH + m.modeledAssign - m.modeledReduction;
    if (_monthlyHours > 0) {
      const _cu = _cH / _monthlyHours;
      const _su = _sH / _monthlyHours;
      _sumCU += _cu;
      _sumSU += _su;
      if (_cu > _peakCU) { _peakCU = _cu; _peakCUKey = k; }
      if (_su > _peakSU) { _peakSU = _su; _peakSUKey = k; }
    }
    _comp.psaBillable          += m.psaBillable;
    _comp.psaInternal          += m.psaInternal;
    _comp.psaEducation         += m.psaEducation;
    _comp.psaPto               += m.psaPto;
    _comp.committedAssignments += m.committedAssign;
    _comp.modeledAssignments   += m.modeledAssign;
    _comp.committedReductions  += m.committedReduction;
    _comp.modeledReductions    += m.modeledReduction;
  });

  const _avgCU = _planMoCount > 0 ? _sumCU / _planMoCount : 0;
  const _avgSU = _planMoCount > 0 ? _sumSU / _planMoCount : 0;
  const _to = _includeTimeOff ? (_comp.psaInternal + _comp.psaEducation + _comp.psaPto) : 0;
  const _totalCH = _comp.psaBillable + _to + _comp.committedAssignments - _comp.committedReductions;
  const _totalSH = _totalCH + _comp.modeledAssignments - _comp.modeledReductions;

  const summary = {
    capacity: {
      monthlyHours:        _monthlyHours,
      planningWindowMonths: _planMoCount,
      totalCapacityHours:  _monthlyHours * _planMoCount
    },
    committed: {
      avgUtilization:  _avgCU,
      peakUtilization: _peakCU,
      peakMonthKey:    _peakCUKey,
      totalHours:      Math.round(_totalCH)
    },
    scenario: {
      avgUtilization:  _avgSU,
      peakUtilization: _peakSU,
      peakMonthKey:    _peakSUKey,
      totalHours:      Math.round(_totalSH)
    },
    components: {
      psaBillable:          Math.round(_comp.psaBillable),
      psaInternal:          Math.round(_comp.psaInternal),
      psaEducation:         Math.round(_comp.psaEducation),
      psaPto:               Math.round(_comp.psaPto),
      committedAssignments: Math.round(_comp.committedAssignments),
      modeledAssignments:   Math.round(_comp.modeledAssignments),
      committedReductions:  Math.round(_comp.committedReductions),
      modeledReductions:    Math.round(_comp.modeledReductions)
    },
    flags: {
      overCapacityCommitted: _peakCU > 1.0,
      overCapacityScenario:  _peakSU > 1.0,
      overCapacityHours:     Math.max(0, Math.round((_peakSU * _monthlyHours) - _monthlyHours)),
      peakIsScenario:        _peakSU > _peakCU,
      isUnderutilized:       _avgCU < 0.60
    }
  };

  return { months: monthsArr, summary: summary };
}

// ============================================================
// WFM.17 — Quarterly scorecard + blended-window dashboard KPIs.
// ============================================================

/**
 * Return { start: Date, end: Date } for FYxx-Qn using the February-anchored
 * fiscal calendar (Constants.gs / Util.gs).
 * @param {string} quarterKey e.g. 'FY27-Q2'
 * @return {{start:Date, end:Date}}
 */
function fiscalQuarterBounds_(quarterKey) {
  const m = String(quarterKey || '').match(/^FY(\d{2})-(Q[1-4])$/);
  if (!m) throw new Error('fiscalQuarterBounds_: invalid quarter key "' + quarterKey + '"');
  const fy = 2000 + Number(m[1]);
  const q = m[2];
  const fyStartYear = fy - 1;
  let startYear, startMonth, endYear, endMonth;
  if (q === 'Q1') {
    startYear = fyStartYear; startMonth = 1;
    endYear = fyStartYear; endMonth = 3;
  } else if (q === 'Q2') {
    startYear = fyStartYear; startMonth = 4;
    endYear = fyStartYear; endMonth = 6;
  } else if (q === 'Q3') {
    startYear = fyStartYear; startMonth = 7;
    endYear = fyStartYear; endMonth = 9;
  } else {
    startYear = fyStartYear; startMonth = 10;
    endYear = fy; endMonth = 0;
  }
  const start = new Date(startYear, startMonth, 1);
  const end = new Date(endYear, endMonth + 1, 0);
  return { start: start, end: end };
}

/**
 * Count Monday–Friday days inclusive between two dates.
 * @param {Date} start
 * @param {Date} end
 * @return {number}
 */
function countWeekdaysInRange_(start, end) {
  let count = 0;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/**
 * Workday summary for a fiscal quarter.
 * @param {string} quarterKey
 * @param {Array<{date:Date, hours:number}>} holidays
 * @return {{workdays:number, holidayHours:number, holidayDays:number,
 *           netWorkdays:number, rawCapacityHours:number, icpAvailableHours:number}}
 */
function quarterWorkdaySummary_(quarterKey, holidays) {
  const bounds = fiscalQuarterBounds_(quarterKey);
  const workdays = countWeekdaysInRange_(bounds.start, bounds.end);
  let holidayHours = 0;
  (holidays || []).forEach(function (h) {
    const hd = h.date;
    if (hd >= bounds.start && hd <= bounds.end) holidayHours += h.hours;
  });
  const holidayDays = holidayHours / 8;
  const netWorkdays = Math.max(0, workdays - holidayDays);
  const rawCapacityHours = workdays * 8;
  const icpAvailableHours = rawCapacityHours - holidayHours;
  return {
    workdays: workdays,
    holidayHours: holidayHours,
    holidayDays: holidayDays,
    netWorkdays: netWorkdays,
    rawCapacityHours: rawCapacityHours,
    icpAvailableHours: icpAvailableHours
  };
}

var _committedAsgIdxMemo_ = null;
var _committedReductionIdxMemo_ = null;
var _wowTargetIdxMemo_ = null;
var _wowActualIcpIdxMemo_ = null;
var _wowForecastIcpIdxMemo_ = null;

/**
 * Clear per-execution projection indexes (committed assignments, reductions, WoW targets).
 */
function _resetProjectionMemos_() {
  _committedAsgIdxMemo_ = null;
  _committedReductionIdxMemo_ = null;
  _wowTargetIdxMemo_ = null;
  _wowActualIcpIdxMemo_ = null;
  _wowForecastIcpIdxMemo_ = null;
}

/**
 * Per-request index of Utilization_Quarterly target_hours by employee and
 * fiscal quarter. Reads CFG_UTIL_QUARTERLY once; plain per-execution memo.
 * @return {Object<string, Object<string, number>>} employeeId → { quarterKey → target_hours }
 */
function _wowQuarterTargetIndex_() {
  if (_wowTargetIdxMemo_) return _wowTargetIdxMemo_;
  var idx = {};
  var actuals = {};
  var forecasts = {};
  cachedRead_(CFG_UTIL_QUARTERLY).forEach(function (r) {
    var eid = String(r.employee_id || '').trim();
    var qk = String(r.fiscal_quarter || '').trim();
    if (!eid || !qk) return;
    if (!idx[eid]) idx[eid] = {};
    if (!actuals[eid]) actuals[eid] = {};
    if (!forecasts[eid]) forecasts[eid] = {};
    idx[eid][qk] = Number(r.target_hours) || 0;
    actuals[eid][qk] = Number(r.qtd_actual_icp) || 0;
    forecasts[eid][qk] = Number(r.qtd_icp_plus_forecast) || 0;
  });
  _wowTargetIdxMemo_ = idx;
  _wowActualIcpIdxMemo_ = actuals;
  _wowForecastIcpIdxMemo_ = forecasts;
  return idx;
}

/**
 * Completed-quarter actual ICP hours from Utilization_Quarterly (UTIL_Previous
 * rows). Returns the stored qtd_actual_icp verbatim — no re-derivation.
 *
 * @param {string} employeeId
 * @param {string} fiscalQuarter e.g. 'FY27-Q2'
 * @return {number|null}
 */
function quarterActualIcpFromWoW_(employeeId, fiscalQuarter) {
  employeeId = String(employeeId || '').trim();
  fiscalQuarter = String(fiscalQuarter || '').trim();
  if (!employeeId || !fiscalQuarter) return null;
  _wowQuarterTargetIndex_();
  var byQ = _wowActualIcpIdxMemo_[employeeId];
  return (byQ && Object.prototype.hasOwnProperty.call(byQ, fiscalQuarter))
    ? byQ[fiscalQuarter] : null;
}

/**
 * Forecast-quarter ICP hours from Utilization_Quarterly (UTIL_Next rows).
 * Returns qtd_icp_plus_forecast verbatim — no re-derivation.
 *
 * @param {string} employeeId
 * @param {string} fiscalQuarter e.g. 'FY27-Q4'
 * @return {number|null}
 */
function quarterForecastIcpFromWoW_(employeeId, fiscalQuarter) {
  employeeId = String(employeeId || '').trim();
  fiscalQuarter = String(fiscalQuarter || '').trim();
  if (!employeeId || !fiscalQuarter) return null;
  _wowQuarterTargetIndex_();
  var byQ = _wowForecastIcpIdxMemo_[employeeId];
  return (byQ && Object.prototype.hasOwnProperty.call(byQ, fiscalQuarter))
    ? byQ[fiscalQuarter] : null;
}

/**
 * WoW-first quarter target from Utilization_Quarterly (WFM.24 D5 / WFM.25).
 *
 * Returns target_hours for the worker+quarter when a WoW row exists, else null
 * so the caller can fall back to quarterTargetHoursFor_.
 *
 * target_hours is the utilization denominator for all quarters (WFM.25).
 *
 * WoW coverage is FY27-Q1..Q4 in the current workbook; outside that window
 * this returns null and the formula path applies.
 *
 * @param {string} employeeId
 * @param {string} fiscalQuarter e.g. 'FY27-Q2'
 * @return {number|null}
 */
function quarterTargetFromWoW_(employeeId, fiscalQuarter) {
  employeeId = String(employeeId || '').trim();
  fiscalQuarter = String(fiscalQuarter || '').trim();
  if (!employeeId || !fiscalQuarter) return null;
  var idx = _wowQuarterTargetIndex_();
  var byQ = idx[employeeId];
  return (byQ && Object.prototype.hasOwnProperty.call(byQ, fiscalQuarter))
    ? byQ[fiscalQuarter] : null;
}

/**
 * Quarterly target hours per WFM.15/WFM.17:
 * daily target = (raw_weekly_capacity × icp target %) ÷ 5
 * quarter target = daily target × net workdays (Mon–Fri minus holidays).
 * @param {string} icpRole
 * @param {string} jobProfile
 * @param {string} quarterKey
 * @param {Array<{date:Date, hours:number}>} holidays
 * @param {Object} [settings]
 * @return {number}
 */
function quarterTargetHoursFor_(icpRole, jobProfile, quarterKey, holidays, settings) {
  settings = settings || readSettings_();
  const summary = quarterWorkdaySummary_(quarterKey, holidays);
  const rawWeekly = readRawCapacity_(settings);
  const icpTarget = icpTargetFor_(icpRole, jobProfile, settings);
  const weeklyTarget = rawWeekly * icpTarget;
  const dailyTarget = weeklyTarget / 5;
  return dailyTarget * summary.netWorkdays;
}

/**
 * Rolling fiscal quarter keys starting from the quarter containing today.
 * @param {number} [count] default 4
 * @return {string[]}
 */
function rollingQuarterKeys_(count) {
  count = count || 4;
  const keys = [];
  let qk = fiscalQuarterKey_(new Date());
  for (let i = 0; i < count; i++) {
    keys.push(qk);
    const bounds = fiscalQuarterBounds_(qk);
    const nextStart = new Date(bounds.end.getFullYear(), bounds.end.getMonth() + 1, 1);
    qk = fiscalQuarterKey_(nextStart);
  }
  return keys;
}

/**
 * Shared three-quarter planning window for Scorecard and Explorer detail:
 * previous, current, next.
 * @return {string[]}
 */
function scorecardWindowKeys_() {
  const curQ = fiscalQuarterKey_(new Date());
  const curBounds = fiscalQuarterBounds_(curQ);
  const prevDay = new Date(curBounds.start.getFullYear(), curBounds.start.getMonth(), curBounds.start.getDate() - 1);
  const prevQ = fiscalQuarterKey_(prevDay);
  return [prevQ].concat(rollingQuarterKeys_(2));
}

/**
 * Productive hours for one worker-week (actuals win; forecast excludes PTO).
 * @param {Object} worker computeWeeklyForecast_ worker object
 * @param {string} weekKey
 * @return {number}
 */
function productiveHoursForWeek_(worker, weekKey) {
  const blended = worker.blendedWeekly && worker.blendedWeekly[weekKey];
  if (blended && blended.isActual) return Number(blended.hours) || 0;
  return Number(worker.productiveWeekly && worker.productiveWeekly[weekKey]) || 0;
}

/**
 * Sum forecast-side productive hours for a worker in a fiscal quarter.
 * @param {Object} worker
 * @param {string} quarterKey
 * @param {Array<{week_start:Date, week_key:string}>} weeks
 * @return {number}
 */
function sumForecastProductiveForQuarter_(worker, quarterKey, weeks) {
  let sum = 0;
  (weeks || []).forEach(function (wk) {
    if (fiscalQuarterKey_(wk.week_start) !== quarterKey) return;
    sum += productiveHoursForWeek_(worker, wk.week_key);
  });
  return sum;
}

/**
 * Fiscal-quarter blended window label shared by dashboard KPIs and scorecard.
 * @return {string}
 */
function blendedFiscalWindowLabel_() {
  const today = new Date();
  const curQ = fiscalQuarterKey_(today);
  const nextQDate = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  const nextQ = fiscalQuarterKey_(nextQDate);
  return curQ + ' + ' + nextQ + ' (actuals + forecast)';
}

/**
 * Normalize dashboard filter params shared by api_getDashboard and
 * computeBlendedWindowKpis_. includeTimeOff defaults false (matches
 * api_getDashboard / computeUtilization).
 * @param {Object} params
 * @return {Object}
 */
function dashboardKpiFilterParams_(params) {
  params = params || {};
  return {
    viewMode: params.viewMode,
    groupBy: params.groupBy,
    scenarioId: params.scenarioId,
    teams: params.teams,
    teamLabel: params.teamLabel,
    workerScope: params.workerScope,
    includeMyManagers: params.includeMyManagers,
    includeTimeOff: !!params.includeTimeOff
  };
}

/**
 * Sum modeled assignment hours in the blended fiscal window for workers
 * already in the filtered forecast worker set.
 * @param {Object} params
 * @param {Array<{week_key:string}>} visibleWeeks
 * @param {Array<{resource:string}>} workers
 * @return {number}
 */
function sumScenarioDemandHoursInWindow_(params, visibleWeeks, workers) {
  const workerSet = {};
  (workers || []).forEach(function (w) { workerSet[w.resource] = true; });
  const weekSet = {};
  (visibleWeeks || []).forEach(function (vw) { weekSet[vw.week_key] = true; });
  if (!Object.keys(workerSet).length || !Object.keys(weekSet).length) return 0;

  const calendar = readCalendar_();
  let assignsRaw = [];
  try { assignsRaw = cachedRead_(ASSIGNMENTS); } catch (e) { assignsRaw = []; }
  const excluded = readExclusions_();
  let sum = 0;
  assignsRaw.forEach(function (a) {
    if (!a.resource_name || !workerSet[a.resource_name]) return;
    if (excluded.has(_exclusionKey_(a.resource_name))) return;
    if (a.status !== 'Modeled') return;
    if (params.scenarioId && a.scenario_id !== params.scenarioId) return;
    expandAssignmentToWeekly_(a, calendar).forEach(function (w) {
      if (weekSet[w.week_key]) sum += Number(w.hours) || 0;
    });
  });
  return sum;
}

/**
 * Hours-weighted dashboard KPIs over current + next fiscal quarter using
 * blended actuals/forecast weekly data (WFM.16 window).
 * @param {Object} params same shape as computeUtilization
 * @return {Object}
 */
function computeBlendedWindowKpis_(params) {
  params = dashboardKpiFilterParams_(params);
  const forecast = computeWeeklyForecast_(params);
  const visibleWeeks = (typeof _deriveVisibleWeeksFiscal_ === 'function')
    ? _deriveVisibleWeeksFiscal_(forecast.weeks)
    : forecast.weeks;
  const rawCapacity = Number(forecast.rawCapacity) || readRawCapacity_();
  const holidayHoursByWeek = forecast.holidayHoursByWeek || {};

  let totalProductive = 0;
  let totalIcpAvailable = 0;
  let totalRawCapacity = 0;
  const overUtilized = [];
  const underUtilized = [];

  forecast.workers.forEach(function (w) {
    let wProd = 0;
    let wIcpAvail = 0;
    let wRawCap = 0;
    visibleWeeks.forEach(function (vw) {
      const wk = vw.week_key;
      const prod = productiveHoursForWeek_(w, wk);
      const holidayHrs = Number(holidayHoursByWeek[wk] || 0);
      const icpAvail = rawCapacity - holidayHrs;
      wProd += prod;
      wIcpAvail += icpAvail;
      wRawCap += rawCapacity;
      totalProductive += prod;
      totalIcpAvailable += icpAvail;
      totalRawCapacity += rawCapacity;
    });
    if (!wIcpAvail) return;
    const icpUtil = wProd / wIcpAvail;
    const icpTarget = Number(w.icpTarget) || 0;
    const ratio = icpTarget > 0 ? icpUtil / icpTarget : 0;
    if (ratio > 1.05) overUtilized.push({ name: w.resource, avgUtil: icpUtil, ratioToTarget: ratio });
    else if (ratio < 0.75) underUtilized.push({ name: w.resource, avgUtil: icpUtil, ratioToTarget: ratio });
  });

  const windowLabel = blendedFiscalWindowLabel_();
  const scenarioDemandHours = sumScenarioDemandHoursInWindow_(params, visibleWeeks, forecast.workers);
  return {
    avgIcpProductiveUtilization: totalIcpAvailable > 0 ? totalProductive / totalIcpAvailable : 0,
    avgFinancialUtilization: totalRawCapacity > 0 ? totalProductive / totalRawCapacity : 0,
    totalProductiveHours: totalProductive,
    totalIcpAvailableHours: totalIcpAvailable,
    totalRawCapacityHours: totalRawCapacity,
    scenarioDemandHours: scenarioDemandHours,
    overUtilized: overUtilized,
    underUtilized: underUtilized,
    overUtilizedCount: overUtilized.length,
    underUtilizedCount: underUtilized.length,
    windowLabel: windowLabel,
    headcount: forecast.workers.length
  };
}

/**
 * Per-request index of Committed Opportunity_Assignment hours by resource and
 * fiscal quarter. Reads getEnrichedAssignments_() once and expands each
 * committed assignment once; plain per-execution memo.
 * @param {Object} [calendar] from readCalendar_()
 * @return {Object<string, Object<string, number>>} resource_name → { quarterKey → hours }
 */
function committedAssignmentQuarterIndex_(calendar) {
  if (_committedAsgIdxMemo_) return _committedAsgIdxMemo_;
  calendar = calendar || readCalendar_();
  var assignsRaw = [];
  try {
    assignsRaw = (typeof getEnrichedAssignments_ === 'function')
      ? getEnrichedAssignments_() : cachedRead_(ASSIGNMENTS);
  } catch (e) {
    assignsRaw = [];
  }
  var idx = {};
  assignsRaw.forEach(function (a) {
    if (String(a.status || '') !== 'Committed') return;
    var res = a.resource_name;
    if (!res) return;
    expandAssignmentToWeekly_(a, calendar).forEach(function (w) {
      var qk = fiscalQuarterKey_(w.week_start);
      if (!qk) return;
      if (!idx[res]) idx[res] = {};
      idx[res][qk] = (idx[res][qk] || 0) + (Number(w.hours) || 0);
    });
  });
  _committedAsgIdxMemo_ = idx;
  return idx;
}

/**
 * Sum Committed Opportunity_Assignment hours for one worker in a fiscal quarter.
 * O(1) lookup into committedAssignmentQuarterIndex_; does not mutate data.
 * @param {string} resourceName
 * @param {string} quarterKey
 * @param {Object} [calendar] from readCalendar_()
 * @return {number}
 */
function committedAssignmentHoursForQuarter_(resourceName, quarterKey, calendar) {
  if (!resourceName || !quarterKey) return 0;
  var idx = committedAssignmentQuarterIndex_(calendar);
  var byQ = idx && idx[resourceName];
  return (byQ && Number(byQ[quarterKey])) || 0;
}

/**
 * Clone worker weekly maps before any Capacity_Adjustment deltas (add or reduce).
 * Restores productive/worker weekly from projects['Capacity Adjustment'] so
 * committed reductions can be re-expanded with the same sequential clamp.
 * @param {Object} worker computeWeeklyForecast_ worker row
 * @return {Object}
 */
function _workerPreCapacityAdjustmentSnapshot_(worker) {
  var capAdj = (worker.projects && worker.projects['Capacity Adjustment']) || {};
  var prod = Object.assign({}, worker.productiveWeekly || {});
  var wkMap = Object.assign({}, worker.workerWeekly || {});
  Object.keys(capAdj).forEach(function (weekKey) {
    var delta = Number(capAdj[weekKey]) || 0;
    if (!delta) return;
    prod[weekKey] = (Number(prod[weekKey]) || 0) - delta;
    wkMap[weekKey] = (Number(wkMap[weekKey]) || 0) - delta;
  });
  return {
    employeeId: worker.employeeId,
    productiveWeekly: prod,
    workerWeekly: wkMap,
    projects: JSON.parse(JSON.stringify(worker.projects || {})),
    blendedWeekly: JSON.parse(JSON.stringify(worker.blendedWeekly || {}))
  };
}

/**
 * Per-request index of Committed Capacity_Adjustments by resource (sheet order).
 * Includes add and reduce rows so sequential clamp matches computeWeeklyForecast_.
 * @param {Object} [calendar] from readCalendar_()
 * @return {Object<string, Array<Object>>} resource_name → committed adjustments
 */
function committedReductionQuarterIndex_(calendar) {
  if (_committedReductionIdxMemo_) return _committedReductionIdxMemo_;
  calendar = calendar || readCalendar_();
  var idx = {};
  var adjRows = [];
  try {
    adjRows = cachedRead_(CAPACITY_ADJUSTMENTS_SHEET);
  } catch (e) {
    adjRows = [];
  }
  adjRows.forEach(function (adj) {
    if (String(adj.status || '') !== 'Committed') return;
    var res = adj.resource_name;
    if (!res) return;
    if (!idx[res]) idx[res] = [];
    idx[res].push(adj);
  });
  _committedReductionIdxMemo_ = idx;
  return idx;
}

/**
 * Sum Committed capacity-reduction hours for one worker in a fiscal quarter,
 * zero-clamped to forecast-remaining productive hours (never actualized D8 weeks).
 * Replays committed adjustments in sheet order on the pre-adjustment weekly basis.
 * @param {Object} worker computeWeeklyForecast_ worker row
 * @param {string} quarterKey
 * @param {Object} [calendar] from readCalendar_()
 * @return {number}
 */
function committedReductionHoursForQuarter_(worker, quarterKey, calendar) {
  if (!worker || !worker.resource || !quarterKey) return 0;
  calendar = calendar || readCalendar_();
  var adjs = committedReductionQuarterIndex_(calendar)[worker.resource];
  if (!adjs || !adjs.length) return 0;
  var snap = _workerPreCapacityAdjustmentSnapshot_(worker);
  var total = 0;
  adjs.forEach(function (adj) {
    var result = expandClampedAdjustmentWeekly_(snap, adj, calendar, true);
    if (String(adj.direction || 'reduce') !== 'reduce') return;
    result.weeks.forEach(function (w) {
      if (fiscalQuarterKey_(w.week_start) !== quarterKey) return;
      var hrs = Number(w.hours_reduction) || 0;
      if (hrs > 0) total += hrs;
    });
  });
  return total;
}

function buildWorkerQuarters_(worker, quarterKeys, weeks, holidays, actualsSummary, settings, curQ) {
  const calendar = readCalendar_();
  committedAssignmentQuarterIndex_(calendar);
  _wowQuarterTargetIndex_();
  return quarterKeys.map(function (qk) {
    const wd = quarterWorkdaySummary_(qk, holidays);
    const isCurrent = (qk === curQ);
    const appTarget = quarterTargetHoursFor_(worker.icpRole, worker.jobProfile, qk, holidays, settings);
    let productiveHours = 0;
    let targetHours = appTarget;
    let bonusAttainment = null;
    let source = 'forecast';
    let icpUtil = null;
    let stale = false;
    let committedAssignmentHours = 0;

    const wowTarget = quarterTargetFromWoW_(worker.employeeId, qk);
    const hasWowTarget = wowTarget != null && wowTarget > 0;
    if (hasWowTarget) targetHours = wowTarget;

    // WFM.25: icpUtil = numerator / target_hours for every quarter.
    // Previous: qtd_actual_icp / target_hours; Current+Next: qtd_icp_plus_forecast / target_hours.
    // When Utilization_Quarterly is present, use WoW fields verbatim — never Actuals_Worker_Summary.
    const cmp = compareFiscalQuarterKeys_(qk, curQ);
    if (cmp < 0) {
      const wowActual = quarterActualIcpFromWoW_(worker.employeeId, qk);
      productiveHours = wowActual != null ? wowActual : 0;
      source = 'actuals';
      stale = wowActual == null;
    } else {
      const wowForecast = quarterForecastIcpFromWoW_(worker.employeeId, qk);
      if (wowForecast != null && hasWowTarget) {
        productiveHours = wowForecast;
        source = isCurrent ? 'actuals_plus_forecast' : 'forecast';
      } else {
        committedAssignmentHours = committedAssignmentHoursForQuarter_(worker.resource, qk, calendar);
        productiveHours = (wowForecast != null ? wowForecast :
          sumForecastProductiveForQuarter_(worker, qk, weeks)) + committedAssignmentHours;
        source = isCurrent ? 'actuals_plus_forecast' : 'forecast';
        stale = !hasWowTarget || wowForecast == null;
      }
    }

    if (targetHours > 0) {
      bonusAttainment = productiveHours / targetHours;
      icpUtil = bonusAttainment;
    }

    const financeUtil = wd.rawCapacityHours > 0 ? productiveHours / wd.rawCapacityHours : 0;
    const icpTarget = Number(worker.icpTarget) || 0;
    const ratioToTarget = (icpTarget > 0 && icpUtil != null) ? icpUtil / icpTarget : 0;
    const trackingHours = productiveHours - targetHours;

    return {
      quarterKey: qk,
      quarterLabel: qk,
      isCurrentQuarter: isCurrent,
      productiveHours: Number(productiveHours) || 0,
      rawCapacityHours: wd.rawCapacityHours,
      icpAvailableHours: wd.icpAvailableHours,
      targetHours: Number(targetHours) || 0,
      appTargetHours: Number(appTarget) || 0,
      trackingHours: Number(trackingHours) || 0,
      icpUtil: icpUtil,
      financeUtil: Number(financeUtil) || 0,
      ratioToTarget: Number(ratioToTarget) || 0,
      bonusAttainment: bonusAttainment,
      source: source,
      stale: !!stale,
      committedAssignmentHours: Number(committedAssignmentHours) || 0
    };
  });
}

/**
 * Team quarterly scorecard: three-quarter planning window per worker plus
 * hours-weighted team summaries.
 * @param {Object} params same shape as computeUtilization
 * @return {Object}
 */
function computeQuarterlyScorecard_(params) {
  params = params || {};
  const settings = readSettings_();
  const holidays = readHolidays_();
  const forecast = computeWeeklyForecast_(params);
  const actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
    ? getActualsSummaryByEmployee_() : {};
  const curQ = fiscalQuarterKey_(new Date());
  const quarterKeys = scorecardWindowKeys_();
  const weeks = forecast.weeks || [];

  const workersOut = forecast.workers.map(function (w) {
    const quarters = buildWorkerQuarters_(w, quarterKeys, weeks, holidays, actualsSummary, settings, curQ);

    return {
      employeeId: String(w.employeeId || ''),
      worker: String(w.resource),
      manager: String(w.managerOrg || ''),
      teamLabel: String(w.teamLabel || ''),
      icpRole: String(w.icpRole || ''),
      level: String(w.level || ''),
      icpTarget: Number(w.icpTarget) || 0,
      quarters: quarters
    };
  });

  const teamSummary = quarterKeys.map(function (qk, qi) {
    let sumProd = 0, sumIcpAvail = 0, sumRawCap = 0, sumTarget = 0, sumTracking = 0;
    let sumUtilProd = 0, sumUtilTarget = 0;
    workersOut.forEach(function (wr) {
      const q = wr.quarters[qi];
      if (!q) return;
      sumProd += q.productiveHours;
      sumIcpAvail += q.icpAvailableHours;
      sumRawCap += q.rawCapacityHours;
      sumTarget += q.targetHours;
      sumTracking += q.trackingHours;
      if (q.targetHours > 0) {
        sumUtilProd += q.productiveHours;
        sumUtilTarget += q.targetHours;
      }
    });
    const targetUtil = sumUtilTarget > 0 ? sumUtilProd / sumUtilTarget : 0;
    return {
      quarterKey: qk,
      quarterLabel: qk,
      isCurrentQuarter: qk === curQ,
      icpUtil: targetUtil,
      financeUtil: sumRawCap > 0 ? sumProd / sumRawCap : 0,
      bonusAttainment: targetUtil,
      trackingHours: sumTracking,
      productiveHours: sumProd,
      targetHours: sumTarget
    };
  });

  return {
    quarterKeys: quarterKeys,
    workers: workersOut,
    teamSummary: teamSummary,
    windowLabel: blendedFiscalWindowLabel_()
  };
}
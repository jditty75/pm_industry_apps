// ============================================================
// Diagnostics.gs — investigative tools for administrators
//
// All functions here are intended to be run from the Apps Script
// editor (function dropdown → Run), not from the web app UI.
// They write to Logger.log so View → Logs shows the output.
//
// Organized by concern:
//   1. Config & data hygiene
//   2. Reconciliation checks
//   3. KPI sanity checks
//   4. Deep-dive diagnostics
//
// Adding a new diagnostic? Keep it here. Don't scatter debug code
// across Api.gs or Engine.gs.
// ============================================================


// ============================================================
// 1. CONFIG & DATA HYGIENE
// ============================================================

/**
 * Dump the full Config_Resource_Type map (resource_type → team_label).
 * Run when you want to verify the mapping is being read correctly.
 */
function debugConfigResourceType() {
  const m = readConfigResourceType_();
  Logger.log('Config_Resource_Type entries: ' + Object.keys(m).length);
  Logger.log(JSON.stringify(m, null, 2));
}

/**
 * For External rows that couldn't be classified into a team,
 * show the top role_category | resource_type signatures that are
 * missing from Config_Resource_Type. Use to drive sheet edits.
 */
function debugWhyUnclassified() {
  const rtMap = readConfigResourceType_();
  Logger.log('Config_Resource_Type key count: ' + Object.keys(rtMap).length);
  const rows = readTable_(ALLOC_NORM);
  let hits = 0, misses = 0;
  const missSamples = {};
  rows.forEach(r => {
    if (String(r.worker_class || '').indexOf('External_') !== 0) return;
    const team = _classifyTeam_(r, rtMap);
    if (team === 'Unclassified') {
      misses += 1;
      const sig = (r.role_category || '(blank)') + ' | ' + (r.resource_type || '(blank)');
      missSamples[sig] = (missSamples[sig] || 0) + (Number(r.hours) || 0);
    } else hits += 1;
  });
  Logger.log('External rows: hits=' + hits + ', misses=' + misses);
  Logger.log('Top miss signatures: ' + JSON.stringify(
    Object.keys(missSamples)
      .sort((a, b) => missSamples[b] - missSamples[a])
      .slice(0, 10)
      .map(k => ({ sig: k, hours: missSamples[k] }))
  ));
}

/**
 * List SLG workers (SLG_Real or SLG_Generic) whose ICP_role is blank
 * OR whose ICP_role isn't mapped to a team_label in Config_Roles.
 *
 * These workers fall into "Unclassified" in the Headcount Gap KPI,
 * which is visible in the UI as a warn-tinted row. Use this diagnostic
 * to identify what to fix:
 *   - Worker has no ICP_role → either fix in PSA at ingest, or
 *     exclude via Config_Worker_Exclusions.
 *   - Worker has ICP_role but it's not in Config_Roles → add the role
 *     with appropriate team_label in Config_Roles.
 *
 * Output: per-worker line with name, ICP_role (if any), worker_class,
 * manager_org, and total hours in the current planning window.
 */
function debugUnclassifiedSlgWorkers() {
  const windowMonths = (typeof readPlanningWindowMonths_ === 'function')
    ? readPlanningWindowMonths_()
    : 6;
  const planningWindow = buildPlanningWindow_(windowMonths);
  const planningMonthKeys = planningWindow.monthKeys;

  const roleTeamLabels = (typeof readRoleTeamLabels_ === 'function')
    ? readRoleTeamLabels_()
    : {};
  const excluded = (typeof readExclusions_ === 'function')
    ? readExclusions_()
    : new Set();

  const rows = readTable_(ALLOC_NORM);
  const blankRole = {};       // resource_name → { class, mgr, hours, monthsSeen }
  const unmappedRole = {};    // resource_name → { role, class, mgr, hours, monthsSeen }

  function _trackInto_(map, key, info, hours, mk) {
    if (!map[key]) {
      map[key] = {
        name: info.name,
        role: info.role || '',
        worker_class: info.worker_class || '',
        manager_org: info.manager_org || '',
        totalHours: 0,
        monthsSeen: {}
      };
    }
    map[key].totalHours += hours;
    if (mk) map[key].monthsSeen[mk] = true;
  }

  rows.forEach(r => {
    const wc = String(r.worker_class || '');
    if (wc !== 'SLG_Real' && wc !== 'SLG_Generic') return;

    const name = r.resource_name;
    if (!name) return;
    if (excluded.has(name)) return;

    // Only count hours in the planning window for the totals
    const mk = (function () {
      if (!r.period_start) return '';
      const dt = (r.period_start instanceof Date) ? r.period_start : new Date(r.period_start);
      if (isNaN(dt.getTime())) return '';
      return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
    })();
    const inWindow = !!planningMonthKeys[mk];

    const hours = Number(r.hours) || 0;
    const inWindowHours = inWindow ? hours : 0;

    const role = String(r.ICP_role || '').trim();
    const info = {
      name: name,
      role: role,
      worker_class: wc,
      manager_org: r.manager_org || ''
    };

    if (!role) {
      _trackInto_(blankRole, name, info, inWindowHours, inWindow ? mk : '');
    } else if (!roleTeamLabels[role]) {
      _trackInto_(unmappedRole, name, info, inWindowHours, inWindow ? mk : '');
    }
  });

  Logger.log('--- Unclassified SLG workers diagnostic ---');
  Logger.log('Planning window: ' + windowMonths + ' months');
  Logger.log('Config_Roles team_label map: ' + JSON.stringify(roleTeamLabels));

  Logger.log('');
  Logger.log('A. SLG workers with BLANK ICP_role:');
  const blankList = Object.values(blankRole).sort((a, b) => b.totalHours - a.totalHours);
  Logger.log('  Count: ' + blankList.length);
  if (blankList.length === 0) {
    Logger.log('  (none — clean)');
  } else {
    blankList.forEach(w => {
      Logger.log(
        '  ' + w.name +
        '  [class=' + w.worker_class + ']' +
        '  [mgr=' + w.manager_org + ']' +
        '  [hours in window=' + Math.round(w.totalHours) + ']' +
        '  [months=' + Object.keys(w.monthsSeen).length + ']'
      );
    });
  }

  Logger.log('');
  Logger.log('B. SLG workers whose ICP_role is NOT in Config_Roles team_label map:');
  const unmappedList = Object.values(unmappedRole).sort((a, b) => b.totalHours - a.totalHours);
  Logger.log('  Count: ' + unmappedList.length);
  if (unmappedList.length === 0) {
    Logger.log('  (none — clean)');
  } else {
    // Roll up by ICP_role for the summary
    const byRole = {};
    unmappedList.forEach(w => {
      const k = w.role || '(blank)';
      byRole[k] = (byRole[k] || 0) + 1;
    });
    Logger.log('  Unmapped roles seen: ' + JSON.stringify(byRole));
    unmappedList.forEach(w => {
      Logger.log(
        '  ' + w.name +
        '  [role=' + w.role + ']' +
        '  [class=' + w.worker_class + ']' +
        '  [mgr=' + w.manager_org + ']' +
        '  [hours in window=' + Math.round(w.totalHours) + ']'
      );
    });
  }

  Logger.log('');
  Logger.log('How to fix:');
  Logger.log('  A. Blank ICP_role: either fix the worker in PSA so ingest assigns one,');
  Logger.log('     OR add them to Config_Worker_Exclusions if they should not be in scope.');
  Logger.log('  B. Unmapped role: add a row to Config_Roles with the role and team_label.');
}

/**
 * Surface SLG workers whose ICP-derived team does NOT match their SLG
 * Manager's dominant team. These are candidates for entries in
 * Config_Worker_Role_Overrides.
 *
 * The classic case is workers who transferred between SLG teams (low
 * friction org move) without their Workday Job Profile being updated
 * (high friction). PSA classifies them by Job Profile + Resource Type,
 * which now disagrees with where their work actually belongs.
 *
 * Three categories surfaced:
 *
 *   A. MISMATCH — worker has ICP, ICP-team differs from manager-team.
 *      True override candidates (the Phil Dessaigne pattern).
 *
 *   B. UNCLASSIFIED — worker under SLG manager, blank or unmapped ICP.
 *      Bench/data hygiene; investigate the ingest classifier or
 *      add to Config_Worker_Exclusions. NOT an override case.
 *
 *   C. ALREADY OVERRIDDEN — worker in Config_Worker_Role_Overrides.
 *      Informational; confirms overrides are in effect.
 *
 * Excludes workers who are themselves SLG managers (managers don't
 * get ICP roles by design — their Job Profile is "M4 Sr Manager...").
 *
 * Manager team is derived from the data: each manager's "team" is the
 * dominant team_label among their reports, using >= 70% threshold on
 * the non-Unclassified denominator. Managers with no clear dominant
 * team (e.g., Windsel McCray, top-level) are marked Mixed and their
 * reports are excluded from mismatch detection.
 *
 * Run from the Apps Script editor function dropdown after each PSA
 * upload to surface new candidates as the org evolves.
 */
function debugSlgWorkerTeamMismatches() {
  Logger.log('--- debugSlgWorkerTeamMismatches ---');

  const rows = readTable_(ALLOC_NORM);
  const roleTeamLabels = (typeof readRoleTeamLabels_ === 'function')
    ? readRoleTeamLabels_() : {};
  const overrides = (typeof readWorkerRoleOverrides_ === 'function')
    ? readWorkerRoleOverrides_() : {};
  const excluded = (typeof readExclusions_ === 'function')
    ? readExclusions_() : new Set();

  // Build manager-name set so we can exclude managers from the analysis.
  const mgrNamesNormalized = {};
  try {
    if (typeof readConfigSlgManagers_ === 'function') {
      readConfigSlgManagers_().forEach(function (m) {
        const raw = m.manager_name || '';
        const norm = (typeof normalizeManagerName_ === 'function')
          ? normalizeManagerName_(raw)
          : String(raw).trim();
        if (norm) mgrNamesNormalized[norm.toLowerCase()] = true;
      });
    }
  } catch (e) { /* tolerate missing config */ }

  // Per-worker canonical record: which manager, which ICP role.
  const workerInfo = {};
  rows.forEach(function (r) {
    const wc = String(r.worker_class || '');
    if (wc !== 'SLG_Real' && wc !== 'SLG_Generic') return;
    const name = String(r.resource_name || '').trim();
    if (!name) return;
    if (excluded.has(name)) return;
    if (!workerInfo[name]) {
      workerInfo[name] = {
        name: name,
        worker_class: wc,
        manager_org: String(r.manager_org || '').trim(),
        icp_role: String(r.ICP_role || '').trim(),
        job_profile: String(r.job_profile || '').trim(),
        resource_type: String(r.resource_type || '').trim()
      };
    }
  });

  // Derive each manager's team from the dominant ICP-team among their reports.
  // Threshold: >= 70% of non-Unclassified reports must agree on one team.
  const managerTeamCounts = {};
  Object.values(workerInfo).forEach(function (w) {
    const mgr = w.manager_org;
    if (!mgr) return;
    const team = roleTeamLabels[w.icp_role] || 'Unclassified';
    if (!managerTeamCounts[mgr]) managerTeamCounts[mgr] = {};
    managerTeamCounts[mgr][team] = (managerTeamCounts[mgr][team] || 0) + 1;
  });

  const managerTeam = {};
  Object.keys(managerTeamCounts).forEach(function (mgr) {
    const counts = managerTeamCounts[mgr];
    let classified = 0;
    Object.keys(counts).forEach(function (t) {
      if (t !== 'Unclassified') classified += counts[t];
    });
    if (classified === 0) {
      managerTeam[mgr] = 'Mixed';  // all reports unclassified — can't infer
      return;
    }
    let bestTeam = null, bestCount = 0;
    Object.keys(counts).forEach(function (t) {
      if (t === 'Unclassified') return;
      if (counts[t] > bestCount) { bestCount = counts[t]; bestTeam = t; }
    });
    const pct = bestCount / classified;
    managerTeam[mgr] = (pct >= 0.70) ? bestTeam : 'Mixed';
  });

  Logger.log('');
  Logger.log('Manager team derivation (from dominant ICP among reports):');
  Object.keys(managerTeam).sort().forEach(function (mgr) {
    const breakdown = JSON.stringify(managerTeamCounts[mgr]);
    Logger.log('  ' + mgr + ' -> ' + managerTeam[mgr] + ' ' + breakdown);
  });

  // Categorize each non-manager SLG worker.
  const catA = [];   // true mismatch
  const catB = [];   // unclassified
  const catC = [];   // already overridden

  Object.values(workerInfo).forEach(function (w) {
    // Skip workers who are themselves SLG managers
    if (mgrNamesNormalized[w.name.toLowerCase()]) return;

    const mgrTeam = managerTeam[w.manager_org];
    // Skip workers whose manager couldn't be team-classified
    if (!mgrTeam || mgrTeam === 'Mixed') return;

    const workerTeam = roleTeamLabels[w.icp_role] || 'Unclassified';
    const isOverridden = !!overrides[w.name.toLowerCase()];

    if (isOverridden) {
      catC.push({
        worker: w,
        manager_team: mgrTeam,
        worker_team: workerTeam,
        override_role: overrides[w.name.toLowerCase()]
      });
    } else if (workerTeam === 'Unclassified') {
      catB.push({ worker: w, manager_team: mgrTeam });
    } else if (workerTeam !== mgrTeam) {
      catA.push({ worker: w, manager_team: mgrTeam, worker_team: workerTeam });
    }
  });

  Logger.log('');
  Logger.log('============================================================');
  Logger.log('CATEGORY A — TRUE OVERRIDE CANDIDATES (mismatch, no override yet)');
  Logger.log('============================================================');
  Logger.log('Count: ' + catA.length);
  if (catA.length === 0) {
    Logger.log('  (none — clean)');
  } else {
    catA.forEach(function (c) {
      Logger.log(
        '  ' + c.worker.name +
        ' | mgr=' + c.worker.manager_org +
        ' (' + c.manager_team + ')' +
        ' | icp=' + c.worker.icp_role +
        ' (' + c.worker_team + ')' +
        ' | jp=' + c.worker.job_profile +
        ' | rt=' + c.worker.resource_type
      );
    });
    Logger.log('');
    Logger.log('To fix: add a row to Config_Worker_Role_Overrides with the');
    Logger.log('worker name and the correct ICP role for their manager\'s team.');
  }

  Logger.log('');
  Logger.log('============================================================');
  Logger.log('CATEGORY B — UNCLASSIFIED (bench/data hygiene, not override)');
  Logger.log('============================================================');
  Logger.log('Count: ' + catB.length);
  if (catB.length === 0) {
    Logger.log('  (none — clean)');
  } else {
    catB.forEach(function (c) {
      Logger.log(
        '  ' + c.worker.name +
        ' | mgr=' + c.worker.manager_org +
        ' (' + c.manager_team + ')' +
        ' | icp=(blank)' +
        ' | jp=' + c.worker.job_profile +
        ' | rt=' + c.worker.resource_type
      );
    });
    Logger.log('');
    Logger.log('These are bench workers or new hires whose PSA data hasn\'t');
    Logger.log('caught up. Investigate via classifyIcpRole_ in Ingest.gs or');
    Logger.log('exclude via Config_Worker_Exclusions if appropriate.');
  }

  Logger.log('');
  Logger.log('============================================================');
  Logger.log('CATEGORY C — ALREADY OVERRIDDEN (informational)');
  Logger.log('============================================================');
  Logger.log('Count: ' + catC.length);
  if (catC.length === 0) {
    Logger.log('  (no active overrides in Config_Worker_Role_Overrides)');
  } else {
    catC.forEach(function (c) {
      Logger.log(
        '  ' + c.worker.name +
        ' | mgr=' + c.worker.manager_org +
        ' (' + c.manager_team + ')' +
        ' | override -> ' + c.override_role +
        ' (' + c.worker_team + ')'
      );
    });
  }

  Logger.log('');
  Logger.log('============================================================');
  Logger.log('Summary: ' + catA.length + ' new candidates, ' +
    catB.length + ' unclassified, ' + catC.length + ' active overrides');
  Logger.log('============================================================');
}

// ============================================================
// 2. RECONCILIATION CHECKS
// ============================================================

/**
 * Run api_getReportingSummary with default scope and confirm
 * the four reconciliation invariants hold (team / account /
 * worker class sums equal the headline total).
 *
 * Also surfaces the externalHoursByPracticeOwnership value so
 * you can see how much External work is being attributed via
 * practice ownership under any given filter combination.
 */
function debugReportingSummaryReconciliation() {
  const r = api_getReportingSummary({
    workerScope: 'All',
    viewMode:    'Committed'
  });
  Logger.log('totalHours:                       ' + r.totals.totalHours);
  Logger.log('teamSum:                          ' + r.totals.reconciliationDetail.teamSum);
  Logger.log('accountSum:                       ' + r.totals.reconciliationDetail.accountSum);
  Logger.log('workerClassSum:                   ' + r.totals.reconciliationDetail.workerClassSum);
  Logger.log('externalHoursByPracticeOwnership: ' + r.totals.externalHoursByPracticeOwnership);
  Logger.log('checks: ' + JSON.stringify(r.totals.reconciliationDetail.checks));
  Logger.log('reconcileOk: ' + r.totals.reconcileOk);
}


// ============================================================
// 3. KPI SANITY CHECKS
// ============================================================

/**
 * Confirm the SLG Headcount Gap KPI is producing reasonable per-team
 * numbers at default filters. Run this whenever you've changed
 * Config_Roles, Config_Settings.planning_window_months, or any
 * other input that should affect the KPI.
 */
function sanityCheckHeadcountByTeam() {
  const d = api_getDashboard({
    viewMode:          'Committed',
    groupBy:           'Function',
    workerScope:       'All',
    includeMyManagers: false,
    teams:             null,
    quarter:           null,
    includeTimeOff:    false
  });
  Logger.log('rows: ' + (d.headcountByTeam || []).length);
  Logger.log('planningWindowMonths: ' + d.planningWindowMonths);
  (d.headcountByTeam || []).forEach(r => Logger.log(JSON.stringify({
    team:           r.team,
    capacityFte:    r.capacityFte,
    peakDemandFte:  r.peakDemandFte,
    peakUtil:       r.peakUtil,
    peakGap:        r.peakGap,
    peakMonth:      r.peakMonth,
    suggestedHeads: r.suggestedHeads
  })));
}

/**
 * Verify the configurable planning window is flowing through every
 * place that should respect it: Engine, Api, and api_getReference.
 * Useful after changing Config_Settings.planning_window_months.
 */
function sanityCheckPlanningWindow() {
  Logger.log('readPlanningWindowMonths_(): ' + readPlanningWindowMonths_());

  const ref = api_getReference();
  Logger.log('api_getReference().planningWindowMonths: ' + ref.planningWindowMonths);

  const dash = api_getDashboard({
    viewMode: 'Committed', groupBy: 'Function', workerScope: 'All',
    includeMyManagers: false, teams: null, quarter: null, includeTimeOff: false
  });
  Logger.log('api_getDashboard().planningWindowMonths: ' + dash.planningWindowMonths);

  Logger.log('headcountByTeam sample:');
  (dash.headcountByTeam || []).slice(0, 3).forEach(r => {
    Logger.log('  ' + r.team + ': monthsInScope=' + r.monthsInScope +
               ', monthly.length=' + (r.monthly || []).length +
               ', peakMonth=' + r.peakMonth);
  });
}


// ============================================================
// 4. DEEP-DIVE DIAGNOSTICS
// ============================================================

/**
 * Per-role drill-down of the SLG headcount math.
 *
 * Run via a wrapper like:
 *   function dbgEM()  { debugRoleHeadcount('EM'); }
 *   function dbgPD()  { debugRoleHeadcount('PD'); }
 *   function dbgDA()  { debugRoleHeadcount('DA'); }
 *   function dbgFunc(){ debugRoleHeadcount('CS_FUNC'); }
 *   function dbgTech(){ debugRoleHeadcount('CS_TECH'); }
 *
 * Lists each SLG worker contributing to the role, per-month capacity,
 * committed, time off, used, available. Also produces peak and average
 * summaries. Use this whenever an Unclassified or surprising value
 * shows up on the Headcount Gap card to see exactly which workers and
 * months are driving it.
 */
function debugRoleHeadcount(roleKey, paramsOverride) {
  roleKey = roleKey || 'EM';
  const params = Object.assign({
    viewMode:          'Committed',
    groupBy:           'Function',
    workerScope:       'All',
    includeMyManagers: false,
    teams:             null,
    quarter:           null,
    includeTimeOff:    false
  }, paramsOverride || {});

  Logger.log('--- debugRoleHeadcount(' + roleKey + ') ---');
  Logger.log('Params: ' + JSON.stringify(params));

  const settings = readSettings_();
  const hideAllExternal = String(settings['hide_all_external'] || '')
    .trim().toLowerCase() === 'true';

  const mgrRows = readConfigSlgManagers_();
  const managerDescendants = buildManagerDescendants_(mgrRows);
  const managersByName = {};
  mgrRows.forEach(function(r) { managersByName[r.manager_name] = r; });

  const selectedManager = (params.teams && params.teams.length)
    ? params.teams[0] : null;
  const effectiveManagers = buildEffectiveManagers_(
    selectedManager,
    !!params.includeMyManagers,
    managersByName,
    managerDescendants
  );

  const allocRaw   = cachedRead_(ALLOC_NORM);
  const assignsRaw = cachedRead_(ASSIGNMENTS);
  const excluded   = readExclusions_();
  const resIndex   = _resourceIndex_(allocRaw);
  const calendar   = readCalendar_();
  const roleCap    = readRoleCapacity_();

  const windowMonths = readPlanningWindowMonths_();
  const planningWindow = buildPlanningWindow_(windowMonths);
  const windowKeys = planningWindow.monthKeys;
  const monthsList = planningWindow.monthsList;

  const slgInRole = {};
  allocRaw.forEach(function (a) {
    if (!a.resource_name) return;
    if (excluded.has(a.resource_name)) return;
    const info = resIndex[a.resource_name] || {};
    const wc = String(info.worker_class || '');
    if (wc !== 'SLG_Real' && wc !== 'SLG_Generic') return;
    if (effectiveManagers) {
      const mgrNorm = normalizeManagerName_(info.manager_org || '');
      if (!effectiveManagers[mgrNorm]) return;
    }
    const workerRole = info.icp || info.resource_type || 'Unclassified';
    if (workerRole !== roleKey) return;
    slgInRole[a.resource_name] = true;
  });

  try {
    readGenericResources_().forEach(function (g) {
      if (!g.name) return;
      if (excluded.has(g.name)) return;
      const info = resIndex[g.name] || {};
      const workerRole = (info.icp || info.resource_type || g.resource_type || 'Unclassified');
      if (workerRole !== roleKey) return;
      slgInRole[g.name] = true;
    });
  } catch (e) {}

  const workerNames = Object.keys(slgInRole).sort();
  Logger.log('SLG workers contributing to role "' + roleKey + '": ' + workerNames.length);
  workerNames.forEach(function (n) { Logger.log('  - ' + n); });

  const workerMonthMap = {};
  workerNames.forEach(function (name) {
    workerMonthMap[name] = {};
    monthsList.forEach(function (mk) {
      const info = resIndex[name] || {};
      const cap = roleCap[info.icp] || roleCap[info.resource_type] || 160;
      workerMonthMap[name][mk] = { committed: 0, timeOff: 0, capacity: cap };
    });
  });

  allocRaw.forEach(function (a) {
    if (!a.resource_name) return;
    if (workerNames.indexOf(a.resource_name) < 0) return;
    if (!a.period_start) return;
    const mk = monthKey_(a.period_start);
    if (!windowKeys[mk]) return;
    const m = workerMonthMap[a.resource_name][mk];
    if (!m) return;
    const h = Number(a.hours) || 0;
    if (a.allocation_type === 'PTO_Holiday') {
      m.timeOff += h;
    } else if (a.allocation_type === 'Education' ||
               a.allocation_type === 'Billable' ||
               a.allocation_type === 'Internal' ||
               a.allocation_type === 'Unassigned') {
      m.committed += h;
    } else {
      m.committed += h;
    }
  });

  if (params.viewMode !== 'Actual') {
    assignsRaw.forEach(function (a) {
      if (!a.resource_name) return;
      if (workerNames.indexOf(a.resource_name) < 0) return;
      const isCommitted = (a.status === 'Committed');
      const isScenario = (a.status === 'Modeled');
      const include = isCommitted ||
        (params.viewMode === 'Scenario' && isScenario &&
         (!params.scenarioId || a.scenario_id === params.scenarioId));
      if (!include) return;
      expandAssignmentToMonthly_(a, calendar).forEach(function (m) {
        const mk = monthKey_(m.period_start);
        if (!windowKeys[mk]) return;
        const entry = workerMonthMap[a.resource_name][mk];
        if (!entry) return;
        entry.committed += m.hours;
      });
    });
  }

  Logger.log('\n--- Per-worker per-month detail ---');
  workerNames.forEach(function (name) {
    Logger.log('Worker: ' + name);
    monthsList.forEach(function (mk) {
      const m = workerMonthMap[name][mk];
      const usedHrs = params.includeTimeOff ? (m.committed + m.timeOff) : m.committed;
      Logger.log('  ' + mk +
        ' | cap=' + m.capacity +
        ' | committed=' + Math.round(m.committed) +
        ' | timeOff=' + Math.round(m.timeOff) +
        ' | used=' + Math.round(usedHrs) +
        ' | avail=' + Math.max(0, m.capacity - usedHrs));
    });
  });

  Logger.log('\n--- Per-month role totals (role = ' + roleKey + ') ---');
  Logger.log('Month     | CapHrs | UsedHrs | AvailHrs | CapFTE | UsedFTE | AvailFTE');
  const perMonth = [];
  monthsList.forEach(function (mk) {
    let capHrs = 0, usedHrs = 0;
    workerNames.forEach(function (name) {
      const m = workerMonthMap[name][mk];
      const u = params.includeTimeOff ? (m.committed + m.timeOff) : m.committed;
      capHrs += m.capacity;
      usedHrs += u;
    });
    const availHrs = Math.max(0, capHrs - usedHrs);
    const capFte = capHrs / 160;
    const usedFte = usedHrs / 160;
    const availFte = availHrs / 160;
    perMonth.push({ mk: mk, capFte: capFte, usedFte: usedFte, availFte: availFte });
    Logger.log(
      mk + ' | ' +
      capHrs.toFixed(0).padStart(6) + ' | ' +
      usedHrs.toFixed(0).padStart(7) + ' | ' +
      availHrs.toFixed(0).padStart(8) + ' | ' +
      capFte.toFixed(2).padStart(6) + ' | ' +
      usedFte.toFixed(2).padStart(7) + ' | ' +
      availFte.toFixed(2).padStart(8)
    );
  });

  let peakUsed = 0, peakCap = 0, peakMk = '';
  let sumUsed = 0, sumCap = 0;
  perMonth.forEach(function (r) {
    if (r.usedFte > peakUsed) { peakUsed = r.usedFte; peakMk = r.mk; peakCap = r.capFte; }
    sumUsed += r.usedFte;
    sumCap  += r.capFte;
  });
  const n = perMonth.length || 1;
  const avgUsed = sumUsed / n;
  const avgCap  = sumCap  / n;

  Logger.log('\n--- Summary ---');
  Logger.log('Window months: ' + n);
  Logger.log('Peak-demand month: ' + peakMk);
  Logger.log('  Capacity FTE (peak):    ' + peakCap.toFixed(2));
  Logger.log('  Used FTE (peak):        ' + peakUsed.toFixed(2));
  Logger.log('  Headcount gap (peak):   ' + Math.max(0, peakUsed - peakCap).toFixed(2));
  Logger.log('  Suggested heads (peak): ' + Math.ceil(Math.max(0, peakUsed - peakCap)));
  Logger.log('Average-month:');
  Logger.log('  Capacity FTE (avg):     ' + avgCap.toFixed(2));
  Logger.log('  Used FTE (avg):         ' + avgUsed.toFixed(2));
  Logger.log('  Headcount gap (avg):    ' + Math.max(0, avgUsed - avgCap).toFixed(2));
  Logger.log('  Suggested heads (avg):  ' + Math.ceil(Math.max(0, avgUsed - avgCap)));
}

function debugSlgManagersWithEmail() {
  const rows = readConfigSlgManagers_();
  Logger.log('count: ' + rows.length);
  rows.slice(0, 5).forEach(r => Logger.log(JSON.stringify(r)));
  Logger.log('rows with email: ' + rows.filter(r => r.email).length);
}

function debugUserResolutionAs(emailOverride) {
  // Mimic _resolveLoggedInUser_ but with an injected email so we don't
  // have to fake Session.getActiveUser().
  var emailLc = String(emailOverride || '').trim().toLowerCase();
  var mgrRows = readConfigSlgManagers_();
  for (var i = 0; i < mgrRows.length; i++) {
    if (String(mgrRows[i].email || '').toLowerCase() === emailLc) {
      Logger.log('matchedManager: ' + mgrRows[i].manager_name);
      return;
    }
  }
  Logger.log('no manager match for ' + emailLc);
}

function debugUserResolution() {
  const r = _resolveLoggedInUser_();
  Logger.log(JSON.stringify(r, null, 2));
}

function debugTeamResolveForBucket() {
  var rtTeamMap = _readResourceTypeTeamMap_();
  Logger.log('rtTeamMap keys: ' + Object.keys(rtTeamMap).length);
  Logger.log('rtTeamMap sample: ' + JSON.stringify(rtTeamMap).slice(0, 400));

  var roleTeamLabels = readRoleTeamLabels_();
  Logger.log('roleTeamLabels: ' + JSON.stringify(roleTeamLabels));

  // Probe a few synthetic buckets
  var samples = [
    { worker_class: 'SLG_Real',         icp: 'EM',        resource_type: 'Engagement Manager' },
    { worker_class: 'SLG_Real',         icp: 'CS_FUNC',   resource_type: 'Functional' },
    { worker_class: 'SLG_Generic',      icp: 'CS_TECH',   resource_type: 'Integrations' },
    { worker_class: 'SLG_Real',         icp: '',          resource_type: 'Functional' },
    { worker_class: 'External_NonSLG',  role_category: 'Functional Consultant' },
    { worker_class: 'External_NonSLG',  resource_type: 'Integrations' },
    { worker_class: 'External_Contractor', resource_type: 'Reporting & Analytics PS' }
  ];
  samples.forEach(function (s, i) {
    var team = _resolveTeamForBucket_(s, roleTeamLabels, rtTeamMap);
    Logger.log((i + 1) + '. ' + JSON.stringify(s) + ' -> ' + team);
  });
}

function debugP4AssignmentEnrichment() {
  // Simulate what saveAssignment_ would do for the enrichment portion only.
  // Does NOT call appendRow_ or updateRow_ — read-only.
  function dryEnrich_(resourceType) {
    var a = { resource_type: resourceType };
    var teamLabel = 'Unclassified';
    if (resourceType) {
      var rtMap = readConfigResourceType_();
      var lowerIdx = {};
      Object.keys(rtMap).forEach(function (k) {
        lowerIdx[String(k).toLowerCase()] = rtMap[k];
      });
      var hit = rtMap[resourceType] || lowerIdx[String(resourceType).toLowerCase()];
      if (hit) teamLabel = String(hit).trim() || 'Unclassified';
    }
    return {
      resource_type: resourceType,
      team_label: teamLabel,
      team: teamLabel,
      role: _resolveIcpRoleFromTeamLabel_(teamLabel)
    };
  }

  ['Functional',
   'Functional Consultant',
   'Integrations',
   'Engagement Manager',
   'Reporting & Analytics PS',
   'Data Conversion',
   '',  // blank case
   'NotARealResourceType'].forEach(function (rt) {
    Logger.log('"' + rt + '" -> ' + JSON.stringify(dryEnrich_(rt)));
  });
}

function debugFunctionalKeyPresence() {
  var rtMap = readConfigResourceType_();
  var optsList = _readResourceTypeOptions_();

  Logger.log('Direct rtMap["Functional"]: ' + JSON.stringify(rtMap['Functional']));
  Logger.log('Direct rtMap["functional"]: ' + JSON.stringify(rtMap['functional']));
  Logger.log('Direct rtMap["FUNCTIONAL"]: ' + JSON.stringify(rtMap['FUNCTIONAL']));

  // Search for any key containing 'functional' case-insensitively
  Logger.log('All keys containing "functional" (case-insensitive):');
  Object.keys(rtMap).forEach(function (k) {
    if (k.toLowerCase().indexOf('functional') >= 0) {
      Logger.log('  "' + k + '" -> "' + rtMap[k] + '"');
    }
  });

  Logger.log('"Functional" in _readResourceTypeOptions_ list: ' +
             (optsList.indexOf('Functional') >= 0));
  Logger.log('Sample of options containing "functional":');
  optsList.filter(function (o) {
    return o.toLowerCase().indexOf('functional') >= 0;
  }).forEach(function (o) {
    Logger.log('  "' + o + '"');
  });
}

function debugListScenarios() {
  try {
    const result = api_listScenarios();
    Logger.log('type: ' + typeof result);
    Logger.log('isArray: ' + Array.isArray(result));
    Logger.log('value: ' + JSON.stringify(result));
  } catch (e) {
    Logger.log('FAILED: ' + e);
  }
}

function debugCfgWorkerRoleOverridesConstant() {
  Logger.log('CFG_WORKER_ROLE_OVERRIDES = "' + CFG_WORKER_ROLE_OVERRIDES + '"');
  Logger.log('Sheet exists: ' +
    (SpreadsheetApp.getActive().getSheetByName(CFG_WORKER_ROLE_OVERRIDES) !== null));
}

function debugWorkerRoleOverridesReader() {
  var overrides = readWorkerRoleOverrides_();
  Logger.log('Override count: ' + Object.keys(overrides).length);
  Logger.log('Overrides: ' + JSON.stringify(overrides));
}

function debugPhilDessaignePostNormalize() {
  var alloc = readTable_(ALLOC_NORM);
  var phil = alloc.filter(function (r) { return r.resource_name === 'Phil Dessaigne'; });
  Logger.log('Phil row count in Allocations: ' + phil.length);
  if (phil.length) {
    Logger.log('Phil ICP_role (first row): ' + phil[0].ICP_role);
    Logger.log('Phil worker_class (first row): ' + phil[0].worker_class);
    Logger.log('Phil job_profile (first row): ' + phil[0].job_profile);
    Logger.log('Phil resource_type (first row): ' + phil[0].resource_type);
  }
}
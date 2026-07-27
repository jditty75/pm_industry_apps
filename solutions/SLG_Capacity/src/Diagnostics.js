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
// Admin guard — all _dbg_ functions call this first.
// ============================================================

/**
 * Throws if the calling user is not authorized as a diagnostics admin.
 *
 * Authorization sources (any match grants access):
 *   1. Spreadsheet owner (works on personal Drive, fails on Shared Drives
 *      because Shared Drive files have no individual owner)
 *   2. Config_Settings.admin_emails (comma-separated list — works
 *      everywhere, recommended for Shared Drive setups)
 *
 * The dual-path check mirrors the production access gate in
 * AccessControl.gs::isAuthorized_ which uses the same admin_emails setting.
 */
function _dbg_requireAdmin_() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) {
      throw new Error('Could not resolve active user — re-authorize the script.');
    }
    const userLc = String(userEmail).toLowerCase().trim();

    // Path 1: spreadsheet owner (personal Drive)
    try {
      const owner = SpreadsheetApp.getActive().getOwner();
      const ownerEmail = owner ? owner.getEmail() : '';
      if (ownerEmail && String(ownerEmail).toLowerCase().trim() === userLc) {
        return;
      }
    } catch (e) {
      // Fall through to admin_emails check
    }

    // Path 2: Config_Settings.admin_emails (Shared Drive friendly)
    let settings = {};
    try {
      settings = (typeof readSettings_ === 'function') ? readSettings_() : {};
    } catch (e) {
      settings = {};
    }
    const raw = String(settings.admin_emails || '');
    if (raw) {
      const entries = raw.split(',').map(function (e) {
        return String(e || '').toLowerCase().trim();
      });
      if (entries.indexOf(userLc) >= 0) {
        return;
      }
    }

    throw new Error('Diagnostics restricted to spreadsheet owner or admin_emails. ' +
      'Add ' + userEmail + ' to Config_Settings.admin_emails to grant access.');
  } catch (e) {
    throw new Error('Diagnostics access denied: ' + e.message);
  }
}

// ============================================================
// 1. CONFIG & DATA HYGIENE
// ============================================================

/**
 * Dump the full Config_Resource_Type map (resource_type → team_label).
 * Run when you want to verify the mapping is being read correctly.
 */
function _dbg_debugConfigResourceType() {
  _dbg_requireAdmin_();
  const m = readConfigResourceType_();
  Logger.log('Config_Resource_Type entries: ' + Object.keys(m).length);
  Logger.log(JSON.stringify(m, null, 2));
}

/**
 * For External rows that couldn't be classified into a team,
 * show the top role_category | resource_type signatures that are
 * missing from Config_Resource_Type. Use to drive sheet edits.
 */
function _dbg_debugWhyUnclassified() {
  _dbg_requireAdmin_();
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
function _dbg_debugUnclassifiedSlgWorkers() {
  _dbg_requireAdmin_();
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
    if (excluded.has(_exclusionKey_(name))) return;

    // Only count hours in the planning window for the totals. weekly-
    // forecast-migration: rows are weekly (week_start); use the week's
    // primary month as a simple stamp, consistent with EnrichedData.gs's
    // month_key denormalized field (not a proportional split -- this
    // diagnostic only needs an approximate "months seen" signal).
    const mk = (function () {
      if (!r.week_start) return '';
      const dt = (r.week_start instanceof Date) ? r.week_start : new Date(r.week_start);
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
function _dbg_debugSlgWorkerTeamMismatches() {
  _dbg_requireAdmin_();
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
    if (excluded.has(_exclusionKey_(name))) return;
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
function _dbg_debugReportingSummaryReconciliation() {
  _dbg_requireAdmin_();
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

/**
 * weekly-forecast-migration §6.6 reconciliation diagnostic #1: sum a
 * sample worker's weekly hours straight from Allocations_Normalized, then
 * separately roll every one of that worker's rows through
 * splitWeekAcrossMonths_ and re-sum across all resulting month buckets.
 * The two totals must match (within floating-point tolerance) -- confirms
 * the proportional week->month split never gains or loses hours.
 *
 * @param {string} [resourceName] defaults to the first resource_name found
 *   in Allocations_Normalized if omitted.
 */
function _dbg_reconcileWeekToMonthSplit(resourceName) {
  _dbg_requireAdmin_();
  const rows = readTable_(ALLOC_NORM);
  if (!rows.length) {
    Logger.log('_dbg_reconcileWeekToMonthSplit: Allocations_Normalized is empty.');
    return;
  }
  const name = resourceName || rows[0].resource_name;
  const settings = readSettings_();
  const basis = String(settings.week_month_split_basis || 'calendar');

  const workerRows = rows.filter(function (r) { return r.resource_name === name; });
  Logger.log('--- _dbg_reconcileWeekToMonthSplit("' + name + '") --- basis=' + basis);
  Logger.log('Rows for worker: ' + workerRows.length);

  let weeklyTotal = 0;
  const byWeek = {};
  const byMonth = {};
  workerRows.forEach(function (r) {
    const h = Number(r.hours) || 0;
    if (!h || !r.week_start) return;
    weeklyTotal += h;
    const wk = r.week_key || weekKey_(r.week_start);
    byWeek[wk] = (byWeek[wk] || 0) + h;
    splitWeekAcrossMonths_(r.week_start, h, basis).forEach(function (p) {
      byMonth[p.monthKey] = (byMonth[p.monthKey] || 0) + p.hours;
    });
  });

  const monthlyTotal = Object.values(byMonth).reduce(function (s, h) { return s + h; }, 0);
  const diff = Math.abs(weeklyTotal - monthlyTotal);

  Logger.log('Distinct weeks: ' + Object.keys(byWeek).length);
  Logger.log('Distinct months (post-split): ' + Object.keys(byMonth).length);
  Logger.log('Weekly total hours:   ' + weeklyTotal.toFixed(4));
  Logger.log('Monthly total hours:  ' + monthlyTotal.toFixed(4) + '  (sum of splitWeekAcrossMonths_ output)');
  Logger.log('Difference:            ' + diff.toFixed(6));
  Logger.log('RECONCILE: ' + (diff < 0.01 ? 'OK — totals match' : 'MISMATCH — investigate splitWeekAcrossMonths_'));
  Logger.log('Per-month breakdown: ' + JSON.stringify(byMonth));
}

/**
 * weekly-forecast-migration §6.6 reconciliation diagnostic #2: run
 * detectWeekColumns_ against the CURRENT PSA/STAFF_SHEET header row and
 * confirm (a) the expected week count is found (27 in the spec's sample
 * export) and (b) "Total Hours" is excluded. Run this against the live
 * sheet right after uploading a file, before normalizeStaff() overwrites
 * the header context you're inspecting.
 */
function _dbg_verifyWeekColumnDetection() {
  _dbg_requireAdmin_();
  const sh = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET);
  if (!sh) {
    Logger.log('_dbg_verifyWeekColumnDetection: sheet "' + STAFF_SHEET + '" not found.');
    return;
  }
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const detection = detectWeekColumns_(header);

  const hasTotalHoursCol = header.some(function (h) {
    return String(h || '').trim().toLowerCase() === 'total hours';
  });
  const totalHoursExcluded = hasTotalHoursCol &&
    !detection.weeks.some(function (w) { return String(header[w.index] || '').trim().toLowerCase() === 'total hours'; });

  Logger.log('--- _dbg_verifyWeekColumnDetection ---');
  Logger.log('Header columns: ' + header.length);
  Logger.log('Weeks detected: ' + detection.weeks.length + ' (spec sample export: 27)');
  Logger.log('"Total Hours" column present in header: ' + hasTotalHoursCol);
  Logger.log('"Total Hours" excluded from detected weeks: ' + (hasTotalHoursCol ? totalHoursExcluded : 'n/a (no such column)'));
  Logger.log('First week:  ' + (detection.weeks[0] ? weekKey_(detection.weeks[0].weekStart) : '(none)'));
  Logger.log('Last week:   ' + (detection.weeks.length ? weekKey_(detection.weeks[detection.weeks.length - 1].weekStart) : '(none)'));
  Logger.log('Contiguity warnings: ' + detection.warnings.length);
  detection.warnings.forEach(function (w) { Logger.log('  - ' + w); });
  Logger.log('RESULT: ' + (detection.weeks.length > 0 && (!hasTotalHoursCol || totalHoursExcluded) ? 'OK' : 'FAILED — see above'));
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
function _dbg_sanityCheckHeadcountByTeam() {
  _dbg_requireAdmin_();
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
function _dbg_sanityCheckPlanningWindow() {
  _dbg_requireAdmin_();
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
function _dbg_debugRoleHeadcount(roleKey, paramsOverride) {
  _dbg_requireAdmin_();
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
    if (excluded.has(_exclusionKey_(a.resource_name))) return;
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
      if (excluded.has(_exclusionKey_(g.name))) return;
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

  const splitBasis = String(settings.week_month_split_basis || 'calendar');

  allocRaw.forEach(function (a) {
    if (!a.resource_name) return;
    if (workerNames.indexOf(a.resource_name) < 0) return;
    if (!a.week_start) return;
    const h = Number(a.hours) || 0;
    if (!h) return;
    splitWeekAcrossMonths_(a.week_start, h, splitBasis).forEach(function (p) {
      if (!windowKeys[p.monthKey]) return;
      const m = workerMonthMap[a.resource_name][p.monthKey];
      if (!m) return;
      if (a.allocation_type === 'PTO_Holiday') {
        m.timeOff += p.hours;
      } else {
        m.committed += p.hours;
      }
    });
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
      expandAssignmentToWeekly_(a, calendar).forEach(function (w) {
        splitWeekAcrossMonths_(w.week_start, w.hours, splitBasis).forEach(function (p) {
          if (!windowKeys[p.monthKey]) return;
          const entry = workerMonthMap[a.resource_name][p.monthKey];
          if (!entry) return;
          entry.committed += p.hours;
        });
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

function _dbg_debugSlgManagersWithEmail() {
  _dbg_requireAdmin_();
  const rows = readConfigSlgManagers_();
  Logger.log('count: ' + rows.length);
  rows.slice(0, 5).forEach(r => Logger.log(JSON.stringify(r)));
  Logger.log('rows with email: ' + rows.filter(r => r.email).length);
}

function _dbg_debugUserResolutionAs(emailOverride) {
  _dbg_requireAdmin_();
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

function _dbg_debugUserResolution() {
  _dbg_requireAdmin_();
  const r = _resolveLoggedInUser_();
  Logger.log(JSON.stringify(r, null, 2));
}

function _dbg_debugTeamResolveForBucket() {
  _dbg_requireAdmin_();
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

function _dbg_debugP4AssignmentEnrichment() {
  _dbg_requireAdmin_();
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

function _dbg_debugFunctionalKeyPresence() {
  _dbg_requireAdmin_();
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

function _dbg_debugListScenarios() {
  _dbg_requireAdmin_();
  try {
    const result = api_listScenarios();
    Logger.log('type: ' + typeof result);
    Logger.log('isArray: ' + Array.isArray(result));
    Logger.log('value: ' + JSON.stringify(result));
  } catch (e) {
    Logger.log('FAILED: ' + e);
  }
}

function _dbg_debugCfgWorkerRoleOverridesConstant() {
  _dbg_requireAdmin_();
  Logger.log('CFG_WORKER_ROLE_OVERRIDES = "' + CFG_WORKER_ROLE_OVERRIDES + '"');
  Logger.log('Sheet exists: ' +
    (SpreadsheetApp.getActive().getSheetByName(CFG_WORKER_ROLE_OVERRIDES) !== null));
}

function _dbg_debugWorkerRoleOverridesReader() {
  _dbg_requireAdmin_();
  var overrides = readWorkerRoleOverrides_();
  Logger.log('Override count: ' + Object.keys(overrides).length);
  Logger.log('Overrides: ' + JSON.stringify(overrides));
}

function _dbg_debugPhilDessaignePostNormalize() {
  _dbg_requireAdmin_();
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

function _dbg_debugCompareResourceDetailPaths() {
  _dbg_requireAdmin_();
  api_flushCaches();

  const resource = 'Banjo Simbahan';
  const viewMode = 'Scenario';
  const scenarioId = '7e65c3d2-29f8-4103-b9af-843c8bc7f16f';

  Logger.log('=== Path A: api_getResourceDetail ===');
  const detailA = api_getResourceDetail({
    resource: resource,
    viewMode: viewMode,
    scenarioId: scenarioId
  });
  detailA.forEach(m => {
    Logger.log('  ' + m.monthKey + ': billable=' + m.billable + ', scenario=' + m.scenario);
  });

  Logger.log('=== Path B: computeResourceDetail (direct) ===');
  const detailB = computeResourceDetail({
    resource: resource,
    viewMode: viewMode,
    scenarioId: scenarioId
  });
  detailB.forEach(m => {
    Logger.log('  ' + m.monthKey + ': billable=' + m.billable + ', scenario=' + m.scenario);
  });

  Logger.log('=== Comparison ===');
  Logger.log('Path A months: ' + detailA.length);
  Logger.log('Path B months: ' + detailB.length);
  for (let i = 0; i < Math.max(detailA.length, detailB.length); i++) {
    const a = detailA[i] || {};
    const b = detailB[i] || {};
    Logger.log(
      '  [' + i + '] ' +
      'A: ' + a.monthKey + ' s=' + a.scenario + ' | ' +
      'B: ' + b.monthKey + ' s=' + b.scenario +
      (a.scenario !== b.scenario ? ' ← MISMATCH' : '')
    );
  }
}

function _dbg_debugApiGetReferenceP3() {
  _dbg_requireAdmin_();
  var ref = api_getReference();

  var resources = ref.resources || [];
  var teamCounts = {};
  resources.forEach(function (r) {
    var t = r.resolvedTeam || '(missing)';
    teamCounts[t] = (teamCounts[t] || 0) + 1;
  });
  Logger.log('resource count: ' + resources.length);
  Logger.log('resolvedTeam distribution: ' + JSON.stringify(teamCounts));

  Logger.log('sample resources:');
  resources.slice(0, 5).forEach(function (r) {
    Logger.log('  ' + r.name + ' | wc=' + r.worker_class +
               ' | mgr=' + r.manager_org + ' | icp=' + r.icp +
               ' | team=' + r.resolvedTeam);
  });

  var aidan = resources.find(function (r) { return r.name === 'Aidan Votaw'; });
  if (aidan) {
    Logger.log('Aidan Votaw: wc=' + aidan.worker_class +
               ' | icp=' + aidan.icp +
               ' | team=' + aidan.resolvedTeam);
  } else {
    Logger.log('Aidan Votaw not found in resources list');
  }

  var md = ref.managerDescendants || {};
  var mdKeys = Object.keys(md);
  Logger.log('managerDescendants key count: ' + mdKeys.length);
  mdKeys.slice(0, 5).forEach(function (k) {
    Logger.log('  "' + k + '" -> ' + JSON.stringify(md[k]));
  });
}

function _dbg_debugSlgVsExternalClassification() {
  _dbg_requireAdmin_();
  var ref = api_getReference();
  var resources = ref.resources || [];
  var slgResources = resources.filter(function (r) {
    return r.worker_class === 'SLG_Real' || r.worker_class === 'SLG_Generic';
  });
  Logger.log('SLG resource count: ' + slgResources.length);

  var roleTeamLabels = readRoleTeamLabels_();
  var rtMap = readConfigResourceType_();

  var divergences = 0;
  slgResources.forEach(function (r) {
    var slgPath = roleTeamLabels[r.icp || ''] || 'Unclassified';
    var externalPath = _classifyTeam_({
      role_category: r.role_category || '',
      job_profile: r.job_profile || '',
      project_role: '',
      resource_type: r.resource_type || ''
    }, rtMap);
    if (slgPath !== externalPath) {
      divergences++;
      if (divergences <= 10) {
        Logger.log('  ' + r.name + ' | icp=' + r.icp +
                   ' | rt=' + r.resource_type +
                   ' | SLG path=' + slgPath +
                   ' | External path=' + externalPath +
                   ' | actual resolvedTeam=' + r.resolvedTeam);
      }
    }
  });
  Logger.log('Total divergences: ' + divergences);
}

function _test_phase4_chunked_cache() {
  _dbg_requireAdmin_();
  api_flushCaches();
  const t0 = new Date().getTime();
  const r1 = api_getDashboard({ viewMode: 'Committed', groupBy: 'Function', workerScope: 'SLG' });
  const t1 = new Date().getTime();
  const r2 = api_getDashboard({ viewMode: 'Committed', groupBy: 'Function', workerScope: 'SLG' });
  const t2 = new Date().getTime();
  Logger.log('Cold call: ' + (t1 - t0) + 'ms');
  Logger.log('Warm call: ' + (t2 - t1) + 'ms');
  Logger.log('Both returned data: ' + (!!r1 && !!r2));
  Logger.log('Same kpi headcount: ' + (r1.kpis.headcount === r2.kpis.headcount));
}

// ============================================================
// Drop 5 diagnostics
// ============================================================

/**
 * Compare team labels produced by the unified resolver against (a) the legacy
 * roleTeamLabels[icp] path, and (b) the old _classifyTeam_ chain.
 * Run before and after Drop 5 clasp push; new divergences after deploy = bug.
 */
function _dbg_compareTeamResolvers() {
  _dbg_requireAdmin_();
  const resIdx = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_() : _resourceIndex_(cachedRead_(ALLOC_NORM));
  const rtMap = readConfigResourceType_();
  const roleTeamLabels = readRoleTeamLabels_();
  const ctx = (typeof resolveTeamLabel_ === 'function')
    ? resolveTeamLabel_.buildCtx_(roleTeamLabels, rtMap) : null;

  let divergences = 0;
  Object.values(resIdx).forEach(function (res) {
    const unified = ctx
      ? resolveTeamLabel_(res, ctx)
      : '(resolver unavailable)';
    const oldIcp = (res.worker_class === 'SLG_Real' || res.worker_class === 'SLG_Generic')
      ? (roleTeamLabels[res.icp] || 'Unclassified')
      : null;
    const oldClassify = _classifyTeam_({
      role_category: res.role_category || '',
      job_profile:   res.job_profile   || '',
      project_role:  '',
      resource_type: res.resource_type || ''
    }, rtMap);

    const expectedSlg = oldIcp || oldClassify;
    if (unified !== expectedSlg) {
      divergences++;
      Logger.log('DIVERGE: ' + res.name +
        ' unified=' + unified +
        ' expected=' + expectedSlg +
        ' wc=' + res.worker_class +
        ' icp=' + res.icp +
        ' rt=' + res.resource_type);
    }
  });
  Logger.log('_dbg_compareTeamResolvers: checked ' + Object.keys(resIdx).length +
    ' resources, ' + divergences + ' divergences');
}

/**
 * Log enriched-cache stats: current version, hit/miss counters, last payload size.
 */
function _dbg_enrichedCacheStats() {
  _dbg_requireAdmin_();
  try {
    var props = PropertiesService.getScriptProperties();
    var version   = props.getProperty('enriched_cache_version') || '(not set)';
    var hits      = props.getProperty('enriched_hits')            || '0';
    var misses    = props.getProperty('enriched_misses')          || '0';
    var payloadKb = props.getProperty('enriched_last_payload_kb') || '(unknown)';
    var lastInv   = props.getProperty('enriched_cache_last_invalidated') || '(never)';
    Logger.log('enriched_cache_version:       ' + version);
    Logger.log('enriched_hits:                ' + hits);
    Logger.log('enriched_misses:              ' + misses);
    Logger.log('enriched_last_payload_kb:     ' + payloadKb);
    Logger.log('enriched_cache_last_invalidated: ' + lastInv);
  } catch (e) {
    Logger.log('_dbg_enrichedCacheStats: ' + e.message);
  }
}

/**
 * Drop 5 performance test. Run after clasp push to validate warm/cold ratio.
 * Goal: warm-call total time ≤ 30% of cold-call total time.
 * Add output to commit message Perf notes: section.
 */
function _test_drop5_endpoints() {
  _dbg_requireAdmin_();
  Logger.log('=== _test_drop5_endpoints: starting cold calls ===');

  // Flush first to ensure cold start.
  if (typeof api_flushCaches === 'function') api_flushCaches();

  const t0 = Date.now();
  const coldDash = api_getDashboard({ workerScope: 'SLG', groupBy: 'Function' });
  const t1 = Date.now();
  const coldReport = api_getReportingSummary({ workerScope: 'All' });
  const t2 = Date.now();
  const coldRef = api_getReference();
  const t3 = Date.now();

  Logger.log('Cold api_getDashboard:          ' + (t1 - t0) + 'ms');
  Logger.log('Cold api_getReportingSummary:   ' + (t2 - t1) + 'ms');
  Logger.log('Cold api_getReference:          ' + (t3 - t2) + 'ms');
  Logger.log('Cold total:                     ' + (t3 - t0) + 'ms');

  // Warm calls (caches populated).
  const t4 = Date.now();
  api_getDashboard({ workerScope: 'SLG', groupBy: 'Function' });
  const t5 = Date.now();
  api_getReportingSummary({ workerScope: 'All' });
  const t6 = Date.now();
  api_getReference();
  const t7 = Date.now();

  Logger.log('Warm api_getDashboard:          ' + (t5 - t4) + 'ms');
  Logger.log('Warm api_getReportingSummary:   ' + (t6 - t5) + 'ms');
  Logger.log('Warm api_getReference:          ' + (t7 - t6) + 'ms');
  Logger.log('Warm total:                     ' + (t7 - t4) + 'ms');

  const coldTotal = t3 - t0;
  const warmTotal = t7 - t4;
  const ratio = coldTotal > 0 ? (warmTotal / coldTotal) : 1;
  Logger.log('Warm/cold ratio:                ' + (ratio * 100).toFixed(1) + '%  (goal ≤ 30%)');
  Logger.log('Goal met:                       ' + (ratio <= 0.30 ? 'YES' : 'NO'));

  Logger.log('Sanity: cold kpis.headcount = ' + ((coldDash.kpis || {}).headcount || '(none)'));
  Logger.log('Sanity: cold report ok = ' + !!coldReport);
  Logger.log('Sanity: cold ref resources = ' + ((coldRef.resources || []).length));
}

// ============================================================
// Drop 6: Scenario + Reductions debug
// ============================================================

/**
 * List all assignments and capacity adjustments in a scenario, with
 * their per-month net effect for each affected worker. Useful for
 * verifying the math after committing a scenario.
 *
 * Run from the Apps Script editor: set scenarioId to your scenario's UUID.
 * Results appear in View → Logs.
 *
 * @param {string} scenarioId
 */
function _dbg_debugScenarioWithReductions(scenarioId) {
  _dbg_requireAdmin_();
  if (!scenarioId) {
    Logger.log('_dbg_debugScenarioWithReductions: scenarioId is required');
    return;
  }

  // weekly-forecast-migration: expand at weekly grain, then roll each week
  // up to the calendar month(s) it overlaps via splitWeekAcrossMonths_ for
  // the per-month log lines below (same proportional-split pattern as
  // Api.gs's api_getReportingSummary).
  const calendar = readCalendar_();
  const splitBasis = String((readSettings_() || {}).week_month_split_basis || 'calendar');

  function toMonthly_(weekly, hoursField) {
    const byMonth = {};
    weekly.forEach(function (w) {
      splitWeekAcrossMonths_(w.week_start, w[hoursField], splitBasis).forEach(function (p) {
        byMonth[p.monthKey] = (byMonth[p.monthKey] || 0) + p.hours;
      });
    });
    return Object.keys(byMonth).sort().map(function (mk) {
      const o = { monthKey: mk };
      o[hoursField] = byMonth[mk];
      return o;
    });
  }

  // Assignments
  const assigns = readTable_(ASSIGNMENTS)
    .filter(a => a.scenario_id === scenarioId);
  Logger.log('=== Scenario: ' + scenarioId + ' ===');
  Logger.log('Assignments (' + assigns.length + '):');
  assigns.forEach(a => {
    const months = toMonthly_(expandAssignmentToWeekly_(a, calendar), 'hours');
    const total = months.reduce((s, m) => s + m.hours, 0);
    Logger.log('  [' + a.status + '] ' + (a.resource_name || '(blank)') +
      ' | ' + a.estimated_hours + 'h (' + a.distribution + ')' +
      ' | net total across months: ' + Math.round(total) + 'h');
    months.forEach(m => {
      Logger.log('      ' + m.monthKey + ': +' + Math.round(m.hours) + 'h');
    });
  });

  // Adjustments (reductions)
  let adjs = [];
  try { adjs = readTable_(CAPACITY_ADJUSTMENTS_SHEET).filter(a => a.scenario_id === scenarioId); } catch (e) {}
  Logger.log('Capacity Adjustments (' + adjs.length + '):');
  adjs.forEach(adj => {
    const months = toMonthly_(expandAdjustmentToWeekly_(adj, calendar), 'hours_reduction');
    const total = months.reduce((s, m) => s + m.hours_reduction, 0);
    Logger.log('  [' + adj.status + '] ' + (adj.resource_name || '(blank)') +
      ' | -' + adj.hours_reduction + 'h (' + adj.distribution + ')' +
      ' | net total across months: -' + Math.round(total) + 'h');
    months.forEach(m => {
      Logger.log('      ' + m.monthKey + ': -' + Math.round(m.hours_reduction) + 'h');
    });
  });

  // Per-worker net effect
  const workerNet = {};
  assigns.forEach(a => {
    if (!a.resource_name) return;
    const months = toMonthly_(expandAssignmentToWeekly_(a, calendar), 'hours');
    months.forEach(m => {
      const k = a.resource_name + '|' + m.monthKey;
      workerNet[k] = (workerNet[k] || 0) + m.hours;
    });
  });
  adjs.forEach(adj => {
    if (!adj.resource_name) return;
    const months = toMonthly_(expandAdjustmentToWeekly_(adj, calendar), 'hours_reduction');
    months.forEach(m => {
      const k = adj.resource_name + '|' + m.monthKey;
      workerNet[k] = (workerNet[k] || 0) - m.hours_reduction;
    });
  });

  Logger.log('Net per-worker per-month:');
  Object.keys(workerNet).sort().forEach(k => {
    Logger.log('  ' + k + ': ' + Math.round(workerNet[k]) + 'h');
  });
}

function _test_phase8_ingest_filter_logic() {
  _dbg_requireAdmin_();
  // Exercises the include/exclude/group semantics with a synthetic
  // header + 4 rows. Confirms exclude short-circuit works correctly
  // and OR-within-group + AND-across-groups still hold.
  // No production data is touched.
  const header = ['team', 'role', 'region'];
  const rows = [
    header,
    ['Delivery', 'EM', 'Government'],   // should pass
    ['Delivery', 'EM', 'Commercial'],   // should fail (region exclude)
    ['Functional', 'CS', 'Government'], // should fail (team include miss)
    ['Delivery', 'PD', 'Government']    // should pass
  ];
  // Stub the alias map and filter rules so we don't touch real config
  // ... (full test scaffolding deferred — verify by running existing
  // Phase 5 PSA upload diagnostics instead)
  Logger.log('Phase 8 test stub — exercise by re-running Phase 5 diagnostics');
}

function _dbg_findParseError() {
  // Force evaluation of every file by attempting to enumerate functions.
  // If any file has a syntax error, this will throw immediately with
  // the location.
  try {
    const allKeys = Object.keys(this).filter(k => typeof this[k] === 'function');
    Logger.log('Functions registered: ' + allKeys.length);
    Logger.log('api_getWorkerPlanning exists: ' + (typeof api_getWorkerPlanning === 'function'));
    Logger.log('api_getWorkerPlanningSummary exists: ' + (typeof api_getWorkerPlanningSummary === 'function'));
    Logger.log('api_archiveAssignment exists: ' + (typeof api_archiveAssignment === 'function'));
    Logger.log('api_commitAssignment exists: ' + (typeof api_commitAssignment === 'function'));
    Logger.log('api_commitCapacityAdjustment exists: ' + (typeof api_commitCapacityAdjustment === 'function'));
    Logger.log('api_listOpportunities exists: ' + (typeof api_listOpportunities === 'function'));
    Logger.log('api_getReference exists: ' + (typeof api_getReference === 'function'));
  } catch (e) {
    Logger.log('PARSE ERROR DETECTED: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
}

function _dbg_forceReparse() {
  try {
    // Apps Script lazy-loads files. Touching a known function from
    // each file forces evaluation. If a file has a syntax error,
    // an attempt to reference any function from below the error
    // will throw.
    Logger.log('Api.gs touches:');
    Logger.log('  api_getReference: ' + (typeof api_getReference));
    Logger.log('  api_listOpportunities: ' + (typeof api_listOpportunities));
    Logger.log('  api_listSettings: ' + (typeof api_listSettings));
    Logger.log('  api_listOverrides: ' + (typeof api_listOverrides));
    Logger.log('  api_saveSettings: ' + (typeof api_saveSettings));
    Logger.log('  api_bulkDeleteOverrides: ' + (typeof api_bulkDeleteOverrides));
    Logger.log('  api_getOverrideHygieneSummary: ' + (typeof api_getOverrideHygieneSummary));
    Logger.log('  api_listCapacityAdjustments: ' + (typeof api_listCapacityAdjustments));
    Logger.log('  api_saveCapacityAdjustment: ' + (typeof api_saveCapacityAdjustment));
    Logger.log('  api_getResourceBaseline: ' + (typeof api_getResourceBaseline));
    Logger.log('  api_getWorkerPlanning: ' + (typeof api_getWorkerPlanning));
    Logger.log('');
    Logger.log('Other files (sanity):');
    Logger.log('  saveAssignment_: ' + (typeof saveAssignment_));
    Logger.log('  saveCapacityAdjustment_: ' + (typeof saveCapacityAdjustment_));
    Logger.log('  saveOverride_: ' + (typeof saveOverride_));
  } catch (e) {
    Logger.log('THREW: ' + e.message);
  }
}

function _dbg_checkResourceTypeForDelivery() {
  var rtMap = readConfigResourceType_();
  Logger.log('All keys: ' + JSON.stringify(Object.keys(rtMap)));
  Logger.log('Keys containing "deliv": ');
  Object.keys(rtMap).forEach(function(k) {
    if (k.toLowerCase().indexOf('deliv') >= 0) {
      Logger.log('  "' + k + '" -> "' + rtMap[k] + '"');
    }
  });
  Logger.log('Direct rtMap["Delivery"]: ' + rtMap['Delivery']);
}

// ============================================================
// Doc B: Capacity Adjustment diagnostics
// ============================================================

/**
 * Log the 20 most recently modified Capacity_Adjustments rows.
 */
function _dbg_recentCapacityAdjustments() {
  _dbg_requireAdmin_();
  const rows = readTable_(CAPACITY_ADJUSTMENTS_SHEET);
  rows.sort(function (a, b) { return new Date(b.modified_at || 0) - new Date(a.modified_at || 0); });
  rows.slice(0, 20).forEach(function (r) {
    Logger.log(JSON.stringify({
      adjustment_id: r.adjustment_id,
      resource_name: r.resource_name,
      direction:     r.direction,
      hours_reduction: r.hours_reduction,
      deployment_id: r.deployment_id,
      status:        r.status,
      modified_at:   r.modified_at
    }));
  });
}

/**
 * Log the 20 most recent Capacity_Adjustments_Audit rows.
 */
function _dbg_recentCapacityAdjustmentAudit() {
  _dbg_requireAdmin_();
  const rows = readTable_(CAPACITY_ADJUSTMENTS_AUDIT_SHEET);
  rows.sort(function (a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });
  rows.slice(0, 20).forEach(function (r) { Logger.log(JSON.stringify(r)); });
}

/**
 * Log all Capacity_Adjustments rows for a given worker.
 * @param {string} resourceName
 */
function _dbg_findAdjustmentsByWorker(resourceName) {
  _dbg_requireAdmin_();
  const rows = readTable_(CAPACITY_ADJUSTMENTS_SHEET).filter(function (r) { return r.resource_name === resourceName; });
  Logger.log('Count: ' + rows.length);
  rows.forEach(function (r) {
    Logger.log(JSON.stringify({
      adjustment_id: r.adjustment_id,
      direction:     r.direction,
      hours_reduction: r.hours_reduction,
      start_date:    r.start_date,
      end_date:      r.end_date,
      deployment_id: r.deployment_id,
      status:        r.status
    }));
  });
}

/**
 * ONE-TIME (WFM-FIX.3): clean up Config_Worker_Exclusions before ingest
 * reconciliation (reconcileWorkerExclusions_, Ingest.gs) takes over as the
 * ongoing maintainer. Run manually from the editor; review the sheet
 * before running Normalize Staff.
 *
 * - Prunes all contractor ('[C]' tag in worker_name) rows -- worker-scope
 *   already handles contractors via worker_class; this sheet is SLG
 *   workers/managers only.
 * - Prunes dormant non-rule rows: active != Yes, no override, and the
 *   worker isn't currently a Config_SLG_Managers member or on-leave-tagged
 *   (Option X -- a dormant row with no rule basis and no human override is
 *   just noise).
 * - Stamps source on every surviving row: Config_SLG_Managers membership
 *   -> rule:manager, current "(On Leave)" name-tag in Allocations_Normalized
 *   -> rule:on_leave (dual-status rows carry both), everything else that
 *   survives -> manual. Any existing override is preserved untouched.
 * - Also materializes rows for any manager/on-leave worker who doesn't yet
 *   have a row at all, so the sheet ends up in the same shape
 *   reconcileWorkerExclusions_ would produce going forward.
 *
 * On-leave detection here tests the "(On Leave)" tag directly against
 * current resource_name values (same pattern as _deriveOnLeave_, Ingest.gs)
 * rather than the Allocations_Normalized on_leave column, since this
 * migration is meant to run BEFORE the first post-fix Normalize Staff --
 * the column may not be populated yet.
 *
 * @return {{before:number, after:number, prunedContractor:number, prunedDormant:number}}
 */
function _dbg_migrateWorkerExclusions() {
  _dbg_requireAdmin_();

  const TRUTHY = {'yes':1,'y':1,'true':1,'t':1,'1':1,'x':1,'active':1,'on':1};
  const existing = readTable_(CFG_WORKER_EXCLUSIONS) || [];

  // Data-derived signals (mirrors reconcileWorkerExclusions_'s classification).
  const managers = {};   // _exclusionKey_ -> display name
  (readConfigSlgManagers_() || []).forEach(function (m) {
    const nm = String(m.manager_name || '').trim();
    if (nm) managers[_exclusionKey_(nm)] = nm;
  });

  const onLeave = {};    // _exclusionKey_ -> display name
  let allocRows = [];
  try { allocRows = readTable_(ALLOC_NORM) || []; } catch (e) { allocRows = []; }
  allocRows.forEach(function (a) {
    const raw = String(a.resource_name || '').trim();
    if (raw && /\(On Leave\)\s*$/i.test(raw)) {
      onLeave[_exclusionKey_(raw)] = raw;
    }
  });

  const pruned = { contractor: 0, dormant: 0 };
  const out = {};  // _exclusionKey_ -> row

  existing.forEach(function (r) {
    const name = String(r.worker_name || '').trim();
    if (!name) return;
    const k = _exclusionKey_(name);
    const ovr = String(r.override || '').trim();
    const activeRaw = (r.active === '' || r.active == null) ? 'Yes' : r.active;
    const isActive = !!TRUTHY[String(activeRaw).trim().toLowerCase()];
    const isRuleCandidate = !!managers[k] || !!onLeave[k];

    if (name.indexOf('[C]') >= 0) { pruned.contractor++; return; }
    if (!isActive && !ovr && !isRuleCandidate) { pruned.dormant++; return; }

    out[k] = {
      worker_name: name,
      manager_org: String(r.manager_org || '').trim(),
      reason: String(r.reason || '').trim(),
      active: 'Yes',
      source: '',   // re-derived below, discarding whatever was stored before
      override: ovr
    };
  });

  function ensureRow(k, name) {
    if (!out[k]) {
      out[k] = { worker_name: name, manager_org: '', reason: '', active: 'Yes', source: '', override: '' };
    }
    return out[k];
  }
  // Materialize rule:manager / rule:on_leave, including for workers who
  // don't have a pre-existing row at all.
  Object.keys(managers).forEach(function (k) { _addSource_(ensureRow(k, managers[k]), 'rule:manager'); });
  Object.keys(onLeave).forEach(function (k)  { _addSource_(ensureRow(k, onLeave[k]),   'rule:on_leave'); });
  // Anything left without a rule tag is a genuine human judgment call.
  Object.keys(out).forEach(function (k) { if (!out[k].source) out[k].source = 'manual'; });

  const finalRows = Object.keys(out).map(function (k) { return out[k]; });
  finalRows.sort(function (a, b) { return String(a.worker_name).localeCompare(String(b.worker_name)); });

  writeTable_(CFG_WORKER_EXCLUSIONS, WORKER_EXCLUSION_HEADERS,
    finalRows.map(function (r) {
      return WORKER_EXCLUSION_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
    }));
  invalidateCache_(CFG_WORKER_EXCLUSIONS);

  const counts = {
    ruleManager: finalRows.filter(function (r) { return _hasSource_(r, 'rule:manager'); }).length,
    ruleOnLeave: finalRows.filter(function (r) { return _hasSource_(r, 'rule:on_leave'); }).length,
    manual:      finalRows.filter(function (r) { return _hasSource_(r, 'manual'); }).length,
    overrides:   finalRows.filter(function (r) { return !!r.override; }).length
  };

  Logger.log('_dbg_migrateWorkerExclusions: BEFORE ' + existing.length + ' rows -> AFTER ' + finalRows.length + ' rows.');
  Logger.log('  rule:manager=' + counts.ruleManager + ', rule:on_leave=' + counts.ruleOnLeave +
    ', manual=' + counts.manual + ', overrides=' + counts.overrides);
  Logger.log('  Pruned: ' + pruned.contractor + ' contractor row(s), ' + pruned.dormant + ' dormant row(s).');
  Logger.log('  Review the sheet now, before running Normalize Staff.');

  return { before: existing.length, after: finalRows.length, prunedContractor: pruned.contractor, prunedDormant: pruned.dormant };
}

/**
 * WFM-PERF.2: prove _fastYmd_ / the rewritten weekKey_ / monthKey_ produce
 * byte-identical output to the old Utilities.formatDate/formatString path,
 * across every real Allocations_Normalized row, before trusting the swap.
 * Gate: any mismatch means the date arithmetic diverges from the LOCKED
 * week_key/month_key format -- do not ship (this is the WFM.13 defect
 * class: a week_key corruption bug).
 */
function _dbg_verifyFastDateParity() {
  _dbg_requireAdmin_();
  var tz = Session.getScriptTimeZone();
  var rows = readTable_(ALLOC_NORM);
  var mismatches = 0, checked = 0;
  rows.forEach(function (r) {
    if (!r.week_start) return;
    var x = weekStart_(r.week_start);
    if (isNaN(x.getTime())) return;
    checked++;
    var fastWk = _fastYmd_(x);
    var oldWk = Utilities.formatDate(x, tz, 'yyyy-MM-dd');
    var fastMk = monthKey_(x);
    var oldMk = Utilities.formatString('%04d-%02d', x.getFullYear(), x.getMonth() + 1);
    if (fastWk !== oldWk || fastMk !== oldMk) {
      mismatches++;
      if (mismatches <= 10) Logger.log('MISMATCH: wk ' + fastWk + ' vs ' + oldWk + ' | mk ' + fastMk + ' vs ' + oldMk);
    }
  });
  Logger.log('_dbg_verifyFastDateParity: checked ' + checked + ', mismatches ' + mismatches +
    (mismatches === 0 ? ' \u2014 PARITY OK' : ' \u2014 FAILED, DO NOT SHIP'));
}

/**
 * WFM-PERF.1 (throwaway diagnostic): profile a COLD api_getDashboard.
 * Flushes caches first so every step runs cold, then calls the dashboard
 * once and lets the [PERF] logs fire (computeUtilization's _p.mark calls,
 * plus the getEnrichedAllocations_/getEnrichedAssignments_/getResourceIndex_
 * cache-hit/cold-rebuild logs). Run from the editor; read View -> Logs.
 * Strip this instrumentation once the real fix ships (see WFM-PERF.1 §6).
 */
function _dbg_profileDashboardCold() {
  _dbg_requireAdmin_();
  if (typeof api_flushCaches === 'function') api_flushCaches();
  Logger.log('=== COLD api_getDashboard profile (SLG/Function) ===');
  var t0 = Date.now();
  api_getDashboard({ viewMode: 'Committed', groupBy: 'Function', workerScope: 'SLG', includeTimeOff: false });
  Logger.log('TOTAL api_getDashboard: ' + (Date.now() - t0) + 'ms');
}

// ============================================================
// WFM.15 — Productive Utilization Model reconciliation.
// MANDATORY GATE: do not ship WFM.15 unless both cases below report OK.
// ============================================================

/**
 * WFM.15 §7 MANDATORY GATE. Reproduces the spec's two worked examples
 * EXACTLY against the live icpTargetFor_/holidayHoursForWeek_ formulas,
 * then logs the Headcount Gap capacity-FTE shift (legacy monthly roleCap
 * vs. the new weekly raw-capacity model) per team so the move is
 * explainable, not silent. Run from the editor; read View -> Logs.
 * If either case fails, DO NOT SHIP -- see WFM.15 §8 escalation.
 */
function _dbg_reconcileWFM15() {
  _dbg_requireAdmin_();
  const settings = readSettings_();
  let failures = 0;

  // ---- Case A: single-holiday week (spec's worked example) ----
  // P6 Delivery/EM worker, one 8h holiday in the week, a 16h PTO/Holiday
  // PSA row (excluded from productive demand by the productiveWeekly /
  // workerWeekly split in computeWeeklyForecast_ -- proven separately by
  // inspection, not re-derived here), productive demand given as 30h.
  // Exercises icpTargetFor_ + the icpUtil/financeUtil/ratioToTarget math
  // in api_getForecastTable end to end.
  (function caseA() {
    Logger.log('=== WFM.15 Case A: single-holiday week (P6 Delivery/EM) ===');
    const rawCap = readRawCapacity_(settings);           // expect 40
    const holidayHrs = 8;                                 // one holiday in the week
    const icpAvailable = rawCap - holidayHrs;              // expect 32
    const productiveDemand = 30;                            // given (PTO/Holiday 16h excluded)
    const financeUtil = rawCap > 0 ? productiveDemand / rawCap : 0;         // expect 0.75
    const icpUtil = icpAvailable > 0 ? productiveDemand / icpAvailable : 0; // expect 0.9375
    const icpTarget = icpTargetFor_('EM', 'P6 Delivery Consultant', settings); // expect 0.61
    const ratioToTarget = icpTarget > 0 ? icpUtil / icpTarget : 0;           // expect ~1.537

    Logger.log('  rawCapacity=' + rawCap + ' (expect 40)');
    Logger.log('  icpAvailable=' + icpAvailable.toFixed(2) + ' (expect 32.00)');
    Logger.log('  financeUtil=' + (financeUtil * 100).toFixed(1) + '% (expect 75.0%)');
    Logger.log('  icpUtil=' + (icpUtil * 100).toFixed(2) + '% (expect 93.75%)');
    Logger.log('  icpTarget=' + (icpTarget * 100).toFixed(0) + '% (expect 61%)');
    Logger.log('  ratioToTarget=' + (ratioToTarget * 100).toFixed(1) + '% (expect 153.7%, over/red)');

    const ok = Math.abs(rawCap - 40) < 1e-9 &&
      Math.abs(icpAvailable - 32) < 1e-9 &&
      Math.abs(financeUtil - 0.75) < 1e-9 &&
      Math.abs(icpUtil - 0.9375) < 1e-9 &&
      Math.abs(icpTarget - 0.61) < 1e-9 &&
      Math.abs(ratioToTarget - 1.537) < 0.001;
    Logger.log(ok ? '  Case A: OK' : '  Case A: FAILED — DO NOT SHIP');
    if (!ok) failures++;
  })();

  // ---- Case B: double-holiday week (real calendar + real worker) ----
  // Finds the real Config_Calendar week containing Thanksgiving + the Day
  // After (11/26-27) or Christmas Eve + Day (12/24-25) -- whichever exists
  // in the uploaded data -- and proves holidayHoursForWeek_ sums both
  // holidays (16h), then spot-checks a real worker's
  // productiveDemand / icpAvailable in that week.
  (function caseB() {
    Logger.log('=== WFM.15 Case B: double-holiday week ===');
    const rawCap = readRawCapacity_(settings);
    const holidays = readHolidays_();
    const calendar = readCalendar_();

    let targetWeek = null, targetHrs = 0;
    for (let i = 0; i < calendar.weeks.length; i++) {
      const wk = calendar.weeks[i];
      const hrs = holidayHoursForWeek_(wk.week_start, holidays);
      if (hrs === 16) { targetWeek = wk; targetHrs = hrs; break; }
    }

    if (!targetWeek) {
      Logger.log('  No Config_Calendar week found with 16h of holidays -- upload data ' +
        'covering Thanksgiving week (11/26-27) or Christmas week (12/24-25) to run this check.');
      Logger.log('  Case B: SKIPPED (no matching week in current planning data -- not a failure)');
      return;
    }

    const icpAvailable = rawCap - targetHrs; // expect 24
    Logger.log('  week_key=' + targetWeek.week_key);
    Logger.log('  holidayHours=' + targetHrs + ' (expect 16 — proves holidayHoursForWeek_ sums multiple holidays)');
    Logger.log('  icpAvailable=' + icpAvailable + ' (expect 24)');

    const ok = (targetHrs === 16) && Math.abs(icpAvailable - 24) < 1e-9;

    // Spot-check a real worker: productive demand (PTO/Holiday PSA rows
    // excluded) in this exact week, reconciled against icpAvailable=24.
    const allocRaw = (typeof getEnrichedAllocations_ === 'function')
      ? getEnrichedAllocations_() : cachedRead_(ALLOC_NORM);
    const byWorker = {};
    allocRaw.forEach(function (a) {
      if (a.week_key !== targetWeek.week_key) return;
      if (a.allocation_type === 'PTO_Holiday') return; // excluded from productive demand
      const h = Number(a.hours) || 0;
      if (!h) return;
      byWorker[a.resource_name] = (byWorker[a.resource_name] || 0) + h;
    });
    const sampleWorker = Object.keys(byWorker).sort()[0];
    if (sampleWorker) {
      const productiveDemand = byWorker[sampleWorker];
      const icpUtil = icpAvailable > 0 ? productiveDemand / icpAvailable : 0;
      Logger.log('  Sample worker: ' + sampleWorker);
      Logger.log('  productiveDemand=' + productiveDemand.toFixed(2) + 'h -> icpUtil = ' +
        productiveDemand.toFixed(2) + ' / ' + icpAvailable + ' = ' + (icpUtil * 100).toFixed(2) + '%');
    } else {
      Logger.log('  No worker has non-PTO allocation hours in this week — cannot spot-check a real worker.');
    }

    Logger.log(ok ? '  Case B: OK' : '  Case B: FAILED — DO NOT SHIP');
    if (!ok) failures++;
  })();

  // ---- Headcount Gap capacity FTE: before (roleCap/160) vs after (raw-capacity), per team ----
  // The legacy model gave every SLG worker a flat 160h/mo (all shipped
  // Config_Roles defaults are 160) -> capFte=160/HEADCOUNT_FTE_BASE(160)=
  // 1.0 per worker. The new model gives every worker raw_weekly_capacity x
  // 52/12 h/mo -> capFte=that/160. Both are FLAT per-worker multipliers
  // (raw capacity has no per-role/per-team variation), so "before" per
  // team = "after" per team / conversionFactor. Logged so the shift is
  // explainable, not silent.
  (function fteShift() {
    Logger.log('=== WFM.15: Headcount Gap capacity FTE shift, per team (before vs after) ===');
    const HEADCOUNT_FTE_BASE = 160; // matches Engine.gs computeUtilization step 10
    const legacyRoleCapDefault = 160; // every shipped Config_Roles default is 160/mo
    const rawMonthlyEquiv = readRawCapacity_(settings) * (52 / 12);
    const conversionFactor = rawMonthlyEquiv / legacyRoleCapDefault;

    Logger.log('  Per-worker monthly capacity: before (legacy roleCap default)=' +
      legacyRoleCapDefault.toFixed(2) + 'h -> capFte=' + (legacyRoleCapDefault / HEADCOUNT_FTE_BASE).toFixed(4));
    Logger.log('  Per-worker monthly capacity: after (raw_weekly_capacity=' + readRawCapacity_(settings) +
      'h/wk x 52/12)=' + rawMonthlyEquiv.toFixed(2) + 'h -> capFte=' + (rawMonthlyEquiv / HEADCOUNT_FTE_BASE).toFixed(4));
    Logger.log('  Flat per-worker shift: x' + conversionFactor.toFixed(4) + ' (' +
      (((conversionFactor - 1) * 100)).toFixed(1) + '%) applied uniformly to every SLG worker.');

    try {
      const dash = api_getDashboard({
        viewMode: 'Committed', groupBy: 'Function', workerScope: 'SLG',
        includeMyManagers: false, teams: null, quarter: null, includeTimeOff: true
      });
      (dash.headcountByTeam || []).forEach(function (t) {
        const afterFte = Number(t.capacityFte) || 0;
        const beforeFte = conversionFactor > 0 ? afterFte / conversionFactor : 0;
        Logger.log('  ' + t.team + ': before=' + beforeFte.toFixed(2) + ' FTE, after=' +
          afterFte.toFixed(2) + ' FTE (delta ' + (afterFte - beforeFte >= 0 ? '+' : '') +
          (afterFte - beforeFte).toFixed(2) + ' FTE)');
      });
    } catch (e) {
      Logger.log('  (live per-team pull failed, non-fatal — the flat conversionFactor above still holds: ' + e + ')');
    }
  })();

  Logger.log(failures === 0
    ? '_dbg_reconcileWFM15: ALL CASES OK'
    : '_dbg_reconcileWFM15: ' + failures + ' CASE(S) FAILED — DO NOT SHIP');
}
/**
 * Phase 0 gate: verify every non-excluded SLG worker got an employee_id
 * after re-normalize. A blank ID would silently fail the Phase 1 actuals join.
 */
function _dbg_verifyEmployeeIds() {
  _dbg_requireAdmin_();
  var rows = readTable_(ALLOC_NORM);
  var excluded = (typeof readExclusions_ === 'function') ? readExclusions_() : new Set();
  var byWorker = {};      // name -> { id, wc }
  rows.forEach(function (r) {
    var nm = String(r.resource_name || '').trim();
    if (!nm) return;
    if (!byWorker[nm]) byWorker[nm] = { id: String(r.employee_id || '').trim(), wc: String(r.worker_class || '') };
    else if (!byWorker[nm].id && r.employee_id) byWorker[nm].id = String(r.employee_id).trim();
  });
  var total = 0, withId = 0, blanks = [];
  Object.keys(byWorker).forEach(function (nm) {
    var w = byWorker[nm];
    var isSlg = (w.wc === 'SLG_Real' || w.wc === 'SLG_Generic');
    if (!isSlg) return;
    // Skip excluded workers (managers/on-leave) — they need no join.
    var key = (typeof _exclusionKey_ === 'function') ? _exclusionKey_(nm) : nm.toLowerCase();
    if (excluded.has(key)) return;
    total++;
    if (w.id) withId++; else blanks.push(nm);
  });
  Logger.log('_dbg_verifyEmployeeIds: ' + withId + ' / ' + total + ' non-excluded SLG workers have an employee_id');
  if (blanks.length) {
    Logger.log('  BLANKS (' + blanks.length + ') — investigate: ' + JSON.stringify(blanks));
    Logger.log('  RESULT: FAILED — these will not join to actuals in Phase 1');
  } else {
    Logger.log('  RESULT: OK — every non-excluded SLG worker has an employee_id');
  }
}

/**
 * WFM.16 §9 MANDATORY GATE. Proves ingest reconcile, join, blend precedence,
 * seam correctness, and forecast data retention. Run from the editor;
 * read View -> Logs. Do not ship if any check fails.
 */
function _dbg_reconcileActualsBlend() {
  _dbg_requireAdmin_();
  var failures = [];

  // 1) Ingest reconciles: weekly sum == QTD from Actuals_Worker_Summary.
  try {
    var summaryRows = readTable_(ACTUALS_SUMMARY);
    if (!summaryRows.length) {
      failures.push('Check 1: Actuals_Worker_Summary is empty');
    } else {
      var sample = summaryRows[0];
      var empId = String(sample.employee_id || '').trim();
      var qtdExpected = Number(sample.qtd_actual_icp_hours) || 0;
      var normRows = readTable_(ACTUALS_NORM);
      var weekSum = 0;
      normRows.forEach(function (r) {
        if (String(r.employee_id || '').trim() === empId) {
          weekSum += Number(r.actual_icp_hours) || 0;
        }
      });
      Logger.log('Check 1 ingest reconcile: employee_id=' + empId +
        ' weekSum=' + weekSum.toFixed(2) + ' qtd=' + qtdExpected.toFixed(2));
      if (Math.abs(weekSum - qtdExpected) > 0.01) {
        failures.push('Check 1: week sum ' + weekSum + ' != qtd ' + qtdExpected + ' for ' + empId);
      }
    }
  } catch (e) {
    failures.push('Check 1: ' + e.message);
  }

  // 2) Join works: Actuals employee_ids match Allocations employee_ids.
  try {
    var actualEmpIds = {};
    var actualIdToName = {};
    readTable_(ACTUALS_SUMMARY).forEach(function (r) {
      var eid = String(r.employee_id || '').trim();
      if (!eid) return;
      actualEmpIds[eid] = true;
      actualIdToName[eid] = String(r.resource_name || '').trim();
    });
    var allocEmpIds = {};
    readTable_(ALLOC_NORM).forEach(function (r) {
      var eid = String(r.employee_id || '').trim();
      if (eid) allocEmpIds[eid] = true;
    });
    var excluded = (typeof readExclusions_ === 'function') ? readExclusions_() : new Set();
    var matched = 0, unmatchedNonExcluded = 0, unmatchedIds = [];
    Object.keys(actualEmpIds).forEach(function (eid) {
      if (allocEmpIds[eid]) {
        matched++;
        return;
      }
      var name = actualIdToName[eid];
      if (name && excluded.has(_exclusionKey_(name))) return;
      unmatchedNonExcluded++;
      unmatchedIds.push(eid);
    });
    Logger.log('Check 2 join: matched=' + matched + ' unmatched (non-excluded)=' + unmatchedNonExcluded);
    if (unmatchedIds.length) {
      Logger.log('  unmatched employee_ids: ' + JSON.stringify(unmatchedIds));
    }
    if (unmatchedNonExcluded > 0) {
      failures.push('Check 2: ' + unmatchedNonExcluded + ' non-excluded actual employee_id(s) unmatched');
    }
  } catch (e) {
    failures.push('Check 2: ' + e.message);
  }

  // 3) Blend precedence: actual wins when both actual and forecast exist.
  try {
    var forecast = computeWeeklyForecast_({ workerScope: 'All' });
    var actualsMap = (typeof getActualsByWorkerWeek_ === 'function') ? getActualsByWorkerWeek_() : {};
    var blendChecked = false;
    forecast.workers.forEach(function (w) {
      if (!w.employeeId || !w.blendedWeekly || !actualsMap[w.employeeId]) return;
      var wActuals = actualsMap[w.employeeId];
      Object.keys(wActuals).forEach(function (wk) {
        if (!w.workerWeekly[wk]) return;
        var cell = w.blendedWeekly[wk];
        var expected = Number(wActuals[wk]) || 0;
        if (!cell || !cell.isActual || Number(cell.hours) !== expected) {
          failures.push('Check 3: blend precedence failed for ' + w.resource + ' week ' + wk);
        } else {
          blendChecked = true;
          Logger.log('Check 3 blend precedence: worker=' + w.resource + ' week=' + wk +
            ' actual=' + cell.hours + ' isActual=true');
        }
      });
    });
    if (!blendChecked) {
      Logger.log('Check 3: no overlapping actual+forecast week found to spot-check');
    }
  } catch (e) {
    failures.push('Check 3: ' + e.message);
  }

  // 4) Seam correctness.
  try {
    var forecast2 = computeWeeklyForecast_({ workerScope: 'All' });
    var visibleWeeks = _deriveVisibleWeeksFiscal_(forecast2.weeks);
    var seamWeekKey = '';
    visibleWeeks.forEach(function (vw) {
      var wk = String(vw.week_key);
      var hasActual = forecast2.workers.some(function (w) {
        var cell = w.blendedWeekly && w.blendedWeekly[wk];
        return cell && cell.isActual;
      });
      if (hasActual) seamWeekKey = wk;
    });
    Logger.log('Check 4 seamWeekKey=' + seamWeekKey);
    visibleWeeks.forEach(function (vw) {
      var wk = String(vw.week_key);
      var anyActual = forecast2.workers.some(function (w) {
        var cell = w.blendedWeekly && w.blendedWeekly[wk];
        return cell && cell.isActual;
      });
      if (seamWeekKey && wk <= seamWeekKey && !anyActual) {
        failures.push('Check 4: week ' + wk + ' <= seam but no worker has isActual');
      }
      if (seamWeekKey && wk > seamWeekKey && anyActual) {
        failures.push('Check 4: week ' + wk + ' > seam but has actual');
      }
    });
  } catch (e) {
    failures.push('Check 4: ' + e.message);
  }

  // 5) No forecast data loss: workerWeekly intact alongside blendedWeekly.
  try {
    var forecast3 = computeWeeklyForecast_({ workerScope: 'All' });
    var lossCount = 0;
    forecast3.workers.forEach(function (w) {
      if (!w.blendedWeekly || typeof w.workerWeekly !== 'object') {
        lossCount++;
        return;
      }
      Object.keys(w.workerWeekly).forEach(function (wk) {
        var cell = w.blendedWeekly[wk];
        if (!cell || cell.isActual) return;
        if (Number(cell.hours) !== Number(w.workerWeekly[wk])) {
          lossCount++;
        }
      });
    });
    Logger.log('Check 5: workerWeekly intact alongside blendedWeekly for ' +
      forecast3.workers.length + ' workers');
    if (lossCount > 0) {
      failures.push('Check 5: ' + lossCount + ' worker(s) missing or mismatched forecast data');
    }
  } catch (e) {
    failures.push('Check 5: ' + e.message);
  }

  if (failures.length) {
    failures.forEach(function (f) { Logger.log('  FAIL: ' + f); });
    Logger.log('_dbg_reconcileActualsBlend: ' + failures.length + ' CHECK(S) FAILED — DO NOT SHIP');
  } else {
    Logger.log('_dbg_reconcileActualsBlend: ALL CHECKS OK');
  }
}

// ============================================================
// WFM.17 — Quarterly scorecard + dashboard KPI reconciliation.
// MANDATORY GATE: do not ship WFM.17 unless ALL CHECKS OK.
// ============================================================

/**
 * WFM.17 mandatory gate. Validates quarterly targets, source reconciliation,
 * team aggregation, worker scope, and dashboard KPI alignment.
 */
function _dbg_reconcileWFM17() {
  _dbg_requireAdmin_();
  var failures = [];
  var settings = readSettings_();
  var holidays = readHolidays_();

  // Ensure January 2027 holidays are present.
  if (typeof ensureHolidays2027Jan_ === 'function') ensureHolidays2027Jan_();
  if (typeof api_flushCaches === 'function') api_flushCaches();
  holidays = readHolidays_();

  var hasJan2027 = holidays.some(function (h) {
    return h.date.getFullYear() === 2027 && h.date.getMonth() === 0;
  });
  if (!hasJan2027) {
    failures.push('January 2027 holidays missing from Config_Holidays');
  }

  // ---- Target reconciliation: Consulting P3–P5 (Aidan) ----
  (function consultingTargets() {
    Logger.log('=== WFM.17 Consulting P3–P5 target reconciliation (Aidan profile) ===');
    var expected = { 'FY27-Q2': 375.76, 'FY27-Q3': 388.08, 'FY27-Q4': 357.28 };
    var staleQ4 = 369.6;
    Object.keys(expected).forEach(function (qk) {
      var got = quarterTargetHoursFor_('CS_FUNC', 'P4 Consulting', qk, holidays, settings);
      var exp = expected[qk];
      var ok = Math.abs(got - exp) < 0.02;
      Logger.log('  ' + qk + ': got=' + got.toFixed(2) + ' expect=' + exp.toFixed(2) + (ok ? ' OK' : ' FAILED'));
      if (!ok) failures.push('Consulting target ' + qk + ': got ' + got.toFixed(2) + ' expect ' + exp);
      if (qk === 'FY27-Q4') {
        Logger.log('  FY27-Q4 stale workbook target=' + staleQ4 + ' (expected difference — Jan 2027 holidays applied)');
      }
    });
  })();

  // ---- Target reconciliation: P6 (Larry / Phil profile) ----
  (function p6Targets() {
    Logger.log('=== WFM.17 P6 target reconciliation ===');
    var expected = { 'FY27-Q2': 297.68, 'FY27-Q3': 307.44, 'FY27-Q4': 283.04 };
    Object.keys(expected).forEach(function (qk) {
      var got = quarterTargetHoursFor_('EM', 'P6 Delivery Consultant', qk, holidays, settings);
      var exp = expected[qk];
      var ok = Math.abs(got - exp) < 0.02;
      Logger.log('  ' + qk + ': got=' + got.toFixed(2) + ' expect=' + exp.toFixed(2) + (ok ? ' OK' : ' FAILED'));
      if (!ok) failures.push('P6 target ' + qk + ': got ' + got.toFixed(2) + ' expect ' + exp);
    });
  })();

  // ---- Current-quarter source reconciliation ----
  (function currentQuarterSource() {
    Logger.log('=== WFM.17 current-quarter source reconciliation ===');
    var summaryRows = readTable_(ACTUALS_SUMMARY);
    var sample = summaryRows.find(function (r) {
      return Number(r.qtd_icp_plus_forecast_hours) > 0 &&
        Number(r.bonus_target_billable_hours_eoq) > 0;
    });
    if (!sample) {
      Logger.log('  SKIPPED — no worker with qtd_icp_plus_forecast + bonus target in Actuals_Worker_Summary');
      return;
    }
    var prod = Number(sample.qtd_icp_plus_forecast_hours);
    var tgt = Number(sample.bonus_target_billable_hours_eoq);
    var attainment = tgt > 0 ? prod / tgt : 0;
    Logger.log('  sample worker=' + sample.resource_name + ' empId=' + sample.employee_id);
    Logger.log('  qtd_icp_plus_forecast_hours=' + prod + ' bonus_target=' + tgt +
      ' attainment=' + (attainment * 100).toFixed(2) + '%');

    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    var workerRow = (scorecard.workers || []).find(function (w) {
      return w.employeeId === String(sample.employee_id).trim();
    });
    if (!workerRow) {
      failures.push('Current-quarter sample worker not in scorecard');
      return;
    }
    var curQ = fiscalQuarterKey_(new Date());
    var curQuarter = (workerRow.quarters || []).find(function (q) { return q.quarterKey === curQ; });
    if (!curQuarter) {
      failures.push('Current quarter missing from scorecard sample worker');
      return;
    }
    var ok = Math.abs(curQuarter.bonusAttainment - attainment) < 1e-6;
    Logger.log('  scorecard bonusAttainment=' + (curQuarter.bonusAttainment * 100).toFixed(2) + '%' +
      (ok ? ' OK' : ' FAILED'));
    if (!ok) failures.push('Current-quarter bonus attainment mismatch for ' + sample.resource_name);
  })();

  // ---- Future-quarter formula reconciliation ----
  (function futureQuarterFormula() {
    Logger.log('=== WFM.17 future-quarter formula reconciliation ===');
    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    var curQ = fiscalQuarterKey_(new Date());
    var futureKeys = (scorecard.quarterKeys || []).filter(function (qk) { return qk !== curQ; });
    if (!futureKeys.length) {
      Logger.log('  SKIPPED — no future quarters');
      return;
    }
    var fk = futureKeys[0];
    var sample = (scorecard.workers || []).find(function (w) {
      var q = (w.quarters || []).find(function (qq) { return qq.quarterKey === fk; });
      return q && q.productiveHours > 0 && q.source === 'forecast';
    });
    if (!sample) {
      Logger.log('  SKIPPED — no worker with forecast productive hours in ' + fk);
      return;
    }
    var q = sample.quarters.find(function (qq) { return qq.quarterKey === fk; });
    Logger.log('  worker=' + sample.worker + ' quarter=' + fk);
    Logger.log('  forecast productive=' + q.productiveHours.toFixed(2) +
      ' target=' + q.targetHours.toFixed(2) +
      ' tracking=' + q.trackingHours.toFixed(2));
    Logger.log('  bonusAttainment=' + (q.bonusAttainment * 100).toFixed(2) + '%' +
      ' icpUtil=' + (q.icpUtil * 100).toFixed(2) + '%' +
      ' financeUtil=' + (q.financeUtil * 100).toFixed(2) + '%' +
      ' ratioToTarget=' + (q.ratioToTarget * 100).toFixed(2) + '%');
    var expBonus = q.targetHours > 0 ? q.productiveHours / q.targetHours : 0;
    if (Math.abs(q.bonusAttainment - expBonus) > 1e-6) {
      failures.push('Future-quarter bonus attainment formula mismatch for ' + sample.worker);
    }
  })();

  // ---- Team aggregation reconciliation ----
  (function teamAgg() {
    Logger.log('=== WFM.17 team aggregation reconciliation ===');
    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    (scorecard.quarterKeys || []).forEach(function (qk, qi) {
      var sumProd = 0, sumIcpAvail = 0, sumRawCap = 0, sumTarget = 0;
      (scorecard.workers || []).forEach(function (w) {
        var q = w.quarters[qi];
        if (!q) return;
        sumProd += q.productiveHours;
        sumIcpAvail += q.icpAvailableHours;
        sumRawCap += q.rawCapacityHours;
        sumTarget += q.targetHours;
      });
      var team = scorecard.teamSummary[qi];
      var icpOk = Math.abs(team.icpUtil - (sumIcpAvail > 0 ? sumProd / sumIcpAvail : 0)) < 1e-9;
      var finOk = Math.abs(team.financeUtil - (sumRawCap > 0 ? sumProd / sumRawCap : 0)) < 1e-9;
      var bonusOk = Math.abs(team.bonusAttainment - (sumTarget > 0 ? sumProd / sumTarget : 0)) < 1e-9;
      Logger.log('  ' + qk + ': team icp=' + (team.icpUtil * 100).toFixed(2) + '%' +
        ' finance=' + (team.financeUtil * 100).toFixed(2) + '%' +
        ' bonus=' + (team.bonusAttainment * 100).toFixed(2) + '%' +
        (icpOk && finOk && bonusOk ? ' OK' : ' FAILED'));
      if (!icpOk || !finOk || !bonusOk) failures.push('Team summary mismatch for ' + qk);
    });
  })();

  // ---- Dashboard KPI alignment (Stage 2 gate) ----
  (function dashboardKpiAlign() {
    Logger.log('=== WFM.17 dashboard KPI alignment (blended fiscal window) ===');
    var params = { viewMode: 'Committed', groupBy: 'Function', workerScope: 'SLG' };
    var filterParams = dashboardKpiFilterParams_(params);
    var dash = api_getDashboard(params);
    var blended = computeBlendedWindowKpis_(filterParams);
    var icpOk = Math.abs(dash.kpis.avgIcpProductiveUtilization - blended.avgIcpProductiveUtilization) < 1e-9;
    var finOk = Math.abs(dash.kpis.avgFinancialUtilization - blended.avgFinancialUtilization) < 1e-9;
    var prodOk = Math.abs(dash.kpis.totalProductiveHours - blended.totalProductiveHours) < 0.01;
    Logger.log('  dashboard avgIcp=' + (dash.kpis.avgIcpProductiveUtilization * 100).toFixed(2) + '%' +
      ' blended=' + (blended.avgIcpProductiveUtilization * 100).toFixed(2) + '%' + (icpOk ? ' OK' : ' MISMATCH'));
    Logger.log('  dashboard avgFin=' + (dash.kpis.avgFinancialUtilization * 100).toFixed(2) + '%' +
      ' blended=' + (blended.avgFinancialUtilization * 100).toFixed(2) + '%' + (finOk ? ' OK' : ' MISMATCH'));
    Logger.log('  dashboard totalProductive=' + dash.kpis.totalProductiveHours +
      ' blended=' + blended.totalProductiveHours + (prodOk ? ' OK' : ' MISMATCH'));
    if (!icpOk) failures.push('Dashboard avgIcpProductiveUtilization != computeBlendedWindowKpis_');
    if (!finOk) failures.push('Dashboard avgFinancialUtilization != computeBlendedWindowKpis_');
    if (!prodOk) failures.push('Dashboard totalProductiveHours != computeBlendedWindowKpis_');
  })();

  // ---- No invalid workers ----
  (function workerValidity() {
    Logger.log('=== WFM.17 worker validity ===');
    var excluded = readExclusions_();
    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    var blankIds = [];
    var blankRoles = [];
    (scorecard.workers || []).forEach(function (w) {
      if (excluded.has(_exclusionKey_(w.worker))) {
        failures.push('Excluded worker in scorecard: ' + w.worker);
      }
      if (!w.employeeId) blankIds.push(w.worker);
      if (!w.icpRole) blankRoles.push(w.worker);
    });
    if (blankIds.length) {
      Logger.log('  Workers with blank Employee ID (' + blankIds.length + '): ' +
        JSON.stringify(blankIds.slice(0, 5)));
      failures.push(blankIds.length + ' worker(s) with blank Employee ID');
    } else {
      Logger.log('  No non-excluded worker has blank Employee ID — OK');
    }
    if (blankRoles.length) {
      Logger.log('  Workers with blank ICP role (fallback target warning): ' +
        JSON.stringify(blankRoles.slice(0, 5)));
    }
  })();

  Logger.log(failures.length === 0
    ? '_dbg_reconcileWFM17: ALL CHECKS OK'
    : '_dbg_reconcileWFM17: ' + failures.length + ' CHECK(S) FAILED — DO NOT SHIP');
  failures.forEach(function (f) { Logger.log('  FAIL: ' + f); });
}

// ============================================================
// WFM.18 mandatory gate: Resource Detail V2 cross-view parity.
// MANDATORY GATE: do not ship WFM.18 unless ALL CHECKS OK.
// ============================================================

/**
 * WFM.18 mandatory gate. Validates week/quarter/blended parity between
 * api_getResourceDetailV2 and canonical forecast/scorecard paths, plus
 * filter-pipeline behavior.
 */
function _dbg_reconcileWFM18() {
  _dbg_requireAdmin_();
  var failures = [];
  var TOL = 0.01;

  if (typeof api_flushCaches === 'function') api_flushCaches();

  function near_(a, b) {
    return Math.abs(Number(a) - Number(b)) <= TOL;
  }

  function resolveSampleWorkers_(rows) {
    var names = [];
    var aidan = (rows || []).find(function (r) { return r.worker === 'Aidan Votaw'; });
    if (aidan) names.push(aidan.worker);
    (rows || []).forEach(function (r) {
      if (/^Chad\b/i.test(r.worker) && names.indexOf(r.worker) < 0) names.push(r.worker);
      if (/^Galen\b/i.test(r.worker) && names.indexOf(r.worker) < 0) names.push(r.worker);
    });
    var p6 = (rows || []).find(function (r) {
      return String(r.level || '') === 'P6' || /P6/i.test(String(r.jobProfile || ''));
    });
    if (p6 && names.indexOf(p6.worker) < 0) names.push(p6.worker);
    return names;
  }

  function workerBlendedExpected_(worker, visibleWeeks, rawCapacity, holidayHoursByWeek) {
    var wProd = 0;
    var wIcpAvail = 0;
    var wRawCap = 0;
    (visibleWeeks || []).forEach(function (vw) {
      var wk = vw.week_key;
      var prod = productiveHoursForWeek_(worker, wk);
      var holidayHrs = Number(holidayHoursByWeek[wk] || 0);
      var icpAvail = rawCapacity - holidayHrs;
      wProd += prod;
      wIcpAvail += icpAvail;
      wRawCap += rawCapacity;
    });
    return {
      avgIcpProductiveUtilization: wIcpAvail > 0 ? wProd / wIcpAvail : 0,
      avgFinancialUtilization: wRawCap > 0 ? wProd / wRawCap : 0,
      totalProductiveHours: wProd
    };
  }

  var baseParams = {
    viewMode: 'Committed',
    workerScope: 'All',
    includeTimeOff: false
  };

  // ---- Check 1: cross-view week parity ----
  (function weekParity() {
    Logger.log('=== WFM.18 Check 1: cross-view week parity ===');
    var forecastTable = api_getForecastTable(baseParams);
    var sampleWorkers = resolveSampleWorkers_(forecastTable.rows);
    if (!sampleWorkers.length) {
      failures.push('No sample workers found for week parity');
      return;
    }
    sampleWorkers.forEach(function (workerName) {
      var v2 = api_getResourceDetailV2(Object.assign({ resource: workerName }, baseParams));
      if (!v2.found) {
        failures.push('Week parity: ' + workerName + ' not found in V2');
        return;
      }
      var ftRow = (forecastTable.rows || []).find(function (r) { return r.worker === workerName; });
      if (!ftRow) {
        failures.push('Week parity: ' + workerName + ' not in forecast table');
        return;
      }
      (v2.weeks || []).forEach(function (cell) {
        var ftCell = (ftRow.workerWeekly || []).find(function (c) { return c.weekKey === cell.weekKey; });
        if (!ftCell) {
          failures.push(workerName + ' missing week ' + cell.weekKey + ' in forecast table');
          return;
        }
        if (!near_(cell.hours, ftCell.hours)) {
          failures.push(workerName + ' ' + cell.weekKey + ' hours: V2=' + cell.hours + ' FT=' + ftCell.hours);
        }
        if (!near_(cell.icpUtil, ftCell.icpUtil)) {
          failures.push(workerName + ' ' + cell.weekKey + ' icpUtil: V2=' + cell.icpUtil + ' FT=' + ftCell.icpUtil);
        }
        if (!near_(cell.financeUtil, ftCell.financeUtil)) {
          failures.push(workerName + ' ' + cell.weekKey + ' financeUtil: V2=' + cell.financeUtil + ' FT=' + ftCell.financeUtil);
        }
      });
      Logger.log('  ' + workerName + (failures.length ? '' : ' OK'));
    });
  })();

  // ---- Check 2: quarter parity + anchors ----
  (function quarterParity() {
    Logger.log('=== WFM.18 Check 2: quarter parity ===');
    var scorecard = api_getQuarterlyScorecard(baseParams);
    var forecastTable = api_getForecastTable(baseParams);
    var sampleWorkers = resolveSampleWorkers_(forecastTable.rows);
    var curQ = fiscalQuarterKey_(new Date());

    sampleWorkers.forEach(function (workerName) {
      var v2 = api_getResourceDetailV2(Object.assign({ resource: workerName }, baseParams));
      var scRow = (scorecard.workers || []).find(function (w) { return w.worker === workerName; });
      if (!v2.found || !scRow) {
        failures.push('Quarter parity: missing row for ' + workerName);
        return;
      }
      (v2.quarters || []).forEach(function (q, qi) {
        var scQ = (scRow.quarters || [])[qi];
        if (!scQ) {
          failures.push(workerName + ' missing scorecard quarter index ' + qi);
          return;
        }
        ['productiveHours', 'targetHours', 'icpUtil', 'bonusAttainment'].forEach(function (field) {
          if (!near_(q[field], scQ[field])) {
            failures.push(workerName + ' ' + q.quarterKey + ' ' + field +
              ': V2=' + q[field] + ' SC=' + scQ[field]);
          }
        });
      });
      Logger.log('  ' + workerName + ' quarter cells checked');
    });

    // Aidan current-quarter attainment anchor (87.63%)
    var aidanV2 = api_getResourceDetailV2(Object.assign({ resource: 'Aidan Votaw' }, baseParams));
    if (aidanV2.found) {
      var aidanCur = (aidanV2.quarters || []).find(function (q) { return q.quarterKey === curQ; });
      if (!aidanCur) {
        failures.push('Aidan current quarter missing from V2');
      } else {
        var aidanPct = aidanCur.bonusAttainment * 100;
        var aidanOk = Math.abs(aidanPct - 87.63) <= TOL;
        Logger.log('  Aidan current-quarter attainment=' + aidanPct.toFixed(2) + '% (expect 87.63%)' +
          (aidanOk ? ' OK' : ' FAILED'));
        if (!aidanOk) {
          failures.push('Aidan current-quarter attainment: got ' + aidanPct.toFixed(2) + '% expect 87.63%');
        }
      }
    } else {
      failures.push('Aidan Votaw not found in V2 for attainment anchor');
    }

    // FY27 target anchors: Consulting (Aidan profile) and P6
    var consultingTargets = { 'FY27-Q2': 375.76, 'FY27-Q3': 388.08, 'FY27-Q4': 357.28 };
    var p6Targets = { 'FY27-Q2': 297.68, 'FY27-Q3': 307.44, 'FY27-Q4': 283.04 };
    var holidays = readHolidays_();
    var settings = readSettings_();

    Logger.log('  Consulting FY27 target anchors (Aidan profile):');
    Object.keys(consultingTargets).forEach(function (qk) {
      var got = quarterTargetHoursFor_('CS_FUNC', 'P4 Consulting', qk, holidays, settings);
      var exp = consultingTargets[qk];
      var ok = Math.abs(got - exp) <= TOL;
      Logger.log('    ' + qk + ': got=' + got.toFixed(2) + ' expect=' + exp.toFixed(2) + (ok ? ' OK' : ' FAILED'));
      if (!ok) failures.push('Consulting target ' + qk + ': got ' + got.toFixed(2) + ' expect ' + exp);
    });

    Logger.log('  P6 FY27 target anchors:');
    Object.keys(p6Targets).forEach(function (qk) {
      var got = quarterTargetHoursFor_('EM', 'P6 Delivery Consultant', qk, holidays, settings);
      var exp = p6Targets[qk];
      var ok = Math.abs(got - exp) <= TOL;
      Logger.log('    ' + qk + ': got=' + got.toFixed(2) + ' expect=' + exp.toFixed(2) + (ok ? ' OK' : ' FAILED'));
      if (!ok) failures.push('P6 target ' + qk + ': got ' + got.toFixed(2) + ' expect ' + exp);
    });

    // V2 appTargetHours on sample workers should match anchors for future quarters
    if (aidanV2.found) {
      Object.keys(consultingTargets).forEach(function (qk) {
        var q = (aidanV2.quarters || []).find(function (qq) { return qq.quarterKey === qk; });
        if (!q) return;
        if (!near_(q.appTargetHours, consultingTargets[qk])) {
          failures.push('Aidan V2 appTargetHours ' + qk + ': got ' + q.appTargetHours +
            ' expect ' + consultingTargets[qk]);
        }
      });
    }
    var p6Worker = (forecastTable.rows || []).find(function (r) {
      return String(r.level || '') === 'P6' || /P6/i.test(String(r.jobProfile || ''));
    });
    if (p6Worker) {
      var p6V2 = api_getResourceDetailV2(Object.assign({ resource: p6Worker.worker }, baseParams));
      if (p6V2.found) {
        Object.keys(p6Targets).forEach(function (qk) {
          var q = (p6V2.quarters || []).find(function (qq) { return qq.quarterKey === qk; });
          if (!q) return;
          if (!near_(q.appTargetHours, p6Targets[qk])) {
            failures.push(p6Worker.worker + ' V2 appTargetHours ' + qk + ': got ' + q.appTargetHours +
              ' expect ' + p6Targets[qk]);
          }
        });
      }
    }
  })();

  // ---- Check 3: blended-summary parity ----
  (function blendedParity() {
    Logger.log('=== WFM.18 Check 3: blended-summary parity ===');
    var forecast = computeWeeklyForecast_(baseParams);
    var visibleWeeks = _deriveVisibleWeeksFiscal_(forecast.weeks);
    var rawCapacity = Number(forecast.rawCapacity) || 40;
    var holidayHoursByWeek = forecast.holidayHoursByWeek || {};
    var forecastTable = api_getForecastTable(baseParams);
    var sampleWorkers = resolveSampleWorkers_(forecastTable.rows);

    sampleWorkers.forEach(function (workerName) {
      var w = (forecast.workers || []).find(function (fw) { return fw.resource === workerName; });
      var v2 = api_getResourceDetailV2(Object.assign({ resource: workerName }, baseParams));
      if (!w || !v2.found || !v2.blendedSummary) {
        failures.push('Blended parity: missing data for ' + workerName);
        return;
      }
      var expected = workerBlendedExpected_(w, visibleWeeks, rawCapacity, holidayHoursByWeek);
      var bs = v2.blendedSummary;
      if (!near_(bs.avgIcpProductiveUtilization, expected.avgIcpProductiveUtilization)) {
        failures.push(workerName + ' avgIcp: V2=' + bs.avgIcpProductiveUtilization +
          ' expected=' + expected.avgIcpProductiveUtilization);
      }
      if (!near_(bs.avgFinancialUtilization, expected.avgFinancialUtilization)) {
        failures.push(workerName + ' avgFinance: V2=' + bs.avgFinancialUtilization +
          ' expected=' + expected.avgFinancialUtilization);
      }
      Logger.log('  ' + workerName +
        ' avgIcp=' + (bs.avgIcpProductiveUtilization * 100).toFixed(2) + '%' +
        ' avgFin=' + (bs.avgFinancialUtilization * 100).toFixed(2) + '% OK');
    });
  })();

  // ---- Check 4: filter-pipeline parity ----
  (function filterPipeline() {
    Logger.log('=== WFM.18 Check 4: filter-pipeline parity ===');
    var ref = api_getReference();
    var resources = ref.resources || [];
    if (!resources.length) {
      failures.push('Filter pipeline: no resources in reference');
      return;
    }

    var byManager = {};
    resources.forEach(function (r) {
      if (!r.manager_org) return;
      if (!byManager[r.manager_org]) byManager[r.manager_org] = [];
      byManager[r.manager_org].push(r);
    });
    var mgrName = Object.keys(byManager).find(function (m) { return byManager[m].length >= 2; });
    if (!mgrName) mgrName = resources[0].manager_org || '';
    var teamLabel = (byManager[mgrName] && byManager[mgrName][0])
      ? String(byManager[mgrName][0].resolvedTeam || '').trim()
      : '';

    var filterParams = {
      viewMode: 'Scenario',
      teams: mgrName ? [mgrName] : null,
      teamLabel: teamLabel || null,
      workerScope: 'SLG',
      includeMyManagers: true,
      includeTimeOff: false
    };

    var filteredTable = api_getForecastTable(filterParams);
    var broadTable = api_getForecastTable({
      viewMode: 'Scenario',
      workerScope: 'All',
      includeTimeOff: false
    });
    var filteredNames = {};
    (filteredTable.rows || []).forEach(function (r) { filteredNames[r.worker] = true; });

    var outWorker = (broadTable.rows || []).find(function (r) { return !filteredNames[r.worker]; });
    var inWorker = (filteredTable.rows || [])[0];

    if (outWorker) {
      var v2Out = api_getResourceDetailV2(Object.assign({ resource: outWorker.worker }, filterParams));
      var outOk = v2Out.found === false &&
        (v2Out.weeks || []).length === 0 &&
        (v2Out.quarters || []).length === 0 &&
        (v2Out.projects || []).length === 0 &&
        v2Out.blendedSummary === null;
      Logger.log('  out-of-scope ' + outWorker.worker + ': found=' + v2Out.found +
        (outOk ? ' OK' : ' FAILED'));
      if (!outOk) {
        failures.push('Out-of-scope worker ' + outWorker.worker + ' should return empty found:false payload');
      }
    } else {
      Logger.log('  out-of-scope worker: SKIPPED (no worker outside filtered set)');
    }

    if (!inWorker) {
      failures.push('Filter pipeline: no in-scope worker under filter params');
      return;
    }

    var v2In = api_getResourceDetailV2(Object.assign({ resource: inWorker.worker }, filterParams));
    if (!v2In.found) {
      failures.push('In-scope worker ' + inWorker.worker + ' not found in V2 under filter');
      return;
    }
    (v2In.weeks || []).forEach(function (cell) {
      var ftCell = (inWorker.workerWeekly || []).find(function (c) { return c.weekKey === cell.weekKey; });
      if (!ftCell) {
        failures.push(inWorker.worker + ' missing filtered week ' + cell.weekKey);
        return;
      }
      if (!near_(cell.hours, ftCell.hours) || !near_(cell.icpUtil, ftCell.icpUtil) ||
          !near_(cell.financeUtil, ftCell.financeUtil)) {
        failures.push('Filter pipeline week mismatch for ' + inWorker.worker + ' ' + cell.weekKey);
      }
    });
    Logger.log('  in-scope ' + inWorker.worker + ' week cells match forecast table OK');
  })();

  Logger.log(failures.length === 0
    ? '_dbg_reconcileWFM18: ALL CHECKS OK'
    : '_dbg_reconcileWFM18: ' + failures.length + ' CHECK(S) FAILED — DO NOT SHIP');
  failures.forEach(function (f) { Logger.log('  FAIL: ' + f); });
}
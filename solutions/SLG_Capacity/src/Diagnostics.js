// ============================================================
// Diagnostics.gs â€” investigative tools for administrators
//
// All functions here are intended to be run from the Apps Script
// editor (function dropdown â†’ Run), not from the web app UI.
// They write to Logger.log so View â†’ Logs shows the output.
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
// Admin guard â€” all _dbg_ functions call this first.
// ============================================================

/**
 * Throws if the calling user is not authorized as a diagnostics admin.
 *
 * Authorization sources (any match grants access):
 *   1. Spreadsheet owner (works on personal Drive, fails on Shared Drives
 *      because Shared Drive files have no individual owner)
 *   2. Config_Settings.admin_emails (comma-separated list â€” works
 *      everywhere, recommended for Shared Drive setups)
 *
 * The dual-path check mirrors the production access gate in
 * AccessControl.gs::isAuthorized_ which uses the same admin_emails setting.
 */
function _dbg_requireAdmin_() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) {
      throw new Error('Could not resolve active user â€” re-authorize the script.');
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
 * Dump the full Config_Resource_Type map (resource_type â†’ team_label).
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
 *   - Worker has no ICP_role â†’ either fix in PSA at ingest, or
 *     exclude via Config_Worker_Exclusions.
 *   - Worker has ICP_role but it's not in Config_Roles â†’ add the role
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
  const blankRole = {};       // resource_name â†’ { class, mgr, hours, monthsSeen }
  const unmappedRole = {};    // resource_name â†’ { role, class, mgr, hours, monthsSeen }

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
    Logger.log('  (none â€” clean)');
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
    Logger.log('  (none â€” clean)');
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
 *   A. MISMATCH â€” worker has ICP, ICP-team differs from manager-team.
 *      True override candidates (the Phil Dessaigne pattern).
 *
 *   B. UNCLASSIFIED â€” worker under SLG manager, blank or unmapped ICP.
 *      Bench/data hygiene; investigate the ingest classifier or
 *      add to Config_Worker_Exclusions. NOT an override case.
 *
 *   C. ALREADY OVERRIDDEN â€” worker in Config_Worker_Role_Overrides.
 *      Informational; confirms overrides are in effect.
 *
 * Excludes workers who are themselves SLG managers (managers don't
 * get ICP roles by design â€” their Job Profile is "M4 Sr Manager...").
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
      managerTeam[mgr] = 'Mixed';  // all reports unclassified â€” can't infer
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
  Logger.log('CATEGORY A â€” TRUE OVERRIDE CANDIDATES (mismatch, no override yet)');
  Logger.log('============================================================');
  Logger.log('Count: ' + catA.length);
  if (catA.length === 0) {
    Logger.log('  (none â€” clean)');
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
  Logger.log('CATEGORY B â€” UNCLASSIFIED (bench/data hygiene, not override)');
  Logger.log('============================================================');
  Logger.log('Count: ' + catB.length);
  if (catB.length === 0) {
    Logger.log('  (none â€” clean)');
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
  Logger.log('CATEGORY C â€” ALREADY OVERRIDDEN (informational)');
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
 * weekly-forecast-migration Â§6.6 reconciliation diagnostic #1: sum a
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
  Logger.log('RECONCILE: ' + (diff < 0.01 ? 'OK â€” totals match' : 'MISMATCH â€” investigate splitWeekAcrossMonths_'));
  Logger.log('Per-month breakdown: ' + JSON.stringify(byMonth));
}

/**
 * weekly-forecast-migration Â§6.6 reconciliation diagnostic #2: run
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
  Logger.log('RESULT: ' + (detection.weeks.length > 0 && (!hasTotalHoursCol || totalHoursExcluded) ? 'OK' : 'FAILED â€” see above'));
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
  // Does NOT call appendRow_ or updateRow_ â€” read-only.
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
      (a.scenario !== b.scenario ? ' â† MISMATCH' : '')
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
 * Goal: warm-call total time â‰¤ 30% of cold-call total time.
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
  Logger.log('Warm/cold ratio:                ' + (ratio * 100).toFixed(1) + '%  (goal â‰¤ 30%)');
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
 * Results appear in View â†’ Logs.
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
  // ... (full test scaffolding deferred â€” verify by running existing
  // Phase 5 PSA upload diagnostics instead)
  Logger.log('Phase 8 test stub â€” exercise by re-running Phase 5 diagnostics');
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
 * Strip this instrumentation once the real fix ships (see WFM-PERF.1 Â§6).
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
// WFM.15 â€” Productive Utilization Model reconciliation.
// MANDATORY GATE: do not ship WFM.15 unless both cases below report OK.
// ============================================================

/**
 * WFM.15 Â§7 MANDATORY GATE. Reproduces the spec's two worked examples
 * EXACTLY against the live icpTargetFor_/holidayHoursForWeek_ formulas,
 * then logs the Headcount Gap capacity-FTE shift (legacy monthly roleCap
 * vs. the new weekly raw-capacity model) per team so the move is
 * explainable, not silent. Run from the editor; read View -> Logs.
 * If either case fails, DO NOT SHIP -- see WFM.15 Â§8 escalation.
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
    Logger.log(ok ? '  Case A: OK' : '  Case A: FAILED â€” DO NOT SHIP');
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
    Logger.log('  holidayHours=' + targetHrs + ' (expect 16 â€” proves holidayHoursForWeek_ sums multiple holidays)');
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
      Logger.log('  No worker has non-PTO allocation hours in this week â€” cannot spot-check a real worker.');
    }

    Logger.log(ok ? '  Case B: OK' : '  Case B: FAILED â€” DO NOT SHIP');
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
      Logger.log('  (live per-team pull failed, non-fatal â€” the flat conversionFactor above still holds: ' + e + ')');
    }
  })();

  Logger.log(failures === 0
    ? '_dbg_reconcileWFM15: ALL CASES OK'
    : '_dbg_reconcileWFM15: ' + failures + ' CASE(S) FAILED â€” DO NOT SHIP');
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
    // Skip excluded workers (managers/on-leave) â€” they need no join.
    var key = (typeof _exclusionKey_ === 'function') ? _exclusionKey_(nm) : nm.toLowerCase();
    if (excluded.has(key)) return;
    total++;
    if (w.id) withId++; else blanks.push(nm);
  });
  Logger.log('_dbg_verifyEmployeeIds: ' + withId + ' / ' + total + ' non-excluded SLG workers have an employee_id');
  if (blanks.length) {
    Logger.log('  BLANKS (' + blanks.length + ') â€” investigate: ' + JSON.stringify(blanks));
    Logger.log('  RESULT: FAILED â€” these will not join to actuals in Phase 1');
  } else {
    Logger.log('  RESULT: OK â€” every non-excluded SLG worker has an employee_id');
  }
}

/**
 * WFM.16 Â§9 MANDATORY GATE. Proves ingest reconcile, join, blend precedence,
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
    Logger.log('_dbg_reconcileActualsBlend: ' + failures.length + ' CHECK(S) FAILED â€” DO NOT SHIP');
  } else {
    Logger.log('_dbg_reconcileActualsBlend: ALL CHECKS OK');
  }
}

// ============================================================
// WFM.17 â€” Quarterly scorecard + dashboard KPI reconciliation.
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

  // ---- WoW forward-target re-anchor (WFM.24 D5) ----
  (function wowForwardTargetReanchor() {
    Logger.log('=== WFM.17 WoW forward-target re-anchor (WFM.24 D5) ===');
    Logger.log('  audit oldâ†’new Consulting: FY27-Q3 388.08â†’369.60, FY27-Q4 357.28â†’369.60');
    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    var curQ = fiscalQuarterKey_(new Date());
    var futureKeys = (scorecard.quarterKeys || []).filter(function (qk) { return qk !== curQ; });
    var TARGET_TOL = 0.02;

    function checkWorkerForward_(workerName) {
      var wRow = (scorecard.workers || []).find(function (w) { return w.worker === workerName; });
      if (!wRow || !wRow.employeeId) {
        failures.push('WoW re-anchor: ' + workerName + ' not found in scorecard');
        return;
      }
      futureKeys.forEach(function (qk) {
        var q = (wRow.quarters || []).find(function (qq) { return qq.quarterKey === qk; });
        if (!q) return;
        var wow = quarterTargetFromWoW_(wRow.employeeId, qk);
        if (wow != null) {
          var ok = Math.abs(q.targetHours - wow) < TARGET_TOL;
          Logger.log('  ' + workerName + ' ' + qk + ': scorecard target=' +
            q.targetHours.toFixed(2) + ' WoW=' + wow.toFixed(2) + (ok ? ' OK' : ' FAILED'));
          if (!ok) {
            failures.push(workerName + ' ' + qk + ' targetHours=' + q.targetHours +
              ' expect WoW=' + wow);
          }
        } else {
          var okFb = Math.abs(q.targetHours - q.appTargetHours) < TARGET_TOL;
          Logger.log('  ' + workerName + ' ' + qk + ': no WoW row â€” formula fallback=' +
            q.targetHours.toFixed(2) + ' appTarget=' + q.appTargetHours.toFixed(2) +
            (okFb ? ' OK' : ' FAILED'));
          if (!okFb) {
            failures.push(workerName + ' ' + qk + ' formula fallback mismatch');
          }
        }
      });
    }

    checkWorkerForward_('Aidan Votaw');
    var p6 = (scorecard.workers || []).find(function (w) {
      return String(w.level || '') === 'P6' || /P6/i.test(String(w.icpRole || ''));
    });
    if (p6) {
      checkWorkerForward_(p6.worker);
    } else {
      Logger.log('  P6 sample worker not found â€” skip');
    }
  })();

  // ---- Target reconciliation: Consulting P3â€“P5 (Aidan) ----
  (function consultingFormulaFallback() {
    Logger.log('=== WFM.17 Consulting formula fallback (quarterTargetHoursFor_) ===');
    var expected = { 'FY27-Q2': 375.76, 'FY27-Q3': 388.08, 'FY27-Q4': 357.28 };
    Object.keys(expected).forEach(function (qk) {
      var got = quarterTargetHoursFor_('CS_FUNC', 'P4 Consulting', qk, holidays, settings);
      var exp = expected[qk];
      var ok = Math.abs(got - exp) < 0.02;
      Logger.log('  ' + qk + ': formula=' + got.toFixed(2) + ' (fallback reference=' + exp.toFixed(2) + ')' +
        (ok ? ' OK' : ' FAILED'));
      if (!ok) failures.push('Consulting formula fallback ' + qk + ': got ' + got.toFixed(2));
    });
  })();

  // ---- Target reconciliation: P6 (Larry / Phil profile) formula fallback ----
  (function p6FormulaFallback() {
    Logger.log('=== WFM.17 P6 formula fallback (quarterTargetHoursFor_) ===');
    var expected = { 'FY27-Q2': 297.68, 'FY27-Q3': 307.44, 'FY27-Q4': 283.04 };
    Object.keys(expected).forEach(function (qk) {
      var got = quarterTargetHoursFor_('EM', 'P6 Delivery Consultant', qk, holidays, settings);
      var exp = expected[qk];
      var ok = Math.abs(got - exp) < 0.02;
      Logger.log('  ' + qk + ': formula=' + got.toFixed(2) + ' (fallback reference=' + exp.toFixed(2) + ')' +
        (ok ? ' OK' : ' FAILED'));
      if (!ok) failures.push('P6 formula fallback ' + qk + ': got ' + got.toFixed(2));
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
      Logger.log('  SKIPPED â€” no worker with qtd_icp_plus_forecast + bonus target in Actuals_Worker_Summary');
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
      Logger.log('  SKIPPED â€” no future quarters');
      return;
    }
    var fk = futureKeys[0];
    var sample = (scorecard.workers || []).find(function (w) {
      var q = (w.quarters || []).find(function (qq) { return qq.quarterKey === fk; });
      return q && q.productiveHours > 0 && q.source === 'forecast';
    });
    if (!sample) {
      Logger.log('  SKIPPED â€” no worker with forecast productive hours in ' + fk);
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
      Logger.log('  No non-excluded worker has blank Employee ID â€” OK');
    }
    if (blankRoles.length) {
      Logger.log('  Workers with blank ICP role (fallback target warning): ' +
        JSON.stringify(blankRoles.slice(0, 5)));
    }
  })();

  Logger.log(failures.length === 0
    ? '_dbg_reconcileWFM17: ALL CHECKS OK'
    : '_dbg_reconcileWFM17: ' + failures.length + ' CHECK(S) FAILED â€” DO NOT SHIP');
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

    // Aidan current-quarter attainment anchor â€” was hard-coded 87.63%; now
    // self-computed from Actuals_Worker_Summary (qtd_icp_plus_forecast_hours /
    // bonus_target_billable_hours_eoq) so the gate survives data refresh.
    var ATTAIN_TOL = 0.001;
    var aidanSc = (scorecard.workers || []).find(function (w) { return w.worker === 'Aidan Votaw'; });
    var aidanV2 = api_getResourceDetailV2(Object.assign({ resource: 'Aidan Votaw' }, baseParams));
    var actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
      ? getActualsSummaryByEmployee_() : {};
    if (!aidanSc || !aidanV2.found) {
      failures.push('Aidan Votaw not found for attainment anchor');
    } else {
      var aidanCurSc = (aidanSc.quarters || []).find(function (q) { return q.quarterKey === curQ; });
      var summary = actualsSummary[String(aidanSc.employeeId || '').trim()];
      if (!aidanCurSc) {
        failures.push('Aidan current quarter missing from scorecard');
      } else if (!summary || !Number(summary.qtd_icp_plus_forecast_hours) ||
          !Number(summary.bonus_target_billable_hours_eoq)) {
        failures.push('Aidan actuals summary missing for current-quarter anchor');
      } else {
        var expectedAttainment = Number(summary.qtd_icp_plus_forecast_hours) /
          Number(summary.bonus_target_billable_hours_eoq);
        var aidanPct = aidanCurSc.bonusAttainment * 100;
        var expectedPct = expectedAttainment * 100;
        var aidanOk = Math.abs(aidanCurSc.bonusAttainment - expectedAttainment) <= ATTAIN_TOL;
        Logger.log('  Aidan current-quarter attainment=' + aidanPct.toFixed(2) +
          '% (self-computed expect=' + expectedPct.toFixed(2) + '%)' +
          (aidanOk ? ' OK' : ' FAILED'));
        if (!aidanOk) {
          failures.push('Aidan current-quarter attainment: scorecard=' + aidanPct.toFixed(2) +
            '% expected=' + expectedPct.toFixed(2) + '%');
        }
      }
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
    : '_dbg_reconcileWFM18: ' + failures.length + ' CHECK(S) FAILED â€” DO NOT SHIP');
  failures.forEach(function (f) { Logger.log('  FAIL: ' + f); });
}
// ============================================================
// WFM.23 ΓÇö Soft booking projection reconciliation (Stage 1).
// MANDATORY GATE: checks 1, 2, 3, 4, 5.
// ============================================================

/**
 * WFM.23 check 4 cleanup ΓÇö delete test assignments by id.
 * @param {string[]} ids
 */
function _dbg_wfm23DeleteAssignmentsByIds_(ids) {
  if (!ids || !ids.length) return;
  var idSet = {};
  ids.forEach(function (id) {
    if (id) idSet[String(id)] = true;
  });
  if (!Object.keys(idSet).length) return;
  var kept = readTable_(ASSIGNMENTS).filter(function (r) {
    return !idSet[String(r.assignment_id || '')];
  });
  writeTable_(ASSIGNMENTS, ASSIGN_HEADERS, kept.map(function (r) {
    return ASSIGN_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
  }));
  invalidateCache_(ASSIGNMENTS);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
}

/**
 * WFM.23 check 4 cleanup ΓÇö delete a test scenario by id.
 * @param {string} scenarioId
 */
function _dbg_wfm23DeleteScenarioById_(scenarioId) {
  if (!scenarioId) return;
  var kept = readTable_(SCENARIOS).filter(function (r) {
    return String(r.scenario_id) !== String(scenarioId);
  });
  writeTable_(SCENARIOS, SCENARIO_HEADERS, kept.map(function (r) {
    return SCENARIO_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
  }));
  invalidateCache_(SCENARIOS);
}

/**
 * Demand-affecting assignment fields for WFM.23 check 4 parity.
 * @param {Object} row
 * @return {Object}
 */
function _dbg_wfm23DemandFields_(row) {
  return {
    resource_name: String(row.resource_name || ''),
    start_date: String(row.start_date || '').slice(0, 10),
    end_date: String(row.end_date || '').slice(0, 10),
    estimated_hours: Number(row.estimated_hours) || 0,
    distribution: String(row.distribution || 'Even'),
    status: String(row.status || 'Modeled')
  };
}

/**
 * Stable weekly-expansion signature for parity checks.
 * @param {Object} assignRow
 * @param {Object} calendar
 * @return {string}
 */
function _dbg_wfm23WeeklySignature_(assignRow, calendar) {
  var weeks = expandAssignmentToWeekly_(assignRow, calendar) || [];
  return weeks.map(function (w) {
    return String(w.week_key || '') + ':' + (Number(w.hours) || 0).toFixed(4);
  }).sort().join('|');
}

/**
 * Compare two demand-field snapshots (near-equal on hours).
 * @param {Object} a
 * @param {Object} b
 * @param {number} tol
 * @return {boolean}
 */
function _dbg_wfm23DemandFieldsEqual_(a, b, tol) {
  tol = tol || 0.01;
  if (String(a.resource_name) !== String(b.resource_name)) return false;
  if (String(a.start_date) !== String(b.start_date)) return false;
  if (String(a.end_date) !== String(b.end_date)) return false;
  if (String(a.distribution) !== String(b.distribution)) return false;
  if (String(a.status) !== String(b.status)) return false;
  return Math.abs(Number(a.estimated_hours) - Number(b.estimated_hours)) <= tol;
}

/**
 * Runtime-pick a Director-scoped worker via api_projectSoftBookings baseline.
 * Shared by WFM.23 gate checks 2 and 3.
 * @param {Object} baseParams
 * @return {{params:Object, worker:Object, mgrName:string}|null}
 */
function _dbg_wfm23PickDirectorScopeWorker_(baseParams) {
  var mgrRows = readConfigSlgManagers_();
  var descendants = buildManagerDescendants_(mgrRows);
  var mgrName = '';
  mgrRows.some(function (r) {
    if ((descendants[r.manager_name] || []).length >= 1) {
      mgrName = r.manager_name;
      return true;
    }
    return false;
  });
  if (!mgrName) return null;
  var params = Object.assign({}, baseParams, {
    teams: [mgrName],
    includeMyManagers: true
  });
  var baselineOnly = api_projectSoftBookings(params, []);
  var workers = baselineOnly.baseline.worker || [];
  if (!workers.length) return null;
  return { params: params, worker: workers[0], mgrName: mgrName };
}

/**
 * WFM.23 Stage 1 gate. Self-computing checks; prints ALL CHECKS OK only
 * when every check passes. Run api_flushCaches first (check 5 does).
 */
function _dbg_reconcileWFM23() {
  _dbg_requireAdmin_();
  var failures = [];
  var TOL = 0.01;

  function near_(a, b) {
    return Math.abs(Number(a) - Number(b)) <= TOL;
  }

  function deepEqualProjection_(a, b, path) {
    path = path || '';
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return near_(a, b);
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!deepEqualProjection_(a[i], b[i], path + '[' + i + ']')) return false;
      }
      return true;
    }
    var keysA = Object.keys(a).sort();
    var keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    for (var k = 0; k < keysA.length; k++) {
      if (keysA[k] !== keysB[k]) return false;
      if (!deepEqualProjection_(a[keysA[k]], b[keysB[k]], path + '.' + keysA[k])) return false;
    }
    return true;
  }

  function snapshotAssignments_() {
    var rows = [];
    try { rows = cachedRead_(ASSIGNMENTS); } catch (e) { rows = []; }
    return JSON.stringify(rows.map(function (r) {
      return {
        assignment_id: String(r.assignment_id || ''),
        resource_name: String(r.resource_name || ''),
        status: String(r.status || ''),
        estimated_hours: Number(r.estimated_hours) || 0,
        start_date: r.start_date ? String(r.start_date) : '',
        end_date: r.end_date ? String(r.end_date) : ''
      };
    }).sort(function (a, b) {
      return String(a.assignment_id).localeCompare(String(b.assignment_id));
    }));
  }

  function snapshotAllocations_() {
    var rows = [];
    try { rows = cachedRead_(ALLOC_NORM); } catch (e) { rows = []; }
    return JSON.stringify(rows.map(function (r) {
      return {
        resource_name: String(r.resource_name || ''),
        week_key: String(r.week_key || ''),
        hours: Number(r.hours) || 0,
        allocation_type: String(r.allocation_type || '')
      };
    }).sort(function (a, b) {
      return String(a.resource_name + a.week_key).localeCompare(String(b.resource_name + b.week_key));
    }));
  }

  var baseParams = {
    viewMode: 'Committed',
    workerScope: 'SLG',
    includeTimeOff: false
  };

  // ---- Check 1: empty-overlay neutrality ----
  (function checkNeutrality() {
    Logger.log('=== WFM.23 Check 1: empty-overlay neutrality ===');
    var ref = api_getReference();
    var resources = ref.resources || [];
    var mgrRows = readConfigSlgManagers_();
    var descendants = buildManagerDescendants_(mgrRows);
    var mgrName = '';
    mgrRows.some(function (r) {
      if ((descendants[r.manager_name] || []).length >= 1) {
        mgrName = r.manager_name;
        return true;
      }
      return false;
    });
    var params = Object.assign({}, baseParams, {
      teams: mgrName ? [mgrName] : null,
      includeMyManagers: true
    });
    var result = api_projectSoftBookings(params, []);
    if (!deepEqualProjection_(result.baseline, result.projected, 'root')) {
      failures.push('Empty overlay: projected !== baseline');
      Logger.log('  FAILED: projected !== baseline');
      return;
    }
    var sampleWorkers = (result.baseline.worker || []).slice(0, 3);
    if (!sampleWorkers.length && resources.length) {
      Logger.log('  SKIPPED sample workers (no workers in scoped projection)');
    } else {
      sampleWorkers.forEach(function (w) {
        var pw = (result.projected.worker || []).find(function (x) {
          return x.resourceName === w.resourceName;
        });
        if (!pw || !deepEqualProjection_(w, pw, w.resourceName)) {
          failures.push('Neutrality worker mismatch: ' + w.resourceName);
        }
      });
    }
    if (!deepEqualProjection_(result.baseline.team, result.projected.team, 'team')) {
      failures.push('Empty overlay: team projected !== baseline');
    }
    if (!deepEqualProjection_(result.baseline.orgTeams, result.projected.orgTeams, 'orgTeams')) {
      failures.push('Empty overlay: orgTeams projected !== baseline');
    }
    Logger.log(failures.length ? '  Check 1: FAILED' : '  Check 1: OK');
  })();

  // ---- Check 2: baseline untouched (nothing persisted) ----
  (function checkBaselineUntouched() {
    Logger.log('=== WFM.23 Check 2: baseline untouched ===');
    var beforeAssign = snapshotAssignments_();
    var beforeAlloc = snapshotAllocations_();

    var picked = _dbg_wfm23PickDirectorScopeWorker_(baseParams);
    if (!picked) {
      failures.push('Check 2: no Director-scope worker found for projection call');
      return;
    }
    var worker = picked.worker;
    var params = picked.params;

    var futureQk = null;
    var today = new Date();
    rollingQuarterKeys_(8).forEach(function (qk) {
      if (futureQk) return;
      var bounds = fiscalQuarterBounds_(qk);
      if (bounds.start > today) futureQk = qk;
    });
    if (!futureQk) {
      failures.push('Check 2: no future fiscal quarter found');
      return;
    }
    var bounds = fiscalQuarterBounds_(futureQk);
    var booking = {
      employee_id: String(worker.employeeId),
      resource_name: String(worker.resourceName),
      start_date: _toIso_(bounds.start),
      end_date: _toIso_(bounds.end),
      total_hours: 25
    };
    api_projectSoftBookings(params, [booking]);

    var afterAssign = snapshotAssignments_();
    var afterAlloc = snapshotAllocations_();
    if (beforeAssign !== afterAssign) {
      failures.push('Check 2: Opportunity_Assignments changed after projection');
    }
    if (beforeAlloc !== afterAlloc) {
      failures.push('Check 2: Allocations_Normalized changed after projection');
    }
    Logger.log(failures.some(function (f) { return f.indexOf('Check 2') === 0; })
      ? '  Check 2: FAILED' : '  Check 2: OK');
  })();

  // ---- Check 3: injection correctness (self-computing expected N) ----
  (function checkInjection() {
    Logger.log('=== WFM.23 Check 3: injection correctness ===');
    var picked = _dbg_wfm23PickDirectorScopeWorker_(baseParams);
    if (!picked) {
      failures.push('Check 3: no Director with descendants / in-scope workers found');
      return;
    }
    var params = picked.params;
    var targetWorker = picked.worker;
    Logger.log('  Director scope: ' + picked.mgrName + ' worker: ' + targetWorker.resourceName);

    var baselineOnly = api_projectSoftBookings(params, []);
    var futureQk = null;
    var today = new Date();
    rollingQuarterKeys_(8).forEach(function (qk) {
      if (futureQk) return;
      var bounds = fiscalQuarterBounds_(qk);
      if (bounds.start > today) futureQk = qk;
    });
    if (!futureQk) {
      failures.push('Check 3: no future fiscal quarter found');
      return;
    }
    var bounds = fiscalQuarterBounds_(futureQk);
    var N = 40;
    var booking = {
      employee_id: targetWorker.employeeId,
      resource_name: targetWorker.resourceName,
      start_date: _toIso_(bounds.start),
      end_date: _toIso_(bounds.end),
      total_hours: N
    };

    var calendar = readCalendar_();
    var assignShape = {
      resource_name: booking.resource_name,
      start_date: bounds.start,
      end_date: bounds.end,
      estimated_hours: N,
      distribution: 'Even',
      status: 'Modeled'
    };
    var expectedN = 0;
    expandAssignmentToWeekly_(assignShape, calendar).forEach(function (w) {
      if (fiscalQuarterKey_(w.week_start) === futureQk) {
        expectedN += Number(w.hours) || 0;
      }
    });
    if (expectedN <= 0) {
      failures.push('Check 3: expectedN recomputed as 0 for quarter ' + futureQk);
      return;
    }

    var projected = api_projectSoftBookings(params, [booking]);
    var baseW = (baselineOnly.baseline.worker || []).find(function (w) {
      return w.resourceName === targetWorker.resourceName;
    });
    var projW = (projected.projected.worker || []).find(function (w) {
      return w.resourceName === targetWorker.resourceName;
    });
    if (!baseW || !projW) {
      failures.push('Check 3: worker row missing for ' + targetWorker.resourceName);
      return;
    }
    var baseQ = (baseW.quarters || []).find(function (q) { return q.quarterKey === futureQk; });
    var projQ = (projW.quarters || []).find(function (q) { return q.quarterKey === futureQk; });
    if (!baseQ || !projQ) {
      failures.push('Check 3: quarter cell missing for ' + futureQk);
      return;
    }
    var delta = Number(projQ.productiveHours) - Number(baseQ.productiveHours);
    if (!near_(delta, expectedN)) {
      failures.push('Check 3: worker productiveHours delta=' + delta.toFixed(4) +
        ' expected=' + expectedN.toFixed(4));
    } else {
      Logger.log('  worker ' + targetWorker.resourceName + ' delta=' + delta.toFixed(2) +
        ' expected=' + expectedN.toFixed(2) + ' OK');
    }

    var baseTeamQ = (baselineOnly.baseline.team.quarters || []).find(function (q) {
      return q.quarterKey === futureQk;
    });
    var projTeamQ = (projected.projected.team.quarters || []).find(function (q) {
      return q.quarterKey === futureQk;
    });
    if (baseTeamQ && projTeamQ) {
      var teamDelta = Number(projTeamQ.productiveHours) - Number(baseTeamQ.productiveHours);
      if (!near_(teamDelta, expectedN)) {
        failures.push('Check 3: team productiveHours delta=' + teamDelta.toFixed(4) +
          ' expected=' + expectedN.toFixed(4));
      } else {
        Logger.log('  team aggregate delta=' + teamDelta.toFixed(2) + ' OK');
      }
    }

    var teamLabel = targetWorker.teamLabel;
    var baseOrg = (baselineOnly.baseline.orgTeams || []).find(function (o) {
      return o.teamLabel === teamLabel;
    });
    var projOrg = (projected.projected.orgTeams || []).find(function (o) {
      return o.teamLabel === teamLabel;
    });
    if (baseOrg && projOrg) {
      var baseOrgQ = (baseOrg.quarters || []).find(function (q) { return q.quarterKey === futureQk; });
      var projOrgQ = (projOrg.quarters || []).find(function (q) { return q.quarterKey === futureQk; });
      if (baseOrgQ && projOrgQ) {
        var orgDelta = Number(projOrgQ.productiveHours) - Number(baseOrgQ.productiveHours);
        if (!near_(orgDelta, expectedN)) {
          failures.push('Check 3: org-team ' + teamLabel + ' delta=' + orgDelta.toFixed(4) +
            ' expected=' + expectedN.toFixed(4));
        } else {
          Logger.log('  org-team ' + teamLabel + ' delta=' + orgDelta.toFixed(2) + ' OK');
        }
      }
    }
  })();

  // ---- Check 4: commit parity (api_commitSoftBookings → Committed, in committed view) ----
  (function checkCommitParity() {
    Logger.log('=== WFM.23 Check 4: commit parity (Committed two-state) ===');
    var idsToDelete = [];
    var scenarioIdsToDelete = [];
    var assignCountBefore = readTable_(ASSIGNMENTS).length;

    var picked = _dbg_wfm23PickDirectorScopeWorker_(baseParams);
    if (!picked) {
      failures.push('Check 4: no Director-scope worker found');
      Logger.log('  Check 4: FAILED (no worker)');
      return;
    }

    var baselineOnly = api_projectSoftBookings(picked.params, []);
    var workers = baselineOnly.baseline.worker || [];
    if (!workers.length) {
      failures.push('Check 4: no Director-scope workers in baseline');
      Logger.log('  Check 4: FAILED (no workers)');
      return;
    }

    function resolveRt_(w) {
      return _resolveBookingResourceType_({
        resource_name: String(w.resourceName || ''),
        employee_id: String(w.employeeId || '')
      });
    }

    var worker = null;
    var resourceType = '';
    workers.some(function (w) {
      var rt = resolveRt_(w);
      if (rt) {
        worker = w;
        resourceType = rt;
        return true;
      }
      return false;
    });
    if (!worker) {
      worker = workers[0];
      resourceType = resolveRt_(worker);
    }
    Logger.log('  parity worker: ' + worker.resourceName +
      ' rt=' + (resourceType || '(blank)'));

    var futureQk = null;
    var labelQk = null;
    var blankQk = null;
    var today = new Date();
    rollingQuarterKeys_(8).forEach(function (qk) {
      var bounds = fiscalQuarterBounds_(qk);
      if (bounds.start <= today) return;
      if (!futureQk) futureQk = qk;
      else if (!labelQk && qk !== futureQk) labelQk = qk;
      else if (!blankQk && qk !== futureQk && qk !== labelQk) blankQk = qk;
    });
    if (!futureQk) {
      failures.push('Check 4: no future fiscal quarter found');
      return;
    }
    if (!labelQk) labelQk = futureQk;
    if (!blankQk) blankQk = labelQk;

    var bounds = fiscalQuarterBounds_(futureQk);
    var labelBounds = fiscalQuarterBounds_(labelQk);
    var blankBounds = fiscalQuarterBounds_(blankQk);
    var startIso = _toIso_(bounds.start);
    var endIso = _toIso_(bounds.end);
    var labelStartIso = _toIso_(labelBounds.start);
    var labelEndIso = _toIso_(labelBounds.end);
    var blankStartIso = _toIso_(blankBounds.start);
    var blankEndIso = _toIso_(blankBounds.end);
    var totalHours = 33;
    var labelHours = 17;
    var blankHours = 11;
    var calendar = readCalendar_();

    var preCommitW = (baselineOnly.baseline.worker || []).find(function (w) {
      return w.resourceName === worker.resourceName;
    });
    var preCommitQ = preCommitW && (preCommitW.quarters || []).find(function (q) {
      return q.quarterKey === futureQk;
    });
    var preCommitProductive = preCommitQ ? Number(preCommitQ.productiveHours) || 0 : 0;

    var directPayload = {
      opportunity_id: '',
      resource_name: String(worker.resourceName),
      resource_type: resourceType,
      start_date: bounds.start,
      end_date: bounds.end,
      estimated_hours: totalHours,
      distribution: 'Even',
      status: 'Committed',
      scenario_id: '',
      notes: ''
    };

  // Omit resource_type — server must resolve from resource index (real soft-book path).
    var booking = {
      employee_id: String(worker.employeeId || ''),
      resource_name: String(worker.resourceName),
      start_date: startIso,
      end_date: endIso,
      total_hours: totalHours,
      what: { type: 'opportunity', opportunity_id: '' }
    };

    var apiResult = api_commitSoftBookings('', [booking]);
    var apiId = apiResult.committed[0] && apiResult.committed[0].assignment_id;
    if (!apiId) {
      failures.push('Check 4: api_commitSoftBookings returned no assignment_id');
    } else {
      idsToDelete.push(String(apiId));
    }

    invalidateCache_(ASSIGNMENTS);
    var apiRow = readTable_(ASSIGNMENTS).find(function (r) {
      return String(r.assignment_id) === String(apiId);
    });
    if (!apiRow) {
      failures.push('Check 4: api-created assignment row not found');
    } else {
      if (String(apiRow.status || '') !== 'Committed') {
        failures.push('Check 4: api-created row status not Committed (got ' + apiRow.status + ')');
      } else {
        Logger.log('  opportunity-path status=Committed OK');
      }
      var expectedFields = _dbg_wfm23DemandFields_(directPayload);
      var apiFields = _dbg_wfm23DemandFields_(apiRow);
      if (!_dbg_wfm23DemandFieldsEqual_(expectedFields, apiFields, TOL)) {
        failures.push('Check 4: demand fields mismatch api vs expected — ' +
          JSON.stringify({ expected: expectedFields, api: apiFields }));
      } else {
        Logger.log('  opportunity-path demand fields OK');
      }
      var expectedWeekly = _dbg_wfm23WeeklySignature_(directPayload, calendar);
      var apiWeekly = _dbg_wfm23WeeklySignature_(apiRow, calendar);
      if (expectedWeekly !== apiWeekly) {
        failures.push('Check 4: weekly expansion mismatch api vs direct payload');
      } else {
        Logger.log('  opportunity-path weekly expansion OK');
      }
      if (!resourceType) {
        if (String(apiRow.team_label || '') !== 'Unclassified') {
          failures.push('Check 4: blank-resource_type team_label expected Unclassified got ' +
            apiRow.team_label);
        }
        if (String(apiRow.role || '').trim() !== '') {
          failures.push('Check 4: blank-resource_type role expected blank got ' + apiRow.role);
        }
        if (String(apiRow.team_label || '') === 'Unclassified' &&
            String(apiRow.role || '').trim() === '') {
          Logger.log('  primary blank-resource_type Unclassified/role-blank OK');
        }
      }

      invalidateCache_(ASSIGNMENTS);
      var postCommit = api_projectSoftBookings(picked.params, []);
      var postW = (postCommit.baseline.worker || []).find(function (w) {
        return w.resourceName === worker.resourceName;
      });
      var postQ = postW && (postW.quarters || []).find(function (q) {
        return q.quarterKey === futureQk;
      });
      var postProductive = postQ ? Number(postQ.productiveHours) || 0 : 0;
      var preCommitQuarterKeys = (preCommitW && preCommitW.quarters || []).map(function (q) {
        return q.quarterKey;
      });
      var postQuarterKeys = (postW && postW.quarters || []).map(function (q) {
        return q.quarterKey;
      });
      Logger.log('  Check 4 diag futureQk=' + futureQk);
      Logger.log('  Check 4 diag preCommit quarterKeys=' + JSON.stringify(preCommitQuarterKeys));
      Logger.log('  Check 4 diag postCommit quarterKeys=' + JSON.stringify(postQuarterKeys));
      Logger.log('  Check 4 diag preCommitProductive=' + preCommitProductive +
        ' postProductive=' + postProductive +
        ' postQ=' + (postQ ? 'found' : 'MISSING'));
      var committedHoursDelta = postProductive - preCommitProductive;
      var expectedCommittedHours = 0;
      expandAssignmentToWeekly_(directPayload, calendar).forEach(function (w) {
        if (fiscalQuarterKey_(w.week_start) === futureQk) {
          expectedCommittedHours += Number(w.hours) || 0;
        }
      });
      if (!near_(committedHoursDelta, expectedCommittedHours)) {
        failures.push('Check 4: committed view productiveHours delta=' +
          committedHoursDelta.toFixed(4) + ' expected=' + expectedCommittedHours.toFixed(4));
      } else {
        Logger.log('  committed view productiveHours delta=' + committedHoursDelta.toFixed(2) +
          ' expected=' + expectedCommittedHours.toFixed(2) + ' OK');
      }
    }

    var directSaved = saveAssignment_(directPayload);
    if (directSaved && directSaved.assignment_id) {
      idsToDelete.push(String(directSaved.assignment_id));
    }

    var labelBooking = {
      employee_id: String(worker.employeeId || ''),
      resource_name: String(worker.resourceName),
      start_date: labelStartIso,
      end_date: labelEndIso,
      total_hours: labelHours,
      what: { type: 'label', label: '_dbg_wfm23_label_test' }
    };
    var labelResult = api_commitSoftBookings('', [labelBooking]);
    var labelId = labelResult.committed[0] && labelResult.committed[0].assignment_id;
    if (!labelId) {
      failures.push('Check 4: label-only commit returned no assignment_id');
    } else {
      idsToDelete.push(String(labelId));
      invalidateCache_(ASSIGNMENTS);
      var labelRow = readTable_(ASSIGNMENTS).find(function (r) {
        return String(r.assignment_id) === String(labelId);
      });
      if (!labelRow) {
        failures.push('Check 4: label-only assignment row not found');
      } else {
        if (String(labelRow.status || '') !== 'Committed') {
          failures.push('Check 4: label-only row status not Committed');
        }
        if (String(labelRow.opportunity_id || '').trim() !== '') {
          failures.push('Check 4: label-only row has non-blank opportunity_id');
        }
        if (String(labelRow.notes || '').indexOf('Soft-book label: ') !== 0) {
          failures.push('Check 4: label-only notes missing Soft-book label: prefix');
        } else {
          Logger.log('  label-only status/opportunity_id/notes OK');
        }
        var labelShape = {
          resource_name: labelRow.resource_name,
          start_date: labelRow.start_date,
          end_date: labelRow.end_date,
          estimated_hours: labelHours,
          distribution: 'Even',
          status: 'Committed'
        };
        var labelWeekly = _dbg_wfm23WeeklySignature_(labelRow, calendar);
        var labelExpectedWeekly = _dbg_wfm23WeeklySignature_(labelShape, calendar);
        if (labelWeekly !== labelExpectedWeekly) {
          failures.push('Check 4: label-only weekly expansion mismatch');
        } else {
          Logger.log('  label-only weekly expansion OK');
        }
      }
    }

    if (resourceType) {
      Logger.log('  forced blank-resource_type commit (synthetic worker)');
      var forcedBlankBooking = {
        employee_id: '',
        resource_name: '_dbg_wfm23_forced_blank_rt',
        start_date: blankStartIso,
        end_date: blankEndIso,
        total_hours: blankHours,
        what: { type: 'opportunity', opportunity_id: '' }
      };
      var forcedResult = api_commitSoftBookings('', [forcedBlankBooking]);
      var forcedId = forcedResult.committed[0] && forcedResult.committed[0].assignment_id;
      if (!forcedId) {
        failures.push('Check 4: forced blank-resource_type commit returned no assignment_id');
      } else {
        idsToDelete.push(String(forcedId));
        invalidateCache_(ASSIGNMENTS);
        var forcedRow = readTable_(ASSIGNMENTS).find(function (r) {
          return String(r.assignment_id) === String(forcedId);
        });
        if (!forcedRow) {
          failures.push('Check 4: forced blank-resource_type assignment row not found');
        } else {
          if (String(forcedRow.status || '') !== 'Committed') {
            failures.push('Check 4: forced blank-resource_type row status not Committed');
          }
          if (String(forcedRow.team_label || '') !== 'Unclassified') {
            failures.push('Check 4: forced blank-resource_type team_label expected Unclassified got ' +
              forcedRow.team_label);
          }
          if (String(forcedRow.role || '').trim() !== '') {
            failures.push('Check 4: forced blank-resource_type role expected blank got ' +
              forcedRow.role);
          }
          var forcedShape = {
            resource_name: forcedRow.resource_name,
            start_date: forcedRow.start_date,
            end_date: forcedRow.end_date,
            estimated_hours: blankHours,
            distribution: 'Even',
            status: 'Committed'
          };
          var forcedWeekly = _dbg_wfm23WeeklySignature_(forcedRow, calendar);
          var forcedExpectedWeekly = _dbg_wfm23WeeklySignature_(forcedShape, calendar);
          if (forcedWeekly !== forcedExpectedWeekly) {
            failures.push('Check 4: forced blank-resource_type weekly expansion mismatch');
          } else if (String(forcedRow.team_label || '') === 'Unclassified' &&
              String(forcedRow.role || '').trim() === '') {
            Logger.log('  forced blank-resource_type Unclassified/role-blank weekly OK');
          }
        }
      }
    }

    var uniqueIds = [];
    idsToDelete.forEach(function (id) {
      if (id && uniqueIds.indexOf(id) < 0) uniqueIds.push(id);
    });
    _dbg_wfm23DeleteAssignmentsByIds_(uniqueIds);
    scenarioIdsToDelete.forEach(function (sid) { _dbg_wfm23DeleteScenarioById_(sid); });
    invalidateCache_(ASSIGNMENTS);

    var assignCountAfter = readTable_(ASSIGNMENTS).length;
    if (assignCountBefore !== assignCountAfter) {
      failures.push('Check 4: Opportunity_Assignments row count ' + assignCountBefore +
        ' before vs ' + assignCountAfter + ' after cleanup');
      Logger.log('  CLEANUP FAILED: row count changed');
    } else {
      Logger.log('  cleanup OK — row count unchanged (' + assignCountBefore + ')');
    }

    Logger.log(failures.some(function (f) { return f.indexOf('Check 4') === 0; })
      ? '  Check 4: FAILED' : '  Check 4: OK');
  })();

  // ---- Check 5: no regression (WFM.15 / 17 / 18) ----
  (function checkNoRegression() {
    Logger.log('=== WFM.23 Check 5: no regression ===');
    if (typeof api_flushCaches === 'function') api_flushCaches();

    function runGate_(fn, okToken) {
      var before = Logger.getLog() || '';
      try {
        fn();
      } catch (e) {
        failures.push('Check 5: ' + fn.name + ' threw ΓÇö ' + e);
        return false;
      }
      var after = Logger.getLog() || '';
      var slice = after.slice(before.length);
      if (slice.indexOf(okToken) < 0) {
        failures.push('Check 5: ' + fn.name + ' did not print ' + okToken);
        return false;
      }
      return true;
    }

    var ok15 = runGate_(_dbg_reconcileWFM15, '_dbg_reconcileWFM15: ALL CASES OK');
    var ok17 = runGate_(_dbg_reconcileWFM17, '_dbg_reconcileWFM17: ALL CHECKS OK');
    var ok18 = runGate_(_dbg_reconcileWFM18, '_dbg_reconcileWFM18: ALL CHECKS OK');
    Logger.log('  WFM.15=' + (ok15 ? 'OK' : 'FAIL') +
      ' WFM.17=' + (ok17 ? 'OK' : 'FAIL') +
      ' WFM.18=' + (ok18 ? 'OK' : 'FAIL'));
  })();

  Logger.log('WFM.25 two-state: commit writes Committed; gates re-anchored — committed baseline includes committed soft-bookings.');
  Logger.log(failures.length === 0
    ? '_dbg_reconcileWFM23: ALL CHECKS OK'
    : '_dbg_reconcileWFM23: ' + failures.length + ' CHECK(S) FAILED ΓÇö DO NOT SHIP');
  failures.forEach(function (f) { Logger.log('  FAIL: ' + f); });
}

/**
 * WFM.23: verify CacheService L2 baseline cache ΓÇö two back-to-back
 * api_projectSoftBookings calls with identical filters should log
 * baselineCache=hit on the second call.
 */
function _dbg_wfm23BaselineCacheCheck() {
  _dbg_requireAdmin_();
  if (typeof api_flushCaches === 'function') api_flushCaches();

  var params = {
    viewMode: 'Committed',
    workerScope: 'SLG',
    includeTimeOff: false
  };
  var mgrRows = readConfigSlgManagers_();
  var descendants = buildManagerDescendants_(mgrRows);
  mgrRows.some(function (r) {
    if ((descendants[r.manager_name] || []).length >= 1) {
      params.teams = [r.manager_name];
      params.includeMyManagers = true;
      return true;
    }
    return false;
  });

  Logger.log('=== WFM.23 baseline CacheService L2 check ===');
  var before = Logger.getLog() || '';
  api_projectSoftBookings(params, []);
  var mid = Logger.getLog() || '';
  var firstSlice = mid.slice(before.length);
  var firstHit = firstSlice.indexOf('baselineCache=hit') >= 0;

  api_projectSoftBookings(params, []);
  var after = Logger.getLog() || '';
  var secondSlice = after.slice(mid.length);
  var secondHit = secondSlice.indexOf('baselineCache=hit') >= 0;

  Logger.log('  call 1 baselineCache=' + (firstHit ? 'hit' : 'miss'));
  Logger.log('  call 2 baselineCache=' + (secondHit ? 'hit' : 'miss') +
    (secondHit ? ' OK' : ' FAILED ΓÇö expected hit on warm L2'));
  if (!secondHit) {
    Logger.log('_dbg_wfm23BaselineCacheCheck: FAILED');
    return;
  }
  Logger.log('_dbg_wfm23BaselineCacheCheck: OK');
}

/**
 * WFM.23 investigation: trace Lauren Vannini Explorer FY27-Q2 scorecard cell
 * and City of PHX Modeled assignment visibility (Logger.log only).
 */
function _dbg_traceLaurenExplorer() {
  _dbg_requireAdmin_();
  var WORKER = 'Lauren Vannini';
  var TRACE_Q = 'FY27-Q2';
  var curQ = fiscalQuarterKey_(new Date());

  Logger.log('=== _dbg_traceLaurenExplorer: ' + WORKER + ' ===');
  Logger.log('  today=' + _toIso_(new Date()) + ' currentFiscalQuarter=' + curQ);

  // ---- 1. Actuals_Worker_Summary row ----
  Logger.log('--- 1. Actuals_Worker_Summary ---');
  var actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
    ? getActualsSummaryByEmployee_() : {};
  var resIndex = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_() : {};
  var info = resIndex[WORKER] || {};
  var employeeId = String(info.employee_id || '').trim();
  var summary = employeeId ? actualsSummary[employeeId] : null;
  if (!summary) {
    Object.keys(actualsSummary).some(function (eid) {
      if (String(actualsSummary[eid].resource_name || '') === WORKER) {
        summary = actualsSummary[eid];
        employeeId = eid;
        return true;
      }
      return false;
    });
  }
  if (!summary) {
    Logger.log('  NOT FOUND ΓÇö employee_id from resource index=' + (employeeId || '(blank)'));
  } else {
    Logger.log('  employee_id=' + summary.employee_id);
    Logger.log('  resource_name=' + summary.resource_name);
    Logger.log('  qtd_actual_icp_hours=' + summary.qtd_actual_icp_hours);
    Logger.log('  qtd_icp_plus_forecast_hours=' + summary.qtd_icp_plus_forecast_hours);
    Logger.log('  bonus_target_billable_hours_eoq=' + summary.bonus_target_billable_hours_eoq);
  }

  // ---- 2. quarterWorkdaySummary_ for FY27-Q2 ----
  var holidays = readHolidays_();
  var wd = quarterWorkdaySummary_(TRACE_Q, holidays);
  Logger.log('--- 2. quarterWorkdaySummary_(' + TRACE_Q + ') ---');
  Logger.log('  workdays=' + wd.workdays);
  Logger.log('  holidayHours=' + wd.holidayHours);
  Logger.log('  icpAvailableHours=' + wd.icpAvailableHours);
  Logger.log('  rawCapacityHours=' + wd.rawCapacityHours);

  // ---- 3. Current-quarter scorecard cell (buildWorkerQuarters_ path) ----
  Logger.log('--- 3. buildWorkerQuarters_ scorecard cell (' + TRACE_Q + ') ---');
  var settings = readSettings_();
  var forecastParams = { viewMode: 'Committed', workerScope: 'SLG', includeTimeOff: false };
  var forecast = computeWeeklyForecast_(forecastParams);
  var worker = (forecast.workers || []).find(function (w) { return w.resource === WORKER; });
  if (!worker) {
    Logger.log('  worker NOT FOUND in computeWeeklyForecast_ (Committed/SLG)');
  } else {
    Logger.log('  employeeId=' + worker.employeeId + ' icpRole=' + worker.icpRole +
      ' jobProfile=' + worker.jobProfile + ' icpTarget=' + worker.icpTarget);
    var quarters = buildWorkerQuarters_(
      worker, [TRACE_Q], forecast.weeks, holidays, actualsSummary, settings, curQ);
    var cell = quarters[0];
    if (!cell) {
      Logger.log('  quarter cell missing');
    } else {
      Logger.log('  source=' + cell.source);
      Logger.log('  productiveHours=' + cell.productiveHours);
      Logger.log('  denominator (icpAvailableHours)=' + cell.icpAvailableHours);
      Logger.log('  icpUtil=' + (cell.icpUtil * 100).toFixed(4) + '%');
      Logger.log('  arithmetic: ' + cell.productiveHours + ' / ' + cell.icpAvailableHours +
        ' = ' + cell.icpUtil.toFixed(6) + ' (' + (cell.icpUtil * 100).toFixed(2) + '%)');
      Logger.log('  targetHours=' + cell.targetHours + ' appTargetHours=' + cell.appTargetHours);
      Logger.log('  bonusAttainment=' + (cell.bonusAttainment * 100).toFixed(4) + '%');
      Logger.log('  financeUtil=' + (cell.financeUtil * 100).toFixed(4) + '%');
      if (cell.isCurrentQuarter && summary) {
        Logger.log('  current-quarter inputs: qtd_icp_plus_forecast_hours=' +
          summary.qtd_icp_plus_forecast_hours + ' (numerator when source=actuals_plus_forecast)');
      }
    }
  }

  // ---- Locate City of PHX assignment ----
  Logger.log('--- 4. Assignment + forecast visibility (Committed vs Scenario) ---');
  var assigns = cachedRead_(ASSIGNMENTS);
  var phxAssign = null;
  assigns.forEach(function (a) {
    if (String(a.resource_name || '') !== WORKER) return;
    var startIso = String(a.start_date || '').slice(0, 10);
    var notes = String(a.notes || '');
    var opp = String(a.opportunity_id || '');
    if (Number(a.estimated_hours) === 32 && startIso === '2026-09-28') {
      phxAssign = a;
    } else if (notes.indexOf('PHX') >= 0 || opp.indexOf('PHX') >= 0) {
      if (!phxAssign) phxAssign = a;
    }
  });
  if (!phxAssign) {
    Logger.log('  City of PHX assignment NOT FOUND ΓÇö listing all ' + WORKER + ' assignments:');
    assigns.filter(function (a) { return String(a.resource_name) === WORKER; }).forEach(function (a) {
      Logger.log('    id=' + a.assignment_id + ' status=' + a.status +
        ' hours=' + a.estimated_hours +
        ' ' + String(a.start_date || '').slice(0, 10) + 'ΓåÆ' + String(a.end_date || '').slice(0, 10) +
        ' opp=' + a.opportunity_id + ' notes=' + a.notes);
    });
  } else {
    Logger.log('  assignment_id=' + phxAssign.assignment_id);
    Logger.log('  status=' + phxAssign.status);
    Logger.log('  estimated_hours=' + phxAssign.estimated_hours);
    Logger.log('  start_date=' + String(phxAssign.start_date || '').slice(0, 10));
    Logger.log('  end_date=' + String(phxAssign.end_date || '').slice(0, 10));
    Logger.log('  opportunity_id=' + phxAssign.opportunity_id);
    Logger.log('  scenario_id=' + phxAssign.scenario_id);
    Logger.log('  notes=' + phxAssign.notes);
  }

  var calendar = readCalendar_();
  var weekQkMap = {};
  (calendar.weeks || []).forEach(function (wk) {
    weekQkMap[wk.week_key] = fiscalQuarterKey_(wk.week_start);
  });

  function assignmentIncludedInView_(assign, viewMode, scenarioId) {
    if (!assign) return false;
    var isCommitted = (assign.status === 'Committed');
    var isModeled = (assign.status === 'Modeled');
    return isCommitted ||
      (viewMode === 'Scenario' && isModeled &&
       (!scenarioId || String(assign.scenario_id || '') === String(scenarioId || '')));
  }

  function traceForecastMode_(viewMode) {
    Logger.log('  --- viewMode=' + viewMode + ' ---');
    var included = assignmentIncludedInView_(phxAssign, viewMode, '');
    Logger.log('    PHX assignment included by filter logic: ' + included +
      ' (status=' + (phxAssign ? phxAssign.status : 'n/a') + ')');
    var fc = computeWeeklyForecast_({
      viewMode: viewMode,
      workerScope: 'SLG',
      includeTimeOff: false
    });
    var w = (fc.workers || []).find(function (x) { return x.resource === WORKER; });
    if (!w) {
      Logger.log('    worker not in forecast');
      return;
    }
    var assignHoursByWeek = {};
    var assignHoursByQuarter = {};
    var totalAssign = 0;
    Object.keys(w.projects || {}).forEach(function (proj) {
      if (proj.indexOf('Assignment') !== 0) return;
      Object.keys(w.projects[proj]).forEach(function (wk) {
        var h = Number(w.projects[proj][wk]) || 0;
        if (!h) return;
        assignHoursByWeek[wk] = (assignHoursByWeek[wk] || 0) + h;
        totalAssign += h;
        var qk = weekQkMap[wk] || '(unknown)';
        assignHoursByQuarter[qk] = (assignHoursByQuarter[qk] || 0) + h;
      });
    });
    Logger.log('    total Assignment project hours across all weeks: ' + totalAssign.toFixed(4));
    if (phxAssign && included) {
      var expanded = expandAssignmentToWeekly_(phxAssign, calendar) || [];
      var phxTotal = 0;
      var phxByQuarter = {};
      expanded.forEach(function (ew) {
        var wk = String(ew.week_key || '');
        var h = Number(ew.hours) || 0;
        phxTotal += h;
        var qk = weekQkMap[wk] || fiscalQuarterKey_(wk);
        phxByQuarter[qk] = (phxByQuarter[qk] || 0) + h;
        var inForecast = Number(assignHoursByWeek[wk] || 0);
        Logger.log('      week ' + wk + ' q=' + qk + ' expanded=' + h.toFixed(4) +
          ' in-forecast-assign=' + inForecast.toFixed(4));
      });
      Logger.log('    PHX expandAssignmentToWeekly_ total=' + phxTotal.toFixed(4));
      Object.keys(phxByQuarter).sort().forEach(function (qk) {
        Logger.log('      quarter ' + qk + ': ' + phxByQuarter[qk].toFixed(4) + 'h');
      });
    } else if (phxAssign) {
      Logger.log('    PHX assignment excluded ΓÇö no weekly hours expected in this viewMode');
    }
    if (Object.keys(assignHoursByQuarter).length) {
      Logger.log('    all assignment hours by fiscal quarter:');
      Object.keys(assignHoursByQuarter).sort().forEach(function (qk) {
        Logger.log('      ' + qk + ': ' + assignHoursByQuarter[qk].toFixed(4) + 'h');
      });
    }
    var visibleWeeks = (typeof _deriveVisibleWeeksFiscal_ === 'function')
      ? _deriveVisibleWeeksFiscal_(fc.weeks) : [];
    var visibleKeys = {};
    visibleWeeks.forEach(function (vw) { visibleKeys[vw.week_key] = true; });
    var visibleAssign = 0;
    Object.keys(assignHoursByWeek).forEach(function (wk) {
      if (visibleKeys[wk]) visibleAssign += assignHoursByWeek[wk];
    });
    Logger.log('    Explorer strip scope: ' + curQ + ' + nextQ (' + visibleWeeks.length + ' weeks)');
    Logger.log('    assignment hours in visible strip window: ' + visibleAssign.toFixed(4));
  }

  traceForecastMode_('Committed');
  traceForecastMode_('Scenario');

  // ---- 5. expandAssignmentToWeekly_ raw output ----
  Logger.log('--- 5. expandAssignmentToWeekly_ (PHX assignment) ---');
  if (!phxAssign) {
    Logger.log('  skipped ΓÇö assignment not found');
  } else {
    var weeks = expandAssignmentToWeekly_(phxAssign, calendar) || [];
    var sum = 0;
    weeks.forEach(function (w) {
      var h = Number(w.hours) || 0;
      sum += h;
      var qk = weekQkMap[w.week_key] || fiscalQuarterKey_(w.week_start || w.week_key);
      Logger.log('  ' + w.week_key + ' ΓåÆ ' + h.toFixed(4) + 'h  (' + qk + ')');
    });
    Logger.log('  total expanded hours: ' + sum.toFixed(4) +
      ' (sheet estimated_hours=' + phxAssign.estimated_hours + ')');
    if (weeks.length) {
      var firstQk = weekQkMap[weeks[0].week_key] || '?';
      var lastQk = weekQkMap[weeks[weeks.length - 1].week_key] || '?';
      Logger.log('  fiscal quarter span: ' + firstQk + ' ΓåÆ ' + lastQk);
    }
  }

  Logger.log('=== _dbg_traceLaurenExplorer: DONE ===');
}

/**
 * WFM.24 Stage 1 discovery: surface real WoW Utilization_Quarterly targets vs
 * formula anchors and probe D8 current-quarter ICP-util scale pairing (read-only).
 */
function _dbg_traceWoWTargets() {
  _dbg_requireAdmin_();
  var AIDAN = 'Aidan Votaw';
  var TRACE_Q = 'FY27-Q2';
  var curQ = fiscalQuarterKey_(new Date());

  Logger.log('=== _dbg_traceWoWTargets ===');
  Logger.log('  today=' + _toIso_(new Date()) + ' currentFiscalQuarter=' + curQ);

  var wowRows = cachedRead_(CFG_UTIL_QUARTERLY);
  var holidays = readHolidays_();
  var settings = readSettings_();
  var resIndex = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_() : {};

  function printWowRow_(r) {
    Logger.log('    employee_id=' + r.employee_id +
      ' resource_name=' + r.resource_name +
      ' fiscal_quarter=' + r.fiscal_quarter +
      ' target_hours=' + r.target_hours +
      ' util_rate_wkly=' + r.util_rate_wkly +
      ' qtd_actual_icp=' + r.qtd_actual_icp +
      ' qtd_icp_plus_forecast=' + r.qtd_icp_plus_forecast +
      ' source_sheet=' + r.source_sheet);
  }

  function profileForWorker_(name, fallbackIcp, fallbackProfile) {
    var info = resIndex[name] || {};
    return {
      icpRole: String(info.icp || fallbackIcp || ''),
      jobProfile: String(info.job_profile || fallbackProfile || '')
    };
  }

  function findP6Worker_() {
    var hit = '';
    wowRows.some(function (r) {
      var nm = String(r.resource_name || '');
      if (/P6/i.test(nm) || /P6 Delivery/i.test(String(r.source_sheet || ''))) {
        hit = nm;
        return true;
      }
      return false;
    });
    if (hit) return hit;
    Object.keys(resIndex).some(function (name) {
      var jp = String(resIndex[name].job_profile || '');
      if (/P6 Delivery Consultant/i.test(jp)) {
        hit = name;
        return true;
      }
      return false;
    });
    if (hit) return hit;
    Object.keys(resIndex).some(function (name) {
      if (/^P6$/i.test(String(resIndex[name].icp || '')) ||
          /P6/i.test(String(resIndex[name].job_profile || ''))) {
        hit = name;
        return true;
      }
      return false;
    });
    return hit;
  }

  var p6Worker = findP6Worker_();
  var anchorWorkers = [AIDAN];
  if (p6Worker && anchorWorkers.indexOf(p6Worker) < 0) anchorWorkers.push(p6Worker);

  // ---- 1. Raw Utilization_Quarterly rows for anchor profiles ----
  Logger.log('--- 1. Utilization_Quarterly rows (anchor profiles) ---');
  anchorWorkers.forEach(function (workerName) {
    var prof = workerName === AIDAN
      ? profileForWorker_(workerName, 'CS_FUNC', 'P4 Consulting')
      : profileForWorker_(workerName, 'EM', 'P6 Delivery Consultant');
    Logger.log('  ' + workerName + ' (formula profile: icp=' + prof.icpRole +
      ' jobProfile=' + prof.jobProfile + ')');
    var rows = wowRows.filter(function (r) {
      return String(r.resource_name || '') === workerName;
    }).sort(function (a, b) {
      return String(a.fiscal_quarter).localeCompare(String(b.fiscal_quarter));
    });
    if (!rows.length) {
      Logger.log('    (no Utilization_Quarterly rows)');
      return;
    }
    rows.forEach(printWowRow_);
  });

  // ---- 2. Formula vs WoW side-by-side (re-anchor pairs) ----
  Logger.log('--- 2. Formula vs WoW target_hours (re-anchor pairs) ---');
  anchorWorkers.forEach(function (workerName) {
    var prof = workerName === AIDAN
      ? profileForWorker_(workerName, 'CS_FUNC', 'P4 Consulting')
      : profileForWorker_(workerName, 'EM', 'P6 Delivery Consultant');
    var rows = wowRows.filter(function (r) {
      return String(r.resource_name || '') === workerName;
    });
    if (!rows.length) {
      Logger.log('  ' + workerName + ': no WoW rows ΓÇö skip');
      return;
    }
    rows.forEach(function (r) {
      var qk = String(r.fiscal_quarter || '').trim();
      var wowTarget = Number(r.target_hours) || 0;
      var formulaTarget = quarterTargetHoursFor_(
        prof.icpRole, prof.jobProfile, qk, holidays, settings);
      var delta = wowTarget - formulaTarget;
      Logger.log('  ' + workerName + ' ' + qk +
        ': formula=' + formulaTarget.toFixed(2) +
        ' WoW=' + wowTarget.toFixed(2) +
        ' delta(WoW-formula)=' + delta.toFixed(2));
    });
  });

  // ---- 3. Aidan FY27-Q2 D8 units probe ----
  Logger.log('--- 3. Aidan ' + TRACE_Q + ' D8 ICP-util scale probe ---');
  var actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
    ? getActualsSummaryByEmployee_() : {};
  var aidanInfo = resIndex[AIDAN] || {};
  var aidanEid = String(aidanInfo.employee_id || '').trim();
  var aidanSummary = aidanEid ? actualsSummary[aidanEid] : null;
  if (!aidanSummary) {
    Object.keys(actualsSummary).some(function (eid) {
      if (String(actualsSummary[eid].resource_name || '') === AIDAN) {
        aidanSummary = actualsSummary[eid];
        aidanEid = eid;
        return true;
      }
      return false;
    });
  }
  var aidanWowQ2 = wowRows.find(function (r) {
    return String(r.resource_name || '') === AIDAN &&
      String(r.fiscal_quarter || '').trim() === TRACE_Q;
  });
  var wd = quarterWorkdaySummary_(TRACE_Q, holidays);
  var qtdPlus = aidanSummary ? Number(aidanSummary.qtd_icp_plus_forecast_hours) || 0 : 0;
  var bonusTarget = aidanSummary ? Number(aidanSummary.bonus_target_billable_hours_eoq) || 0 : 0;
  var wowTarget = aidanWowQ2 ? Number(aidanWowQ2.target_hours) || 0 : 0;
  var wowQtd = aidanWowQ2 ? Number(aidanWowQ2.qtd_icp_plus_forecast) || 0 : 0;
  var icpAvail = Number(wd.icpAvailableHours) || 0;

  Logger.log('  Actuals_Worker_Summary qtd_icp_plus_forecast_hours=' + qtdPlus);
  Logger.log('  Utilization_Quarterly qtd_icp_plus_forecast=' + wowQtd);
  Logger.log('  Utilization_Quarterly target_hours (WoW)=' + wowTarget);
  Logger.log('  Actuals_Worker_Summary bonus_target_billable_hours_eoq=' + bonusTarget);
  Logger.log('  quarterWorkdaySummary_(' + TRACE_Q + ').icpAvailableHours=' + icpAvail);

  function printRatio_(label, num, den) {
    var pct = den > 0 ? (num / den) * 100 : 0;
    Logger.log('  ' + label + ': ' + num.toFixed(2) + ' / ' + den.toFixed(2) +
      ' = ' + (den > 0 ? (num / den).toFixed(6) : 'n/a') +
      ' (' + pct.toFixed(2) + '%)');
  }

  printRatio_('qtd_icp_plus_forecast / icpAvailableHours (current D8 path)',
    qtdPlus, icpAvail);
  printRatio_('qtd_icp_plus_forecast / WoW target_hours',
    qtdPlus, wowTarget);
  printRatio_('qtd_icp_plus_forecast / bonus_target_billable_hours_eoq',
    qtdPlus, bonusTarget);
  if (wowQtd > 0 && wowQtd !== qtdPlus) {
    printRatio_('Utilization_Quarterly qtd_icp_plus_forecast / icpAvailableHours',
      wowQtd, icpAvail);
    printRatio_('Utilization_Quarterly qtd_icp_plus_forecast / WoW target_hours',
      wowQtd, wowTarget);
  }

  // ---- 4. WoW coverage window ----
  Logger.log('--- 4. Utilization_Quarterly coverage window ---');
  Logger.log('  total rows=' + wowRows.length);
  var quarterSet = {};
  wowRows.forEach(function (r) {
    var fq = String(r.fiscal_quarter || '').trim();
    if (!fq) return;
    quarterSet[fq] = (quarterSet[fq] || 0) + 1;
  });
  var quartersSorted = Object.keys(quarterSet).sort();
  Logger.log('  distinct fiscal_quarter values (' + quartersSorted.length + '): ' +
    quartersSorted.join(', '));
  quartersSorted.forEach(function (qk) {
    Logger.log('    ' + qk + ': ' + quarterSet[qk] + ' rows');
  });

  Logger.log('=== _dbg_traceWoWTargets: DONE ===');
}

// ============================================================
// WFM.24 mandatory gate: WoW target sourcing + D8 scale unification.
// MANDATORY GATE: do not ship WFM.24 unless ALL CHECKS OK.
// ============================================================

/**
 * WFM.24 Stage 1 mandatory gate. Self-computing checks for WoW-first targets,
 * D8 current-quarter ICP-util scale, and no regression on WFM.15/17/18/23.
 */
function _dbg_reconcileWFM24() {
  _dbg_requireAdmin_();
  var failures = [];
  var TOL = 0.01;
  var curQ = fiscalQuarterKey_(new Date());
  var curBounds = fiscalQuarterBounds_(curQ);
  var prevDay = new Date(curBounds.start.getFullYear(), curBounds.start.getMonth(), curBounds.start.getDate() - 1);
  var prevQ = fiscalQuarterKey_(prevDay);
  var expectedWindowKeys = [prevQ].concat(rollingQuarterKeys_(3));
  var forwardKeys = expectedWindowKeys.slice(2);

  if (typeof api_flushCaches === 'function') api_flushCaches();

  function near_(a, b) {
    return Math.abs(Number(a) - Number(b)) <= TOL;
  }

  function runGate_(fn, okToken) {
    var before = Logger.getLog() || '';
    try {
      fn();
    } catch (e) {
      failures.push('Regression: ' + fn.name + ' threw ΓÇö ' + e);
      return false;
    }
    var after = Logger.getLog() || '';
    var slice = after.slice(before.length);
    if (slice.indexOf(okToken) < 0) {
      failures.push('Regression: ' + fn.name + ' did not print ' + okToken);
      return false;
    }
    return true;
  }

  // ---- Check 0: scorecard window = previous / current / +1 / +2 ----
  (function scorecardWindow() {
    Logger.log('=== WFM.24 Check 0: scorecard window ===');
    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    var keys = scorecard.quarterKeys || [];
    if (keys.length !== expectedWindowKeys.length) {
      failures.push('Window: expected ' + expectedWindowKeys.length + ' keys, got ' + keys.length);
      return;
    }
    for (var wi = 0; wi < expectedWindowKeys.length; wi++) {
      if (keys[wi] !== expectedWindowKeys[wi]) {
        failures.push('Window: keys[' + wi + ']=' + keys[wi] + ' expect ' + expectedWindowKeys[wi]);
      }
    }
    var prevTeam = scorecard.teamSummary && scorecard.teamSummary[0];
    if (!prevTeam || prevTeam.quarterKey !== prevQ) {
      failures.push('Window: first column=' + (prevTeam && prevTeam.quarterKey) + ' expect previous=' + prevQ);
    } else if (prevTeam.isCurrentQuarter) {
      failures.push('Window: previous quarter flagged isCurrentQuarter');
    }
    var curTeam = (scorecard.teamSummary || []).find(function (t) { return t.quarterKey === curQ; });
    if (!curTeam) {
      failures.push('Window: current quarter missing from teamSummary');
    } else if (!curTeam.isCurrentQuarter) {
      failures.push('Window: current quarter not flagged isCurrentQuarter');
    }
    var sampleWorker = (scorecard.workers || [])[0];
    if (sampleWorker && sampleWorker.quarters && sampleWorker.quarters.length) {
      var prevCell = sampleWorker.quarters[0];
      if (prevCell.quarterKey !== prevQ) {
        failures.push('Window: worker first quarter=' + prevCell.quarterKey + ' expect ' + prevQ);
      } else if (prevCell.isCurrentQuarter) {
        failures.push('Window: worker previous quarter flagged isCurrentQuarter');
      }
      var curCell = (sampleWorker.quarters || []).find(function (q) { return q.quarterKey === curQ; });
      if (!curCell) {
        failures.push('Window: worker current quarter missing');
      } else if (!curCell.isCurrentQuarter) {
        failures.push('Window: worker current quarter not flagged isCurrentQuarter');
      }
    }
    Logger.log('  window=' + keys.join(', ') +
      ' prevNotCurrent=' + (prevTeam && !prevTeam.isCurrentQuarter ? 'OK' : 'FAIL') +
      ' curIsCurrent=' + (curTeam && curTeam.isCurrentQuarter ? 'OK' : 'FAIL'));
  })();

  // ---- Check A: WoW target sourcing (D5) ----
  (function wowTargetSourcing() {
    Logger.log('=== WFM.24 Check A: WoW target sourcing ===');
    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    var futureKeys = forwardKeys;

    var withWow = null;
    (scorecard.workers || []).some(function (w) {
      if (!w.employeeId) return false;
      for (var i = 0; i < futureKeys.length; i++) {
        var qk = futureKeys[i];
        var wow = quarterTargetFromWoW_(w.employeeId, qk);
        if (wow != null && wow > 0) {
          withWow = { worker: w, qk: qk, wow: wow };
          return true;
        }
      }
      return false;
    });
    if (!withWow) {
      failures.push('WoW sourcing: no worker with forward WoW target found');
      return;
    }
    var qWow = (withWow.worker.quarters || []).find(function (qq) {
      return qq.quarterKey === withWow.qk;
    });
    if (!qWow) {
      failures.push('WoW sourcing: quarter cell missing for ' + withWow.worker.worker);
      return;
    }
    if (!near_(qWow.targetHours, withWow.wow)) {
      failures.push('WoW sourcing: ' + withWow.worker.worker + ' ' + withWow.qk +
        ' targetHours=' + qWow.targetHours + ' expect WoW=' + withWow.wow);
    } else {
      Logger.log('  worker with WoW row: ' + withWow.worker.worker + ' ' + withWow.qk +
        ' targetHours=' + qWow.targetHours.toFixed(2) + ' == WoW OK');
    }

    var withoutWow = null;
    (scorecard.workers || []).some(function (w) {
      if (!w.employeeId) return false;
      for (var i = 0; i < futureKeys.length; i++) {
        var qk2 = futureKeys[i];
        if (quarterTargetFromWoW_(w.employeeId, qk2) != null) continue;
        var qCell = (w.quarters || []).find(function (qq) { return qq.quarterKey === qk2; });
        if (!qCell || qCell.source !== 'forecast') continue;
        withoutWow = { worker: w, qk: qk2, q: qCell };
        return true;
      }
      return false;
    });
    if (!withoutWow) {
      Logger.log('  formula-fallback sample: SKIPPED (all forward quarters have WoW rows)');
      return;
    }
    if (!near_(withoutWow.q.targetHours, withoutWow.q.appTargetHours)) {
      failures.push('WoW sourcing fallback: ' + withoutWow.worker.worker + ' ' + withoutWow.qk +
        ' targetHours=' + withoutWow.q.targetHours + ' expect formula=' + withoutWow.q.appTargetHours);
    } else {
      Logger.log('  worker without WoW row: ' + withoutWow.worker.worker + ' ' + withoutWow.qk +
        ' targetHours=' + withoutWow.q.targetHours.toFixed(2) + ' == formula OK');
    }
  })();

  // ---- Check B1: D8 current-quarter ICP-util scale unification (aligned) ----
  (function d8CurrentQuarterScale() {
    Logger.log('=== WFM.24 Check B1: D8 current-quarter ICP-util scale (aligned) ===');
    var actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
      ? getActualsSummaryByEmployee_() : {};
    var scorecard = computeQuarterlyScorecard_({ workerScope: 'All' });
    var probes = ['Lauren Vannini', 'Aidan Votaw'];

    probes.forEach(function (name) {
      var wRow = (scorecard.workers || []).find(function (w) { return w.worker === name; });
      if (!wRow || !wRow.employeeId) {
        Logger.log('  ' + name + ': not in scorecard ΓÇö skip');
        return;
      }
      var summary = actualsSummary[String(wRow.employeeId).trim()];
      if (!summary || !Number(summary.qtd_icp_plus_forecast_hours)) {
        Logger.log('  ' + name + ': no qtd_icp_plus_forecast ΓÇö skip');
        return;
      }
      var qtd = Number(summary.qtd_icp_plus_forecast_hours);
      var curCell = (wRow.quarters || []).find(function (q) { return q.quarterKey === curQ; });
      if (!curCell) {
        failures.push('D8: ' + name + ' current quarter missing');
        return;
      }
      // D8.1: same-scale invariant. The numerator (qtd_icp_plus_forecast) is
      // bonus-scale, so the denominator MUST be the same-row bonus target ΓÇö
      // making icpUtil == bonusAttainment. Self-computed, not hard-coded.
      var den = Number(summary.bonus_target_billable_hours_eoq) || 0;
      if (!den) {
        failures.push('D8: ' + name + ' no bonus-scale denominator');
        return;
      }
      var expectedIcp = qtd / den;
      var icpOk = near_(curCell.icpUtil, expectedIcp);
      var bonusOk = near_(curCell.icpUtil, curCell.bonusAttainment);
      Logger.log('  ' + name + ': qtd=' + qtd.toFixed(2) + ' bonus_den=' + den.toFixed(2) +
        ' icpUtil=' + (curCell.icpUtil * 100).toFixed(2) + '%' +
        ' bonusAtt=' + (curCell.bonusAttainment * 100).toFixed(2) + '%' +
        ' expected=' + (expectedIcp * 100).toFixed(2) + '%' +
        (icpOk && bonusOk ? ' OK' : ' FAILED'));
      if (!icpOk) {
        failures.push('D8: ' + name + ' icpUtil=' + curCell.icpUtil +
          ' expect qtd/bonus=' + expectedIcp);
      }
      if (!bonusOk) {
        failures.push('D8: ' + name + ' icpUtil != bonusAttainment');
      }
    });
  })();

  // ---- Check B2: D8 staleness / rollover guard (calendar ahead of WoW) ----
  (function d8RolloverGuard() {
    Logger.log('=== WFM.24 Check B2: D8 staleness / rollover guard ===');
    var SANE_CAP = 1.5; // >150% from a bonus-÷-ICP scale mismatch is garbage.
    var settings = readSettings_();
    var holidays = readHolidays_();
    var forecast = computeWeeklyForecast_({ workerScope: 'All' });
    var actualsSummary = (typeof getActualsSummaryByEmployee_ === 'function')
      ? getActualsSummaryByEmployee_() : {};
    var weeks = forecast.weeks || [];

    // Pick a worker that has current-quarter actuals (qtd + bonus target) so the
    // actuals path is exercised on both the aligned and rolled-over calendars.
    var probe = null;
    (forecast.workers || []).some(function (w) {
      if (!w.employeeId) return false;
      var s = actualsSummary[String(w.employeeId).trim()];
      if (s && Number(s.qtd_icp_plus_forecast_hours) > 0 &&
          Number(s.bonus_target_billable_hours_eoq) > 0) {
        probe = w;
        return true;
      }
      return false;
    });
    if (!probe) {
      Logger.log('  no worker with current-quarter actuals ΓÇö SKIP');
      return;
    }
    var pSummary = actualsSummary[String(probe.employeeId).trim()];

    // Derive one fiscal quarter AHEAD of the WoW snapshot's current quarter
    // (== calendar curQ on aligned data). No mutation, no hard-coded keys.
    var bounds = fiscalQuarterBounds_(curQ);
    var aheadStart = new Date(bounds.end.getFullYear(), bounds.end.getMonth() + 1, 1);
    var aheadQ = fiscalQuarterKey_(aheadStart);

    // --- B2a: same-scale pairing survives a rollover (no garbage) ---
    // Force buildWorkerQuarters_ to treat aheadQ as the current quarter while
    // the summary still describes the WoW snapshot's (earlier) current quarter.
    var rolled = buildWorkerQuarters_(probe, [curQ, aheadQ], weeks, holidays,
      actualsSummary, settings, aheadQ);
    var aheadCell = rolled.find(function (q) { return q.quarterKey === aheadQ; });
    if (!aheadCell) {
      failures.push('D8 rollover: ahead-quarter cell missing for ' + probe.resource);
      return;
    }
    var wowAheadTarget = quarterTargetFromWoW_(probe.employeeId, aheadQ);
    var hasBonusScaleTarget = (wowAheadTarget != null && wowAheadTarget > 0);
    // Stale by design: no bonus-scale WoW target for the calendar-current qk,
    // yet qtd actuals exist (they describe an earlier quarter than qk).
    var expectStaleA = (!hasBonusScaleTarget) &&
      (aheadCell.source === 'actuals_plus_forecast');

    if (!(aheadCell.icpUtil <= SANE_CAP)) {
      failures.push('D8 rollover: ' + probe.resource + ' ' + aheadQ +
        ' icpUtil=' + (aheadCell.icpUtil * 100).toFixed(2) +
        '% exceeds sane cap ' + (SANE_CAP * 100).toFixed(0) +
        '% (bonus-over-ICP scale-mismatch garbage)');
    }
    if (aheadCell.source === 'actuals_plus_forecast') {
      // Same-scale invariant must still hold on rolled-over data.
      if (!near_(aheadCell.icpUtil, aheadCell.bonusAttainment)) {
        failures.push('D8 rollover: ' + probe.resource + ' ' + aheadQ +
          ' icpUtil != bonusAttainment on rolled-over data');
      }
      if (aheadCell.stale !== expectStaleA) {
        failures.push('D8 rollover: ' + probe.resource + ' ' + aheadQ +
          ' stale=' + aheadCell.stale + ' expect ' + expectStaleA);
      }
    }
    Logger.log('  B2a ' + probe.resource + ' rolled curQ=' + aheadQ +
      ' source=' + aheadCell.source +
      ' icpUtil=' + (aheadCell.icpUtil * 100).toFixed(2) + '%' +
      ' bonusAtt=' + (aheadCell.bonusAttainment * 100).toFixed(2) + '%' +
      ' stale=' + aheadCell.stale +
      ' <=cap ' + (aheadCell.icpUtil <= SANE_CAP ? 'OK' : 'FAIL'));

    // --- B2b: forecast fallback when no same-scale bonus target exists ---
    // Simulate a worker whose current-quarter actuals lack a usable bonus
    // target (bonus_target_billable_hours_eoq == 0). Clone the summary map so
    // no persistent data is mutated. FIX 1 must fall through to the pure
    // forecast path rather than pair the bonus-scale qtd with icpAvailableHours.
    var clonedSummary = {};
    Object.keys(actualsSummary).forEach(function (k) {
      clonedSummary[k] = actualsSummary[k];
    });
    var noBonus = {};
    Object.keys(pSummary).forEach(function (k) { noBonus[k] = pSummary[k]; });
    noBonus.bonus_target_billable_hours_eoq = 0;
    clonedSummary[String(probe.employeeId).trim()] = noBonus;

    var fb = buildWorkerQuarters_(probe, [curQ], weeks, holidays,
      clonedSummary, settings, curQ);
    var fbCell = fb.find(function (q) { return q.quarterKey === curQ; });
    if (!fbCell) {
      failures.push('D8 rollover: forecast-fallback cell missing for ' + probe.resource);
      return;
    }
    var fcHours = sumForecastProductiveForQuarter_(probe, curQ, weeks);
    var expFbIcp = fbCell.icpAvailableHours > 0 ? fcHours / fbCell.icpAvailableHours : 0;
    if (fbCell.source !== 'forecast') {
      failures.push('D8 rollover: ' + probe.resource + ' no-bonus-target source=' +
        fbCell.source + ' expect forecast');
    }
    if (!near_(fbCell.icpUtil, expFbIcp)) {
      failures.push('D8 rollover: ' + probe.resource + ' forecast icpUtil=' +
        fbCell.icpUtil + ' expect forecast/icpAvail=' + expFbIcp);
    }
    if (!(fbCell.icpUtil <= SANE_CAP)) {
      failures.push('D8 rollover: ' + probe.resource + ' forecast icpUtil=' +
        (fbCell.icpUtil * 100).toFixed(2) + '% exceeds sane cap');
    }
    if (fbCell.stale !== false) {
      failures.push('D8 rollover: ' + probe.resource +
        ' forecast-path stale=' + fbCell.stale + ' expect false');
    }
    Logger.log('  B2b ' + probe.resource + ' no-bonus-target source=' + fbCell.source +
      ' icpUtil=' + (fbCell.icpUtil * 100).toFixed(2) + '%' +
      ' expect=' + (expFbIcp * 100).toFixed(2) + '%' +
      ' stale=' + fbCell.stale +
      ((fbCell.source === 'forecast' && near_(fbCell.icpUtil, expFbIcp) &&
        fbCell.icpUtil <= SANE_CAP && fbCell.stale === false) ? ' OK' : ' FAILED'));
  })();

  // ---- Check C: no regression ----
  (function noRegression() {
    Logger.log('=== WFM.24 Check C: no regression ===');
    var ok15 = runGate_(_dbg_reconcileWFM15, '_dbg_reconcileWFM15: ALL CASES OK');
    var ok17 = runGate_(_dbg_reconcileWFM17, '_dbg_reconcileWFM17: ALL CHECKS OK');
    var ok18 = runGate_(_dbg_reconcileWFM18, '_dbg_reconcileWFM18: ALL CHECKS OK');
    var ok23 = true;
    if (typeof _dbg_reconcileWFM23 === 'function') {
      ok23 = runGate_(_dbg_reconcileWFM23, '_dbg_reconcileWFM23: ALL CHECKS OK');
    } else {
      Logger.log('  WFM.23 gate not present on branch ΓÇö SKIPPED');
    }
    Logger.log('  WFM.15=' + (ok15 ? 'OK' : 'FAIL') +
      ' WFM.17=' + (ok17 ? 'OK' : 'FAIL') +
      ' WFM.18=' + (ok18 ? 'OK' : 'FAIL') +
      ' WFM.23=' + (ok23 ? 'OK' : 'SKIP'));
  })();

  Logger.log(failures.length === 0
    ? '_dbg_reconcileWFM24: ALL CHECKS OK'
    : '_dbg_reconcileWFM24: ' + failures.length + ' CHECK(S) FAILED ΓÇö DO NOT SHIP');
  failures.forEach(function (f) { Logger.log('  FAIL: ' + f); });
}

/**
 * WFM.25 investigation: trace inverted worker icpUtil delta on first soft-book
 * add vs second add. Logger.log only; does not persist or mutate production data.
 */
function _dbg_traceWFM25ProjectionDelta() {
  _dbg_requireAdmin_();

  var PREFERRED_WORKER = 'Al Romulo';
  var BOOKING_HOURS = 100;
  var curQ = fiscalQuarterKey_(new Date());
  var curBounds = fiscalQuarterBounds_(curQ);

  var baseParams = {
    viewMode: 'Committed',
    workerScope: 'SLG',
    includeTimeOff: false
  };

  function pct_(v) {
    return (Number(v) * 100).toFixed(2) + '%';
  }

  function findQuarterCell_(bucket, level, key, qk) {
    if (!bucket) return null;
    if (level === 'worker') {
      var w = (bucket.worker || []).find(function (x) {
        return x.resourceName === key;
      });
      if (!w) return null;
      return (w.quarters || []).find(function (q) { return q.quarterKey === qk; }) || null;
    }
    if (level === 'team') {
      return ((bucket.team && bucket.team.quarters) || []).find(function (q) {
        return q.quarterKey === qk;
      }) || null;
    }
    return null;
  }

  function logUtilBlock_(label, result, workerName, qk) {
    Logger.log('  --- ' + label + ' (quarter ' + qk + ') ---');
    ['WORKER', 'TEAM'].forEach(function (lvl) {
      var level = lvl === 'WORKER' ? 'worker' : 'team';
      var key = lvl === 'WORKER' ? workerName : null;
      var baseCell = findQuarterCell_(result.baseline, level, key, qk);
      var projCell = findQuarterCell_(result.projected, level, key, qk);
      if (!baseCell || !projCell) {
        Logger.log('  ' + lvl + ': (missing baseline or projected cell)');
        return;
      }
      var utilDelta = Number(projCell.icpUtil) - Number(baseCell.icpUtil);
      var prodDelta = Number(projCell.productiveHours) - Number(baseCell.productiveHours);
      var arrow = utilDelta > 0.0001 ? '\u2191' : (utilDelta < -0.0001 ? '\u2193' : '\u2192');
      Logger.log('  ' + lvl + ':');
      Logger.log('    baseline  icpUtil=' + pct_(baseCell.icpUtil) +
        '  num(productiveHours)=' + Number(baseCell.productiveHours).toFixed(4) +
        '  den(icpAvailableHours)=' + Number(baseCell.icpAvailableHours).toFixed(4));
      Logger.log('    projected icpUtil=' + pct_(projCell.icpUtil) +
        '  num(productiveHours)=' + Number(projCell.productiveHours).toFixed(4) +
        '  den(icpAvailableHours)=' + Number(projCell.icpAvailableHours).toFixed(4));
      Logger.log('    delta     icpUtil=' + pct_(utilDelta) + ' (' + arrow + ')' +
        '  productiveHours=' + (prodDelta >= 0 ? '+' : '') + prodDelta.toFixed(4));
    });
  }

  function logFullWorkerQuarter_(result, workerName, qk) {
    var baseW = (result.baseline.worker || []).find(function (w) {
      return w.resourceName === workerName;
    });
    var projW = (result.projected.worker || []).find(function (w) {
      return w.resourceName === workerName;
    });
    if (!baseW || !projW) {
      Logger.log('  FULL worker object: row missing for ' + workerName);
      return;
    }
    var baseQ = (baseW.quarters || []).find(function (q) { return q.quarterKey === qk; });
    var projQ = (projW.quarters || []).find(function (q) { return q.quarterKey === qk; });
    if (!baseQ || !projQ) {
      Logger.log('  FULL worker object: quarter cell missing for ' + qk);
      return;
    }
    Logger.log('  baseline.worker quarter (all numeric fields):');
    Object.keys(baseQ).sort().forEach(function (k) {
      if (typeof baseQ[k] === 'number') {
        Logger.log('    ' + k + '=' + baseQ[k]);
      }
    });
    Logger.log('  projected.worker quarter (all numeric fields):');
    Object.keys(projQ).sort().forEach(function (k) {
      if (typeof projQ[k] === 'number') {
        Logger.log('    ' + k + '=' + projQ[k]);
      }
    });
    var prodDelta = Number(projQ.productiveHours) - Number(baseQ.productiveHours);
    Logger.log('  productiveHours delta=' + (prodDelta >= 0 ? '+' : '') + prodDelta.toFixed(4) +
      ' (booking total_hours=' + BOOKING_HOURS + ')');
    var utilDelta = Number(projQ.icpUtil) - Number(baseQ.icpUtil);
    Logger.log('  icpUtil delta=' + pct_(utilDelta) +
      (prodDelta > 0 && utilDelta < 0 ? ' *** INVERTED: hours up, util down ***' : ''));
  }

  function buildDirectorParams_() {
    var mgrRows = readConfigSlgManagers_();
    var descendants = buildManagerDescendants_(mgrRows);
    var scopes = [];
    mgrRows.forEach(function (r) {
      if ((descendants[r.manager_name] || []).length >= 1) {
        scopes.push({
          mgrName: r.manager_name,
          params: Object.assign({}, baseParams, {
            teams: [r.manager_name],
            includeMyManagers: true
          })
        });
      }
    });
    return scopes;
  }

  function pickTargetWorker_(scopes) {
    var preferred = null;
    var bestOver = null;
    scopes.forEach(function (scope) {
      var result = api_projectSoftBookings(scope.params, []);
      var workers = result.baseline.worker || [];
      workers.forEach(function (w) {
        var q = (w.quarters || []).find(function (qq) { return qq.quarterKey === curQ; });
        if (!q) return;
        if (w.resourceName === PREFERRED_WORKER) {
          preferred = { worker: w, params: scope.params, mgrName: scope.mgrName, baseline: result };
        }
        if (q.icpUtil > 1.0) {
          if (!bestOver || q.icpUtil > bestOver.icpUtil) {
            bestOver = {
              worker: w,
              params: scope.params,
              mgrName: scope.mgrName,
              baseline: result,
              icpUtil: q.icpUtil
            };
          }
        }
      });
    });
    if (preferred) {
      var pq = (preferred.worker.quarters || []).find(function (qq) { return qq.quarterKey === curQ; });
      if (pq && pq.icpUtil <= 1.0) {
        Logger.log('  NOTE: ' + PREFERRED_WORKER + ' baseline icpUtil=' + pct_(pq.icpUtil) +
          ' (not >100%); using preferred worker anyway');
      }
      return preferred;
    }
    return bestOver;
  }

  Logger.log('=== _dbg_traceWFM25ProjectionDelta ===');
  Logger.log('  today=' + _toIso_(new Date()) + ' currentFiscalQuarter=' + curQ);
  Logger.log('  booking window: ' + _toIso_(curBounds.start) + ' .. ' + _toIso_(curBounds.end) +
    ' total_hours=' + BOOKING_HOURS + ' per booking');

  var scopes = buildDirectorParams_();
  if (!scopes.length) {
    Logger.log('  ABORT: no Director scope with descendants found');
    Logger.log('=== _dbg_traceWFM25ProjectionDelta: DONE ===');
    return;
  }

  if (typeof api_flushCaches === 'function') api_flushCaches();
  var picked = pickTargetWorker_(scopes);
  if (!picked) {
    Logger.log('  ABORT: no over-utilized worker (icpUtil>100%) in any Director scope; ' +
      PREFERRED_WORKER + ' not found');
    Logger.log('=== _dbg_traceWFM25ProjectionDelta: DONE ===');
    return;
  }

  var targetWorker = picked.worker;
  var params = picked.params;
  var workerName = targetWorker.resourceName;
  var baseQ = (targetWorker.quarters || []).find(function (q) { return q.quarterKey === curQ; });

  Logger.log('--- STEP 1: target worker ---');
  Logger.log('  employee_id=' + targetWorker.employeeId);
  Logger.log('  resource_name=' + workerName);
  Logger.log('  team=' + targetWorker.teamLabel);
  Logger.log('  director_scope=' + picked.mgrName);
  Logger.log('  current_quarter=' + curQ);
  Logger.log('  baseline_icpUtil=' + (baseQ ? pct_(baseQ.icpUtil) : '(missing)'));

  var booking1 = {
    employee_id: String(targetWorker.employeeId),
    resource_name: workerName,
    start_date: _toIso_(curBounds.start),
    end_date: _toIso_(curBounds.end),
    total_hours: BOOKING_HOURS
  };
  var booking2 = {
    employee_id: String(targetWorker.employeeId),
    resource_name: workerName,
    start_date: _toIso_(curBounds.start),
    end_date: _toIso_(curBounds.end),
    total_hours: BOOKING_HOURS
  };

  Logger.log('--- STEP 2/3: FIRST add (cold cache, 1 booking) ---');
  if (typeof api_flushCaches === 'function') api_flushCaches();
  var resultFirst = api_projectSoftBookings(params, [booking1]);
  logUtilBlock_('FIRST add', resultFirst, workerName, curQ);

  Logger.log('--- STEP 5: FULL baseline vs projected worker quarter (FIRST add) ---');
  logFullWorkerQuarter_(resultFirst, workerName, curQ);

  Logger.log('--- STEP 4: SECOND add [flush-between] ---');
  if (typeof api_flushCaches === 'function') api_flushCaches();
  api_projectSoftBookings(params, [booking1]);
  if (typeof api_flushCaches === 'function') api_flushCaches();
  var resultSecondFlush = api_projectSoftBookings(params, [booking1, booking2]);
  logUtilBlock_('SECOND add (2 bookings)', resultSecondFlush, workerName, curQ);

  Logger.log('--- STEP 4: SECOND add [no-flush-between] ---');
  if (typeof api_flushCaches === 'function') api_flushCaches();
  api_projectSoftBookings(params, [booking1]);
  var resultSecondWarm = api_projectSoftBookings(params, [booking1, booking2]);
  logUtilBlock_('SECOND add warm-cache (2 bookings)', resultSecondWarm, workerName, curQ);

  var firstWorkerDelta = (function () {
    var b = findQuarterCell_(resultFirst.baseline, 'worker', workerName, curQ);
    var p = findQuarterCell_(resultFirst.projected, 'worker', workerName, curQ);
    return b && p ? Number(p.icpUtil) - Number(b.icpUtil) : null;
  })();
  var secondFlushWorkerDelta = (function () {
    var b = findQuarterCell_(resultSecondFlush.baseline, 'worker', workerName, curQ);
    var p = findQuarterCell_(resultSecondFlush.projected, 'worker', workerName, curQ);
    return b && p ? Number(p.icpUtil) - Number(b.icpUtil) : null;
  })();
  var secondWarmWorkerDelta = (function () {
    var b = findQuarterCell_(resultSecondWarm.baseline, 'worker', workerName, curQ);
    var p = findQuarterCell_(resultSecondWarm.projected, 'worker', workerName, curQ);
    return b && p ? Number(p.icpUtil) - Number(b.icpUtil) : null;
  })();

  Logger.log('--- SUMMARY: worker icpUtil delta sign ---');
  Logger.log('  FIRST add:        ' + (firstWorkerDelta == null ? 'n/a' :
    pct_(firstWorkerDelta) + (firstWorkerDelta < 0 ? ' (NEGATIVE)' : ' (non-negative)')));
  Logger.log('  SECOND flush:     ' + (secondFlushWorkerDelta == null ? 'n/a' :
    pct_(secondFlushWorkerDelta) + (secondFlushWorkerDelta < 0 ? ' (NEGATIVE)' : ' (non-negative)')));
  Logger.log('  SECOND no-flush:  ' + (secondWarmWorkerDelta == null ? 'n/a' :
    pct_(secondWarmWorkerDelta) + (secondWarmWorkerDelta < 0 ? ' (NEGATIVE)' : ' (non-negative)')));
  if (firstWorkerDelta != null && secondFlushWorkerDelta != null &&
      firstWorkerDelta < 0 && secondFlushWorkerDelta > 0) {
    Logger.log('  PATTERN MATCH: first-add worker delta negative, second-add positive (flush-between)');
  }
  if (firstWorkerDelta != null && secondWarmWorkerDelta != null &&
      firstWorkerDelta < 0 && secondWarmWorkerDelta > 0) {
    Logger.log('  PATTERN MATCH: first-add worker delta negative, second-add positive (no-flush-between)');
  }

  Logger.log('=== _dbg_traceWFM25ProjectionDelta: DONE ===');
}

/**
 * Trace whether a committed assignment is included in computeWeeklyForecast_
 * under workerScope:'All' vs Director-scoped params. Logger only; writes one
 * temp assignment then deletes it (same self-clean pattern as WFM.23 check 4).
 */
function _dbg_traceCommittedInclusion() {
  _dbg_requireAdmin_();

  var WORKER = 'Al Romulo';
  var EMPLOYEE_ID = '13945';
  var TRACE_Q = 'FY27-Q4';
  var TEMP_HOURS = 100;
  var TOL = 0.5;

  Logger.log('=== _dbg_traceCommittedInclusion: ' + WORKER + ' (' + TRACE_Q + ') ===');

  // ---- 1. Resource index metadata ----
  var resIndex = (typeof getResourceIndex_ === 'function')
    ? getResourceIndex_() : {};
  var info = resIndex[WORKER] || {};
  if (String(info.employee_id || '').trim() !== EMPLOYEE_ID) {
    Object.keys(resIndex).some(function (nm) {
      if (String(resIndex[nm].employee_id || '').trim() === EMPLOYEE_ID) {
        WORKER = nm;
        info = resIndex[nm];
        return true;
      }
      return false;
    });
  }
  Logger.log('--- 1. Resource index ---');
  Logger.log('  resource_name=' + WORKER);
  Logger.log('  employee_id=' + (info.employee_id || '(blank)'));
  Logger.log('  resource_type=' + (info.resource_type || '(blank)'));
  Logger.log('  worker_class=' + (info.worker_class || '(blank)'));
  Logger.log('  manager_org=' + (info.manager_org || '(blank)'));

  function resolveDirectorForWorker_(managerOrg) {
    var mgrRows = readConfigSlgManagers_();
    var byName = {};
    mgrRows.forEach(function (r) { byName[r.manager_name] = r; });
    var descendants = buildManagerDescendants_(mgrRows);
    var cur = String(managerOrg || '').trim();
    while (cur) {
      if ((descendants[cur] || []).length >= 1) return cur;
      var row = byName[cur];
      cur = row ? String(row.parent_manager || '').trim() : '';
    }
    return '';
  }

  var directorName = resolveDirectorForWorker_(info.manager_org);
  Logger.log('  director (scoped teams[0])=' + (directorName || '(unresolved)'));

  function sumProductiveQuarter_(forecast, workerName, quarterKey) {
    var w = (forecast.workers || []).find(function (x) {
      return x.resource === workerName;
    });
    if (!w) return { found: false, sum: 0 };
    return {
      found: true,
      sum: sumForecastProductiveForQuarter_(w, quarterKey, forecast.weeks)
    };
  }

  var bounds = fiscalQuarterBounds_(TRACE_Q);
  Logger.log('  quarter bounds: ' + _toIso_(bounds.start) + ' .. ' + _toIso_(bounds.end));

  // ---- 2. BEFORE (workerScope:'All') ----
  Logger.log('--- 2. BEFORE (workerScope:All) ---');
  var beforeAll = computeWeeklyForecast_({ workerScope: 'All' });
  var beforeResult = sumProductiveQuarter_(beforeAll, WORKER, TRACE_Q);
  Logger.log('  found=' + beforeResult.found);
  Logger.log('  FY27-Q4 productiveWeekly sum=' + beforeResult.sum.toFixed(4));

  // ---- 3. Write temp committed assignment ----
  var assignCountBefore = readTable_(ASSIGNMENTS).length;
  var tempId = null;
  var tempPayload = {
    opportunity_id: '',
    resource_name: WORKER,
    resource_type: info.resource_type || '',
    start_date: bounds.start,
    end_date: bounds.end,
    estimated_hours: TEMP_HOURS,
    distribution: 'Even',
    status: 'Committed',
    scenario_id: '',
    notes: ''
  };

  Logger.log('--- 3. Temp committed assignment ---');
  var saved = saveAssignment_(tempPayload);
  tempId = saved && saved.assignment_id ? String(saved.assignment_id) : null;
  Logger.log('  assignment_id=' + (tempId || '(none)'));
  invalidateCache_(ASSIGNMENTS);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();

  // ---- 4. AFTER (workerScope:'All') ----
  Logger.log('--- 4. AFTER (workerScope:All) ---');
  var afterAll = computeWeeklyForecast_({ workerScope: 'All' });
  var afterResult = sumProductiveQuarter_(afterAll, WORKER, TRACE_Q);
  var deltaAll = afterResult.sum - beforeResult.sum;
  Logger.log('  found=' + afterResult.found);
  Logger.log('  BEFORE=' + beforeResult.sum.toFixed(4) +
    ' AFTER=' + afterResult.sum.toFixed(4) +
    ' delta=' + (deltaAll >= 0 ? '+' : '') + deltaAll.toFixed(4));

  // ---- 5. SCOPED (gate-style Director params) ----
  Logger.log('--- 5. SCOPED (teams=[' + (directorName || '?') + '], includeMyManagers:true) ---');
  var scopedParams = {
    teams: directorName ? [directorName] : null,
    includeMyManagers: true
  };
  var scopedForecast = computeWeeklyForecast_(scopedParams);
  var scopedResult = sumProductiveQuarter_(scopedForecast, WORKER, TRACE_Q);
  Logger.log('  found=' + scopedResult.found);
  Logger.log('  FY27-Q4 productiveWeekly sum=' + scopedResult.sum.toFixed(4));
  Logger.log('  forecast.worker count=' + (scopedForecast.workers || []).length);

  // ---- 6. Cleanup ----
  Logger.log('--- 6. Cleanup ---');
  if (tempId) {
    _dbg_wfm23DeleteAssignmentsByIds_([tempId]);
  }
  invalidateCache_(ASSIGNMENTS);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  var assignCountAfter = readTable_(ASSIGNMENTS).length;
  Logger.log('  row count before=' + assignCountBefore + ' after=' + assignCountAfter +
    (assignCountBefore === assignCountAfter ? ' OK' : ' MISMATCH'));

  // ---- Summary ----
  var allCountsCommitted = beforeResult.found && afterResult.found &&
    Math.abs(deltaAll - TEMP_HOURS) <= TOL;
  Logger.log('--- SUMMARY ---');
  Logger.log('  workerScope:All counts committed assignment (delta~' + TEMP_HOURS + ')? ' +
    (allCountsCommitted ? 'YES (delta=' + deltaAll.toFixed(2) + ')' :
      'NO (delta=' + deltaAll.toFixed(2) + ', found before=' + beforeResult.found +
      ' after=' + afterResult.found + ')'));
  Logger.log('  SCOPED call includes ' + WORKER + '? ' +
    (scopedResult.found ? 'YES (FY27-Q4 sum=' + scopedResult.sum.toFixed(2) + ')' : 'NO'));

  Logger.log('=== _dbg_traceCommittedInclusion: DONE ===');
}

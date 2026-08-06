// ============================================================
// Commitments.gs — WFM.25 union ledger (assignments + adjustments)
// Read surface for the Commitments tab; writes delegate to Assignments/
// CapacityAdjustments with audit + cache invalidation.
// ============================================================

/**
 * Build opportunity and scenario lookup indexes for ledger labels.
 * @return {{ oppIndex: Object, scenIndex: Object, scenRows: Object[] }}
 */
function _commitmentsIndexMaps_() {
  var oppIndex = {};
  try {
    readTable_(OPPS_NORM).forEach(function (o) {
      if (o.opportunity_id) {
        oppIndex[o.opportunity_id] = {
          name: String(o.opportunity_name || ''),
          account: String(o.account || '')
        };
      }
    });
  } catch (e) { /* ignore */ }

  var scenIndex = {};
  var scenRows = [];
  try {
    scenRows = readTable_(SCENARIOS) || [];
    scenRows.forEach(function (s) {
      if (s.scenario_id) scenIndex[s.scenario_id] = s;
    });
  } catch (e) { scenRows = []; }

  return { oppIndex: oppIndex, scenIndex: scenIndex, scenRows: scenRows };
}

/**
 * Map worker name → forecast worker row for locked/reducible classification.
 * @return {Object<string, Object>}
 */
function _commitmentsWorkerForecastIndex_() {
  var out = {};
  try {
    var forecast = computeWeeklyForecast_({ viewMode: 'Committed', workerScope: 'All', includeTimeOff: false });
    (forecast.workers || []).forEach(function (w) {
      if (w.resource) out[w.resource] = w;
    });
  } catch (e) {
    Logger.log('_commitmentsWorkerForecastIndex_: ' + e);
  }
  return out;
}

/**
 * Classify weekly booking hours into locked vs reducible buckets.
 * Actual/closed weeks are locked; forecast-remaining weeks are reducible.
 * @param {Object|null} worker forecast worker row
 * @param {Array<{week_key:string, week_start:Date, hours:number}>} weeklyRows
 * @return {{ locked_hours: number, reducible_hours: number, weeks: Object[] }}
 */
function _commitmentsLockedReducible_(worker, weeklyRows) {
  var actualsByWorker = (typeof getActualsByWorkerWeek_ === 'function')
    ? getActualsByWorkerWeek_() : {};
  var locked = 0;
  var reducible = 0;
  var weeks = [];

  (weeklyRows || []).forEach(function (wk) {
    var hrs = Math.abs(Number(wk.hours) || 0);
    if (!hrs) return;
    var isLocked = true;
    if (worker) {
      var clampAvail = productiveHoursAvailableForReductionClamp_(
        worker, wk.week_key, actualsByWorker, wk.week_start);
      isLocked = clampAvail <= 0.0001;
    }
    if (isLocked) locked += hrs;
    else reducible += hrs;
    weeks.push({
      week_key: wk.week_key,
      week_start: weekKey_(wk.week_start || wk.week_key),
      hours: Math.round(hrs * 100) / 100,
      locked: isLocked
    });
  });

  return {
    locked_hours: Math.round(locked * 100) / 100,
    reducible_hours: Math.round(reducible * 100) / 100,
    weeks: weeks
  };
}

/**
 * Collect unique fiscal-quarter keys touched by weekly rows.
 * @param {Array<{week_start:Date}>} weeklyRows
 * @return {string[]}
 */
function _commitmentsQuarters_(weeklyRows) {
  var set = {};
  (weeklyRows || []).forEach(function (wk) {
    if (!wk.week_start) return;
    var d = wk.week_start instanceof Date ? wk.week_start : new Date(wk.week_start);
    if (isNaN(d.getTime())) return;
    set[fiscalQuarterKey_(d)] = true;
  });
  return Object.keys(set).sort();
}

/**
 * @param {*} v
 * @return {string}
 */
function _commitmentsIsoDate_(v) {
  if (!v) return '';
  try { return new Date(v).toISOString().slice(0, 10); } catch (e) { return String(v).slice(0, 10); }
}

/**
 * Build one ledger entry from an Opportunity_Assignments row.
 * @param {Object} a
 * @param {Object} ctx { calendar, workerByName, oppIndex, scenIndex }
 * @return {Object}
 */
function _ledgerEntryFromAssignment_(a, ctx) {
  var oppData = ctx.oppIndex[a.opportunity_id] || null;
  var weekly = expandAssignmentToWeekly_(a, ctx.calendar) || [];
  var worker = ctx.workerByName[a.resource_name] || null;
  var split = _commitmentsLockedReducible_(worker, weekly.map(function (w) {
    return { week_key: w.week_key, week_start: w.week_start, hours: w.hours };
  }));
  var scen = a.scenario_id ? (ctx.scenIndex[a.scenario_id] || null) : null;
  var totalHrs = Number(a.estimated_hours) || 0;

  return {
    ledger_key: 'assignment:' + a.assignment_id,
    object_type: 'assignment',
    object_id: String(a.assignment_id || ''),
    worker: String(a.resource_name || ''),
    team: String(a.team_label || a.team || ''),
    project_label: oppData
      ? (oppData.account ? oppData.account + ' — ' + oppData.name : oppData.name)
      : (a.opportunity_id || 'Unknown project'),
    booking_type: 'Booking',
    committed_hours: Math.round(totalHrs * 100) / 100,
    locked_hours: split.locked_hours,
    reducible_hours: split.reducible_hours,
    start_date: _commitmentsIsoDate_(a.start_date),
    end_date: _commitmentsIsoDate_(a.end_date),
    quarters: _commitmentsQuarters_(weekly),
    status: String(a.status || ''),
    scenario_id: String(a.scenario_id || ''),
    scenario_name: scen ? String(scen.name || '') : '',
    committed_by: String(a.modified_by || a.created_by || ''),
    committed_at: _commitmentsIsoDate_(a.modified_at || a.created_at),
    opportunity_id: String(a.opportunity_id || ''),
    weekly_detail: split.weeks,
    // Raw fields for modify/void round-trips
    resource_type: String(a.resource_type || ''),
    distribution: String(a.distribution || 'Even'),
    estimated_hours: totalHrs,
    hours_reduction: 0,
    direction: '',
    reason: ''
  };
}

/**
 * Build one ledger entry from a Capacity_Adjustments row.
 * @param {Object} adj
 * @param {Object} ctx
 * @return {Object}
 */
function _ledgerEntryFromAdjustment_(adj, ctx) {
  var weekly = expandAdjustmentToWeekly_(adj, ctx.calendar) || [];
  var worker = ctx.workerByName[adj.resource_name] || null;
  var split = _commitmentsLockedReducible_(worker, weekly.map(function (w) {
    return { week_key: w.week_key, week_start: w.week_start, hours: w.hours_reduction };
  }));
  var scen = adj.scenario_id ? (ctx.scenIndex[adj.scenario_id] || null) : null;
  var signedHrs = Number(adj.hours_reduction) || 0;
  var magnitude = Math.abs(signedHrs);
  var direction = String(adj.direction || (signedHrs < 0 ? 'add' : 'reduce'));
  var bookingType = direction === 'add' ? 'Add' : 'Reduce';

  return {
    ledger_key: 'adjustment:' + adj.adjustment_id,
    object_type: 'adjustment',
    object_id: String(adj.adjustment_id || ''),
    worker: String(adj.resource_name || ''),
    team: '',
    project_label: 'worker-level adjustment',
    booking_type: bookingType,
    committed_hours: Math.round(magnitude * 100) / 100,
    locked_hours: split.locked_hours,
    reducible_hours: split.reducible_hours,
    start_date: _commitmentsIsoDate_(adj.start_date),
    end_date: _commitmentsIsoDate_(adj.end_date),
    quarters: _commitmentsQuarters_(weekly),
    status: String(adj.status || ''),
    scenario_id: String(adj.scenario_id || ''),
    scenario_name: scen ? String(scen.name || '') : '',
    committed_by: String(adj.modified_by || adj.created_by || ''),
    committed_at: _commitmentsIsoDate_(adj.modified_at || adj.created_at),
    opportunity_id: '',
    weekly_detail: split.weeks,
    resource_type: '',
    distribution: String(adj.distribution || 'Even'),
    estimated_hours: 0,
    hours_reduction: signedHrs,
    direction: direction,
    reason: String(adj.reason || '')
  };
}

/**
 * Union committed + archived assignments and adjustments into a ledger.
 * @return {Object[]}
 */
function listCommitmentsLedger_() {
  var calendar = readCalendar_();
  var maps = _commitmentsIndexMaps_();
  var workerByName = _commitmentsWorkerForecastIndex_();
  var ctx = {
    calendar: calendar,
    workerByName: workerByName,
    oppIndex: maps.oppIndex,
    scenIndex: maps.scenIndex
  };

  var entries = [];
  var statuses = { Committed: true, Archived: true };

  listAssignments_({}).forEach(function (a) {
    if (!statuses[a.status]) return;
    entries.push(_ledgerEntryFromAssignment_(a, ctx));
  });

  try {
    listCapacityAdjustments_({}).forEach(function (adj) {
      if (!statuses[adj.status]) return;
      entries.push(_ledgerEntryFromAdjustment_(adj, ctx));
    });
  } catch (e) {
    Logger.log('listCommitmentsLedger_: adjustments read failed — ' + e);
  }

  entries.sort(function (a, b) {
    var wc = String(a.worker).localeCompare(String(b.worker));
    if (wc !== 0) return wc;
    return (b.committed_at || '').localeCompare(a.committed_at || '');
  });

  return entries;
}

/**
 * Scenario rollup metadata for the By Scenario view.
 * @return {Object[]}
 */
function listCommitmentsScenarioRollups_() {
  var maps = _commitmentsIndexMaps_();
  var ledger = listCommitmentsLedger_();
  var byScen = {};

  ledger.forEach(function (e) {
    if (e.status !== 'Committed') return;
    var sid = e.scenario_id || '__none__';
    if (!byScen[sid]) {
      byScen[sid] = {
        scenario_id: e.scenario_id || '',
        scenario_name: e.scenario_id ? (e.scenario_name || e.scenario_id) : 'No scenario',
        status: e.scenario_id ? String((maps.scenIndex[e.scenario_id] || {}).status || 'Active') : 'Ad-hoc',
        total_hours: 0,
        worker_set: {}
      };
    }
    var sign = e.booking_type === 'Reduce' ? -1 : 1;
    byScen[sid].total_hours += sign * (Number(e.committed_hours) || 0);
    if (e.worker) byScen[sid].worker_set[e.worker] = true;
  });

  return Object.keys(byScen).map(function (k) {
    var r = byScen[k];
    return {
      scenario_id: r.scenario_id,
      scenario_name: r.scenario_name,
      status: r.status,
      total_hours: Math.round(r.total_hours * 100) / 100,
      worker_count: Object.keys(r.worker_set).length
    };
  }).sort(function (a, b) {
    if (!a.scenario_id && b.scenario_id) return 1;
    if (a.scenario_id && !b.scenario_id) return -1;
    return String(a.scenario_name).localeCompare(String(b.scenario_name));
  });
}

/**
 * Modify committed assignment hours (full booking — no time-lock clamp).
 * @param {string} assignment_id
 * @param {number} newTotalHours total committed hours
 * @return {Object} updated assignment
 */
function modifyCommittedAssignmentHours_(assignment_id, newTotalHours) {
  var rows = listAssignments_({}).filter(function (a) {
    return String(a.assignment_id) === String(assignment_id);
  });
  if (!rows.length) throw new Error('Assignment not found');
  var a = rows[0];
  if (a.status !== 'Committed') throw new Error('Only committed assignments can be modified here');

  var total = Math.max(0, Number(newTotalHours) || 0);
  if (total <= 0) throw new Error('Total hours must be greater than zero');

  a.estimated_hours = Math.round(total * 100) / 100;
  return saveAssignment_(a);
}

/**
 * Modify committed adjustment magnitude (full booking — no time-lock clamp).
 * @param {string} adjustment_id
 * @param {number} newTotalHours total committed magnitude (unsigned)
 * @return {Object}
 */
function modifyCommittedAdjustmentHours_(adjustment_id, newTotalHours) {
  var rows = listCapacityAdjustments_({}).filter(function (adj) {
    return String(adj.adjustment_id) === String(adjustment_id);
  });
  if (!rows.length) throw new Error('Adjustment not found');
  var adj = rows[0];
  if (adj.status !== 'Committed') throw new Error('Only committed adjustments can be modified here');

  var magnitude = Math.max(0, Number(newTotalHours) || 0);
  if (magnitude <= 0) throw new Error('Total hours must be greater than zero');

  adj.hours_reduction = adj.direction === 'add' ? -magnitude : magnitude;
  return saveCapacityAdjustment_(adj);
}

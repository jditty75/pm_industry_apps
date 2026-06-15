// ============================================================
// CapacityAdjustments.gs — CRUD + monthly expansion for worker-
// scoped hour reductions modeled against the PSA baseline.
//
// Pattern mirrors Assignments.gs.
//   - hours_reduction is always stored as a positive number.
//   - The engine handles the sign at compute time.
//   - status: 'Modeled' | 'Committed' | 'Archived'
// ============================================================

/**
 * List capacity adjustments, optionally filtered.
 * @param {{ resource_name?: string, scenario_id?: string, status?: string }} filter
 * @return {Object[]}
 */
function listCapacityAdjustments_(filter) {
  filter = filter || {};
  let rows = cachedRead_(CAPACITY_ADJUSTMENTS_SHEET);
  if (filter.resource_name) rows = rows.filter(r => r.resource_name === filter.resource_name);
  if (filter.scenario_id)   rows = rows.filter(r => r.scenario_id  === filter.scenario_id);
  if (filter.status)        rows = rows.filter(r => r.status        === filter.status);
  return rows;
}

/**
 * Create or update a Capacity_Adjustments row.
 * Required: resource_name, start_date, end_date, hours_reduction > 0.
 * @param {Object} adj
 * @return {Object} saved adjustment
 */
function saveCapacityAdjustment_(adj) {
  const user = getUserEmail_();
  const ts = now_();

  adj.hours_reduction = Number(adj.hours_reduction) || 0;
  if (adj.hours_reduction <= 0) throw new Error('hours_reduction must be > 0');

  adj.distribution  = adj.distribution  || 'Even';
  adj.status        = adj.status        || 'Modeled';
  adj.scenario_id   = adj.scenario_id   || '';
  adj.deployment_id = String(adj.deployment_id || '');
  adj.reason        = adj.reason        || '';

  if (adj.start_date) adj.start_date = new Date(adj.start_date);
  if (adj.end_date)   adj.end_date   = new Date(adj.end_date);

  if (!adj.adjustment_id) {
    // 60-second natural-key dedup: prevent double-submit duplicates.
    const _startIso = adj.start_date ? adj.start_date.toISOString().slice(0,10) : '';
    const _endIso   = adj.end_date   ? adj.end_date.toISOString().slice(0,10)   : '';
    const _existing = listCapacityAdjustments_({}).find(function (r) {
      if (r.resource_name !== adj.resource_name) return false;
      if (String(r.start_date || '').slice(0,10) !== _startIso) return false;
      if (String(r.end_date   || '').slice(0,10) !== _endIso)   return false;
      if (Number(r.hours_reduction) !== adj.hours_reduction) return false;
      if (String(r.status || 'Modeled') !== adj.status) return false;
      if (String(r.scenario_id || '') !== String(adj.scenario_id || '')) return false;
      try {
        var _age = Date.now() - new Date(r.created_at).getTime();
        return _age >= 0 && _age < 60000;
      } catch (e) { return false; }
    });
    if (_existing) {
      Logger.log('saveCapacityAdjustment_: dedup hit — returning existing ' + _existing.adjustment_id);
      return _existing;
    }

    adj.adjustment_id = uuid_();
    adj.created_by    = user;
    adj.created_at    = ts;
    adj.modified_by   = user;
    adj.modified_at   = ts;
    getOrCreateSheet_(CAPACITY_ADJUSTMENTS_SHEET, ADJUSTMENT_HEADERS);
    appendRow_(CAPACITY_ADJUSTMENTS_SHEET, adj, ADJUSTMENT_HEADERS);
  } else {
    adj.modified_by = user;
    adj.modified_at = ts;
    updateRow_(CAPACITY_ADJUSTMENTS_SHEET, 'adjustment_id', adj.adjustment_id, adj, ADJUSTMENT_HEADERS);
  }

  invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  return adj;
}

/**
 * Hard-delete a Capacity_Adjustments row by adjustment_id.
 * Consistent with how assignments are deleted (deleteAssignment_ pattern).
 * @param {string} adjustment_id
 * @return {{ deleted: boolean }}
 */
function deleteCapacityAdjustment_(adjustment_id) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CAPACITY_ADJUSTMENTS_SHEET);
  if (!sh) return { deleted: false };
  const values = sh.getDataRange().getValues();
  const header = values[0];
  const idCol = header.indexOf('adjustment_id');
  if (idCol < 0) return { deleted: false };
  for (let r = values.length - 1; r >= 1; r--) {
    if (values[r][idCol] === adjustment_id) {
      sh.deleteRow(r + 1);
      invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
      if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
      return { deleted: true };
    }
  }
  return { deleted: false };
}

/**
 * Expand a capacity adjustment into per-month reduction buckets.
 * Reuses the same monthly distribution math as expandAssignmentToMonthly_.
 * Returns array of { period_start, hours_reduction } with positive values;
 * the engine negates when applying to buckets.
 *
 * @param {Object} adj  - adjustment row (start_date, end_date, hours_reduction, distribution, custom_monthly_json)
 * @param {Object} calendar - monthKey → { workdays } map from readCalendar_()
 * @return {{ period_start: Date, hours_reduction: number }[]}
 */
function expandAdjustmentToMonthly_(adj, calendar) {
  if (!adj.start_date || !adj.end_date) return [];
  const start = new Date(adj.start_date);
  const end   = new Date(adj.end_date);
  const months = monthsBetween_(start, end);
  if (!months.length) return [];

  const total = Number(adj.hours_reduction) || 0;

  if (adj.distribution === 'Custom' && adj.custom_monthly_json) {
    let custom = {};
    try { custom = JSON.parse(adj.custom_monthly_json); } catch (e) { custom = {}; }
    return months.map(m => ({
      period_start:    m,
      hours_reduction: Number(custom[monthKey_(m)] || 0)
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

  if (adj.distribution === 'Front-loaded' || adj.distribution === 'Back-loaded') {
    const ramp = months.map((_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      return adj.distribution === 'Front-loaded' ? (1.5 - t) : (0.5 + t);
    });
    const rsum = ramp.reduce((s, x) => s + x, 0);
    weights = weights.map((w, i) => ramp[i] / rsum);
  }

  return months.map((m, i) => ({
    period_start:    m,
    hours_reduction: total * weights[i]
  }));
}

/**
 * Flip a single adjustment's status. Used by commitScenario_ and the
 * "Commit Now" drawer action.
 * @param {string} adjustment_id
 * @param {string} status  'Committed' | 'Archived'
 * @return {{ adjustment_id: string, status: string }}
 */
function setAdjustmentStatus_(adjustment_id, status) {
  const user = getUserEmail_();
  updateRow_(CAPACITY_ADJUSTMENTS_SHEET, 'adjustment_id', adjustment_id, {
    status: status, modified_by: user, modified_at: now_()
  }, ADJUSTMENT_HEADERS);
  invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  return { adjustment_id: adjustment_id, status: status };
}

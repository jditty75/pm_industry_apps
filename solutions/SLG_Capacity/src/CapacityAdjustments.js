// ============================================================
// CapacityAdjustments.gs — CRUD + monthly expansion for worker-
// scoped hour adjustments (add or reduce) modeled against the
// PSA baseline.
//
// Pattern mirrors Assignments.gs.
//   - hours_reduction is SIGNED: positive = reduce, negative = add.
//   - direction column is denormalized for human readability.
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
 * Required: resource_name, start_date, end_date, hours_reduction magnitude > 0.
 * direction: 'add' | 'reduce' (defaults to 'reduce' for backward compat).
 * hours_reduction is stored as signed: positive = reduce, negative = add.
 * @param {Object} adj
 * @return {Object} saved adjustment
 */
function saveCapacityAdjustment_(adj) {
  const user = getUserEmail_();
  const ts = now_();

  // Direction handling — default to 'reduce' for backward compatibility.
  adj.direction = adj.direction || 'reduce';
  if (adj.direction !== 'add' && adj.direction !== 'reduce') {
    throw new Error('direction must be "add" or "reduce"');
  }
  const magnitude = Math.abs(Number(adj.hours_reduction) || 0);
  if (magnitude <= 0) throw new Error('hours_reduction magnitude must be > 0');
  adj.hours_reduction = adj.direction === 'add' ? -magnitude : magnitude;

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
    appendCapacityAdjustmentAudit_('create', null, adj, '');
  } else {
    // Capture before-state for audit.
    const _before = listCapacityAdjustments_({}).find(function (r) {
      return String(r.adjustment_id) === String(adj.adjustment_id);
    }) || null;
    adj.modified_by = user;
    adj.modified_at = ts;
    updateRow_(CAPACITY_ADJUSTMENTS_SHEET, 'adjustment_id', adj.adjustment_id, adj, ADJUSTMENT_HEADERS);
    appendCapacityAdjustmentAudit_('update', _before, adj, '');
  }

  invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  if (typeof invalidateSoftBookingBaselineCache_ === 'function') invalidateSoftBookingBaselineCache_();
  return adj;
}

/**
 * Hard-delete a Capacity_Adjustments row by adjustment_id.
 * Consistent with how assignments are deleted (deleteAssignment_ pattern).
 * Appends a 'delete' audit row before removal.
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
      // Capture the before-state for audit before deleting the row.
      const before = {};
      header.forEach(function (h, i) { before[h] = values[r][i]; });
      appendCapacityAdjustmentAudit_('delete', before, null, '');
      sh.deleteRow(r + 1);
      invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
      if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
      if (typeof invalidateSoftBookingBaselineCache_ === 'function') invalidateSoftBookingBaselineCache_();
      return { deleted: true };
    }
  }
  return { deleted: false };
}

/**
 * Expand a capacity adjustment into per-week reduction buckets, aligned to
 * the REAL Config_Calendar week grid (weekly-forecast-migration). Replaces
 * expandAdjustmentToMonthly_. Reuses the same distribution math as
 * expandAssignmentToWeekly_ (Engine.gs). Returns positive hours_reduction
 * values; the engine negates when applying to buckets.
 *
 * 'Custom' distribution was removed in WFM.12 (see expandAssignmentToWeekly_
 * for the full rationale). Any distribution value outside DISTRIBUTIONS is
 * defensively treated as Even, with a logged warning; never silently
 * produces all-zero weeks.
 *
 * @param {Object} adj  - adjustment row (start_date, end_date, hours_reduction, distribution)
 * @param {{weeks: Array}} calendar - output of readCalendar_() (Engine.gs)
 * @return {{ week_start: Date, week_key: string, hours_reduction: number }[]}
 */
function expandAdjustmentToWeekly_(adj, calendar) {
  if (!adj.start_date || !adj.end_date) return [];
  const start = weekStart_(adj.start_date);
  const end   = weekStart_(adj.end_date);

  const weeks = ((calendar && calendar.weeks) || []).filter(w => {
    const weekEnd = new Date(w.week_start.getFullYear(), w.week_start.getMonth(), w.week_start.getDate() + 6);
    return weekEnd >= start && w.week_start <= end;
  });
  if (!weeks.length) return [];

  const total = Number(adj.hours_reduction) || 0;

  let dist = adj.distribution;
  if (DISTRIBUTIONS.indexOf(dist) === -1) {
    Logger.log('expandAdjustmentToWeekly_: unrecognized distribution "' + dist +
      '" for adjustment ' + (adj.adjustment_id || '(no id)') + ' -- defaulting to Even');
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
    week_start:      w.week_start,
    week_key:        w.week_key,
    hours_reduction: total * weights[i]
  }));
}

// ============================================================
// Doc B: Migration — backfill direction on existing rows
// ============================================================

/**
 * One-time migration: backfill direction='reduce' on existing Capacity_Adjustments
 * rows that have a blank direction column. Idempotent — rows already having a
 * direction value are skipped.
 * @return {number} count of rows backfilled
 */
function _migrateExistingAdjustmentsAddDirection_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CAPACITY_ADJUSTMENTS_SHEET);
  if (!sh) return 0;
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  const header = values[0];
  const iDir = header.indexOf('direction');
  const iHrs = header.indexOf('hours_reduction');
  if (iDir < 0 || iHrs < 0) return 0;
  let backfilled = 0;
  for (let r = 1; r < values.length; r++) {
    if (!values[r][iDir]) {
      const h = Number(values[r][iHrs]) || 0;
      values[r][iDir] = h >= 0 ? 'reduce' : 'add';
      backfilled++;
    }
  }
  if (backfilled > 0) {
    sh.getRange(1, 1, values.length, header.length).setValues(values);
    invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
    Logger.log('_migrateExistingAdjustmentsAddDirection_: backfilled ' + backfilled + ' rows');
  }
  return backfilled;
}

/**
 * Public-named wrapper so Jeff can run this from the Apps Script editor dropdown
 * after the first deploy. The editor hides functions ending with _, so this
 * wrapper must NOT end with an underscore.
 */
function runDocBMigration() {
  _dbg_requireAdmin_();
  const n = _migrateExistingAdjustmentsAddDirection_();
  Logger.log('Doc B migration complete. Backfilled: ' + n + ' rows.');
}

/**
 * Flip a single adjustment's status. Used by commitScenario_ and the
 * "Commit Now" drawer action. Appends a 'commit', 'archive', or 'void' audit row.
 * @param {string} adjustment_id
 * @param {string} status  'Committed' | 'Archived'
 * @param {string} [auditAction] override audit action (e.g. 'void')
 * @param {string} [notes]
 * @return {{ adjustment_id: string, status: string }}
 */
function setAdjustmentStatus_(adjustment_id, status, auditAction, notes) {
  const user = getUserEmail_();
  // Capture before-state for audit.
  const _before = listCapacityAdjustments_({}).find(function (r) {
    return String(r.adjustment_id) === String(adjustment_id);
  }) || null;
  const patch = { status: status, modified_by: user, modified_at: now_() };
  updateRow_(CAPACITY_ADJUSTMENTS_SHEET, 'adjustment_id', adjustment_id, patch, ADJUSTMENT_HEADERS);
  const _after = _before ? Object.assign({}, _before, patch) : { adjustment_id: adjustment_id, status: status };
  var action = auditAction;
  if (!action) {
    action = (status === 'Committed') ? 'commit' : 'archive';
  }
  appendCapacityAdjustmentAudit_(action, _before, _after, notes || '');
  invalidateCache_(CAPACITY_ADJUSTMENTS_SHEET);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  if (typeof invalidateSoftBookingBaselineCache_ === 'function') invalidateSoftBookingBaselineCache_();
  return { adjustment_id: adjustment_id, status: status };
}

/**
 * Soft-void a committed adjustment (status → Archived, audit action 'void').
 * @param {string} adjustment_id
 * @param {string} [notes]
 * @return {{ adjustment_id: string, status: string }}
 */
function voidCapacityAdjustment_(adjustment_id, notes) {
  return setAdjustmentStatus_(adjustment_id, 'Archived', 'void', notes || '');
}

// ============================================================
// Doc B: Audit helper
// ============================================================

/**
 * Append one row to Capacity_Adjustments_Audit. Mirrors appendOverrideAudit_.
 * before is null on 'create'; after is null on 'delete'.
 * @param {string} action  'create' | 'update' | 'commit' | 'archive' | 'delete'
 * @param {Object|null} before
 * @param {Object|null} after
 * @param {string} notes
 */
function appendCapacityAdjustmentAudit_(action, before, after, notes) {
  const row = {
    audit_id:      uuid_(),
    timestamp:     new Date(),
    actor:         getUserEmail_(),
    action:        String(action || ''),
    adjustment_id: after ? String(after.adjustment_id || '') : (before ? String(before.adjustment_id || '') : ''),
    resource_name: after ? String(after.resource_name || '') : (before ? String(before.resource_name || '') : ''),
    deployment_id: after ? String(after.deployment_id || '') : (before ? String(before.deployment_id || '') : ''),
    before_json:   before ? JSON.stringify(before) : null,
    after_json:    after  ? JSON.stringify(after)  : null,
    notes:         String(notes || '')
  };
  appendRow_(CAPACITY_ADJUSTMENTS_AUDIT_SHEET, row, CAPACITY_ADJUSTMENT_AUDIT_HEADERS);
}

// ============================================================
// Doc B: Daily audit archive (mirrors archiveOverrideAudit_ pattern)
// ============================================================

/**
 * Archive Capacity_Adjustments_Audit rows older than 365 days to
 * Capacity_Adjustments_Audit_Archive. Rewrites the live table with
 * kept rows only. Idempotent. Returns count archived.
 */
function archiveCapacityAdjustmentAudit_() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  cutoff.setHours(0, 0, 0, 0);

  const rows = readTable_(CAPACITY_ADJUSTMENTS_AUDIT_SHEET);
  const keep = [];
  const archive = [];
  rows.forEach(function (r) {
    const ts = r.timestamp ? new Date(r.timestamp) : null;
    if (!ts || isNaN(ts.getTime()) || ts >= cutoff) {
      keep.push(r);
    } else {
      archive.push(r);
    }
  });

  if (!archive.length) return 0;

  archive.forEach(function (r) {
    appendRow_(CAPACITY_ADJUSTMENTS_AUDIT_ARCHIVE_SHEET, r, CAPACITY_ADJUSTMENT_AUDIT_HEADERS);
  });

  const keepMatrix = keep.map(function (r) {
    return CAPACITY_ADJUSTMENT_AUDIT_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
  });
  writeTable_(CAPACITY_ADJUSTMENTS_AUDIT_SHEET, CAPACITY_ADJUSTMENT_AUDIT_HEADERS, keepMatrix);

  Logger.log('archiveCapacityAdjustmentAudit_: archived ' + archive.length + ' rows');
  return archive.length;
}

/**
 * Daily maintenance entry point for capacity adjustment audit archival.
 * Called by the time-based trigger installed via setupCapacityAdjustmentAuditTrigger.
 */
function runDailyCapacityAdjustmentMaintenance_() {
  Logger.log('runDailyCapacityAdjustmentMaintenance_: starting');
  const archived = archiveCapacityAdjustmentAudit_();
  Logger.log('runDailyCapacityAdjustmentMaintenance_: archived=' + archived);
  return { archived: archived, ranAt: new Date().toISOString() };
}

/**
 * Idempotent trigger installer. Returns true if a new trigger was created.
 */
function ensureCapacityAdjustmentAuditTrigger_() {
  const FN = 'runDailyCapacityAdjustmentMaintenance_';
  const existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === FN;
  });
  if (existing.length > 0) {
    Logger.log('ensureCapacityAdjustmentAuditTrigger_: trigger already exists');
    return false;
  }
  ScriptApp.newTrigger(FN)
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
  Logger.log('ensureCapacityAdjustmentAuditTrigger_: trigger created (daily at 4 AM)');
  return true;
}

/**
 * Public-named wrapper so Jeff can run this from the Apps Script editor dropdown
 * after the first deploy. The editor hides functions ending with _, so this
 * wrapper must NOT end with an underscore.
 */
function setupCapacityAdjustmentAuditTrigger() {
  _dbg_requireAdmin_();
  const created = ensureCapacityAdjustmentAuditTrigger_();
  Logger.log('Trigger installed: ' + created);
}

// ============================================================
// Overrides.gs — Source override CRUD, read-time merge, and audit.
//
// Cache auto-invalidation (Drop 1) means no explicit invalidateCache_
// calls are needed here — writeTable_/appendRow_/updateRow_ each call
// invalidateCache_(name) on success.
//
// Patterns follow Engine.gs::readConfigSlgManagers_ and
// Util.gs::readConfigPracticeManagers_ for tolerant header reads and
// truthy-active matching.
// ============================================================

// ============================================================
// Internal helpers
// ============================================================

function _normOverrideCell_(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

const _OVERRIDE_TRUTHY_ = {
  'yes': 1, 'y': 1, 'true': 1, 't': 1,
  '1': 1, 'x': 1, 'active': 1, 'on': 1
};

// ============================================================
// Reading & merging
// ============================================================

/**
 * Read Config_Overridable_Fields via cachedRead_, return rows where
 * active is truthy. Normalizes cells with zero-width/nbsp stripping.
 */
function readOverridableFields_() {
  const rows = cachedRead_(CFG_OVERRIDABLE_FIELDS);
  return rows.filter(function (r) {
    const raw = (r.active === '' || r.active === null || r.active === undefined)
      ? 'Yes' : r.active;
    const active = _normOverrideCell_(raw).toLowerCase();
    return !!_OVERRIDE_TRUTHY_[active];
  }).map(function (r) {
    return {
      source:          _normOverrideCell_(r.source),
      field:           _normOverrideCell_(r.field),
      label:           _normOverrideCell_(r.label),
      data_type:       _normOverrideCell_(r.data_type),
      validator_hint:  _normOverrideCell_(r.validator_hint),
      active:          _normOverrideCell_(r.active),
      notes:           _normOverrideCell_(r.notes)
    };
  });
}

/**
 * Read Overrides via cachedRead_, return rows where:
 *   status === 'Active' AND (expires_at is blank OR expires_at >= today)
 * Optionally filter by source string.
 */
function readActiveOverrides_(source) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = cachedRead_(OVERRIDES_SHEET);
  return rows.filter(function (r) {
    if (String(r.status || '') !== 'Active') return false;
    if (source && String(r.source || '') !== source) return false;
    const expiresRaw = r.expires_at;
    if (!expiresRaw || expiresRaw === '') return true;
    const expiresDate = new Date(expiresRaw);
    if (isNaN(expiresDate.getTime())) return true;
    expiresDate.setHours(0, 0, 0, 0);
    return expiresDate >= today;
  });
}

/**
 * Build a nested lookup map: { recordId: { field: overrideRow } }
 * Last-write wins if duplicate overrides exist for the same record/field.
 */
function buildOverrideIndex_(overrides) {
  const idx = {};
  (overrides || []).forEach(function (o) {
    const rid = String(o.record_id || '');
    const fld = String(o.field || '');
    if (!rid || !fld) return;
    if (!idx[rid]) idx[rid] = {};
    idx[rid][fld] = o;
  });
  return idx;
}

/**
 * Mutate record in place, replacing field values with override_value
 * (coerced to the field's data_type). Attaches a _overrides array on
 * the record containing per-field metadata so the client can render badges.
 *
 * Only applies overrides for fields that are currently active in
 * Config_Overridable_Fields AND already exist on the record.
 *
 * Design: filtering happens against source values (pre-override).
 * Display values are post-override. Users filter on canonical Salesforce
 * data but see corrected display.
 */
function applyOverridesToRecord_(record, recordId, overrideIndex, source) {
  if (!record || !recordId || !overrideIndex) return;
  const byField = overrideIndex[String(recordId)] || {};
  if (!Object.keys(byField).length) return;

  const activeFields = readOverridableFields_().filter(function (f) {
    return f.source === source;
  });
  const activeFieldMap = {};
  activeFields.forEach(function (f) { activeFieldMap[f.field] = f; });

  if (!record._overrides) record._overrides = [];

  Object.keys(byField).forEach(function (fld) {
    const o = byField[fld];
    const fieldDef = activeFieldMap[fld];
    if (!fieldDef) return;
    if (!record.hasOwnProperty(fld)) return;

    const rawValue = String(o.override_value || '');
    let coerced;
    switch (fieldDef.data_type) {
      case 'number':
      case 'currency':
        coerced = Number(rawValue) || 0;
        break;
      case 'percent':
        coerced = Number(rawValue) || 0;
        break;
      case 'date':
        coerced = rawValue;
        break;
      default:
        coerced = rawValue;
    }

    record._overrides.push({
      field:          fld,
      label:          fieldDef.label,
      original_value: String(o.original_value || ''),
      override_value: rawValue,
      reason:         String(o.reason || ''),
      created_by:     String(o.created_by || ''),
      created_at:     o.created_at ? new Date(o.created_at).toISOString() : '',
      expires_at:     o.expires_at ? new Date(o.expires_at).toISOString() : ''
    });

    record[fld] = coerced;
  });
}

// ============================================================
// CRUD
// ============================================================

/**
 * Return override rows filtered by source / record_id / status /
 * created_by / field as provided in the filter object.
 */
function listOverrides_(filter) {
  filter = filter || {};
  let rows = readTable_(OVERRIDES_SHEET);
  if (filter.source)     rows = rows.filter(function (r) { return r.source === filter.source; });
  if (filter.record_id)  rows = rows.filter(function (r) { return String(r.record_id) === String(filter.record_id); });
  if (filter.status)     rows = rows.filter(function (r) { return r.status === filter.status; });
  if (filter.created_by) rows = rows.filter(function (r) { return r.created_by === filter.created_by; });
  if (filter.field)      rows = rows.filter(function (r) { return r.field === filter.field; });
  return rows;
}

/**
 * Create or update an override.
 *
 * Required: source, record_id, field, non-empty reason.
 *
 * On create: assign uuid, status='Active', set timestamps, append to Overrides,
 *   audit action='create'.
 *
 * On update (o.override_id provided): optimistic lock check; if client
 *   modified_at != current row modified_at, throw conflict error.
 *   Audit action='update'.
 *
 * Returns the saved override row.
 */
function saveOverride_(o) {
  if (!o.source)    throw new Error('source is required');
  if (!o.record_id) throw new Error('record_id is required');
  if (!o.field)     throw new Error('field is required');
  if (!String(o.reason || '').trim()) throw new Error('reason is required');

  const now = new Date();
  const actor = getUserEmail_();

  if (o.override_id) {
    // Update path
    const rows = readTable_(OVERRIDES_SHEET);
    const existing = rows.find(function (r) { return String(r.override_id) === String(o.override_id); });
    if (!existing) throw new Error('Override not found: ' + o.override_id);

    // Optimistic lock check
    if (o.modified_at) {
      const clientModAt = new Date(o.modified_at).getTime();
      const serverModAt = existing.modified_at ? new Date(existing.modified_at).getTime() : 0;
      if (!isNaN(clientModAt) && !isNaN(serverModAt) && clientModAt !== serverModAt) {
        throw new Error('Override has been modified by another user. Please refresh and try again.');
      }
    }

    const before = Object.assign({}, existing);
    const updated = Object.assign({}, existing, {
      override_value: o.override_value !== undefined ? o.override_value : existing.override_value,
      reason:         String(o.reason || '').trim(),
      expires_at:     o.expires_at !== undefined ? o.expires_at : existing.expires_at,
      modified_by:    actor,
      modified_at:    now
    });

    updateRow_(OVERRIDES_SHEET, 'override_id', o.override_id, updated, OVERRIDE_HEADERS);
    appendOverrideAudit_('update', before, updated, '');
    return updated;

  } else {
    // Create path
    const newOverride = {
      override_id:    uuid_(),
      source:         String(o.source),
      record_id:      String(o.record_id),
      field:          String(o.field),
      original_value: o.original_value !== undefined ? String(o.original_value) : '',
      override_value: o.override_value !== undefined ? String(o.override_value) : '',
      reason:         String(o.reason || '').trim(),
      expires_at:     o.expires_at || '',
      status:         'Active',
      created_by:     actor,
      created_at:     now,
      modified_by:    actor,
      modified_at:    now
    };
    appendRow_(OVERRIDES_SHEET, newOverride, OVERRIDE_HEADERS);
    appendOverrideAudit_('create', null, newOverride, '');
    return newOverride;
  }
}

/**
 * Soft-delete an override by setting status='Removed' and appending an audit row.
 */
function deleteOverride_(override_id, reason) {
  const rows = readTable_(OVERRIDES_SHEET);
  const existing = rows.find(function (r) { return String(r.override_id) === String(override_id); });
  if (!existing) throw new Error('Override not found: ' + override_id);

  const before = Object.assign({}, existing);
  const updated = Object.assign({}, existing, {
    status:      'Removed',
    modified_by: getUserEmail_(),
    modified_at: new Date()
  });
  updateRow_(OVERRIDES_SHEET, 'override_id', override_id, updated, OVERRIDE_HEADERS);
  appendOverrideAudit_('delete', before, null, String(reason || ''));
  return { ok: true, override_id: override_id };
}

/**
 * Bulk soft-delete. Calls deleteOverride_ per id, returns per-id results.
 * Errors are captured per-id rather than aborting the whole batch.
 */
function bulkDeleteOverrides_(ids, reason) {
  const results = [];
  (ids || []).forEach(function (id) {
    try {
      deleteOverride_(id, reason);
      results.push({ override_id: id, ok: true });
    } catch (e) {
      results.push({ override_id: id, ok: false, error: e.message });
    }
  });
  return results;
}

// ============================================================
// Audit
// ============================================================

/**
 * Write one row to Overrides_Audit.
 * before_json is null on create; after_json is null on delete.
 */
function appendOverrideAudit_(action, before, after, notes) {
  const row = {
    audit_id:    uuid_(),
    timestamp:   new Date(),
    actor:       getUserEmail_(),
    action:      String(action || ''),
    override_id: after ? String(after.override_id || '') : (before ? String(before.override_id || '') : ''),
    source:      after ? String(after.source || '') : (before ? String(before.source || '') : ''),
    record_id:   after ? String(after.record_id || '') : (before ? String(before.record_id || '') : ''),
    field:       after ? String(after.field || '') : (before ? String(before.field || '') : ''),
    before_json: before ? JSON.stringify(before) : null,
    after_json:  after  ? JSON.stringify(after)  : null,
    notes:       String(notes || '')
  };
  appendRow_(OVERRIDES_AUDIT_SHEET, row, OVERRIDE_AUDIT_HEADERS);
}

/**
 * Return audit rows filtered by source / record_id / override_id / actor,
 * sorted by timestamp descending.
 */
function listOverrideAudit_(filter) {
  filter = filter || {};
  let rows = readTable_(OVERRIDES_AUDIT_SHEET);
  if (filter.source)      rows = rows.filter(function (r) { return r.source === filter.source; });
  if (filter.record_id)   rows = rows.filter(function (r) { return String(r.record_id) === String(filter.record_id); });
  if (filter.override_id) rows = rows.filter(function (r) { return String(r.override_id) === String(filter.override_id); });
  if (filter.actor)       rows = rows.filter(function (r) { return r.actor === filter.actor; });
  rows.sort(function (a, b) {
    return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
  });
  return rows;
}

// ============================================================
// Lifecycle — full implementations (Drop 4)
// ============================================================

/**
 * Expire overrides whose expires_at < today. Sets status to 'Expired',
 * appends an audit row for each. Idempotent — safe on a schedule.
 * Returns the count expired.
 */
function expireOverdueOverrides_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = readTable_(OVERRIDES_SHEET);
  let count = 0;
  rows.forEach(function (r) {
    if (String(r.status || '') !== 'Active') return;
    if (!r.expires_at) return;
    const expDate = new Date(r.expires_at);
    if (isNaN(expDate.getTime())) return;
    expDate.setHours(0, 0, 0, 0);
    if (expDate >= today) return;
    const before = Object.assign({}, r);
    const updated = Object.assign({}, r, {
      status:      'Expired',
      modified_by: 'system',
      modified_at: new Date()
    });
    updateRow_(OVERRIDES_SHEET, 'override_id', r.override_id, updated, OVERRIDE_HEADERS);
    const notes = 'Auto-expired: expires_at ' + String(r.expires_at).slice(0, 10) +
                  ' < threshold ' + today.toISOString().slice(0, 10);
    const auditRow = {
      audit_id:    uuid_(),
      timestamp:   new Date(),
      actor:       'system',
      action:      'auto-expire',
      override_id: String(r.override_id || ''),
      source:      String(r.source || ''),
      record_id:   String(r.record_id || ''),
      field:       String(r.field || ''),
      before_json: JSON.stringify(before),
      after_json:  JSON.stringify(updated),
      notes:       notes
    };
    appendRow_(OVERRIDES_AUDIT_SHEET, auditRow, OVERRIDE_AUDIT_HEADERS);
    count++;
  });
  return count;
}

/**
 * Read-only diagnostic. Compares each active override's stored original_value
 * to the current value in the source tab. Returns stale records where they differ.
 */
function findStaleOverrides_() {
  const activeOverrides = listOverrides_({ status: 'Active' });
  if (!activeOverrides.length) return [];

  // Build lookup maps from source tabs.
  // Pipeline: Opportunities_Normalized keyed by opportunity_id.
  const oppsNorm = readTable_(OPPS_NORM);
  const oppsByIdPipeline = {};
  oppsNorm.forEach(function (r) {
    if (r.opportunity_id) oppsByIdPipeline[String(r.opportunity_id)] = r;
  });

  // Deployments: raw Deployments tab. Map SF column names → logical field names
  // matching the api_listDeployments mapping.
  const DEP_COL_MAP = {
    'Deployment Stage':   'deployment_stage',
    'Deployment Health':  'deployment_health',
    'Current MTP Date':  'current_mtp_date',
    'EM Name':            'em_name',
    'DAM Name':           'dam_name',
    'Deployment Name':    'deployment_name',
    'Account Name':       'account_name'
  };
  const rawDeployments = readTable_(DEPLOYMENTS_SHEET);
  const depById = {};
  rawDeployments.forEach(function (r) {
    const mapped = {};
    Object.keys(DEP_COL_MAP).forEach(function (sfCol) {
      const logical = DEP_COL_MAP[sfCol];
      const val = r[sfCol] !== undefined ? r[sfCol] : r[logical];
      if (val !== undefined) mapped[logical] = val;
    });
    // Also copy already-normalized fields
    Object.keys(r).forEach(function (k) { if (!mapped[k]) mapped[k] = r[k]; });
    const id = String(r.deployment_id || r['Deployment ID'] || '');
    if (id) depById[id] = mapped;
  });

  const stale = [];
  activeOverrides.forEach(function (o) {
    const src = String(o.source || '');
    const rid = String(o.record_id || '');
    const fld = String(o.field || '');
    let sourceRecord;
    if (src === 'Pipeline') {
      sourceRecord = oppsByIdPipeline[rid];
    } else if (src === 'Deployments') {
      sourceRecord = depById[rid];
    }
    if (!sourceRecord) return;
    const currentVal = sourceRecord[fld] !== undefined
      ? String(sourceRecord[fld])
      : '';
    const storedOriginal = String(o.original_value || '');
    if (currentVal !== storedOriginal) {
      stale.push({
        override_id:          String(o.override_id || ''),
        source:               src,
        record_id:            rid,
        field:                fld,
        original_value:       storedOriginal,
        current_source_value: currentVal,
        override_value:       String(o.override_value || ''),
        created_by:           String(o.created_by || ''),
        created_at:           o.created_at ? new Date(o.created_at).toISOString() : ''
      });
    }
  });
  return stale;
}

/**
 * Archive Overrides_Audit rows older than 365 days to Overrides_Audit_Archive.
 * Rewrites Overrides_Audit with kept rows only. Idempotent.
 * Returns count archived.
 */
function archiveOverrideAudit_() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  cutoff.setHours(0, 0, 0, 0);

  const rows = readTable_(OVERRIDES_AUDIT_SHEET);
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

  // Append archive rows to Overrides_Audit_Archive.
  archive.forEach(function (r) {
    appendRow_(OVERRIDES_AUDIT_ARCHIVE_SHEET, r, OVERRIDE_AUDIT_HEADERS);
  });

  // Rewrite Overrides_Audit with kept rows only.
  const keepMatrix = keep.map(function (r) {
    return OVERRIDE_AUDIT_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
  });
  writeTable_(OVERRIDES_AUDIT_SHEET, OVERRIDE_AUDIT_HEADERS, keepMatrix);

  return archive.length;
}

/**
 * Daily maintenance entry point. Called by the time-based trigger.
 * Runs expiration and audit archival, logs the result.
 */
function runDailyOverrideMaintenance_() {
  Logger.log('runDailyOverrideMaintenance_: starting');
  const expired = expireOverdueOverrides_();
  const archived = archiveOverrideAudit_();
  const summary = { expired: expired, archived: archived, ranAt: new Date().toISOString() };
  Logger.log('runDailyOverrideMaintenance_: ' + JSON.stringify(summary));
  return summary;
}

/**
 * Idempotent trigger installer. Returns true if a new trigger was created,
 * false if one already existed for runDailyOverrideMaintenance_.
 */
function ensureOverrideMaintenanceTrigger_() {
  const FN = 'runDailyOverrideMaintenance_';
  const existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === FN;
  });
  if (existing.length > 0) {
    Logger.log('ensureOverrideMaintenanceTrigger_: trigger already exists');
    return false;
  }
  ScriptApp.newTrigger(FN)
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  Logger.log('ensureOverrideMaintenanceTrigger_: trigger created (daily at 3 AM)');
  return true;
}

/**
 * Return a 2D array (header row + data rows) of filtered overrides, suitable
 * for CSV export. Date values coerced to ISO strings.
 */
function exportOverridesCsv_(filter) {
  const rows = listOverrides_(filter || {});
  const data = [OVERRIDE_HEADERS.slice()];
  rows.forEach(function (r) {
    data.push(OVERRIDE_HEADERS.map(function (h) {
      const v = r[h];
      if (v instanceof Date) return v.toISOString();
      return v !== undefined && v !== null ? String(v) : '';
    }));
  });
  return data;
}

/**
 * Accept a 2D matrix (header row + data rows) from CSV import.
 * Required columns: source, record_id, field, override_value, reason.
 * Optional: expires_at.
 * Each row creates a new override via saveOverride_ (create-only, no updates).
 * Returns { created, skipped }.
 */
function importOverridesCsv_(matrix) {
  if (!matrix || matrix.length < 2) return { created: 0, skipped: [] };
  const REQUIRED = ['source', 'record_id', 'field', 'override_value', 'reason'];
  const header = matrix[0].map(function (h) { return String(h || '').trim(); });
  const skipped = [];
  let created = 0;

  for (let i = 1; i < matrix.length; i++) {
    const rowArr = matrix[i];
    const rowObj = {};
    header.forEach(function (h, j) { rowObj[h] = rowArr[j] !== undefined ? String(rowArr[j]).trim() : ''; });
    const missing = REQUIRED.filter(function (k) { return !rowObj[k]; });
    if (missing.length) {
      skipped.push({ rowIndex: i, reason: 'Missing required columns: ' + missing.join(', ') });
      continue;
    }
    try {
      saveOverride_({
        source:         rowObj.source,
        record_id:      rowObj.record_id,
        field:          rowObj.field,
        override_value: rowObj.override_value,
        reason:         rowObj.reason,
        expires_at:     rowObj.expires_at || ''
      });
      created++;
    } catch (e) {
      skipped.push({ rowIndex: i, reason: e.message });
    }
  }
  return { created: created, skipped: skipped };
}

// ============================================================
// One-time trigger setup
// ============================================================
// Jeff must run ensureOverrideMaintenanceTrigger_() once from the Apps Script
// editor after deploying Drop 4. This installs a daily 3 AM trigger for:
//   - expireOverdueOverrides_() — soft-expires overrides past their expiry date
//   - archiveOverrideAudit_()   — moves audit rows older than 365 days to archive
// The trigger is idempotent and safe to re-run. It calls
// runDailyOverrideMaintenance_() which logs a summary of what was done.

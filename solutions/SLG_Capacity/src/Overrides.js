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
// Lifecycle stubs (full implementation in Drop 4)
// ============================================================

/** Expire overrides whose expires_at < today. Full impl in Drop 4. */
function expireOverdueOverrides_() {
  return 0;
}

/** Find active overrides where original_value no longer matches source. Full impl in Drop 4. */
function findStaleOverrides_() {
  return [];
}

// ============================================================
// OnLeave.gs — WFM.25 on-leave roster + return-date storage.
//
// Display-only for utilization math: on-leave workers remain
// excluded via readExclusions_ (unchanged). return_date lives on
// Config_Worker_Exclusions and survives re-ingest via reconcile.
// ============================================================

/**
 * Index on-leave workers from Allocations_Normalized (on_leave='Yes'),
 * deduped by worker_key.
 * @return {Object<string, {worker_key:string, worker_name:string, team_label:string, manager_org:string}>}
 */
function _indexOnLeaveWorkers_() {
  var alloc = cachedRead_(ALLOC_NORM) || readTable_(ALLOC_NORM) || [];
  var ctx = (typeof resolveTeamLabel_ === 'function')
    ? resolveTeamLabel_.buildCtx_()
    : null;
  var byKey = {};

  alloc.forEach(function (a) {
    if (String(a.on_leave || '').trim().toLowerCase() !== 'yes') return;
    var raw = String(a.resource_name || '').trim();
    if (!raw) return;
    var k = _exclusionKey_(raw);
    if (!k || byKey[k]) return;

    var teamLabel = (ctx && typeof resolveTeamLabel_ === 'function')
      ? resolveTeamLabel_(a, ctx)
      : String(a.team || '').trim();
    if (!teamLabel) teamLabel = 'Unknown';

    var managerRaw = String(a.manager_org || '').trim();
    var manager = (typeof normalizeManagerName_ === 'function')
      ? normalizeManagerName_(managerRaw)
      : managerRaw;

    byKey[k] = {
      worker_key: k,
      worker_name: raw,
      team_label: teamLabel,
      manager_org: manager
    };
  });

  return byKey;
}

/**
 * Map worker_key -> exclusion row.
 * @return {Object<string, Object>}
 */
function _onLeaveExclusionIndex_() {
  var out = {};
  var rows = [];
  try { rows = readTable_(CFG_WORKER_EXCLUSIONS) || []; } catch (e) { rows = []; }
  rows.forEach(function (r) {
    var k = _exclusionKey_(r.worker_name);
    if (k) out[k] = r;
  });
  return out;
}

/**
 * Human-readable source label for an on-leave worker.
 * @param {Object|null} exclRow
 * @return {string}
 */
function _onLeaveSourceDisplay_(exclRow) {
  if (!exclRow) return 'rule:on_leave';
  var src = String(exclRow.source || '');
  if (typeof _hasSource_ === 'function' && _hasSource_(exclRow, 'manual')) return 'manual';
  if (src.indexOf('manual') >= 0) return 'manual';
  return 'rule:on_leave';
}

/**
 * Parse return_date: valid Date or blank (clears). Rejects malformed input.
 * @param {*} raw
 * @return {Date|string} Date when set, '' when cleared
 */
function _parseOnLeaveReturnDate_(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  var d = new Date(raw);
  if (isNaN(d.getTime())) {
    throw new Error('return_date must be a valid date or blank');
  }
  return d;
}

/**
 * Join on-leave workers with Config_Worker_Exclusions for return_date + source.
 * @return {Object[]}
 */
function listOnLeave_() {
  var workers = _indexOnLeaveWorkers_();
  var exclByKey = _onLeaveExclusionIndex_();

  return Object.keys(workers).map(function (k) {
    var w = workers[k];
    var excl = exclByKey[k] || null;
    return {
      worker_key: k,
      worker_name: w.worker_name,
      team_label: w.team_label,
      manager_org: w.manager_org,
      source: _onLeaveSourceDisplay_(excl),
      return_date: excl ? (excl.return_date || '') : '',
      modified_by: excl ? (excl.modified_by || '') : '',
      modified_at: excl ? (excl.modified_at || '') : ''
    };
  }).sort(function (a, b) {
    return String(a.worker_name).localeCompare(String(b.worker_name));
  });
}

/**
 * Lightweight per-team on-leave roster (names + optional return_date).
 * Never used in hours math.
 * @return {Object<string, {name:string, return_date:Date|string}[]>}
 */
function getOnLeaveByTeam_() {
  var workers = _indexOnLeaveWorkers_();
  var exclByKey = _onLeaveExclusionIndex_();
  var out = {};
  Object.keys(workers).forEach(function (k) {
    var w = workers[k];
    var excl = exclByKey[k] || null;
    var tl = w.team_label || 'Unknown';
    if (!out[tl]) out[tl] = [];
    out[tl].push({
      name: w.worker_name,
      return_date: excl ? (excl.return_date || '') : ''
    });
  });
  Object.keys(out).forEach(function (tl) {
    out[tl].sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
  });
  return out;
}

/**
 * Save or clear return date on Config_Worker_Exclusions for an on-leave worker.
 * Optimistic-lock on modified_at when updating an existing row.
 *
 * @param {string} worker_key
 * @param {*} return_date valid date or blank to clear
 * @param {*} [clientModifiedAt] prior modified_at for conflict detection
 * @return {Object} saved fields for wire
 */
function saveOnLeaveReturnDate_(worker_key, return_date, clientModifiedAt) {
  var k = String(worker_key || '').trim();
  if (!k) throw new Error('worker_key is required');

  var parsedDate = _parseOnLeaveReturnDate_(return_date);
  var now = new Date();
  var actor = getUserEmail_();

  var rows = readTable_(CFG_WORKER_EXCLUSIONS) || [];
  var existing = null;
  rows.forEach(function (r) {
    if (_exclusionKey_(r.worker_name) === k) existing = r;
  });
  if (!existing) {
    throw new Error('Worker not found in Config_Worker_Exclusions: ' + k);
  }

  if (clientModifiedAt) {
    var clientModAt = new Date(clientModifiedAt).getTime();
    var serverModAt = existing.modified_at ? new Date(existing.modified_at).getTime() : 0;
    if (!isNaN(clientModAt) && !isNaN(serverModAt) && clientModAt !== serverModAt) {
      throw new Error('modified by another user, refresh');
    }
  }

  var updated = {
    worker_name: existing.worker_name,
    manager_org: existing.manager_org || '',
    reason: existing.reason || '',
    active: existing.active || 'Yes',
    source: existing.source || '',
    override: existing.override || '',
    return_date: parsedDate === '' ? '' : parsedDate,
    modified_by: actor,
    modified_at: now
  };

  updateRow_(CFG_WORKER_EXCLUSIONS, 'worker_name', existing.worker_name, updated, WORKER_EXCLUSION_HEADERS);
  invalidateCache_(CFG_WORKER_EXCLUSIONS);

  return {
    worker_key: k,
    worker_name: existing.worker_name,
    return_date: updated.return_date,
    modified_by: updated.modified_by,
    modified_at: updated.modified_at
  };
}

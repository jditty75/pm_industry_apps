// ============================================================
// DeploymentHourOverrides.gs — Authoritative hour overrides
// for active deployments.
//
// Lifecycle: Active / Expired / Removed (mirrors Overrides.gs).
// Grain: one row per (deployment_id, resource_name, period_start).
// Scenario-scoping: globally committed only (no scenario_id).
// Audit: mirrors appendOverrideAudit_ pattern.
// ============================================================

// ============================================================
// Internal audit helper
// ============================================================

/**
 * Append one row to Deployment_Hour_Overrides_Audit.
 * before_json is null on create; after_json is null on delete.
 */
function appendDeploymentHourOverrideAudit_(action, before, after, notes) {
  const ref = after || before;
  const row = {
    audit_id:      uuid_(),
    timestamp:     new Date(),
    actor:         getUserEmail_(),
    action:        String(action || ''),
    override_id:   String((ref && ref.override_id)   || ''),
    deployment_id: String((ref && ref.deployment_id) || ''),
    resource_name: String((ref && ref.resource_name) || ''),
    period_start:  (ref && ref.period_start) ? ref.period_start : '',
    before_json:   before ? JSON.stringify(before) : null,
    after_json:    after  ? JSON.stringify(after)  : null,
    notes:         String(notes || '')
  };
  appendRow_(DEPLOYMENT_HOUR_OVERRIDES_AUDIT_SHEET, row, DEPLOYMENT_HOUR_OVERRIDE_AUDIT_HEADERS);
}

// ============================================================
// PSA snapshot helper
//
// Captures the current billable hours PSA reports for a given
// (resource_name, deployment_id, period_start) combination.
// Uses the same two-tier matching as api_getWorkersForDeployment.
// ============================================================

function _capturePsaOriginalHours_(resourceName, deploymentId, periodStart) {
  try {
    const depRef = _resolveDeploymentRef_(deploymentId);
    if (!depRef) return 0;

    const mk = monthKey_(periodStart);
    const PSA_TYPES = { Billable: true };
    const allocs = cachedRead_(ALLOC_NORM);

    let matchFn = null;
    if (depRef.psa_project_name) {
      const targetNorm = _normalizeProjectName_(depRef.psa_project_name);
      const projectCount = allocs.filter(function (a) {
        return String(a.resource_name || '') === resourceName &&
               PSA_TYPES[String(a.allocation_type || '')] &&
               _normalizeProjectName_(a.project_name) === targetNorm &&
               monthKey_(a.period_start) === mk;
      }).length;
      if (projectCount > 0) {
        matchFn = function (a) { return _normalizeProjectName_(a.project_name) === targetNorm; };
      }
    }
    if (!matchFn && depRef.account_name) {
      matchFn = function (a) { return String(a.account_name || '') === depRef.account_name; };
    }
    if (!matchFn) return 0;

    return allocs
      .filter(function (a) {
        return String(a.resource_name || '') === resourceName &&
               PSA_TYPES[String(a.allocation_type || '')] &&
               monthKey_(a.period_start) === mk &&
               matchFn(a);
      })
      .reduce(function (s, a) { return s + (Number(a.hours) || 0); }, 0);
  } catch (e) {
    Logger.log('_capturePsaOriginalHours_: ' + e);
    return 0;
  }
}

// ============================================================
// Engine helper — build deployment match indexes
//
// Used by Engine.gs to apply overrides without re-reading
// the Deployments sheet multiple times per request.
// Returns { byNormProject: {normKey: [depId,...]},
//           byAccount:     {acctName: [depId,...]} }
// ============================================================

function _buildDeploymentMatchIndexes_() {
  const depRows = readTable_(DEPLOYMENTS_SHEET);
  const byNormProject = {};
  const byAccount = {};
  depRows.forEach(function (row) {
    const depId   = String(row['Deployment ID']    || row.deployment_id    || '').trim();
    const psaProj = String(row['PSA Project Name'] || row.psa_project_name || '').trim();
    const acct    = String(row['Account Name']     || row.account_name     || '').trim();
    if (!depId) return;
    if (psaProj) {
      const norm = _normalizeProjectName_(psaProj);
      if (norm) { if (!byNormProject[norm]) byNormProject[norm] = []; byNormProject[norm].push(depId); }
    }
    if (acct) { if (!byAccount[acct]) byAccount[acct] = []; byAccount[acct].push(depId); }
  });
  return { byNormProject: byNormProject, byAccount: byAccount };
}

/**
 * Given a PSA alloc row and the pre-built index from
 * _buildDeploymentMatchIndexes_, return the single matching
 * deployment_id, or null if 0 or 2+ match.
 */
function _matchDeploymentForAllocRow_(allocRow, depIdx) {
  const pn   = _normalizeProjectName_(allocRow.project_name);
  const acct = String(allocRow.account_name || '').trim();

  if (pn && depIdx.byNormProject[pn] && depIdx.byNormProject[pn].length === 1) {
    return depIdx.byNormProject[pn][0];
  }
  if (acct && depIdx.byAccount[acct] && depIdx.byAccount[acct].length === 1) {
    return depIdx.byAccount[acct][0];
  }
  return null;
}

// ============================================================
// Read & merge
// ============================================================

/**
 * Return all active deployment hour overrides as a lookup map:
 *   { '<resource_name>|<deployment_id>|<YYYY-MM>': { override_hours, ... } }
 * 'Active' means status === 'Active' AND (expires_at blank OR expires_at >= today).
 */
function readActiveDeploymentHourOverrides_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = cachedRead_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  const out = {};
  rows.forEach(function (r) {
    if (String(r.status || '') !== 'Active') return;
    if (r.expires_at) {
      const exp = new Date(r.expires_at);
      if (!isNaN(exp.getTime())) {
        exp.setHours(0, 0, 0, 0);
        if (exp < today) return;
      }
    }
    const mk = monthKey_(r.period_start);
    if (!mk) return;
    const key = String(r.resource_name || '') + '|' + String(r.deployment_id || '') + '|' + mk;
    out[key] = {
      override_id:        String(r.override_id || ''),
      override_hours:     Number(r.override_hours) || 0,
      psa_original_hours: Number(r.psa_original_hours) || 0,
      reason:             String(r.reason || ''),
      created_by:         String(r.created_by || ''),
      created_at:         r.created_at || null,
      expires_at:         r.expires_at || null
    };
  });
  return out;
}

// ============================================================
// List
// ============================================================

/**
 * List overrides with optional filters.
 * @param {Object} [filter] - { deployment_id?, resource_name?, status?, group_id? }
 */
function listDeploymentHourOverrides_(filter) {
  filter = filter || {};
  let rows = cachedRead_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  if (filter.deployment_id) rows = rows.filter(function (r) { return String(r.deployment_id) === String(filter.deployment_id); });
  if (filter.resource_name) rows = rows.filter(function (r) { return r.resource_name === filter.resource_name; });
  if (filter.status)        rows = rows.filter(function (r) { return r.status === filter.status; });
  if (filter.group_id)      rows = rows.filter(function (r) { return String(r.group_id) === String(filter.group_id); });
  return rows;
}

// ============================================================
// Save (single-month or date-range)
// ============================================================

/**
 * Create or update deployment hour overrides.
 *
 * Mode A (mode: 'single'): single-month create or update.
 * Mode B (mode: 'range'):  date-range create only (N rows sharing one group_id).
 *
 * @returns {Object[]} array of saved override rows
 */
function saveDeploymentHourOverride_(payload) {
  payload = payload || {};
  if (!String(payload.reason || '').trim()) throw new Error('reason is required');

  const mode = String(payload.mode || 'single');
  const now  = new Date();
  const actor = getUserEmail_();

  if (mode === 'single') {
    // ---- Mode A: single month ----
    if (!payload.deployment_id)  throw new Error('deployment_id is required');
    if (!payload.resource_name)  throw new Error('resource_name is required');
    if (!payload.period_start)   throw new Error('period_start is required');
    if (Number(payload.override_hours) < 0) throw new Error('override_hours must be >= 0');

    const reason     = String(payload.reason).trim();
    const overrideHrs = Number(payload.override_hours) || 0;
    const periodStart = firstOfMonth_(new Date(payload.period_start));
    const expiresAt   = payload.expires_at ? new Date(payload.expires_at) : null;

    if (payload.override_id) {
      // Update path with optimistic lock
      const rows = readTable_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
      const existing = rows.find(function (r) { return String(r.override_id) === String(payload.override_id); });
      if (!existing) throw new Error('Override not found: ' + payload.override_id);

      if (payload.modified_at) {
        const clientMod = new Date(payload.modified_at).getTime();
        const serverMod = existing.modified_at ? new Date(existing.modified_at).getTime() : 0;
        if (!isNaN(clientMod) && !isNaN(serverMod) && clientMod !== serverMod) {
          throw new Error('Override has been modified by another user. Please refresh and try again.');
        }
      }

      const before  = Object.assign({}, existing);
      const updated = Object.assign({}, existing, {
        override_hours: overrideHrs,
        reason:         reason,
        expires_at:     expiresAt || '',
        modified_by:    actor,
        modified_at:    now
      });
      updateRow_(DEPLOYMENT_HOUR_OVERRIDES_SHEET, 'override_id', String(payload.override_id), updated, DEPLOYMENT_HOUR_OVERRIDE_HEADERS);
      appendDeploymentHourOverrideAudit_('update', before, updated, '');
      invalidateCache_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
      return [updated];

    } else {
      // Create path — enforce composite key uniqueness
      const mk = monthKey_(periodStart);
      const existingRows = readTable_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
      const conflict = existingRows.find(function (r) {
        return String(r.deployment_id) === String(payload.deployment_id) &&
               String(r.resource_name) === String(payload.resource_name) &&
               monthKey_(r.period_start) === mk &&
               String(r.status || '') === 'Active';
      });
      if (conflict) {
        throw new Error('An active override already exists for this worker/deployment/month. Pass override_id to update it.');
      }

      const psaOriginal = _capturePsaOriginalHours_(String(payload.resource_name), String(payload.deployment_id), periodStart);
      const newRow = {
        override_id:        uuid_(),
        deployment_id:      String(payload.deployment_id),
        resource_name:      String(payload.resource_name),
        period_start:       periodStart,
        psa_original_hours: psaOriginal,
        override_hours:     overrideHrs,
        reason:             reason,
        status:             'Active',
        expires_at:         expiresAt || '',
        created_by:         actor,
        created_at:         now,
        modified_by:        actor,
        modified_at:        now,
        group_id:           ''
      };
      appendRow_(DEPLOYMENT_HOUR_OVERRIDES_SHEET, newRow, DEPLOYMENT_HOUR_OVERRIDE_HEADERS);
      appendDeploymentHourOverrideAudit_('create', null, newRow, '');
      invalidateCache_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
      return [newRow];
    }

  } else {
    // ---- Mode B: date-range ----
    if (!payload.deployment_id) throw new Error('deployment_id is required');
    if (!payload.resource_name) throw new Error('resource_name is required');
    if (!payload.start_date)    throw new Error('start_date is required');
    if (!payload.end_date)      throw new Error('end_date is required');
    if (Number(payload.total_hours) < 0) throw new Error('total_hours must be >= 0');

    const reason     = String(payload.reason).trim();
    const totalHours = Number(payload.total_hours) || 0;
    const expiresAt  = payload.expires_at ? new Date(payload.expires_at) : null;
    const groupId    = uuid_();
    const calendar   = readCalendar_();

    // Reuse expandAssignmentToMonthly_ to distribute hours across months
    const syntheticAssignment = {
      start_date:         payload.start_date,
      end_date:           payload.end_date,
      estimated_hours:    totalHours,
      distribution:       payload.distribution || 'Even',
      custom_monthly_json: payload.custom_monthly_json || ''
    };
    const monthlyRows = expandAssignmentToMonthly_(syntheticAssignment, calendar);

    const saved = [];
    monthlyRows.forEach(function (m) {
      if (!m.hours || m.hours <= 0) return;
      const periodStart = firstOfMonth_(m.period_start);
      const psaOriginal = _capturePsaOriginalHours_(String(payload.resource_name), String(payload.deployment_id), periodStart);
      const newRow = {
        override_id:        uuid_(),
        deployment_id:      String(payload.deployment_id),
        resource_name:      String(payload.resource_name),
        period_start:       periodStart,
        psa_original_hours: psaOriginal,
        override_hours:     Math.round(m.hours * 10) / 10,
        reason:             reason,
        status:             'Active',
        expires_at:         expiresAt || '',
        created_by:         actor,
        created_at:         now,
        modified_by:        actor,
        modified_at:        now,
        group_id:           groupId
      };
      appendRow_(DEPLOYMENT_HOUR_OVERRIDES_SHEET, newRow, DEPLOYMENT_HOUR_OVERRIDE_HEADERS);
      appendDeploymentHourOverrideAudit_('create', null, newRow, '');
      saved.push(newRow);
    });

    invalidateCache_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
    return saved;
  }
}

// ============================================================
// Delete (soft)
// ============================================================

/**
 * Soft-delete a single override (status = 'Removed').
 */
function deleteDeploymentHourOverride_(override_id, reason) {
  const rows = readTable_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  const existing = rows.find(function (r) { return String(r.override_id) === String(override_id); });
  if (!existing) throw new Error('Override not found: ' + override_id);

  const before  = Object.assign({}, existing);
  const updated = Object.assign({}, existing, {
    status:      'Removed',
    modified_by: getUserEmail_(),
    modified_at: new Date()
  });
  updateRow_(DEPLOYMENT_HOUR_OVERRIDES_SHEET, 'override_id', String(override_id), updated, DEPLOYMENT_HOUR_OVERRIDE_HEADERS);
  appendDeploymentHourOverrideAudit_('delete', before, null, String(reason || ''));
  invalidateCache_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  return { ok: true, override_id: String(override_id) };
}

/**
 * Soft-delete all overrides sharing a group_id.
 */
function deleteDeploymentHourOverrideGroup_(group_id, reason) {
  const rows = readTable_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  const targets = rows.filter(function (r) {
    return String(r.group_id || '') === String(group_id) &&
           String(r.status || '') !== 'Removed';
  });
  if (!targets.length) throw new Error('No active overrides found for group: ' + group_id);

  const actor = getUserEmail_();
  const now   = new Date();
  targets.forEach(function (r) {
    const before  = Object.assign({}, r);
    const updated = Object.assign({}, r, { status: 'Removed', modified_by: actor, modified_at: now });
    updateRow_(DEPLOYMENT_HOUR_OVERRIDES_SHEET, 'override_id', String(r.override_id), updated, DEPLOYMENT_HOUR_OVERRIDE_HEADERS);
    appendDeploymentHourOverrideAudit_('delete', before, null, String(reason || ''));
  });
  invalidateCache_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  return { ok: true, group_id: String(group_id), removed: targets.length };
}

// ============================================================
// Expiry maintenance
// ============================================================

/**
 * Idempotent. Flip Active rows whose expires_at < today to 'Expired'.
 * Returns count expired.
 */
function expireOverdueDeploymentHourOverrides_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = readTable_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  let count = 0;
  rows.forEach(function (r) {
    if (String(r.status || '') !== 'Active') return;
    if (!r.expires_at) return;
    const expDate = new Date(r.expires_at);
    if (isNaN(expDate.getTime())) return;
    expDate.setHours(0, 0, 0, 0);
    if (expDate >= today) return;

    const before  = Object.assign({}, r);
    const updated = Object.assign({}, r, { status: 'Expired', modified_by: 'system', modified_at: new Date() });
    updateRow_(DEPLOYMENT_HOUR_OVERRIDES_SHEET, 'override_id', String(r.override_id), updated, DEPLOYMENT_HOUR_OVERRIDE_HEADERS);
    const notes = 'Auto-expired: expires_at ' + String(r.expires_at).slice(0, 10) +
                  ' < ' + today.toISOString().slice(0, 10);
    appendDeploymentHourOverrideAudit_('auto-expire', before, updated, notes);
    count++;
  });
  if (count > 0) invalidateCache_(DEPLOYMENT_HOUR_OVERRIDES_SHEET);
  return count;
}

/**
 * Archive audit rows older than 365 days to the _Archive table.
 * Returns count archived.
 */
function archiveDeploymentHourOverrideAudit_() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  cutoff.setHours(0, 0, 0, 0);

  const rows = readTable_(DEPLOYMENT_HOUR_OVERRIDES_AUDIT_SHEET);
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
    appendRow_(DEPLOYMENT_HOUR_OVERRIDES_AUDIT_ARCHIVE_SHEET, r, DEPLOYMENT_HOUR_OVERRIDE_AUDIT_HEADERS);
  });

  const keepMatrix = keep.map(function (r) {
    return DEPLOYMENT_HOUR_OVERRIDE_AUDIT_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
  });
  writeTable_(DEPLOYMENT_HOUR_OVERRIDES_AUDIT_SHEET, DEPLOYMENT_HOUR_OVERRIDE_AUDIT_HEADERS, keepMatrix);

  return archive.length;
}

/**
 * Daily maintenance entry point. Calls expire + archive.
 */
function runDailyDeploymentHourOverrideMaintenance_() {
  Logger.log('runDailyDeploymentHourOverrideMaintenance_: starting');
  const expired  = expireOverdueDeploymentHourOverrides_();
  const archived = archiveDeploymentHourOverrideAudit_();
  const summary  = { expired: expired, archived: archived, ranAt: new Date().toISOString() };
  Logger.log('runDailyDeploymentHourOverrideMaintenance_: ' + JSON.stringify(summary));
  return summary;
}

/**
 * Idempotent trigger installer. Run once from the Apps Script editor
 * after first deploy to set up the daily maintenance job.
 */
function ensureDeploymentHourOverrideMaintenanceTrigger_() {
  const FN = 'runDailyDeploymentHourOverrideMaintenance_';
  const existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === FN;
  });
  if (existing.length > 0) {
    Logger.log('ensureDeploymentHourOverrideMaintenanceTrigger_: trigger already exists');
    return false;
  }
  ScriptApp.newTrigger(FN)
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
  Logger.log('ensureDeploymentHourOverrideMaintenanceTrigger_: trigger created (daily at 4 AM)');
  return true;
}

// ============================================================
// Hygiene summary (used by Admin panel)
// ============================================================

/**
 * Return counts for the Admin hygiene tiles:
 *   activeTotal, expiringSoon (<=30d), longRunning (no expiry, created >90d ago), stale.
 * "Stale" = current PSA billable for that (worker, dep, month) matches override_hours within 0.5h.
 */
function getDeploymentHourOverrideHygiene_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30  = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const ago90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

  const activeRows = listDeploymentHourOverrides_({ status: 'Active' });

  let expiringSoon = 0;
  let longRunning  = 0;
  activeRows.forEach(function (r) {
    if (r.expires_at) {
      const exp = new Date(r.expires_at);
      if (!isNaN(exp.getTime()) && exp >= today && exp <= in30) expiringSoon++;
    } else {
      const created = r.created_at ? new Date(r.created_at) : null;
      if (created && !isNaN(created.getTime()) && created < ago90) longRunning++;
    }
  });

  // Stale: current PSA billable within 0.5h of override_hours
  let stale = 0;
  activeRows.forEach(function (r) {
    try {
      const currentPsa = _capturePsaOriginalHours_(String(r.resource_name || ''), String(r.deployment_id || ''), r.period_start);
      if (Math.abs(currentPsa - (Number(r.override_hours) || 0)) <= 0.5) stale++;
    } catch (e) { /* tolerate */ }
  });

  return {
    activeTotal:  activeRows.length,
    expiringSoon: expiringSoon,
    longRunning:  longRunning,
    stale:        stale
  };
}

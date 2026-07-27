// ============================================================
// Assignments.gs — CRUD + preview for Opportunity_Assignments
// Invalidates ASSIGNMENTS cache on writes.
// ============================================================

function listAssignments_(filter) {
  filter = filter || {};
  let rows = cachedRead_(ASSIGNMENTS);
  if (filter.opportunity_id) rows = rows.filter(r => r.opportunity_id === filter.opportunity_id);
  if (filter.status)         rows = rows.filter(r => r.status === filter.status);
  if (filter.scenario_id)    rows = rows.filter(r => r.scenario_id === filter.scenario_id);
  if (filter.resource_name)  rows = rows.filter(r => r.resource_name === filter.resource_name);
  return rows;
}

/**
 * Save (create or update) an Opportunity_Assignments row.
 *
 * Priority 4 derivation contract:
 *   The client passes the user's literal Role-dropdown selection as
 *   `resource_type`. The server then enriches the row with:
 *     - team_label  ← lookup via Config_Resource_Type (resource_type → team_label).
 *                    Falls through to 'Unclassified' if no config match.
 *     - role        ← inverse-derived from team_label via Config_Roles
 *                    (only when team_label maps to exactly one ICP role,
 *                    e.g., Functional Consulting → CS_FUNC).
 *                    Blank for ambiguous teams (e.g., Delivery → EM/PD/DA)
 *                    or when team_label is Unclassified.
 *     - team        ← duplicates team_label on writes (legacy column,
 *                    deferred for consolidation post-demo).
 *
 *   The server overwrites any client-supplied values for `role`, `team`,
 *   and `team_label` — the client's responsibility is just to pass the
 *   canonical `resource_type`.
 *
 *   Lookup is case-insensitive and tolerant of whitespace, matching the
 *   patterns used elsewhere (readConfigResourceType_ + _classifyTeam_).
 */
function saveAssignment_(a) {
  const user = getUserEmail_();
  const ts = now_();

  a.estimated_hours = Number(a.estimated_hours) || 0;
  a.distribution = a.distribution || 'Even';
  a.status = a.status || 'Modeled';

  if (a.start_date) a.start_date = new Date(a.start_date);
  if (a.end_date) a.end_date = new Date(a.end_date);

  // Priority 4: derive team_label, role, and team from resource_type.
  // The client passes resource_type; server enriches the rest.
  const resourceTypeRaw = String(a.resource_type || '').trim();
  a.resource_type = resourceTypeRaw;

  let teamLabel = 'Unclassified';
  if (resourceTypeRaw) {
    try {
      const rtMap = readConfigResourceType_();
      // Case-insensitive lookup, same pattern as _classifyTeam_'s lowerIdx.
      const lowerIdx = {};
      Object.keys(rtMap).forEach(function (k) {
        lowerIdx[String(k).toLowerCase()] = rtMap[k];
      });
      const hit = rtMap[resourceTypeRaw] || lowerIdx[resourceTypeRaw.toLowerCase()];
      if (hit) teamLabel = String(hit).trim() || 'Unclassified';
    } catch (e) {
      Logger.log('saveAssignment_: team_label lookup failed — ' + e);
    }
  }
  a.team_label = teamLabel;

  // Inverse-derive the ICP role from team_label (only when unambiguous).
  let icpRole = '';
  try {
    if (typeof _resolveIcpRoleFromTeamLabel_ === 'function') {
      icpRole = _resolveIcpRoleFromTeamLabel_(teamLabel) || '';
    }
  } catch (e) {
    Logger.log('saveAssignment_: ICP role derivation failed — ' + e);
  }
  a.role = icpRole;

  // Legacy team column duplicates team_label on writes (deferred cleanup).
  a.team = teamLabel;

  if (!a.assignment_id) {
    // 60-second natural-key dedup: prevents double-submit duplicates.
    const _startIso = a.start_date ? a.start_date.toISOString().slice(0,10) : '';
    const _endIso   = a.end_date   ? a.end_date.toISOString().slice(0,10)   : '';
    const _existing = listAssignments_({}).find(function (r) {
      if (r.opportunity_id !== a.opportunity_id) return false;
      if (r.resource_name  !== a.resource_name)  return false;
      if (String(r.start_date || '').slice(0,10) !== _startIso) return false;
      if (String(r.end_date   || '').slice(0,10) !== _endIso)   return false;
      if (Number(r.estimated_hours) !== Number(a.estimated_hours)) return false;
      if (String(r.status || 'Modeled') !== String(a.status || 'Modeled')) return false;
      try {
        var _age = Date.now() - new Date(r.created_at).getTime();
        return _age >= 0 && _age < 60000;
      } catch (e) { return false; }
    });
    if (_existing) {
      Logger.log('saveAssignment_: dedup hit — returning existing ' + _existing.assignment_id);
      return _existing;
    }

    a.assignment_id = uuid_();
    a.created_by = user;
    a.created_at = ts;
    a.modified_by = user;
    a.modified_at = ts;
    appendRow_(ASSIGNMENTS, a, ASSIGN_HEADERS);
  } else {
    a.modified_by = user;
    a.modified_at = ts;
    updateRow_(ASSIGNMENTS, 'assignment_id', a.assignment_id, a, ASSIGN_HEADERS);
  }

  invalidateCache_(ASSIGNMENTS);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  return a;
}

function setAssignmentStatus_(assignment_id, status) {
  const user = getUserEmail_();
  updateRow_(ASSIGNMENTS, 'assignment_id', assignment_id, {
    status: status, modified_by: user, modified_at: now_()
  }, ASSIGN_HEADERS);
  invalidateCache_(ASSIGNMENTS);
  if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
  return { assignment_id: assignment_id, status: status };
}

/**
 * Weekly expansion for the assignment-form preview chart, rolled up to
 * months for display (weekly-forecast-migration). Replaces
 * previewAssignmentMonthly_. Uses splitWeekAcrossMonths_ so the sum of
 * returned monthly hours always equals the weekly expansion's total.
 * @return {{ monthKey: string, hours: number }[]}
 */
function previewAssignmentWeekly_(a) {
  if (a.start_date) a.start_date = new Date(a.start_date);
  if (a.end_date)   a.end_date   = new Date(a.end_date);
  a.estimated_hours = Number(a.estimated_hours) || 0;
  const settings = readSettings_();
  const basis = settings['week_month_split_basis'] || 'calendar';
  const weekly = expandAssignmentToWeekly_(a, readCalendar_());
  const byMonth = {};
  weekly.forEach(w => {
    splitWeekAcrossMonths_(w.week_start, w.hours, basis).forEach(part => {
      byMonth[part.monthKey] = (byMonth[part.monthKey] || 0) + part.hours;
    });
  });
  return Object.keys(byMonth).sort().map(mk => ({ monthKey: mk, hours: byMonth[mk] }));
}
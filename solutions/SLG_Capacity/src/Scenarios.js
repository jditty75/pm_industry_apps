// ============================================================
// Scenarios.gs — CRUD for named scenarios + bulk commit
// Invalidates SCENARIOS (and ASSIGNMENTS where relevant) cache on writes.
// ============================================================

function listScenarios_() {
  return cachedRead_(SCENARIOS);
}

function saveScenario_(s) {
  const user = getUserEmail_();
  const ts = now_();
  if (!s.scenario_id) {
    s.scenario_id = uuid_();
    s.status      = s.status || 'Active';
    s.created_by  = user;
    s.created_at  = ts;
    s.modified_by = user;
    s.modified_at = ts;
    appendRow_(SCENARIOS, s, SCENARIO_HEADERS);
  } else {
    s.modified_by = user;
    s.modified_at = ts;
    updateRow_(SCENARIOS, 'scenario_id', s.scenario_id, s, SCENARIO_HEADERS);
  }
  invalidateCache_(SCENARIOS);
  return s;
}

function commitScenario_(scenario_id) {
  const rows = readTable_(ASSIGNMENTS)
    .filter(a => a.scenario_id === scenario_id && a.status === 'Modeled');
  rows.forEach(a => setAssignmentStatus_(a.assignment_id, 'Committed'));
  invalidateCache_(ASSIGNMENTS);
  invalidateCache_(SCENARIOS);
  return { promoted: rows.length };
}

function archiveScenario_(scenario_id) {
  const user = getUserEmail_();
  updateRow_(SCENARIOS, 'scenario_id', scenario_id, {
    status: 'Archived', modified_by: user, modified_at: now_()
  }, SCENARIO_HEADERS);
  invalidateCache_(SCENARIOS);
  return { scenario_id: scenario_id, status: 'Archived' };
}
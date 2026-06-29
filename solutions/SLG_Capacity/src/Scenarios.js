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

  // Drop 6: also commit capacity adjustments belonging to this scenario.
  let adjsPromoted = 0;
  try {
    const adjs = readTable_(CAPACITY_ADJUSTMENTS_SHEET)
      .filter(a => a.scenario_id === scenario_id && a.status === 'Modeled');
    adjs.forEach(a => setAdjustmentStatus_(a.adjustment_id, 'Committed'));
    adjsPromoted = adjs.length;
  } catch (e) {
    Logger.log('commitScenario_: adjustments commit failed — ' + e);
  }

  invalidateCache_(SCENARIOS);
  return { promoted: rows.length, adjustments_promoted: adjsPromoted };
}

function archiveScenario_(scenario_id) {
  const user = getUserEmail_();
  updateRow_(SCENARIOS, 'scenario_id', scenario_id, {
    status: 'Archived', modified_by: user, modified_at: now_()
  }, SCENARIO_HEADERS);
  invalidateCache_(SCENARIOS);
  return { scenario_id: scenario_id, status: 'Archived' };
}

/**
 * Restore an archived scenario back to Active.
 * Does NOT un-archive child rows — only the scenario itself.
 *
 * @param {string} scenario_id
 * @returns {{ scenario_id: string, status: string }}
 */
function restoreScenario_(scenario_id) {
  const user = getUserEmail_();
  updateRow_(SCENARIOS, 'scenario_id', scenario_id, {
    status: 'Active',
    modified_by: user,
    modified_at: now_()
  }, SCENARIO_HEADERS);
  invalidateCache_(SCENARIOS);
  return { scenario_id: scenario_id, status: 'Active' };
}
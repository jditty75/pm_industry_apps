// ============================================================
// TeamsConfig.gs — map PSA project role / job profile to
// BRD taxonomy: Functional/Technical/Delivery + subteams
// ============================================================

/**
 * Load Config_Teams into an in-memory structure.
 * Each row: patterns + resolved team_type/subteam.
 */
function readTeamsConfig_() {
  let rows;
  try {
    rows = readTable_(CFG_TEAMS);
  } catch (e) {
    // If sheet doesn't exist yet, just return empty.
    return [];
  }

  return rows
    .map(r => ({
      projectRolePattern: String(r.project_role_pattern || '').toLowerCase(),
      jobProfilePattern:  String(r.job_profile_pattern  || '').toLowerCase(),
      teamType:  String(r.team_type  || '').trim(),  // Functional / Technical / Delivery
      subteam:  String(r.subteam    || '').trim(),   // FIN / HCM / PATT / INT / RPT / DC / EM / PD
      priority: Number(r.priority   || 0)
    }))
    // Only keep rows that have at least a pattern and a teamType
    .filter(r => (r.projectRolePattern || r.jobProfilePattern) && r.teamType);
}

/**
 * Given a PSA allocation row, infer BRD-level team + subteam.
 *
 * @param {Object} a Allocation row from Allocations_Normalized
 *   (fields: job_profile, role_category, etc.)
 * @param {Array} cfg Optional preloaded rules from readTeamsConfig_()
 * @return {{teamType: string, subteam: string}}
 */
function classifyTeamForAllocation_(a, cfg) {
  cfg = cfg || readTeamsConfig_();

  const projectRole = String(a.role_category || a.project_role || '').toLowerCase();
  const jobProfile  = String(a.job_profile   || '').toLowerCase();

  let best = null;
  cfg.forEach(rule => {
    let match = false;
    if (rule.projectRolePattern && projectRole.indexOf(rule.projectRolePattern) >= 0) {
      match = true;
    }
    if (!match && rule.jobProfilePattern && jobProfile.indexOf(rule.jobProfilePattern) >= 0) {
      match = true;
    }
    if (!match) return;

    if (!best || rule.priority > best.priority) {
      best = rule;
    }
  });

  if (best) {
    return {
      teamType: best.teamType, // 'Functional', 'Technical', 'Delivery', etc.
      subteam:  best.subteam   // 'FIN', 'HCM', 'PATT', 'INT', 'RPT', 'DC', 'EM', 'PD'
    };
  }

  // Fallback if nothing matched
  return { teamType: '', subteam: '' };
}
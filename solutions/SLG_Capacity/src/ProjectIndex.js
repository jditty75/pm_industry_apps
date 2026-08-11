// ============================================================
// ProjectIndex.gs — WFM.25 unified bookable-project index
// (opportunities + PSA deployments + PSA fallback). Cached per
// execution; consumed by Add/Commit pickers and Commitments ledger.
// ============================================================

/** @type {{ list: Object[], byKey: Object }|null} */
var _projectIndexCache_ = null;

/**
 * Normalize PSA project name for case-insensitive matching.
 * @param {*} s
 * @return {string}
 */
function _normPsaProject_(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * PSA-fallback identity key (Account|Project).
 * @param {string} account
 * @param {string} project
 * @return {string}
 */
function _psaFallbackKey_(account, project) {
  return _normPsaProject_(account) + '|' + _normPsaProject_(project);
}

/**
 * Build composite lookup key for a project index entry.
 * @param {string} idType
 * @param {string} id
 * @return {string}
 */
function _projectIndexKey_(idType, id) {
  return String(idType || '') + ':' + String(id || '');
}

/**
 * Return the cached unified project index (flat list + byKey map).
 * Tiers: opportunity (OPPS_NORM) → deployment (PSA Project ↔ Deployments.PSA Project Name)
 * → psa fallback (active ALLOC_NORM Account+Project with no deployment match).
 * @return {{ list: Object[], byKey: Object }}
 */
function getProjectIndex_() {
  if (_projectIndexCache_) return _projectIndexCache_;

  var list = [];
  var byKey = {};

  /**
   * @param {Object} entry
   */
  function addEntry_(entry) {
    var k = _projectIndexKey_(entry.id_type, entry.id);
    if (byKey[k]) return;
    byKey[k] = entry;
    list.push(entry);
  }

  // Tier 1 — Opportunities
  try {
    readTable_(OPPS_NORM).forEach(function (o) {
      if (!o.opportunity_id) return;
      var acct = String(o.account || '').trim();
      var name = String(o.opportunity_name || o.opportunity_id).trim();
      addEntry_({
        id_type: 'opportunity',
        id: String(o.opportunity_id),
        label: acct ? acct + ' \u2014 ' + name : name,
        account: acct,
        psa_project: '',
        opportunity_id: String(o.opportunity_id),
        deployment_id: ''
      });
    });
  } catch (e) {
    Logger.log('getProjectIndex_: opps read failed — ' + e);
  }

  // Active PSA projects from Allocations_Normalized (distinct project_name with hours)
  var activePsaByNorm = {};
  try {
    cachedRead_(ALLOC_NORM).forEach(function (a) {
      var proj = String(a.project_name || '').trim();
      if (!proj) return;
      var hrs = Number(a.hours) || 0;
      if (!hrs) return;
      var norm = _normPsaProject_(proj);
      if (!activePsaByNorm[norm]) {
        activePsaByNorm[norm] = {
          account: String(a.account_name || '').trim(),
          project: proj
        };
      }
    });
  } catch (e) {
    Logger.log('getProjectIndex_: alloc read failed — ' + e);
  }

  // Deployments sheet rows
  var deployments = [];
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(DEPLOYMENTS_SHEET);
    if (sh) {
      var vals = sh.getDataRange().getValues();
      if (vals.length > 1) {
        var hdr = vals[0];
        var hIdx = {};
        hdr.forEach(function (h, i) { hIdx[String(h).trim()] = i; });
        var vd = function (row, col) {
          var i = hIdx[col];
          return i >= 0 ? row[i] : '';
        };
        for (var ri = 1; ri < vals.length; ri++) {
          var row = vals[ri];
          var depId = String(vd(row, 'Deployment ID') || '').trim();
          var depName = String(vd(row, 'Deployment Name') || '').trim();
          var acctName = String(vd(row, 'Account Name') || '').trim();
          var psaProjName = String(vd(row, 'PSA Project Name') || '').trim();
          if (!depId && !depName) continue;
          deployments.push({
            deployment_id: depId || depName,
            deployment_name: depName || depId,
            account_name: acctName,
            psa_project_name: psaProjName
          });
        }
      }
    }
  } catch (e) {
    Logger.log('getProjectIndex_: deployments read failed — ' + e);
  }

  var psaMatchedToDeployment = {};

  // Tier 2 — Active PSA deployment matched to Deployments (exact PSA Project Name)
  deployments.forEach(function (d) {
    var psaName = String(d.psa_project_name || '').trim();
    if (!psaName) return;
    var norm = _normPsaProject_(psaName);
    if (!activePsaByNorm[norm]) return;
    psaMatchedToDeployment[norm] = true;
    var acct = String(d.account_name || activePsaByNorm[norm].account || '').trim();
    var depLabel = String(d.deployment_name || d.deployment_id || '').trim();
    var label = acct ? acct + ' \u2014 ' + depLabel : depLabel;
    addEntry_({
      id_type: 'deployment',
      id: String(d.deployment_id),
      label: label,
      account: acct,
      psa_project: psaName,
      opportunity_id: '',
      deployment_id: String(d.deployment_id)
    });
  });

  // Tier 3 — PSA fallback (active project with no deployment match)
  Object.keys(activePsaByNorm).forEach(function (norm) {
    if (psaMatchedToDeployment[norm]) return;
    var p = activePsaByNorm[norm];
    var acct = String(p.account || '').trim();
    var proj = String(p.project || '').trim();
    var id = _psaFallbackKey_(acct, proj);
    var label = acct ? acct + ' \u2014 ' + proj : proj;
    addEntry_({
      id_type: 'psa',
      id: id,
      label: label,
      account: acct,
      psa_project: proj,
      opportunity_id: '',
      deployment_id: ''
    });
  });

  list.sort(function (a, b) {
    return String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' });
  });

  _projectIndexCache_ = { list: list, byKey: byKey };
  return _projectIndexCache_;
}

/**
 * Clear the per-execution project index cache.
 */
function invalidateProjectIndexCache_() {
  _projectIndexCache_ = null;
}

/**
 * Resolve a project label from an assignment row via the unified index.
 * @param {Object} a assignment row
 * @return {string}
 */
function resolveAssignmentProjectLabel_(a) {
  if (!a) return 'Unknown project';
  var idx = getProjectIndex_();
  if (a.project_id_type && a.project_id) {
    var hit = idx.byKey[_projectIndexKey_(a.project_id_type, a.project_id)];
    if (hit) return hit.label;
  }
  if (a.project_label) return String(a.project_label);
  if (a.opportunity_id) {
    var opp = idx.byKey[_projectIndexKey_('opportunity', a.opportunity_id)];
    if (opp) return opp.label;
  }
  if (a.opportunity_id) return String(a.opportunity_id);
  return 'Unknown project';
}

/**
 * Filter the unified index to projects a worker is allocated to (Reduce picker).
 * Matches worker ALLOC_NORM project_name to index psa_project (deployment/psa tiers).
 * @param {string} resourceName
 * @param {*} [startDate]
 * @param {*} [endDate]
 * @return {Object[]}
 */
function getWorkerReduceProjectIndex_(resourceName, startDate, endDate) {
  resourceName = String(resourceName || '');
  if (!resourceName) return [];

  var start = startDate ? new Date(startDate) : null;
  var end = endDate ? new Date(endDate) : null;
  if (start && isNaN(start.getTime())) start = null;
  if (end && isNaN(end.getTime())) end = null;

  var workerPsa = {};
  try {
    cachedRead_(ALLOC_NORM).forEach(function (a) {
      if (String(a.resource_name || '') !== resourceName) return;
      var hrs = Number(a.hours) || 0;
      if (!hrs) return;
      if (start && end && a.week_start) {
        var ws = a.week_start instanceof Date ? a.week_start : new Date(a.week_start);
        if (!isNaN(ws.getTime()) && (ws < start || ws > end)) return;
      }
      var proj = String(a.project_name || '').trim();
      if (proj) workerPsa[_normPsaProject_(proj)] = true;
    });
  } catch (e) {
    Logger.log('getWorkerReduceProjectIndex_: ' + e);
  }

  return getProjectIndex_().list.filter(function (p) {
    if (p.id_type === 'opportunity') return false;
    var psa = _normPsaProject_(p.psa_project);
    return psa && workerPsa[psa];
  });
}

/**
 * Resolve project identity fields from a soft-booking / commit payload.
 * @param {Object} b booking payload
 * @return {{ project_id_type: string, project_id: string, project_label: string, opportunity_id: string, deployment_id: string }}
 */
function resolveBookingProjectIdentity_(b) {
  b = b || {};
  var what = b.what || {};
  var out = {
    project_id_type: String(b.project_id_type || ''),
    project_id: String(b.project_id || ''),
    project_label: String(b.project_label || ''),
    opportunity_id: '',
    deployment_id: ''
  };

  if (out.project_id_type && out.project_id) {
    if (!out.project_label) {
      var hit = getProjectIndex_().byKey[_projectIndexKey_(out.project_id_type, out.project_id)];
      if (hit) out.project_label = hit.label;
    }
    if (out.project_id_type === 'opportunity') out.opportunity_id = out.project_id;
    if (out.project_id_type === 'deployment') out.deployment_id = out.project_id;
    return out;
  }

  var whatType = String(what.type || '');
  if (whatType === 'project' && what.project_key) {
    var parts = String(what.project_key).split(':');
    if (parts.length >= 2) {
      out.project_id_type = parts[0];
      out.project_id = parts.slice(1).join(':');
      var entry = getProjectIndex_().byKey[_projectIndexKey_(out.project_id_type, out.project_id)];
      if (entry) out.project_label = entry.label;
      if (out.project_id_type === 'opportunity') out.opportunity_id = out.project_id;
      if (out.project_id_type === 'deployment') out.deployment_id = out.project_id;
    }
    return out;
  }

  if (whatType === 'opportunity') {
    out.project_id_type = 'opportunity';
    out.project_id = String(what.opportunity_id || '');
    out.opportunity_id = out.project_id;
    if (out.project_id) {
      var opp = getProjectIndex_().byKey[_projectIndexKey_('opportunity', out.project_id)];
      if (opp) out.project_label = opp.label;
    }
    return out;
  }

  if (whatType === 'deployment') {
    out.project_id_type = 'deployment';
    out.project_id = String(what.deployment_id || what.opportunity_id || '');
    out.deployment_id = out.project_id;
    if (out.project_id) {
      var dep = getProjectIndex_().byKey[_projectIndexKey_('deployment', out.project_id)];
      if (dep) out.project_label = dep.label;
    }
    return out;
  }

  return out;
}

/**
 * Wire API: full unified project index for Add-hours picker.
 * @return {Object[]}
 */
function api_getProjectIndex() {
  _requireAuthorized_();
  return getProjectIndex_().list;
}

/**
 * Wire API: worker-scoped project list for Reduce-hours picker.
 * @param {{ resource_name: string, start_date?: string, end_date?: string }} params
 * @return {Object[]}
 */
function api_getWorkerReduceProjects(params) {
  _requireAuthorized_();
  params = params || {};
  return getWorkerReduceProjectIndex_(
    String(params.resource_name || ''),
    params.start_date,
    params.end_date
  );
}

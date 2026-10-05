#!/usr/bin/env python3
"""Sanitized DM preview fixtures and response builders (M1 handlers)."""

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
FIXTURES = SCRIPT_DIR / "fixtures" / "dm"

M1_HANDLERS = (
    "getIdentityBoot",
    "getDataFreshnessForUI",
    "getAllDeploymentsForUI",
    "getOverviewData",
)

SCENARIOS = (
    "mixed-health",
    "at-risk",
    "empty",
    "go-live-window",
    "edge-values",
    "volume",
    "notable-active-complete",
)

SYNTHETIC_ACCOUNTS = [
    "Example County",
    "Sample Health System",
    "Example University",
    "Test Customer Agency",
    "Demo Municipal Corp",
    "Preview State College",
    "Synthetic K-12 District",
    "Mock Regional Hospital",
]

STAGES = {
    "starting": "On-Boarding",
    "building": "Test",
    "landing": "Deploy",
}


def _load_json(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def load_app_profiles() -> dict[str, Any]:
    return _load_json("app-profiles.json")


def _today_key() -> str:
    return date.today().isoformat()


def _add_days(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _base_row(
    idx: int,
    account: str,
    health: str,
    stage_key: str,
    *,
    deployment_name: str | None = None,
    partner: str = "Preview Partner LLC",
    product_area: str = "Core Financials",
) -> dict[str, Any]:
    dep_id = f"PREVIEW_DEP_{idx:04d}"
    name = deployment_name or f"Preview Deployment {idx}"
    return {
        "rowIndex": idx + 2,
        "deploymentId": dep_id,
        "parentDeploymentId": dep_id,
        "accountName": account,
        "deploymentName": name,
        "health": health,
        "stage": STAGES.get(stage_key, "Test"),
        "phase": "Phase 2",
        "partner": partner,
        "deliveryDirector": "Preview Delivery Director",
        "wdEngManager": "Preview Eng Manager",
        "mtpDate": _add_days(14 + idx),
        "goLiveDate": _add_days(30 + idx),
        "productArea": product_area,
        "region": "Preview Region",
        "industry": "Public Sector Preview",
        "deploymentRowSource": "preview-fixture",
    }


def _product_mode_rows() -> list[dict[str, Any]]:
    """Rows that satisfy HS / PDX / EVI name filters when product mode is on."""
    return [
        _base_row(101, "Sample Health System", "Green", "building", deployment_name="HiredScore Rollout Alpha"),
        _base_row(102, "Example University", "Yellow", "starting", deployment_name="HiredScore Campus Beta"),
        _base_row(103, "Test Customer Agency", "Red", "landing", deployment_name="Paradox Recruiting Cloud"),
        _base_row(104, "Example County", "Green", "building", deployment_name="Evisort CLM Rollout"),
        _base_row(105, "Demo Municipal Corp", "Yellow", "building", deployment_name="HiredScore Legacy Sandbox"),
        _base_row(106, "Preview State College", "Green", "starting", deployment_name="Unmatched Industry Parent"),
        _base_row(107, "Example County", "Green", "Test", deployment_name="Evisort Contract AI"),
        _base_row(108, "Sample Health System", "Yellow", "On-Boarding", deployment_name="CLM Implementation"),
        _base_row(109, "Test Customer Agency", "Red", "Deploy", deployment_name="Paradox Scheduling"),
        _base_row(110, "Demo Municipal Corp", "Green", "Test", deployment_name="Paradox Assistant"),
    ]


def _industry_rows_mixed() -> list[dict[str, Any]]:
    health_cycle = ["Green", "Green", "Green", "Yellow", "Red"]
    stage_cycle = ["starting", "building", "building", "landing", "building"]
    rows = []
    for i in range(12):
        acct = SYNTHETIC_ACCOUNTS[i % len(SYNTHETIC_ACCOUNTS)]
        rows.append(
            _base_row(
                i + 1,
                acct,
                health_cycle[i % len(health_cycle)],
                stage_cycle[i % len(stage_cycle)],
            )
        )
    return rows


def deployments_for_scenario(scenario: str) -> list[dict[str, Any]]:
    if scenario == "notable-active-complete":
        from preview_dm_notable import notable_active_complete_fixture

        active, _complete, _peers = notable_active_complete_fixture()
        return active
    if scenario == "empty":
        return []
    if scenario == "at-risk":
        rows = []
        for i in range(10):
            h = "Red" if i < 4 else "Yellow"
            rows.append(_base_row(i + 1, SYNTHETIC_ACCOUNTS[i % len(SYNTHETIC_ACCOUNTS)], h, "landing"))
        return rows
    if scenario == "volume":
        rows = []
        for i in range(50):
            h = ["Green", "Yellow", "Red"][i % 3]
            rows.append(_base_row(i + 1, f"Test Customer {i + 1}", h, "building"))
        return rows
    if scenario == "edge-values":
        r = _base_row(1, "Example County with an unusually long account label for layout testing", "Yellow", "building")
        r["mtpDate"] = ""
        r["goLiveDate"] = None
        r["wdEngManager"] = ""
        r["partner"] = ""
        r2 = _base_row(2, "Sample Health System", "Green", "starting")
        r2["deploymentName"] = "Edge Case — duplicate phase markers"
        return [r, r2]
    if scenario == "go-live-window":
        rows = _industry_rows_mixed()[:8]
        for j, row in enumerate(rows):
            row["mtpDate"] = _add_days(3 + j * 2)
        return rows
    # mixed-health default
    return _industry_rows_mixed()


def product_mode_deployments_for_scenario(app_id: str, scenario: str) -> list[dict[str, Any]]:
    """ProductMode apps: rows must match deploymentNameIncludes (see Config_*)."""
    if scenario == "empty":
        return []
    profile = load_app_profiles().get(app_id, {})
    includes = profile.get("deploymentNameIncludes") or ["Preview"]
    pool = _product_mode_rows()
    matched = [r for r in pool if _row_matches_product_mode_(r, profile)]
    if scenario == "at-risk":
        base = matched or pool[:4]
        out = []
        for i, row in enumerate(base):
            copy = dict(row)
            copy["health"] = "Red" if i < len(base) // 2 else "Yellow"
            copy["stage"] = "Deploy"
            out.append(copy)
        return out[:10] if out else []
    if scenario == "volume":
        out = []
        for i in range(50):
            src = matched[i % len(matched)] if matched else pool[i % len(pool)]
            copy = dict(src)
            copy["deploymentId"] = f"PREVIEW_PM_{i + 1:04d}"
            copy["accountName"] = f"Test Customer {i + 1}"
            out.append(copy)
        return out
    if scenario == "edge-values":
        return matched[:2] if matched else pool[:2]
    if scenario == "go-live-window":
        out = (matched or pool)[:8]
        for j, row in enumerate(out):
            row = dict(row)
            row["mtpDate"] = _add_days(3 + j * 2)
            out[j] = row
        return out
    # mixed-health and default: expand matched pool to 10+ rows with varied health
    if not matched:
        matched = pool[:4]
    out = []
    health_cycle = ["Green", "Green", "Yellow", "Red"]
    stage_cycle = ["On-Boarding", "Test", "Test", "Deploy"]
    for i in range(max(12, len(matched))):
        src = dict(matched[i % len(matched)])
        src["deploymentId"] = f"PREVIEW_PM_{i + 1:04d}"
        src["accountName"] = SYNTHETIC_ACCOUNTS[i % len(SYNTHETIC_ACCOUNTS)]
        src["health"] = health_cycle[i % len(health_cycle)]
        src["stage"] = stage_cycle[i % len(stage_cycle)]
        src["rowIndex"] = i + 2
        out.append(src)
    return out


def _row_matches_product_mode_(row: dict[str, Any], profile: dict[str, Any]) -> bool:
    includes = [s.lower() for s in profile.get("deploymentNameIncludes") or []]
    excludes = [s.lower() for s in profile.get("deploymentNameExcludes") or []]
    name = (row.get("deploymentName") or "").lower()
    if excludes and any(x in name for x in excludes):
        return False
    if includes and not any(x in name for x in includes):
        return False
    return True


def apply_product_mode_filter(rows: list[dict[str, Any]], app_id: str) -> list[dict[str, Any]]:
    profile = load_app_profiles().get(app_id, {})
    if not profile.get("productMode"):
        return rows
    return product_mode_deployments_for_scenario(app_id, "mixed-health")


def overview_from_rows(rows: list[dict[str, Any]], scenario: str) -> dict[str, Any]:
    active = [r for r in rows if r.get("health")]
    total = len(active)
    red = sum(1 for r in active if r.get("health") == "Red")
    yellow = sum(1 for r in active if r.get("health") == "Yellow")
    green = sum(1 for r in active if r.get("health") == "Green")

    high_risk = sorted(
        [r for r in active if r.get("health") in ("Red", "Yellow") and r.get("mtpDate")],
        key=lambda r: r.get("mtpDate") or "",
    )[:5]
    top_high_risk = [
        {
            "deploymentId": r["deploymentId"],
            "accountName": r["accountName"],
            "deploymentName": r.get("deploymentName", ""),
            "partner": r.get("partner", ""),
            "health": r.get("health", ""),
            "currentMtp": r.get("mtpDate", ""),
        }
        for r in high_risk
    ]

    upcoming_pool = active[:5]
    if scenario == "go-live-window":
        upcoming_pool = active
    upcoming_items = [
        {
            "deploymentId": r["deploymentId"],
            "accountName": r["accountName"],
            "deploymentName": r.get("deploymentName", ""),
            "partner": r.get("partner", ""),
            "currentMtp": r.get("mtpDate", ""),
        }
        for r in upcoming_pool[:5]
    ]

    buckets = {"starting": 0, "building": 0, "landing": 0}
    for r in active:
        st = r.get("stage") or ""
        if st in ("On-Boarding", "Plan"):
            buckets["starting"] += 1
        elif st in ("Deploy", "Post Prod"):
            buckets["landing"] += 1
        else:
            buckets["building"] += 1

    lifecycle = {}
    for key, count in buckets.items():
        lifecycle[key] = {
            "count": count,
            "percent": round(count / total * 100) if total else 0,
            "stages": [],
        }

    return {
        "executiveWatchEnabled": True,
        "totals": {
            "totalActive": total,
            "red": red,
            "yellow": yellow,
            "green": green,
            "executiveWatch": 1 if total else 0,
        },
        "overrideFootnote": None,
        "topHighRisk": top_high_risk,
        "upcomingGoLives": {"total": len(upcoming_pool), "items": upcoming_items},
        "lifecycleBuckets": lifecycle,
        "asOf": f"{_today_key()}T12:00:00.000Z",
        "_previewMarker": "Example County",
    }


def freshness_for_scenario(scenario: str) -> dict[str, Any]:
    if scenario == "at-risk":
        return _load_json("freshness-stale.json")
    return _load_json("freshness-fresh.json")


def build_all_scenarios_bundle(app_id: str, default_scenario: str) -> dict[str, Any]:
    from preview_dm_m2 import build_scenario_bundle

    default_scenario = default_scenario if default_scenario in SCENARIOS else "mixed-health"
    by_scenario = {sc: build_scenario_bundle(app_id, sc, build_m1_responses) for sc in SCENARIOS}
    primary = by_scenario[default_scenario]
    return {
        "scenario": default_scenario,
        "appId": app_id,
        "byScenario": by_scenario,
        **{k: primary[k] for k in ("identityBoot", "freshness", "deployments", "overview", "markerAccount")},
    }


def build_m1_responses(app_id: str, scenario: str) -> dict[str, Any]:
    scenario = scenario if scenario in SCENARIOS else "mixed-health"
    profile = load_app_profiles().get(app_id, {})
    complete_deployments: list[dict[str, Any]] | None = None
    if scenario == "notable-active-complete":
        from preview_dm_notable import notable_active_complete_fixture

        active, complete_only, _peers = notable_active_complete_fixture()
        rows = active
        complete_deployments = complete_only
    elif profile.get("productMode"):
        rows = product_mode_deployments_for_scenario(app_id, scenario)
    else:
        rows = deployments_for_scenario(scenario)
    payload: dict[str, Any] = {
        "scenario": scenario,
        "appId": app_id,
        "identityBoot": _load_json("identity-boot.json"),
        "freshness": freshness_for_scenario(scenario),
        "deployments": rows,
        "overview": overview_from_rows(rows, scenario),
        "markerAccount": "Example County",
    }
    if complete_deployments is not None:
        payload["completeDeployments"] = complete_deployments
    return payload


def build_dm_mock_script(app_id: str, scenario: str) -> str:
    """Return <script> block: chainable google.script.run + M1 fixture handlers."""
    from preview_dm_m2 import M2_HANDLERS, M3_PLUS_METHODS

    data = build_all_scenarios_bundle(app_id, scenario)
    by_scenario = {sc: data["byScenario"][sc] for sc in SCENARIOS}
    payload = json.dumps(
        {
            "scenario": data["scenario"],
            "appId": app_id,
            "identityBoot": data["identityBoot"],
            "freshness": data["freshness"],
            "deployments": data["deployments"],
            "overview": data["overview"],
            "markerAccount": data["markerAccount"],
        },
        separators=(",", ":"),
    )
    by_scenario_json = json.dumps(by_scenario, separators=(",", ":"))
    m1_list = json.dumps(list(M1_HANDLERS))
    m2_list = json.dumps(list(M2_HANDLERS))
    m3_list = json.dumps(list(M3_PLUS_METHODS))
    return f"""
<script id="preview-dm-mock-runtime" data-preview-app="{app_id}" data-preview-scenario="{data['scenario']}"
  data-preview-marker="{data['markerAccount']}">
/* LOCAL PREVIEW — DM M1+M2 mock google.script.run (no production endpoints) */
(function () {{
  var M1 = {m1_list};
  var M2 = {m2_list};
  var M3_PLUS = {m3_list};
  var STATE_KEY = 'preview-dm-override-state-v1';
  var FIXTURE = {payload};
  window.__PREVIEW_DM_FIXTURES_BY_SCENARIO__ = {by_scenario_json};

  function resolveScenario() {{
    try {{
      var q = new URLSearchParams(window.location.search || '');
      var fromQuery = q.get('scenario');
      if (fromQuery) return fromQuery;
    }} catch (e) {{}}
    return window.__PREVIEW_DM_SCENARIO__ || FIXTURE.scenario || 'mixed-health';
  }}

  function showDiag(msg, isError) {{
    console[isError ? 'error' : 'warn']('[preview DM] ' + msg);
    var el = document.getElementById('gas-preview-dm-diag');
    if (!el) {{
      el = document.createElement('div');
      el.id = 'gas-preview-dm-diag';
      el.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;max-height:120px;overflow:auto;z-index:2147483646;font:12px/1.4 monospace;padding:8px 10px;border-radius:8px;background:rgba(120,24,24,.92);color:#fff;display:none;';
      document.body.appendChild(el);
    }}
    if (isError) {{
      el.style.display = 'block';
      el.textContent = msg;
    }}
  }}

  function handlersForScenario() {{
    var sc = resolveScenario();
    if (window.__PREVIEW_DM_FIXTURES_BY_SCENARIO__ && window.__PREVIEW_DM_FIXTURES_BY_SCENARIO__[sc]) {{
      return window.__PREVIEW_DM_FIXTURES_BY_SCENARIO__[sc];
    }}
    return FIXTURE;
  }}

  function loadMutableState() {{
    try {{
      var raw = sessionStorage.getItem(STATE_KEY);
      if (raw) return JSON.parse(raw);
    }} catch (e) {{}}
    return {{ deploymentOverrides: {{}}, golivesOverrides: {{}}, auditLog: [], removedKeys: {{ deployment: {{}}, golives: {{}} }} }};
  }}

  function saveMutableState(st) {{
    try {{ sessionStorage.setItem(STATE_KEY, JSON.stringify(st)); }} catch (e) {{}}
    window.__PREVIEW_DM_MUTABLE_STATE__ = st;
  }}

  function nowIso() {{ return new Date().toISOString(); }}

  function pushAudit(st, entry) {{
    st.auditLog = st.auditLog || [];
    st.auditLog.unshift(entry);
    if (st.auditLog.length > 100) st.auditLog.length = 100;
  }}

  function mergeActiveOverrides(baseList, st) {{
    var out = [];
    var removedDep = st.removedKeys && st.removedKeys.deployment || {{}};
    var removedGl = st.removedKeys && st.removedKeys.golives || {{}};
    (baseList || []).forEach(function (row) {{
      var key = row.type === 'golives' ? row.accountName : row.deploymentId;
      if (row.type === 'deployment' && removedDep[key]) return;
      if (row.type === 'golives' && removedGl[key]) return;
      var copy = JSON.parse(JSON.stringify(row));
      if (row.type === 'deployment' && st.deploymentOverrides && st.deploymentOverrides[key]) {{
        Object.assign(copy, st.deploymentOverrides[key]);
      }}
      if (row.type === 'golives' && st.golivesOverrides && st.golivesOverrides[key]) {{
        Object.assign(copy, st.golivesOverrides[key]);
      }}
      out.push(copy);
    }});
    Object.keys(st.deploymentOverrides || {{}}).forEach(function (id) {{
      if (removedDep[id]) return;
      if (out.some(function (r) {{ return r.type === 'deployment' && r.deploymentId === id; }})) return;
      out.push(st.deploymentOverrides[id]);
    }});
    Object.keys(st.golivesOverrides || {{}}).forEach(function (acct) {{
      if (removedGl[acct]) return;
      if (out.some(function (r) {{ return r.type === 'golives' && r.accountName === acct; }})) return;
      out.push(st.golivesOverrides[acct]);
    }});
    return out;
  }}

  function applyDeploymentOverrideFlags(rows, st) {{
    return (rows || []).map(function (row) {{
      var key = String(row.parentDeploymentId || row.deploymentId || '').trim();
      var ov = st.deploymentOverrides && st.deploymentOverrides[key];
      if (!ov) return row;
      var copy = Object.assign({{}}, row);
      if (ov.hasOperationalOverride || ov.hasReportExclusion) {{
        copy.hasOperationalOverride = !!ov.hasOperationalOverride;
        copy.hasReportExclusion = !!ov.hasReportExclusion;
        copy.hasAnyOverride = !!(copy.hasOperationalOverride || copy.hasReportExclusion);
        copy.overrideClassification = ov.classification || copy.overrideClassification;
      }}
      return copy;
    }});
  }}

  function materializedBundle() {{
    var base = handlersForScenario();
    var st = loadMutableState();
    saveMutableState(st);
    var bundle = JSON.parse(JSON.stringify(base));
    bundle.deployments = applyDeploymentOverrideFlags(bundle.deployments, st);
    bundle.activeOverrides = mergeActiveOverrides(bundle.activeOverrides, st);
    bundle.overrideAuditLog = (st.auditLog && st.auditLog.length)
      ? st.auditLog.concat(bundle.overrideAuditLog || [])
      : (bundle.overrideAuditLog || []);
    return {{ bundle: bundle, state: st }};
  }}

  function findDeploymentInBundle(bundle, deploymentId) {{
    var target = String(deploymentId || '').trim();
    return (bundle.deployments || []).find(function (d) {{
      var id = String(d.deploymentId || '').trim();
      return id === target || id.slice(0, 15) === target.slice(0, 15);
    }});
  }}

  function buildDeploymentOverrideRow(dep, overrideData, notes) {{
    var srcHealth = dep.health || 'Green';
    var effHealth = overrideData.overrideHealth || srcHealth;
    var hasOp = !!(overrideData.overrideHealth || overrideData.overrideMtpDate || overrideData.overrideStage || overrideData.overrideCurrentUpdate);
    var exclude = !!overrideData.excludeFromReport;
    var fields = [];
    if (overrideData.overrideHealth) fields.push('Override_Health');
    if (overrideData.overrideMtpDate) fields.push('Override_MTPDate');
    if (overrideData.overrideStage) fields.push('Override_Stage');
    if (overrideData.excludeFromReport) fields.push('Exclude_From_Report');
    return {{
      type: 'deployment',
      accountName: dep.accountName,
      deploymentId: dep.deploymentId,
      deploymentName: dep.deploymentName || '',
      fieldsSet: fields,
      currentValues: {{
        health: overrideData.overrideHealth || '',
        mtpDate: overrideData.overrideMtpDate || '',
        stage: overrideData.overrideStage || '',
        excludeFromReport: exclude
      }},
      sourceValues: {{ health: srcHealth, mtpDate: dep.mtpDate || '', stage: dep.stage || '', account: dep.accountName, deployment: dep.deploymentName || '' }},
      effectiveValues: {{ health: effHealth, mtpDate: overrideData.overrideMtpDate || dep.mtpDate || '', stage: overrideData.overrideStage || dep.stage || '', excludeFromReport: exclude }},
      setBy: 'preview.user@workday.com',
      setAt: nowIso(),
      classification: overrideData.classification || 'Monthly',
      reason: notes || '',
      hasOperationalOverride: hasOp,
      hasReportExclusion: exclude,
      isStaleMonthly: false,
      isOrphaned: false,
      category: exclude && !hasOp ? 'report' : 'operational'
    }};
  }}

  var HANDLERS = {{
    getIdentityBoot: function () {{ return materializedBundle().bundle.identityBoot; }},
    getDataFreshnessForUI: function () {{ return materializedBundle().bundle.freshness; }},
    getAllDeploymentsForUI: function () {{ return materializedBundle().bundle.deployments; }},
    getOverviewData: function () {{ return materializedBundle().bundle.overview; }},
    getRecentGoLivesData: function () {{ return materializedBundle().bundle.recentGoLives || []; }},
    getUpcomingGoLivesData: function () {{ return materializedBundle().bundle.upcomingGoLives || []; }},
    getGoLivesExplorerDataForUI: function (_vm, _pm, _filters) {{
      return materializedBundle().bundle.golivesExplorer || {{ valid: true, rows: [], totalCount: 0 }};
    }},
    getAllActiveOverridesForUI: function () {{ return materializedBundle().bundle.activeOverrides || []; }},
    getOverrideAuditLogForUI: function (opts) {{
      var log = materializedBundle().bundle.overrideAuditLog || [];
      var sinceDays = opts && opts.sinceDays;
      if (sinceDays === 0) return log.slice(0, 500);
      return log;
    }},
    updateDeploymentWithMetaAndOverride: function (_rowIndex, deploymentId, _meta, overrideData, notes) {{
      var mat = materializedBundle();
      var dep = findDeploymentInBundle(mat.bundle, deploymentId);
      if (!dep) throw new Error('[preview] Deployment not found for override save');
      if (!overrideData || !overrideData.classification) throw new Error('classification required');
      var row = buildDeploymentOverrideRow(dep, overrideData, notes);
      mat.state.deploymentOverrides[dep.deploymentId] = row;
      if (mat.state.removedKeys && mat.state.removedKeys.deployment) delete mat.state.removedKeys.deployment[dep.deploymentId];
      pushAudit(mat.state, {{
        timestamp: nowIso(), user: 'preview.user@workday.com', action: 'SET', accountName: dep.accountName,
        overrideType: 'deployment', fieldsAffected: row.fieldsSet.join(', '), notes: notes || ''
      }});
      saveMutableState(mat.state);
      return undefined;
    }},
    updateGoLivesOverride: function (accountName, overrideData, notes) {{
      if (!accountName) throw new Error('accountName required');
      if (!overrideData || !overrideData.classification) throw new Error('classification required');
      var mat = materializedBundle();
      var acct = String(accountName).trim();
      var row = {{
        type: 'golives', accountName: acct, deploymentId: acct, deploymentName: '',
        fieldsSet: ['Override_GoLiveDate', 'Override_Partner'].filter(function () {{ return true; }}),
        currentValues: {{ goLiveDate: overrideData.overrideDate || '', partner: overrideData.overridePartner || '', excludeFromReport: !!overrideData.excludeFromReport }},
        sourceValues: {{}}, effectiveValues: {{ goLiveDate: overrideData.overrideDate || '', partner: overrideData.overridePartner || '', excludeFromReport: !!overrideData.excludeFromReport }},
        setBy: 'preview.user@workday.com', setAt: nowIso(), classification: overrideData.classification || 'Monthly',
        reason: notes || '', hasOperationalOverride: !!(overrideData.overrideDate || overrideData.overridePartner),
        hasReportExclusion: !!overrideData.excludeFromReport, isStaleMonthly: false, isOrphaned: false, category: 'operational'
      }};
      mat.state.golivesOverrides[acct] = row;
      if (mat.state.removedKeys && mat.state.removedKeys.golives) delete mat.state.removedKeys.golives[acct];
      pushAudit(mat.state, {{
        timestamp: nowIso(), user: 'preview.user@workday.com', action: 'SET', accountName: acct,
        overrideType: 'golives', fieldsAffected: 'Go Lives override', notes: notes || ''
      }});
      saveMutableState(mat.state);
      return undefined;
    }},
    setOverrideClassificationForUI: function (type, idOrAccount, classification) {{
      var mat = materializedBundle();
      var key = String(idOrAccount || '').trim();
      if (type === 'deployment' && mat.state.deploymentOverrides[key]) {{
        mat.state.deploymentOverrides[key].classification = classification;
      }} else if (type === 'golives' && mat.state.golivesOverrides[key]) {{
        mat.state.golivesOverrides[key].classification = classification;
      }} else {{
        var list = mat.bundle.activeOverrides || [];
        var base = list.find(function (r) {{
          return (type === 'deployment' ? r.deploymentId : r.accountName) === key;
        }});
        if (base) {{
          var clone = JSON.parse(JSON.stringify(base));
          clone.classification = classification;
          if (type === 'deployment') mat.state.deploymentOverrides[key] = clone;
          else mat.state.golivesOverrides[key] = clone;
        }}
      }}
      pushAudit(mat.state, {{
        timestamp: nowIso(), user: 'preview.user@workday.com', action: 'CLASSIFY', accountName: key,
        overrideType: type, fieldsAffected: 'classification', notes: classification
      }});
      saveMutableState(mat.state);
      return undefined;
    }},
    getNotableData: function () {{ return materializedBundle().bundle.notableDeployments || []; }},
    getGoLivesForNotablePicker: function () {{ return materializedBundle().bundle.notablePicker || []; }},
    clearSingleOverrideForUI: function (type, idOrAccount) {{
      var mat = materializedBundle();
      var key = String(idOrAccount || '').trim();
      var had = false;
      if (type === 'deployment') {{
        had = !!(mat.state.deploymentOverrides[key] || (mat.bundle.activeOverrides || []).some(function (r) {{ return r.deploymentId === key; }}));
        delete mat.state.deploymentOverrides[key];
        mat.state.removedKeys.deployment[key] = true;
      }} else {{
        had = !!(mat.state.golivesOverrides[key] || (mat.bundle.activeOverrides || []).some(function (r) {{ return r.accountName === key; }}));
        delete mat.state.golivesOverrides[key];
        mat.state.removedKeys.golives[key] = true;
      }}
      if (!had) return {{ success: false, cleared: 0 }};
      pushAudit(mat.state, {{
        timestamp: nowIso(), user: 'preview.user@workday.com', action: 'CLEAR', accountName: key,
        overrideType: type, fieldsAffected: '', notes: 'Preview clear'
      }});
      saveMutableState(mat.state);
      return {{ success: true, cleared: 1 }};
    }}
  }};

  window.google = window.google || {{}};
  window.google.script = window.google.script || {{}};

  function runCall(method, args) {{
    if (HANDLERS[method]) {{
      try {{
        return HANDLERS[method].apply(null, args || []);
      }} catch (err) {{
        showDiag('Handler ' + method + ' failed: ' + err, true);
        throw err;
      }}
    }}
    if (M3_PLUS.indexOf(method) !== -1) {{
      showDiag('M3+ preview: google.script.run.' + method + ' is not implemented yet. See docs/analysis/dm-family/preview-data-plan.md', true);
      throw new Error('[preview] Unimplemented (M3+): ' + method);
    }}
    showDiag('Unimplemented google.script.run.' + method + ' — add handler in preview_dm_fixtures.py / preview_dm_m2.py', true);
    throw new Error('[preview] Unimplemented: ' + method);
  }}

  /** Each `google.script.run` access must return a fresh chain (GAS semantics). */
  function createGoogleScriptRun() {{
    var handlers = {{ success: null, failure: null, userObject: null }};
    var chain = {{}};
    var proxy = new Proxy(chain, {{
      get: function (target, prop) {{
        if (prop === 'withSuccessHandler') {{
          return function (fn) {{
            handlers.success = fn;
            return proxy;
          }};
        }}
        if (prop === 'withFailureHandler') {{
          return function (fn) {{
            handlers.failure = fn;
            return proxy;
          }};
        }}
        if (prop === 'withUserObject') {{
          return function (obj) {{
            handlers.userObject = obj;
            return proxy;
          }};
        }}
        if (typeof prop === 'string' && prop !== 'then') {{
          return function () {{
            var args = arguments;
            setTimeout(function () {{
              try {{
                var result = runCall(prop, args);
                if (handlers.success) handlers.success(result);
              }} catch (e) {{
                if (handlers.failure) handlers.failure(String(e.message || e));
              }}
            }}, 0);
          }};
        }}
        return undefined;
      }}
    }});
    return proxy;
  }}

  Object.defineProperty(window.google.script, 'run', {{
    configurable: true,
    enumerable: true,
    get: function () {{ return createGoogleScriptRun(); }}
  }});
  var noop = function () {{}};
  window.google.script.host = {{ close: noop, setHeight: noop, setWidth: noop, origin: '', editor: {{ focus: noop }} }};
  window.google.script.url = {{ getLocation: function (cb) {{ if (cb) cb({{ parameter: {{}}, hash: '' }}); }} }};
  window.__PREVIEW_DM_M1_HANDLERS__ = M1;
  window.__PREVIEW_DM_M2_HANDLERS__ = M2;
  window.__PREVIEW_DM_SCENARIO__ = FIXTURE.scenario;
}})();
</script>
<div id="gas-preview-badge" onclick="this.remove()"
  title="Local preview — synthetic DM fixtures (M1+M2+Notable). M3+ tabs still need handlers. Click to dismiss."
  style="position:fixed;top:12px;left:12px;z-index:2147483647;font:600 11px/1.4 Archivo,system-ui,sans-serif;
  background:rgba(15,46,102,.92);color:#fff;padding:7px 12px;border-radius:999px;letter-spacing:.02em;
  box-shadow:0 2px 12px rgba(0,0,0,.18);cursor:pointer;max-width:min(92vw,520px);">
  LOCAL PREVIEW &mdash; DM M1+M2+Notable ({app_id}, scenario {data['scenario']})</div>
"""


def sync_app_profiles_from_config(repo_root: Path) -> None:
    """Optional: refresh productMode includes from Config_*.js (sanitized literals only)."""
    profiles = load_app_profiles()
    config_map = {
        "EVI_DM": "Config_EVI.js",
        "PDX_DM": "Config_PDX.js",
        "HS_DM": "Config_HS.js",
    }
    for app_id, cfg_name in config_map.items():
        path = repo_root / "solutions" / app_id / "src" / cfg_name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        m = re.search(r"productModeDeploymentNameIncludes:\s*\[([^\]]+)\]", text)
        if m:
            includes = re.findall(r"'([^']+)'", m.group(1))
            if includes:
                profiles[app_id]["deploymentNameIncludes"] = includes
        m2 = re.search(r"productModeDeploymentNameExcludes:\s*\[([^\]]+)\]", text)
        if m2:
            excludes = re.findall(r"'([^']+)'", m2.group(1))
            profiles[app_id]["deploymentNameExcludes"] = excludes
    (FIXTURES / "app-profiles.json").write_text(
        json.dumps(profiles, indent=2) + "\n", encoding="utf-8"
    )

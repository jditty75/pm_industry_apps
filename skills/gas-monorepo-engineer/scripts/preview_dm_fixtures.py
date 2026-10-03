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

M2_PLUS_METHODS = (
    "getRecentGoLivesData",
    "getUpcomingGoLivesData",
    "getGoLivesExplorerDataForUI",
    "getAllActiveOverridesForUI",
    "getTrendsDashboardData",
    "getCsatTabDataForUI",
    "getNotableData",
    "getStudentTabData",
    "getEscalationsDashboardData",
    "getReportSendConfigForUI",
)

SCENARIOS = (
    "mixed-health",
    "at-risk",
    "empty",
    "go-live-window",
    "edge-values",
    "volume",
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


def apply_product_mode_filter(rows: list[dict[str, Any]], app_id: str) -> list[dict[str, Any]]:
    profile = load_app_profiles().get(app_id, {})
    if not profile.get("productMode"):
        return rows
    includes = [s.lower() for s in profile.get("deploymentNameIncludes") or []]
    excludes = [s.lower() for s in profile.get("deploymentNameExcludes") or []]
    pool = _product_mode_rows()
    out = []
    for row in pool:
        name = (row.get("deploymentName") or "").lower()
        if excludes and any(x in name for x in excludes):
            continue
        if includes and not any(x in name for x in includes):
            continue
        out.append(row)
    return out if out else pool[:2]


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
    default_scenario = default_scenario if default_scenario in SCENARIOS else "mixed-health"
    by_scenario = {sc: build_m1_responses(app_id, sc) for sc in SCENARIOS}
    primary = by_scenario[default_scenario]
    return {
        "scenario": default_scenario,
        "appId": app_id,
        "byScenario": by_scenario,
        **{k: primary[k] for k in ("identityBoot", "freshness", "deployments", "overview", "markerAccount")},
    }


def build_m1_responses(app_id: str, scenario: str) -> dict[str, Any]:
    scenario = scenario if scenario in SCENARIOS else "mixed-health"
    rows = deployments_for_scenario(scenario)
    rows = apply_product_mode_filter(rows, app_id)
    return {
        "scenario": scenario,
        "appId": app_id,
        "identityBoot": _load_json("identity-boot.json"),
        "freshness": freshness_for_scenario(scenario),
        "deployments": rows,
        "overview": overview_from_rows(rows, scenario),
        "markerAccount": "Example County",
    }


def build_dm_mock_script(app_id: str, scenario: str) -> str:
    """Return <script> block: chainable google.script.run + M1 fixture handlers."""
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
    m2_list = json.dumps(list(M2_PLUS_METHODS))
    return f"""
<script id="preview-dm-mock-runtime" data-preview-app="{app_id}" data-preview-scenario="{data['scenario']}"
  data-preview-marker="{data['markerAccount']}">
/* LOCAL PREVIEW — DM M1 mock google.script.run (no production endpoints) */
(function () {{
  var M1 = {m1_list};
  var M2_PLUS = {m2_list};
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

  var HANDLERS = {{
    getIdentityBoot: function () {{ return handlersForScenario().identityBoot; }},
    getDataFreshnessForUI: function () {{ return handlersForScenario().freshness; }},
    getAllDeploymentsForUI: function () {{ return handlersForScenario().deployments; }},
    getOverviewData: function () {{ return handlersForScenario().overview; }}
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
    if (M2_PLUS.indexOf(method) !== -1) {{
      showDiag('M2–M5 preview: google.script.run.' + method + ' is not implemented in M1. See docs/analysis/dm-family/preview-data-plan.md', true);
      throw new Error('[preview] Unimplemented (scheduled M2–M5): ' + method);
    }}
    showDiag('Unimplemented google.script.run.' + method + ' — add handler in preview_dm_fixtures.py / preview_dm_mock runtime', true);
    throw new Error('[preview] Unimplemented: ' + method);
  }}

  function createRunner(state) {{
    state = state || {{ success: null, failure: null }};
    var runner = {{
      withSuccessHandler: function (fn) {{
        state.success = fn;
        return createRunner(state);
      }},
      withFailureHandler: function (fn) {{
        state.failure = fn;
        return createRunner(state);
      }},
      withUserObject: function () {{ return createRunner(state); }}
    }};
    return new Proxy(runner, {{
      get: function (target, prop) {{
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && prop !== 'then') {{
          return function () {{
            var args = arguments;
            setTimeout(function () {{
              try {{
                var result = runCall(prop, args);
                if (state.success) state.success(result);
              }} catch (e) {{
                if (state.failure) state.failure(String(e.message || e));
              }}
            }}, 0);
            return createRunner(state);
          }};
        }}
        return undefined;
      }}
    }});
  }}

  window.google.script.run = createRunner();
  var noop = function () {{}};
  window.google.script.host = {{ close: noop, setHeight: noop, setWidth: noop, origin: '', editor: {{ focus: noop }} }};
  window.google.script.url = {{ getLocation: function (cb) {{ if (cb) cb({{ parameter: {{}}, hash: '' }}); }} }};
  window.__PREVIEW_DM_M1_HANDLERS__ = M1;
  window.__PREVIEW_DM_SCENARIO__ = FIXTURE.scenario;
}})();
</script>
<div id="gas-preview-badge" onclick="this.remove()"
  title="Local preview — synthetic DM fixtures (M1). M2–M5 tabs need additional handlers. Click to dismiss."
  style="position:fixed;top:12px;left:12px;z-index:2147483647;font:600 11px/1.4 Archivo,system-ui,sans-serif;
  background:rgba(15,46,102,.92);color:#fff;padding:7px 12px;border-radius:999px;letter-spacing:.02em;
  box-shadow:0 2px 12px rgba(0,0,0,.18);cursor:pointer;max-width:min(92vw,520px);">
  LOCAL PREVIEW &mdash; DM M1 mock data ({app_id}, scenario {data['scenario']})</div>
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

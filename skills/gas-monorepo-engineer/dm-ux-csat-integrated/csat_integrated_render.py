"""Assemble integrated CSAT prototype pages."""

from __future__ import annotations

import html
import json
import os
import sys
from typing import Any, Dict, List, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
V3_DIR = os.path.join(REPO, "skills", "gas-monorepo-engineer", "dm-ux-csat-overview-v3")
SV_DIR = os.path.join(REPO, "skills", "gas-monorepo-engineer", "dm-ux-csat-surveys")

sys.path.insert(0, V3_DIR)
sys.path.insert(0, SV_DIR)
sys.path.insert(0, SCRIPT_DIR)

from csat_integrated_deployment import render_deployment_history  # noqa: E402
from csat_integrated_responses import render_responses_page  # noqa: E402
from csat_overview_v3_render import (  # noqa: E402
    IntegratedRenderCtx,
    render_csat_subnav,
    render_state_page as render_overview_body,
)
from csat_surveys_render import (  # noqa: E402
    IntegratedSurveysCtx,
    load_fixture as load_sv_fixture,
    render_state_page as render_surveys_body,
)

W_MARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1540 2000" width="24" height="24" aria-label="Workday"><g><g><path fill="#FFFFFF" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9,41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5,4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4-66.3,320.9-144.7,639.6-260.1,960.4-10,29.6-27.1,41.7-56.5,41.7Z"/><path fill="#FFFFFF" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9,149.1,0,289.2,58,394.4,163.3,54.8,54.8,96.6,118.9,124.3,188.7,6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7,27.5-69.7,69.2-133.7,123.7-188.3Z"/></g></g></svg>"""


def esc(s: Any) -> str:
    return html.escape("" if s is None else str(s))


def load_integrated_fixture(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _enrich_surveys_state(st: Dict[str, Any]) -> Dict[str, Any]:
    import copy

    out = copy.deepcopy(st)
    for group_key in ("upcoming", "inflight", "recent"):
        grp = out.get(group_key, {})
        for row in grp.get("rows", []) + grp.get("tailRows", []):
            facet = row.get("facetLine", "")
            row["keyFact"] = facet
            att = row.get("attention")
            if att and att.get("severity") == "red":
                row["verdictChip"] = {"label": "Detractor", "severity": "red"}
    return out


def build_view_fragments(
    ix: Dict[str, Any],
    v3_meta: Dict[str, Any],
    sv_meta: Dict[str, Any],
    app_key: str,
) -> Dict[str, str]:
    app_cfg = ix["csatAppConfig"][app_key]
    shell_key = app_cfg["shell"]
    if shell_key not in v3_meta.get("shells", {}):
        shell_key = "hc"
    sv_shell = shell_key if shell_key in sv_meta.get("shells", v3_meta.get("shells", {})) else "hc"
    dep_ids = ix["deploymentIds"]
    octx = IntegratedRenderCtx(dep_ids)
    sctx = IntegratedSurveysCtx(dep_ids)

    v3_st = v3_meta["states"][ix.get("overviewStateKey", "healthy")]
    v3_st = {**v3_st, "shell": shell_key, "scopeMenu": app_cfg["scopeMenu"]}
    overview = render_overview_body(v3_st, v3_meta, ctx=octx, integrated=True, include_shell=False)

    sv_st = _enrich_surveys_state(sv_meta["states"][ix.get("surveysStateKey", "normal")])
    sv_st = {**sv_st, "shell": sv_shell, "scopeMenu": app_cfg["scopeMenu"]}
    surveys = render_surveys_body(sv_st, sv_meta, ctx=sctx, integrated=True, use_grid=True, include_shell=False)

    responses_states = {}
    resp_sub = render_csat_subnav(app_cfg["scopeMenu"], active_tab=2, integrated=True)
    for key, st in ix["states"].items():
        if st.get("responses"):
            responses_states[key] = resp_sub + render_responses_page(
                st["responses"], app_cfg["industryLabel"]
            )

    deployments = {}
    dep_sub = render_csat_subnav(app_cfg["scopeMenu"], active_tab=2, integrated=True)
    for key, st in ix["states"].items():
        if st.get("deployment"):
            deployments[st["deployment"]["deploymentId"]] = dep_sub + render_deployment_history(
                st["deployment"], "#/responses"
            )

    return {
        "overview": overview,
        "surveys": surveys,
        "responsesStates": responses_states,
        "deployments": deployments,
        "appKey": app_key,
        "shellKey": shell_key,
    }


def render_integrated_shell(
    ix: Dict[str, Any],
    shell_key: str,
    data_as_of: str,
    initial_route: str,
    state_key: str,
    views: Dict[str, Any],
    t2: bool = False,
) -> str:
    shell = ix["shells"][shell_key]
    badge = "LOCAL PROTOTYPE — NOT PRODUCTION"
    tier_ctrl = (
        '<label class="csat-ix-tier"><input type="checkbox" id="csat-ix-t2-toggle" '
        + ('checked ' if t2 else '')
        + '/> T2 evidence</label>'
    )
    return (
        '<main class="container csat-ix-app" id="csat-integrated-app" data-csat-integrated="true">'
        '<div class="header">'
        '<div class="header-strip">'
        + W_MARK_SVG
        + "</div>"
        '<div class="header-body">'
        f"<h1>{esc(shell['headerTitle'])}</h1>"
        f"<p>{esc(shell['headerSubtitle'])}</p>"
        "</div>"
        f'<span class="freshness-badge freshness-fresh csat-ix-freshness">Data as of {esc(data_as_of)}</span>'
        '<div class="header-right"><span style="font-size:12px;color:var(--color-text-muted)">Showing: All</span></div>'
        "</div>"
        '<nav class="tabs" role="tablist" aria-label="Primary features">'
        '<button type="button" class="tab">Deployments</button>'
        '<button type="button" class="tab">Go Lives</button>'
        '<button type="button" class="tab">Reporting</button>'
        '<button type="button" class="tab">Portfolio Health</button>'
        '<button type="button" class="tab active" aria-selected="true">CSAT</button>'
        '<button type="button" class="tab">Notable Deployments</button>'
        '<button type="button" class="tab">Manage Overrides</button>'
        "</nav>"
        f'<div id="csat-ix-viewport" class="csat-ix-viewport" data-initial-route="{esc(initial_route)}"></div>'
        f'<div class="csat-ix-proto-badge" role="status">{esc(badge)} {tier_ctrl}</div>'
        "</main>"
    )


def render_index(ix: Dict[str, Any]) -> str:
    items = []
    for key, st in ix["states"].items():
        if st.get("file"):
            items.append(
                f'<li><a href="{esc(st["file"])}">{esc(key)}</a> — {esc(st.get("protoLabel", ""))}</li>'
            )
    return (
        '<div class="csat-ix-index"><h1>CSAT integrated prototype</h1>'
        '<p>Start with <a href="CSAT_INTEGRATED.html">CSAT_INTEGRATED.html</a> (Overview default).</p>'
        f"<ul>{''.join(items)}</ul></div>"
    )


def wrap_page(
    title: str,
    body: str,
    ix: Dict[str, Any],
    views_bundle: Dict[str, Any],
    dep_css: str,
    css_bundle: str,
    js: str,
    initial_state: str,
) -> str:
    payload = {
        "fixtureId": ix["fixtureId"],
        "deploymentIds": ix["deploymentIds"],
        "csatAppConfig": ix["csatAppConfig"],
        "views": views_bundle,
        "initialState": initial_state,
    }
    fixture_json = json.dumps(payload, separators=(",", ":"))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{esc(title)}</title>
  {dep_css}
  <style>{css_bundle}</style>
  <style>.sr-only{{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}}</style>
</head>
<body data-csat-integrated-prototype="true">
  {body}
  <script type="application/json" id="csat-integrated-fixture">{fixture_json}</script>
  <script>{js}</script>
</body>
</html>
"""

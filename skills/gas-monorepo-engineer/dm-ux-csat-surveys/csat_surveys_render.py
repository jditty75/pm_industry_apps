"""Render CSAT Surveys static HTML from fixture (format only — no computation)."""

from __future__ import annotations

import html
import json
import re
from typing import Any, Dict, List, Optional

W_MARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1540 2000" width="24" height="24" aria-label="Workday"><g><g><path fill="#FFFFFF" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9,41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5,4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4-66.3,320.9-144.7,639.6-260.1,960.4-10,29.6-27.1,41.7-56.5,41.7Z"/><path fill="#FFFFFF" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9,149.1,0,289.2,58,394.4,163.3,54.8,54.8,96.6,118.9,124.3,188.7,6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7,27.5-69.7,69.2-133.7,123.7-188.3Z"/></g></g></svg>"""

LINK_TITLE = "Destination not built in this prototype"


class IntegratedSurveysCtx:
    """Hash-route deployment links for integrated CSAT prototype."""

    def __init__(self, deployment_ids: Dict[str, str]) -> None:
        self.deployment_ids = deployment_ids

    def deployment_link(self, name: str) -> str:
        dep_id = self.deployment_ids.get(name, "syn-unknown")
        return (
            f'<a href="#/deployment/{esc(dep_id)}/csat" class="csat-deployment-link csat-sv-link--entity" '
            f'title="{esc(name)}">{esc(name)}</a>'
        )

STATE_ORDER = (
    "normal",
    "heavy",
    "prep",
    "inflight",
    "chase",
    "responded",
    "noforecast",
    "quiet",
)

INDEX_ENTRIES = [
    ("CSAT_SURVEYS_NORMAL.html", "1 Normal upcoming portfolio"),
    ("CSAT_SURVEYS_HEAVY.html", "2 Heavy upcoming month"),
    ("CSAT_SURVEYS_PREP.html", "3 Preparation issues"),
    ("CSAT_SURVEYS_INFLIGHT.html", "4 Active in-flight"),
    ("CSAT_SURVEYS_CHASE.html", "5 Chase / bounce"),
    ("CSAT_SURVEYS_RESPONDED.html", "6 Recently responded"),
    ("CSAT_SURVEYS_NOFORECAST.html", "7 Cannot forecast"),
    ("CSAT_SURVEYS_QUIET.html", "8 Quiet / no immediate activity"),
]

LIFECYCLE_GROUPS = (
    ("upcoming", "PREPARE", "csat-sv-upcoming"),
    ("inflight", "SURVEY", "csat-sv-inflight"),
    ("recent", "RESPOND · CLOSE · FOLLOW UP", "csat-sv-recent"),
)


def esc(s: Any) -> str:
    return html.escape("" if s is None else str(s))


def load_fixture(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def inert_entity_link(name: str) -> str:
    return (
        f'<a href="#" class="csat-sv-link--entity" title="{esc(LINK_TITLE)}" '
        f'onclick="return false;" tabindex="0">{esc(name)}</a>'
    )


def inert_count_link(text: str, href: str = "#") -> str:
    return (
        f'<a href="{esc(href)}" class="csat-sv-link" title="{esc(LINK_TITLE)}" '
        f'onclick="return false;" tabindex="0">{esc(text)}</a>'
    )


def render_horizon_parts(parts: List[Dict[str, str]]) -> str:
    bits = []
    for p in parts:
        if p["type"] == "text":
            bits.append(esc(p["text"]))
        elif p["type"] == "link":
            bits.append(inert_count_link(p["text"], p.get("href", "#")))
    return "".join(bits)


def render_attention(att: Optional[Dict[str, Any]]) -> str:
    if not att:
        return ""
    label = att.get("label", "")
    if not label:
        return ""
    sev = att.get("severity", "neutral")
    if sev == "yellow":
        cls = "status-pill status-yellow"
        prefix = "⚠ " if att.get("warn") else ""
    elif sev == "red":
        cls = "status-pill status-red"
        prefix = ""
    elif sev == "muted":
        cls = "status-pill status-muted"
        prefix = ""
    else:
        cls = "status-pill"
        prefix = "⚠ " if att.get("warn") else ""
    return f'<span class="{cls}">{esc(prefix + label)}</span>'


def render_row_csat_grid(row: Dict[str, Any], ctx: Optional[IntegratedSurveysCtx] = None) -> str:
    """Shared csatRow grid (integrated harmonization)."""
    attn = row.get("attention")
    marker = render_attention(attn) if attn else '<span class="csat-attention-marker csat-attention-marker--plain"></span>'
    if ctx:
        deploy = ctx.deployment_link(row["deployment"])
    else:
        deploy = inert_entity_link(row["deployment"])
    acct = row.get("account")
    name_cell = deploy
    if acct:
        name_cell = f'{deploy}<span class="csat-sv-account">{esc(acct)}</span>'
    survey = f'<span class="csat-survey-tag">{esc(row["survey"])}</span>'
    verdict = ""
    if row.get("verdictChip"):
        vc = row["verdictChip"]
        sev = "status-red" if vc.get("severity") == "red" else "status-yellow"
        verdict = f'<span class="csat-verdict-chip status-pill {sev}">{esc(vc.get("label", ""))}</span>'
    key_fact = esc(row.get("keyFact") or row.get("facetLine", ""))
    date_cls = "csat-survey-date"
    if row.get("dateMuted"):
        date_cls += " is-muted"
    date_html = f'<span class="{date_cls}">{esc(row["dateLine"])}</span>'
    evidence = ""
    if row.get("evidenceMarkers"):
        evidence = "".join(
            f'<span class="csat-evidence-marker" title="{esc(m.get("title", ""))}">{esc(m.get("glyph", "·"))}</span>'
            for m in row["evidenceMarkers"]
        )
    return (
        '<div class="csat-row csat-sv-row-wrap" data-csat-surveys-row="grid">'
        f'<span class="csat-row-marker">{marker}</span>'
        f'<span class="csat-row-name">{name_cell}</span>'
        f'<span class="csat-row-tag">{survey}</span>'
        f'<span class="csat-row-verdict">{verdict}</span>'
        f'<span class="csat-row-key">{key_fact}</span>'
        f'<span class="csat-row-evidence">{evidence}</span>'
        f'<span class="csat-row-date">{date_html}</span>'
        "</div>"
    )


def render_row(row: Dict[str, Any], ctx: Optional[IntegratedSurveysCtx] = None, use_grid: bool = False) -> str:
    if use_grid:
        return render_row_csat_grid(row, ctx)
    attn_html = render_attention(row.get("attention"))
    deploy = inert_entity_link(row["deployment"])
    acct = row.get("account")
    if acct:
        deploy_block = (
            f'<span class="csat-sv-deploy">{deploy}'
            f'<span class="csat-sv-account">{esc(acct)}</span></span>'
        )
    else:
        deploy_block = f'<span class="csat-sv-deploy">{deploy}</span>'
    survey = f'<span class="survey-pill csat-sv-survey-tag">{esc(row["survey"])}</span>'
    date_cls = "csat-sv-date"
    if row.get("dateMuted"):
        date_cls += " is-muted"
    date_html = f'<span class="{date_cls}">{esc(row["dateLine"])}</span>'
    facet = f'<div class="csat-sv-row-secondary">{esc(row["facetLine"])}</div>'
    details_html = ""
    det = row.get("details")
    if det:
        open_attr = " open" if det.get("open") else ""
        items = "".join(f"<li>{esc(x)}</li>" for x in det.get("items", []))
        details_html = (
            f'<details class="csat-sv-details"{open_attr}>'
            f'<summary>{esc(det.get("summary", "invitation detail"))}</summary>'
            f'<ul class="csat-sv-invite-list">{items}</ul></details>'
        )
    primary = (
        '<div class="csat-sv-row-primary">'
        f'<span class="csat-sv-attn">{attn_html}</span>'
        f'<span class="csat-sv-primary-main">{deploy_block}{survey}</span>'
        f"{date_html}"
        "</div>"
    )
    return (
        '<div class="csat-sv-row-wrap" data-csat-surveys-row="compact">'
        f"{primary}{facet}{details_html}</div>"
    )


def render_group_header(header_parts: List[Dict[str, str]]) -> str:
    if not header_parts:
        return ""
    return (
        f'<span class="csat-sv-group-header">{render_horizon_parts(header_parts)}</span>'
    )


def render_group(
    section_key: str,
    eyebrow: str,
    section_id: str,
    group: Dict[str, Any],
    ctx: Optional[IntegratedSurveysCtx] = None,
    use_grid: bool = False,
) -> str:
    rows_html = "".join(render_row(r, ctx, use_grid) for r in group.get("rows", []))
    extra = ""
    if group.get("emptyMessage"):
        extra += f'<p class="csat-sv-empty-group">{esc(group["emptyMessage"])}</p>'
    for block in group.get("blocks", []):
        if block.get("type") == "overflow":
            extra += (
                f'<p class="csat-sv-overflow">{esc(block.get("prefix", ""))}'
                f'{inert_count_link(block["linkText"])}</p>'
            )
        elif block.get("type") == "subround":
            extra += (
                f'<p class="csat-sv-subround">{esc(block.get("label", ""))} '
                f'{inert_count_link(block["linkText"])}</p>'
            )
        elif block.get("type") == "later":
            extra += (
                f'<p class="csat-sv-subround">{esc(block["label"])} '
                f'{inert_count_link(block["linkText"])}</p>'
            )
    for tail_row in group.get("tailRows", []):
        extra += render_row(tail_row, ctx, use_grid)
    header_meta = render_group_header(group.get("headerParts", []))
    eyebrow_cls = "csat-sv-eyebrow csatEyebrow"
    head_cls = "csat-sv-section-head csatSectionHeader"
    return (
        f'<section class="csat-sv-panel" id="{esc(section_id)}" '
        f'data-csat-surveys-group="{esc(section_key)}" aria-labelledby="{esc(section_id)}-title">'
        f'<div class="{head_cls}">'
        f'<span class="{eyebrow_cls}">{esc(eyebrow)}</span>'
        f'<h2 class="trends-section-title csat-sv-section-title" id="{esc(section_id)}-title">'
        f'{esc(group.get("title", ""))}</h2>'
        f"{header_meta}</div>"
        f'<div class="csat-sv-rowlist">{rows_html}{extra}</div></section>'
    )


def render_filter_bar(filters: Dict[str, Any]) -> str:
    phases = filters.get("phaseJump", ["All", "Upcoming", "In Flight", "Recent"])
    active = filters.get("activePhase", "All")
    phase_btns = []
    for i, label in enumerate(phases):
        sep = '<span class="csat-sv-sep" aria-hidden="true">·</span>' if i else ""
        cls = "csat-sv-phase-btn is-active" if label == active else "csat-sv-phase-btn"
        href = "#"
        if label == "Upcoming":
            href = "#csat-sv-upcoming"
        elif label == "In Flight":
            href = "#csat-sv-inflight"
        elif label == "Recent":
            href = "#csat-sv-recent"
        phase_btns.append(
            f'{sep}<a href="{href}" class="{cls}" role="button" tabindex="0">{esc(label)}</a>'
        )
    types = filters.get("types", ["MDS", "PGL"])
    type_chips = []
    for t in types:
        pressed = "true" if t in filters.get("typesOn", types) else "false"
        type_chips.append(
            f'<button type="button" class="csat-sv-chip" aria-pressed="{pressed}" tabindex="0">{esc(t)}</button>'
        )
    att_label = filters.get("attentionMenu", "Attention ▾")
    round_label = filters.get("roundMenu", "Round ▾")
    lit = filters.get("attentionLit", [])
    lit_html = ""
    if lit:
        lit_html = " ".join(
            f'<button type="button" class="csat-sv-chip" aria-pressed="true" tabindex="0">{esc(x)}</button>'
            for x in lit
        )
    return (
        '<div class="csat-sv-sticky-bar" data-csat-surveys-controls="compact">'
        '<div class="csat-sv-filter-row">'
        f'<div class="csat-sv-phase-jump" role="group" aria-label="Phase">{"".join(phase_btns)}</div>'
        '<span class="csat-sv-filter-divider" aria-hidden="true"></span>'
        f'<div class="csat-sv-type-chips" role="group" aria-label="Survey type">{"".join(type_chips)}</div>'
        '<span class="csat-sv-filter-divider" aria-hidden="true"></span>'
        f'<button type="button" class="csat-sv-chip" aria-haspopup="true" aria-expanded="false" tabindex="0">'
        f"{esc(att_label)}</button>"
        f'{lit_html}'
        '<span class="csat-sv-filter-divider" aria-hidden="true"></span>'
        f'<button type="button" class="csat-sv-chip" aria-haspopup="true" aria-expanded="false" tabindex="0">'
        f"{esc(round_label)}</button>"
        "</div></div>"
    )


def render_shell_start(shell: Dict[str, str], data_as_of: str) -> str:
    return (
        '<div class="header">'
        '<div class="header-strip">'
        + W_MARK_SVG
        + "</div>"
        '<div class="header-body">'
        f"<h1>{esc(shell['headerTitle'])}</h1>"
        f"<p>{esc(shell['headerSubtitle'])}</p>"
        "</div>"
        f'<span class="freshness-badge freshness-fresh">Data as of {esc(data_as_of)}</span>'
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
    )


def render_csat_subnav(scope_menu: str, active_tab: int = 1, integrated: bool = False) -> str:
    tabs = ("Overview", "Surveys", "Responses")
    btns = []
    routes = ("#/overview", "#/surveys", "#/responses")
    for i, label in enumerate(tabs):
        active = i == active_tab
        data_route = f' data-csat-route="{routes[i]}"' if integrated else ""
        btns.append(
            f'<button type="button" class="csat-subtab-btn{" active" if active else ""}" '
            f'role="tab" aria-selected="{"true" if active else "false"}" '
            f'tabindex="{"0" if active else "-1"}"{data_route}>{esc(label)}</button>'
        )
    nav_cls = "csat-subtab-nav csat-sv-subnav csatSubtabNav" if integrated else "csat-subtab-nav csat-sv-subnav"
    scope_cls = "csatScopeMenu csat-sv-scope-btn" if integrated else "csat-sv-scope-btn"
    return (
        '<div class="csat-sv-subnav-row">'
        f'<nav class="{nav_cls}" role="tablist" aria-label="CSAT sections">'
        + "".join(btns)
        + "</nav>"
        f'<button type="button" class="{scope_cls}" aria-haspopup="true" aria-expanded="false">'
        f'{esc(scope_menu)} <span class="csat-sv-caret" aria-hidden="true">▾</span></button>'
        "</div>"
    )


def render_state_page(
    st: Dict[str, Any],
    meta: Dict[str, Any],
    ctx: Optional[IntegratedSurveysCtx] = None,
    integrated: bool = False,
    use_grid: bool = False,
    include_shell: bool = True,
) -> str:
    shell = meta["shells"][st["shell"]]
    groups_html = ""
    for key, eyebrow, sid in LIFECYCLE_GROUPS:
        groups_html += render_group(key, eyebrow, sid, st[key], ctx, use_grid)
    parts = []
    if include_shell:
        parts.append(render_shell_start(shell, st.get("dataAsOf", "Oct 2026")))
    parts.append(render_csat_subnav(st["scopeMenu"], active_tab=1, integrated=integrated))
    layout_id = "" if include_shell else ' id="csat-surveys-app"'
    parts.append(f'<div class="csat-sv-layout"{layout_id} data-csat-surveys-layout="compact-worklist">')
    parts.append(render_filter_bar(st.get("filters", {})))
    parts.append(groups_html)
    parts.append("</div>")
    body = "".join(parts)
    if not include_shell:
        return body
    return (
        '<main class="container" id="csat-surveys-app" data-csat-surveys-layout="compact-worklist">'
        + body
        + "</main>"
        + f'<div class="csat-sv-proto-badge" role="status">LOCAL PROTOTYPE · {esc(st["protoLabel"])} · '
        f'<a href="CSAT_SURVEYS_INDEX.html">All states</a></div>'
    )


def render_index() -> str:
    items = "".join(
        f'<li><a href="{esc(href)}">{esc(desc)}</a></li>'
        for href, desc in INDEX_ENTRIES
    )
    return (
        '<div class="csat-sv-index">'
        "<h1>CSAT Surveys — visual prototype states</h1>"
        '<p>Localhost only. Start with <a href="CSAT_SURVEYS_NORMAL.html">Normal</a>.</p>'
        f"<ul>{items}</ul></div>"
    )


def wrap_page(title: str, body: str, fixture: Dict[str, Any], dep_css: str, proto_css: str) -> str:
    fixture_json = json.dumps(fixture, separators=(",", ":"))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{esc(title)}</title>
  {dep_css}
  <style>{proto_css}</style>
  <style>.sr-only{{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}}</style>
</head>
<body data-csat-surveys-prototype="true">
  {body}
  <script type="application/json" id="csat-surveys-fixture">{fixture_json}</script>
</body>
</html>
"""


def validate_state_inputs(st: Dict[str, Any]) -> None:
    """Self-test helper: attention kinds and banned semantics."""
    mi = st.get("stateInputs", {})
    allowed_kinds = {
        "prepare",
        "cant_forecast",
        "chase",
        "delivery",
        "follow_up",
        "launch_not_seen",
        None,
    }
    for group_key in ("upcoming", "inflight", "recent"):
        for row in st.get(group_key, {}).get("rows", []) + st.get(group_key, {}).get("tailRows", []):
            kind = row.get("stateInputs", {}).get("attentionKind")
            if kind not in allowed_kinds:
                raise ValueError(f"unknown attention kind {kind} in {st['file']}")
            facet = row.get("facetLine", "").lower()
            if "delivered" in facet:
                raise ValueError(f"delivered in facet for {st['file']}")
            if re.search(r"\bconfirmed\b", facet):
                raise ValueError(f"confirmed in facet for {st['file']}")
    if mi.get("mustNotSumAttention") and mi.get("combinedAttentionTotal"):
        raise ValueError(f"combined attention in {st['file']}")


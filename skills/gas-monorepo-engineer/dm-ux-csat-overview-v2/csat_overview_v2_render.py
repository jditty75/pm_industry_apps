"""Render CSAT Overview V2 static HTML from fixture (no computation — format only)."""

from __future__ import annotations

import html
import json
from typing import Any, Dict, List, Optional

W_MARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1540 2000" width="24" height="24" aria-label="Workday"><g><g><path fill="#FFFFFF" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9,41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5,4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4-66.3,320.9-144.7,639.6-260.1,960.4-10,29.6-27.1,41.7-56.5,41.7Z"/><path fill="#FFFFFF" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9,149.1,0,289.2,58,394.4,163.3,54.8,54.8,96.6,118.9,124.3,188.7,6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7,27.5-69.7,69.2-133.7,123.7-188.3Z"/></g></g></svg>"""

LINK_TITLE = "Destination not built in this prototype"
N_LT_5_DESC = "Fewer than 5 responses: the average isn't shown, to protect accuracy and anonymity."
COVERAGE_COMMENT = (
    "PRODUCTION VALIDATION REQUIRED: denominator must be deployments due for survey."
)
DIRECTION_COMMENT = (
    "PROTOTYPE NOTE: direction half thresholds (≥10 responses) and magnitude (≥0.3) "
    "require final product confirmation before implementation."
)

STATE_ORDER = (
    "healthy",
    "risk",
    "low_evidence",
    "decline",
    "partner",
    "all",
    "low_volume",
)

INDEX_ENTRIES = [
    ("CSAT_OVERVIEW_HEALTHY.html", "Workday-led · healthy · adequate evidence"),
    ("CSAT_OVERVIEW_RISK.html", "Workday-led · concerning satisfaction"),
    ("CSAT_OVERVIEW_LOW_EVIDENCE.html", "Workday-led · inadequate evidence"),
    ("CSAT_OVERVIEW_DECLINE.html", "Workday-led · meaningful decline"),
    ("CSAT_OVERVIEW_PARTNER.html", "Partner-led scope"),
    ("CSAT_OVERVIEW_ALL.html", "All-deployments scope"),
    ("CSAT_OVERVIEW_LOW_VOLUME.html", "SLG-like low volume"),
]


def esc(s: Any) -> str:
    return html.escape("" if s is None else str(s))


def load_fixture(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def inert_link(text: str, href: str = "#") -> str:
    return (
        f'<a href="{esc(href)}" title="{esc(LINK_TITLE)}" '
        f'onclick="return false;" tabindex="0">{esc(text)}</a>'
    )


def render_band_bar(bands: List[int], muted: bool = False) -> str:
    total = sum(bands) or 1
    labels = ("Satisfied (4–5)", "Neutral (3)", "Dissatisfied (1–2)")
    classes = ("csat-v2-band-seg--sat", "csat-v2-band-seg--neu", "csat-v2-band-seg--dis")
    segs = []
    for i, (n, lbl, cls) in enumerate(zip(bands, labels, classes)):
        pct = max(n / total * 100, 0)
        if n > 0:
            tip = f"{lbl}: {n} of {total} responses"
            segs.append(
                f'<button type="button" class="csat-v2-band-seg {cls}" style="flex-grow:{pct}" '
                f'title="{esc(tip)}" aria-label="{esc(tip)}"></button>'
            )
    opacity = ' style="opacity:0.55"' if muted else ""
    return (
        f'<div class="csat-v2-band-bar"{opacity} aria-hidden="true">'
        + "".join(segs)
        + "</div>"
    )


def render_coverage(heard: int, due: int) -> str:
    if due <= 0:
        return '<span class="csat-v2-coverage">Not available</span>'
    pct = heard / due
    filled = min(5, max(0, int(round(pct * 5))))
    steps = "".join(
        f'<span class="csat-v2-coverage-step{" is-filled" if i < filled else ""}"></span>'
        for i in range(5)
    )
    return (
        '<span class="csat-v2-coverage">'
        f'<span>{heard} of {due} due</span>'
        f'<span class="csat-v2-coverage-meter" aria-hidden="true">{steps}</span>'
        f"<!-- {COVERAGE_COMMENT} -->"
        "</span>"
    )


def render_direction(d: Dict[str, Any]) -> str:
    kind = d.get("kind")
    if kind == "insufficient":
        n1, n2, need = d.get("n1"), d.get("n2"), d.get("needed", 10)
        return (
            f'<span class="csat-v2-direction-insufficient">'
            f"Too few responses to determine direction ({n1} · {n2}; {need} needed in each)"
            f'<span class="sr-only"> {esc(DIRECTION_COMMENT)}</span></span>'
        )
    glyph = {"stable": "▬", "declining": "▼", "improving": "▲"}.get(kind, "▬")
    word = {"stable": "Stable", "declining": "Declining", "improving": "Improving"}.get(
        kind, "Stable"
    )
    cls = f"csat-v2-direction-{kind}" if kind in ("declining", "improving") else "csat-v2-direction-stable"
    fr, to = d.get("from"), d.get("to")
    n1, n2 = d.get("n1"), d.get("n2")
    return (
        f'<span class="{cls}">{glyph} <span class="csat-v2-direction-word">{word}</span> · '
        f"{fr} → {to} ({n1} · {n2} responses)"
        f"<!-- {DIRECTION_COMMENT} -->"
        "</span>"
    )


def render_stage_row(row: Dict[str, Any], reference: bool = False) -> str:
    if row.get("suppressed"):
        mean_cell = (
            '<span class="csat-v2-n-pill" tabindex="0" '
            f'title="{esc(N_LT_5_DESC)}" aria-describedby="csat-n5-help">n&lt;5</span>'
        )
        bands_cell = esc(row.get("suppressedDetail", ""))
    else:
        mean_cell = f'<span class="csat-v2-stage-mean">{esc(row["mean"])}</span>'
        bands = row.get("bands", [0, 0, 0])
        bands_cell = (
            '<div class="csat-v2-band-cell">'
            + render_band_bar(bands, muted=reference)
            + f'<span class="csat-v2-band-counts">{bands[0]} · {bands[1]} · {bands[2]}</span>'
            + "</div>"
        )
    hf = row.get("heardFrom", {})
    evidence = f'{row["responses"]} responses · {row["deployments"]} deployments'
    if row.get("mixLine"):
        evidence += f'<br><span class="csat-v2-stage-sub">{esc(row["mixLine"])}</span>'
    wd_tag = ""
    if row.get("workdayLedOnly"):
        wd_tag = '<span class="csat-v2-wd-only-tag">Workday-led only</span>'
    stage_cell = (
        f'<th scope="row">'
        f'<span class="csat-v2-stage-name">{esc(row["label"])}{wd_tag}</span>'
        f'<span class="csat-v2-stage-sub">{esc(row.get("sublabel", ""))}</span>'
        f"</th>"
    )
    if reference:
        stage_cell = (
            f'<th scope="row" class="csat-v2-ref-label">'
            f'↳ <span class="csat-v2-stage-name">{esc(row["label"])}</span>'
            f'<span class="csat-v2-ref-tag">Reference</span></th>'
        )
    nps = row.get("nps", "")
    if reference:
        return (
            f'<tr class="csat-v2-reference-row">'
            f"{stage_cell}"
            f"<td>{mean_cell}</td>"
            f"<td>{bands_cell}</td>"
            f'<td>{row["responses"]} · {row["deployments"]}</td>'
            f'<td colspan="3"><em>{esc(row.get("comparisonNote", ""))}</em></td>'
            "</tr>"
        )
    return (
        "<tr>"
        f"{stage_cell}"
        f"<td>{mean_cell}</td>"
        f"<td>{bands_cell}</td>"
        f"<td>{evidence}</td>"
        f"<td>{render_coverage(hf.get('heard', 0), hf.get('due', 0))}</td>"
        f"<td>{render_direction(row['direction'])}</td>"
        f"<td>{esc(nps)}</td>"
        "</tr>"
    )


def render_scope_bar(st: Dict[str, Any], meta: Dict[str, Any]) -> str:
    active = st["scopeActive"]
    segments = [
        ("workday-led", "Workday-led"),
        ("partner-led", "Partner-led"),
        ("all", "All deployments"),
    ]
    btns = []
    for key, label in segments:
        is_on = key == active
        btns.append(
            f'<button type="button" class="seg-control-btn{" active" if is_on else ""}" '
            f'role="radio" aria-checked="{"true" if is_on else "false"}" tabindex="{"0" if is_on else "-1"}">'
            f"{esc(label)}</button>"
        )
    return (
        f'<section class="csat-v2-scope-bar" data-csat-region="OV-0" aria-label="Scope and freshness">'
        '<div class="csat-v2-scope-left">'
        '<span class="csat-v2-scope-label">Delivery leadership</span>'
        f'<div class="seg-control" role="radiogroup" aria-label="Delivery leadership">{"".join(btns)}</div>'
        '<span class="csat-v2-scope-label">Window</span>'
        f'<select class="csat-v2-window-select" aria-label="Time window" disabled>'
        f'<option>{esc(meta["windowLabel"])}</option></select>'
        f'<span class="csat-v2-window-range">{esc(meta["windowRange"])}</span>'
        "</div>"
        '<div class="csat-v2-scope-right">'
        f'<span class="freshness-badge freshness-fresh">{esc(meta["responsesImported"])}</span>'
        '<button type="button" class="btn btn-secondary" disabled>Refresh</button>'
        "</div></section>"
    )


def render_ov1(st: Dict[str, Any], meta: Dict[str, Any]) -> str:
    h = st["headline"]
    dir_html = render_direction(h["direction"])
    meta_bits = [f'{h["responses"]} responses · {h["deployments"]} deployments']
    if h.get("pglOnlyNote"):
        meta_bits.insert(0, esc(h["pglOnlyNote"]))
    if h.get("mixNote"):
        meta_bits.append(esc(h["mixNote"]))
    headline_meta = " · ".join(meta_bits)
    rows: List[str] = []
    if st.get("mdsMutedLine"):
        rows.append(
            f'<tr><td colspan="7" class="csat-v2-mds-muted">{esc(st["mdsMutedLine"])}</td></tr>'
        )
    elif st.get("mdsRow"):
        rows.append(render_stage_row(st["mdsRow"]))
    if st.get("pglRow"):
        rows.append(render_stage_row(st["pglRow"]))
    ref = st.get("referenceRow")
    if ref:
        rows.append(render_stage_row(ref, reference=True))
    table_body = "<tbody>" + "".join(rows) + "</tbody>" if rows else ""
    stage_note = ""
    if st.get("stageNote"):
        stage_note = f'<p class="csat-v2-stage-note">{esc(st["stageNote"])}</p>'
    comp_note = ""
    if st.get("pglCompositionNote"):
        comp_note = f'<p class="csat-v2-composition-note">{esc(st["pglCompositionNote"])}</p>'
    q = st["qualifier"]
    q_cls = "csat-v2-qualifier"
    icon = "ⓘ"
    if q.get("tone") == "caution":
        q_cls += " csat-v2-qualifier--caution"
        icon = "⚠"
    weight = ""
    if st.get("weightingNote"):
        weight = f'<p class="csat-v2-weighting">{esc(st["weightingNote"])}</p>'
    return (
        f'<section class="trends-section" data-csat-region="OV-1" aria-labelledby="csat-ov1-title">'
        '<div class="trends-section-header">'
        f'<div><div class="trends-section-title" id="csat-ov1-title">{esc(st["ov1Title"])}</div>'
        f'<div class="trends-section-sub">{esc(meta["windowLabel"])} · {esc(meta["windowRange"])}</div></div>'
        '<button type="button" class="csat-v2-calc-btn" title="How these figures are calculated (definitions in design spec)">ⓘ</button>'
        "</div>"
        '<div class="csat-v2-headline-row">'
        '<span class="csat-v2-overall-label">Overall Satisfaction</span>'
        f'<span class="csat-v2-headline-value">{esc(h["value"])}</span>'
        '<span class="csat-v2-headline-scale">/ 5</span>'
        f'<span class="csat-v2-headline-meta">{headline_meta}</span>'
        f'<span class="csat-v2-headline-meta">{dir_html}</span>'
        "</div>"
        '<div class="csat-v2-stage-table-wrap"><table class="csat-v2-stage-table">'
        "<thead><tr>"
        '<th scope="col">Survey stage</th><th scope="col">Satisfaction</th>'
        '<th scope="col">Satisfied · Neutral · Dissatisfied</th>'
        '<th scope="col">Evidence</th><th scope="col">Heard from</th>'
        '<th scope="col">Direction</th><th scope="col">NPS</th>'
        "</tr></thead>"
        f"{table_body}</table></div>"
        f"{stage_note}{comp_note}"
        f'<div class="{q_cls}">'
        f'<span class="csat-v2-qualifier-text">{icon} {esc(q["text"])}</span>'
        '<div class="csat-v2-footer-links">'
        + (inert_link(q["gapsLink"]) if q.get("gapsLink") else "")
        + inert_link("View responses →")
        + "</div></div>"
        f"{weight}"
        "</section>"
    )


def render_risk_pill(pill: str, severity: str) -> str:
    cls = "status-red" if severity == "red" else "status-yellow"
    return f'<span class="status-pill {cls}">{esc(pill)}</span>'


def render_ov2(st: Dict[str, Any], meta: Dict[str, Any]) -> str:
    risk = st["risk"]
    scope_name = st["ov1Title"].split("·")[-1].strip()
    if risk.get("empty"):
        body = (
            '<div class="csat-v2-risk-empty">'
            f"No Customer Satisfaction risk among the {risk['responseCount']} responses received in this window."
            '<p class="csat-v2-risk-empty-sub">Deployments not yet heard from aren\'t included. See evidence gaps.</p>'
            "</div>"
        )
        summary = ""
    else:
        summary = (
            f'<p class="csat-v2-headline-meta"><strong>{risk["lowVerdicts"]}</strong> deployments with a low verdict · '
            f'<strong>{risk["earlyWarnings"]}</strong> early warning</p>'
        )
        items = []
        for row in risk.get("rows", []):
            items.append(
                '<li class="csat-v2-risk-item">'
                '<div class="csat-v2-risk-line1">'
                f'{render_risk_pill(row["pill"], row["severity"])}'
                f'<a href="#" class="csat-v2-risk-name" title="{esc(LINK_TITLE)}" onclick="return false;">'
                f'{esc(row["name"])}</a>'
                f'<span class="csat-v2-survey-pill">{esc(row["stage"])}</span>'
                "</div>"
                f'<div class="csat-v2-risk-fact">{esc(row["fact"])}</div>'
                "</li>"
            )
        body = '<ul class="csat-v2-risk-list">' + "".join(items) + "</ul>"
    footer = inert_link(risk.get("footer", "View in Responses →")) if not risk.get("empty") else ""
    return (
        f'<section class="trends-section" data-csat-region="OV-2" aria-labelledby="csat-ov2-title">'
        '<div class="trends-section-header">'
        '<div class="trends-section-title" id="csat-ov2-title">Customer Satisfaction risk</div>'
        f'<div class="trends-section-sub">{esc(scope_name)} · rolling 12 months</div>'
        "</div>"
        f"{summary}{body}"
        f'<p class="csat-panel-footer-link" style="margin-top:12px">{footer}</p>'
        "</section>"
    )


def render_ov3(st: Dict[str, Any]) -> str:
    d = st["delivery"]
    low = " · ".join(
        f'{x["label"]} {x["value"]:.1f} (n {x["n"]})' for x in d.get("lowest", [])
    )
    high = " · ".join(
        f'{x["label"]} {x["value"]:.1f} (n {x["n"]})' for x in d.get("highest", [])
    )
    return (
        f'<section class="trends-section" data-csat-region="OV-3" aria-labelledby="csat-ov3-title">'
        '<div class="trends-section-title" id="csat-ov3-title">Delivery ratings</div>'
        '<p class="csat-v2-delivery-line">'
        f'<span class="csat-v2-delivery-label">Lowest rated</span>{esc(low)}</p>'
        '<p class="csat-v2-delivery-line">'
        f'<span class="csat-v2-delivery-label">Highest rated</span>{esc(high)}</p>'
        f'<p class="csat-panel-footer-link">{inert_link("All delivery ratings →")} · '
        f'{inert_link("Compare by delivery leadership →")}</p>'
        "</section>"
    )


def render_ov4(st: Dict[str, Any]) -> str:
    j = st["journey"]
    title_sub = esc(j.get("subtitle", "Workday-led deployments with both surveys"))
    if j.get("notApplicable"):
        inner = f'<p class="csat-v2-journey-muted">{esc(j["notApplicable"])}</p>'
        sub = ""
    else:
        inner = f'<p class="csat-v2-journey-summary">{esc(j.get("summary", ""))}</p>'
        if j.get("link"):
            inner += f'<p class="csat-panel-footer-link">{inert_link(j["link"])}</p>'
        sub = f'<p class="csat-v2-journey-muted">{esc(j.get("note", ""))}</p>'
    return (
        f'<section class="trends-section" data-csat-region="OV-4" aria-labelledby="csat-ov4-title">'
        '<div class="trends-section-title" id="csat-ov4-title">MDS → PGL journey</div>'
        f'<div class="trends-section-sub">{title_sub}</div>'
        f"{inner}{sub}"
        "</section>"
    )


def render_ov5(st: Dict[str, Any], meta: Dict[str, Any]) -> str:
    ops = st["surveyOps"]
    if ops.get("allClear"):
        issues = f"✓ No survey operation issues · {esc(meta['invitationsImported'])}"
    else:
        issues_html = " · ".join(inert_link(f"⚠ {x}") for x in ops.get("issues", []))
        issues = issues_html + f" · {esc(meta['invitationsImported'])}"
    return (
        f'<footer class="csat-v2-survey-ops" data-csat-region="OV-5">'
        '<div><span class="csat-v2-survey-ops-label">Survey Operations</span>'
        f"{issues}</div>"
        f"{inert_link('Open Survey Operations →')}"
        "</footer>"
    )


def render_shell_start(shell: Dict[str, str]) -> str:
    return (
        '<div class="header">'
        '<div class="header-strip">'
        + W_MARK_SVG
        + "</div>"
        '<div class="header-body">'
        f"<h1>{esc(shell['headerTitle'])}</h1>"
        f"<p>{esc(shell['headerSubtitle'])}</p>"
        "</div>"
        '<span class="freshness-badge freshness-fresh">Data as of Oct 6, 2026</span>'
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


def render_csat_subnav() -> str:
    tabs = ("Overview", "Responses", "Survey Operations")
    btns = []
    for i, label in enumerate(tabs):
        active = i == 0
        btns.append(
            f'<button type="button" class="csat-subtab-btn{" active" if active else ""}" '
            f'role="tab" aria-selected="{"true" if active else "false"}" '
            f'tabindex="{"0" if active else "-1"}">{esc(label)}</button>'
        )
    return (
        '<nav class="csat-subtab-nav csat-v2-subnav" role="tablist" aria-label="CSAT sections">'
        + "".join(btns)
        + "</nav>"
    )


def render_state_page(st: Dict[str, Any], meta: Dict[str, Any]) -> str:
    shell = meta["shells"][st["shell"]]
    return (
        '<div class="container" id="csat-overview-v2-app">'
        + render_shell_start(shell)
        + '<div class="info-banner">ⓘ '
        + esc(meta["infoBanner"])
        + "</div>"
        + render_csat_subnav()
        + render_scope_bar(st, meta)
        + '<div class="csat-v2-grid-top">'
        + render_ov1(st, meta)
        + render_ov2(st, meta)
        + "</div>"
        + '<div class="csat-v2-grid-bottom">'
        + render_ov3(st)
        + render_ov4(st)
        + "</div>"
        + render_ov5(st, meta)
        + "</div>"
        + f'<div class="csat-v2-proto-badge" role="status">LOCAL PROTOTYPE · {esc(st["protoLabel"])} · '
        f'<a href="CSAT_OVERVIEW_V2_INDEX.html">All states</a></div>'
        '<p id="csat-n5-help" class="sr-only">'
        + esc(N_LT_5_DESC)
        + "</p>"
    )


def render_index() -> str:
    items = "".join(
        f'<li><a href="{esc(href)}">{esc(href.replace(".html", ""))}</a>'
        f'<span class="desc">{esc(desc)}</span></li>'
        for href, desc in INDEX_ENTRIES
    )
    return (
        '<div class="csat-v2-index">'
        "<h1>CSAT Overview V2 — visual prototype states</h1>"
        "<p>Localhost only. Start with <a href=\"CSAT_OVERVIEW_HEALTHY.html\">Healthy</a>.</p>"
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
<body data-csat-overview-v2-prototype="true">
  {body}
  <script type="application/json" id="csat-overview-v2-fixture">{fixture_json}</script>
</body>
</html>
"""

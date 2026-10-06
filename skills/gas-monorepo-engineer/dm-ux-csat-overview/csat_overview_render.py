"""Render CSAT Overview A/B/C static HTML from shared fixture."""

from __future__ import annotations

import html
import json
from typing import Any, Dict, List

W_MARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1540 2000" width="24" height="24" aria-label="Workday"><g><g><path fill="#FFFFFF" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9,41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5,4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4-66.3,320.9-144.7,639.6-260.1,960.4-10,29.6-27.1,41.7-56.5,41.7Z"/><path fill="#FFFFFF" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9,149.1,0,289.2,58,394.4,163.3,54.8,54.8,96.6,118.9,124.3,188.7,6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7,27.5-69.7,69.2-133.7,123.7-188.3Z"/></g></g></svg>"""

N_LT_5_TITLE = "Fewer than 5 responses — suppressed to protect reliability and privacy."


def esc(s: Any) -> str:
    return html.escape("" if s is None else str(s))


def load_fixture(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def n_suppressed_pill() -> str:
    return (
        f'<span class="csat-n-suppressed" tabindex="0" title="{esc(N_LT_5_TITLE)}">'
        'n&lt;5 <span aria-hidden="true">ⓘ</span></span>'
    )


def compare_links(active: str) -> str:
    links = []
    for key, label, file in (
        ("A", "Overview A", "DM_UX_CSAT_A.html"),
        ("B", "Overview B", "DM_UX_CSAT_B.html"),
        ("C", "Overview C", "DM_UX_CSAT_C.html"),
    ):
        cur = ' aria-current="page"' if key == active else ""
        links.append(f'<a href="{file}"{cur}>{label}</a>')
    return (
        '<nav class="csat-proto-compare" aria-label="CSAT Overview composition">'
        + links[0]
        + '<span class="csat-proto-compare__sep">|</span>'
        + links[1]
        + '<span class="csat-proto-compare__sep">|</span>'
        + links[2]
        + "</nav>"
    )


def render_shell_start(active: str, fixture: Dict[str, Any]) -> str:
    return (
        compare_links(active)
        + '<div class="container" id="csat-overview-app">'
        + '<div class="header">'
        + '<div class="header-strip">'
        + W_MARK_SVG
        + "</div>"
        + '<div class="header-body"><h1>Deployment Manager</h1>'
        + "<p>State &amp; Local Government</p></div>"
        + '<span class="freshness-badge freshness-fresh">Data as of Oct 5, 2026 · synthetic</span>'
        + '<div class="header-right"><span style="font-size:12px;color:var(--color-text-muted)">Showing: All</span></div>'
        + "</div>"
        + '<nav class="tabs" role="tablist" aria-label="Primary features">'
        + '<button type="button" class="tab">Overview</button>'
        + '<button type="button" class="tab">Deployments</button>'
        + '<button type="button" class="tab">Go Lives</button>'
        + '<button type="button" class="tab">Reporting</button>'
        + '<button type="button" class="tab">Portfolio Health</button>'
        + '<button type="button" class="tab">Trends</button>'
        + '<button type="button" class="tab active" aria-selected="true">CSAT</button>'
        + '<button type="button" class="tab">Notable Deployments</button>'
        + '<button type="button" class="tab">Manage Overrides</button>'
        + "</nav>"
        + '<nav class="csat-subnav" role="tablist" aria-label="CSAT sections">'
        + '<button type="button" role="tab" aria-selected="true">Overview</button>'
        + '<button type="button" role="tab" aria-selected="false">Survey Tracking</button>'
        + '<button type="button" role="tab" aria-selected="false">Responses</button>'
        + '<button type="button" role="tab" aria-selected="false">Customer Feedback</button>'
        + "</nav>"
    )


def render_filters_c(extra_show: bool = False) -> str:
    show_row = ""
    if extra_show:
        show_row = (
            '<span class="csat-filter-toggle" aria-label="Show filter (static)">'
            '<span class="is-on">All</span><span>Declining</span><span>Low score</span></span>'
        )
    return (
        '<div class="csat-filter-shell deployments-filter-shell">'
        + '<div class="csat-filter-primary deployments-filter-primary">'
        + '<input type="search" placeholder="Search account/deployment" aria-label="Search account or deployment" />'
        + f'<label>Period: <select aria-label="Period"><option>{esc("Last 90 days")}</option></select></label>'
        + '<span class="csat-filter-toggle" aria-label="Survey type">'
        + '<span class="is-on">All</span><span>MDS</span><span>PGL</span></span>'
        + '<label>Product Area: <select aria-label="Product Area"><option>All areas</option></select></label>'
        + show_row
        + '<span class="csat-filter-link">Advanced Filters</span>'
        + '<span class="csat-filter-link">Clear filters</span>'
        + "</div>"
        + '<div class="deployments-active-filters hidden" aria-hidden="true">'
        + '<span class="deployments-active-label">ACTIVE:</span>'
        + "</div></div>"
    )


def render_product_area_list(fixture: Dict[str, Any], limit: int = 5) -> str:
    rows = []
    max_n = max((a["n"] for a in fixture["productAreas"] if not a.get("suppressed")), default=1)
    for area in fixture["productAreas"][:limit]:
        if area.get("suppressed"):
            score_cell = n_suppressed_pill()
            bar = '<div class="csat-area-bar"><span style="width:20%"></span></div>'
        else:
            score_cell = f"{area['score']:.1f} (n={area['n']})"
            pct = int((area["n"] / max_n) * 100)
            bar = f'<div class="csat-area-bar"><span style="width:{pct}%"></span></div>'
        rows.append(
            f'<li class="csat-area-row"><span>{esc(area["name"])}</span>{bar}<span>{score_cell}</span></li>'
        )
    return (
        '<ul class="csat-area-list">'
        + "".join(rows)
        + "</ul>"
        + '<p class="csat-area-caption">Responses touching area — one response can span multiple areas.</p>'
        + '<p class="csat-panel-footer-link"><a href="#">View all Product Areas →</a></p>'
    )


def render_attention_list(fixture: Dict[str, Any], limit: int = 5) -> str:
    items = []
    for row in fixture["attention"][:limit]:
        flag = " ⚑" if row.get("hasFeedback") else ""
        detail = f" — {esc(row['detail'])}" if row.get("detail") else ""
        meta = row.get("meta", "")
        reason = row.get("reason", "")
        items.append(
            "<li>"
            + f'<a href="#"><span class="csat-attn-name">{esc(row["deployment"])}{detail}</span>'
            + f'<span class="csat-attn-reason">{esc(reason)} · {esc(meta)}{flag}</span></a>'
            + "</li>"
        )
    more = len(fixture["attention"]) - limit
    if more > 0:
        items.append(f'<li class="csat-attn-reason">… ({more} more)</li>')
    return '<ul class="csat-attn-list">' + "".join(items) + "</ul>"


def sparkline_svg(values: List[float], w: int = 120, h: int = 36, css_class: str = "") -> str:
    if not values:
        return ""
    lo, hi = min(values), max(values)
    pad = (hi - lo) * 0.1 or 0.1
    lo -= pad
    hi += pad
    pts = []
    for i, v in enumerate(values):
        x = (i / max(len(values) - 1, 1)) * (w - 4) + 2
        y = h - 2 - ((v - lo) / (hi - lo)) * (h - 4)
        pts.append(f"{x:.1f},{y:.1f}")
    path = "M" + " L".join(pts)
    return (
        f'<svg class="{css_class}" viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="Sparkline trend"><path d="{path}" fill="none" '
        f'stroke="var(--color-primary)" stroke-width="2"/></svg>'
    )


def trend_chart_svg(months: List[Dict[str, Any]], full_width: bool = True) -> str:
    w, h, pad_l, pad_b, pad_t = 900, 180, 44, 28, 12
    if not full_width:
        w = 700
    vols = [m["volume"] for m in months]
    max_vol = max(vols) or 1
    scores = [m["overall"] for m in months]
    min_s, max_s = min(scores) - 0.2, max(scores) + 0.2
    inner_w = w - pad_l - 12
    inner_h = h - pad_b - pad_t
    bars = []
    lines_o, lines_p, lines_m = [], [], []
    for i, m in enumerate(months):
        x = pad_l + (i / max(len(months) - 1, 1)) * inner_w
        bar_h = (m["volume"] / max_vol) * (inner_h * 0.35)
        bars.append(
            f'<rect x="{x - 8:.1f}" y="{h - pad_b - bar_h:.1f}" width="16" height="{bar_h:.1f}" '
            f'fill="var(--color-border-subtle)" opacity="0.9"/>'
        )
        for key, acc, color, dash in (
            ("overall", lines_o, "var(--color-primary)", ""),
            ("pgl", lines_p, "var(--color-status-green-fg)", ' stroke-dasharray="4 3"'),
            ("mds", lines_m, "#7c3aed", ' stroke-dasharray="2 2"'),
        ):
            y = pad_t + inner_h - ((m[key] - min_s) / (max_s - min_s)) * inner_h
            op = ' opacity="0.45"' if m.get("lowN") else ""
            acc.append((x, y, op, dash, color))
    def poly(acc):
        return " ".join(f"{x:.1f},{y:.1f}" for x, y, *_ in acc)

    svg = [
        f'<svg viewBox="0 0 {w} {h}" role="img" aria-labelledby="csat-trend-title">',
        '<title id="csat-trend-title">Satisfaction trend by month with response volume</title>',
        "".join(bars),
    ]
    for acc, color, dash in (
        (lines_o, "var(--color-primary)", ""),
        (lines_p, "var(--color-status-green-fg)", ' stroke-dasharray="4 3"'),
        (lines_m, "#7c3aed", ' stroke-dasharray="2 2"'),
    ):
        for i, (x, y, op, d, c) in enumerate(acc):
            if i == 0:
                continue
            x0, y0 = acc[i - 1][0], acc[i - 1][1]
            svg.append(
                f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x:.1f}" y2="{y:.1f}" stroke="{c}" '
                f'stroke-width="2"{dash}{acc[i][2]}/>'
            )
    for i, m in enumerate(months):
        if i % 2 == 0:
            x = pad_l + (i / max(len(months) - 1, 1)) * inner_w
            svg.append(
                f'<text x="{x:.1f}" y="{h - 6}" text-anchor="middle" font-size="11" '
                f'fill="var(--color-text-muted)">{esc(m["label"])}</text>'
            )
    svg.append(
        f'<text x="4" y="{pad_t + 8}" font-size="11" fill="var(--color-text-muted)">{max_s:.1f}</text>'
    )
    svg.append(
        f'<text x="4" y="{h - pad_b - 4}" font-size="11" fill="var(--color-text-muted)">{min_s:.1f}</text>'
    )
    svg.append("</svg>")
    return "".join(svg)


def render_survey_context_compact(fixture: Dict[str, Any]) -> str:
    sc = fixture["surveyContext"]
    return (
        '<div class="csat-survey-context-compact">'
        + f"{sc['sent']} sent · {sc['completionPct']}% completion · {sc['awaiting']} awaiting response · "
        + '<a href="#">View Survey Tracking →</a></div>'
    )


def render_overview_a(fixture: Dict[str, Any]) -> str:
    h = fixture["headline"]
    delta_cls = "positive" if h["overallDelta"] >= 0 else "negative"
    arrow = "▲" if h["overallDelta"] >= 0 else "▼"
    sign = "+" if h["overallDelta"] >= 0 else ""
    spark = sparkline_svg(fixture["heroSparkline"], css_class="csat-a-hero-spark")

    support = ""
    for label, val, n, accent in (
        ("PGL Satisfaction", h["pgl"], h["pglN"], ""),
        ("MDS Satisfaction", h["mds"], h["mdsN"], ""),
        ("NPS (PGL)", h["nps"], h["npsN"], ""),
    ):
        support += (
            '<div class="kpi-card">'
            + f'<div class="kpi-label">{label}</div>'
            + f'<div class="golives-kpi-value-row"><span class="golives-kpi-count">{val}</span></div>'
            + f'<div class="kpi-sub">n={n}</div></div>'
        )

    attn_count = len(fixture["attention"])
    return (
        render_shell_start("A", fixture)
        + '<div class="info-banner" role="status">ⓘ Customer experience across active &amp; historical deployments.</div>'
        + render_filters_c(False)
        + '<main id="composition-marker-a" data-csat-composition="A" data-csat-region="executive-signal">'
        + '<div class="csat-a-hero-row">'
        + '<div class="csat-a-hero-card">'
        + '<div class="csat-a-hero-label">Overall Satisfaction</div>'
        + '<div class="csat-a-hero-inner">'
        + "<div>"
        + f'<div class="csat-a-hero-value">{h["overall"]:.1f}</div>'
        + f'<div class="csat-a-hero-delta {delta_cls}">{arrow}{sign}{h["overallDelta"]:.1f} vs prior period</div>'
        + f'<div class="csat-a-hero-meta">{h["overallFavorablePct"]}% favorable · n={h["overallN"]}</div>'
        + "</div>"
        + spark
        + "</div></div>"
        + f'<div class="csat-a-support-stack">{support}</div></div>'
        + '<div class="csat-a-trend-row">'
        + '<div class="csat-panel"><div class="csat-panel-title">Satisfaction trend</div>'
        + '<div class="csat-trend-chart">'
        + trend_chart_svg(fixture["trendMonths"])
        + '</div><div class="csat-trend-legend">'
        + '<span class="leg-overall">Overall</span><span class="leg-pgl">PGL</span><span class="leg-mds">MDS</span>'
        + '<span style="margin-left:auto">Period: 12 months</span></div></div>'
        + '<div class="csat-panel">'
        + f'<div class="csat-panel-title">Needs attention <span class="status-pill" style="background:var(--color-status-red-bg);color:var(--color-status-red-fg)">{attn_count}</span></div>'
        + render_attention_list(fixture, 5)
        + '<p class="csat-panel-footer-link"><a href="#">View all in Responses →</a></p>'
        + "</div></div>"
        + '<div class="csat-a-bottom-row">'
        + '<div class="csat-panel"><div class="csat-panel-title">Product Area</div>'
        + render_product_area_list(fixture)
        + "</div>"
        + '<div class="csat-panel">' + render_survey_context_compact(fixture) + "</div>"
        + "</div></main></div>"
    )


def render_overview_b(fixture: Dict[str, Any]) -> str:
    h = fixture["headline"]
    sc = fixture["surveyContext"]
    attn_count = len(fixture["attention"])
    arrow = "▲" if h["overallDelta"] >= 0 else "▼"
    sign = "+" if h["overallDelta"] >= 0 else ""
    return (
        render_shell_start("B", fixture)
        + '<div class="info-banner" role="status">ⓘ Customer experience across active &amp; historical deployments.</div>'
        + render_filters_c(False)
        + '<main id="composition-marker-b" data-csat-composition="B" data-csat-region="balanced-three-column">'
        + '<div class="csat-b-three-col">'
        + '<section class="csat-b-col" aria-labelledby="b-outcomes">'
        + '<h2 class="csat-b-col-title" id="b-outcomes">Customer Outcomes</h2>'
        + f'<div class="csat-b-outcomes-main">Overall {h["overall"]:.1f} {arrow}{sign}{h["overallDelta"]:.1f} <span style="font-size:14px;font-weight:500;color:var(--color-text-muted)">n={h["overallN"]}</span></div>'
        + '<div class="csat-b-outcomes-list">'
        + f"PGL {h['pgl']:.1f} n={h['pglN']}<br/>"
        + f"MDS {h['mds']:.1f} n={h['mdsN']}<br/>"
        + f"NPS {h['nps']} n={h['npsN']}"
        + "</div></section>"
        + '<section class="csat-b-col" aria-labelledby="b-coverage">'
        + '<h2 class="csat-b-col-title" id="b-coverage">Survey Coverage</h2>'
        + '<div class="csat-b-coverage-list">'
        + f"{sc['sent']} sent this period<br/>"
        + f"{sc['completionPct']}% completion rate<br/>"
        + f"{sc['awaiting']} awaiting response<br/>"
        + f"<hr style='border:none;border-top:1px solid var(--color-border-subtle);margin:8px 0'/>"
        + f"{sc['upcoming3mo']} upcoming (3 mo)<br/>"
        + f"{sc['bouncedFailed']} bounced/failed"
        + "</div></section>"
        + '<section class="csat-b-col" aria-labelledby="b-attn">'
        + '<div class="csat-b-attn-header"><h2 class="csat-b-col-title" id="b-attn">Needs Attention</h2>'
        + f'<span class="status-pill" style="background:var(--color-status-yellow-bg);color:var(--color-status-yellow-fg)">{attn_count}</span></div>'
        + render_attention_list(fixture, 5)
        + '<p class="csat-panel-footer-link"><a href="#">View all →</a></p>'
        + "</section></div>"
        + '<div class="csat-panel csat-b-trend-full"><div class="csat-panel-title">Satisfaction &amp; volume trend</div>'
        + '<div class="csat-trend-chart">'
        + trend_chart_svg(fixture["trendMonths"])
        + '</div><div class="csat-trend-legend">'
        + '<span class="leg-overall">Overall</span><span class="leg-pgl">PGL</span><span class="leg-mds">MDS</span>'
        + "</div></div>"
        + '<div class="csat-b-bottom-row">'
        + '<div class="csat-panel"><div class="csat-panel-title">Product Area</div>'
        + render_product_area_list(fixture)
        + "</div>"
        + '<div class="csat-panel csat-survey-context-compact" style="display:flex;align-items:center">'
        + '<a href="#">Survey Tracking detail →</a></div>'
        + "</div></main></div>"
    )


def row_trend_svg(kind: str) -> str:
    if kind == "down":
        d = "M2,2 L20,14"
    elif kind == "mixed":
        d = "M2,10 L10,4 L20,12"
    elif kind == "flat":
        d = "M2,8 L20,8"
    else:
        d = "M2,14 L20,2"
    return (
        f'<svg class="csat-mini-spark" viewBox="0 0 22 16" aria-hidden="true">'
        f'<path d="{d}" stroke="var(--color-status-red-fg)" stroke-width="2" fill="none"/></svg>'
    )


def render_overview_c(fixture: Dict[str, Any]) -> str:
    h = fixture["headline"]
    attn_count = len(fixture["attention"])
    rows = []
    for row in fixture["attention"]:
        score_txt = f'{row["scoreLabel"]} {row["score"]:.1f}'
        if row["score"] <= 3.0:
            score_txt = f'<span class="csat-score-bad">{score_txt}</span>'
        flag = "⚑" if row.get("hasFeedback") else ""
        rows.append(
            "<tr>"
            + f'<td><a href="#">{esc(row["deployment"])}</a></td>'
            + f"<td>{score_txt}</td>"
            + f"<td>{row_trend_svg(row.get('trend', 'down'))}</td>"
            + f"<td>{esc(row['area'])}</td>"
            + f'<td aria-label="Has feedback comment">{flag}</td>'
            + "</tr>"
        )
    mini = sparkline_svg([m["overall"] for m in fixture["trendMonths"]], w=200, h=48)
    return (
        render_shell_start("C", fixture)
        + '<div class="info-banner" role="status">ⓘ Find deployments and areas that need a closer look.</div>'
        + render_filters_c(True)
        + '<main id="composition-marker-c" data-csat-composition="C" data-csat-region="investigation-table">'
        + '<div class="csat-c-ref-strip" aria-label="Headline metrics reference">'
        + f'<span><span class="lbl">Overall </span><strong>{h["overall"]:.1f}</strong> (n={h["overallN"]})</span>'
        + " · "
        + f'<span><span class="lbl">PGL </span><strong>{h["pgl"]:.1f}</strong> (n={h["pglN"]})</span>'
        + " · "
        + f'<span><span class="lbl">MDS </span><strong>{h["mds"]:.1f}</strong> (n={h["mdsN"]})</span>'
        + " · "
        + f'<span><span class="lbl">NPS </span><strong>{h["nps"]}</strong> (n={h["npsN"]})</span>'
        + "</div>"
        + '<div class="csat-c-invest-row">'
        + '<div class="csat-panel">'
        + f'<div class="csat-panel-title">Needs attention — {attn_count} deployments</div>'
        + '<div class="csat-c-table-wrap"><table class="csat-c-table">'
        + "<thead><tr>"
        + '<th scope="col">Deployment</th>'
        + '<th scope="col" aria-sort="descending">Score</th>'
        + '<th scope="col">Trend</th>'
        + '<th scope="col">Area</th>'
        + '<th scope="col"><span class="sr-only">Feedback</span>⚑</th>'
        + "</tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table></div>"
        + '<p class="csat-panel-footer-link">Row → <a href="#">View supporting responses</a></p>'
        + "</div>"
        + '<div class="csat-panel">'
        + '<div class="csat-panel-title">Product Area</div>'
        + render_product_area_list(fixture, 6)
        + '<div class="csat-c-mini-trend" aria-label="Overall trend mini chart">'
        + "<div style='font-size:11px;color:var(--color-text-muted);margin-bottom:4px'>Trend (mini)</div>"
        + mini
        + "</div></div></div>"
        + '<footer class="csat-c-footer">Survey context: '
        + f"{fixture['surveyContext']['sent']} sent · {fixture['surveyContext']['completionPct']}% completion · "
        + f"{fixture['surveyContext']['awaiting']} awaiting · "
        + '<a href="#">View Survey Tracking →</a></footer>'
        + "</main></div>"
    )


def wrap_page(title: str, composition: str, body_inner: str, fixture: Dict[str, Any], dep_css: str, proto_css: str) -> str:
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
<body data-csat-overview-prototype="true" data-csat-composition="{composition}">
  {body_inner}
  <script type="application/json" id="csat-overview-fixture">{fixture_json}</script>
  <button type="button" id="csat-overview-proto-badge" title="Dismiss">LOCAL PROTOTYPE — NOT PRODUCTION</button>
  <script>
  (function() {{
    var b = document.getElementById('csat-overview-proto-badge');
    if (b) b.addEventListener('click', function() {{ b.remove(); }});
  }})();
  </script>
</body>
</html>
"""

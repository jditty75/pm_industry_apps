"""Render CSAT Overview V3 static HTML from fixture (format only — no computation)."""

from __future__ import annotations

import html
import json
import re
from typing import Any, Dict, List, Optional, Tuple

W_MARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1540 2000" width="24" height="24" aria-label="Workday"><g><g><path fill="#FFFFFF" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9,41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5,4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4-66.3,320.9-144.7,639.6-260.1,960.4-10,29.6-27.1,41.7-56.5,41.7Z"/><path fill="#FFFFFF" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9,149.1,0,289.2,58,394.4,163.3,54.8,54.8,96.6,118.9,124.3,188.7,6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7,27.5-69.7,69.2-133.7,123.7-188.3Z"/></g></g></svg>"""

LINK_TITLE = "Destination not built in this prototype"

STATE_ORDER = (
    "healthy",
    "concerns",
    "upcoming",
    "chase",
    "low_evidence",
    "slg",
    "partner",
    "clear",
)

INDEX_ENTRIES = [
    ("CSAT_OVERVIEW_V3_HEALTHY.html", "Healthy · primary review page"),
    ("CSAT_OVERVIEW_V3_CONCERNS.html", "Customer concerns present"),
    ("CSAT_OVERVIEW_V3_UPCOMING.html", "Heavy upcoming-survey month"),
    ("CSAT_OVERVIEW_V3_CHASE.html", "Several surveys need chasing"),
    ("CSAT_OVERVIEW_V3_LOW_EVIDENCE.html", "Weak / insufficient evidence"),
    ("CSAT_OVERVIEW_V3_SLG.html", "Low-volume SLG-like"),
    ("CSAT_OVERVIEW_V3_PARTNER.html", "Partner-led scope"),
    ("CSAT_OVERVIEW_V3_CLEAR.html", "No immediate actions"),
]


def esc(s: Any) -> str:
    return html.escape("" if s is None else str(s))


def load_fixture(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _arrow_hidden() -> str:
    return '<span aria-hidden="true">→</span>'


def _link_inner(text: str, with_arrow: bool = True) -> str:
    t = text.rstrip()
    if with_arrow and t.endswith("→"):
        core = t[:-1].rstrip()
        return f"{esc(core)} {_arrow_hidden()}"
    return esc(text)


def inert_link(
    text: str,
    href: str = "#",
    extra_class: str = "",
    role: str = "inline",
) -> str:
    """role: inline | primary | prose | entity"""
    classes = ["csat-v3-link"]
    if role == "primary":
        classes.append("csat-v3-link--drill-primary")
    elif role == "inline":
        classes.append("csat-v3-link--drill")
    elif role == "prose":
        classes.append("csat-v3-link--prose")
    elif role == "entity":
        classes.append("csat-v3-link--entity")
    if extra_class:
        classes.append(extra_class)
    cls = " ".join(classes)
    title = "" if role == "entity" else f' title="{esc(LINK_TITLE)}"'
    onclick = "" if role == "entity" else ' onclick="return false;"'
    return (
        f'<a href="{esc(href)}" class="{esc(cls)}"{title}{onclick} '
        f'tabindex="0">{_link_inner(text)}</a>'
    )


def working_link(text: str, href: str) -> str:
    return (
        f'<a href="{esc(href)}" class="csat-v3-link csat-v3-link--prose csat-v3-link--working" '
        f'tabindex="0">{esc(text)}</a>'
    )


def render_sentence_c(parts: List[Dict[str, str]]) -> str:
    bits = []
    for p in parts:
        if p["type"] == "text":
            bits.append(esc(p["text"]))
        elif p["type"] == "link":
            href = p.get("href", "#")
            if href == "#csat-v3-concerns":
                bits.append(working_link(p["text"], href))
            else:
                bits.append(inert_link(p["text"], href, role="prose"))
    return "".join(bits)


def render_status_pill(pill: str, severity: str) -> str:
    cls = "status-red" if severity == "red" else "status-yellow"
    return f'<span class="status-pill {cls}">{esc(pill)}</span>'


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


def render_csat_subnav(scope_menu: str) -> str:
    tabs = ("Overview", "Surveys", "Responses")
    btns = []
    for i, label in enumerate(tabs):
        active = i == 0
        btns.append(
            f'<button type="button" class="csat-subtab-btn{" active" if active else ""}" '
            f'role="tab" aria-selected="{"true" if active else "false"}" '
            f'tabindex="{"0" if active else "-1"}">{esc(label)}</button>'
        )
    return (
        '<div class="csat-v3-subnav-row">'
        '<nav class="csat-subtab-nav csat-v3-subnav" role="tablist" aria-label="CSAT sections">'
        + "".join(btns)
        + "</nav>"
        f'<button type="button" class="csat-v3-scope-btn" aria-haspopup="true" aria-expanded="false">'
        f'{esc(scope_menu)} <span class="csat-v3-caret" aria-hidden="true">▾</span></button>'
        "</div>"
    )


def render_r1(st: Dict[str, Any]) -> str:
    msg = st["message"]
    sid_b = "csat-v3-msg-b"
    parts_html = render_sentence_c(msg["sentenceCParts"])
    tier = st.get("messageInputs", {}).get("tier", "SUFFICIENT")
    anchor_cls = "csat-v3-anchor-figure"
    if tier in ("LIMITED", "INSUFFICIENT", "NONE"):
        anchor_cls += " csat-v3-anchor-figure--count"
    return (
        f'<section class="trends-section csat-v3-r1" data-csat-region="R1" aria-labelledby="csat-v3-r1-h">'
        '<h2 id="csat-v3-r1-h" class="sr-only">Customer satisfaction summary</h2>'
        '<div class="csat-v3-r1-inner">'
        f'<div class="csat-v3-r1-anchor" aria-hidden="false">'
        f'<span class="{anchor_cls}">{esc(msg["anchor"])}</span>'
        f'<span class="csat-v3-anchor-caption">{esc(msg["anchorCaption"])}</span>'
        "</div>"
        '<div class="csat-v3-r1-copy">'
        f'<p class="csat-v3-headline" id="csat-v3-msg-a" aria-describedby="{sid_b}">{esc(msg["sentenceA"])}</p>'
        f'<p class="csat-v3-msg-b" id="{sid_b}">{esc(msg["sentenceB"])}</p>'
        f'<p class="csat-v3-msg-c">{parts_html}</p>'
        "</div></div></section>"
    )


def _split_concern_detail(detail: str) -> Tuple[str, Optional[str]]:
    marker = " · Follow-up"
    if marker in detail:
        facts, tail = detail.split(marker, 1)
        return facts, "Follow-up" + tail
    return detail, None


def render_concern_row(row: Dict[str, Any]) -> str:
    tag = ""
    if row.get("tag"):
        tag = f'<span class="csat-v3-row-tag">{esc(row["tag"])}</span>'
    name = esc(row["name"])
    facts, follow = _split_concern_detail(row["detail"])
    follow_html = ""
    if follow:
        follow_html = f'<p class="csat-v3-concern-follow">{esc(follow)}</p>'
    return (
        '<div class="csat-v3-concern-row">'
        '<div class="csat-v3-concern-line1">'
        f'{render_status_pill(row["pill"], row["severity"])}'
        f'<a href="#" class="csat-v3-dep-name" title="{name}" onclick="return false;">{name}</a>'
        f'<span class="survey-pill">{esc(row["stage"])}</span>'
        f"{tag}"
        "</div>"
        f'<p class="csat-v3-concern-facts">{esc(facts)}</p>'
        f"{follow_html}"
        "</div>"
    )


def render_r2(st: Dict[str, Any]) -> str:
    c = st["concerns"]
    body = ""
    if c.get("empty"):
        body = (
            f'<div class="csat-v3-concerns-empty"><p>{esc(c["emptyPrimary"])}</p>'
            f'<p class="csat-v3-muted">{inert_link(c.get("emptyMuted", "")) if c.get("emptyMuted") else ""}</p>'
            f'<p class="csat-v3-muted">{inert_link(c.get("emptyMuted2", "")) if c.get("emptyMuted2") else ""}</p></div>'
        )
    else:
        rows = "".join(render_concern_row(r) for r in c.get("rows", []))
        more = ""
        if c.get("moreLink"):
            more = f'<p class="csat-v3-more-link">{inert_link(c["moreLink"], role="inline")}</p>'
        body = f'<div class="csat-v3-concern-rows">{rows}</div>{more}'
    footer = ""
    foot_bits: List[str] = []
    if c.get("footer"):
        foot_bits.append(f'<p class="csat-v3-region-footer-note">{esc(c["footer"])}</p>')
    if c.get("footerLink"):
        foot_bits.append(
            f'<p class="csat-v3-region-footer-link">{inert_link(c["footerLink"], role="primary")}</p>'
        )
    if foot_bits:
        footer = f'<div class="csat-v3-region-foot">{"".join(foot_bits)}</div>'
    return (
        f'<section class="trends-section csat-v3-r2" id="csat-v3-concerns" data-csat-region="R2" '
        f'aria-labelledby="csat-v3-r2-title">'
        '<p class="csat-v3-eyebrow">Respond · Follow up</p>'
        '<div class="csat-v3-region-head">'
        '<h2 class="trends-section-title" id="csat-v3-r2-title">Customer concerns</h2>'
        f'<span class="csat-v3-region-sub">{esc(c.get("subtitle", ""))}</span>'
        "</div>"
        f"{body}{footer}"
        "</section>"
    )


def _split_block_head(head: str) -> Tuple[str, str]:
    if " · " in head:
        label, value = head.split(" · ", 1)
        return label, value
    return head, ""


def _is_readiness_lead(text: str) -> bool:
    low = text.strip().lower()
    return "readiness issue" in low and not low.startswith("no ")


def _render_horizon_plain_line(line: Any, muted: bool = False) -> str:
    if isinstance(line, str):
        cls = "csat-v3-horizon-line"
        if muted:
            cls += " csat-v3-muted"
        return f'<p class="{cls}">{esc(line)}</p>'
    text = line.get("text", "")
    if line.get("link"):
        return f'<p class="csat-v3-horizon-line">{inert_link(text, role="inline")}</p>'
    if line.get("muted"):
        return f'<p class="csat-v3-horizon-line csat-v3-muted">{esc(text)}</p>'
    return f'<p class="csat-v3-horizon-line">{esc(text)}</p>'


def _render_prep_warning(lead: Optional[str], issues: List[Any], forecast_link: Optional[Any]) -> str:
    parts: List[str] = ['<div class="csat-v3-prep-warning">']
    if lead:
        parts.append(f'<p class="csat-v3-prep-lead">{esc(lead)}</p>')
    if issues:
        items = []
        for issue in issues:
            items.append(
                "<li>"
                f'{inert_link(issue["name"], role="entity")}'
                f' <span class="survey-pill">{esc(issue["stage"])}</span> '
                f'<span class="csat-v3-prep-reason">{esc(issue["reason"])}</span>'
                "</li>"
            )
        parts.append(f'<ul class="csat-v3-prep-list">{"".join(items)}</ul>')
    if forecast_link is not None:
        parts.append(_render_horizon_plain_line(forecast_link))
    parts.append("</div>")
    return "".join(parts)


def _prepare_by_row(
    value_text: str, warning: bool, secondary: bool, tail_html: str
) -> str:
    value_cls = "csat-v3-rail-value"
    if secondary:
        value_cls += " csat-v3-rail-value--secondary"
    warn_glyph = ""
    warn_cls = ""
    if warning:
        warn_glyph = '<span class="csat-v3-prep-warn-glyph" aria-hidden="true">⚠</span> '
        warn_cls = " csat-v3-rail-value--warn"
    return (
        '<div class="csat-v3-rail-row">'
        '<span class="csat-v3-rail-label">Prepare by</span>'
        '<div class="csat-v3-rail-content">'
        f'<p class="{value_cls}{warn_cls}">{warn_glyph}{esc(value_text)}</p>'
        f"{tail_html}"
        "</div></div>"
    )


def render_horizon_block(block: Dict[str, Any], block_index: int) -> str:
    head_label, head_value = _split_block_head(block["head"])
    is_primary = block_index == 0
    is_secondary = head_label.lower().startswith("following") or head_label.lower().startswith(
        "in flight"
    )

    value_cls = "csat-v3-rail-value"
    if is_primary and not is_secondary:
        value_cls += " csat-v3-rail-value--primary"
    elif is_secondary:
        value_cls += " csat-v3-rail-value--secondary"

    rows: List[str] = []
    body_lines: List[str] = []
    warning_lead: Optional[str] = None
    warning_issues: List[Any] = []
    forecast_line: Optional[Any] = None

    def flush_warning() -> str:
        nonlocal warning_lead, warning_issues, forecast_line
        if not (warning_lead or warning_issues or forecast_line is not None):
            return ""
        html = _render_prep_warning(warning_lead, warning_issues, forecast_line)
        warning_lead = None
        warning_issues = []
        forecast_line = None
        return html

    def close_body_row() -> None:
        nonlocal body_lines
        if not rows and (body_lines or head_value or head_label):
            value_bit = f'<p class="{value_cls}">{esc(head_value)}</p>' if head_value else ""
            muted = is_secondary
            lines_html = "".join(_render_horizon_plain_line(ln, muted=muted) for ln in body_lines)
            rows.append(
                '<div class="csat-v3-rail-row">'
                f'<span class="csat-v3-rail-label">{esc(head_label)}</span>'
                '<div class="csat-v3-rail-content">'
                f"{value_bit}{lines_html}"
                "</div></div>"
            )
            body_lines = []
        elif body_lines:
            muted = is_secondary
            lines_html = "".join(_render_horizon_plain_line(ln, muted=muted) for ln in body_lines)
            rows.append(
                '<div class="csat-v3-rail-row csat-v3-rail-row--body">'
                '<span class="csat-v3-rail-label" aria-hidden="true"></span>'
                f'<div class="csat-v3-rail-content">{lines_html}</div></div>'
            )
            body_lines = []

    lines = block.get("lines", [])
    for line in lines:
        if isinstance(line, dict) and line.get("issue"):
            warning_issues.append(line)
            continue
        if isinstance(line, dict) and line.get("emphasis"):
            close_body_row()
            text = line["text"]
            if text.startswith("Prepare by ") and line.get("warning"):
                warn_glyph = '<span class="csat-v3-prep-warn-glyph" aria-hidden="true">⚠</span> '
                tail = flush_warning()
                rows.append(
                    '<div class="csat-v3-rail-row csat-v3-rail-row--body">'
                    '<span class="csat-v3-rail-label" aria-hidden="true"></span>'
                    '<div class="csat-v3-rail-content">'
                    f'<p class="csat-v3-rail-value csat-v3-rail-value--warn">'
                    f"{warn_glyph}{esc(text)}</p>{tail}</div></div>"
                )
            elif text.startswith("Prepare by "):
                val = text[len("Prepare by ") :]
                tail = flush_warning()
                rows.append(
                    _prepare_by_row(val, bool(line.get("warning")), is_secondary, tail)
                )
            else:
                body_lines.append(line)
            continue
        if isinstance(line, str) and line.startswith("Prepare by "):
            close_body_row()
            val = line[len("Prepare by ") :]
            tail = flush_warning()
            rows.append(_prepare_by_row(val, False, is_secondary, tail))
            continue
        if isinstance(line, str) and _is_readiness_lead(line):
            close_body_row()
            warning_lead = line
            continue
        if isinstance(line, dict) and line.get("link") and "can't be forecast" in line.get("text", ""):
            close_body_row()
            forecast_line = line
            tail = flush_warning()
            if tail:
                rows.append(
                    '<div class="csat-v3-rail-row csat-v3-rail-row--body">'
                    '<span class="csat-v3-rail-label" aria-hidden="true"></span>'
                    f'<div class="csat-v3-rail-content">{tail}</div></div>'
                )
            forecast_line = None
            continue
        if warning_lead or warning_issues:
            if isinstance(line, str):
                body_lines.append(line)
            else:
                body_lines.append(line)
            continue
        body_lines.append(line)

    close_body_row()
    tail = flush_warning()
    if tail and rows and "Prepare by</span>" in rows[-1]:
        last = rows[-1]
        insert_at = last.rfind("</div></div>")
        if insert_at > 0:
            rows[-1] = last[:insert_at] + tail + last[insert_at:]
            tail = ""
    if tail:
        rows.append(
            '<div class="csat-v3-rail-row csat-v3-rail-row--body">'
            '<span class="csat-v3-rail-label" aria-hidden="true"></span>'
            f'<div class="csat-v3-rail-content">{tail}</div></div>'
        )

    mod = " csat-v3-horizon-block--primary" if is_primary and not is_secondary else ""
    if is_secondary:
        mod += " csat-v3-horizon-block--secondary"
    return f'<div class="csat-v3-horizon-block{mod}">{"".join(rows)}</div>'


def render_r3(st: Dict[str, Any]) -> str:
    h = st["horizon"]
    blocks = [
        render_horizon_block(block, i) for i, block in enumerate(h.get("blocks", []))
    ]
    footer = ""
    if h.get("footerLink"):
        footer = (
            f'<div class="csat-v3-region-foot">'
            f'<p class="csat-v3-region-footer-link">{inert_link(h["footerLink"], role="primary")}</p>'
            "</div>"
        )
    return (
        f'<section class="trends-section csat-v3-r3" data-csat-region="R3" aria-labelledby="csat-v3-r3-title">'
        '<p class="csat-v3-eyebrow">Prepare · Survey</p>'
        '<h2 class="trends-section-title" id="csat-v3-r3-title">Survey horizon</h2>'
        f'{"".join(blocks)}{footer}'
        "</section>"
    )


_FACT_KEY_RE = re.compile(
    r"^(?:[^:]+: )?([+\-−]?\d+(?:\.\d+)?%?(?: of \d+)?)"
)


def _emphasize_fact_key(text: str) -> str:
    m = _FACT_KEY_RE.match(text)
    if not m:
        return esc(text)
    key = m.group(1)
    start, end = m.span(1)
    return (
        f"{esc(text[:start])}<strong class=\"csat-v3-fact-key\">{esc(key)}</strong>"
        f"{esc(text[end:])}"
    )


def render_r4(st: Dict[str, Any], meta: Dict[str, Any]) -> str:
    facts = st["learn"]["facts"]
    cells = []
    for f in facts:
        text = f["text"]
        if f.get("linkTail"):
            if " · " in text:
                pre, tail = text.rsplit(" · ", 1)
                cell_text = (
                    f'{_emphasize_fact_key(pre.strip())} · {inert_link(tail.strip(), role="inline")}'
                )
            elif "→" in text:
                pre, _ = text.rsplit("→", 1)
                cell_text = f'{esc(pre.strip())} {inert_link("→", role="inline")}'
            else:
                cell_text = _emphasize_fact_key(text)
        else:
            cell_text = _emphasize_fact_key(text)
        cells.append(
            '<div class="csat-v3-learn-fact">'
            f'<div class="csat-v3-fact-label">{esc(f["label"])}</div>'
            f'<div class="csat-v3-fact-text">{cell_text}</div></div>'
        )
    disc = st.get("disclosure", {})
    table_rows = ""
    for i, row in enumerate(disc.get("rows", [])):
        if i == 0:
            table_rows += "<thead><tr>" + "".join(f"<th scope=\"col\">{esc(c)}</th>" for c in row) + "</tr></thead><tbody>"
        else:
            table_rows += "<tr>" + "".join(f"<td>{esc(c)}</td>" for c in row) + "</tr>"
    if table_rows:
        table_rows += "</tbody>"
    return (
        f'<section class="trends-section csat-v3-r4" data-csat-region="R4" aria-labelledby="csat-v3-r4-title">'
        '<p class="csat-v3-eyebrow">Learn</p>'
        '<h2 class="trends-section-title" id="csat-v3-r4-title">What customers are telling us</h2>'
        f'<div class="csat-v3-learn-grid">{"".join(cells)}</div>'
        '<details class="csat-v3-disclosure">'
        '<summary>Breakdown and method</summary>'
        f'<p class="csat-v3-method">{esc(meta.get("methodNote", ""))}</p>'
        f'<table class="csat-v3-breakdown-table">{table_rows}</table>'
        f'<p class="csat-v3-muted">{esc(disc.get("notes", ""))}</p>'
        "</details></section>"
    )


def render_state_page(st: Dict[str, Any], meta: Dict[str, Any]) -> str:
    shell = meta["shells"][st["shell"]]
    return (
        '<main class="container" id="csat-overview-v3-app">'
        + render_shell_start(shell, st.get("dataAsOf", "Oct 2026"))
        + render_csat_subnav(st["scopeMenu"])
        + '<div class="csat-v3-layout">'
        + render_r1(st)
        + '<div class="csat-v3-mid-row">'
        + render_r2(st)
        + render_r3(st)
        + "</div>"
        + render_r4(st, meta)
        + "</div></main>"
        + f'<div class="csat-v3-proto-badge" role="status">LOCAL PROTOTYPE · {esc(st["protoLabel"])} · '
        f'<a href="CSAT_OVERVIEW_V3_INDEX.html">All states</a></div>'
    )


def render_index() -> str:
    items = "".join(
        f'<li><a href="{esc(href)}">{esc(href.replace(".html", ""))}</a>'
        f'<span class="desc">{esc(desc)}</span></li>'
        for href, desc in INDEX_ENTRIES
    )
    return (
        '<div class="csat-v3-index">'
        "<h1>CSAT Overview V3 — visual prototype states</h1>"
        '<p>Localhost only. Start with <a href="CSAT_OVERVIEW_V3_HEALTHY.html">Healthy</a>.</p>'
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
<body data-csat-overview-v3-prototype="true">
  {body}
  <script type="application/json" id="csat-overview-v3-fixture">{fixture_json}</script>
</body>
</html>
"""


def validate_message_inputs(st: Dict[str, Any]) -> None:
    """Self-test helper: check A/C against messageInputs (prototype rules)."""
    mi = st.get("messageInputs", {})
    msg = st["message"]
    a = msg["sentenceA"].lower()
    tier = mi.get("tier", "SUFFICIENT")
    n = mi.get("n", 0)
    t2b = mi.get("t2b")

    if tier == "SUFFICIENT":
        if t2b is not None:
            if t2b >= 80:
                sat = "strong"
            elif t2b >= 65:
                sat = "mixed"
            else:
                sat = "concerning"
            if mi.get("satisfactionWord") and mi["satisfactionWord"] != sat:
                raise ValueError(f"satisfaction word mismatch for {st['file']}")
            if sat in a and mi.get("directionWord"):
                dw = mi["directionWord"]
                if dw and dw not in a and "unclear" not in a:
                    if dw == "stable" and "stable" not in a:
                        raise ValueError(f"direction missing in A for {st['file']}")
    order = mi.get("clauseOrder", "")
    c_plain = " ".join(
        p.get("text", p.get("text", "")) if p["type"] == "text" else p["text"]
        for p in msg["sentenceCParts"]
    ).lower()
    if order == "time_critical_then_concern":
        if "preparation closes" in c_plain or "need chasing" in c_plain or "open surveys" in c_plain:
            pass
        else:
            raise ValueError(f"time-critical C expected for {st['file']}")
    if "concern" not in c_plain and "concerns" not in c_plain:
        if "no customer concerns" not in c_plain:
            raise ValueError(f"concern clause missing in C for {st['file']}")

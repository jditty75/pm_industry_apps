"""Render Responses view for integrated CSAT prototype."""

from __future__ import annotations

from typing import Any, Dict, List

from csat_shared import (
    esc,
    render_deployment_link,
    render_followup_facet,
    render_nps,
    render_provenance_block,
    render_survey_tag,
    render_top2box,
    render_verdict_chip,
    render_attention_marker,
    render_csat_row,
)


def render_learning_strip(learn: Dict[str, Any], low_volume: bool) -> str:
    if low_volume and learn.get("lowVolumeLine"):
        inner = f'<p class="csat-ix-learn-collapse">{esc(learn["lowVolumeLine"])}</p>'
        return f'<section class="csat-ix-learn" data-csat-region="RESP_LEARN">{inner}</section>'
    facts = []
    for f in learn.get("facts", []):
        facts.append(
            f'<button type="button" class="csat-ix-learn-fact csat-drilldown-link" data-filter="{esc(f.get("filterKey", ""))}">'
            f'<span class="csat-ix-learn-label">{esc(f["label"])}</span>'
            f'<span class="csat-ix-learn-value">{esc(f["value"])}</span></button>'
        )
    return (
        f'<section class="csat-ix-learn" data-csat-region="RESP_LEARN" aria-label="Portfolio learning">'
        f'<div class="csat-ix-learn-strip">{"".join(facts)}</div></section>'
    )


def render_filter_bar(filters: Dict[str, Any]) -> str:
    primary = filters.get("primary", [])
    chips = []
    for c in primary:
        pressed = "true" if c.get("active") else "false"
        chips.append(
            f'<button type="button" class="filter-chip csatFilterBar-chip" aria-pressed="{pressed}" '
            f'data-filter="{esc(c.get("key", ""))}">{esc(c["label"])}</button>'
        )
    adv = filters.get("advancedLabel", "More filters")
    active_adv = filters.get("activeAdvanced", [])
    adv_chips = "".join(
        f'<button type="button" class="filter-chip is-removable" data-filter="{esc(a["key"])}">'
        f'{esc(a["label"])} ×</button>'
        for a in active_adv
    )
    return (
        '<div class="csat-ix-scope-bar csatFilterBar" data-csat-region="RESP_SCOPE">'
        '<div class="csat-ix-primary-filters">'
        f'{"".join(chips)}'
        f'<button type="button" class="filter-drawer-toggle csat-ix-advanced-toggle" '
        f'aria-expanded="false">{esc(adv)}</button>'
        f'{adv_chips}'
        "</div></div>"
    )


def _evidence_markers(row: Dict[str, Any]) -> str:
    bits = []
    if row.get("hasCustomerComment"):
        bits.append('<span class="csat-evidence-marker" title="Customer comment (T2)">✎</span>')
    if row.get("hasQualtricsAnalysis"):
        bits.append('<span class="csat-evidence-marker csat-evidence-marker--qx" title="Qualtrics analysis">◇</span>')
    return "".join(bits)


def render_response_row(row: Dict[str, Any], expanded: bool = False) -> str:
    att = row.get("attention", {})
    marker = render_attention_marker(att.get("kind", ""), att.get("label", ""), att.get("severity", "neutral"))
    name = render_deployment_link(row["deployment"], row["deploymentId"])
    tag = render_survey_tag(row["survey"])
    verdict = ""
    if row.get("verdict"):
        v = row["verdict"]
        verdict = render_verdict_chip(v["label"], v.get("severity", "yellow"))
    key_parts = [esc(row.get("keyFact", ""))]
    if row.get("followup"):
        key_parts.append(render_followup_facet(row["followup"]))
    key_html = " · ".join(p for p in key_parts if p)
    evidence = _evidence_markers(row)
    date_html = f'<span class="csat-survey-date">{esc(row.get("surveyDate", ""))}</span>'
    data = f'data-row-id="{esc(row.get("rowId", ""))}" data-expandable="{"true" if row.get("expandable") else "false"}"'
    row_html = render_csat_row(marker, name, tag, verdict, key_html, evidence, date_html, data_attrs=data)
    panel = ""
    if expanded and row.get("evidence"):
        panel = render_evidence_panel(row["evidence"], row.get("respondentRole", "Deployment contact"))
    elif row.get("expandable"):
        panel = f'<div class="csat-ix-evidence-panel" id="evidence-{esc(row.get("rowId", ""))}" hidden></div>'
    return row_html + panel


def render_evidence_panel(evidence: Dict[str, Any], role: str) -> str:
    blocks = []
    for field in evidence.get("customerComments", []):
        body = f'<p class="csat-ix-comment-q">{esc(field["question"])}</p><p>{esc(field["text"])}</p>'
        body += f'<p class="csat-ix-comment-role">Respondent role: {esc(role)}</p>'
        blocks.append(render_provenance_block("customer", "Customer comment", body))
    qx = evidence.get("qualtrics", {})
    if qx:
        chips = []
        if qx.get("sentiment"):
            chips.append(f'<span class="csat-qx-chip">{esc(qx["sentiment"])}</span>')
        for t in qx.get("parentTopics", []):
            chips.append(f'<span class="csat-qx-chip">{esc(t)}</span>')
        body = f'<div class="csat-qx-chips">{"".join(chips)}</div>'
        if qx.get("note"):
            body += f'<p class="csat-ix-muted">{esc(qx["note"])}</p>'
        blocks.append(render_provenance_block("qualtrics", "Qualtrics analysis", body))
    return (
        f'<div class="csat-ix-evidence-panel csat-ix-evidence-panel--open" data-csat-region="RESP_EVIDENCE">'
        f'{"".join(blocks)}</div>'
    )


def render_group_by(active: str) -> str:
    options = ("Deployment", "Survey", "Response")
    btns = []
    for opt in options:
        sel = "true" if opt.lower() == active.lower() else "false"
        btns.append(
            f'<button type="button" class="csat-ix-group-btn" aria-pressed="{sel}" '
            f'data-group="{esc(opt.lower())}">{esc(opt)}</button>'
        )
    return (
        '<div class="csat-ix-group-by" role="group" aria-label="Group by">'
        '<span class="csat-ix-group-label">Group by</span>'
        f'{"".join(btns)}</div>'
    )


def render_responses_page(st: Dict[str, Any], app_label: str) -> str:
    low = st.get("lowVolume", False)
    learn = render_learning_strip(st["learning"], low)
    filters = render_filter_bar(st.get("filters", {}))
    group = render_group_by(st.get("groupBy", "survey"))
    rows = "".join(
        render_response_row(r, expanded=r.get("expanded", False)) for r in st.get("rows", [])
    )
    overflow = ""
    if st.get("overflowMore"):
        overflow = f'<p class="csat-ix-overflow">{esc(st["overflowMore"])}</p>'
    lens = st.get("lensNote", "")
    lens_html = f'<p class="csat-ix-lens-note">{esc(lens)}</p>' if lens else ""
    t2 = st.get("accessTier", "T1")
    return (
        f'<div class="csat-ix-responses" data-csat-page="responses" data-access-tier="{esc(t2)}">'
        f"{filters}{learn}{lens_html}"
        f'<section data-csat-region="RESP_LIST" class="csat-ix-list-section">'
        f'<div class="csat-ix-list-head">{group}'
        f'<span class="csat-ix-list-summary">{esc(st.get("listSummary", ""))}</span></div>'
        f'<div class="csat-ix-rowlist">{rows}{overflow}</div></section></div>'
    )

"""Render Deployment CSAT History (routed workspace)."""

from __future__ import annotations

from typing import Any, Dict, List

from csat_shared import (
    esc,
    render_followup_facet,
    render_nps,
    render_provenance_block,
    render_survey_tag,
    render_verdict_chip,
)


def render_delivery_rating_chip(label: str, value: str) -> str:
    return (
        f'<span class="csatDeliveryRating csat-delivery-rating">'
        f'{esc(label)}: {esc(value)}</span>'
    )


def render_facet_header(facets: List[Dict[str, str]]) -> str:
    cells = []
    for f in facets:
        cells.append(
            f'<div class="csat-ix-dep-facet"><span class="csat-ix-dep-facet-label">{esc(f["label"])}</span>'
            f'<span class="csat-ix-dep-facet-value">{esc(f["value"])}</span></div>'
        )
    return f'<header class="csat-ix-dep-facets">{"".join(cells)}</header>'


def render_timeline_event(ev: Dict[str, Any]) -> str:
    kind = ev.get("kind", "history")
    kind_cls = f"csat-ix-timeline-event--{kind}"
    title = ev.get("title", "")
    body = ev.get("body", "")
    body_html = ""
    if isinstance(body, list):
        body_html = "".join(f"<p>{esc(line)}</p>" if isinstance(line, str) else str(line) for line in body)
    else:
        body_html = f"<p>{esc(body)}</p>"
    extra = ""
    if ev.get("verdict"):
        v = ev["verdict"]
        extra += render_verdict_chip(v["label"], v.get("severity", "yellow"))
    if ev.get("survey"):
        extra += render_survey_tag(ev["survey"])
    if ev.get("nps"):
        extra += render_nps(ev["nps"])
    if ev.get("deliveryRatings"):
        extra += " ".join(
            render_delivery_rating_chip(dr["label"], dr["value"]) for dr in ev["deliveryRatings"]
        )
    if ev.get("followup"):
        extra += render_followup_facet(ev["followup"])
    meta_block = f'<div class="csat-ix-timeline-meta">{extra}</div>' if extra else ""
    if ev.get("evidence"):
        evd = ev["evidence"]
        if evd.get("customerComments"):
            for c in evd["customerComments"]:
                body_html += render_provenance_block(
                    "customer",
                    "Customer comment",
                    f'<p><strong>{esc(c.get("question", ""))}</strong></p><p>{esc(c.get("text", ""))}</p>'
                    f'<p class="csat-ix-comment-role">Respondent role: {esc(evd.get("role", "Deployment contact"))}</p>',
                )
        if evd.get("qualtrics"):
            qx = evd["qualtrics"]
            chips = "".join(f'<span class="csat-qx-chip">{esc(t)}</span>' for t in qx.get("parentTopics", []))
            if qx.get("sentiment"):
                chips += f'<span class="csat-qx-chip">{esc(qx["sentiment"])}</span>'
            body_html += render_provenance_block("qualtrics", "Qualtrics analysis", f'<div>{chips}</div>')
    actions = ""
    if ev.get("actions"):
        links = []
        for a in ev["actions"]:
            links.append(f'<a class="csat-drilldown-link" href="{esc(a["href"])}">{esc(a["label"])} →</a>')
        actions = f'<div class="csat-ix-dep-actions">{"".join(links)}</div>'
    return (
        f'<article class="csat-ix-timeline-event {kind_cls}" data-event-kind="{esc(kind)}">'
        f'<time class="csat-ix-timeline-date">{esc(ev.get("date", ""))}</time>'
        f'<div class="csat-ix-timeline-body">'
        f'<h3 class="csat-ix-timeline-title">{esc(title)}</h3>'
        f"{meta_block}{body_html}{actions}</div></article>"
    )


def render_deployment_history(st: Dict[str, Any], breadcrumb_origin: str) -> str:
    facets = render_facet_header(st.get("facets", []))
    timeline = "".join(render_timeline_event(ev) for ev in st.get("timeline", []))
    out_links = ""
    if st.get("outLinks"):
        out_links = '<nav class="csat-ix-dep-outlinks">' + " · ".join(
            f'<a href="{esc(l["href"])}" class="csat-drilldown-link">{esc(l["label"])} →</a>'
            for l in st["outLinks"]
        ) + "</nav>"
    return (
        f'<div class="csat-ix-deployment" data-csat-page="deployment" data-deployment-id="{esc(st["deploymentId"])}">'
        f'<nav class="csat-ix-breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{esc(breadcrumb_origin)}" class="csat-drilldown-link">← Back</a>'
        f'<span class="csat-ix-breadcrumb-sep">/</span>'
        f'<span>{esc(st["deploymentName"])}</span>'
        f'<span class="csat-ix-breadcrumb-sep">/</span><span>CSAT history</span></nav>'
        f'<h1 class="csat-ix-dep-title">{esc(st["deploymentName"])}</h1>'
        f'<p class="csat-ix-dep-account">{esc(st.get("account", ""))}</p>'
        f"{facets}"
        f'<section class="csat-ix-timeline" aria-label="Chronological CSAT story">{timeline}</section>'
        f"{out_links}</div>"
    )

"""Shared CSAT prototype render helpers (integrated subsystem)."""

from __future__ import annotations

import html
from typing import Any, Dict, List, Optional


def esc(s: Any) -> str:
    return html.escape("" if s is None else str(s))


def render_verdict_chip(label: str, severity: str) -> str:
    cls = "status-red" if severity == "red" else "status-yellow"
    return f'<span class="csat-verdict-chip status-pill {cls}">{esc(label)}</span>'


def render_survey_tag(survey_type: str) -> str:
    return f'<span class="csat-survey-tag">{esc(survey_type)}</span>'


def render_deployment_link(name: str, dep_id: str, extra_class: str = "") -> str:
    cls = f"csat-deployment-link {extra_class}".strip()
    return (
        f'<a href="#/deployment/{esc(dep_id)}/csat" class="{esc(cls)}" title="{esc(name)}">'
        f'{esc(name)} <span aria-hidden="true">→</span></a>'
    )


def render_attention_marker(kind: str, label: str = "", severity: str = "neutral") -> str:
    if kind == "detractor" and label:
        return render_verdict_chip(label, severity)
    if kind == "prep" and label:
        return (
            f'<span class="csat-attention-marker csat-attention-marker--amber" role="status">'
            f'<span class="csat-attention-rule" aria-hidden="true"></span>{esc(label)}</span>'
        )
    if label:
        return f'<span class="csat-attention-marker csat-attention-marker--plain">{esc(label)}</span>'
    return '<span class="csat-attention-marker csat-attention-marker--plain" aria-hidden="true"></span>'


def render_provenance_block(block_type: str, title: str, body_html: str) -> str:
    type_label = {
        "customer": "Customer comment",
        "qualtrics": "Qualtrics analysis",
        "ai": "AI-generated",
    }.get(block_type, title)
    return (
        f'<div class="csatProvenanceBlock csat-provenance-block" data-provenance="{esc(block_type)}">'
        f'<p class="csat-provenance-label">{esc(type_label)}</p>'
        f'<div class="csat-provenance-body">{body_html}</div></div>'
    )


def _row_status_html(verdict_html: str, attention_html: str) -> str:
    """Single inline status slot: verdict chip or attention label, not both columns."""
    if verdict_html and verdict_html.strip():
        return verdict_html.strip()
    if not attention_html or not attention_html.strip():
        return ""
    if 'aria-hidden="true"' in attention_html and "status-pill" not in attention_html:
        return ""
    return attention_html.strip()


def render_csat_row(
    name_html: str,
    tag_html: str = "",
    status_html: str = "",
    key_html: str = "",
    evidence_html: str = "",
    date_html: str = "",
    extra_class: str = "",
    data_attrs: str = "",
) -> str:
    """Deployment-anchored worklist row (two-line body + trailing date)."""
    tag_bit = tag_html.strip() if tag_html else ""
    status_bit = status_html.strip() if status_html else ""
    meta_inner = ""
    if tag_bit:
        meta_inner += tag_bit
    if status_bit:
        meta_inner += f'<span class="csat-row-status">{status_bit}</span>'
    meta_block = f'<span class="csat-row-meta">{meta_inner}</span>' if meta_inner else ""
    line1 = (
        f'<div class="csat-row-line1">'
        f'<span class="csat-row-name">{name_html}</span>{meta_block}</div>'
    )
    line2 = ""
    key_bit = key_html.strip() if key_html else ""
    ev_bit = evidence_html.strip() if evidence_html else ""
    if key_bit or ev_bit:
        line2 = (
            f'<div class="csat-row-line2">'
            f'<span class="csat-row-key">{key_bit}</span>'
            f'<span class="csat-row-evidence">{ev_bit}</span></div>'
        )
    cls = f"csat-row {extra_class}".strip()
    attrs = data_attrs.strip()
    open_tag = f'<div class="{cls}"{(" " + attrs) if attrs else ""}>'
    return (
        f"{open_tag}"
        f'<div class="csat-row-body">{line1}{line2}</div>'
        f'<span class="csat-row-date">{date_html}</span>'
        "</div>"
    )


def render_top2box(figure: str, caption: str = "rated 4 or 5 (Top-2 Box)") -> str:
    return (
        f'<span class="csatTopToBox csat-top2box">{esc(figure)}</span>'
        f'<span class="csat-top2box-caption">{esc(caption)}</span>'
    )


def render_nps(text: str) -> str:
    return f'<span class="csatNps csat-nps">{esc(text)}</span>'


def render_followup_facet(text: str) -> str:
    return f'<span class="csatFollowupFacet csat-followup-facet">{esc(text)}</span>'

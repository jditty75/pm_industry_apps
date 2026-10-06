"""Stage-2 portfolio compression harness — deterministic artifacts only (no LLM)."""

from __future__ import annotations

import hashlib
import html
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .context_assembler import SCHEMA_VERSION
from .data_stewardship import (
    LANE_PLATFORM,
    LANE_STEWARDSHIP,
    compute_stewardship_deployment_populations,
    scan_portfolio_stewardship,
    stewardship_for_deployment,
)
from .portfolio_harness import privacy_scan_text
from .stage1_ingest import CANDIDATE_SCHEMA_VERSION, EXPECTED_CANDIDATE_COUNT

STAGE2_INSTRUCTION = """You are reviewing candidate Signals from the complete deployment portfolio.

Stage 1 intentionally used a lower threshold to identify individually interesting candidates.

Your task now is relative portfolio attention compression.

Compare candidates against one another.

Retain only conditions that materially deserve senior leadership awareness relative to the rest of the portfolio.

Do not retain a candidate merely because Stage 1 surfaced it.

Do not target a predetermined number of Signals.

If only a few materially deserve leadership attention, return only those.

Separate Deployment Intelligence from Data Stewardship.

A data-quality condition does not automatically become a leadership Deployment Signal.

A deployment may have both.

Current Red/Yellow health alone is insufficient reason to retain a Signal.

Current Green alone is insufficient reason to discard one.

Prefer information that adds material insight beyond current health/status alone.

Respect evidence quality and platform/source limitations.

Preserve meaningful recovery/stabilization.

Do not predict failure, escalation, or missed production.

Use leadership questions rather than unsupported prescriptions.

Separate Deployment Intelligence from Data Stewardship in your analysis.
Post-reasoning normalization will structure outputs; prioritize reasoning quality over storage-shaped prose."""

STAGE2_OUTPUT_CONTRACT_LEGACY = """
STAGE 2 OUTPUT CONTRACT (required sections)
-----------------------------------------
Portfolio:
- deployments evaluated
- Stage-1 candidates reviewed
- Deployment Intelligence Signals retained
- Stage-1 candidates compressed out
- Data Stewardship deployment population (distinct deployments)
- Platform Evidence Limitation population (distinct deployments)

Deployment Intelligence (omit empty groups):
LEADERSHIP ATTENTION | WATCH / EMERGING | IMPROVING / STABILIZING | INFORMATIONAL
Per retained Signal: Deployment, Attention, Signal Type, Observation, Interpretation,
Incremental Value Beyond Current Health, Why This Matters, Leadership Question, Confidence,
Evidence Limitations, Data Stewardship condition present: yes/no

Data Stewardship (separate): BLOCKING | REVIEW | ADVISORY
Material conditions: Deployment, condition, deterministic evidence, why reliable system-of-record data matters,
review target without assigning blame.

Compressed Stage-1 candidates: deployment, Stage-1 category, one-line reason it did not merit portfolio-level leadership attention.

NOTE (pilot): This embedded contract was rejected by Sana as over-prescriptive. Superseded by
docs/architecture/services-signal-platform/ai-reasoning-contract.md — retained only for audit reproduction.
"""

STAGE2_REASONING_POINTER = (
    "Follow the Deployment Signals Pilot agent instructions plus "
    "docs/architecture/services-signal-platform/ai-reasoning-contract.md "
    "(role, objective, evidence, guardrails). Do not treat embedded output rubrics as authoritative."
)


def load_packets_jsonl(jsonl_path: Path) -> List[Dict[str, Any]]:
    packets: List[Dict[str, Any]] = []
    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            packets.append(json.loads(line))
    packets.sort(key=lambda p: str((p.get("metadata") or {}).get("deployment_id", "")))
    return packets


def packets_by_id(packets: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for p in packets:
        dep = str((p.get("metadata") or {}).get("deployment_id", "")).strip()
        if dep:
            out[dep] = p
    return out


def compact_context_for_stage2(packet: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic comparative context — not full trace dump."""
    meta = packet.get("metadata") or {}
    cs = packet.get("current_state") or {}
    ht = packet.get("health_trajectory") or {}
    st = packet.get("schedule_trajectory") or {}
    pf = packet.get("product_function") or {}
    iv = packet.get("intervention") or {}
    eq = packet.get("evidence_quality") or {}
    return {
        "deployment_id": meta.get("deployment_id"),
        "deployment_label": meta.get("deployment_label"),
        "current_health": cs.get("current_health"),
        "deployment_stage": cs.get("deployment_stage"),
        "current_mtp": cs.get("current_mtp"),
        "days_relative_to_mtp": cs.get("days_relative_to_mtp"),
        "mtp_analysis_grain": cs.get("mtp_analysis_grain"),
        "health_summary": {
            "previous_historized_health": ht.get("previous_historized_health"),
            "days_since_last_historized_health_change": ht.get(
                "days_since_last_historized_health_change"
            ),
            "deteriorations_recent_90d": ht.get("deteriorations_recent_90d"),
            "improvements_recent_90d": ht.get("improvements_recent_90d"),
            "reconciliation": ht.get("reconciliation"),
            "selected_events": (ht.get("selected_events") or [])[-4:],
        },
        "schedule_summary": {
            "recent_90d": st.get("recent_90d"),
            "lifetime": st.get("lifetime"),
            "parent_reconciliation_status": st.get("parent_reconciliation_status"),
            "selected_events": (st.get("selected_events") or [])[-4:],
        },
        "product_function": {
            "product_function_count": pf.get("product_function_count"),
            "functions_completed": pf.get("functions_completed"),
            "functions_remaining": pf.get("functions_remaining"),
            "product_function_rollup_reconciled": pf.get("product_function_rollup_reconciled"),
            "product_function_target_history_available": pf.get(
                "product_function_target_history_available"
            ),
            "functions_late_vs_final_target_count": pf.get("functions_late_vs_final_target_count"),
        },
        "intervention_summary": {
            "has_open_health_plan": iv.get("has_open_health_plan"),
            "action_history_count": iv.get("action_history_count"),
            "days_since_action_history_update": iv.get("days_since_action_history_update"),
            "action_history_latest_health_status": iv.get("action_history_latest_health_status"),
            "selected_narratives": iv.get("selected_narratives"),
        },
        "evidence_quality": {
            "classification": eq.get("classification"),
            "factors": eq.get("factors"),
            "unavailable_evidence": eq.get("unavailable_evidence"),
        },
    }


def enrich_candidates(
    candidates: List[Dict[str, Any]], packets_by_id: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    enriched: List[Dict[str, Any]] = []
    for cand in candidates:
        dep_id = cand["identity"]["deployment_id"]
        pkt = packets_by_id[dep_id]
        stew = stewardship_for_deployment(pkt)
        row = dict(cand)
        row["deterministic_context"] = compact_context_for_stage2(pkt)
        row["data_stewardship"] = stew
        enriched.append(row)
    return enriched


def portfolio_stage2_payload(
    candidates: List[Dict[str, Any]],
    packets: List[Dict[str, Any]],
    stage1_manifest: Dict[str, Any],
    stewardship_summary: Optional[Dict[str, Any]] = None,
    stewardship_deployment_populations: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    packets_by_id_map = packets_by_id(packets)
    enriched = enrich_candidates(candidates, packets_by_id_map)
    for cand in enriched:
        for raw in candidates:
            if raw["identity"]["deployment_id"] == cand["identity"]["deployment_id"]:
                if raw.get("stage1_provenance"):
                    cand["stage1_provenance"] = raw["stage1_provenance"]
                break
    health_dist: Dict[str, int] = {}
    stage_dist: Dict[str, int] = {}
    eq_dist: Dict[str, int] = {}
    for c in enriched:
        ctx = c.get("deterministic_context") or {}
        h = str(ctx.get("current_health") or "UNKNOWN")
        s = str(ctx.get("deployment_stage") or "UNKNOWN")
        health_dist[h] = health_dist.get(h, 0) + 1
        stage_dist[s] = stage_dist.get(s, 0) + 1
        eq = str((ctx.get("evidence_quality") or {}).get("classification") or "UNKNOWN")
        eq_dist[eq] = eq_dist.get(eq, 0) + 1

    evaluated = len(packets)
    n_cand = len(enriched)
    no_signal = evaluated - n_cand
    compression_rate = round((no_signal / evaluated) * 100, 1) if evaluated else 0.0
    baseline = stage1_manifest.get("stage1_portfolio_baseline") or {}

    return {
        "schema_version": "deployment-signal-stage2-input-v1",
        "portfolio_context": {
            "deployments_evaluated": evaluated,
            "stage1_candidates": n_cand,
            "stage1_no_signal": no_signal,
            "stage1_compression_rate_percent": compression_rate,
            "stage1_portfolio_baseline": baseline,
            "context_schema": SCHEMA_VERSION,
            "candidate_schema": CANDIDATE_SCHEMA_VERSION,
            "stage1_ingest": stage1_manifest,
            "candidate_health_distribution": health_dist,
            "candidate_stage_distribution": stage_dist,
            "candidate_evidence_quality_distribution": eq_dist,
            "stewardship_condition_summary": stewardship_summary,
            "stewardship_deployment_populations": stewardship_deployment_populations,
            "evidence_depth_note": (
                "Product Function target-date history is unavailable platform-wide in the current extract. "
                "Distinguish PLATFORM_EVIDENCE_LIMITATION from DEPLOYMENT_DATA_STEWARDSHIP in reasoning."
            ),
        },
        "stage2_instruction": STAGE2_INSTRUCTION,
        "stage2_reasoning_pointer": STAGE2_REASONING_POINTER,
        "candidates": enriched,
    }


def render_stage2_sana_input(payload: Dict[str, Any], include_legacy_contract: bool = False) -> str:
    lines = [
        "SANA DEPLOYMENT SIGNALS PILOT — STAGE 2 PORTFOLIO COMPRESSION",
        f"Schema: {payload.get('schema_version')}",
        "",
        payload["stage2_instruction"],
        "",
        payload.get("stage2_reasoning_pointer") or STAGE2_REASONING_POINTER,
        "",
    ]
    if include_legacy_contract and payload.get("stage2_output_contract_legacy"):
        lines.extend([payload["stage2_output_contract_legacy"], ""])
    lines.extend([
        "PORTFOLIO CONTEXT",
        "-----------------",
        json.dumps(payload["portfolio_context"], indent=2, ensure_ascii=False),
        "",
        "STAGE-1 NORMALIZED CANDIDATES (with deterministic context)",
        "-----------------------------------------------------------",
        json.dumps(payload["candidates"], indent=2, ensure_ascii=False),
        "",
    ])
    return "\n".join(lines)


def validate_stage2_payload(payload: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    pc = payload.get("portfolio_context") or {}
    if pc.get("deployments_evaluated") != 184:
        errors.append("deployments_evaluated must be 184 for SLG pilot")
    if pc.get("stage1_candidates") != EXPECTED_CANDIDATE_COUNT:
        errors.append(f"stage1_candidates must be {EXPECTED_CANDIDATE_COUNT}")
    if not payload.get("stage2_reasoning_pointer"):
        errors.append("stage2_reasoning_pointer missing")
    for cand in payload.get("candidates") or []:
        if cand.get("schema_version") != CANDIDATE_SCHEMA_VERSION:
            errors.append("candidate schema_version mismatch")
            break
        if "deterministic_context" not in cand:
            errors.append("candidate missing deterministic_context")
            break
    return errors


def _esc(v: Any) -> str:
    return html.escape(str(v if v is not None else ""))


def render_stage2_candidate_review_html(
    candidates: List[Dict[str, Any]], manifest: Dict[str, Any]
) -> str:
    parts = [
        "<!DOCTYPE html><html><head><meta charset='utf-8'>",
        "<title>Stage-2 Candidate Review (local only)</title>",
        "<style>body{font-family:Segoe UI,sans-serif;max-width:1200px;margin:20px auto;line-height:1.4}"
        "pre{background:#f6f6f6;padding:10px;overflow:auto;font-size:12px}"
        ".card{border:1px solid #ccc;margin:16px 0;padding:12px;border-radius:6px}"
        ".tag{background:#eee;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px}"
        "h1,h2{color:#333}</style></head><body>",
        "<h1>Stage-2 Candidate Review</h1>",
        f"<p>Normalized candidates: <strong>{len(candidates)}</strong>. "
        "Inspect before pasting Stage-2 Sana input.</p>",
        f"<pre>{_esc(json.dumps(manifest, indent=2))}</pre>",
    ]
    for cand in candidates:
        ident = cand.get("identity") or {}
        assess = cand.get("stage1_assessment") or {}
        ctx = cand.get("deterministic_context") or {}
        stew = cand.get("data_stewardship") or {}
        parts.append("<div class='card'>")
        parts.append(
            f"<h2>{_esc(ctx.get('deployment_label'))} "
            f"<span class='tag'>{_esc(ident.get('deployment_id'))}</span></h2>"
        )
        parts.append(
            f"<p><span class='tag'>Attention: {_esc(assess.get('attention'))}</span>"
            f"<span class='tag'>Type: {_esc(assess.get('signal_type'))}</span>"
            f"<span class='tag'>Health: {_esc(ctx.get('current_health'))}</span>"
            f"<span class='tag'>Stage: {_esc(ctx.get('deployment_stage'))}</span>"
            f"<span class='tag'>EQ: {_esc((ctx.get('evidence_quality') or {}).get('classification'))}</span></p>"
        )
        prov = cand.get("stage1_provenance") or {}
        if prov:
            parts.append("<h3>Cumulative report provenance</h3><pre>")
            parts.append(_esc(json.dumps(prov, indent=2)))
            parts.append("</pre>")
            conflicts = prov.get("assessment_conflicts") or []
            if conflicts:
                parts.append("<p><strong>Assessment changes:</strong></p><pre>")
                parts.append(_esc(json.dumps(conflicts, indent=2)))
                parts.append("</pre>")
        if stew.get("has_stewardship"):
            parts.append("<p><strong>Data Stewardship (system-of-record review):</strong></p><ul>")
            for row in stew.get("deployment_data_stewardship") or []:
                parts.append(
                    f"<li>{_esc(row.get('impact_classification'))}: "
                    f"{_esc(row.get('condition_code'))} — {_esc(row.get('observation'))}</li>"
                )
            parts.append("</ul>")
        if stew.get("has_platform_limitation"):
            parts.append("<p><strong>Platform evidence limitations:</strong></p><ul>")
            for row in stew.get("platform_evidence_limitations") or []:
                parts.append(
                    f"<li>{_esc(row.get('condition_code'))} — {_esc(row.get('observation'))}</li>"
                )
            parts.append("</ul>")
        parts.append("<h3>Canonical Stage-1 assessment</h3><pre>")
        parts.append(_esc(json.dumps(assess, indent=2)))
        parts.append("</pre><h3>Deterministic context (Stage-2 payload)</h3><pre>")
        parts.append(_esc(json.dumps(ctx, indent=2)))
        parts.append("</pre></div>")
    parts.append("</body></html>")
    return "".join(parts)


def render_stewardship_review_html(
    rows: List[Dict[str, Any]],
    candidate_ids: set,
    summary: Dict[str, Any],
    deployment_populations: Optional[Dict[str, Any]] = None,
) -> str:
    pop = deployment_populations or {}
    parts = [
        "<!DOCTYPE html><html><head><meta charset='utf-8'>",
        "<title>Data Stewardship Review (local only)</title>",
        "<style>body{font-family:Segoe UI,sans-serif;margin:20px;max-width:1400px;line-height:1.4}"
        "table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0}"
        "th,td{border:1px solid #ccc;padding:6px;vertical-align:top}"
        "tr.stew{background:#fff8e6}tr.plat{background:#eef6ff}"
        ".stew-banner{background:#b45309;color:#fff;padding:12px;border-radius:6px}"
        ".plat-banner{background:#1d4ed8;color:#fff;padding:12px;border-radius:6px;margin-top:24px}"
        "h2{margin-top:28px}</style></head><body>",
        "<h1>Portfolio QA — Data Stewardship vs Platform Limitations</h1>",
        f"<p>Deployments scanned: <strong>{summary.get('total_deployments_scanned')}</strong> · "
        f"Condition rows (all lanes): <strong>{summary.get('condition_count')}</strong> · "
        f"Stewardship condition rows: <strong>{summary.get('condition_count_stewardship')}</strong> · "
        f"Platform limitation rows: <strong>{summary.get('condition_count_platform')}</strong></p>",
        "<div class='stew-banner'><strong>Deployment Data Stewardship</strong> — actionable "
        "system-of-record review (SYSTEM_OF_RECORD_REVIEW_REQUIRED). Not personal blame.</div>",
        "<p>Distinct deployments with any stewardship condition: "
        f"<strong>{pop.get('deployment_count_with_stewardship_condition', '—')}</strong> · "
        f"BLOCKING: <strong>{pop.get('deployment_count_stewardship_blocking', '—')}</strong> · "
        f"REVIEW: <strong>{pop.get('deployment_count_stewardship_review', '—')}</strong> · "
        f"ADVISORY-only: <strong>{pop.get('deployment_count_stewardship_advisory_only', '—')}</strong> · "
        f"Multiple stewardship conditions: "
        f"<strong>{pop.get('deployment_count_stewardship_multiple_conditions', '—')}</strong></p>",
        _stewardship_table_html(
            [r for r in rows if r.get("lane") == LANE_STEWARDSHIP], candidate_ids
        ),
        "<div class='plat-banner'><strong>Platform Evidence Limitations</strong> — extract/source "
        "capability gaps (not Engagement Manager data-maintenance failures).</div>",
        "<p>Distinct deployments with platform limitations: "
        f"<strong>{pop.get('deployment_count_with_platform_limitation', '—')}</strong> · "
        f"Platform-only (no stewardship): "
        f"<strong>{pop.get('deployment_count_platform_limitations_only', '—')}</strong></p>",
        _stewardship_table_html(
            [r for r in rows if r.get("lane") == LANE_PLATFORM], candidate_ids
        ),
        "</body></html>",
    ]
    return "".join(parts)


def _stewardship_table_html(rows: List[Dict[str, Any]], candidate_ids: set) -> str:
    parts = [
        "<table><thead><tr>",
        "<th>Impact</th><th>Code</th><th>Deployment</th>",
        "<th>Health</th><th>Stage</th><th>Domain</th><th>Observation</th>",
        "<th>Source</th><th>Age (days)</th><th>Stage-1 candidate?</th><th>Review action</th>",
        "</tr></thead><tbody>",
    ]
    for row in rows:
        dep = row.get("deployment_id", "")
        parts.append(
            f"<tr><td>{_esc(row.get('impact_classification'))}</td>"
            f"<td>{_esc(row.get('condition_code'))}</td>"
            f"<td>{_esc(dep)}</td>"
            f"<td>{_esc(row.get('current_health'))}</td>"
            f"<td>{_esc(row.get('deployment_stage'))}</td>"
            f"<td>{_esc(row.get('affected_domain'))}</td>"
            f"<td>{_esc(row.get('observation'))}</td>"
            f"<td>{_esc(row.get('trace_reference'))}</td>"
            f"<td>{_esc(row.get('age_or_staleness_days'))}</td>"
            f"<td>{'yes' if dep in candidate_ids else 'no'}</td>"
            f"<td>{_esc(row.get('review_action'))}</td></tr>"
        )
    parts.append("</tbody></table>")
    return "".join(parts)


def attach_health_stage_to_stewardship_rows(
    rows: List[Dict[str, Any]], packets_by_id: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in rows:
        dep = row.get("deployment_id", "")
        pkt = packets_by_id.get(dep) or {}
        cs = pkt.get("current_state") or {}
        enriched = dict(row)
        enriched["current_health"] = cs.get("current_health")
        enriched["deployment_stage"] = cs.get("deployment_stage")
        out.append(enriched)
    return out


def build_stewardship_summary_json(
    rows: List[Dict[str, Any]],
    summary: Dict[str, Any],
    candidate_ids: set,
    out_path: Path,
    deployment_populations: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    stew_dep_ids = {
        r["deployment_id"]
        for r in rows
        if r.get("lane") == LANE_STEWARDSHIP and r.get("deployment_id")
    }
    overlap = len(stew_dep_ids & candidate_ids)
    doc = {
        **summary,
        "deployment_populations": deployment_populations or {},
        "overlap_stage1_candidates_with_stewardship": overlap,
        "detailed_rows_local_reference": str(out_path),
    }
    return doc


def write_stage2_artifacts(
    out_dir: Path,
    candidates: List[Dict[str, Any]],
    packets: List[Dict[str, Any]],
    stage1_manifest: Dict[str, Any],
    stewardship_rows: List[Dict[str, Any]],
    stewardship_summary: Dict[str, Any],
    include_legacy_stage2_contract: bool = False,
) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    packets_map = packets_by_id(packets)
    candidate_ids = {c["identity"]["deployment_id"] for c in candidates}
    stewardship_rows = attach_health_stage_to_stewardship_rows(stewardship_rows, packets_map)

    dep_pops = compute_stewardship_deployment_populations(
        packets, stewardship_rows, candidate_ids
    )
    payload = portfolio_stage2_payload(
        candidates,
        packets,
        stage1_manifest,
        stewardship_summary,
        dep_pops,
    )
    payload["stage2_output_contract_legacy"] = (
        STAGE2_OUTPUT_CONTRACT_LEGACY if include_legacy_stage2_contract else None
    )
    validation_errors = validate_stage2_payload(payload)
    if validation_errors:
        raise ValueError("Stage-2 payload validation failed: " + "; ".join(validation_errors))

    sana_text = render_stage2_sana_input(
        payload, include_legacy_contract=include_legacy_stage2_contract
    )
    sana_path = out_dir / "sana-stage2-portfolio-compression-input.txt"
    sana_path.write_text(sana_text, encoding="utf-8")

    review_path = out_dir / "stage2-candidate-review.html"
    review_path.write_text(
        render_stage2_candidate_review_html(
            payload["candidates"], {**stage1_manifest, "validation": "PASS"}
        ),
        encoding="utf-8",
    )

    stew_html_path = out_dir / "data-stewardship-review.html"
    stew_html_path.write_text(
        render_stewardship_review_html(
            stewardship_rows, candidate_ids, stewardship_summary, dep_pops
        ),
        encoding="utf-8",
    )

    stew_json_path = out_dir / "data-stewardship-summary.json"
    stew_doc = build_stewardship_summary_json(
        stewardship_rows,
        stewardship_summary,
        candidate_ids,
        stew_html_path,
        dep_pops,
    )
    stew_doc["candidate_deployment_ids"] = sorted(candidate_ids)
    stew_json_path.write_text(json.dumps(stew_doc, indent=2), encoding="utf-8")

    normalized_path = out_dir / "stage1-normalized-candidates.json"
    normalized_path.write_text(
        json.dumps(
            {
                "schema_version": CANDIDATE_SCHEMA_VERSION,
                "candidates": payload["candidates"],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    privacy_hits = privacy_scan_text(sana_text)
    manifest = {
        "stage2_payload_valid": not validation_errors,
        "validation_errors": validation_errors,
        "candidate_count": len(candidates),
        "sana_input_bytes": len(sana_text.encode("utf-8")),
        "sana_input_sha256": hashlib.sha256(sana_text.encode("utf-8")).hexdigest(),
        "artifacts": {
            "sana_stage2_input": str(sana_path),
            "stage2_candidate_review": str(review_path),
            "data_stewardship_review": str(stew_html_path),
            "data_stewardship_summary": str(stew_json_path),
            "normalized_candidates": str(normalized_path),
        },
        "privacy_pattern_hits": list(set(privacy_hits)),
    }
    manifest_path = out_dir / "stage2-harness-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest

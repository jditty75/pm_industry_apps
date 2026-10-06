"""Render local-only Sana Deployment Signals Pilot evidence packets."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from .context_contract import health_summary_contract, schedule_movement_contract
from .evidence import health_event_display_row
from .fields import normalize_date, trajectory_get


ANALYSIS_REQUEST = """ANALYSIS REQUEST
Determine whether anything in this deployment's current state, historical trajectory, schedule history, Product Function context, intervention context, and evidence quality warrants a current leadership Signal.

Distinguish recent conditions from historical conditions.

Do not assume Green means no Signal.

Do not assume historical volatility means current deterioration.

Do not assume intervention means deterioration or successful mitigation.

Do not assume a Signal is required.

Use only supplied evidence.

Do not infer unavailable evidence.

Respond with the structured Signal output contract (Attention, Category, Deployment, Observation, Historical Evidence, Interpretation, Leadership Question, Confidence) or NO_SIGNAL with brief rationale."""


def _lines(title: str, rows: List[str]) -> List[str]:
    out = [title, "-" * len(title)]
    out.extend(rows)
    out.append("")
    return out


def _format_mtp_row(e: Dict[str, Any]) -> str:
    return (
        f"  {normalize_date(e.get('event_date'))} | {e.get('event_type')} | "
        f"{normalize_date(e.get('old_date')) or '(blank)'} -> {normalize_date(e.get('new_date')) or '(blank)'} | "
        f"movement_days={e.get('movement_days', '')}"
    )


def _pick_parent_mtp_events(mtp_events: List[Dict[str, Any]], limit: int = 12) -> List[Dict[str, Any]]:
    parent_types = {"PARENT_TARGET_CHANGE", "PARENT_ACTUAL_MTP", "DEPLOYMENT_TARGET_CHANGE"}
    parent = [e for e in mtp_events if str(e.get("event_type") or "") in parent_types]
    if parent:
        return parent[-limit:]
    non_fn = [e for e in mtp_events if str(e.get("event_type") or "") != "FUNCTION_TARGET_CHANGE"]
    return non_fn[-limit:]


def render_calibration_packet(
    bundle: Dict[str, Any],
    calibration_id: str,
    purpose: str,
    today_str: str,
    dhp_rows: Optional[List[Dict[str, Any]]] = None,
    dhp_actions: Optional[List[Dict[str, Any]]] = None,
    max_action_narratives: int = 3,
) -> str:
    """Deterministic evidence only; no steering language."""
    t = bundle["trajectory"]
    dep_id = bundle.get("deployment_id", t.get("deployment_id", ""))
    he_raw = bundle.get("health_events_raw") or []
    mtp = bundle.get("mtp_events") or []
    sched = bundle.get("schedule") or {}
    pf = bundle.get("pf_context") or {}
    intervention = bundle.get("intervention") or {}
    health_contract = health_summary_contract(t, he_raw)
    sched_contract = schedule_movement_contract(t, mtp)

    lines: List[str] = []
    lines.append(f"SANA DEPLOYMENT SIGNALS PILOT — CALIBRATION PACKET {calibration_id}")
    lines.append(f"Purpose: {purpose}")
    lines.append(f"Evidence build date (validator): {today_str}")
    lines.append(f"Deployment identifier (local): {dep_id}")
    lines.append("")

    lines.extend(
        _lines(
            "CURRENT STATE",
            [
                f"Health: {t.get('current_health')}",
                f"Stage: {t.get('current_stage')}",
                f"Current MTP: {normalize_date(t.get('current_mtp'))}",
                f"Days until current MTP: {trajectory_get(t, 'days_to_mtp', t.get('days_until_current_mtp'))}",
                f"MTP analysis grain: {t.get('mtp_analysis_grain')}",
                f"Product function count: {t.get('product_function_count')}",
            ],
        )
    )

    lines.extend(
        _lines(
            "HEALTH TRAJECTORY (summary fields — see contract)",
            [
                f"previous_health: {t.get('previous_health')}",
                f"health_last_change_date: {normalize_date(trajectory_get(t, 'last_health_change_date'))}",
                f"days_at_current_health: {t.get('days_at_current_health')}",
                f"health_deteriorations_90d: {t.get('health_deteriorations_90d')}",
                f"health_improvements_90d: {t.get('health_improvements_90d')}",
                f"health_event_count: {t.get('health_event_count')}",
            ],
        )
    )

    hc_lines = [
        f"health_current_matches_last_event_new_health: {health_contract['health_current_matches_last_event_new_health']}",
    ]
    for c in health_contract.get("caveats") or []:
        hc_lines.append(f"CAVEAT: {c}")
    lines.extend(_lines("HEALTH SUMMARY CONTRACT", hc_lines))

    he_display = [health_event_display_row(h) for h in he_raw]
    he_lines = [
        f"  {normalize_date(h.get('event_date'))} | {h.get('event_type')} | "
        f"{h.get('old_value')} -> {h.get('new_value')}"
        for h in he_display
    ] or ["  (no HealthEvents rows)"]
    lines.extend(_lines("HEALTH EVENTS (trace)", he_lines))

    lines.extend(
        _lines(
            "SCHEDULE TRAJECTORY",
            [
                f"Parent target changes 90d: {sched.get('mtp_changes_90d')}",
                f"Slips 90d: {sched.get('mtp_slips_90d')}",
                f"Accelerations 90d: {sched.get('mtp_accelerations_90d')}",
                f"Gross movement lifetime (mtp_gross_movement_days): {sched_contract.get('mtp_gross_movement_days')}",
                f"Net movement lifetime (mtp_net_movement_days): {sched_contract.get('mtp_net_movement_days')}",
                f"Net comparison basis: {sched_contract.get('mtp_net_movement_comparison')}",
                f"earliest_recorded_mtp: {sched_contract.get('earliest_recorded_mtp')}",
                f"Recent MTP events (90d window): {sched.get('recent_mtp_event_count_90d')}",
                f"Historical MTP events (365d excl recent): {sched.get('historical_mtp_event_count_365d_excl_recent')}",
                f"Parent reconciliation: {sched.get('parent_reconciliation')}",
            ],
        )
    )

    sc_lines = [f"{k}: {v}" for k, v in sched_contract.get("field_semantics", {}).items()]
    sc_lines.append(sched_contract.get("present_net_with", ""))
    lines.extend(_lines("SCHEDULE MOVEMENT CONTRACT", sc_lines))

    mtp_lines = [_format_mtp_row(e) for e in _pick_parent_mtp_events(mtp)]
    lines.extend(_lines("PARENT TARGET / ACTUAL CHRONOLOGY (excerpt)", mtp_lines))

    pf_lines = [
        f"Count: {pf.get('count')}",
        f"Completed (rollup): {pf.get('completed')}",
        f"Remaining (rollup): {pf.get('remaining')}",
        f"Grain: {pf.get('grain')}",
        pf.get("pf_target_history_absent_note", ""),
    ]
    lines.extend(_lines("PRODUCT FUNCTION CONTEXT", pf_lines))

    int_lines = [
        f"has_open_health_plan (trajectory): {intervention.get('trajectory_open_health_plan')}",
        f"trajectory dhp_count: {intervention.get('trajectory_dhp_count')}",
        f"source DHP rows in extract: {intervention.get('source_dhp_rows')}",
        f"action_history_record_count: {intervention.get('trajectory_action_history_count')}",
        f"action history index rows: {intervention.get('source_action_history_index_rows')}",
    ]
    if intervention.get("intervention_mismatch"):
        int_lines.append(f"WARNING: {intervention.get('intervention_mismatch')}")
    lines.extend(_lines("INTERVENTION CONTEXT", int_lines))

    dhp_rows = dhp_rows or []
    if dhp_rows:
        lines.append("DHP SOURCE (metadata)")
        lines.append("-------------------")
        for d in dhp_rows[:3]:
            lines.append(
                f"  Id={d.get('Id')} Status={d.get('Status__c') or d.get('Status')} "
                f"Updated={d.get('LastModifiedDate') or d.get('Last_Updated__c')}"
            )
        lines.append("")

    if dhp_actions:
        lines.append("ACTION HISTORY (minimal narrative excerpt)")
        lines.append("----------------------------------------")
        sorted_actions = sorted(
            dhp_actions,
            key=lambda a: str(a.get("CreatedDate") or a.get("Created") or ""),
            reverse=True,
        )
        for a in sorted_actions[:max_action_narratives]:
            narrative = (
                a.get("Action_Description__c")
                or a.get("Comments__c")
                or a.get("Description")
                or a.get("Field")
                or ""
            )
            narrative = str(narrative).replace("\n", " ").strip()[:500]
            lines.append(
                f"  {a.get('CreatedDate')} | health_status={a.get('Health_Status__c', '')} | {narrative}"
            )
        lines.append("")

    eq = bundle.get("evidence_quality", "")
    eq_reasons = bundle.get("evidence_quality_reasons") or []
    lines.extend(
        _lines(
            "EVIDENCE QUALITY",
            [f"Level: {eq}"] + [f"- {r}" for r in eq_reasons],
        )
    )

    lines.extend(
        _lines(
            "KNOWN UNAVAILABLE / LIMITED EVIDENCE",
            [
                "Product Function Production_Move_Date_Target__c history is absent in this extract; "
                "PF target movement must be treated as UNAVAILABLE, not zero.",
                "HealthEvents reflect Deployment History only; current_health may differ from last event new_health.",
            ],
        )
    )

    lines.append(ANALYSIS_REQUEST)
    lines.append("")
    return "\n".join(lines)

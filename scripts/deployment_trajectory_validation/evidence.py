"""Build per-deployment evidence bundles for validation reporting."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from .fields import (
    as_float,
    as_int,
    health_event_display_row,
    normalize_date,
    normalize_id,
    parse_bool,
    resolve_dhp_deployment_id,
    trajectory_get,
)


def index_health_events(
    health_events: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for h in health_events:
        dep = normalize_id(h.get("deployment_id"))
        if dep:
            out[dep].append(h)
    for dep in out:
        out[dep].sort(key=lambda r: normalize_date(r.get("event_date")) or "")
    return out


def index_mtp_events(mtp_events: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for m in mtp_events:
        dep = normalize_id(m.get("deployment_id"))
        if dep:
            out[dep].append(m)
    for dep in out:
        out[dep].sort(key=lambda r: normalize_date(r.get("event_date")) or "")
    return out


def index_dhp_and_actions(
    dhp_rows: List[Dict[str, Any]],
    dhp_action: List[Dict[str, Any]],
    action_idx: List[Dict[str, Any]],
) -> Tuple[Dict[str, List[Dict]], Dict[str, int], Dict[str, List[Dict]], Dict[str, str]]:
    dhp_by_dep: Dict[str, List[Dict]] = defaultdict(list)
    dhp_id_to_dep: Dict[str, str] = {}
    for d in dhp_rows:
        dep = resolve_dhp_deployment_id(d)
        did = normalize_id(d.get("Id"))
        if dep:
            dhp_by_dep[dep].append(d)
        if did and dep:
            dhp_id_to_dep[did] = dep

    action_by_dep: Dict[str, int] = defaultdict(int)
    for a in dhp_action:
        dhp_id = normalize_id(a.get("Deployment_Health_Plan__c") or a.get("DHP__c"))
        dep = dhp_id_to_dep.get(dhp_id)
        if dep:
            action_by_dep[dep] += 1

    action_idx_by_dep: Dict[str, List[Dict]] = defaultdict(list)
    for row in action_idx:
        dep = normalize_id(row.get("deployment_id"))
        if dep:
            action_idx_by_dep[dep].append(row)

    return dhp_by_dep, action_by_dep, action_idx_by_dep, dhp_id_to_dep


def intervention_evidence(
    t: Dict[str, Any],
    dhp_by_dep: Dict[str, List[Dict]],
    action_idx_by_dep: Dict[str, List[Dict]],
    action_by_dep: Dict[str, int],
    dep_id: str,
) -> Dict[str, Any]:
    traj_open = parse_bool(t.get("has_open_health_plan"))
    traj_dhp_count = as_int(t.get("dhp_count"))
    traj_action_count = as_int(t.get("action_history_record_count"))
    source_dhp = len(dhp_by_dep.get(dep_id, []))
    idx_count = len(action_idx_by_dep.get(dep_id, []))
    source_action_via_dhp = action_by_dep.get(dep_id, 0)

    mismatch_reasons: List[str] = []
    if traj_dhp_count != source_dhp:
        mismatch_reasons.append(
            f"trajectory dhp_count={traj_dhp_count} vs source DHP rows={source_dhp} "
            "(source join uses Deployment__r.Id / Deployment__c)"
        )
    if traj_action_count != idx_count and idx_count > 0:
        mismatch_reasons.append(
            f"trajectory action_history_record_count={traj_action_count} "
            f"vs Action History index rows={idx_count}"
        )
    if traj_open and source_dhp == 0 and traj_dhp_count == 0:
        mismatch_reasons.append(
            "trajectory has_open_health_plan=True but no DHP rows in workbook extract"
        )
    if traj_open and traj_dhp_count > 0 and source_dhp == 0:
        mismatch_reasons.append(
            "trajectory reports DHP count but validator cannot resolve DHP deployment keys"
        )

    flag = "INTERVENTION_EVIDENCE_MISMATCH" if mismatch_reasons else ""

    return {
        "trajectory_open_health_plan": traj_open,
        "trajectory_dhp_count": traj_dhp_count,
        "trajectory_action_history_count": traj_action_count,
        "source_dhp_rows": source_dhp,
        "source_action_history_index_rows": idx_count,
        "source_action_history_via_dhp_join": source_action_via_dhp,
        "intervention_mismatch": flag,
        "intervention_mismatch_reasons": mismatch_reasons,
    }


def schedule_window_metrics(
    t: Dict[str, Any], mtp_events: List[Dict[str, Any]], today_str: str
) -> Dict[str, Any]:
    today = date.fromisoformat(today_str)
    recent_cutoff = today - timedelta(days=90)
    historical_cutoff = today - timedelta(days=365)

    parent_events = [
        e
        for e in mtp_events
        if str(e.get("event_type") or "") in ("PARENT_TARGET_CHANGE", "DEPLOYMENT_TARGET_CHANGE")
        or str(e.get("source_object") or "").lower() in ("deployment", "sfdc_deployments")
    ]
    if not parent_events:
        parent_events = [
            e for e in mtp_events if str(e.get("event_type") or "") != "FUNCTION_TARGET_CHANGE"
        ]

    recent_moves = 0
    historical_moves = 0
    for e in mtp_events:
        ed = normalize_date(e.get("event_date"))
        if not ed:
            continue
        try:
            d = date.fromisoformat(ed)
        except ValueError:
            continue
        mv = as_float(e.get("movement_days"))
        if abs(mv) < 0.5 and str(e.get("old_date") or "") == str(e.get("new_date") or ""):
            continue
        if d >= recent_cutoff:
            recent_moves += 1
        elif d >= historical_cutoff:
            historical_moves += 1

    return {
        "mtp_changes_90d": as_int(trajectory_get(t, "mtp_changes_90d")),
        "function_target_changes_90d": as_int(t.get("function_target_changes_90d")),
        "mtp_slips_90d": as_int(t.get("mtp_slips_90d")),
        "mtp_accelerations_90d": as_int(t.get("mtp_accelerations_90d")),
        "mtp_gross_movement_lifetime": as_float(t.get("mtp_gross_movement_days")),
        "mtp_net_movement_lifetime": as_float(t.get("mtp_net_movement_days")),
        "schedule_gross_90d_proxy": as_float(trajectory_get(t, "mtp_gross_movement_90d")),
        "parent_reconciliation": t.get("parent_mtp_reconciliation_status", ""),
        "reconstructed_parent_mtp": t.get("reconstructed_parent_effective_mtp", ""),
        "recent_mtp_event_count_90d": recent_moves,
        "historical_mtp_event_count_365d_excl_recent": historical_moves,
        "mtp_event_total": len(mtp_events),
    }


def evidence_quality(t: Dict[str, Any], intervention: Dict[str, Any]) -> Tuple[str, List[str]]:
    reasons: List[str] = []
    warnings = str(t.get("build_warnings") or "").strip()
    if warnings:
        reasons.append(f"build_warnings: {warnings}")
    recon = str(t.get("parent_mtp_reconciliation_status") or "")
    if recon and recon not in ("MATCH", "NOT_APPLICABLE_PRODUCT_FUNCTION_GRAIN"):
        reasons.append(f"reconciliation: {recon}")
    if intervention.get("intervention_mismatch"):
        reasons.append(intervention["intervention_mismatch"])
    he_count = as_int(t.get("health_event_count") or t.get("source_health_event_count"))
    mtp_count = as_int(t.get("mtp_event_count") or t.get("source_mtp_event_count"))
    if he_count == 0 and str(t.get("previous_health") or "").strip():
        reasons.append("previous_health set but zero health_event_count")
    if mtp_count == 0 and as_int(t.get("mtp_changes_total")) > 0:
        reasons.append("mtp_changes_total>0 but mtp_event_count=0")

    if not reasons and not warnings:
        return "HIGH", ["Complete trajectory row; no build warnings"]
    if len(reasons) <= 2 and "INTERVENTION_EVIDENCE_MISMATCH" not in str(reasons):
        return "MEDIUM", reasons
    return "LOW", reasons


def build_deployment_bundle(
    dep_id: str,
    t: Dict[str, Any],
    meta: Dict[str, Any],
    he_by_dep: Dict[str, List[Dict]],
    mtp_by_dep: Dict[str, List[Dict]],
    dhp_by_dep: Dict[str, List[Dict]],
    action_idx_by_dep: Dict[str, List[Dict]],
    action_by_dep: Dict[str, int],
    pf_by_dep: Dict[str, List[Dict]],
    today_str: str,
) -> Dict[str, Any]:
    raw_he = he_by_dep.get(dep_id, [])
    display_he = [health_event_display_row(h) for h in raw_he]
    mtp_rows = mtp_by_dep.get(dep_id, [])
    intervention = intervention_evidence(t, dhp_by_dep, action_idx_by_dep, action_by_dep, dep_id)
    sched = schedule_window_metrics(t, mtp_rows, today_str)
    eq_level, eq_reasons = evidence_quality(t, intervention)

    pfs = pf_by_dep.get(dep_id, [])
    completed = as_int(trajectory_get(t, "pf_completed"))
    remaining = as_int(trajectory_get(t, "pf_remaining"))

    return {
        **meta,
        "deployment_id": dep_id,
        "trajectory": t,
        "health_events_raw": raw_he,
        "health_events_display": display_he,
        "mtp_events": mtp_rows,
        "product_functions": pfs,
        "intervention": intervention,
        "schedule": sched,
        "evidence_quality": eq_level,
        "evidence_quality_reasons": eq_reasons,
        "pf_context": {
            "count": as_int(t.get("product_function_count")),
            "completed": completed,
            "remaining": remaining,
            "grain": str(t.get("mtp_analysis_grain") or ""),
            "pf_target_history_absent_note": (
                "Product Function target-date history is absent from this workbook extract; "
                "lack of observed PF target movement is not proof of PF schedule stability."
            ),
        },
    }

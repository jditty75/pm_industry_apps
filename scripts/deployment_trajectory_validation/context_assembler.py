"""Deterministic deployment-signal-context-v1 packet builder (no LLM)."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from .context_contract import health_summary_contract, schedule_movement_contract
from .evidence import evidence_quality, intervention_evidence, schedule_window_metrics
from .fields import as_int, normalize_date, trajectory_get

SCHEMA_VERSION = "deployment-signal-context-v1"


def evidence_windows(today_str: str) -> Dict[str, Any]:
    today = date.fromisoformat(today_str)
    return {
        "recent_30d": {"start": (today - timedelta(days=30)).isoformat(), "end": today_str},
        "recent_90d": {"start": (today - timedelta(days=90)).isoformat(), "end": today_str},
        "historical_365d": {
            "start": (today - timedelta(days=365)).isoformat(),
            "end": (today - timedelta(days=90)).isoformat(),
        },
        "lifetime": {"start": None, "end": today_str},
    }


def product_function_rollup_reconciliation(t: Dict[str, Any]) -> Dict[str, Any]:
    count = as_int(t.get("product_function_count"))
    completed = as_int(t.get("functions_actual_mtp_count"))
    remaining = as_int(t.get("functions_remaining_count"))
    reconciled = count <= 0 or (completed + remaining == count)
    return {
        "product_function_count": count,
        "functions_completed": completed,
        "functions_remaining": remaining,
        "product_function_rollup_reconciled": reconciled,
        "product_function_target_history_available": False,
        "product_function_target_history_note": (
            "Product Function Production_Move_Date_Target__c history is UNAVAILABLE in the current "
            "extract; do not treat missing PF target movement as zero movement."
        ),
    }


def select_health_events(events: List[Dict[str, Any]], today_str: str, limit: int = 12) -> List[Dict[str, Any]]:
    cutoff365 = (date.fromisoformat(today_str) - timedelta(days=365)).isoformat()
    recent: List[Dict[str, Any]] = []
    older: List[Dict[str, Any]] = []
    for ev in events:
        d = normalize_date(ev.get("event_date"))
        row = {
            "trace": {"event_index": ev.get("event_index"), "source_sheet": "Deployment_Trajectory_HealthEvents"},
            "event_date": d,
            "old_health": ev.get("old_health"),
            "new_health": ev.get("new_health"),
            "transition_class": ev.get("transition_class"),
        }
        if d >= cutoff365:
            recent.append(row)
        else:
            older.append(row)
    pool = recent if len(recent) >= limit else recent + older
    return pool[-limit:]


def select_mtp_events(events: List[Dict[str, Any]], limit: int = 12) -> List[Dict[str, Any]]:
    parent_types = {"PARENT_TARGET_CHANGE", "DEPLOYMENT_TARGET_CHANGE", "PARENT_ACTUAL_MTP"}
    parent = [e for e in events if str(e.get("event_type") or "") in parent_types]
    pool = parent if parent else [e for e in events if str(e.get("event_type") or "") != "FUNCTION_TARGET_CHANGE"]
    out = []
    for ev in pool[-limit:]:
        out.append(
            {
                "trace": {
                    "event_type": ev.get("event_type"),
                    "source_sheet": "Deployment_Trajectory_MtpEvents",
                    "product_function_id": ev.get("product_function_id") or "",
                },
                "event_date": normalize_date(ev.get("event_date")),
                "event_type": ev.get("event_type"),
                "old_date": normalize_date(ev.get("old_date")),
                "new_date": normalize_date(ev.get("new_date")),
                "movement_days": ev.get("movement_days"),
            }
        )
    return out


def select_action_narratives(
    actions: List[Dict[str, Any]], today_str: str, max_items: int = 3
) -> List[Dict[str, Any]]:
    if not actions:
        return []
    cutoff90 = (date.fromisoformat(today_str) - timedelta(days=90)).isoformat()
    scored: List[Tuple[int, str, Dict[str, Any]]] = []
    for idx, a in enumerate(actions):
        created = normalize_date(a.get("CreatedDate") or a.get("created_date") or "")
        health = str(a.get("Health_Status__c") or a.get("health_status") or "").strip()
        text = str(
            a.get("Action_Description__c")
            or a.get("Comments__c")
            or a.get("Description")
            or a.get("narrative")
            or ""
        ).replace("\n", " ").strip()
        if len(text) > 500:
            text = text[:500]
        score = 0
        if created >= cutoff90:
            score += 10
        if health:
            score += 5
        score += min(idx, 5)
        scored.append(
            (
                score,
                created,
                {
                    "trace": {
                        "action_history_id": a.get("Id") or a.get("action_history_id") or "",
                        "dhp_id": a.get("Deployment_Health_Plan__c") or a.get("dhp_id") or "",
                        "source_sheet": a.get("source_sheet") or "SFDC_DHPActionHistory",
                    },
                    "created_date": created,
                    "health_status": health,
                    "narrative_excerpt": text,
                },
            )
        )
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [item[2] for item in scored[:max_items]]


def health_reconciliation_packet_fields(
    t: Dict[str, Any], health_events: List[Dict[str, Any]], today_str: str
) -> Dict[str, Any]:
    contract = health_summary_contract(t, health_events)
    last_change = normalize_date(trajectory_get(t, "last_health_change_date", t.get("health_last_change_date")))
    days_since = None
    if last_change:
        try:
            days_since = (date.fromisoformat(today_str) - date.fromisoformat(last_change)).days
        except ValueError:
            days_since = None
    reconciled = contract["health_current_matches_last_event_new_health"]
    return {
        "health_history_available": bool(health_events),
        "health_last_event_new_health": contract.get("last_event_new_health") or "",
        "health_current_matches_last_event_new_health": reconciled,
        "health_current_state_reconciled": reconciled,
        "days_since_last_historized_health_change": days_since,
        "verified_days_at_current_health": t.get("days_at_current_health") if reconciled else None,
        "caveats": contract.get("caveats") or [],
    }


def build_context_packet(
    bundle: Dict[str, Any],
    today_str: str,
    logical_app: str = "SLG_DM",
    action_narratives: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build deployment-signal-context-v1 from a validation pipeline bundle."""
    t = bundle["trajectory"]
    dep_id = bundle.get("deployment_id") or t.get("deployment_id") or ""
    he_raw = bundle.get("health_events_raw") or []
    mtp = bundle.get("mtp_events") or []
    intervention_src = bundle.get("intervention") or {}
    sched = bundle.get("schedule") or schedule_window_metrics(t, mtp, today_str)
    pf = product_function_rollup_reconciliation(t)
    health_recon = health_reconciliation_packet_fields(t, he_raw, today_str)

    eq_level, eq_factors = evidence_quality(t, intervention_src, he_raw)
    if not pf["product_function_rollup_reconciled"] and pf["product_function_count"] > 0:
        eq_factors = list(eq_factors) + ["product_function_rollup_not_reconciled"]
        eq_level = "LOW" if eq_level == "HIGH" else eq_level

    sched_contract = schedule_movement_contract(t, mtp)
    unavailable = ["product_function_target_date_history"]
    if not health_recon["health_history_available"]:
        unavailable.append("health_event_history_sparse_or_empty")

    action_index_count = as_int(intervention_src.get("source_action_history_index_rows"))

    return {
        "schema_version": SCHEMA_VERSION,
        "metadata": {
            "generated_at": date.today().isoformat() + "T00:00:00.000Z",
            "snapshot_date": today_str,
            "logical_app": logical_app,
            "industry_context": t.get("industry") or "",
            "deployment_id": dep_id,
            "deployment_label": bundle.get("name") or t.get("deployment_name") or "",
            "evidence_windows": evidence_windows(today_str),
        },
        "current_state": {
            "current_health": t.get("current_health"),
            "deployment_stage": t.get("current_stage"),
            "current_mtp": normalize_date(t.get("current_mtp")),
            "days_relative_to_mtp": trajectory_get(t, "days_to_mtp", t.get("days_until_current_mtp")),
            "priming_partner": t.get("priming_partner"),
            "implementation_partner": t.get("implementation_partner"),
            "mtp_analysis_grain": t.get("mtp_analysis_grain"),
        },
        "health_trajectory": {
            "current_health": t.get("current_health"),
            "previous_historized_health": t.get("previous_health"),
            "last_historized_health_change_date": normalize_date(
                trajectory_get(t, "last_health_change_date", t.get("health_last_change_date"))
            ),
            "days_since_last_historized_health_change": health_recon["days_since_last_historized_health_change"],
            "deteriorations_recent_90d": as_int(t.get("health_deteriorations_90d")),
            "improvements_recent_90d": as_int(t.get("health_improvements_90d")),
            "changes_recent_30d": as_int(t.get("health_changes_30d")),
            "changes_recent_90d": as_int(t.get("health_changes_90d")),
            "health_event_count": as_int(t.get("health_event_count")),
            "reconciliation": health_recon,
            "selected_events": select_health_events(he_raw, today_str),
        },
        "schedule_trajectory": {
            "recent_30d": {
                "target_changes": as_int(t.get("mtp_changes_30d")),
                "function_target_changes": as_int(t.get("function_target_changes_30d")),
            },
            "recent_90d": {
                "target_changes": as_int(sched.get("mtp_changes_90d") or t.get("mtp_changes_90d")),
                "slips": as_int(t.get("mtp_slips_90d")),
                "accelerations": as_int(t.get("mtp_accelerations_90d")),
                "function_target_changes": as_int(t.get("function_target_changes_90d")),
                "recent_mtp_event_count": sched.get("recent_mtp_event_count_90d"),
            },
            "historical_365d": {
                "historical_mtp_event_count_excl_recent_90d": sched.get(
                    "historical_mtp_event_count_365d_excl_recent"
                ),
                "note": "Use selected_events and lifetime metrics; do not treat lifetime gross as 90d movement.",
            },
            "lifetime": {
                "target_changes_total": as_int(t.get("mtp_changes_total")),
                "gross_movement_days": t.get("mtp_gross_movement_days"),
                "net_movement_days": t.get("mtp_net_movement_days"),
                "mtp_event_count": as_int(t.get("mtp_event_count")),
            },
            "last_target_change_date": normalize_date(t.get("mtp_last_change_date")),
            "parent_reconciliation_status": t.get("parent_mtp_reconciliation_status"),
            "reconstructed_parent_effective_mtp": normalize_date(t.get("reconstructed_parent_effective_mtp")),
            "movement_contract": sched_contract,
            "selected_events": select_mtp_events(mtp),
        },
        "product_function": {
            **pf,
            "distinct_current_function_mtp_count": t.get("distinct_current_function_mtp_count"),
            "remaining_earliest_target_mtp": normalize_date(t.get("remaining_earliest_target_mtp")),
            "remaining_latest_target_mtp": normalize_date(t.get("remaining_latest_target_mtp")),
            "functions_late_vs_final_target_count": t.get("functions_late_vs_final_target_count"),
        },
        "intervention": {
            "has_open_health_plan": bool(t.get("has_open_health_plan")),
            "dhp_count": as_int(t.get("dhp_count")),
            "action_history_count": as_int(t.get("action_history_record_count")),
            "action_history_index_row_count": action_index_count,
            "action_history_latest_created_date": normalize_date(t.get("action_history_latest_created_date")),
            "days_since_action_history_update": t.get("days_since_action_history_update"),
            "action_history_latest_health_status": t.get("action_history_latest_health_status"),
            "dhp_latest_updated_date": normalize_date(t.get("dhp_latest_updated_date")),
            "days_since_dhp_update": t.get("days_since_dhp_update"),
            "intervention_mismatch": intervention_src.get("intervention_mismatch") or "",
            "selected_narratives": select_action_narratives(action_narratives or [], today_str),
        },
        "evidence_quality": {
            "classification": eq_level,
            "factors": eq_factors,
            "unavailable_evidence": unavailable,
            "build_warnings": t.get("build_warnings") or "",
        },
        "trace_references": {
            "trajectory_schema_version": t.get("trajectory_schema_version"),
            "trajectory_built_at": t.get("trajectory_built_at"),
            "source_health_event_count": t.get("source_health_event_count"),
            "source_mtp_event_count": t.get("source_mtp_event_count"),
        },
    }


def approximate_packet_byte_size(packet: Dict[str, Any]) -> int:
    return len(json.dumps(packet, ensure_ascii=False).encode("utf-8"))


def packet_size_stats(packets: List[Dict[str, Any]]) -> Dict[str, Any]:
    sizes = sorted(approximate_packet_byte_size(p) for p in packets)
    if not sizes:
        return {"count": 0, "median": 0, "p90": 0, "max": 0}
    n = len(sizes)
    median = sizes[n // 2]
    p90_idx = min(n - 1, int(n * 0.9))
    return {"count": n, "median": median, "p90": sizes[p90_idx], "max": sizes[-1]}

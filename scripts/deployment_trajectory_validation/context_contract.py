"""Deterministic context-contract helpers for AI pilot packets (no trajectory semantics changes)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .fields import as_float, normalize_date, trajectory_get


def health_summary_contract(
    t: Dict[str, Any], health_events: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Document trajectory health summary fields vs HealthEvents trace.

    Semantics match CoreDeploymentTrajectoryMetrics.computeHealthMetrics (DepMngr).
    """
    current = str(t.get("current_health") or "").strip()
    previous = str(t.get("previous_health") or "").strip()
    last_change = normalize_date(trajectory_get(t, "last_health_change_date"))
    days_at = t.get("days_at_current_health")

    last_new = ""
    if health_events:
        last_raw = health_events[-1]
        last_new = str(last_raw.get("new_health") or "").strip()

    reconciled = (
        not current
        or not last_new
        or current.lower() == last_new.lower()
    )

    caveats: List[str] = []
    if current and last_new and not reconciled:
        caveats.append(
            "current_health is the live deployment field; the last recorded HealthEvents "
            f"transition ended at {last_new}, not {current}. Do not infer an unlisted transition."
        )
    if previous and current and previous.lower() == current.lower() and last_new:
        caveats.append(
            "previous_health is the old value of the last recorded transition, not necessarily "
            "the health immediately before current_health when the current value was set outside history."
        )

    return {
        "field_semantics": {
            "current_health": "Authoritative current Overall_Health__c on the deployment row.",
            "previous_health": "Old health value of the last recorded historized transition (not implied prior to current_health).",
            "health_last_change_date": "Date of the last recorded historized health transition.",
            "days_at_current_health": (
                "Days from health_last_change_date to trajectory build date; "
                "tenure at current_health only when current_health matches the last event new_health."
            ),
            "HealthEvents": (
                "Chronological historized transitions from Deployment History; "
                "omits silent field updates not captured in history."
            ),
        },
        "health_current_matches_last_event_new_health": reconciled,
        "last_event_new_health": last_new,
        "safe_to_present_without_reconciliation_metadata": reconciled,
        "reconciliation_metadata_required": (not reconciled),
        "caveats": caveats,
    }


def schedule_movement_contract(
    t: Dict[str, Any], mtp_events: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Explain parent net/gross movement fields for Context Assembler / calibration packets."""
    gross = as_float(t.get("mtp_gross_movement_days"))
    net = t.get("mtp_net_movement_days")
    net_basis = str(t.get("mtp_net_movement_comparison") or "")
    earliest = normalize_date(t.get("earliest_recorded_mtp"))
    current_mtp = normalize_date(t.get("current_mtp"))
    baseline = normalize_date(t.get("baseline_mtp"))

    initial_populations = [
        e
        for e in mtp_events
        if str(e.get("event_type") or "") in ("PARENT_TARGET_CHANGE", "DEPLOYMENT_TARGET_CHANGE")
        and not str(e.get("old_date") or "").strip()
        and str(e.get("new_date") or "").strip()
    ]

    parent_changes = [
        e
        for e in mtp_events
        if str(e.get("event_type") or "") in ("PARENT_TARGET_CHANGE", "DEPLOYMENT_TARGET_CHANGE")
        and as_float(e.get("movement_days")) != 0
    ]

    return {
        "field_semantics": {
            "gross_movement": (
                "mtp_gross_movement_days: sum of absolute movement_days on valid parent target "
                "changes (blank-to-date initial population excluded)."
            ),
            "net_movement": (
                "mtp_net_movement_days: signed days from earliest_recorded_mtp to current_mtp. "
                "earliest_recorded_mtp is the earliest new_date among valid target changes only "
                "(initial target population does not set the net baseline)."
            ),
            "initial_target_population": (
                "Trace rows with empty old_date and populated new_date; not counted as target changes "
                "for net/gross metrics."
            ),
            "target_movement": "Parent target field historized changes with both old and new dates.",
            "actual_outcome": (
                "FUNCTION_ACTUAL_MTP / PARENT_ACTUAL_MTP events; separate from target movement metrics."
            ),
        },
        "mtp_net_movement_comparison": net_basis,
        "earliest_recorded_mtp": earliest,
        "baseline_mtp": baseline,
        "current_mtp": current_mtp,
        "mtp_gross_movement_days": gross,
        "mtp_net_movement_days": net,
        "initial_target_population_event_count": len(initial_populations),
        "valid_parent_target_change_event_count": len(parent_changes),
        "present_net_with": (
            "State mtp_net_movement_comparison and earliest_recorded_mtp whenever net movement is shown; "
            "include initial population trace rows when explaining gross vs net."
        ),
    }

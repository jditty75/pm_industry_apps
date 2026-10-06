"""Deterministic deployment data stewardship and platform evidence limitations."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

STEWARDSHIP_SCHEMA_VERSION = "deployment-data-stewardship-v1"

LANE_STEWARDSHIP = "DEPLOYMENT_DATA_STEWARDSHIP"
LANE_PLATFORM = "PLATFORM_EVIDENCE_LIMITATION"

IMPACT_BLOCKING = "BLOCKING"
IMPACT_REVIEW = "REVIEW"
IMPACT_ADVISORY = "ADVISORY"

TERMINAL_STAGES = frozenset(
    {"post prod", "post production", "production", "closed", "complete", "completed", "hypercare"}
)
PRE_TERMINAL_STAGES = frozenset({"deploy", "test", "build", "plan", "initiate", "discovery"})

STALE_DHP_DAYS = 90
STALE_ACTION_DAYS = 90


def _str(v: Any) -> str:
    return str(v or "").strip()


def _int(v: Any) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _stage_bucket(stage: str) -> str:
    return _str(stage).lower()


def detect_platform_limitations(packet: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Facts about extract/source capability — not EM accountability."""
    out: List[Dict[str, Any]] = []
    meta = packet.get("metadata") or {}
    dep_id = _str(meta.get("deployment_id"))
    pf = packet.get("product_function") or {}
    if pf.get("product_function_target_history_available") is False:
        out.append(
            _condition(
                code="PF_TARGET_DATE_HISTORY_UNAVAILABLE",
                domain="PRODUCT_FUNCTION",
                observation=(
                    "Product Function target-date history is unavailable in the current extract; "
                    "PF target movement cannot be verified from historized evidence."
                ),
                source_fields=["product_function.product_function_target_history_available"],
                trace_ref="context_packet:product_function",
                impact=IMPACT_ADVISORY,
                lane=LANE_PLATFORM,
                deployment_id=dep_id,
            )
        )
    eq = packet.get("evidence_quality") or {}
    for item in eq.get("unavailable_evidence") or []:
        if item == "product_function_target_date_history":
            continue
        out.append(
            _condition(
                code="PLATFORM_EVIDENCE_GAP",
                domain="EVIDENCE",
                observation=f"Deterministic context marks evidence unavailable: {item}.",
                source_fields=[f"evidence_quality.unavailable_evidence:{item}"],
                trace_ref="context_packet:evidence_quality",
                impact=IMPACT_ADVISORY,
                lane=LANE_PLATFORM,
                deployment_id=dep_id,
            )
        )
    ht = packet.get("health_trajectory") or {}
    recon = ht.get("reconciliation") or {}
    if recon.get("health_history_available") is False and _str(
        (packet.get("current_state") or {}).get("current_health")
    ):
        out.append(
            _condition(
                code="HEALTH_EVENT_HISTORY_SPARSE",
                domain="HEALTH",
                observation=(
                    "HealthEvents historized trace is empty or sparse while current health is populated; "
                    "trajectory interpretation relies on current state and limited history."
                ),
                source_fields=["health_trajectory.health_event_count", "health_trajectory.reconciliation"],
                trace_ref="context_packet:health_trajectory",
                impact=IMPACT_ADVISORY,
                lane=LANE_PLATFORM,
                deployment_id=dep_id,
            )
        )
    return out


def detect_stewardship_conditions(
    packet: Dict[str, Any], snapshot_date: Optional[str] = None
) -> List[Dict[str, Any]]:
    """System-of-record QA conditions — factual, no blame."""
    out: List[Dict[str, Any]] = []
    meta = packet.get("metadata") or {}
    dep_id = _str(meta.get("deployment_id"))
    snap = snapshot_date or _str(meta.get("snapshot_date")) or date.today().isoformat()
    cs = packet.get("current_state") or {}
    stage = _stage_bucket(cs.get("deployment_stage"))
    health = _str(cs.get("current_health"))
    mtp = _str(cs.get("current_mtp"))
    days_mtp = cs.get("days_relative_to_mtp")

    if not mtp:
        out.append(
            _condition(
                code="CURRENT_MTP_MISSING",
                domain="SCHEDULE",
                observation="Current MTP is unavailable and cannot be reconstructed from supplied context.",
                source_fields=["current_state.current_mtp"],
                trace_ref="context_packet:current_state",
                impact=IMPACT_BLOCKING,
                lane=LANE_STEWARDSHIP,
                deployment_id=dep_id,
            )
        )

    ht = packet.get("health_trajectory") or {}
    recon = ht.get("reconciliation") or {}
    if recon.get("health_current_matches_last_event_new_health") is False:
        out.append(
            _condition(
                code="HEALTH_STATE_RECONCILIATION_MISMATCH",
                domain="HEALTH",
                observation=(
                    "Current health does not reconcile with the last historized HealthEvents transition; "
                    "interpretation of tenure and recent health change requires system-of-record review."
                ),
                source_fields=[
                    "current_state.current_health",
                    "health_trajectory.reconciliation.health_last_event_new_health",
                ],
                trace_ref="context_packet:health_trajectory.reconciliation",
                impact=IMPACT_REVIEW,
                lane=LANE_STEWARDSHIP,
                deployment_id=dep_id,
                age_days=recon.get("days_since_last_historized_health_change"),
            )
        )

    pf = packet.get("product_function") or {}
    pf_count = _int(pf.get("product_function_count"))
    completed = _int(pf.get("functions_completed"))
    remaining = _int(pf.get("functions_remaining"))
    if pf_count > 0 and pf.get("product_function_rollup_reconciled") is False:
        out.append(
            _condition(
                code="PF_ROLLUP_RECONCILIATION_MISMATCH",
                domain="PRODUCT_FUNCTION",
                observation=(
                    f"Product Function count ({pf_count}) does not reconcile to "
                    f"completed ({completed}) + remaining ({remaining})."
                ),
                source_fields=[
                    "product_function.product_function_count",
                    "product_function.functions_completed",
                    "product_function.functions_remaining",
                ],
                trace_ref="context_packet:product_function",
                impact=IMPACT_REVIEW,
                lane=LANE_STEWARDSHIP,
                deployment_id=dep_id,
            )
        )

    if pf_count > 0 and remaining == 0 and completed >= pf_count and stage in PRE_TERMINAL_STAGES:
        out.append(
            _condition(
                code="PF_COMPLETE_STAGE_NOT_TERMINAL",
                domain="LIFECYCLE",
                observation=(
                    f"All {pf_count} Product Functions appear complete while deployment stage remains "
                    f"{cs.get('deployment_stage')!r}."
                ),
                source_fields=["product_function", "current_state.deployment_stage"],
                trace_ref="context_packet:lifecycle",
                impact=IMPACT_REVIEW,
                lane=LANE_STEWARDSHIP,
                deployment_id=dep_id,
            )
        )

    st = packet.get("schedule_trajectory") or {}
    parent_recon = _str(st.get("parent_reconciliation_status"))
    if parent_recon in ("DATE_MISMATCH", "RECONSTRUCTED_BLANK_CURRENT_POPULATED"):
        out.append(
            _condition(
                code="PARENT_MTP_RECONCILIATION_MISMATCH",
                domain="SCHEDULE",
                observation=f"Parent MTP reconciliation status is {parent_recon}.",
                source_fields=["schedule_trajectory.parent_reconciliation_status"],
                trace_ref="context_packet:schedule_trajectory",
                impact=IMPACT_REVIEW,
                lane=LANE_STEWARDSHIP,
                deployment_id=dep_id,
            )
        )

    try:
        days_val = float(days_mtp) if days_mtp is not None and days_mtp != "" else None
    except (TypeError, ValueError):
        days_val = None
    if days_val is not None and days_val < -30 and remaining > 0:
        out.append(
            _condition(
                code="MTP_PASSED_REMAINING_PF_WORK",
                domain="SCHEDULE",
                observation=(
                    f"Parent MTP is {int(days_val)} days in the past while {remaining} Product Functions remain."
                ),
                source_fields=["current_state.days_relative_to_mtp", "product_function.functions_remaining"],
                trace_ref="context_packet:schedule_trajectory",
                impact=IMPACT_REVIEW,
                lane=LANE_STEWARDSHIP,
                deployment_id=dep_id,
            )
        )

    iv = packet.get("intervention") or {}
    if iv.get("has_open_health_plan"):
        dhp_days = iv.get("days_since_dhp_update")
        if dhp_days is not None and _int(dhp_days) > STALE_DHP_DAYS:
            out.append(
                _condition(
                    code="OPEN_HEALTH_PLAN_STALE_MAINTENANCE",
                    domain="INTERVENTION",
                    observation=(
                        f"Open Health Plan last updated {dhp_days} days before snapshot ({snap})."
                    ),
                    source_fields=["intervention.days_since_dhp_update", "intervention.has_open_health_plan"],
                    trace_ref="context_packet:intervention",
                    impact=IMPACT_REVIEW,
                    lane=LANE_STEWARDSHIP,
                    deployment_id=dep_id,
                    age_days=dhp_days,
                )
            )
        ah_days = iv.get("days_since_action_history_update")
        ah_health = _str(iv.get("action_history_latest_health_status"))
        if health and ah_health and health.lower() != ah_health.lower():
            out.append(
                _condition(
                    code="INTERVENTION_HEALTH_STATUS_DIVERGENCE",
                    domain="INTERVENTION",
                    observation=(
                        f"Current health is {health} while latest Action History health status is {ah_health}."
                    ),
                    source_fields=[
                        "current_state.current_health",
                        "intervention.action_history_latest_health_status",
                    ],
                    trace_ref="context_packet:intervention",
                    impact=IMPACT_REVIEW,
                    lane=LANE_STEWARDSHIP,
                    deployment_id=dep_id,
                    age_days=ah_days,
                )
            )
        if _int(iv.get("action_history_count")) == 0 and pf_count > 0:
            out.append(
                _condition(
                    code="OPEN_PLAN_WITHOUT_ACTION_HISTORY",
                    domain="INTERVENTION",
                    observation="Open Health Plan with no Action History records in context.",
                    source_fields=["intervention.has_open_health_plan", "intervention.action_history_count"],
                    trace_ref="context_packet:intervention",
                    impact=IMPACT_ADVISORY,
                    lane=LANE_STEWARDSHIP,
                    deployment_id=dep_id,
                )
            )

    if stage in TERMINAL_STAGES and iv.get("has_open_health_plan"):
        out.append(
            _condition(
                code="OPEN_INTERVENTION_AFTER_APPARENT_COMPLETION",
                domain="LIFECYCLE",
                observation=(
                    f"Deployment stage is {cs.get('deployment_stage')} while a Health Plan remains open."
                ),
                source_fields=["current_state.deployment_stage", "intervention.has_open_health_plan"],
                trace_ref="context_packet:lifecycle",
                impact=IMPACT_ADVISORY,
                lane=LANE_STEWARDSHIP,
                deployment_id=dep_id,
            )
        )

    return out


def _condition(
    code: str,
    domain: str,
    observation: str,
    source_fields: List[str],
    trace_ref: str,
    impact: str,
    lane: str,
    deployment_id: str,
    age_days: Any = None,
) -> Dict[str, Any]:
    return {
        "schema_version": STEWARDSHIP_SCHEMA_VERSION,
        "lane": lane,
        "condition_code": code,
        "affected_domain": domain,
        "observation": observation,
        "source_fields": source_fields,
        "trace_reference": trace_ref,
        "impact_classification": impact,
        "review_action": "SYSTEM_OF_RECORD_REVIEW_REQUIRED",
        "deployment_id": deployment_id,
        "age_or_staleness_days": age_days,
    }


def scan_portfolio_stewardship(
    packets: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Scan all deployments; return flat condition list and aggregate summary."""
    all_rows: List[Dict[str, Any]] = []
    by_code: Dict[str, int] = {}
    by_impact: Dict[str, int] = {}
    deps_with: set = set()

    for pkt in packets:
        meta = pkt.get("metadata") or {}
        dep_id = _str(meta.get("deployment_id"))
        for row in detect_platform_limitations(pkt) + detect_stewardship_conditions(pkt):
            all_rows.append(row)
            deps_with.add(dep_id)
            by_code[row["condition_code"]] = by_code.get(row["condition_code"], 0) + 1
            by_impact[row["impact_classification"]] = by_impact.get(row["impact_classification"], 0) + 1

    all_rows.sort(
        key=lambda r: (
            r.get("deployment_id", ""),
            r.get("lane", ""),
            r.get("condition_code", ""),
        )
    )
    summary = {
        "schema_version": STEWARDSHIP_SCHEMA_VERSION,
        "total_deployments_scanned": len(packets),
        "deployments_with_conditions": len(deps_with),
        "conditions_by_code": by_code,
        "conditions_by_impact": by_impact,
        "condition_count": len(all_rows),
    }
    return all_rows, summary


def stewardship_for_deployment(
    packet: Dict[str, Any],
) -> Dict[str, Any]:
    stewardship = detect_stewardship_conditions(packet)
    platform = detect_platform_limitations(packet)
    return {
        "deployment_data_stewardship": stewardship,
        "platform_evidence_limitations": platform,
        "has_stewardship": bool(stewardship),
        "has_platform_limitation": bool(platform),
    }

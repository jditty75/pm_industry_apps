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

# Rule-precision taxonomy (documentation + population metrics; not trajectory semantics).
RULE_CLASS_ACTIONABLE = "ACTIONABLE_STEWARDSHIP"
RULE_CLASS_CONTEXTUAL = "CONTEXTUAL_STEWARDSHIP"
RULE_CLASS_PLATFORM = "PLATFORM_LIMITATION"
RULE_CLASS_REFINEMENT = "NEEDS_RULE_REFINEMENT"

CONDITION_RULE_CLASS: Dict[str, str] = {
    "CURRENT_MTP_MISSING": RULE_CLASS_ACTIONABLE,
    "HEALTH_STATE_RECONCILIATION_MISMATCH": RULE_CLASS_ACTIONABLE,
    "PF_ROLLUP_RECONCILIATION_MISMATCH": RULE_CLASS_REFINEMENT,
    "PF_COMPLETE_STAGE_NOT_TERMINAL": RULE_CLASS_ACTIONABLE,
    "PARENT_MTP_RECONCILIATION_MISMATCH": RULE_CLASS_ACTIONABLE,
    "MTP_PASSED_REMAINING_PF_WORK": RULE_CLASS_CONTEXTUAL,
    "OPEN_HEALTH_PLAN_STALE_MAINTENANCE": RULE_CLASS_ACTIONABLE,
    "INTERVENTION_HEALTH_STATUS_DIVERGENCE": RULE_CLASS_ACTIONABLE,
    "OPEN_PLAN_WITHOUT_ACTION_HISTORY": RULE_CLASS_CONTEXTUAL,
    "OPEN_INTERVENTION_AFTER_APPARENT_COMPLETION": RULE_CLASS_CONTEXTUAL,
    "PF_TARGET_DATE_HISTORY_UNAVAILABLE": RULE_CLASS_PLATFORM,
    "PLATFORM_EVIDENCE_GAP": RULE_CLASS_PLATFORM,
    "HEALTH_EVENT_HISTORY_SPARSE": RULE_CLASS_PLATFORM,
    "PARENT_MTP_RECONSTRUCTION_LIMITATION": RULE_CLASS_PLATFORM,
}


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
    st = packet.get("schedule_trajectory") or {}
    parent_recon = _str(st.get("parent_reconciliation_status"))
    if parent_recon in (
        "RECONSTRUCTED_BLANK_CURRENT_POPULATED",
        "RECONSTRUCTED_POPULATED_CURRENT_BLANK",
    ):
        out.append(
            _condition(
                code="PARENT_MTP_RECONSTRUCTION_LIMITATION",
                domain="SCHEDULE",
                observation=(
                    f"Parent MTP reconciliation status is {parent_recon}; "
                    "baseline/history reconstruction cannot fully verify parent target lineage "
                    "in the current extract."
                ),
                source_fields=["schedule_trajectory.parent_reconciliation_status"],
                trace_ref="context_packet:schedule_trajectory",
                impact=IMPACT_ADVISORY,
                lane=LANE_PLATFORM,
                deployment_id=dep_id,
            )
        )

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

    st = packet.get("schedule_trajectory") or {}
    parent_recon = _str(st.get("parent_reconciliation_status"))

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

    if parent_recon == "DATE_MISMATCH":
        out.append(
            _condition(
                code="PARENT_MTP_RECONCILIATION_MISMATCH",
                domain="SCHEDULE",
                observation=(
                    "Parent MTP reconciliation status is DATE_MISMATCH between "
                    "reconstructed history and current parent target."
                ),
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
        "deployments_with_any_condition": len(deps_with),
        "deployments_with_conditions": len(deps_with),
        "conditions_by_code": by_code,
        "conditions_by_impact": by_impact,
        "condition_count": len(all_rows),
        "condition_count_platform": sum(1 for r in all_rows if r.get("lane") == LANE_PLATFORM),
        "condition_count_stewardship": sum(1 for r in all_rows if r.get("lane") == LANE_STEWARDSHIP),
    }
    return all_rows, summary


def _health_bucket(packet: Dict[str, Any]) -> str:
    return _str((packet.get("current_state") or {}).get("current_health")).lower() or "unknown"


def compute_stewardship_deployment_populations(
    packets: List[Dict[str, Any]],
    rows: List[Dict[str, Any]],
    candidate_ids: Optional[set] = None,
) -> Dict[str, Any]:
    """Distinct deployment populations — separate condition rows from deployment counts."""
    candidate_ids = candidate_ids or set()
    by_dep_rows: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        dep = _str(row.get("deployment_id"))
        if dep:
            by_dep_rows.setdefault(dep, []).append(row)

    packets_by_id = {
        _str((p.get("metadata") or {}).get("deployment_id")): p for p in packets
    }
    all_dep_ids = {_str((p.get("metadata") or {}).get("deployment_id")) for p in packets}
    all_dep_ids.discard("")

    deps_platform_any: set = set()
    deps_stewardship_any: set = set()
    deps_blocking: set = set()
    deps_review: set = set()
    deps_advisory_only: set = set()
    deps_multi_stewardship: set = set()

    for dep, dep_rows in by_dep_rows.items():
        plat = [r for r in dep_rows if r.get("lane") == LANE_PLATFORM]
        stew = [r for r in dep_rows if r.get("lane") == LANE_STEWARDSHIP]
        if plat:
            deps_platform_any.add(dep)
        if stew:
            deps_stewardship_any.add(dep)
            impacts = {r.get("impact_classification") for r in stew}
            if IMPACT_BLOCKING in impacts:
                deps_blocking.add(dep)
            if IMPACT_REVIEW in impacts:
                deps_review.add(dep)
            if impacts and impacts <= {IMPACT_ADVISORY}:
                deps_advisory_only.add(dep)
            if len(stew) > 1:
                deps_multi_stewardship.add(dep)

    deps_platform_only = {
        d
        for d in deps_platform_any
        if d not in deps_stewardship_any
    }

    deps_actionable: set = set()
    deps_contextual_only: set = set()
    for dep, dep_rows in by_dep_rows.items():
        stew = [r for r in dep_rows if r.get("lane") == LANE_STEWARDSHIP]
        if not stew:
            continue
        classes = {
            CONDITION_RULE_CLASS.get(r.get("condition_code", ""), RULE_CLASS_ACTIONABLE)
            for r in stew
        }
        if RULE_CLASS_ACTIONABLE in classes or RULE_CLASS_REFINEMENT in classes:
            deps_actionable.add(dep)
        elif RULE_CLASS_CONTEXTUAL in classes:
            deps_contextual_only.add(dep)

    stage_dist: Dict[str, int] = {}
    health_dist_all: Dict[str, int] = {}
    for p in packets:
        cs = p.get("current_state") or {}
        dep = _str((p.get("metadata") or {}).get("deployment_id"))
        stage = _str(cs.get("deployment_stage")) or "unknown"
        stage_dist[stage] = stage_dist.get(stage, 0) + 1
        if dep in deps_actionable:
            h = _health_bucket(p)
            health_dist_all[h] = health_dist_all.get(h, 0) + 1

    overlap_candidates = deps_stewardship_any & candidate_ids
    no_signal_ids = all_dep_ids - candidate_ids
    overlap_no_signal = deps_stewardship_any & no_signal_ids

    def stew_by_health(ids: set) -> Dict[str, int]:
        dist: Dict[str, int] = {}
        for dep in ids:
            pkt = packets_by_id.get(dep) or {}
            h = _health_bucket(pkt)
            dist[h] = dist.get(h, 0) + 1
        return dist

    rule_ambiguity_notes = []
    high_volume_codes = (
        "PF_ROLLUP_RECONCILIATION_MISMATCH",
        "PARENT_MTP_RECONCILIATION_MISMATCH",
        "CURRENT_MTP_MISSING",
    )
    for code in high_volume_codes:
        count = sum(1 for r in rows if r.get("condition_code") == code)
        if not count:
            continue
        lane = next((r.get("lane") for r in rows if r.get("condition_code") == code), "")
        if code == "CURRENT_MTP_MISSING":
            rule_ambiguity_notes.append(
                f"{code}: classified DEPLOYMENT_DATA_STEWARDSHIP (BLOCKING) — "
                f"deployment-specific missing MTP in system of record ({count} condition rows)."
            )
        elif code == "PARENT_MTP_RECONCILIATION_MISMATCH":
            rule_ambiguity_notes.append(
                f"{code}: DATE_MISMATCH only — actionable SoR review ({count} condition rows). "
                "RECONSTRUCTED_* parent statuses emit PARENT_MTP_RECONSTRUCTION_LIMITATION (platform)."
            )
        elif code == "PF_ROLLUP_RECONCILIATION_MISMATCH":
            rule_ambiguity_notes.append(
                f"{code}: DEPLOYMENT_DATA_STEWARDSHIP — count/complete/remaining inconsistency in "
                f"extract ({count} condition rows); not a PF target-history platform gap."
            )

    return {
        "deployment_count_with_platform_limitation": len(deps_platform_any),
        "deployment_count_platform_limitations_only": len(deps_platform_only),
        "deployment_count_with_stewardship_condition": len(deps_stewardship_any),
        "deployment_count_stewardship_blocking": len(deps_blocking),
        "deployment_count_stewardship_review": len(deps_review),
        "deployment_count_stewardship_advisory_only": len(deps_advisory_only),
        "deployment_count_stewardship_multiple_conditions": len(deps_multi_stewardship),
        "overlap_stage1_candidates_with_stewardship": len(overlap_candidates),
        "overlap_stage1_no_signal_with_stewardship": len(overlap_no_signal),
        "stewardship_by_health_green": stew_by_health(
            {d for d in deps_stewardship_any if _health_bucket(packets_by_id.get(d) or {}) == "green"}
        ),
        "stewardship_by_health_yellow": stew_by_health(
            {d for d in deps_stewardship_any if _health_bucket(packets_by_id.get(d) or {}) == "yellow"}
        ),
        "stewardship_by_health_red": stew_by_health(
            {d for d in deps_stewardship_any if _health_bucket(packets_by_id.get(d) or {}) == "red"}
        ),
        "stewardship_deployment_count_green": len(
            [d for d in deps_stewardship_any if _health_bucket(packets_by_id.get(d) or {}) == "green"]
        ),
        "stewardship_deployment_count_yellow": len(
            [d for d in deps_stewardship_any if _health_bucket(packets_by_id.get(d) or {}) == "yellow"]
        ),
        "stewardship_deployment_count_red": len(
            [d for d in deps_stewardship_any if _health_bucket(packets_by_id.get(d) or {}) == "red"]
        ),
        "rule_ownership_notes": rule_ambiguity_notes,
        "deployment_count_actionable_stewardship": len(deps_actionable),
        "deployment_count_contextual_stewardship_only": len(deps_contextual_only),
        "deployment_count_actionable_or_contextual_stewardship": len(
            deps_actionable | deps_contextual_only
        ),
        "portfolio_stage_distribution": stage_dist,
        "actionable_stewardship_health_distribution": health_dist_all,
    }


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

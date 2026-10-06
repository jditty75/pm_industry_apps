"""VALIDATION_HEURISTIC_ONLY — candidate and Green cohort selection."""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from .evidence import index_dhp_and_actions
from .fields import as_float, as_int, normalize_date, normalize_id, parse_bool, trajectory_get


RECENT_DAYS = 90
HISTORICAL_DAYS = 365


def _gross_movement(t: Dict[str, Any]) -> float:
    return as_float(t.get("mtp_gross_movement_days"))


def _recent_parent_schedule_signal(t: Dict[str, Any], mtp_events: List[Dict[str, Any]], today_str: str) -> bool:
    today = date.fromisoformat(today_str)
    cutoff = today - timedelta(days=RECENT_DAYS)
    if as_int(t.get("mtp_changes_90d")) > 0 or as_int(t.get("mtp_slips_90d")) > 0:
        return True
    if as_int(t.get("function_target_changes_90d")) > 0:
        return True
    if as_float(t.get("function_target_gross_movement_days_90d")) > 0:
        return True
    if as_float(t.get("mtp_slip_days_90d")) > 0:
        return True
    for e in mtp_events:
        ed = normalize_date(e.get("event_date"))
        if not ed:
            continue
        try:
            if date.fromisoformat(ed) < cutoff:
                continue
        except ValueError:
            continue
        et = str(e.get("event_type") or "")
        if et == "FUNCTION_TARGET_CHANGE":
            continue
        if abs(as_float(e.get("movement_days"))) > 0:
            return True
    return False


def _historical_only_schedule_signal(
    t: Dict[str, Any], mtp_events: List[Dict[str, Any]], today_str: str
) -> bool:
    today = date.fromisoformat(today_str)
    recent = today - timedelta(days=RECENT_DAYS)
    old = today - timedelta(days=HISTORICAL_DAYS)
    had_old = False
    had_recent = _recent_parent_schedule_signal(t, mtp_events, today_str)
    for e in mtp_events:
        ed = normalize_date(e.get("event_date"))
        if not ed:
            continue
        try:
            d = date.fromisoformat(ed)
        except ValueError:
            continue
        if d < recent and d >= old and abs(as_float(e.get("movement_days"))) > 0:
            had_old = True
    return had_old and not had_recent


def demonstrable_dhp_and_action(
    dep_id: str,
    t: Dict[str, Any],
    dhp_by_dep: Dict[str, List[Dict]],
    action_idx_by_dep: Dict[str, List[Dict]],
) -> bool:
    source_dhp = len(dhp_by_dep.get(dep_id, []))
    idx = len(action_idx_by_dep.get(dep_id, []))
    traj_actions = as_int(t.get("action_history_record_count"))
    return source_dhp > 0 and (idx > 0 or traj_actions > 0)


def classify_green_primary(
    t: Dict[str, Any],
    mtp_events: List[Dict[str, Any]],
    intervention: Dict[str, Any],
    today_str: str,
) -> Tuple[str, List[str], List[str]]:
    """
    Returns (primary_class, g2_reasons, g3_reasons).
    G1 exclusive with G2/G3; G3 preferred over G2 when multiple apply.
    """
    health = str(t.get("current_health") or "").strip().lower()
    if health != "green":
        return "", [], []

    g2: List[str] = []
    g3: List[str] = []

    deteriorations = as_int(t.get("health_deteriorations_90d"))
    gross_life = _gross_movement(t)
    recent_sched = _recent_parent_schedule_signal(t, mtp_events, today_str)
    hist_only = _historical_only_schedule_signal(t, mtp_events, today_str)
    open_hp = parse_bool(t.get("has_open_health_plan"))
    src_dhp = intervention.get("source_dhp_rows", 0)
    idx_ah = intervention.get("source_action_history_index_rows", 0)
    warnings = str(t.get("build_warnings") or "")
    pf_count = as_int(t.get("product_function_count"))
    days_mtp = as_int(trajectory_get(t, "days_to_mtp"), 9999)
    fn_chg_90 = as_int(t.get("function_target_changes_90d"))
    health_chg_90 = as_int(t.get("health_changes_90d"))

    if recent_sched:
        g2.append("recent_parent_or_deployment_schedule_movement_90d")
    elif hist_only:
        g2.append("historical_schedule_volatility_stabilized")

    if gross_life >= 30:
        g2.append(f"lifetime_gross_movement_days={int(gross_life)}")
    if fn_chg_90 >= 1:
        g2.append(f"function_target_changes_90d={fn_chg_90}")
    if health_chg_90 >= 1:
        g2.append(f"health_changes_90d={health_chg_90}")
    if open_hp or src_dhp > 0 or idx_ah > 0:
        g2.append("intervention_evidence_present")
    if "parent_mtp_reconciliation_mismatch" in warnings:
        g2.append("parent_mtp_reconciliation_mismatch")

    if pf_count >= 3 and days_mtp <= 180:
        g3.append("multi_pf_with_mtp_within_180d")
    if open_hp and (src_dhp > 0 or idx_ah > 0):
        g3.append("open_health_plan_with_source_evidence")
    elif open_hp:
        g3.append("open_health_plan_trajectory_only")
    if len(g2) >= 2:
        g3.append("multiple_independent_divergence_dimensions")
    if recent_sched and (deteriorations >= 1 or health_chg_90 >= 1):
        g3.append("recent_schedule_and_health_activity")

    g1_ok = (
        deteriorations == 0
        and not recent_sched
        and gross_life < 15
        and not open_hp
        and src_dhp == 0
        and idx_ah == 0
        and fn_chg_90 == 0
        and "parent_mtp_reconciliation_mismatch" not in warnings
        and str(t.get("build_warnings") or "").strip() == ""
    )

    if len(g3) >= 2 or (len(g3) >= 1 and len(g2) >= 2):
        return "G3_green_leadership_attention_candidate", g2, g3
    if g2:
        return "G2_green_trajectory_divergence_candidate", g2, g3
    if g1_ok:
        return "G1_green_stable", g2, g3
    if g2:
        return "G2_green_trajectory_divergence_candidate", g2, g3
    return "", g2, g3


def assign_profiles(
    dep_id: str,
    t: Dict[str, Any],
    mtp_events: List[Dict[str, Any]],
    dhp_by_dep: Dict[str, List[Dict]],
    action_idx_by_dep: Dict[str, List[Dict]],
    intervention: Dict[str, Any],
    today_str: str,
    primary_green: str,
) -> List[str]:
    profiles: List[str] = []
    health = str(t.get("current_health") or "").strip().lower()
    prev = str(t.get("previous_health") or "").strip().lower()
    deteriorations = as_int(t.get("health_deteriorations_90d"))
    improvements = as_int(t.get("health_improvements_90d"))
    gross = _gross_movement(t)
    chg90 = as_int(t.get("mtp_changes_90d") or t.get("function_target_changes_90d"))
    grain = str(t.get("mtp_analysis_grain") or "")
    pf_count = as_int(t.get("product_function_count"))
    warnings = str(t.get("build_warnings") or "")
    recent_sched = _recent_parent_schedule_signal(t, mtp_events, today_str)

    if primary_green == "G1_green_stable":
        profiles.append("G1_green_stable")
    elif primary_green == "G2_green_trajectory_divergence_candidate":
        profiles.append("G2_green_trajectory_divergence_candidate")
    elif primary_green == "G3_green_leadership_attention_candidate":
        profiles.append("G3_green_leadership_attention_candidate")

    if health in ("yellow", "red"):
        profiles.append("yellow_or_red")
    if deteriorations >= 1:
        profiles.append("recent_deterioration")
    elif prev and prev in ("yellow", "red") and health == "green" and improvements >= 1:
        profiles.append("health_recovery")
    elif improvements >= 1 and health == "green":
        profiles.append("health_recovery")

    if recent_sched or chg90 >= 1 or gross >= 1:
        profiles.append("schedule_movement")
    if grain == "PRODUCT_FUNCTION" and pf_count >= 2:
        profiles.append("multi_pf_grain")
    if pf_count >= 2:
        profiles.append("pf_complexity")
    if demonstrable_dhp_and_action(dep_id, t, dhp_by_dep, action_idx_by_dep):
        profiles.append("dhp_and_action_history")
    completed = as_int(trajectory_get(t, "pf_completed"))
    remaining = as_int(trajectory_get(t, "pf_remaining"))
    if completed >= 1 and remaining >= 1:
        profiles.append("completed_and_remaining_pf")
    if "parent_mtp_reconstruction_failed" in warnings or "insufficient_product_function" in warnings:
        profiles.append("sparse_history")

    if not profiles:
        profiles.append("representative_control")
    return profiles


def score_deployment(profiles: List[str], t: Dict[str, Any]) -> float:
    score = len(set(profiles)) * 10
    health = str(t.get("current_health") or "").lower()
    score += 3 if health in ("yellow", "red") else 0
    score += min(_gross_movement(t) / 10, 20)
    return score


def select_green_cohort(
    trajectory: List[Dict[str, Any]],
    bundles_by_id: Dict[str, Dict[str, Any]],
    today_str: str,
) -> Dict[str, Any]:
    """Pick 2-3 per G1/G2/G3 when evidence supports it."""
    buckets: Dict[str, List[Tuple[float, str]]] = {
        "G1_green_stable": [],
        "G2_green_trajectory_divergence_candidate": [],
        "G3_green_leadership_attention_candidate": [],
    }
    for t in trajectory:
        if str(t.get("current_health") or "").lower() != "green":
            continue
        dep_id = normalize_id(t.get("deployment_id"))
        if not dep_id:
            continue
        b = bundles_by_id.get(dep_id) or {}
        primary = b.get("primary_green_validation_class", "")
        if primary not in buckets:
            continue
        buckets[primary].append((score_deployment(b.get("profiles") or [], t), dep_id))

    selected: Dict[str, List[str]] = {}
    insufficient: Dict[str, str] = {}
    for key, items in buckets.items():
        items.sort(key=lambda x: (-x[0], x[1]))
        picks = [d for _, d in items[:3]]
        selected[key] = picks
        if len(picks) < 2:
            insufficient[key] = (
                f"INSUFFICIENT_EVIDENCE_FOR_{key}: only {len(picks)} deployment(s) "
                f"matched primary class in workbook population"
            )

    return {
        "selected_by_class": selected,
        "insufficient": insufficient,
        "population_counts": {k: len(v) for k, v in buckets.items()},
    }


def select_validation_candidates(
    trajectory: List[Dict[str, Any]],
    health_events: List[Dict[str, Any]],
    mtp_events: List[Dict[str, Any]],
    active_deps: List[Dict[str, Any]],
    pf_by_dep: Dict[str, List[Dict]],
    dhp_rows: List[Dict[str, Any]],
    dhp_action: List[Dict[str, Any]],
    action_idx: List[Dict[str, Any]],
    today_str: str,
    bundles_by_id: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    from .evidence import index_health_events, index_mtp_events

    dep_name = {normalize_id(d.get("Id")): d.get("Name") for d in active_deps}
    dep_customer = {
        normalize_id(d.get("Id")): d.get("Customer__r.Name") or d.get("Customer__c") for d in active_deps
    }

    he_by_dep = index_health_events(health_events)
    mtp_by_dep = index_mtp_events(mtp_events)
    dhp_by_dep, action_by_dep, action_idx_by_dep, _ = index_dhp_and_actions(
        dhp_rows, dhp_action, action_idx
    )

    scored: List[Tuple[float, str, List[str], str]] = []
    traj_by = {normalize_id(t.get("deployment_id")): t for t in trajectory}

    for t in trajectory:
        dep_id = normalize_id(t.get("deployment_id"))
        if not dep_id:
            continue
        b = bundles_by_id.get(dep_id, {})
        intervention = b.get("intervention") or {}
        primary = b.get("primary_green_validation_class", "")
        mtp_ev = mtp_by_dep.get(dep_id, [])
        profiles = assign_profiles(
            dep_id, t, mtp_ev, dhp_by_dep, action_idx_by_dep, intervention, today_str, primary
        )
        scored.append((score_deployment(profiles, t), dep_id, profiles, primary))

    scored.sort(key=lambda x: (-x[0], x[1]))

    required_buckets = [
        "G1_green_stable",
        "G2_green_trajectory_divergence_candidate",
        "G3_green_leadership_attention_candidate",
        "yellow_or_red",
        "recent_deterioration",
        "health_recovery",
        "schedule_movement",
        "multi_pf_grain",
        "dhp_and_action_history",
        "completed_and_remaining_pf",
        "sparse_history",
    ]

    profiles_hit: Counter = Counter()
    chosen: Dict[str, Dict] = {}

    def try_add(dep_id: str, profiles: List[str]) -> bool:
        if dep_id in chosen or len(chosen) >= 14:
            return False
        chosen[dep_id] = {
            "profiles": profiles,
            "name": dep_name.get(dep_id, ""),
            "customer": dep_customer.get(dep_id, ""),
            "primary_green_validation_class": bundles_by_id.get(dep_id, {}).get(
                "primary_green_validation_class", ""
            ),
        }
        for p in profiles:
            profiles_hit[p] += 1
        return True

    green_cohort = select_green_cohort(trajectory, bundles_by_id, today_str)
    for class_key, dep_ids in green_cohort["selected_by_class"].items():
        for dep_id in dep_ids:
            for score, did, profiles, _ in scored:
                if did == dep_id:
                    try_add(did, profiles)
                    break

    for bucket in required_buckets:
        for score, dep_id, profiles, _ in scored:
            if bucket in profiles:
                try_add(dep_id, profiles)
                break

    for score, dep_id, profiles, _ in scored:
        if str(traj_by.get(dep_id, {}).get("current_health") or "").lower() in ("yellow", "red"):
            try_add(dep_id, profiles)
        if len(chosen) >= 14:
            break

    for score, dep_id, profiles, _ in scored:
        if len(chosen) >= 14:
            break
        try_add(dep_id, profiles)

    out: Dict[str, Any] = {
        "_profile_coverage": dict(profiles_hit),
        "_green_cohort": green_cohort,
    }
    for dep_id, meta in chosen.items():
        bundle = bundles_by_id.get(dep_id) or {}
        out[dep_id] = {**bundle, **meta}
    return out

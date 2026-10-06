"""Orchestrate bundle build, selection, integrity, and outputs."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List, Tuple

from .evidence import (
    build_deployment_bundle,
    index_dhp_and_actions,
    index_health_events,
    index_mtp_events,
)
from .fields import normalize_id
from .integrity import audit_sample_integrity, run_integrity_checks_full
from .selectors import classify_green_primary, select_validation_candidates


def build_all_bundles(
    trajectory: List[Dict[str, Any]],
    health_events: List[Dict[str, Any]],
    mtp_events: List[Dict[str, Any]],
    active_deps: List[Dict[str, Any]],
    pf_by_dep: Dict[str, List[Dict]],
    dhp_rows: List[Dict[str, Any]],
    dhp_action: List[Dict[str, Any]],
    action_idx: List[Dict[str, Any]],
    today_str: str,
) -> Dict[str, Dict[str, Any]]:
    dep_name = {normalize_id(d.get("Id")): d.get("Name") for d in active_deps}
    dep_customer = {
        normalize_id(d.get("Id")): d.get("Customer__r.Name") or d.get("Customer__c") for d in active_deps
    }
    he_by_dep = index_health_events(health_events)
    mtp_by_dep = index_mtp_events(mtp_events)
    dhp_by_dep, action_by_dep, action_idx_by_dep, _ = index_dhp_and_actions(
        dhp_rows, dhp_action, action_idx
    )

    bundles: Dict[str, Dict[str, Any]] = {}
    for t in trajectory:
        dep_id = normalize_id(t.get("deployment_id"))
        if not dep_id:
            continue
        mtp_ev = mtp_by_dep.get(dep_id, [])
        intervention_stub = {
            "source_dhp_rows": len(dhp_by_dep.get(dep_id, [])),
            "source_action_history_index_rows": len(action_idx_by_dep.get(dep_id, [])),
        }
        from .evidence import intervention_evidence

        intervention = intervention_evidence(
            t, dhp_by_dep, action_idx_by_dep, action_by_dep, dep_id
        )
        primary, g2, g3 = classify_green_primary(t, mtp_ev, intervention, today_str)
        meta = {
            "profiles": [],
            "name": dep_name.get(dep_id, t.get("deployment_name", "")),
            "customer": dep_customer.get(dep_id, t.get("customer_name", "")),
            "primary_green_validation_class": primary,
            "green_g2_reasons": g2,
            "green_g3_reasons": g3,
            "green_selection_reasons": g3 if primary.startswith("G3") else (g2 if primary.startswith("G2") else ["stable_in_available_evidence"]),
        }
        bundles[dep_id] = build_deployment_bundle(
            dep_id,
            t,
            meta,
            he_by_dep,
            mtp_by_dep,
            dhp_by_dep,
            action_idx_by_dep,
            action_by_dep,
            pf_by_dep,
            today_str,
        )
        bundles[dep_id]["primary_green_validation_class"] = primary
        bundles[dep_id]["green_g2_reasons"] = g2
        bundles[dep_id]["green_g3_reasons"] = g3
    return bundles


def pick_audit_sample(
    candidates: Dict[str, Any], green_cohort: Dict[str, Any]
) -> List[str]:
    sample: List[str] = []
    sel = green_cohort.get("selected_by_class") or {}
    for key in (
        "G1_green_stable",
        "G2_green_trajectory_divergence_candidate",
        "G3_green_leadership_attention_candidate",
    ):
        if sel.get(key):
            sample.append(sel[key][0])
    for dep_id, bundle in candidates.items():
        if dep_id.startswith("_"):
            continue
        profiles = bundle.get("profiles") or []
        if "yellow_or_red" in profiles and dep_id not in sample:
            sample.append(dep_id)
            break
    for dep_id, bundle in candidates.items():
        if dep_id.startswith("_"):
            continue
        if "dhp_and_action_history" in (bundle.get("profiles") or []) and dep_id not in sample:
            sample.append(dep_id)
            break
    for dep_id, bundle in candidates.items():
        if dep_id.startswith("_"):
            continue
        if "schedule_movement" in (bundle.get("profiles") or []) and dep_id not in sample:
            sample.append(dep_id)
            break
    return sample

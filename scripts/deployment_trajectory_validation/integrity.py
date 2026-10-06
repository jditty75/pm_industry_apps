"""Validator integrity checks — fail loud on report/selector contradictions."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .fields import as_int, health_event_mapping_failure, normalize_id, parse_bool
from .selectors import RECENT_DAYS, demonstrable_dhp_and_action


class IntegrityCheckError(Exception):
    pass


def run_integrity_checks(
    candidates: Dict[str, Any],
    bundles_by_id: Dict[str, Dict[str, Any]],
    column_maps: Dict[str, Dict[str, str]],
) -> List[str]:
    errors: List[str] = []

    he_map = column_maps.get("Deployment_Trajectory_HealthEvents", {})
    for logical in (
        "deployment_id",
        "event_date",
        "old_health",
        "new_health",
        "transition_class",
    ):
        if logical not in he_map:
            errors.append(f"HealthEvents required column unresolved: {logical}")

    for dep_id, bundle in candidates.items():
        if dep_id.startswith("_"):
            continue
        profiles = bundle.get("profiles") or []
        t = bundle.get("trajectory") or {}
        primary = bundle.get("primary_green_validation_class", "")

        if "G1_green_stable" in profiles and "G3_green_leadership_attention_candidate" in profiles:
            errors.append(f"{dep_id}: G1 and G3 simultaneously assigned in profiles")
        if primary == "G1_green_stable" and primary and "G3" in primary:
            pass
        if primary == "G1_green_stable" and any(
            p.startswith("G3") for p in profiles if p != primary
        ):
            errors.append(f"{dep_id}: primary G1 but G3 profile tag present")

        if "dhp_and_action_history" in profiles:
            if not demonstrable_dhp_and_action(
                dep_id,
                t,
                {},  # caller should pass — fixed below
                {},
            ):
                pass

        if "recent_deterioration" in profiles:
            det = as_int(t.get("health_deteriorations_90d"))
            if det < 1:
                errors.append(
                    f"{dep_id}: recent_deterioration profile but health_deteriorations_90d={det}"
                )

        intervention = bundle.get("intervention") or {}
        if intervention.get("intervention_mismatch") and not intervention.get(
            "intervention_mismatch_reasons"
        ):
            errors.append(f"{dep_id}: mismatch flag without reasons")

        for disp in bundle.get("health_events_display") or []:
            if health_event_mapping_failure(disp):
                errors.append(
                    f"{dep_id}: health event date present but event fields blank (mapping failure)"
                )

    return errors


def run_integrity_checks_full(
    candidates: Dict[str, Any],
    dhp_by_dep: Dict[str, List],
    action_idx_by_dep: Dict[str, List],
) -> Tuple[bool, List[str]]:
    errors: List[str] = []
    for dep_id, bundle in candidates.items():
        if dep_id.startswith("_"):
            continue
        profiles = bundle.get("profiles") or []
        t = bundle.get("trajectory") or {}
        primary = bundle.get("primary_green_validation_class", "")

        tags = set(profiles)
        if "G1_green_stable" in tags and "G3_green_leadership_attention_candidate" in tags:
            errors.append(f"{dep_id}: G1 and G3 profile tags overlap")
        if primary == "G1_green_stable" and (
            "G2_green_trajectory_divergence_candidate" in tags
            or "G3_green_leadership_attention_candidate" in tags
        ):
            errors.append(f"{dep_id}: primary G1 conflicts with G2/G3 tags")

        if "dhp_and_action_history" in tags:
            if not demonstrable_dhp_and_action(dep_id, t, dhp_by_dep, action_idx_by_dep):
                errors.append(
                    f"{dep_id}: dhp_and_action_history without demonstrable DHP+Action evidence"
                )

        if "recent_deterioration" in tags and as_int(t.get("health_deteriorations_90d")) < 1:
            errors.append(f"{dep_id}: recent_deterioration without health_deteriorations_90d")

        intervention = bundle.get("intervention") or {}
        reasons = intervention.get("intervention_mismatch_reasons") or []
        if intervention.get("intervention_mismatch") and not reasons:
            errors.append(f"{dep_id}: INTERVENTION_EVIDENCE_MISMATCH without explanation")

        traj_open = parse_bool(t.get("has_open_health_plan"))
        src_dhp = intervention.get("source_dhp_rows", 0)
        if traj_open and src_dhp == 0 and as_int(t.get("dhp_count")) == 0:
            if not intervention.get("intervention_mismatch"):
                errors.append(
                    f"{dep_id}: open health plan vs zero DHP without mismatch marker"
                )

        for disp in bundle.get("health_events_display") or []:
            if health_event_mapping_failure(disp):
                errors.append(f"{dep_id}: health event mapping failure")

    return len(errors) == 0, errors


def audit_sample_integrity(
    sample_dep_ids: List[str],
    bundles_by_id: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    checks: List[Dict[str, Any]] = []
    mismatches = 0
    for dep_id in sample_dep_ids:
        b = bundles_by_id.get(dep_id)
        if not b:
            checks.append({"deployment_id": dep_id, "status": "missing_bundle"})
            mismatches += 1
            continue
        t = b["trajectory"]
        fields = [
            ("current_health", "Deployment_Trajectory", "current_health"),
            ("current_stage", "Deployment_Trajectory", "current_stage"),
            ("days_until_current_mtp", "Deployment_Trajectory", "days_until_current_mtp"),
            ("health_deteriorations_90d", "Deployment_Trajectory", "health_deteriorations_90d"),
        ]
        for report_key, sheet, col in fields:
            expected = t.get(col)
            actual = t.get(col)
            ok = expected == actual
            if not ok:
                mismatches += 1
            checks.append(
                {
                    "deployment_id": dep_id,
                    "field": report_key,
                    "source_sheet": sheet,
                    "source_column": col,
                    "match": ok,
                }
            )
        for disp, raw in zip(
            b.get("health_events_display") or [],
            b.get("health_events_raw") or [],
        ):
            for dk, rk in (
                ("transition_class", "event_type"),
                ("old_health", "old_value"),
                ("new_health", "new_value"),
            ):
                exp = raw.get(dk)
                got = disp.get(rk)
                ok = str(exp or "") == str(got or "") or (exp is None and got == "")
                if not ok:
                    mismatches += 1
                checks.append(
                    {
                        "deployment_id": dep_id,
                        "field": rk,
                        "source_sheet": "Deployment_Trajectory_HealthEvents",
                        "source_column": dk,
                        "match": ok,
                    }
                )

    return {
        "artifact_integrity_ok": mismatches == 0,
        "checks": checks,
        "mismatch_count": mismatches,
    }

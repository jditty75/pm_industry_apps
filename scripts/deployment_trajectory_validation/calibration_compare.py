"""Semantic equivalence checks for CAL-01..03 context packets (no customer names in Git)."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple


def _has(packet: Dict[str, Any], path: str, predicate) -> bool:
    cur: Any = packet
    for part in path.split("."):
        if not isinstance(cur, dict):
            return False
        cur = cur.get(part)
    return bool(predicate(cur))


def cal01_material_checks(packet: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Historical volatility + current stabilization (extract may lack full trace — limitations must be explicit)."""
    missing: List[str] = []
    cs = packet.get("current_state") or {}
    if str(cs.get("current_health") or "").lower() != "green":
        missing.append("current_health Green (stabilization)")
    ht = packet.get("health_trajectory") or {}
    st = packet.get("schedule_trajectory") or {}
    lifetime = st.get("lifetime") or {}
    eq = packet.get("evidence_quality") or {}
    warnings = str(eq.get("build_warnings") or "")
    factors = eq.get("factors") or []

    has_historical_signal_or_limitation = bool(
        ht.get("health_event_count", 0)
        or ht.get("selected_events")
        or lifetime.get("gross_movement_days") not in (None, "", 0)
        or lifetime.get("mtp_event_count", 0)
        or warnings
        or factors
        or (ht.get("reconciliation") or {}).get("caveats")
    )
    if not has_historical_signal_or_limitation:
        missing.append("historical volatility metrics or explicit evidence-limitation metadata")

    recent90 = st.get("recent_90d") or {}
    if recent90.get("target_changes") is None:
        missing.append("recent_90d.target_changes")
    if "product_function_target_date_history" not in (eq.get("unavailable_evidence") or []):
        missing.append("PF target history unavailable flag")
    if not st.get("movement_contract"):
        missing.append("schedule movement_contract")
    return (not missing, missing)


def cal02_material_checks(packet: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Displacement + lifecycle exposure + evidence ambiguity."""
    missing: List[str] = []
    pf = packet.get("product_function") or {}
    grain = (packet.get("current_state") or {}).get("mtp_analysis_grain")
    if grain not in ("PRODUCT_FUNCTION", "DEPLOYMENT", "DEPLOYMENT_ONLY"):
        missing.append("mtp_analysis_grain")
    if pf.get("product_function_count", 0) <= 0 and grain == "PRODUCT_FUNCTION":
        missing.append("expected PF count at PRODUCT_FUNCTION grain")
    st = packet.get("schedule_trajectory") or {}
    if not st.get("movement_contract"):
        missing.append("schedule movement_contract")
    recon = st.get("parent_reconciliation_status")
    if recon is None:
        missing.append("parent_reconciliation_status")
    hist = st.get("historical_365d") or {}
    if hist.get("historical_mtp_event_count_excl_recent_90d") is None and not st.get("selected_events"):
        missing.append("historical schedule evidence")
    return (not missing, missing)


def cal03_material_checks(packet: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Green + intervention + remaining delivery exposure."""
    missing: List[str] = []
    cs = packet.get("current_state") or {}
    if str(cs.get("current_health") or "").lower() != "green":
        missing.append("current_health Green")
    iv = packet.get("intervention") or {}
    if not iv.get("has_open_health_plan") and iv.get("dhp_count", 0) <= 0:
        missing.append("intervention / DHP evidence")
    if iv.get("action_history_count", 0) <= 0 and iv.get("action_history_index_row_count", 0) <= 0:
        missing.append("action history counts")
    pf = packet.get("product_function") or {}
    if pf.get("functions_remaining", 0) <= 0 and pf.get("product_function_count", 0) > 0:
        missing.append("remaining PF delivery exposure")
    if not iv.get("selected_narratives"):
        missing.append("selected intervention narratives (CAL-03 manual packet included excerpts)")
    return (not missing, missing)


CALIBRATION_CHECKS = {
    "CAL-01": cal01_material_checks,
    "CAL-02": cal02_material_checks,
    "CAL-03": cal03_material_checks,
}

"""Workbook sheet contracts and column resolution (header name, not position)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

# Canonical sheet name -> acceptable physical names (Excel truncation)
SHEET_CANONICAL: Dict[str, List[str]] = {
    "SFDC_Deployments": ["SFDC_Deployments"],
    "SFDC_DeploymentHistory": ["SFDC_DeploymentHistory"],
    "SFDC_DeploymentProductFunctions": ["SFDC_DeploymentProductFunctions"],
    "SFDC_DeploymentProductFunctionHistory": [
        "SFDC_DeploymentProductFunctionHistory",
        "SFDC_DeploymentProductFunctionH",
    ],
    "SFDC_DHP": ["SFDC_DHP"],
    "SFDC_DHPActionHistory": ["SFDC_DHPActionHistory"],
    "Deployment_Trajectory": ["Deployment_Trajectory"],
    "Deployment_Trajectory_HealthEvents": [
        "Deployment_Trajectory_HealthEvents",
        "Deployment_Trajectory_HealthEve",
    ],
    "Deployment_Trajectory_MtpEvents": ["Deployment_Trajectory_MtpEvents"],
    "Deployment_Trajectory_ActionHistory_Index": [
        "Deployment_Trajectory_ActionHistory_Index",
        "Deployment_Trajectory_ActionHis",
    ],
}

# Required columns per canonical sheet (logical names). Aliases map workbook headers -> logical.
SHEET_REQUIRED_COLUMNS: Dict[str, List[str]] = {
    "SFDC_Deployments": ["Id"],
    "SFDC_DeploymentHistory": ["ParentId"],
    "SFDC_DeploymentProductFunctions": ["Id", "Deployment__c"],
    "SFDC_DeploymentProductFunctionHistory": ["ParentId", "Field"],
    "SFDC_DHP": ["Id"],
    "SFDC_DHPActionHistory": ["Deployment_Health_Plan__c"],
    "Deployment_Trajectory": ["deployment_id", "current_health"],
    "Deployment_Trajectory_HealthEvents": [
        "deployment_id",
        "event_date",
        "old_health",
        "new_health",
        "transition_class",
    ],
    "Deployment_Trajectory_MtpEvents": [
        "deployment_id",
        "event_date",
        "event_type",
        "old_date",
        "new_date",
        "movement_days",
    ],
    "Deployment_Trajectory_ActionHistory_Index": [
        "deployment_id",
        "dhp_id",
        "action_history_id",
    ],
}

# Logical trajectory fields used in HTML -> acceptable trajectory column names
TRAJECTORY_FIELD_ALIASES: Dict[str, List[str]] = {
    "last_health_change_date": ["health_last_change_date", "last_health_change_date"],
    "days_to_mtp": ["days_until_current_mtp", "days_to_current_mtp"],
    "mtp_gross_movement_90d": [
        "mtp_slip_days_90d",
        "function_target_gross_movement_days_90d",
        "mtp_gross_movement_days",
    ],
    "mtp_net_movement_90d": ["mtp_net_movement_days", "mtp_net_movement_comparison"],
    "pf_completed": ["product_functions_completed_count", "functions_actual_mtp_count"],
    "pf_remaining": ["product_functions_remaining_count", "functions_remaining_count"],
}

COLUMN_ALIASES: Dict[str, List[str]] = {
    # DHP deployment reference (export uses relationship column)
    "deployment_id_on_dhp": ["Deployment__c", "Deployment__r.Id", "DeploymentId"],
    "dhp_id_on_action": ["Deployment_Health_Plan__c", "DHP__c"],
    "deployment_on_pf": ["Deployment__c", "DeploymentId"],
}


def normalize_header(name: Any) -> str:
    return str(name or "").strip()


def build_header_map(headers: Sequence[Any]) -> Dict[str, int]:
    """Map normalized header -> first column index."""
    out: Dict[str, int] = {}
    for i, h in enumerate(headers):
        key = normalize_header(h)
        if key and key not in out:
            out[key] = i
    return out


def resolve_column(
    header_map: Dict[str, int],
    logical_name: str,
    aliases: Optional[Sequence[str]] = None,
    required: bool = False,
) -> Optional[str]:
    """Return the actual header string present in the sheet for logical_name."""
    candidates = [logical_name]
    if aliases:
        candidates = list(aliases) + candidates
    extra = COLUMN_ALIASES.get(logical_name)
    if extra:
        candidates = list(extra) + candidates
    for c in candidates:
        if c in header_map:
            return c
    if required:
        raise ValueError(f"Required column not resolved: {logical_name} (tried {candidates})")
    return None


def resolve_sheet_columns(
    canonical_sheet: str,
    header_map: Dict[str, int],
) -> Dict[str, str]:
    """Map logical column name -> actual header for required sheet columns."""
    required = SHEET_REQUIRED_COLUMNS.get(canonical_sheet, [])
    resolved: Dict[str, str] = {}
    missing: List[str] = []
    for logical in required:
        actual = resolve_column(header_map, logical, required=False)
        if actual:
            resolved[logical] = actual
        else:
            missing.append(logical)
    if missing:
        raise ValueError(
            f"Sheet {canonical_sheet}: missing required columns {missing}; "
            f"headers={sorted(header_map.keys())}"
        )
    return resolved


def row_get(row: Dict[str, Any], header: str) -> Any:
    return row.get(header, "")


class SchemaResolutionError(Exception):
    """Raised when workbook headers do not match contract."""

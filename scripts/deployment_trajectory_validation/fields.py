"""Shared normalizers and trajectory field access."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from .schema import TRAJECTORY_FIELD_ALIASES


def normalize_id(raw: Any) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    if len(s) >= 15:
        return s[:15]
    return s


def normalize_date(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    if not s:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    for fmt in ("%m/%d/%Y", "%Y-%m-%d %H:%M:%S", "%m/%d/%y"):
        try:
            return datetime.strptime(s[:19], fmt).date().isoformat()
        except ValueError:
            pass
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d.date().isoformat()
    except ValueError:
        return ""


def trajectory_get(t: Dict[str, Any], logical: str, default: Any = "") -> Any:
    if logical in t and t.get(logical) not in (None, ""):
        return t.get(logical)
    for alt in TRAJECTORY_FIELD_ALIASES.get(logical, []):
        v = t.get(alt)
        if v not in (None, ""):
            return v
    return default


def parse_bool(value: Any) -> bool:
    return str(value or "").strip().lower() in ("true", "1", "yes")


def signed_days_between(old_d: str, new_d: str) -> Optional[int]:
    if not old_d or not new_d:
        return None
    try:
        a = date.fromisoformat(old_d)
        b = date.fromisoformat(new_d)
    except ValueError:
        return None
    return (b - a).days


def resolve_dhp_deployment_id(row: Dict[str, Any]) -> str:
    for key in ("Deployment__c", "Deployment__r.Id", "DeploymentId"):
        v = row.get(key)
        if v not in (None, ""):
            return normalize_id(v)
    return ""


def health_event_display_row(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Map trace sheet columns to human-validation display names."""
    return {
        "event_date": raw.get("event_date", ""),
        "event_type": raw.get("transition_class", raw.get("event_type", "")),
        "old_value": raw.get("old_health", raw.get("old_value", "")),
        "new_value": raw.get("new_health", raw.get("new_value", "")),
        "_source": raw,
    }


def health_event_mapping_failure(display: Dict[str, Any]) -> bool:
    """Date present but all display fields empty => likely mapping failure."""
    ed = normalize_date(display.get("event_date"))
    if not ed:
        return False
    et = str(display.get("event_type") or "").strip()
    ov = str(display.get("old_value") or "").strip()
    nv = str(display.get("new_value") or "").strip()
    src = display.get("_source") or {}
    if src.get("old_health") or src.get("new_health") or src.get("transition_class"):
        return False
    return not et and not ov and not nv


def as_float(value: Any, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def as_int(value: Any, default: int = 0) -> int:
    if value in (None, ""):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default

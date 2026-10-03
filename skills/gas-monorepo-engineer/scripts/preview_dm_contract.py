#!/usr/bin/env python3
"""M1 preview fixture contracts derived from CoreUI_Js / WebAppCode consumption paths."""

from __future__ import annotations

from typing import Any

# Fields read by bootPhase2 success handler (getIdentityBoot)
IDENTITY_BOOT_USER_FIELDS = ("email", "displayName", "role", "active")
IDENTITY_BOOT_ACCESS_FIELDS = ("canViewApp", "role", "email")

# renderDataFreshnessBadge
FRESHNESS_FIELDS = ("status", "ageHours", "lastRefresh")

# normalizeDeploymentsPayload_ + renderDeploymentsTable / KPIs
DEPLOYMENT_ROW_FIELDS = (
    "deploymentId",
    "accountName",
    "deploymentName",
    "health",
    "stage",
    "phase",
    "partner",
    "rowIndex",
)

# renderOverviewKPIs, renderNextHighRisk, renderUpcomingGoLives, renderLifecyclePipeline
OVERVIEW_TOTALS_FIELDS = ("totalActive", "red", "yellow", "green", "executiveWatch")
OVERVIEW_TOP_RISK_FIELDS = ("accountName", "health", "currentMtp", "deploymentName", "partner")
OVERVIEW_UPCOMING_ITEM_FIELDS = ("accountName", "currentMtp", "deploymentName")
LIFECYCLE_KEYS = ("starting", "building", "landing")


def _missing_fields(obj: dict[str, Any], required: tuple[str, ...]) -> list[str]:
    return [f for f in required if f not in obj]


def validate_identity_boot(payload: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    user = payload.get("user")
    if not isinstance(user, dict):
        issues.append("identityBoot.user must be an object")
    else:
        issues.extend(f"identityBoot.user missing {f}" for f in _missing_fields(user, IDENTITY_BOOT_USER_FIELDS))
    if not isinstance(payload.get("activeUsers"), list):
        issues.append("identityBoot.activeUsers must be an array")
    access = payload.get("access")
    if not isinstance(access, dict):
        issues.append("identityBoot.access must be an object")
    else:
        issues.extend(f"identityBoot.access missing {f}" for f in _missing_fields(access, IDENTITY_BOOT_ACCESS_FIELDS))
    return issues


def validate_freshness(payload: dict[str, Any]) -> list[str]:
    issues = [f"freshness missing {f}" for f in _missing_fields(payload, FRESHNESS_FIELDS)]
    if payload.get("status") not in ("fresh", "aging", "stale", "unknown"):
        issues.append(f"freshness.status invalid: {payload.get('status')}")
    return issues


def validate_deployment_rows(rows: Any) -> list[str]:
    issues: list[str] = []
    if not isinstance(rows, list):
        return ["deployments must be an array (Industry) or wrapped in {rows}"]
    for i, row in enumerate(rows[:3]):
        if not isinstance(row, dict):
            issues.append(f"deployments[{i}] must be an object")
            continue
        issues.extend(f"deployments[{i}] missing {f}" for f in _missing_fields(row, DEPLOYMENT_ROW_FIELDS))
        if row.get("health") not in ("Red", "Yellow", "Green"):
            issues.append(f"deployments[{i}].health must be Red|Yellow|Green")
    return issues


def validate_overview(overview: Any) -> list[str]:
    issues: list[str] = []
    if not isinstance(overview, dict):
        return ["overview must be an object"]
    totals = overview.get("totals")
    if not isinstance(totals, dict):
        issues.append("overview.totals must be an object")
    else:
        issues.extend(f"overview.totals missing {f}" for f in _missing_fields(totals, OVERVIEW_TOTALS_FIELDS))
    if "executiveWatchEnabled" not in overview:
        issues.append("overview missing executiveWatchEnabled")
    ug = overview.get("upcomingGoLives")
    if not isinstance(ug, dict) or not isinstance(ug.get("items"), list):
        issues.append("overview.upcomingGoLives must be { total, items[] }")
    else:
        for i, item in enumerate(ug["items"][:2]):
            if isinstance(item, dict):
                issues.extend(
                    f"overview.upcomingGoLives.items[{i}] missing {f}"
                    for f in _missing_fields(item, OVERVIEW_UPCOMING_ITEM_FIELDS)
                )
    thr = overview.get("topHighRisk")
    if not isinstance(thr, list):
        issues.append("overview.topHighRisk must be an array")
    else:
        for i, item in enumerate(thr[:2]):
            if isinstance(item, dict):
                issues.extend(
                    f"overview.topHighRisk[{i}] missing {f}" for f in _missing_fields(item, OVERVIEW_TOP_RISK_FIELDS)
                )
    lb = overview.get("lifecycleBuckets")
    if not isinstance(lb, dict):
        issues.append("overview.lifecycleBuckets must be an object")
    else:
        for key in LIFECYCLE_KEYS:
            if key not in lb or not isinstance(lb[key], dict) or "count" not in lb[key]:
                issues.append(f"overview.lifecycleBuckets.{key} must include count")
    return issues


def validate_m1_bundle(bundle: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    issues.extend(validate_identity_boot(bundle.get("identityBoot") or {}))
    issues.extend(validate_freshness(bundle.get("freshness") or {}))
    issues.extend(validate_deployment_rows(bundle.get("deployments")))
    issues.extend(validate_overview(bundle.get("overview")))
    return issues


def assert_scenario_expectations(scenario: str, bundle: dict[str, Any]) -> list[str]:
    """Scenario-level acceptance (synthetic data must drive nonzero UI for mixed-health)."""
    issues: list[str] = []
    overview = bundle.get("overview") or {}
    totals = overview.get("totals") or {}
    rows = bundle.get("deployments") or []
    if scenario == "empty":
        if totals.get("totalActive", -1) != 0:
            issues.append("empty scenario must have totalActive=0")
        if rows:
            issues.append("empty scenario must have no deployment rows")
        return issues
    if scenario == "mixed-health":
        ta = totals.get("totalActive", 0)
        if ta <= 0:
            issues.append("mixed-health must have totalActive > 0")
        if totals.get("red", 0) < 1 or totals.get("yellow", 0) < 1 or totals.get("green", 0) < 2:
            issues.append("mixed-health needs red>=1, yellow>=1, green>=2")
        lb = overview.get("lifecycleBuckets") or {}
        for key in LIFECYCLE_KEYS:
            if (lb.get(key) or {}).get("count", 0) <= 0:
                issues.append(f"mixed-health lifecycleBuckets.{key}.count must be > 0")
        if len(rows) < 3:
            issues.append("mixed-health needs multiple deployment rows")
        return issues
    if scenario == "at-risk":
        if totals.get("red", 0) + totals.get("yellow", 0) < totals.get("green", 0) + 1:
            issues.append("at-risk should have more red+yellow than green")
        return issues
    return issues

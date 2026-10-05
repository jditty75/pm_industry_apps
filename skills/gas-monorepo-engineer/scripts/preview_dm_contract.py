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

GO_LIVES_ROW_FIELDS = ("deploymentId", "accountName", "partner")
GO_LIVES_EXPLORER_FIELDS = ("valid", "rows", "totalCount", "kpiSummary", "timeline", "filterOptions")
OVERRIDE_ROW_FIELDS = ("type", "accountName", "deploymentId", "classification", "hasOperationalOverride")

NOTABLE_ROW_FIELDS = (
    "deploymentId",
    "accountName",
    "validationStatus",
    "notabilityTrigger",
    "latestUpdate",
    "regionalOwner",
    "local",
)

NOTABLE_LOCAL_FIELDS = ("deploymentName", "partner", "health", "stage", "mtpDate")

NOTABLE_PICKER_FIELDS = ("deploymentId", "accountName", "deploymentName", "view")


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


def validate_go_lives_rows(rows: Any, label: str) -> list[str]:
    issues: list[str] = []
    if not isinstance(rows, list):
        return [f"{label} must be an array"]
    for i, row in enumerate(rows[:2]):
        if not isinstance(row, dict):
            issues.append(f"{label}[{i}] must be an object")
            continue
        issues.extend(f"{label}[{i}] missing {f}" for f in _missing_fields(row, GO_LIVES_ROW_FIELDS))
    return issues


def validate_golives_explorer(payload: Any) -> list[str]:
    issues: list[str] = []
    if not isinstance(payload, dict):
        return ["golivesExplorer must be an object"]
    issues.extend(f"golivesExplorer missing {f}" for f in _missing_fields(payload, GO_LIVES_EXPLORER_FIELDS))
    if payload.get("valid") is not True:
        issues.append("golivesExplorer.valid must be true for preview scenarios")
    return issues


def validate_active_overrides(rows: Any) -> list[str]:
    issues: list[str] = []
    if not isinstance(rows, list):
        return ["activeOverrides must be an array"]
    for i, row in enumerate(rows[:2]):
        if isinstance(row, dict):
            issues.extend(f"activeOverrides[{i}] missing {f}" for f in _missing_fields(row, OVERRIDE_ROW_FIELDS))
    return issues


def validate_m1_bundle(bundle: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    issues.extend(validate_identity_boot(bundle.get("identityBoot") or {}))
    issues.extend(validate_freshness(bundle.get("freshness") or {}))
    issues.extend(validate_deployment_rows(bundle.get("deployments")))
    issues.extend(validate_overview(bundle.get("overview")))
    return issues


def validate_notable_rows(rows: Any) -> list[str]:
    issues: list[str] = []
    if not isinstance(rows, list):
        return ["notableDeployments must be an array"]
    for i, row in enumerate(rows[:3]):
        if not isinstance(row, dict):
            issues.append(f"notableDeployments[{i}] must be an object")
            continue
        issues.extend(
            f"notableDeployments[{i}] missing {f}" for f in _missing_fields(row, NOTABLE_ROW_FIELDS)
        )
        local = row.get("local")
        if not isinstance(local, dict):
            issues.append(f"notableDeployments[{i}].local must be an object")
        else:
            issues.extend(
                f"notableDeployments[{i}].local missing {f}"
                for f in _missing_fields(local, NOTABLE_LOCAL_FIELDS)
            )
    return issues


def validate_notable_picker(rows: Any) -> list[str]:
    issues: list[str] = []
    if not isinstance(rows, list):
        return ["notablePicker must be an array"]
    for i, row in enumerate(rows[:2]):
        if isinstance(row, dict):
            issues.extend(
                f"notablePicker[{i}] missing {f}" for f in _missing_fields(row, NOTABLE_PICKER_FIELDS)
            )
    return issues


def validate_m2_bundle(bundle: dict[str, Any]) -> list[str]:
    issues = validate_m1_bundle(bundle)
    issues.extend(validate_go_lives_rows(bundle.get("recentGoLives"), "recentGoLives"))
    issues.extend(validate_go_lives_rows(bundle.get("upcomingGoLives"), "upcomingGoLives"))
    issues.extend(validate_golives_explorer(bundle.get("golivesExplorer")))
    issues.extend(validate_active_overrides(bundle.get("activeOverrides")))
    if not isinstance(bundle.get("overrideAuditLog"), list):
        issues.append("overrideAuditLog must be an array")
    issues.extend(validate_notable_rows(bundle.get("notableDeployments")))
    issues.extend(validate_notable_picker(bundle.get("notablePicker")))
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
        if bundle.get("recentGoLives") or bundle.get("upcomingGoLives"):
            issues.append("empty scenario must have no go-live rows")
        if bundle.get("activeOverrides"):
            issues.append("empty scenario must have no active overrides")
        if bundle.get("notableDeployments"):
            issues.append("empty scenario must have no notable deployments")
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
        notable = bundle.get("notableDeployments") or []
        if len(notable) < 3:
            issues.append("mixed-health needs >= 3 notable deployment rows")
        statuses = {str(r.get("validationStatus") or "") for r in notable if isinstance(r, dict)}
        if "Region Restricted" not in statuses:
            issues.append("mixed-health notable must include Region Restricted row")
        if not any(isinstance(r, dict) and not str(r.get("latestUpdate") or "").strip() for r in notable):
            issues.append("mixed-health notable must include blank latestUpdate row")
        picker = bundle.get("notablePicker") or []
        if len(picker) < 2:
            issues.append("mixed-health notablePicker needs recent+upcoming entries")
        return issues
    if scenario == "at-risk":
        if totals.get("red", 0) + totals.get("yellow", 0) < totals.get("green", 0) + 1:
            issues.append("at-risk should have more red+yellow than green")
        return issues
    if scenario == "notable-active-complete":
        from preview_dm_notable import NOTABLE_SCENARIO_IDS

        notable = bundle.get("notableDeployments") or []
        ids = {str(r.get("deploymentId") or "") for r in notable if isinstance(r, dict)}
        if NOTABLE_SCENARIO_IDS["active_only"] not in ids:
            issues.append("notable-active-complete must include active-only notable row")
        if NOTABLE_SCENARIO_IDS["complete_only"] not in ids:
            issues.append("notable-active-complete must include complete-only notable row")
        if NOTABLE_SCENARIO_IDS["transition"] not in ids:
            issues.append("notable-active-complete must include transitioned deployment row")
        if NOTABLE_SCENARIO_IDS["complete_no_peer"] in ids:
            issues.append("notable-active-complete must not surface complete-without-peer row")
        overlap = [r for r in notable if r.get("deploymentId") == NOTABLE_SCENARIO_IDS["overlap"]]
        if len(overlap) > 1:
            issues.append("notable-active-complete overlap id must appear once")
        if len(overlap) == 1 and (overlap[0].get("local") or {}).get("health") != "Yellow":
            issues.append("notable-active-complete overlap must prefer active health (Yellow)")
        if NOTABLE_SCENARIO_IDS["unresolved_peer"] in ids:
            issues.append("notable-active-complete must exclude unresolved peer without local")
        if len(notable) < 4:
            issues.append("notable-active-complete needs enough rows for layout testing")
        return issues
    return issues

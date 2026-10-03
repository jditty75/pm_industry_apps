#!/usr/bin/env python3
"""DM preview M2: Go Lives + Overrides fixture builders (synthetic only)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from preview_dm_fixtures import SCENARIOS, _add_days, _today_key
from preview_dm_notable import NOTABLE_READ_HANDLERS, attach_notable_bundle

M2_READ_HANDLERS = (
    "getRecentGoLivesData",
    "getUpcomingGoLivesData",
    "getGoLivesExplorerDataForUI",
    "getAllActiveOverridesForUI",
    "getOverrideAuditLogForUI",
)

M2_WRITE_HANDLERS = (
    "updateDeploymentWithMetaAndOverride",
    "updateGoLivesOverride",
    "setOverrideClassificationForUI",
    "clearSingleOverrideForUI",
)

M2_HANDLERS = tuple(M2_READ_HANDLERS) + tuple(M2_WRITE_HANDLERS) + tuple(NOTABLE_READ_HANDLERS)

M3_PLUS_METHODS = (
    "getTrendsDashboardData",
    "getCsatTabDataForUI",
    "getStudentTabData",
    "getEscalationsDashboardData",
    "getReportSendConfigForUI",
    "getGoLivesExplorerData",
    "getPortfolioHealthData",
    "getExecutiveSummaryHtml",
    "saveExecutiveSummaryHtml",
    "bulkClearMonthlyOverridesForUI",
    "sendMonthlyReportFromUI",
)

GO_LIVE_PRODUCTS = ("Core Financials", "HCM", "Payroll", "Planning")


def _iso_days_ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


def _gl_row_from_deployment(
    dep: dict[str, Any],
    *,
    record_type: str,
    gl_date: str,
    phased: bool = False,
) -> dict[str, Any]:
    products = [dep.get("productArea") or GO_LIVE_PRODUCTS[0]]
    base = {
        "rowIndex": dep.get("rowIndex", 0),
        "deploymentId": dep["deploymentId"],
        "accountId": f"PREVIEW_ACCT_{dep['deploymentId'][-4:]}",
        "accountName": dep["accountName"],
        "deploymentName": dep.get("deploymentName", ""),
        "partner": dep.get("partner") or "Preview Partner LLC",
        "industry": dep.get("industry") or "Public Sector Preview",
        "region": dep.get("region") or "Preview Region",
        "health": dep.get("health") or "Green",
        "wdEngManager": dep.get("wdEngManager") or "Preview Eng Manager",
        "productArea": dep.get("productArea") or GO_LIVE_PRODUCTS[0],
        "recordType": record_type,
        "goLiveDate": gl_date,
        "isStudentDeployment": False,
    }
    if record_type == "completed":
        if phased:
            base["recentDates"] = [
                {"date": _iso_days_ago(21), "products": [GO_LIVE_PRODUCTS[0]]},
                {"date": gl_date, "products": list(GO_LIVE_PRODUCTS[:2])},
            ]
        else:
            base["recentDates"] = [{"date": gl_date, "products": products}]
        base["lastGoLiveDate"] = gl_date
        base["isPhased"] = phased
    else:
        if phased:
            base["upcomingDates"] = [
                {"date": gl_date, "products": [GO_LIVE_PRODUCTS[0]]},
                {"date": _add_days(14), "products": [GO_LIVE_PRODUCTS[1]]},
            ]
        else:
            base["upcomingDates"] = [{"date": gl_date, "products": products}]
        base["nextGoLiveDate"] = gl_date
        base["mtpDate"] = gl_date
        base["isPhased"] = phased
    return base


def recent_go_lives_from_rows(rows: list[dict[str, Any]], scenario: str) -> list[dict[str, Any]]:
    if not rows:
        return []
    out: list[dict[str, Any]] = []
    n = min(6 if scenario == "volume" else 4, len(rows))
    for i in range(n):
        days_ago = 7 + i * 5
        if scenario == "go-live-window":
            days_ago = 3 + i * 2
        gl_date = _iso_days_ago(days_ago)
        phased = scenario == "mixed-health" and i == 1
        out.append(_gl_row_from_deployment(rows[i], record_type="completed", gl_date=gl_date, phased=phased))
    return out


def upcoming_go_lives_from_rows(rows: list[dict[str, Any]], scenario: str) -> list[dict[str, Any]]:
    if not rows:
        return []
    out: list[dict[str, Any]] = []
    pool = rows[:8] if scenario == "go-live-window" else rows[:5]
    for i, dep in enumerate(pool):
        offset = 5 + i * 4
        if scenario == "go-live-window":
            offset = 3 + i * 2
        gl_date = _add_days(offset)
        phased = scenario == "edge-values" and i == 0
        out.append(_gl_row_from_deployment(dep, record_type="upcoming", gl_date=gl_date, phased=phased))
    if scenario == "at-risk" and out:
        out[0]["health"] = "Red"
    return out


def _timeline_months(rows: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for row in rows:
        key = (row.get("goLiveDate") or row.get("lastGoLiveDate") or row.get("mtpDate") or "")[:7]
        if key:
            counts[key] = counts.get(key, 0) + 1
    timeline = []
    for m in range(-2, 5):
        d = date(today.year, today.month, 1) + timedelta(days=32 * m)
        d = date(d.year, d.month, 1)
        key = d.strftime("%Y-%m")
        label = d.strftime("%b %Y")
        is_current = d.year == today.year and d.month == today.month
        is_future = d > today.replace(day=1)
        timeline.append(
            {
                "label": label,
                "count": counts.get(key, 0),
                "isCurrent": is_current,
                "isFuture": is_future,
            }
        )
    return timeline


def golives_explorer_from_rows(
    recent: list[dict[str, Any]], upcoming: list[dict[str, Any]], scenario: str
) -> dict[str, Any]:
    explorer_rows = []
    for r in recent:
        explorer_rows.append(dict(r))
    for u in upcoming:
        explorer_rows.append(dict(u))
    total = len(explorer_rows)
    completed = sum(1 for r in explorer_rows if r.get("recordType") == "completed")
    upcoming_n = total - completed
    today = date.today()
    return {
        "valid": True,
        "error": "",
        "rows": explorer_rows,
        "totalCount": total,
        "kpiSummary": {
            "contextLine": f"Preview window — {total} synthetic go-live records",
            "cards": [
                {"label": "Completed", "count": completed, "percent": f"{round(completed / total * 100) if total else 0}%", "subtext": "Past window", "risk": False},
                {"label": "Upcoming", "count": upcoming_n, "percent": f"{round(upcoming_n / total * 100) if total else 0}%", "subtext": "Forward window", "risk": scenario == "at-risk"},
            ],
        },
        "timeline": _timeline_months(explorer_rows, today),
        "filterOptions": {
            "partners": sorted({r.get("partner") or "" for r in explorer_rows if r.get("partner")}),
            "health": sorted({r.get("health") or "" for r in explorer_rows if r.get("health")}),
            "regions": sorted({r.get("region") or "" for r in explorer_rows if r.get("region")}),
            "productAreas": sorted({r.get("productArea") or "" for r in explorer_rows if r.get("productArea")}),
            "engagementManagers": ["Preview Eng Manager"],
            "fiscalYears": [str(today.year), str(today.year + 1)],
        },
        "periodLabel": "Preview fiscal period",
        "searchActive": False,
        "effectiveGoLiveType": "all",
        "resolvedPeriodStart": _iso_days_ago(60),
        "resolvedPeriodEnd": _add_days(90),
        "periodPosition": "mixed",
    }


def _override_row_deployment(
    dep: dict[str, Any],
    *,
    health: str | None = None,
    classification: str = "Monthly",
    exclude: bool = False,
    stale: bool = False,
    orphaned: bool = False,
) -> dict[str, Any]:
    dep_id = dep["deploymentId"]
    src_health = dep.get("health") or "Green"
    eff_health = health or src_health
    now = f"{_today_key()}T10:00:00.000Z"
    has_op = bool(health and health != src_health)
    if exclude and not has_op:
        category = "report"
    elif exclude and has_op:
        category = "mixed"
    else:
        category = "operational"
    fields = []
    if has_op:
        fields.append("Override_Health")
    if exclude:
        fields.append("Exclude_From_Report")
    return {
        "type": "deployment",
        "accountName": dep["accountName"],
        "deploymentId": dep_id,
        "deploymentName": dep.get("deploymentName", ""),
        "fieldsSet": fields,
        "currentValues": {
            "health": eff_health if has_op else "",
            "mtpDate": "",
            "stage": "",
            "account": "",
            "deployment": "",
            "currentUpdate": "",
            "excludeFromReport": exclude,
        },
        "sourceValues": {
            "health": src_health,
            "mtpDate": dep.get("mtpDate") or dep.get("goLiveDate") or "",
            "stage": dep.get("stage") or "",
            "account": dep["accountName"],
            "deployment": dep.get("deploymentName", ""),
            "currentUpdate": "",
        },
        "effectiveValues": {
            "health": eff_health,
            "mtpDate": dep.get("mtpDate") or "",
            "stage": dep.get("stage") or "",
            "account": dep["accountName"],
            "deployment": dep.get("deploymentName", ""),
            "currentUpdate": "",
            "excludeFromReport": exclude,
        },
        "setBy": "preview.user@workday.com",
        "setAt": now,
        "classification": classification,
        "reason": "Synthetic preview override",
        "hasOperationalOverride": has_op,
        "hasReportExclusion": exclude,
        "isStaleMonthly": stale,
        "isOrphaned": orphaned,
        "category": category,
    }


def _override_row_golives(account_name: str, partner: str = "Preview Partner LLC") -> dict[str, Any]:
    now = f"{_today_key()}T09:30:00.000Z"
    gl_date = _add_days(12)
    return {
        "type": "golives",
        "accountName": account_name,
        "deploymentId": account_name,
        "deploymentName": "",
        "fieldsSet": ["Override_GoLiveDate", "Override_Partner"],
        "currentValues": {"goLiveDate": gl_date, "partner": partner, "excludeFromReport": False},
        "sourceValues": {},
        "effectiveValues": {"goLiveDate": gl_date, "partner": partner, "excludeFromReport": False},
        "setBy": "preview.user@workday.com",
        "setAt": now,
        "classification": "Structural",
        "reason": "Synthetic go-lives override",
        "hasOperationalOverride": True,
        "hasReportExclusion": False,
        "isStaleMonthly": False,
        "isOrphaned": False,
        "category": "operational",
    }


def active_overrides_for_scenario(rows: list[dict[str, Any]], scenario: str) -> list[dict[str, Any]]:
    if not rows or scenario == "empty":
        return []
    if scenario == "volume":
        return [
            _override_row_deployment(rows[i], health="Yellow", classification="Monthly")
            for i in range(min(8, len(rows)))
        ]
    out: list[dict[str, Any]] = []
    if len(rows) >= 1:
        out.append(_override_row_deployment(rows[0], health="Yellow", classification="Monthly"))
    if len(rows) >= 2 and scenario != "edge-values":
        out.append(_override_row_deployment(rows[1], exclude=True, classification="Structural"))
    if len(rows) >= 3:
        out.append(_override_row_golives(rows[2]["accountName"]))
    if scenario == "at-risk" and len(rows) >= 4:
        out.append(_override_row_deployment(rows[3], health="Red", classification="Monthly"))
    if scenario == "edge-values" and len(rows) >= 2:
        out.append(
            _override_row_deployment(
                rows[1], health="Red", classification="Monthly", stale=True, orphaned=True
            )
        )
    return out


def seed_audit_log(overrides: list[dict[str, Any]]) -> list[dict[str, Any]]:
    log = []
    for i, row in enumerate(overrides[:3]):
        log.append(
            {
                "timestamp": row.get("setAt") or f"{_today_key()}T08:00:00.000Z",
                "user": row.get("setBy") or "preview.user@workday.com",
                "action": "SET",
                "accountName": row.get("accountName") or "",
                "overrideType": row.get("type") or "deployment",
                "fieldsAffected": ", ".join(row.get("fieldsSet") or []),
                "notes": row.get("reason") or "Preview seed",
            }
        )
    return log


def enrich_m2_bundle(bundle: dict[str, Any], scenario: str) -> dict[str, Any]:
    rows = bundle.get("deployments") or []
    recent = recent_go_lives_from_rows(rows, scenario)
    upcoming = upcoming_go_lives_from_rows(rows, scenario)
    overrides = active_overrides_for_scenario(rows, scenario)
    bundle = dict(bundle)
    bundle["recentGoLives"] = recent
    bundle["upcomingGoLives"] = upcoming
    bundle["golivesExplorer"] = golives_explorer_from_rows(recent, upcoming, scenario)
    bundle["activeOverrides"] = overrides
    bundle["overrideAuditLog"] = seed_audit_log(overrides)
    return attach_notable_bundle(bundle, scenario)


def build_scenario_bundle(app_id: str, scenario: str, m1_builder) -> dict[str, Any]:
    scenario = scenario if scenario in SCENARIOS else "mixed-health"
    base = m1_builder(app_id, scenario)
    return enrich_m2_bundle(base, scenario)

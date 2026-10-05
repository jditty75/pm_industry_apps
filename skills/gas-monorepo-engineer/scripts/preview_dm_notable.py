#!/usr/bin/env python3
"""Synthetic Notable Deployments fixtures for DM local preview (getNotableData contract)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from preview_dm_fixtures import _add_days, _today_key

NOTABLE_READ_HANDLERS = (
    "getNotableData",
    "getGoLivesForNotablePicker",
)

VALIDATION_STATUSES = (
    "Raw/Unverified",
    "Region Approved",
    "Region Restricted",
)

NOTABLE_ROW_FIELDS = (
    "deploymentId",
    "accountName",
    "validationStatus",
    "notabilityTrigger",
    "latestUpdate",
    "regionalOwner",
    "peerRowIndex",
    "local",
)

NOTABLE_LOCAL_FIELDS = (
    "deploymentName",
    "partner",
    "health",
    "stage",
    "mtpDate",
)

PICKER_ROW_FIELDS = (
    "deploymentId",
    "accountName",
    "deploymentName",
    "view",
)

# Synthetic deployment IDs for notable-active-complete scenario (no production data).
# Deployment IDs must differ within the first 15 characters (Notable join prefix).
NOTABLE_SCENARIO_IDS = {
    "active_only": "PREVIEW_NBACTV0000001",
    "complete_only": "PREVIEW_NBCMPL0000001",
    "transition": "PREVIEW_NBTRNS0000001",
    "complete_no_peer": "PREVIEW_NBNOPE0000001",
    "overlap": "PREVIEW_NBOVLP0000001",
    "unresolved_peer": "PREVIEW_NBGHST0000001",
    "student_excluded": "PREVIEW_NBSTUD0000001",
}


def notable_short_id(deployment_id: str) -> str:
    return str(deployment_id or "").strip()[:15]


def merge_notable_eligible_deployments(
    active_rows: list[dict[str, Any]],
    complete_rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Mirror CoreData.mergeNotableEligibleDeployments_: Active wins on 15-char ID overlap."""
    order: list[str] = []
    by_short: dict[str, dict[str, Any]] = {}
    resolution: dict[str, str] = {}

    def add_row(row: dict[str, Any], source: str) -> None:
        short = notable_short_id(row.get("deploymentId") or "")
        if not short:
            return
        if short in by_short:
            if source == "active":
                by_short[short] = row
            resolution[short] = "active_and_complete_overlap_active_wins"
            return
        by_short[short] = row
        resolution[short] = source
        order.append(short)

    for row in active_rows or []:
        add_row(row, "active")
    for row in complete_rows or []:
        add_row(row, "complete")

    merged = [by_short[s] for s in order]
    return merged, resolution


def filter_notable_student_exclude(
    rows: list[dict[str, Any]], student_ids: set[str] | None
) -> list[dict[str, Any]]:
    if not student_ids:
        return list(rows)
    out: list[dict[str, Any]] = []
    for row in rows:
        dep_id = str(row.get("deploymentId") or "").strip()
        short = notable_short_id(dep_id)
        if dep_id in student_ids or short in student_ids:
            continue
        out.append(row)
    return out


def notable_active_complete_fixture() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (active_deployments, complete_only_deployments, peer_specs)."""

    def dep(
        key: str,
        account: str,
        *,
        name: str,
        health: str = "Green",
        overall: str = "Active",
        status: str = "Active",
        is_student: bool = False,
    ) -> dict[str, Any]:
        dep_id = NOTABLE_SCENARIO_IDS[key]
        return {
            "rowIndex": 100,
            "deploymentId": dep_id,
            "parentDeploymentId": dep_id,
            "accountName": account,
            "deploymentName": name,
            "health": health,
            "stage": "Test",
            "phase": "Phase 2",
            "partner": "Preview Partner LLC",
            "mtpDate": _add_days(-30),
            "overallStatus": overall,
            "status": status,
            "isStudentDeployment": is_student,
            "industry": "Public Sector Preview",
        }

    active = [
        dep("active_only", "Example County", name="Notable Active Deployment"),
        dep("overlap", "Sample Health System", name="Overlap Active Row", health="Yellow"),
        dep("transition", "Test Customer Agency", name="Transition (was Active)", health="Green"),
    ]
    complete_only = [
        dep(
            "complete_only",
            "Example University",
            name="Notable Complete-Only Deployment",
            overall="Complete",
            status="Complete",
        ),
        dep(
            "transition",
            "Test Customer Agency",
            name="Transition (now Complete)",
            overall="Complete",
            status="Complete",
            health="Green",
        ),
        dep(
            "overlap",
            "Sample Health System",
            name="Overlap Complete Row",
            overall="Complete",
            status="Complete",
            health="Red",
        ),
        dep(
            "complete_no_peer",
            "Demo Municipal Corp",
            name="Complete Without Notable Peer",
            overall="Complete",
            status="Complete",
        ),
        dep(
            "student_excluded",
            "Example University",
            name="HENP Student Complete",
            overall="Complete",
            status="Complete",
            is_student=True,
        ),
    ]
    peer_specs = [
        ("active_only", "Region Approved", "Active portfolio highlight", _add_days(-7)),
        ("complete_only", "Region Approved", "Complete-only notable row", _add_days(-14)),
        ("transition", "Raw/Unverified", "Transitioned Active to Complete", ""),
        ("overlap", "Region Approved", "Duplicate ID overlap case", "03/01/2026"),
        ("unresolved_peer", "Region Approved", "Peer without local match", _add_days(-2)),
        ("active_only", "Region Restricted", "Restricted row for toggle test", _add_days(-1)),
    ]
    return active, complete_only, peer_specs


def join_notable_peer_rows(
    peer_specs: list[tuple[str, str, str, str]],
    eligible_local: list[dict[str, Any]],
    *,
    student_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    local = filter_notable_student_exclude(eligible_local, student_ids)
    local_map = {notable_short_id(r["deploymentId"]): r for r in local}
    out: list[dict[str, Any]] = []
    peer_index = 5
    for key, validation_status, trigger, latest in peer_specs:
        if key == "unresolved_peer":
            continue
        dep_id = NOTABLE_SCENARIO_IDS.get(key, "")
        local_row = local_map.get(notable_short_id(dep_id))
        if not local_row:
            continue
        dep = local_row
        out.append(
            _notable_row_from_deployment(
                dep,
                validation_status=validation_status,
                trigger=trigger,
                latest_update=latest,
                regional_owner="Preview Regional Owner",
                peer_row_index=peer_index,
            )
        )
        peer_index += 1
    # Sort: Region Restricted last, then accountName (mirrors CoreNotable.joinAndSort_)
    restricted = "Region Restricted"

    def sort_key(row: dict[str, Any]) -> tuple[int, str]:
        is_restricted = 1 if row.get("validationStatus") == restricted else 0
        return (is_restricted, str(row.get("accountName") or "").lower())

    out.sort(key=sort_key)
    return out


def _notable_row_from_deployment(
    dep: dict[str, Any],
    *,
    validation_status: str,
    trigger: str,
    latest_update: str = "",
    regional_owner: str = "Preview Regional Owner",
    peer_row_index: int = 0,
) -> dict[str, Any]:
    latest = latest_update
    if latest_update == "invalid-date":
        latest = latest_update
    return {
        "deploymentId": dep["deploymentId"],
        "accountNumber": f"PREVIEW_ACCT_{dep['deploymentId'][-4:]}",
        "accountName": dep["accountName"],
        "industry": dep.get("industry") or "Public Sector Preview",
        "validationStatus": validation_status,
        "latestUpdate": latest,
        "regionalOwner": regional_owner,
        "notabilityTrigger": trigger,
        "fitForPurpose": "Preview fit narrative",
        "scopeSummary": "Synthetic scope summary for local preview.",
        "storyBlurb": "",
        "supportingLinks": "",
        "businessOutcomes": "",
        "standoutTeamMembers": "",
        "goLiveQuarter": "FY27 Q2",
        "deploymentType": "Net New",
        "peerRowIndex": peer_row_index,
        "local": {
            "deploymentName": dep.get("deploymentName") or "",
            "partner": dep.get("partner") or "Preview Partner LLC",
            "health": dep.get("health") or "Green",
            "stage": dep.get("stage") or "Test",
            "mtpDate": dep.get("mtpDate") or dep.get("goLiveDate") or _add_days(14),
            "servicesApproach": "Preview services approach",
        },
    }


def notable_data_for_scenario(
    rows: list[dict[str, Any]],
    scenario: str,
    *,
    complete_rows: list[dict[str, Any]] | None = None,
    app_id: str = "",
) -> list[dict[str, Any]]:
    if scenario == "empty":
        return []

    if scenario == "notable-active-complete":
        active, complete_only, peer_specs = notable_active_complete_fixture()
        merged, _res = merge_notable_eligible_deployments(active, complete_only)
        student_ids = {NOTABLE_SCENARIO_IDS["student_excluded"]}
        student_ids.add(notable_short_id(NOTABLE_SCENARIO_IDS["student_excluded"]))
        if app_id != "HENP_DM":
            student_ids = set()
        return join_notable_peer_rows(peer_specs, merged, student_ids=student_ids)

    if not rows:
        return []

    if scenario == "volume":
        out: list[dict[str, Any]] = []
        for i, dep in enumerate(rows[: min(18, len(rows))]):
            status = VALIDATION_STATUSES[i % len(VALIDATION_STATUSES)]
            out.append(
                _notable_row_from_deployment(
                    dep,
                    validation_status=status,
                    trigger=f"Volume preview trigger {i + 1}",
                    latest_update=_add_days(-(i % 30)) if i % 4 else "",
                    regional_owner=f"Preview Owner {i % 5}",
                    peer_row_index=5 + i,
                )
            )
        return out

    pool = rows[: min(10, len(rows))]
    out: list[dict[str, Any]] = []
    specs = [
        ("Region Approved", "Large public-sector go-live", _add_days(-12), "Alex Preview"),
        ("Raw/Unverified", "Executive reference candidate", "", "Unassigned"),
        ("Region Restricted", "Restricted visibility row", _add_days(-3), "Restricted Owner"),
        ("Region Approved", "Partner-led transformation", "03/15/2026", "Maria Preview"),
    ]
    if scenario == "at-risk":
        specs[0] = ("Raw/Unverified", "At-risk portfolio highlight", _add_days(-45), "Risk Owner")
    if scenario == "edge-values":
        specs.append(("Region Approved", "Long account name stress row", "invalid-date", "Edge Owner"))

    for i, (status, trigger, latest, owner) in enumerate(specs):
        if i >= len(pool):
            break
        out.append(
            _notable_row_from_deployment(
                pool[i],
                validation_status=status,
                trigger=trigger,
                latest_update=latest,
                regional_owner=owner,
                peer_row_index=5 + i,
            )
        )

    if scenario == "go-live-window" and len(pool) > 4:
        out.append(
            _notable_row_from_deployment(
                pool[4],
                validation_status="Region Approved",
                trigger="Upcoming go-live window",
                latest_update=_today_key(),
                regional_owner="Window Owner",
                peer_row_index=10,
            )
        )
    return out


def golives_for_notable_picker(
    recent: list[dict[str, Any]], upcoming: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in recent or []:
        out.append(
            {
                "deploymentId": row.get("deploymentId") or "",
                "accountName": row.get("accountName") or "",
                "deploymentName": row.get("deploymentName") or "",
                "industry": row.get("industry") or "",
                "mtpDate": None,
                "goLiveDate": row.get("lastGoLiveDate") or row.get("goLiveDate"),
                "view": "recent",
            }
        )
    for row in upcoming or []:
        out.append(
            {
                "deploymentId": row.get("deploymentId") or "",
                "accountName": row.get("accountName") or "",
                "deploymentName": row.get("deploymentName") or "",
                "industry": row.get("industry") or "",
                "mtpDate": row.get("nextGoLiveDate") or row.get("mtpDate"),
                "goLiveDate": None,
                "view": "upcoming",
            }
        )
    return out


def attach_notable_bundle(bundle: dict[str, Any], scenario: str) -> dict[str, Any]:
    rows = bundle.get("deployments") or []
    complete_rows = bundle.get("completeDeployments")
    app_id = str(bundle.get("appId") or "")
    notable = notable_data_for_scenario(
        rows, scenario, complete_rows=complete_rows, app_id=app_id
    )
    recent = bundle.get("recentGoLives") or []
    upcoming = bundle.get("upcomingGoLives") or []
    bundle = dict(bundle)
    bundle["notableDeployments"] = notable
    bundle["notablePicker"] = golives_for_notable_picker(recent, upcoming)
    return bundle

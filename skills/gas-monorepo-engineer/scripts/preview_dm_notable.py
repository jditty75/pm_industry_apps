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


def _notable_row_from_deployment(
    dep: dict[str, Any],
    *,
    validation_status: str,
    trigger: str,
    latest_update: str = "",
    regional_owner: str = "Preview Regional Owner",
    peer_row_index: int = 0,
) -> dict[str, Any]:
    return {
        "deploymentId": dep["deploymentId"],
        "accountNumber": f"PREVIEW_ACCT_{dep['deploymentId'][-4:]}",
        "accountName": dep["accountName"],
        "industry": dep.get("industry") or "Public Sector Preview",
        "validationStatus": validation_status,
        "latestUpdate": latest_update,
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


def notable_data_for_scenario(rows: list[dict[str, Any]], scenario: str) -> list[dict[str, Any]]:
    if not rows or scenario == "empty":
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
    notable = notable_data_for_scenario(rows, scenario)
    recent = bundle.get("recentGoLives") or []
    upcoming = bundle.get("upcomingGoLives") or []
    bundle = dict(bundle)
    bundle["notableDeployments"] = notable
    bundle["notablePicker"] = golives_for_notable_picker(recent, upcoming)
    return bundle

#!/usr/bin/env python3
"""Generate synthetic CSAT fixture bundles for DM UX concept preview."""

from __future__ import annotations

import json
import os
from datetime import date, timedelta

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_base() -> dict:
    with open(os.path.join(FIXTURES, "synthetic-data.json"), encoding="utf-8") as f:
        return json.load(f)


def _mk_response(
    rid: str,
    dep_id: str,
    survey: str,
    days_ago: int,
    overall: float | None,
    specific: float | None,
    nps: int | None,
    areas: list[str],
    sentiment: str | None,
    topics: list[str] | None,
    comments: dict | None,
) -> dict:
    d = date.today() - timedelta(days=days_ago)
    return {
        "id": rid,
        "deploymentId": dep_id,
        "surveyType": survey,
        "responseDate": d.isoformat(),
        "overallSatisfaction": overall,
        "surveySatisfaction": specific,
        "nps": nps if survey == "PGL" else None,
        "productAreas": areas,
        "qualtricsSentiment": sentiment,
        "qualtricsTopics": topics or [],
        "comments": comments or {},
    }


def build_responses() -> list[dict]:
    base = _load_base()
    deps = {d["id"]: d for d in base["deployments"]}
    areas = base["productAreas"]
    rows: list[dict] = []

    # syn-dep-001: MDS then PGL history, low satisfaction
    rows.append(
        _mk_response(
            "syn-res-001a",
            "syn-dep-001",
            "MDS",
            420,
            3.2,
            3.0,
            None,
            [areas[1], areas[3]],
            "neutral",
            ["Implementation timeline"],
            {
                "reasons": "Timeline slipped twice during cutover planning.",
                "improve": "Clearer milestone communication would help.",
            },
        )
    )
    rows.append(
        _mk_response(
            "syn-res-001b",
            "syn-dep-001",
            "PGL",
            45,
            2.1,
            2.0,
            4,
            [areas[1], areas[2]],
            "negative",
            ["Support responsiveness", "Training"],
            {
                "reasons": "Post go-live support felt reactive rather than proactive.",
                "improve": "Dedicated office hours for payroll leads.",
                "additional": "We remain committed but need tighter follow-through.",
            },
        )
    )

    # syn-dep-002: high satisfaction PGL only
    rows.append(
        _mk_response(
            "syn-res-002",
            "syn-dep-002",
            "PGL",
            30,
            4.8,
            4.9,
            9,
            [areas[0]],
            "positive",
            ["Partner collaboration"],
            {"workingWell": "Finance team praised weekly steering cadence."},
        )
    )

    # syn-dep-003: student deployment mixed
    rows.append(
        _mk_response(
            "syn-res-003",
            "syn-dep-003",
            "MDS",
            200,
            4.0,
            4.1,
            None,
            [areas[1], areas[6]],
            "positive",
            ["Student records"],
            {"workingWell": "Registrar workflows validated ahead of schedule."},
        )
    )

    # syn-dep-004: MDS only historical
    rows.append(
        _mk_response(
            "syn-res-004",
            "syn-dep-004",
            "MDS",
            600,
            3.8,
            3.7,
            None,
            [areas[4]],
            "neutral",
            [],
            {},
        )
    )

    # Multi product area response
    rows.append(
        _mk_response(
            "syn-res-005",
            "syn-dep-002",
            "PGL",
            90,
            4.2,
            4.3,
            7,
            areas[:5],
            "positive",
            ["Cross-module integration"],
            {"workingWell": "Benefits and payroll interfaces stabilized quickly."},
        )
    )

    # Low-n group helper deployments
    for i, dep_id in enumerate(["syn-dep-002", "syn-dep-004"], start=1):
        rows.append(
            _mk_response(
                f"syn-res-low-{i}",
                dep_id,
                "PGL",
                10 + i,
                3.5,
                3.4,
                6,
                [areas[7]],
                "neutral",
                [],
                {},
            )
        )

    # Mixed sentiment on syn-dep-005 escalation deployment
    rows.append(
        _mk_response(
            "syn-res-006a",
            "syn-dep-005",
            "MDS",
            120,
            3.0,
            2.8,
            None,
            [areas[6]],
            "negative",
            ["Payroll accuracy"],
            {"reasons": "Parallel payroll runs surfaced mapping gaps."},
        )
    )
    rows.append(
        _mk_response(
            "syn-res-006b",
            "syn-dep-005",
            "PGL",
            15,
            4.5,
            4.6,
            8,
            [areas[6]],
            "positive",
            ["Issue resolution"],
            {"workingWell": "Payroll team closed critical defects within one sprint."},
        )
    )

    # Volume padding for high-volume scenario
    for n in range(40):
        dep = base["deployments"][n % len(base["deployments"])]
        survey = "PGL" if n % 2 else "MDS"
        rows.append(
            _mk_response(
                f"syn-res-vol-{n:03d}",
                dep["id"],
                survey,
                5 + (n * 3) % 400,
                round(2.5 + (n % 25) / 10, 1),
                round(2.5 + (n % 23) / 10, 1),
                (n % 11) if survey == "PGL" else None,
                [areas[n % len(areas)]],
                ["positive", "neutral", "negative"][n % 3],
                ["Synthetic topic"],
                {"additional": f"Synthetic comment row {n} for density review."},
            )
        )

    return rows


def build_inflight() -> list[dict]:
    return [
        {
            "deploymentId": "syn-dep-001",
            "deployment": "Example County — Core HCM",
            "sent": 48,
            "opened": 36,
            "started": 28,
            "completed": 22,
            "bounced": 2,
            "status": "In progress",
        },
        {
            "deploymentId": "syn-dep-003",
            "deployment": "Example University — Student & HCM",
            "sent": 12,
            "opened": 10,
            "started": 8,
            "completed": 6,
            "bounced": 0,
            "status": "In progress",
        },
        {
            "deploymentId": "syn-dep-002",
            "deployment": "Sample Health System — Financials",
            "sent": 0,
            "opened": 0,
            "started": 0,
            "completed": 0,
            "bounced": 0,
            "status": "Upcoming",
        },
    ]


def build_bundle() -> dict:
    base = _load_base()
    return {
        "meta": {"synthetic": True, "version": 1},
        "deployments": base["deployments"],
        "organizations": base["organizations"],
        "productAreas": base["productAreas"],
        "responses": build_responses(),
        "inflight": build_inflight(),
    }


def main() -> None:
    out = os.path.join(FIXTURES, "generated-bundle.json")
    bundle = build_bundle()
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(bundle, f, indent=2)
    print(f"wrote {out} ({len(bundle['responses'])} responses)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Launch localhost CSAT Overview V2 previews (build + serve + open Healthy)."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import webbrowser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts"))

from preview_csat_overview_v2_build import build  # noqa: E402
from preview_server import ensure_server  # noqa: E402

PAGES = (
    "CSAT_OVERVIEW_V2_INDEX.html",
    "CSAT_OVERVIEW_HEALTHY.html",
    "CSAT_OVERVIEW_RISK.html",
    "CSAT_OVERVIEW_LOW_EVIDENCE.html",
    "CSAT_OVERVIEW_DECLINE.html",
    "CSAT_OVERVIEW_PARTNER.html",
    "CSAT_OVERVIEW_ALL.html",
    "CSAT_OVERVIEW_LOW_VOLUME.html",
)

FORBIDDEN = (
    "Needs Attention",
    "AI Insights",
    "ux-proto-panel",
    "ux-proto-controls",
    "PROTOTYPE CONTROLS",
    "Customer Feedback",
)

REGION_MARKERS = (
    'data-csat-region="OV-0"',
    'data-csat-region="OV-1"',
    'data-csat-region="OV-2"',
    'data-csat-region="OV-3"',
    'data-csat-region="OV-4"',
    'data-csat-region="OV-5"',
)


def validate_files(paths: list[str], fixture: dict) -> None:
    states = fixture["states"]
    spot = {
        "CSAT_OVERVIEW_HEALTHY.html": ("4.3", "Customer Satisfaction risk", "Delivery ratings"),
        "CSAT_OVERVIEW_PARTNER.html": (
            "partner-led deployments aren't surveyed",
            "Not applicable: partner-led",
        ),
        "CSAT_OVERVIEW_ALL.html": ("MDS is Workday-led only", "Workday-led only"),
        "CSAT_OVERVIEW_LOW_VOLUME.html": ("n&lt;5", "too few to summarise"),
    }
    for path in paths:
        html = open(path, encoding="utf-8").read()
        fname = os.path.basename(path)
        if fname == "CSAT_OVERVIEW_V2_INDEX.html":
            continue
        for bad in FORBIDDEN:
            if bad.lower() in html.lower():
                raise SystemExit(f"validate: forbidden '{bad}' in {fname}")
        for m in REGION_MARKERS:
            if m not in html:
                raise SystemExit(f"validate: missing {m} in {fname}")
        if "Overview" not in html or "Survey Operations" not in html:
            raise SystemExit(f"validate: sub-nav labels missing in {fname}")
        if "csat-overview-v2-fixture" not in html:
            raise SystemExit(f"validate: fixture block missing in {fname}")
        if fname in spot:
            for token in spot[fname]:
                if token not in html:
                    raise SystemExit(f"validate: expected '{token}' in {fname}")
        if fname == "CSAT_OVERVIEW_PARTNER.html":
            ov4 = html.split('data-csat-region="OV-4"', 1)[-1].split('data-csat-region="OV-5"', 1)[0]
            if "Held" in ov4 or "Higher" in ov4:
                raise SystemExit("validate: partner journey must not show paired counts")
    print("validate: PASS")


def main() -> None:
    ap = argparse.ArgumentParser(description="CSAT Overview V2 preview")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    out_dir = os.path.join(REPO, ".preview-out")
    if args.stop:
        from preview_server import stop_server

        stop_server(out_dir)
        return

    paths = build(out_dir)
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-overview-v2-states.json")
    with open(fixture_path, encoding="utf-8") as f:
        fixture = json.load(f)
    validate_files(paths, fixture)

    base = ensure_server(out_dir)
    url_healthy = f"{base}/CSAT_OVERVIEW_HEALTHY.html"
    url_index = f"{base}/CSAT_OVERVIEW_V2_INDEX.html"
    print(f"serve: {url_healthy}")
    print(f"index: {url_index}")
    for p in PAGES[2:]:
        print(f"also:  {base}/{p}")
    print(f"preview server: {base}  (use .\\preview.ps1 --stop to stop)")
    if not args.no_open:
        webbrowser.open(url_healthy)
        print(f"opened {url_healthy}")


if __name__ == "__main__":
    main()

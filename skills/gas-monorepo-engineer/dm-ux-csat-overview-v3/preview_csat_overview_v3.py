#!/usr/bin/env python3
"""Launch localhost CSAT Overview V3 previews (build + serve + open Healthy)."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts"))

from preview_csat_overview_v3_build import build  # noqa: E402
from preview_server import ensure_server  # noqa: E402

PAGES = (
    "CSAT_OVERVIEW_V3_INDEX.html",
    "CSAT_OVERVIEW_V3_HEALTHY.html",
    "CSAT_OVERVIEW_V3_CONCERNS.html",
    "CSAT_OVERVIEW_V3_UPCOMING.html",
    "CSAT_OVERVIEW_V3_CHASE.html",
    "CSAT_OVERVIEW_V3_LOW_EVIDENCE.html",
    "CSAT_OVERVIEW_V3_SLG.html",
    "CSAT_OVERVIEW_V3_PARTNER.html",
    "CSAT_OVERVIEW_V3_CLEAR.html",
)

FORBIDDEN = (
    "Needs Attention",
    "AI Insights",
    "Survey Operations",
    "Customer Feedback",
    "ux-proto-panel",
    "ux-proto-controls",
    "PROTOTYPE CONTROLS",
    "csat-v2-stage-table",
    "overdue",
    "incomplete",
    "bonus",
    "compensation",
    "incentive",
)

REGION_MARKERS = (
    'data-csat-region="R1"',
    'data-csat-region="R2"',
    'data-csat-region="R3"',
    'data-csat-region="R4"',
)


def _strip_embedded(html: str) -> str:
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.I | re.S)
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.I | re.S)
    return html


def validate_files(paths: list[str], fixture: dict) -> None:
    for path in paths:
        html = open(path, encoding="utf-8").read()
        fname = os.path.basename(path)
        if fname == "CSAT_OVERVIEW_V3_INDEX.html":
            continue
        low = _strip_embedded(html).lower()
        for bad in FORBIDDEN:
            if bad.lower() == "completed":
                if re.search(r"\bcompleted\b", low):
                    raise SystemExit(f"validate: forbidden '{bad}' in {fname}")
                continue
            if bad.lower() in low:
                raise SystemExit(f"validate: forbidden '{bad}' in {fname}")
        for m in REGION_MARKERS:
            if m not in html:
                raise SystemExit(f"validate: missing {m} in {fname}")
        pos = [html.index(m) for m in REGION_MARKERS]
        if pos != sorted(pos):
            raise SystemExit(f"validate: region order wrong in {fname}")
        if "Overview" not in html or "Surveys" not in html or "Responses" not in html:
            raise SystemExit(f"validate: sub-nav labels missing in {fname}")
        if "Survey Operations" in html:
            raise SystemExit(f"validate: Survey Operations in {fname}")
        if "csat-overview-v3-fixture" not in html:
            raise SystemExit(f"validate: fixture block missing in {fname}")
        if fname == "CSAT_OVERVIEW_V3_HEALTHY.html":
            for token in (
                "Customer concerns",
                "Survey horizon",
                "What customers are telling us",
                "csat-v3-headline",
            ):
                if token not in html:
                    raise SystemExit(f"validate: Healthy missing {token}")
        if fname == "CSAT_OVERVIEW_V3_PARTNER.html":
            r2 = html.split('data-csat-region="R2"', 1)[-1].split('data-csat-region="R3"', 1)[0]
            if "Follow-up expected" in r2:
                raise SystemExit("validate: partner R2 must not show Follow-up expected")
    print("validate: PASS")


def main() -> None:
    ap = argparse.ArgumentParser(description="CSAT Overview V3 preview")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    out_dir = os.path.join(REPO, ".preview-out")
    if args.stop:
        from preview_server import stop_server

        stop_server(out_dir)
        return

    paths = build(out_dir)
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-overview-v3-states.json")
    with open(fixture_path, encoding="utf-8") as f:
        fixture = json.load(f)
    validate_files(paths, fixture)

    base = ensure_server(out_dir)
    url_healthy = f"{base}/CSAT_OVERVIEW_V3_HEALTHY.html"
    url_index = f"{base}/CSAT_OVERVIEW_V3_INDEX.html"
    print(f"serve: {url_healthy}")
    print(f"index: {url_index}")
    for p in PAGES[2:]:
        print(f"also:  {base}/{p}")
    print(f"preview server: {base}  (use .\\preview.ps1 --stop to stop)")
    if not args.no_open:
        import webbrowser

        webbrowser.open(url_healthy)
        print(f"opened {url_healthy}")


if __name__ == "__main__":
    main()

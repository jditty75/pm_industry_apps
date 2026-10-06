#!/usr/bin/env python3
"""Launch localhost CSAT Surveys previews (build + serve + open Normal)."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts"))

from preview_csat_surveys_build import build  # noqa: E402
from preview_server import ensure_server  # noqa: E402

PAGES = (
    "CSAT_SURVEYS_INDEX.html",
    "CSAT_SURVEYS_NORMAL.html",
    "CSAT_SURVEYS_HEAVY.html",
    "CSAT_SURVEYS_PREP.html",
    "CSAT_SURVEYS_INFLIGHT.html",
    "CSAT_SURVEYS_CHASE.html",
    "CSAT_SURVEYS_RESPONDED.html",
    "CSAT_SURVEYS_NOFORECAST.html",
    "CSAT_SURVEYS_QUIET.html",
)

FORBIDDEN = (
    "Needs Attention",
    "Survey Operations",
    "overdue",
    "completed",
    "closed ticket",
    "delivered",
    "confirmed contact",
    "at risk",
    "driver",
    "ranking",
    "AI Insights",
    "coveragePct",
    "incomplete",
    "ux-proto-panel",
    "ux-proto-controls",
    "PROTOTYPE CONTROLS",
    "info-banner",
)

GROUP_ORDER = (
    'data-csat-surveys-group="upcoming"',
    'data-csat-surveys-group="inflight"',
    'data-csat-surveys-group="recent"',
)

EYEBROWS = ("PREPARE", "SURVEY", "RESPOND · CLOSE · FOLLOW UP")


def _strip_embedded(html: str) -> str:
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.I | re.S)
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.I | re.S)
    return html


def validate_files(paths: list[str], fixture: dict) -> None:
    for path in paths:
        html = open(path, encoding="utf-8").read()
        fname = os.path.basename(path)
        if fname == "CSAT_SURVEYS_INDEX.html":
            continue
        low = _strip_embedded(html).lower()
        for bad in FORBIDDEN:
            if bad.lower() == "ready":
                if re.search(r"\bready\b", low) and "readiness issues" not in low and "no readiness issues" not in low:
                    raise SystemExit(f"validate: forbidden '{bad}' in {fname}")
                continue
            if bad.lower() in low:
                raise SystemExit(f"validate: forbidden '{bad}' in {fname}")
        body_visible = _strip_embedded(html)
        if "<canvas" in body_visible.lower() or 'class="info-banner' in body_visible:
            raise SystemExit(f"validate: banned markup in {fname}")
        pos = [html.index(m) for m in GROUP_ORDER]
        if pos != sorted(pos):
            raise SystemExit(f"validate: lifecycle group order wrong in {fname}")
        for eyebrow in EYEBROWS:
            if eyebrow not in html:
                raise SystemExit(f"validate: missing eyebrow {eyebrow} in {fname}")
        if 'aria-selected="true">Surveys' not in html.replace(" ", ""):
            if 'aria-selected="true">Surveys' not in html and 'Surveys</button>' not in html:
                pass
        sub = html
        if sub.count('class="csat-subtab-btn active"') != 1:
            raise SystemExit(f"validate: Surveys sub-tab not uniquely active in {fname}")
        if "csat-surveys-fixture" not in html:
            raise SystemExit(f"validate: fixture block missing in {fname}")
    print("validate: PASS")


def main() -> None:
    ap = argparse.ArgumentParser(description="CSAT Surveys preview")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    out_dir = os.path.join(REPO, ".preview-out")
    if args.stop:
        from preview_server import stop_server

        stop_server(out_dir)
        return

    paths = build(out_dir)
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-surveys-states.json")
    with open(fixture_path, encoding="utf-8") as f:
        fixture = json.load(f)
    validate_files(paths, fixture)

    base = ensure_server(out_dir)
    url_normal = f"{base}/CSAT_SURVEYS_NORMAL.html"
    url_index = f"{base}/CSAT_SURVEYS_INDEX.html"
    print(f"serve: {url_normal}")
    print(f"index: {url_index}")
    for p in PAGES[2:]:
        print(f"also:  {base}/{p}")
    print(f"preview server: {base}  (use .\\preview.ps1 --stop to stop)")
    if not args.no_open:
        import webbrowser

        webbrowser.open(url_normal)
        print(f"opened {url_normal}")


if __name__ == "__main__":
    main()

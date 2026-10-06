#!/usr/bin/env python3
"""Launch localhost CSAT Overview A/B/C previews (build + serve + open A)."""

from __future__ import annotations

import argparse
import os
import sys
import webbrowser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts"))

from preview_dm_ux_csat_build import build  # noqa: E402
from preview_server import ensure_server  # noqa: E402

REQUIRED_MARKERS = {
    "A": "composition-marker-a",
    "B": "composition-marker-b",
    "C": "composition-marker-c",
}
FORBIDDEN = ("ux-proto-panel", "ux-proto-controls", "PROTOTYPE CONTROLS", "AI Insights")


def validate_files(paths: list[str], fixture_id: str) -> None:
    for path in paths:
        html = open(path, encoding="utf-8").read()
        fname = os.path.basename(path)
        marker = None
        for key, m in REQUIRED_MARKERS.items():
            if f"CSAT_{key}.html" in fname:
                marker = m
                break
        if marker and marker not in html:
            raise SystemExit(f"validate: missing {marker} in {fname}")
        for bad in FORBIDDEN:
            if bad in html:
                raise SystemExit(f"validate: forbidden chrome '{bad}' in {fname}")
        if fixture_id not in html:
            raise SystemExit(f"validate: fixture id missing in {fname}")
        if "csat-overview-fixture" not in html:
            raise SystemExit(f"validate: fixture script missing in {fname}")
    print("validate: PASS")


def main() -> None:
    ap = argparse.ArgumentParser(description="CSAT Overview A/B/C preview")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    out_dir = os.path.join(REPO, ".preview-out")
    if args.stop:
        from preview_server import stop_server

        stop_server(out_dir)
        return

    paths = build(out_dir)
    import json

    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-overview-fixture.json")
    with open(fixture_path, encoding="utf-8") as f:
        fixture_id = json.load(f)["fixtureId"]
    validate_files(paths, fixture_id)

    base = ensure_server(out_dir)
    url_a = f"{base}/DM_UX_CSAT_A.html"
    url_b = f"{base}/DM_UX_CSAT_B.html"
    url_c = f"{base}/DM_UX_CSAT_C.html"
    print(f"serve: {url_a}")
    print(f"also:  {url_b}")
    print(f"also:  {url_c}")
    print("compare: use A | B | C links above the app shell")
    print(f"preview server: {base}  (use .\\preview.ps1 --stop to stop)")
    if not args.no_open:
        webbrowser.open(url_a)
        print(f"opened {url_a}")


if __name__ == "__main__":
    main()

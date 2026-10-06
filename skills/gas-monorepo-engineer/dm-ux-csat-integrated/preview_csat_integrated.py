#!/usr/bin/env python3
"""Launch localhost CSAT integrated prototype."""

from __future__ import annotations

import argparse
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts"))

from preview_csat_integrated_build import build  # noqa: E402
from preview_server import ensure_server  # noqa: E402

PAGES = (
    "CSAT_INTEGRATED_INDEX.html",
    "CSAT_INTEGRATED.html",
    "CSAT_INTEGRATED_RESPONSES_NORMAL.html",
    "CSAT_INTEGRATED_RESPONSES_LOW_VOLUME.html",
    "CSAT_INTEGRATED_RESPONSES_T2_DETAIL.html",
    "CSAT_INTEGRATED_DEPLOYMENT_MDS_PGL.html",
    "CSAT_INTEGRATED_DEPLOYMENT_MDS_ONLY.html",
    "CSAT_INTEGRATED_DEPLOYMENT_FOLLOWUP.html",
    "CSAT_INTEGRATED_HENP.html",
)


def validate_files(paths: list[str]) -> None:
    for path in paths:
        html = open(path, encoding="utf-8").read()
        fname = os.path.basename(path)
        if fname == "CSAT_INTEGRATED_INDEX.html":
            continue
        if "csat-integrated-fixture" not in html:
            raise SystemExit(f"validate: missing fixture in {fname}")
        if "csatSubtabNav" not in html and "csat-integrated-app" not in html:
            raise SystemExit(f"validate: missing integrated shell in {fname}")
        if re.search(r"\bdriver\b", html, re.I) and "causal" not in html.lower():
            low = html.lower()
            if "driver" in low and "lowest-rated" not in low:
                pass
        if "ux-proto-panel" in html or "drawer" in html.lower():
            if "data-csat-drawer" in html:
                raise SystemExit(f"validate: drawer pattern in {fname}")
        if re.search(r"modal(?!ity)", html, re.I) and "csat-ix-deployment" not in html:
            pass
    print("validate: PASS")


def main() -> None:
    ap = argparse.ArgumentParser(description="CSAT integrated preview")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    out_dir = os.path.join(REPO, ".preview-out")
    if args.stop:
        from preview_server import stop_server

        stop_server(out_dir)
        return

    paths = build(out_dir)
    validate_files(paths)

    base = ensure_server(out_dir)
    url = f"{base}/CSAT_INTEGRATED.html"
    print(f"serve: {url}")
    print(f"index: {base}/CSAT_INTEGRATED_INDEX.html")
    for p in PAGES[2:]:
        print(f"also:  {base}/{p}")
    print(f"preview server: {base}  (use .\\preview.ps1 --stop to stop)")
    if not args.no_open:
        import webbrowser

        webbrowser.open(url)
        print(f"opened {url}")


if __name__ == "__main__":
    main()

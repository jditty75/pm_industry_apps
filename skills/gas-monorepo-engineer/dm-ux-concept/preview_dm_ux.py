#!/usr/bin/env python3
"""Launch localhost DM UX concept preview (build + serve + open browser)."""

from __future__ import annotations

import argparse
import os
import sys
import webbrowser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts"))

from preview_dm_ux_build import build  # noqa: E402
from preview_server import ensure_server  # noqa: E402
from preview_validate import validate_preview_html  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="DM UX concept preview")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    out_dir = os.path.join(REPO, ".preview-out")
    if args.stop:
        from preview_server import stop_server

        stop_server(out_dir)
        return

    path = build(out_dir)
    with open(path, encoding="utf-8") as f:
        html = f.read()
    ok, issues = validate_preview_html(html, app_id="DM_UX", required_markers=["ux-proto-panel", "Example County"])
    if not ok:
        print("validate: FAIL")
        for i in issues:
            print(" ", i)
        sys.exit(1)
    print("validate: PASS")

    # ensure_server returns base URL str (no trailing slash) — same contract as preview_engine.py
    base = ensure_server(out_dir)
    url = f"{base}/DM_UX.html"
    print(f"serve: {url}")
    print("controls: use the top prototype panel or hash params (see docs/analysis/dm-ux/visual-review-guide.md)")
    print(f"preview server: {base}  (use .\\preview.ps1 --stop to stop)")
    if not args.no_open:
        webbrowser.open(url)
        print(f"opened {url}")


if __name__ == "__main__":
    main()

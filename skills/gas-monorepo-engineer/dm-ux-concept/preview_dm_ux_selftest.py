#!/usr/bin/env python3
"""Lightweight tests for DM UX concept preview artifacts."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))


def test_fixtures_no_forbidden():
    bundle_path = os.path.join(SCRIPT_DIR, "fixtures", "generated-bundle.json")
    patterns_path = os.path.join(SCRIPT_DIR, "fixtures", "forbidden-patterns.json")
    if not os.path.isfile(bundle_path):
        subprocess.run([sys.executable, os.path.join(SCRIPT_DIR, "generate_fixtures.py")], check=True)
    with open(bundle_path, encoding="utf-8") as f:
        text = f.read()
    with open(patterns_path, encoding="utf-8") as f:
        patterns = json.load(f)["patterns"]
    for p in patterns:
        if p.lower() in text.lower():
            raise AssertionError(f"forbidden pattern in fixtures: {p}")
    if "syn-dep" not in text:
        raise AssertionError("expected synthetic deployment ids")


def test_build_html():
    build = os.path.join(SCRIPT_DIR, "preview_dm_ux_build.py")
    r = subprocess.run([sys.executable, build], capture_output=True, text=True, cwd=SCRIPT_DIR)
    if r.returncode != 0:
        raise AssertionError(r.stderr or r.stdout)
    out = os.path.join(REPO, ".preview-out", "DM_UX.html")
    if not os.path.isfile(out):
        raise AssertionError("DM_UX.html not written")
    html = open(out, encoding="utf-8").read()
    for marker in ("ux-proto-panel", "conceptA", "conceptB", "baseline", "Example County"):
        if marker not in html:
            raise AssertionError(f"missing marker {marker}")
    if re.search(r"script\.google\.com/macros/s/", html):
        raise AssertionError("production script URL in preview")


def test_hash_routes_documented():
    guide = os.path.join(REPO, "docs", "analysis", "dm-ux", "visual-review-guide.md")
    if not os.path.isfile(guide):
        raise AssertionError("visual-review-guide.md missing")
    text = open(guide, encoding="utf-8").read()
    if "DM_UX.html#" not in text:
        raise AssertionError("guide should document hash URLs")


def main() -> None:
    test_fixtures_no_forbidden()
    test_build_html()
    test_hash_routes_documented()
    print("PASS preview_dm_ux_selftest.py")


if __name__ == "__main__":
    main()

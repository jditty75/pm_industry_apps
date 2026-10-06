#!/usr/bin/env python3
"""Tests for CSAT Overview V2 single-design preview."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, ".preview-out")

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

REGION_ORDER = (
    'data-csat-region="OV-0"',
    'data-csat-region="OV-1"',
    'data-csat-region="OV-2"',
    'data-csat-region="OV-3"',
    'data-csat-region="OV-4"',
    'data-csat-region="OV-5"',
)

BANNED = (
    "needs attention",
    "ai insights",
    "drivers of satisfaction",
    "leaderboard",
    "ranking",
    "outperform",
    "significant",
    "ux-proto-panel",
    "scenario dropdown",
)

HEALTHY_REGIONS = (
    "Customer Satisfaction · Workday-led",
    "Customer Satisfaction risk",
    "Delivery ratings",
    "MDS → PGL journey",
    "Survey Operations",
    "PRODUCTION VALIDATION REQUIRED",
)


def _region_positions(html: str) -> list[int]:
    return [html.index(m) for m in REGION_ORDER if m in html]


def test_build_all_pages():
    build = os.path.join(SCRIPT_DIR, "preview_csat_overview_v2_build.py")
    r = subprocess.run([sys.executable, build], capture_output=True, text=True, cwd=SCRIPT_DIR)
    if r.returncode != 0:
        raise AssertionError(r.stderr or r.stdout)
    for fname in PAGES:
        path = os.path.join(OUT_DIR, fname)
        if not os.path.isfile(path):
            raise AssertionError(f"{fname} not written")


def test_page_content():
    for fname in PAGES[1:]:
        html = open(os.path.join(OUT_DIR, fname), encoding="utf-8").read()
        for bad in BANNED:
            if bad in html.lower():
                raise AssertionError(f"{bad} found in {fname}")
        pos = _region_positions(html)
        if len(pos) != len(REGION_ORDER):
            raise AssertionError(f"region markers incomplete in {fname}")
        if pos != sorted(pos):
            raise AssertionError(f"region order wrong in {fname}")
        if re.search(r"script\.google\.com/macros/s/", html):
            raise AssertionError(f"production URL in {fname}")
        if "<canvas" in html.lower():
            raise AssertionError(f"canvas in {fname}")

    healthy = open(os.path.join(OUT_DIR, "CSAT_OVERVIEW_HEALTHY.html"), encoding="utf-8").read()
    for token in HEALTHY_REGIONS:
        if token not in healthy:
            raise AssertionError(f"Healthy missing {token}")

    partner = open(os.path.join(OUT_DIR, "CSAT_OVERVIEW_PARTNER.html"), encoding="utf-8").read()
    if "partner-led deployments aren't surveyed" not in partner:
        raise AssertionError("partner MDS muted line missing")
    ov4 = partner.split('data-csat-region="OV-4"', 1)[-1].split('data-csat-region="OV-5"', 1)[0]
    if "Held" in ov4 or "Higher" in ov4 or "Lower" in ov4:
        raise AssertionError("partner OV-4 must not show journey counts")
    if "Not applicable: partner-led" not in ov4:
        raise AssertionError("partner journey not-applicable copy missing")

    all_html = open(os.path.join(OUT_DIR, "CSAT_OVERVIEW_ALL.html"), encoding="utf-8").read()
    if "MDS is Workday-led only" not in all_html:
        raise AssertionError("all-scope MDS caveat missing")

    low = open(os.path.join(OUT_DIR, "CSAT_OVERVIEW_LOW_VOLUME.html"), encoding="utf-8").read()
    if "n&lt;5" not in low and "n<5" not in low:
        raise AssertionError("low volume n<5 suppression missing")


def test_launcher_http():
    launcher = os.path.join(SCRIPT_DIR, "preview_csat_overview_v2.py")
    r = subprocess.run(
        [sys.executable, launcher, "--no-open"],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=180,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview_csat_overview_v2.py failed:\n{r.stderr or r.stdout}")
    if "validate: PASS" not in (r.stdout or ""):
        raise AssertionError("expected validate: PASS")
    m = re.search(r"serve: (http://127\.0\.0\.1:\d+/CSAT_OVERVIEW_HEALTHY\.html)", r.stdout or "")
    if not m:
        raise AssertionError(f"serve line missing:\n{r.stdout}")
    base = m.group(1).rsplit("/", 1)[0]
    for fname in PAGES:
        url = f"{base}/{fname}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            if resp.status != 200:
                raise AssertionError(f"HTTP {resp.status} for {url}")
            chunk = resp.read(300_000).decode("utf-8", errors="replace")
        if fname != "CSAT_OVERVIEW_V2_INDEX.html" and "csat-v2-proto-badge" not in chunk:
            raise AssertionError(f"missing proto badge in {fname}")


def test_preview_ps1():
    ps1 = os.path.join(REPO, "preview.ps1")
    r = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            ps1,
            "CSAT_OVERVIEW_V2",
            "-NoOpen",
        ],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=180,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview.ps1 CSAT_OVERVIEW_V2 failed:\n{r.stderr or r.stdout}")
    if "CSAT_OVERVIEW_HEALTHY.html" not in (r.stdout or ""):
        raise AssertionError("preview.ps1 missing Healthy URL")


def main() -> None:
    test_build_all_pages()
    test_page_content()
    test_launcher_http()
    test_preview_ps1()
    print("PASS preview_csat_overview_v2_selftest.py")


if __name__ == "__main__":
    main()

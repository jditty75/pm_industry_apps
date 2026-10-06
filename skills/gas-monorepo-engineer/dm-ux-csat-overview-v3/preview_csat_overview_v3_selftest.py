#!/usr/bin/env python3
"""Tests for CSAT Overview V3 executive-first preview."""

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

REGION_ORDER = (
    'data-csat-region="R1"',
    'data-csat-region="R2"',
    'data-csat-region="R3"',
    'data-csat-region="R4"',
)

BANNED = (
    "needs attention",
    "ai insights",
    "survey operations",
    "customer feedback",
    "driver",
    "significant",
    "outperform",
    "leaderboard",
    "ranking",
    "overdue",
    "completed",
    "at risk",
    "because",
    "due to",
    "caused",
    "coveragepct",
    "bonus",
    "compensation",
    "incentive",
    "performance plan",
    "ux-proto-panel",
    "ux-proto-controls",
    "scenario dropdown",
    "csat-v2-stage-table",
)

PRODUCTION_ID_PATTERNS = (
    r"script\.google\.com/macros/s/",
    r"@[a-z]+\.workday\.com",
)


def _region_positions(html: str) -> list[int]:
    return [html.index(m) for m in REGION_ORDER if m in html]


def _visible_text_html(html: str) -> str:
    """Strip embedded production CSS/JS before banned-string scans."""
    out = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.I | re.S)
    out = re.sub(r"<script[^>]*>.*?</script>", "", out, flags=re.I | re.S)
    return out


def _check_message_rules(st: dict) -> None:
    from csat_overview_v3_render import validate_message_inputs

    validate_message_inputs(st)


def test_build_all_pages():
    build = os.path.join(SCRIPT_DIR, "preview_csat_overview_v3_build.py")
    r = subprocess.run([sys.executable, build], capture_output=True, text=True, cwd=SCRIPT_DIR)
    if r.returncode != 0:
        raise AssertionError(r.stderr or r.stdout)
    for fname in PAGES:
        path = os.path.join(OUT_DIR, fname)
        if not os.path.isfile(path):
            raise AssertionError(f"{fname} not written")


def test_page_content():
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-overview-v3-states.json")
    fixture = json.load(open(fixture_path, encoding="utf-8"))
    for key, st in fixture["states"].items():
        _check_message_rules(st)

    for fname in PAGES[1:]:
        html = open(os.path.join(OUT_DIR, fname), encoding="utf-8").read()
        visible = _visible_text_html(html)
        low = visible.lower()
        for bad in BANNED:
            if bad == "completed":
                if re.search(r"\bcompleted\b", low):
                    raise AssertionError(f"{bad} found in {fname}")
                continue
            if bad == "driver" and re.search(r"\bdriver\b", low):
                raise AssertionError(f"{bad} found in {fname}")
                continue
            if bad in low:
                raise AssertionError(f"{bad} found in {fname}")
        pos = _region_positions(html)
        if len(pos) != len(REGION_ORDER):
            raise AssertionError(f"region markers incomplete in {fname}")
        if pos != sorted(pos):
            raise AssertionError(f"region order wrong in {fname}")
        for pat in PRODUCTION_ID_PATTERNS:
            if re.search(pat, html, re.I):
                raise AssertionError(f"production identifier pattern in {fname}")
        if "<canvas" in low:
            raise AssertionError(f"canvas in {fname}")
        if "csat-v2-stage-table" in low or "csat-v2-band-bar" in low:
            raise AssertionError(f"V2 analytical table in {fname}")
        if "ux-proto" in low or "scenario" in low and "dropdown" in low:
            raise AssertionError(f"prototype toolbar in {fname}")
        r1 = html.split('data-csat-region="R1"', 1)[1].split('data-csat-region="R2"', 1)[0]
        if "<li>" in r1 or "<table" in r1:
            raise AssertionError(f"R1 list/table in {fname}")
        if len(re.findall(r'class="csat-v3-anchor-figure', r1)) != 1:
            raise AssertionError(f"anchor figure count in {fname}")
        if r1.count("csat-v3-headline") != 1:
            raise AssertionError(f"headline count in {fname}")
        if "<details" in html and 'open="' in html.split("<details", 1)[-1][:80]:
            raise AssertionError(f"details open by default in {fname}")

    healthy = open(os.path.join(OUT_DIR, "CSAT_OVERVIEW_V3_HEALTHY.html"), encoding="utf-8").read()
    for token in ("Customer concerns", "Survey horizon", "What customers are telling us", "strong and stable"):
        if token not in healthy:
            raise AssertionError(f"Healthy missing {token}")

    partner = open(os.path.join(OUT_DIR, "CSAT_OVERVIEW_V3_PARTNER.html"), encoding="utf-8").read()
    r2 = partner.split('data-csat-region="R2"', 1)[-1].split('data-csat-region="R3"', 1)[0]
    if "Follow-up expected" in r2:
        raise AssertionError("partner R2 must not show Follow-up expected")
    if "partner-led follow-up ownership" not in partner.lower():
        raise AssertionError("partner footer sentence missing")


def test_launcher_http():
    launcher = os.path.join(SCRIPT_DIR, "preview_csat_overview_v3.py")
    r = subprocess.run(
        [sys.executable, launcher, "--no-open"],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=180,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview_csat_overview_v3.py failed:\n{r.stderr or r.stdout}")
    if "validate: PASS" not in (r.stdout or ""):
        raise AssertionError("expected validate: PASS")
    m = re.search(r"serve: (http://127\.0\.0\.1:\d+/CSAT_OVERVIEW_V3_HEALTHY\.html)", r.stdout or "")
    if not m:
        raise AssertionError(f"serve line missing:\n{r.stdout}")
    base = m.group(1).rsplit("/", 1)[0]
    for fname in PAGES:
        url = f"{base}/{fname}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            if resp.status != 200:
                raise AssertionError(f"HTTP {resp.status} for {url}")
            chunk = resp.read(400_000).decode("utf-8", errors="replace")
        if fname != "CSAT_OVERVIEW_V3_INDEX.html" and "csat-v3-proto-badge" not in chunk:
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
            "CSAT_OVERVIEW_V3",
            "-NoOpen",
        ],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=180,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview.ps1 CSAT_OVERVIEW_V3 failed:\n{r.stderr or r.stdout}")
    if "CSAT_OVERVIEW_V3_HEALTHY.html" not in (r.stdout or ""):
        raise AssertionError("preview.ps1 missing Healthy URL")


def main() -> None:
    test_build_all_pages()
    test_page_content()
    test_launcher_http()
    test_preview_ps1()
    print("PASS preview_csat_overview_v3_selftest.py")


if __name__ == "__main__":
    main()

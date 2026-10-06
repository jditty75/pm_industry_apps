#!/usr/bin/env python3
"""Tests for focused CSAT Overview A/B/C preview artifacts."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
SCRIPTS = os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts")
OUT_DIR = os.path.join(REPO, ".preview-out")

PAGES = ("DM_UX_CSAT_A.html", "DM_UX_CSAT_B.html", "DM_UX_CSAT_C.html")
MARKERS = {
    "DM_UX_CSAT_A.html": ("composition-marker-a", "executive-signal"),
    "DM_UX_CSAT_B.html": ("composition-marker-b", "balanced-three-column"),
    "DM_UX_CSAT_C.html": ("composition-marker-c", "investigation-table"),
}
FORBIDDEN_CHROME = ("ux-proto-panel", "ux-proto-controls", "PROTOTYPE CONTROLS", "AI Insights")


def test_fixture_forbidden():
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-overview-fixture.json")
    patterns_path = os.path.join(SCRIPT_DIR, "fixtures", "forbidden-patterns.json")
    text = open(fixture_path, encoding="utf-8").read()
    with open(patterns_path, encoding="utf-8") as f:
        cfg = json.load(f)
    for p in cfg["patterns"]:
        if p.lower() in text.lower():
            raise AssertionError(f"forbidden pattern in fixture: {p}")
    data = json.loads(text)
    if data.get("fixtureId") != "csat-overview-slg-v1-20261005":
        raise AssertionError("unexpected fixtureId")


def test_build_all_pages():
    build = os.path.join(SCRIPT_DIR, "preview_dm_ux_csat_build.py")
    r = subprocess.run([sys.executable, build], capture_output=True, text=True, cwd=SCRIPT_DIR)
    if r.returncode != 0:
        raise AssertionError(r.stderr or r.stdout)
    fixture_ids = []
    for fname in PAGES:
        path = os.path.join(OUT_DIR, fname)
        if not os.path.isfile(path):
            raise AssertionError(f"{fname} not written")
        html = open(path, encoding="utf-8").read()
        for bad in FORBIDDEN_CHROME:
            if bad in html:
                raise AssertionError(f"{bad} found in {fname}")
        m1, m2 = MARKERS[fname]
        if m1 not in html or m2 not in html:
            raise AssertionError(f"missing composition markers in {fname}")
        if re.search(r"script\.google\.com/macros/s/", html):
            raise AssertionError(f"production script URL in {fname}")
        m = re.search(r'id="csat-overview-fixture">(\{.*?\})</script>', html)
        if not m:
            raise AssertionError(f"fixture json block missing in {fname}")
        fixture_ids.append(json.loads(m.group(1))["fixtureId"])
    if len(set(fixture_ids)) != 1:
        raise AssertionError("fixture identity differs across pages")


def test_launcher_http():
    launcher = os.path.join(SCRIPT_DIR, "preview_dm_ux_csat.py")
    r = subprocess.run(
        [sys.executable, launcher, "--no-open"],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=120,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview_dm_ux_csat.py --no-open failed:\n{r.stderr or r.stdout}")
    if "validate: PASS" not in (r.stdout or ""):
        raise AssertionError("expected validate: PASS")
    m = re.search(r"serve: (http://127\.0\.0\.1:\d+/DM_UX_CSAT_A\.html)", r.stdout or "")
    if not m:
        raise AssertionError(f"serve line missing:\n{r.stdout}")
    base = m.group(1).rsplit("/", 1)[0]
    for fname in PAGES:
        url = f"{base}/{fname}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            if resp.status != 200:
                raise AssertionError(f"HTTP {resp.status} for {url}")
            chunk = resp.read(200_000)
        if b"csat-overview-proto-badge" not in chunk:
            raise AssertionError(f"missing proto badge in {fname}")
        if b"ux-proto-panel" in chunk:
            raise AssertionError(f"broad prototype panel in {fname}")


def test_preview_ps1_dm_ux_csat():
    ps1 = os.path.join(REPO, "preview.ps1")
    r = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            ps1,
            "DM_UX_CSAT",
            "-NoOpen",
        ],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=120,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview.ps1 DM_UX_CSAT -NoOpen failed:\n{r.stderr or r.stdout}")
    if "validate: PASS" not in (r.stdout or ""):
        raise AssertionError("preview.ps1 DM_UX_CSAT: missing validate PASS")
    if "DM_UX_CSAT_A.html" not in (r.stdout or ""):
        raise AssertionError("preview.ps1 DM_UX_CSAT: missing serve URL")


def main() -> None:
    test_fixture_forbidden()
    test_build_all_pages()
    test_launcher_http()
    test_preview_ps1_dm_ux_csat()
    print("PASS preview_dm_ux_csat_selftest.py")


if __name__ == "__main__":
    main()

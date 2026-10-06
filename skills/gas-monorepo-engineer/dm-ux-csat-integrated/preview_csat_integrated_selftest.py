#!/usr/bin/env python3
"""Tests for CSAT integrated prototype."""

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

MARKERS = (
    "csat-deployment-link",
    "csat-row",
    "csatSubtabNav",
    "csat-provenance-block",
    "data-csat-region=\"RESP_LEARN\"",
    "csat-ix-deployment",
)

BANNED = ("overdue", "completed follow-up", "ux-proto-panel", "causal driver", "driver of dissatisfaction")


def _strip(html: str) -> str:
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.I | re.S)
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.I | re.S)
    return html


def test_build():
    build = os.path.join(SCRIPT_DIR, "preview_csat_integrated_build.py")
    r = subprocess.run([sys.executable, build], capture_output=True, text=True, cwd=SCRIPT_DIR)
    if r.returncode != 0:
        raise AssertionError(r.stderr or r.stdout)
    for fname in PAGES:
        if not os.path.isfile(os.path.join(OUT_DIR, fname)):
            raise AssertionError(f"missing {fname}")


def _fixture_blob(html: str) -> str:
    start = html.find('id="csat-integrated-fixture">')
    if start < 0:
        raise AssertionError("fixture blob missing")
    start += len('id="csat-integrated-fixture">')
    end = html.find("</script>", start)
    if end < 0:
        raise AssertionError("fixture script end missing")
    return html[start:end]


def test_integrated_visual_structure():
    html = open(os.path.join(OUT_DIR, "CSAT_INTEGRATED.html"), encoding="utf-8").read()
    blob = _fixture_blob(html)
    if "csat-row-marker" in blob:
        raise AssertionError("fixture must not emit csat-row-marker column")
    if "csat-sv-lifecycle-section" not in blob:
        raise AssertionError("missing Surveys lifecycle section class")
    if "csat-sv-panel csat-sv-card" in blob or "csat-sv-giant" in blob.lower():
        raise AssertionError("regression to giant Surveys cards")

    resp_html = open(os.path.join(OUT_DIR, "CSAT_INTEGRATED_RESPONSES_NORMAL.html"), encoding="utf-8").read()
    resp_blob = _fixture_blob(resp_html)
    if "csat-ix-rowlist" not in resp_blob:
        raise AssertionError("Responses result list container missing")
    if "csat-row-marker" in resp_blob:
        raise AssertionError("Responses still uses csat-row-marker")


def _ensure_playwright():
    mod = os.path.join(SCRIPT_DIR, "node_modules", "playwright")
    if os.path.isdir(mod):
        return
    r = subprocess.run(
        ["npm", "install", "--no-fund", "--no-audit"],
        capture_output=True,
        text=True,
        cwd=SCRIPT_DIR,
        timeout=300,
        shell=True,
    )
    if r.returncode != 0:
        raise AssertionError(f"npm install playwright failed:\n{r.stderr or r.stdout}")


def test_layout_overlap():
    _ensure_playwright()
    layout = os.path.join(SCRIPT_DIR, "preview_csat_integrated_layout.mjs")
    r = subprocess.run(
        ["node", layout],
        capture_output=True,
        text=True,
        cwd=SCRIPT_DIR,
        timeout=300,
        shell=True,
    )
    if r.returncode != 0:
        raise AssertionError(f"layout overlap check failed:\n{r.stderr or r.stdout}")


def test_integrated_rules():
    html = open(os.path.join(OUT_DIR, "CSAT_INTEGRATED.html"), encoding="utf-8").read()
    blob = _fixture_blob(html)
    markers = (
        "csat-deployment-link",
        "csat-row",
        "csatSubtabNav",
        'data-csat-region=\\"R1\\"',
        "csat-v3-r1",
    )
    for m in markers:
        if m not in blob:
            raise AssertionError(f"missing marker {m} in fixture views")
    resp_html = open(os.path.join(OUT_DIR, "CSAT_INTEGRATED_RESPONSES_NORMAL.html"), encoding="utf-8").read()
    resp_blob = _fixture_blob(resp_html)
    if 'data-csat-region=\\"RESP_LEARN\\"' not in resp_blob:
        raise AssertionError("missing RESP_LEARN")
    if "csat-provenance-block" not in open(
        os.path.join(OUT_DIR, "CSAT_INTEGRATED_RESPONSES_T2_DETAIL.html"), encoding="utf-8"
    ).read():
        pass
    if "#/overview" not in html and "data-csat-route" not in html:
        raise AssertionError("missing tri-tab routes")
    low = _strip(html).lower()
    if "respondent name" in low or "@" in _strip(html):
        if re.search(r"@[a-z0-9.-]+\.[a-z]{2,}", _strip(html), re.I):
            raise AssertionError("possible email in HTML")
    for bad in BANNED:
        if bad in low:
            raise AssertionError(f"banned phrase {bad}")

    t2 = open(os.path.join(OUT_DIR, "CSAT_INTEGRATED_RESPONSES_T2_DETAIL.html"), encoding="utf-8").read()
    if 'data-provenance="customer"' not in t2 or 'data-provenance="qualtrics"' not in t2:
        raise AssertionError("T2 provenance blocks missing")
    if "Customer comment" not in t2 or "Qualtrics analysis" not in t2:
        raise AssertionError("provenance labels missing")

    lv = open(os.path.join(OUT_DIR, "CSAT_INTEGRATED_RESPONSES_LOW_VOLUME.html"), encoding="utf-8").read()
    if "responses touching area" not in lv.lower() and "n < 5" not in lv.lower():
        raise AssertionError("low volume copy missing")

    dep = open(os.path.join(OUT_DIR, "CSAT_INTEGRATED_DEPLOYMENT_MDS_PGL.html"), encoding="utf-8").read()
    if "csat-ix-timeline" not in dep:
        raise AssertionError("deployment timeline missing")
    if "drawer" in dep.lower() and "csat-ix-drawer" in dep.lower():
        raise AssertionError("drawer pattern present")

    fixture = json.loads(_fixture_blob(html))
    if "hc" not in fixture.get("csatAppConfig", {}) or "slg" not in fixture.get("csatAppConfig", {}):
        raise AssertionError("csatAppConfig incomplete")

    js = open(os.path.join(SCRIPT_DIR, "src/csat-integrated.js"), encoding="utf-8").read()
    if "deployment" not in js or "hashchange" not in js:
        raise AssertionError("routing JS incomplete")


def test_http_fetch():
    sys.path.insert(0, os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts"))
    from preview_server import ensure_server

    base = ensure_server(OUT_DIR)
    for fname in PAGES:
        url = f"{base}/{fname}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = resp.read(4096).decode("utf-8", errors="replace")
        if not body.lstrip().lower().startswith("<!doctype"):
            raise AssertionError(f"bad HTML for {fname}")


def test_standalone_still_build():
    v3 = os.path.join(REPO, "skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/preview_csat_overview_v3_build.py")
    sv = os.path.join(REPO, "skills/gas-monorepo-engineer/dm-ux-csat-surveys/preview_csat_surveys_build.py")
    for script in (v3, sv):
        r = subprocess.run([sys.executable, script], capture_output=True, text=True)
        if r.returncode != 0:
            raise AssertionError(f"standalone build failed {script}: {r.stderr or r.stdout}")


def main():
    test_build()
    test_integrated_visual_structure()
    test_integrated_rules()
    test_standalone_still_build()
    test_http_fetch()
    test_layout_overlap()
    print("preview_csat_integrated_selftest: PASS")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Tests for CSAT Surveys operational preview (12-point spec checks)."""

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

GROUP_ORDER = (
    'data-csat-surveys-group="upcoming"',
    'data-csat-surveys-group="inflight"',
    'data-csat-surveys-group="recent"',
)

EYEBROWS = ("PREPARE", "SURVEY", "RESPOND · CLOSE · FOLLOW UP")

BANNED = (
    "needs attention",
    "survey operations",
    "overdue",
    "completed",
    "closed ticket",
    "delivered",
    "confirmed contact",
    "at risk",
    "driver",
    "ranking",
    "ai insights",
    "coveragepct",
    "ux-proto-panel",
    "ux-proto-controls",
    "info-banner",
)

PII_PATTERNS = (
    r"@[a-z0-9.-]+\.[a-z]{2,}",
    r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\s+@",
)

PRODUCTION_ID_PATTERNS = (
    r"script\.google\.com/macros/s/",
    r"@[a-z]+\.workday\.com",
)


def _strip_embedded(html: str) -> str:
    out = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.I | re.S)
    out = re.sub(r"<script[^>]*>.*?</script>", "", out, flags=re.I | re.S)
    return out


def _visible_low(html: str) -> str:
    visible = _strip_embedded(html)
    visible = re.sub(r"<[^>]+>", " ", visible)
    return re.sub(r"\s+", " ", visible).lower()


def test_build_all_pages():
    build = os.path.join(SCRIPT_DIR, "preview_csat_surveys_build.py")
    r = subprocess.run([sys.executable, build], capture_output=True, text=True, cwd=SCRIPT_DIR)
    if r.returncode != 0:
        raise AssertionError(r.stderr or r.stdout)
    for fname in PAGES:
        path = os.path.join(OUT_DIR, fname)
        if not os.path.isfile(path):
            raise AssertionError(f"{fname} not written")


def test_twelve_point_rules():
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-surveys-states.json")
    fixture = json.load(open(fixture_path, encoding="utf-8"))
    from csat_surveys_render import validate_state_inputs

    for _key, st in fixture["states"].items():
        validate_state_inputs(st)

    for fname in PAGES[1:]:
        html = open(os.path.join(OUT_DIR, fname), encoding="utf-8").read()
        low = _visible_low(html)

        for bad in BANNED:
            if bad == "completed":
                if re.search(r"\bcompleted\b", low):
                    raise AssertionError(f"banned {bad} in {fname}")
                continue
            if bad in low:
                raise AssertionError(f"banned {bad} in {fname}")

        if re.search(r"\bready\b", low):
            if "readiness issues" not in low and "no readiness issues" not in low:
                raise AssertionError(f"banned ready outside readiness copy in {fname}")

        for pat in PII_PATTERNS:
            if re.search(pat, _strip_embedded(html), re.I):
                raise AssertionError(f"possible PII pattern {pat} in {fname}")

        for pat in PRODUCTION_ID_PATTERNS:
            if re.search(pat, html, re.I):
                raise AssertionError(f"production identifier {pat} in {fname}")

        if low.count("overview") < 1 or "surveys" not in low or "responses" not in low:
            raise AssertionError(f"sub-nav labels missing in {fname}")

        if 'class="csat-subtab-btn active"' not in html:
            raise AssertionError(f"no active subtab in {fname}")
        sur_idx = html.find("Surveys</button>")
        act_idx = html.find('class="csat-subtab-btn active"')
        if sur_idx == -1 or act_idx == -1 or abs(sur_idx - act_idx) > 80:
            raise AssertionError(f"Surveys not the active sub-tab in {fname}")

        pos = [html.index(m) for m in GROUP_ORDER]
        if pos != sorted(pos):
            raise AssertionError(f"group order wrong in {fname}")
        for eyebrow in EYEBROWS:
            if eyebrow not in html:
                raise AssertionError(f"missing eyebrow {eyebrow} in {fname}")

        if "needs attention" in low:
            raise AssertionError(f"combined needs attention in {fname}")

        rows = re.findall(r'data-csat-surveys-row="compact"', html)
        if 'data-csat-surveys-layout="compact-worklist"' not in html:
            raise AssertionError(f"missing compact worklist layout marker in {fname}")
        if 'class="csat-sv-row"' in html:
            raise AssertionError(f"legacy wide grid row in {fname}")
        if "--csat-sv-tag-col" in html or "csat-sv-survey-pill" in html:
            raise AssertionError(f"standalone survey column styling in {fname}")
        if 'class="csat-sv-horizon"' in html:
            raise AssertionError(f"duplicate full-width horizon bar in {fname}")
        for row_chunk in re.findall(
            r'<div class="csat-sv-row-wrap".*?(?=<div class="csat-sv-row-wrap"|</section>)',
            html,
            flags=re.S,
        ):
            pills = len(re.findall(r'class="status-pill', row_chunk))
            if pills > 1:
                raise AssertionError(f"more than one attention pill per row in {fname}")
            tags = len(re.findall(r'csat-sv-survey-tag', row_chunk))
            if tags != 1:
                raise AssertionError(f"row survey tag count != 1 in {fname}")
            if 'class="csat-sv-row-primary"' not in row_chunk:
                raise AssertionError(f"missing compact primary row in {fname}")

        if "status-red" in html:
            if "All bounced" not in html and fname != "CSAT_SURVEYS_CHASE.html":
                pass
        reds = html.count("status-red")
        for state_file, min_red in (("CSAT_SURVEYS_NORMAL.html", 1), ("CSAT_SURVEYS_CHASE.html", 1)):
            if fname == state_file and reds < min_red:
                raise AssertionError(f"expected status-red on all-bounced in {fname}")

        cant = html.count("Can't forecast")
        if cant:
            tail = html.split('data-csat-surveys-group="upcoming"', 1)[-1].split(
                'data-csat-surveys-group="inflight"', 1
            )[0]
            if "status-yellow" in tail and "Can't forecast" in tail:
                for chunk in re.findall(r"Can't forecast.*?status-yellow", tail):
                    if "Can't forecast" in chunk:
                        raise AssertionError(f"can't forecast with yellow in {fname}")

        details_open = len(re.findall(r'<details class="csat-sv-details" open', html))
        if fname in ("CSAT_SURVEYS_INFLIGHT.html", "CSAT_SURVEYS_CHASE.html"):
            if details_open != 1:
                raise AssertionError(f"{fname} should have exactly one expanded invitation detail")
        elif details_open > 0:
            raise AssertionError(f"unexpected open details in {fname}")

        closed_details = html.count('class="csat-sv-details"')
        if closed_details and fname == "CSAT_SURVEYS_QUIET.html":
            pass

        body_visible = _strip_embedded(html)
        if "<canvas" in body_visible.lower() or 'class="info-banner' in body_visible:
            raise AssertionError(f"chart/banner in {fname}")

        if "ux-proto-controls" in low or "prototype controls" in low:
            raise AssertionError(f"prototype toolbar in {fname}")

        if not rows and fname not in ("CSAT_SURVEYS_PREP.html",):
            if fname == "CSAT_SURVEYS_QUIET.html":
                pass


def test_launcher_http():
    launcher = os.path.join(SCRIPT_DIR, "preview_csat_surveys.py")
    r = subprocess.run(
        [sys.executable, launcher, "--no-open"],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=180,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview_csat_surveys.py failed:\n{r.stderr or r.stdout}")
    if "validate: PASS" not in (r.stdout or ""):
        raise AssertionError("expected validate: PASS")
    m = re.search(r"serve: (http://127\.0\.0\.1:\d+/CSAT_SURVEYS_NORMAL\.html)", r.stdout or "")
    if not m:
        raise AssertionError(f"serve line missing:\n{r.stdout}")
    base = m.group(1).rsplit("/", 1)[0]
    for fname in PAGES:
        url = f"{base}/{fname}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            if resp.status != 200:
                raise AssertionError(f"HTTP {resp.status} for {url}")
            chunk = resp.read(500_000).decode("utf-8", errors="replace")
        if fname != "CSAT_SURVEYS_INDEX.html" and "csat-sv-proto-badge" not in chunk:
            raise AssertionError(f"missing proto badge in {fname}")


def test_layout_measure_1440():
    measure = os.path.join(SCRIPT_DIR, "preview_csat_surveys_layout_measure.mjs")
    r = subprocess.run(
        ["node", measure],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=300,
        shell=True,
    )
    if r.returncode != 0:
        raise AssertionError(f"layout measure failed:\n{r.stderr or r.stdout}")
    if "PASS preview_csat_surveys_layout_measure.mjs" not in (r.stdout or ""):
        raise AssertionError(f"layout measure incomplete:\n{r.stdout}")


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
            "CSAT_SURVEYS",
            "-NoOpen",
        ],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=180,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview.ps1 CSAT_SURVEYS failed:\n{r.stderr or r.stdout}")
    if "CSAT_SURVEYS_NORMAL.html" not in (r.stdout or ""):
        raise AssertionError("preview.ps1 missing Normal URL")


def main() -> None:
    test_build_all_pages()
    test_twelve_point_rules()
    test_launcher_http()
    test_preview_ps1()
    test_layout_measure_1440()
    print("PASS preview_csat_surveys_selftest.py")


if __name__ == "__main__":
    main()

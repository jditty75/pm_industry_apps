#!/usr/bin/env python3
"""Lightweight tests for DM UX concept preview artifacts and launcher integration."""

from __future__ import annotations

import inspect
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
    out = os.path.join(OUT_DIR, "DM_UX.html")
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
    if re.search(r"\.\\preview\\\.ps1", text):
        raise AssertionError("malformed launch path .\\preview\\.ps1 in visual-review-guide.md")
    if ".\\preview.ps1 DM_UX" not in text and ".\\preview.ps1 DM_UX" not in text.replace("`", ""):
        raise AssertionError("guide should document .\\preview.ps1 DM_UX")


def test_ensure_server_contract():
    """Match preview_engine / preview_selftest: ensure_server -> str base URL."""
    sys.path.insert(0, SCRIPTS)
    from preview_server import ensure_server  # noqa: E402

    sig = inspect.signature(ensure_server)
    if sig.return_annotation not in (str, "str", inspect.Signature.empty):
        pass  # runtime check below is authoritative
    base = ensure_server(OUT_DIR)
    if not isinstance(base, str):
        raise AssertionError(f"ensure_server must return str, got {type(base).__name__}")
    if not base.startswith("http://127.0.0.1:"):
        raise AssertionError(f"unexpected base URL: {base}")
    if base.endswith("/"):
        raise AssertionError("base URL must not have trailing slash (canonical contract)")


def test_launcher_no_open():
    launcher = os.path.join(SCRIPT_DIR, "preview_dm_ux.py")
    r = subprocess.run(
        [sys.executable, launcher, "--no-open"],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=120,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview_dm_ux.py --no-open failed:\n{r.stderr or r.stdout}")
    out = r.stdout or ""
    if "validate: PASS" not in out:
        raise AssertionError("expected validate: PASS in launcher output")
    m = re.search(r"serve: (http://127\.0\.0\.1:\d+/DM_UX\.html)", out)
    if not m:
        raise AssertionError(f"serve line missing or wrong in launcher output:\n{out}")
    url = m.group(1)
    with urllib.request.urlopen(url, timeout=15) as resp:
        if resp.status != 200:
            raise AssertionError(f"HTTP {resp.status} for {url}")
        chunk = b""
        while b"ux-proto-panel" not in chunk and len(chunk) < 2_000_000:
            part = resp.read(65536)
            if not part:
                break
            chunk += part
    if b"ux-proto-panel" not in chunk:
        raise AssertionError("DM_UX.html not reachable or missing prototype shell (ux-proto-panel)")


def test_preview_ps1_aliases_no_open():
    ps1 = os.path.join(REPO, "preview.ps1")
    for app in ("DM_UX", "UX"):
        r = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, app, "-NoOpen"],
            capture_output=True,
            text=True,
            cwd=REPO,
            timeout=120,
        )
        if r.returncode != 0:
            raise AssertionError(f"preview.ps1 {app} -NoOpen failed:\n{r.stderr or r.stdout}")
        if "validate: PASS" not in (r.stdout or ""):
            raise AssertionError(f"preview.ps1 {app} -NoOpen: missing validate PASS")
        if "DM_UX.html" not in (r.stdout or ""):
            raise AssertionError(f"preview.ps1 {app} -NoOpen: missing DM_UX.html serve URL")


def test_preview_ps1_stop():
    ps1 = os.path.join(REPO, "preview.ps1")
    r = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "--stop"],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=60,
    )
    if r.returncode != 0:
        raise AssertionError(f"preview.ps1 --stop failed:\n{r.stderr or r.stdout}")


def main() -> None:
    test_fixtures_no_forbidden()
    test_build_html()
    test_hash_routes_documented()
    test_ensure_server_contract()
    test_launcher_no_open()
    test_preview_ps1_aliases_no_open()
    test_preview_ps1_stop()
    print("PASS preview_dm_ux_selftest.py")


if __name__ == "__main__":
    main()

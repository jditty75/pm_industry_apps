#!/usr/bin/env python3
"""Deterministic checks for preview_engine assembly (structural HTML + HTTP smoke)."""

import os
import sys
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.dirname(__file__))
from preview_engine import build_app, load_config, resolve_app_path, validate_built_preview  # noqa: E402
from preview_server import ensure_server  # noqa: E402

CHECKS = [
    "PS_SPA",
    "SLG_DM",
    "SLG_GoLives",
    "SLG_Capacity",
]


def main():
    cfg = load_config()
    out_dir = os.path.join(REPO, cfg.get("outputDir", ".preview-out"))
    failed = 0

    built_files = {}
    for app in CHECKS:
        path, _log, html = build_app(app)
        _apath, app_meta = resolve_app_path(app)
        ok, issues = validate_built_preview(app_meta or {"appId": app}, html)
        built_files[app] = os.path.basename(path)
        if not ok:
            print(f"FAIL {app}: structural validation")
            for i in issues:
                print(f"  - {i}")
            failed += 1
            continue
        print(f"PASS {app}: {len(html)} chars -> {path}")

    if failed:
        sys.exit(1)

    base = ensure_server(out_dir)
    for app in CHECKS:
        fname = built_files[app]
        url = f"{base}/{fname}"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                ctype = resp.headers.get("Content-Type", "")
                body = resp.read(4096).decode("utf-8", errors="replace")
        except OSError as e:
            print(f"FAIL {app}: HTTP {url}: {e}")
            failed += 1
            continue
        if "text/html" not in ctype.lower():
            print(f"FAIL {app}: wrong Content-Type {ctype}")
            failed += 1
            continue
        if not body.lstrip().lower().startswith("<!doctype"):
            print(f"FAIL {app}: response does not start with <!DOCTYPE")
            failed += 1
            continue
        print(f"PASS {app}: HTTP {ctype.strip()} @ {url}")

    if failed:
        sys.exit(1)
    print("All preview self-tests passed.")


if __name__ == "__main__":
    main()

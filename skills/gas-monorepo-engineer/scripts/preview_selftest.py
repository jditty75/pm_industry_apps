#!/usr/bin/env python3
"""Deterministic checks for preview_engine assembly (structural HTML + HTTP smoke)."""

import os
import re
import sys
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.dirname(__file__))
from preview_dm_contract import assert_scenario_expectations, validate_m2_bundle  # noqa: E402
from preview_dm_fixtures import M1_HANDLERS, build_m1_responses  # noqa: E402
from preview_dm_m2 import M2_HANDLERS, build_scenario_bundle  # noqa: E402
from preview_dm_notable import NOTABLE_READ_HANDLERS  # noqa: E402
from preview_engine import build_app, load_config, resolve_app_path, validate_built_preview  # noqa: E402
from preview_server import ensure_server  # noqa: E402

LEGACY_CHECKS = [
    "PS_SPA",
    "SLG_GoLives",
    "SLG_Capacity",
]

DM_APPS = [
    "SLG_DM",
    "HC_DM",
    "HENP_DM",
    "EVI_DM",
    "PDX_DM",
    "HS_DM",
]

DM_SCENARIOS = ("mixed-health", "empty", "at-risk", "go-live-window")
NOTABLE_DM_APPS = ("SLG_DM", "HC_DM", "HENP_DM")

PRODUCTION_URL_RE = re.compile(
    r"https://script\.google\.com/macros/s/|googleapis\.com/auth",
    re.I,
)

def assert_dm_html(app_id: str, html: str, scenario: str) -> list[str]:
    issues = []
    for handler in M1_HANDLERS + M2_HANDLERS:
        if handler not in html:
            issues.append(f"missing preview handler registration for {handler}")
    for handler in NOTABLE_READ_HANDLERS:
        if handler not in html:
            issues.append(f"missing notable preview handler {handler}")
    if "preview-dm-mock-runtime" not in html:
        issues.append("missing preview-dm-mock-runtime script")
    if "__PREVIEW_DM_M1_HANDLERS__" not in html:
        issues.append("missing __PREVIEW_DM_M1_HANDLERS__ marker")
    if "__PREVIEW_DM_M2_HANDLERS__" not in html:
        issues.append("missing __PREVIEW_DM_M2_HANDLERS__ marker")
    if "M3_PLUS" not in html:
        issues.append("missing M3_PLUS unsupported-method diagnostics")
    if scenario != "empty" and "Example County" not in html:
        issues.append("missing synthetic fixture marker Example County")
    if PRODUCTION_URL_RE.search(html):
        issues.append("possible production API URL in preview HTML")
    if f'data-preview-scenario="{scenario}"' not in html:
        issues.append(f"scenario attribute not embedded ({scenario})")
    if "createGoogleScriptRun" not in html or "defineProperty(window.google.script" not in html:
        issues.append("DM mock must expose fresh google.script.run via getter")
    bundle = build_scenario_bundle(app_id, scenario, build_m1_responses)
    issues.extend(validate_m2_bundle(bundle))
    issues.extend(assert_scenario_expectations(scenario, bundle))
    return issues


def main():
    cfg = load_config()
    out_dir = os.path.join(REPO, cfg.get("outputDir", ".preview-out"))
    failed = 0
    built_files: dict[str, str] = {}

    notable_selftest = os.path.join(os.path.dirname(__file__), "preview_dm_notable_selftest.py")
    if os.path.isfile(notable_selftest):
        import subprocess

        r = subprocess.run(
            [sys.executable, notable_selftest],
            cwd=os.path.dirname(notable_selftest),
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print("FAIL preview_dm_notable_selftest.py")
            print(r.stdout or r.stderr)
            failed += 1
        else:
            print((r.stdout or "").strip() or "PASS preview_dm_notable_selftest.py")

    smoke = os.path.join(os.path.dirname(__file__), "preview_dm_runtime_smoke.mjs")
    if os.path.isfile(smoke):
        import subprocess

        r = subprocess.run(["node", smoke], cwd=os.path.dirname(smoke), capture_output=True, text=True)
        if r.returncode != 0:
            print("FAIL preview_dm_runtime_smoke.mjs")
            print(r.stdout or r.stderr)
            failed += 1
        else:
            print((r.stdout or "").strip())

    for app in LEGACY_CHECKS:
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

    for app in DM_APPS:
        for scenario in DM_SCENARIOS:
            label = f"{app}:{scenario}"
            path, _log, html = build_app(app, scenario=scenario)
            _apath, app_meta = resolve_app_path(app)
            ok, issues = validate_built_preview(app_meta or {"appId": app}, html)
            dm_issues = assert_dm_html(app, html, scenario)
            if not ok or dm_issues:
                print(f"FAIL {label}: validation")
                for i in issues + dm_issues:
                    print(f"  - {i}")
                failed += 1
                continue
            built_files[label] = os.path.basename(path)
            print(f"PASS {label}: {len(html)} chars")

    for app in NOTABLE_DM_APPS:
        label = f"{app}:notable-active-complete"
        path, _log, html = build_app(app, scenario="notable-active-complete")
        _apath, app_meta = resolve_app_path(app)
        ok, issues = validate_built_preview(app_meta or {"appId": app}, html)
        dm_issues = assert_dm_html(app, html, "notable-active-complete")
        if not ok or dm_issues:
            print(f"FAIL {label}: validation")
            for i in issues + dm_issues:
                print(f"  - {i}")
            failed += 1
            continue
        built_files[label] = os.path.basename(path)
        print(f"PASS {label}: {len(html)} chars")

    dm_ux_selftest = os.path.join(REPO, "skills", "gas-monorepo-engineer", "dm-ux-concept", "preview_dm_ux_selftest.py")
    if os.path.isfile(dm_ux_selftest):
        import subprocess

        r = subprocess.run([sys.executable, dm_ux_selftest], cwd=os.path.dirname(dm_ux_selftest), capture_output=True, text=True)
        if r.returncode != 0:
            print("FAIL preview_dm_ux_selftest.py")
            print(r.stdout or r.stderr)
            failed += 1
        else:
            print((r.stdout or "").strip())

    dm_csat_selftest = os.path.join(
        REPO, "skills", "gas-monorepo-engineer", "dm-ux-csat-overview", "preview_dm_ux_csat_selftest.py"
    )
    if os.path.isfile(dm_csat_selftest):
        import subprocess

        r = subprocess.run([sys.executable, dm_csat_selftest], cwd=os.path.dirname(dm_csat_selftest), capture_output=True, text=True)
        if r.returncode != 0:
            print("FAIL preview_dm_ux_csat_selftest.py")
            print(r.stdout or r.stderr)
            failed += 1
        else:
            print((r.stdout or "").strip())

    dm_csat_v2_selftest = os.path.join(
        REPO, "skills", "gas-monorepo-engineer", "dm-ux-csat-overview-v2", "preview_csat_overview_v2_selftest.py"
    )
    if os.path.isfile(dm_csat_v2_selftest):
        import subprocess

        r = subprocess.run(
            [sys.executable, dm_csat_v2_selftest],
            cwd=os.path.dirname(dm_csat_v2_selftest),
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print("FAIL preview_csat_overview_v2_selftest.py")
            print(r.stdout or r.stderr)
            failed += 1
        else:
            print((r.stdout or "").strip())

    dm_csat_v3_selftest = os.path.join(
        REPO, "skills", "gas-monorepo-engineer", "dm-ux-csat-overview-v3", "preview_csat_overview_v3_selftest.py"
    )
    if os.path.isfile(dm_csat_v3_selftest):
        import subprocess

        r = subprocess.run(
            [sys.executable, dm_csat_v3_selftest],
            cwd=os.path.dirname(dm_csat_v3_selftest),
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print("FAIL preview_csat_overview_v3_selftest.py")
            print(r.stdout or r.stderr)
            failed += 1
        else:
            print((r.stdout or "").strip())

    if failed:
        sys.exit(1)

    base = ensure_server(out_dir)
    http_checks = list(LEGACY_CHECKS) + [f"{a}:mixed-health" for a in DM_APPS]
    for key in http_checks:
        fname = built_files.get(key) or built_files.get(key.split(":")[0])
        if not fname:
            continue
        url = f"{base}/{fname}"
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                ctype = resp.headers.get("Content-Type", "")
                body = resp.read(8192).decode("utf-8", errors="replace")
        except OSError as e:
            print(f"FAIL {key}: HTTP {url}: {e}")
            failed += 1
            continue
        if "text/html" not in ctype.lower():
            print(f"FAIL {key}: wrong Content-Type {ctype}")
            failed += 1
            continue
        if not body.lstrip().lower().startswith("<!doctype"):
            print(f"FAIL {key}: response does not start with <!DOCTYPE")
            failed += 1
            continue
        print(f"PASS {key}: HTTP {ctype.strip()} @ {url}")

    if failed:
        sys.exit(1)
    print("All preview self-tests passed.")


if __name__ == "__main__":
    main()

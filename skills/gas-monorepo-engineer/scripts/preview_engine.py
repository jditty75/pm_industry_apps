#!/usr/bin/env python3
"""
Local UI preview engine for Workday GAS monorepo applications.

Architecture: engine -> application profile (config/ui-preview.json) -> resolve HTML/CSS/JS
-> mock GAS client bridge -> browser-renderable HTML under .preview-out/

Never calls production Apps Script or uses clasp credentials.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import webbrowser

from preview_dm_fixtures import build_dm_mock_script
from preview_server import ensure_server, stop_server
from preview_validate import validate_preview_html

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CONFIG_PATH = os.path.join(REPO_ROOT, "config", "ui-preview.json")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LEGACY_PREVIEW = os.path.join(SCRIPT_DIR, "preview.py")

INCLUDE_RE = re.compile(r"<\?!?=?\s*include\(\s*['\"]([^'\"]+)['\"]\s*\)\s*;?\s*\?>")
ASSET_RE = re.compile(r"<\?(!?)=\s*assets\.([A-Za-z0-9_]+)\s*\?>")
SCRIPTLET_RE = re.compile(r"<\?[\s\S]*?\?>")
DM_CORELIB_RE = re.compile(
    r"<\?!?=\s*CoreLib\.CoreUI\.(getStylesheet|getHeadScripts|getAppShell|getJsBundle|getAccessDeniedShell)\([^)]*\)\s*\?>"
)


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def find_file(folder, name):
    target = name.lower()
    for entry in os.listdir(folder):
        if entry.lower() == target:
            return os.path.join(folder, entry)
    return None


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_app_path(app_key):
    """app_key: solutions/SLG_DM, SLG_DM, or SLG_CAPACITY style appId."""
    cfg = load_config()
    apps = cfg["applications"]
    if app_key in apps:
        return app_key, apps[app_key]
    for path, meta in apps.items():
        if meta.get("appId") == app_key:
            return path, meta
    # shorthand folder name
    for path in apps:
        if path.endswith("/" + app_key) or path == app_key:
            return path, apps[path]
    return None, None


def placeholder_svg(key):
    safe = key.replace('"', "")
    return (
        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" '
        f'aria-label="{safe} placeholder"><title>{safe} (placeholder)</title>'
        '<path fill-rule="evenodd" clip-rule="evenodd" '
        'd="M3 3h18v18H3V3Zm2.4 2.4v13.2h13.2V5.4H5.4Z"/>'
        '<circle cx="12" cy="12" r="2.4"/></svg>'
    )


def placeholder_data_uri():
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='48'>"
        "<rect width='160' height='48' rx='6' fill='%230F2E66' opacity='0.12'/>"
        "<text x='80' y='30' font-family='Archivo,sans-serif' font-size='12' "
        "fill='%230F2E66' text-anchor='middle'>asset</text></svg>"
    )
    return "data:image/svg+xml;utf8," + svg


GENERIC_SHIM = """
<script>
/* LOCAL PREVIEW — generic mock google.script.* (no production endpoints) */
(function () {
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  function chain() { return chain; }
  chain.withSuccessHandler = function () { return chain; };
  chain.withFailureHandler = function () { return chain; };
  chain.withUserObject = function () { return chain; };
  var run = new Proxy({}, {
    get: function (_t, prop) {
      return function () {
        console.warn('[preview] unimplemented google.script.run.' + prop);
        return chain;
      };
    }
  });
  window.google.script.run = run;
  var noop = function () {};
  window.google.script.host = { close: noop, setHeight: noop, setWidth: noop, origin: "", editor: { focus: noop } };
  window.google.script.url = { getLocation: function (cb) { if (cb) cb({ parameter: {}, hash: "" }); } };
})();
</script>
<div id="gas-preview-badge" onclick="this.remove()"
  title="Local preview only — mock data; GAS server APIs unavailable. Click to dismiss."
  style="position:fixed;top:12px;left:12px;z-index:2147483647;font:600 11px/1.4 Archivo,system-ui,sans-serif;
  background:rgba(15,46,102,.92);color:#fff;padding:7px 12px;border-radius:999px;letter-spacing:.02em;
  box-shadow:0 2px 12px rgba(0,0,0,.18);cursor:pointer;max-width:min(92vw,520px);">
  LOCAL PREVIEW &mdash; mock data / GAS server APIs unavailable</div>
"""


def inject_preview_shim(doc: str, app_meta: dict | None = None, scenario: str = "mixed-health") -> str:
    """Insert preview shim before the last </body> (avoids JS string literals containing </body>)."""
    profile = (app_meta or {}).get("profile", "")
    mock_profile = (app_meta or {}).get("mockProfile")
    app_id = (app_meta or {}).get("appId", "")
    is_dm = profile == "dm-depmngr-webapp" or mock_profile == "dm-v1" or app_id.endswith("_DM")
    dm_early_inserted = False
    if is_dm:
        shim = build_dm_mock_script(app_id or "SLG_DM", scenario)
        marker = "// CoreUI client JS bundle"
        midx = doc.find(marker)
        if midx > 0:
            script_start = doc.rfind("<script>", 0, midx)
            if script_start >= 0:
                doc = doc[:script_start] + shim + "\n" + doc[script_start:]
                dm_early_inserted = True
    else:
        shim = GENERIC_SHIM
    lower = doc.lower()
    idx = lower.rfind("</body>")
    if idx == -1:
        return doc + shim
    if is_dm:
        if dm_early_inserted:
            badge_only = shim.split("</script>", 1)[-1] if "</script>" in shim else ""
            return doc[:idx] + badge_only + "\n</body>" + doc[idx + len("</body>") :]
        return doc[:idx] + shim + "\n</body>" + doc[idx + len("</body>") :]
    return doc[:idx] + shim + "\n</body>" + doc[idx + len("</body>") :]


def inline_includes(doc, folder, log):
    resolved = set()
    for _ in range(12):
        names = set(INCLUDE_RE.findall(doc))
        if not names:
            break
        for name in names:
            fname = name if name.lower().endswith(".html") else name + ".html"
            part = find_file(folder, fname)
            content = read(part) if part else ""
            if part:
                resolved.add(fname)
            else:
                log.append(f"  ! include('{name}') -> {fname} not found")
            doc = re.sub(
                r"<\?!?=?\s*include\(\s*['\"]" + re.escape(name) + r"['\"]\s*\)\s*;?\s*\?>",
                lambda m, c=content: c,
                doc,
            )
    if resolved:
        log.append(f"  inlined includes: {', '.join(sorted(resolved))}")
    return doc


def swap_assets(doc, log):
    asset_keys = []

    def repl_asset(m):
        unescaped, key = m.group(1) == "!", m.group(2)
        asset_keys.append(key)
        return placeholder_svg(key) if unescaped else placeholder_data_uri()

    doc = ASSET_RE.sub(repl_asset, doc)
    if asset_keys:
        log.append(f"  placeholder assets: {', '.join(sorted(set(asset_keys)))}")
    return doc


def node_extract(mode, solution_src_rel, config_name, code_name):
    mjs = os.path.join(SCRIPT_DIR, "gas_bundle_extract.mjs")
    cmd = ["node", mjs, REPO_ROOT, mode, solution_src_rel, config_name, code_name]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=SCRIPT_DIR,
    )
    if result.returncode != 0:
        raise RuntimeError(f"node extract {mode} failed: {result.stderr or result.stdout}")
    return result.stdout or ""


ACCESS_DENIED_SHELL = (
    '<div style="font-family:Arial,sans-serif;padding:60px 40px;text-align:center;max-width:600px;margin:0 auto;">'
    '<h2 style="color:#0f4c81;margin-bottom:16px;">Access Denied</h2>'
    "<p>Preview: access branch not used (mock user has access).</p></div>"
)


def apply_dm_depmngr(doc, app_path, app_meta, log):
    src_rel = os.path.join(app_path, app_meta.get("srcDir", "src")).replace("\\", "/")
    config_name = app_meta.get("configScript", "Config_APP.js")
    code_name = app_meta.get("codeConstants", "Code.js")

    bundles = {}
    for mode in ("css", "head", "shell", "js"):
        try:
            bundles[mode] = node_extract(mode, src_rel, config_name, code_name)
            log.append(f"  DepMngr extract {mode}: {len(bundles[mode])} chars")
        except RuntimeError as e:
            log.append(f"  ! DepMngr extract {mode} failed: {e}")
            bundles[mode] = ""

    def repl_corelib(m):
        fn = m.group(1)
        if fn == "getStylesheet":
            return bundles.get("css", "")
        if fn == "getHeadScripts":
            return bundles.get("head", "")
        if fn == "getAppShell":
            return bundles.get("shell", "")
        if fn == "getJsBundle":
            return bundles.get("js", "")
        if fn == "getAccessDeniedShell":
            return ACCESS_DENIED_SHELL
        return ""

    doc = DM_CORELIB_RE.sub(repl_corelib, doc)

    # Remove server script blocks (access gate, APP_UI_CONFIG builders) — inject mocks
    try:
        ui_json = node_extract("ui-config", src_rel, config_name, code_name).strip()
        if not ui_json or ui_json == "{}":
            ui_json = '{"appTitle":"Preview (mock)","preview":true}'
    except RuntimeError:
        ui_json = '{"appTitle":"Preview (mock)","preview":true}'
    mock_ui = ui_json
    mock_access = '{"role":"ADMIN","canViewApp":true,"email":"preview.user@workday.com"}'
    doc = re.sub(
        r"<\?\s*if\s*\(!__userAccess\.canViewApp\)\s*\{[\s\S]*?\<\?\s*\}\s*else\s*\{",
        "<? /* preview: access granted */ ",
        doc,
        count=1,
    )
    doc = re.sub(r"<\?\s*\}\s*\?>\s*</body>", "</body>", doc, count=1)
    doc = re.sub(r"<\?[\s\S]*?\?>", "", doc)
    doc = re.sub(
        r"window\.APP_UI_CONFIG\s*=\s*;",
        f"window.APP_UI_CONFIG = {mock_ui};",
        doc,
    )
    doc = re.sub(
        r"window\.__USER_ACCESS__\s*=\s*;",
        f"window.__USER_ACCESS__ = {mock_access};",
        doc,
    )
    if "window.APP_UI_CONFIG" not in doc:
        doc = doc.replace(
            "</head>",
            f"<script>window.APP_UI_CONFIG = {mock_ui}; window.__USER_ACCESS__ = {mock_access};</script>\n</head>",
            1,
        )
    doc = re.sub(r"<title>[^<]*</title>", "<title>Preview (local mock)</title>", doc, count=1)
    return doc


def build_app(app_key, out_name=None, open_browser=True, scenario="mixed-health"):  # noqa: ARG001
    app_path, app_meta = resolve_app_path(app_key)
    if not app_meta:
        sys.exit(f"error: unknown app '{app_key}'. See config/ui-preview.json")

    support = app_meta.get("previewSupport", "")
    if support == "NO_STANDALONE_UI":
        sys.exit(f"error: {app_path} is a function library with no standalone UI. Preview a consumer app.")
    if support == "NOT_YET":
        sys.exit(f"error: {app_path} is not previewable yet: {app_meta.get('note', '')}")

    cfg = load_config()
    profile_name = app_meta.get("profile", "html-includes")
    profiles = cfg.get("profiles", {})
    profile = profiles.get(profile_name, profiles.get("html-includes", {}))
    src_dir = os.path.join(REPO_ROOT, app_path, app_meta.get("srcDir", "src"))
    entry = app_meta.get("entry") or profile.get("entry", "index.html")
    entry_path = find_file(src_dir, entry) or os.path.join(src_dir, entry)
    if not os.path.isfile(entry_path):
        sys.exit(f"error: entry {entry} not found under {src_dir}")

    doc = read(entry_path)
    log = [f"app: {app_path} ({app_meta.get('appId', '')})", f"profile: {profile_name}"]

    if profile_name == "dm-depmngr-webapp" or profile.get("depMngr"):
        doc = apply_dm_depmngr(doc, app_path, app_meta, log)
    else:
        doc = inline_includes(doc, src_dir, log)
        doc = swap_assets(doc, log)
        if profile_name == "golives-index" or profile.get("stripScriptlets"):
            leftovers = SCRIPTLET_RE.findall(doc)
            if leftovers:
                doc = SCRIPTLET_RE.sub("", doc)
                log.append(f"  stripped {len(leftovers)} scriptlet(s)")

    if profile_name not in ("dm-depmngr-webapp",) and not profile.get("depMngr"):
        leftovers = SCRIPTLET_RE.findall(doc)
        if leftovers:
            doc = SCRIPTLET_RE.sub("", doc)
            log.append(f"  stripped {len(leftovers)} unresolved scriptlet(s)")

    doc = inject_preview_shim(doc, app_meta, scenario=scenario)

    out_dir = os.path.join(REPO_ROOT, cfg.get("outputDir", ".preview-out"))
    os.makedirs(out_dir, exist_ok=True)
    safe_name = app_meta.get("appId", app_key.replace("/", "_")).replace(" ", "_")
    out_file = out_name or f"{safe_name}.html"
    out_path = os.path.join(out_dir, out_file)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(doc)

    return out_path, log, doc


DM_APP_MARKERS = {
    "SLG_DM": ["id=\"coreui-app-shell\"", "preview-dm-mock-runtime", "Example County"],
    "HC_DM": ["id=\"coreui-app-shell\"", "preview-dm-mock-runtime"],
    "HENP_DM": ["id=\"coreui-app-shell\"", "preview-dm-mock-runtime"],
    "EVI_DM": ["id=\"coreui-app-shell\"", "preview-dm-mock-runtime"],
    "PDX_DM": ["id=\"coreui-app-shell\"", "preview-dm-mock-runtime"],
    "HS_DM": ["id=\"coreui-app-shell\"", "preview-dm-mock-runtime"],
}

APP_VALIDATION_MARKERS = {
    "SLG_DM": DM_APP_MARKERS["SLG_DM"],
    "PS_SPA": ["portal-card"],
    "SLG_GoLives": ["Go Lives"],
    "SLG_CAPACITY": ["wfm25-topbar", "wfm25-shell"],
}


def validate_built_preview(app_meta, html: str) -> tuple[bool, list]:
    app_id = app_meta.get("appId", "")
    markers = APP_VALIDATION_MARKERS.get(app_id) or DM_APP_MARKERS.get(app_id, [])
    return validate_preview_html(html, app_id=app_id, required_markers=markers or None)


def list_apps():
    cfg = load_config()
    rows = []
    for path, meta in sorted(cfg["applications"].items()):
        rows.append(
            (
                meta.get("appId", ""),
                path,
                meta.get("previewSupport", meta.get("profile", "")),
            )
        )
    return rows


def main():
    ap = argparse.ArgumentParser(description="Local GAS UI preview (monorepo)")
    ap.add_argument("app", nargs="?", help="App path, folder name, or appId from config/ui-preview.json")
    ap.add_argument("--list", action="store_true", help="List applications and preview support")
    ap.add_argument("--out", help="Output filename under .preview-out/")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--stop", action="store_true", help="Stop localhost preview server")
    ap.add_argument("--lint", action="store_true", help="Delegate to legacy preview.py lint (four-file apps only)")
    ap.add_argument("--folder", help="Legacy: compile folder with index.html (Chris four-file pattern)")
    ap.add_argument(
        "--scenario",
        default=os.environ.get("PREVIEW_SCENARIO", "mixed-health"),
        help="DM preview fixture scenario (default: mixed-health)",
    )
    args = ap.parse_args()

    cfg = load_config()
    out_dir = os.path.join(REPO_ROOT, cfg.get("outputDir", ".preview-out"))

    if args.stop:
        stop_server(out_dir)
        return

    if args.list:
        for app_id, path, support in list_apps():
            print(f"{app_id:20} {support:16} {path}")
        return

    if args.lint or args.folder:
        import importlib.util

        spec = importlib.util.spec_from_file_location("preview_legacy", LEGACY_PREVIEW)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        folder = args.folder or args.app or "."
        if args.lint:
            violations = mod.lint(os.path.abspath(folder))
            if violations:
                print(f"FAIL: {len(violations)} violation(s)")
                for v in violations:
                    print(f"  {v}")
                sys.exit(1)
            print("PASS")
            return
        out_path, log = mod.build(os.path.abspath(folder), args.out or "preview.html")
        for line in log:
            print(line)
        print(f"built {out_path}")
        return

    if not args.app:
        ap.print_help()
        sys.exit(2)

    out_path, log, html = build_app(args.app, out_name=args.out, scenario=args.scenario)
    app_path, app_meta = resolve_app_path(args.app)
    ok, issues = validate_built_preview(app_meta, html)
    print(f"built {out_path}")
    for line in log:
        print(line)
    if ok:
        print("validate: PASS (structural HTML)")
    else:
        print("validate: FAIL")
        for issue in issues:
            print(f"  - {issue}")
        sys.exit(1)

    if not args.no_open:
        base = ensure_server(out_dir)
        fname = os.path.basename(out_path)
        url = f"{base}/{fname}"
        if app_meta and app_meta.get("profile") == "dm-depmngr-webapp":
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}scenario={args.scenario}"
        webbrowser.open(url)
        print(f"opened {url}")
        print(f"preview server: {base}  (use .\\preview.ps1 --stop to stop)")


if __name__ == "__main__":
    main()

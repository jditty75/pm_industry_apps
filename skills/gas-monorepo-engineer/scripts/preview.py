#!/usr/bin/env python3
"""
preview.py - Local preview compiler for GAS web apps (gas-webapp-builder skill).

Compiles the four-file GAS structure (Code.gs, index.html, styles.html, scripts.html)
into ONE standalone preview.html you open in a browser, with NO deploy to Apps Script.

It:
  - Inlines include() scriptlets:  <?!= include('styles') ?>  ->  styles.html contents
  - Swaps Drive-hosted brand assets (<?!= assets.KEY ?>) for neutral placeholder SVGs
    that inherit currentColor, so layout, spacing, sizing, and recoloring stay accurate.
    (The real icons live in Google Drive behind org auth and can't be fetched locally.)
  - Mocks google.script.run so data-backed apps load their shell instead of throwing.
  - Drops a small "LOCAL PREVIEW" badge that auto-fades.

Best for static content sites (the common case) - they render fully. Data-backed tools
render their empty shell because google.script.run has no server to call locally.

Usage:
  python3 preview.py [APP_FOLDER] [--out preview.html] [--no-open]

APP_FOLDER defaults to the current directory. Point it at any folder that contains
index.html (and optionally styles.html / scripts.html / Code.gs).
"""

import argparse
import os
import re
import sys
import webbrowser

INCLUDE_RE = re.compile(r"<\?!?=?\s*include\(\s*['\"]([^'\"]+)['\"]\s*\)\s*\?>")
ASSET_RE = re.compile(r"<\?(!?)=\s*assets\.([A-Za-z0-9_]+)\s*\?>")
SCRIPTLET_RE = re.compile(r"<\?[\s\S]*?\?>")

# --- --lint rules -----------------------------------------------------------
#
# The four GAS files (Code.gs, index.html, styles.html, scripts.html) checked
# against the skill's hard rules (see SKILL.md "Cards and surfaces", "Required
# skeleton", and the brand gradient library). Kept intentionally simple and
# regex-based to match preview.py's existing style - no new dependencies.

LINT_FILES = ["Code.gs", "index.html", "styles.html", "scripts.html"]

# border-left declarations, shorthand or longhand width. Matches the same
# violation whether written `border-left: 4px solid ...` or split across
# `border-left-width: 4px；`. 1px hairlines are allowed (see Cards and
# surfaces: "use a 1px hairline border ... on all four sides").
BORDER_LEFT_RE = re.compile(
    r"border-left(?:-width)?\s*:\s*([0-9.]+)(px|em|rem)\b", re.IGNORECASE
)

BASE_TARGET_RE = re.compile(r"<base\s+target\s*=\s*[\"']_top[\"']\s*/?>", re.IGNORECASE)

GOOGLE_FONTS_LINK_RE = re.compile(
    r"<link[^>]+fonts\.googleapis\.com/css[12]\?family=([^\"'&]+)[^>]*>", re.IGNORECASE
)

GRADIENT_RE = re.compile(r"linear-gradient\(([^)]*)\)", re.IGNORECASE)
HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")

# Known stops from the toolkit gradient library (see SKILL.md "Brand gradient
# library"), lowercased. This is a hand-maintained mirror of the toolkit's
# named gradients (source of truth: the toolkit-gradient-reference shared
# drive) - update this set if the toolkit adds/changes a named gradient.
# Gradients built entirely from CSS custom properties (var(--...)) can't be
# checked against literal hex values and are treated as author's-discretion,
# not flagged.
KNOWN_GRADIENT_HEXES = {
    # workday-go-primary
    "#4c66bc", "#8579cf", "#c8a2e1", "#eec9db", "#f9d5c6", "#ffdbba", "#ffcf95", "#ffbe61", "#fd7e00",
    # workday-go-night-crop-4
    "#2356aa", "#2559af", "#ffd8b0",
    # agentic-it-set-a
    "#342e93", "#5642b1", "#804abc", "#c76cd3", "#e596b5", "#ffa753", "#ff9f2c",
    # agentic-it-set-b
    "#0c0a4a", "#241d91", "#3f2b98", "#6923b6",
    # agentic-it-set-c (shares #804abc, #c76cd3, #e596b5, #ffa753 with set-a)
    # agentic-hr-linear-day / agentic-hr-day-crop-4
    "#1b71b8", "#96d6d6", "#cae5ce", "#eeeeb7", "#fde695", "#fecb68", "#ff8315", "#519dc5", "#feac44",
    # agentic-finance-day-crop-3 / -5
    "#3a92c1", "#6fc9d3", "#fde18c", "#0057ae", "#fdde87",
    # brand core (Ink/Ballpoint/Paper etc. sometimes used as a gradient endpoint)
    "#0f2e66", "#022043", "#ffffff",
}


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def find_file(folder, name):
    """Case-insensitive lookup so 'styles.html' matches 'Styles.html' etc."""
    target = name.lower()
    for entry in os.listdir(folder):
        if entry.lower() == target:
            return os.path.join(folder, entry)
    return None


def placeholder_svg(key):
    """A framed-square + dot glyph. All fills are currentColor, so the app's own
    .brand-icon rules recolor it exactly like the real icon would be recolored."""
    safe = key.replace('"', "")
    return (
        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" '
        f'aria-label="{safe} placeholder"><title>{safe} (placeholder)</title>'
        '<path fill-rule="evenodd" clip-rule="evenodd" '
        'd="M3 3h18v18H3V3Zm2.4 2.4v13.2h13.2V5.4H5.4Z"/>'
        '<circle cx="12" cy="12" r="2.4"/></svg>'
    )


def placeholder_data_uri():
    """For the escaped raster case: <img src="<?= assets.logo ?>">."""
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='48'>"
        "<rect width='160' height='48' rx='6' fill='%230F2E66' opacity='0.12'/>"
        "<text x='80' y='30' font-family='Archivo,sans-serif' font-size='12' "
        "fill='%230F2E66' text-anchor='middle'>asset</text></svg>"
    )
    return "data:image/svg+xml;utf8," + svg


SHIM = """
<script>
/* gas-webapp-builder local preview shim: mock google.script.* so the app loads */
(function () {
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  var run = new Proxy({}, { get: function () { return function () { return run; }; } });
  window.google.script.run = run;
  var noop = function () {};
  window.google.script.host = { close: noop, setHeight: noop, setWidth: noop, origin: "", editor: { focus: noop } };
  window.google.script.url = { getLocation: function (cb) { if (cb) cb({ parameter: {}, hash: "" }); } };
  var PH = __PLACEHOLDER__;
  document.querySelectorAll("[data-asset]").forEach(function (el) {
    if (!el.innerHTML.trim()) el.innerHTML = PH;
  });
})();
</script>
<div id="gas-preview-badge" onclick="this.remove()"
  title="Local preview. Brand icons are placeholders. Click to dismiss."
  style="position:fixed;top:12px;left:12px;z-index:2147483647;font:600 11px/1.4 Archivo,system-ui,sans-serif;
  background:rgba(15,46,102,.92);color:#fff;padding:7px 12px;border-radius:999px;letter-spacing:.04em;
  box-shadow:0 2px 12px rgba(0,0,0,.18);transition:opacity .6s;cursor:pointer;">LOCAL PREVIEW &middot; placeholders</div>
<script>
setTimeout(function () {
  var b = document.getElementById("gas-preview-badge");
  if (!b) return; b.style.opacity = "0";
  setTimeout(function () { if (b) b.remove(); }, 700);
}, 5000);
</script>
"""


def build(folder, out_name):
    index_path = find_file(folder, "index.html")
    if not index_path:
        sys.exit(f"error: no index.html found in {folder}")

    doc = read(index_path)
    log = []

    # 1) Inline include() partials (loop so partials can include partials).
    resolved = set()
    for _ in range(10):
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
                log.append(f"  ! include('{name}') -> {fname} not found, left blank")
            doc = re.sub(
                r"<\?!?=?\s*include\(\s*['\"]" + re.escape(name) + r"['\"]\s*\)\s*\?>",
                lambda m: content,
                doc,
            )
    if resolved:
        log.append(f"  inlined includes: {', '.join(sorted(resolved))}")

    # 2) Swap Drive brand assets for placeholders.
    asset_keys = []

    def repl_asset(m):
        unescaped, key = m.group(1) == "!", m.group(2)
        asset_keys.append(key)
        return placeholder_svg(key) if unescaped else placeholder_data_uri()

    doc = ASSET_RE.sub(repl_asset, doc)
    if asset_keys:
        uniq = sorted(set(asset_keys))
        log.append(f"  placeholder assets ({len(uniq)}): {', '.join(uniq)}")

    # 3) Strip any remaining scriptlets (server values we can't resolve locally).
    leftovers = SCRIPTLET_RE.findall(doc)
    if leftovers:
        doc = SCRIPTLET_RE.sub("", doc)
        log.append(f"  stripped {len(leftovers)} unresolved scriptlet(s) - data-backed values won't render")

    # 4) Inject the preview shim + badge.
    shim = SHIM.replace("__PLACEHOLDER__", repr(placeholder_svg("asset")))
    if "</body>" in doc:
        doc = doc.replace("</body>", shim + "\n</body>", 1)
    else:
        doc += shim

    out_path = os.path.join(folder, out_name)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(doc)
    return out_path, log


def lint(folder):
    """Check the four GAS files against the skill's hard rules. Returns a list
    of violation strings formatted as 'file:line: message', or [] if clean."""
    violations = []

    for fname in LINT_FILES:
        path = find_file(folder, fname)
        if not path:
            continue  # e.g. no Code.gs in a static-only app; not itself a violation

        # Filename must match the canonical casing from SKILL.md Step 5 exactly:
        # "Code.gs", "index.html", "styles.html", "scripts.html". Code.gs is the
        # only one that isn't all-lowercase - that's intentional, not a violation.
        actual = os.path.basename(path)
        if actual != fname:
            violations.append(f"{actual}: filename should be exactly '{fname}' (case-sensitive)")

        text = read(path)
        lines = text.splitlines()

        for i, line in enumerate(lines, start=1):
            # border-left wider than 1px (banned accent stripe; see Cards and surfaces).
            m = BORDER_LEFT_RE.search(line)
            if m:
                width, unit = float(m.group(1)), m.group(2).lower()
                if not (unit == "px" and width <= 1):
                    violations.append(
                        f"{actual}:{i}: border-left wider than 1px ('{line.strip()}') - "
                        "banned accent stripe, see Cards and surfaces"
                    )

            # Google Fonts links pulling in anything other than Archivo.
            fm = GOOGLE_FONTS_LINK_RE.search(line)
            if fm:
                families = [f.split(":")[0].replace("+", " ") for f in fm.group(1).split("|")]
                non_archivo = [f for f in families if f.strip().lower() != "archivo"]
                if non_archivo:
                    violations.append(
                        f"{actual}:{i}: Google Fonts link loads non-Archivo font(s): {', '.join(non_archivo)}"
                    )

            # linear-gradient() stops that don't match the toolkit gradient library.
            for gm in GRADIENT_RE.finditer(line):
                stops = gm.group(1)
                hexes = [h.lower() for h in HEX_RE.findall(stops)]
                if not hexes:
                    continue  # var(--...)-based gradient; can't verify literal stops, skip
                unknown = [h for h in hexes if h not in KNOWN_GRADIENT_HEXES]
                if unknown:
                    violations.append(
                        f"{actual}:{i}: linear-gradient() uses stop(s) not in the toolkit gradient "
                        f"library: {', '.join(sorted(set(unknown)))}"
                    )

        # Missing <base target="_top"> - only meaningful for index.html.
        if fname == "index.html" and not BASE_TARGET_RE.search(text):
            violations.append(f"{actual}: missing <base target=\"_top\"> in <head>")

    return violations


def main():
    ap = argparse.ArgumentParser(description="Compile a GAS web app into a standalone local preview.html")
    ap.add_argument("folder", nargs="?", default=".", help="App folder containing index.html (default: .)")
    ap.add_argument("--out", default="preview.html", help="Output filename (default: preview.html)")
    ap.add_argument("--no-open", action="store_true", help="Do not auto-open in the browser")
    ap.add_argument(
        "--lint",
        action="store_true",
        help="Check the four GAS files against the skill's hard rules and exit (no preview build)",
    )
    args = ap.parse_args()

    folder = os.path.abspath(args.folder)
    if os.path.isfile(folder):
        folder = os.path.dirname(folder)
    if not os.path.isdir(folder):
        sys.exit(f"error: not a folder: {folder}")

    if args.lint:
        violations = lint(folder)
        if not violations:
            print(f"PASS: no violations in {folder}")
            return
        print(f"FAIL: {len(violations)} violation(s) in {folder}")
        for v in violations:
            print(f"  {v}")
        sys.exit(1)

    out_path, log = build(folder, args.out)
    print(f"built {out_path}")
    for line in log:
        print(line)
    if not args.no_open:
        webbrowser.open("file://" + out_path)
        print("opened in your default browser")
    else:
        print("open it with:  open " + repr(out_path))


if __name__ == "__main__":
    main()

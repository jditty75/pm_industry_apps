#!/usr/bin/env python3
"""Build isolated DM UX concept preview HTML into .preview-out/DM_UX.html."""

from __future__ import annotations

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
ENGINE_DIR = os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def extract_depmngr_css() -> str:
    mjs = os.path.join(ENGINE_DIR, "gas_bundle_extract.mjs")
    cmd = [
        "node",
        mjs,
        REPO,
        "css",
        "solutions/SLG_DM/src",
        "Config_SLG.js",
        "Code.js",
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=ENGINE_DIR,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or "css extract failed")
    css = result.stdout or ""
    if not css.strip().startswith("<style"):
        css = f"<style>{css}</style>"
    return css


def ensure_fixtures() -> dict:
    gen = os.path.join(SCRIPT_DIR, "generate_fixtures.py")
    bundle_path = os.path.join(SCRIPT_DIR, "fixtures", "generated-bundle.json")
    if not os.path.isfile(bundle_path):
        subprocess.run([sys.executable, gen], check=True, cwd=SCRIPT_DIR)
    with open(bundle_path, encoding="utf-8") as f:
        return json.load(f)


def build(out_dir: str | None = None) -> str:
    cfg_path = os.path.join(REPO, "config", "ui-preview.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    preview_out = out_dir or os.path.join(REPO, cfg.get("outputDir", ".preview-out"))
    os.makedirs(preview_out, exist_ok=True)

    template = read(os.path.join(SCRIPT_DIR, "src", "template.html"))
    proto_css = read(os.path.join(SCRIPT_DIR, "src", "prototype.css"))
    proto_js = read(os.path.join(SCRIPT_DIR, "src", "prototype.js"))
    fixtures = ensure_fixtures()
    dep_css = extract_depmngr_css()

    html = (
        template.replace("__DEPMNGR_CSS__", dep_css)
        .replace("__PROTOTYPE_CSS__", proto_css)
        .replace("__PROTOTYPE_JS__", proto_js)
        .replace("__FIXTURES_JSON__", json.dumps(fixtures, separators=(",", ":")))
    )

    out_path = os.path.join(preview_out, "DM_UX.html")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    return out_path


def main() -> None:
    path = build()
    print(f"built: {path}")


if __name__ == "__main__":
    main()

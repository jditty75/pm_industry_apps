#!/usr/bin/env python3
"""Build CSAT Overview A/B/C preview HTML into .preview-out/."""

from __future__ import annotations

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
ENGINE_DIR = os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts")

sys.path.insert(0, SCRIPT_DIR)
from csat_overview_render import (  # noqa: E402
    load_fixture,
    render_overview_a,
    render_overview_b,
    render_overview_c,
    wrap_page,
)


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


def build(out_dir: str | None = None) -> list[str]:
    cfg_path = os.path.join(REPO, "config", "ui-preview.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    preview_out = out_dir or os.path.join(REPO, cfg.get("outputDir", ".preview-out"))
    os.makedirs(preview_out, exist_ok=True)

    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-overview-fixture.json")
    fixture = load_fixture(fixture_path)
    dep_css = extract_depmngr_css()
    proto_css = read(os.path.join(SCRIPT_DIR, "src", "csat-overview.css"))

    pages = [
        ("DM_UX_CSAT_A.html", "A", "CSAT Overview — Composition A (local)", render_overview_a(fixture)),
        ("DM_UX_CSAT_B.html", "B", "CSAT Overview — Composition B (local)", render_overview_b(fixture)),
        ("DM_UX_CSAT_C.html", "C", "CSAT Overview — Composition C (local)", render_overview_c(fixture)),
    ]
    paths = []
    for fname, comp, title, inner in pages:
        html = wrap_page(title, comp, inner, fixture, dep_css, proto_css)
        out_path = os.path.join(preview_out, fname)
        with open(out_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(html)
        paths.append(out_path)
    return paths


def main() -> None:
    for p in build():
        print(f"built: {p}")


if __name__ == "__main__":
    main()

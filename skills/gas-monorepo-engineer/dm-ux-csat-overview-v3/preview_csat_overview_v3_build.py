#!/usr/bin/env python3
"""Build CSAT Overview V3 preview HTML into .preview-out/."""

from __future__ import annotations

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
ENGINE_DIR = os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts")

sys.path.insert(0, SCRIPT_DIR)
from csat_overview_v3_render import (  # noqa: E402
    STATE_ORDER,
    load_fixture,
    render_index,
    render_state_page,
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
        "solutions/HC_DM/src",
        "Config_HC.js",
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

    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-overview-v3-states.json")
    fixture = load_fixture(fixture_path)
    dep_css = extract_depmngr_css()
    proto_css = read(os.path.join(SCRIPT_DIR, "src", "csat-overview-v3.css"))

    paths: list[str] = []
    index_html = wrap_page(
        "CSAT Overview V3 — state index (local)",
        render_index(),
        fixture,
        dep_css,
        proto_css,
    )
    index_path = os.path.join(preview_out, "CSAT_OVERVIEW_V3_INDEX.html")
    with open(index_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(index_html)
    paths.append(index_path)

    states = fixture["states"]
    for key in STATE_ORDER:
        st = states[key]
        fname = st["file"]
        title = f"CSAT Overview V3 — {st['protoLabel']} (local)"
        body = render_state_page(st, fixture)
        html = wrap_page(title, body, fixture, dep_css, proto_css)
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

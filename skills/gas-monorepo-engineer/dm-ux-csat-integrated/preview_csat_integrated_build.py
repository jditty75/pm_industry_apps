#!/usr/bin/env python3
"""Build CSAT integrated prototype HTML into .preview-out/."""

from __future__ import annotations

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
ENGINE_DIR = os.path.join(REPO, "skills", "gas-monorepo-engineer", "scripts")

sys.path.insert(0, SCRIPT_DIR)
from csat_integrated_render import (  # noqa: E402
    build_view_fragments,
    load_integrated_fixture,
    render_index,
    render_integrated_shell,
    wrap_page,
)


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def extract_depmngr_css() -> str:
    mjs = os.path.join(ENGINE_DIR, "gas_bundle_extract.mjs")
    cmd = ["node", mjs, REPO, "css", "solutions/HC_DM/src", "Config_HC.js", "Code.js"]
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


def css_bundle() -> str:
    v3 = read(os.path.join(REPO, "skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/src/csat-overview-v3.css"))
    sv = read(os.path.join(REPO, "skills/gas-monorepo-engineer/dm-ux-csat-surveys/src/csat-surveys.css"))
    shared = read(os.path.join(SCRIPT_DIR, "src/csat-shared.css"))
    ix = read(os.path.join(SCRIPT_DIR, "src/csat-integrated.css"))
    return v3 + "\n" + sv + "\n" + shared + "\n" + ix


def build(out_dir: str | None = None) -> list[str]:
    cfg_path = os.path.join(REPO, "config", "ui-preview.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    preview_out = out_dir or os.path.join(REPO, cfg.get("outputDir", ".preview-out"))
    os.makedirs(preview_out, exist_ok=True)

    ix_path = os.path.join(SCRIPT_DIR, "fixtures", "csat-integrated-states.json")
    ix = load_integrated_fixture(ix_path)
    v3_meta = json.load(
        open(
            os.path.join(REPO, "skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/fixtures/csat-overview-v3-states.json"),
            encoding="utf-8",
        )
    )
    sv_meta = json.load(
        open(
            os.path.join(REPO, "skills/gas-monorepo-engineer/dm-ux-csat-surveys/fixtures/csat-surveys-states.json"),
            encoding="utf-8",
        )
    )

    dep_css = extract_depmngr_css()
    css = css_bundle()
    js = read(os.path.join(SCRIPT_DIR, "src/csat-integrated.js"))

    paths: list[str] = []
    index_html = wrap_page(
        "CSAT integrated — index",
        render_index(ix),
        ix,
        {},
        dep_css,
        css,
        js,
        "DEFAULT",
    )
    index_path = os.path.join(preview_out, "CSAT_INTEGRATED_INDEX.html")
    with open(index_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(index_html)
    paths.append(index_path)

    for state_key, st in ix["states"].items():
        app_key = st.get("app", "hc")
        views = build_view_fragments(ix, v3_meta, sv_meta, app_key)
        initial_state = state_key if st.get("responses") else "RESPONSES_NORMAL"
        if state_key.startswith("RESPONSES_"):
            initial_state = state_key
        route = st.get("route", "#/overview")
        t2 = state_key == "RESPONSES_T2_DETAIL"
        body = render_integrated_shell(
            ix,
            views["shellKey"],
            "Fri 9 Oct 2026",
            route,
            state_key,
            views,
            t2=t2,
        )
        views_payload = {
            "overview": views["overview"],
            "surveys": views["surveys"],
            "responsesStates": views["responsesStates"],
            "deployments": views["deployments"],
            "appKey": app_key,
        }
        html = wrap_page(
            f"CSAT integrated — {st.get('protoLabel', state_key)}",
            body,
            ix,
            views_payload,
            dep_css,
            css,
            js,
            initial_state if state_key.startswith("RESPONSES_") else state_key,
        )
        fname = st["file"]
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

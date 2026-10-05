#!/usr/bin/env python3
"""Resolve container spreadsheet IDs for HC/SLG/HENP DM projects (read-only Apps Script API).

Does not print full IDs unless --verbose. Use with clasp login already configured.
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
APPS = {
    "HC_DM": REPO / "solutions/HC_DM/.clasp.json",
    "SLG_DM": REPO / "solutions/SLG_DM/.clasp.json",
    "HENP_DM": REPO / "solutions/HENP_DM/.clasp.json",
}


def load_access_token() -> str:
    clasprc = Path.home() / ".clasprc.json"
    data = json.loads(clasprc.read_text(encoding="utf-8"))
    tokens = data.get("tokens", {}).get("default", data.get("token", {}))
    if isinstance(tokens, dict) and "access_token" in tokens:
        return tokens["access_token"]
    raise SystemExit("Missing clasp access token; run clasp login")


def script_parent_id(script_id: str, token: str) -> str:
    url = f"https://script.googleapis.com/v1/projects/{script_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        project = json.loads(resp.read().decode("utf-8"))
    parent = project.get("parentId") or ""
    if not parent:
        raise ValueError(f"{script_id}: no parentId (standalone script?)")
    return parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true", help="print full spreadsheet IDs")
    parser.add_argument(
        "--json",
        action="store_true",
        help="print JSON map to stdout (for local orchestration only; do not commit)",
    )
    args = parser.parse_args()
    token = load_access_token()
    resolved: dict[str, str] = {}
    for app, clasp_path in APPS.items():
        if not clasp_path.is_file():
            print(f"{app}: SKIP (no local .clasp.json)")
            continue
        script_id = json.loads(clasp_path.read_text(encoding="utf-8-sig")).get("scriptId", "")
        if not script_id:
            print(f"{app}: SKIP (empty scriptId)")
            continue
        parent = script_parent_id(script_id, token)
        resolved[app] = parent
        if args.verbose:
            print(f"{app}={parent}")
        else:
            print(f"{app}: resolved (len={len(parent)})")
    if not resolved:
        raise SystemExit(1)
    if args.json:
        print(json.dumps(resolved))
        return
    print("Set via EdmSetup.setDestinationSpreadsheetId in GAS or Script Properties:")
    for app, sid in resolved.items():
        key = {
            "HC_DM": "EDM_DEST_HC_DM_SPREADSHEET_ID",
            "SLG_DM": "EDM_DEST_SLG_DM_SPREADSHEET_ID",
            "HENP_DM": "EDM_DEST_HENP_DM_SPREADSHEET_ID",
        }[app]
        print(f"  {key}")


if __name__ == "__main__":
    main()

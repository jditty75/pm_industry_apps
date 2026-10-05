#!/usr/bin/env python3
"""Invoke EDM clasp-run helpers via Apps Script API (no IDs in default output)."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CLASP = REPO / "solutions/External_Data_Manager/.clasp.json"


def load_access_token() -> str:
    clasprc = Path.home() / ".clasprc.json"
    data = json.loads(clasprc.read_text(encoding="utf-8"))
    tokens = data.get("tokens", {}).get("default", data.get("token", {}))
    if isinstance(tokens, dict) and "access_token" in tokens:
        return tokens["access_token"]
    raise SystemExit("Missing clasp access token; run clasp login")


def load_script_id() -> str:
    if not CLASP.is_file():
        raise SystemExit("Missing solutions/External_Data_Manager/.clasp.json")
    return json.loads(CLASP.read_text(encoding="utf-8-sig")).get("scriptId", "")


def run_function(name: str, params: list | None = None, dev_mode: bool = True) -> dict:
    token = load_access_token()
    script_id = load_script_id()
    if not script_id:
        raise SystemExit("Empty EDM scriptId in .clasp.json")
    url = f"https://script.googleapis.com/v1/scripts/{script_id}:run"
    body: dict = {"function": name, "devMode": dev_mode}
    if params is not None:
        body["parameters"] = params
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code}: {detail}") from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("function", help="Top-level GAS function name")
    parser.add_argument(
        "--params-json",
        help="JSON array of parameters (file path or inline JSON)",
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    params = None
    if args.params_json:
        raw = args.params_json
        if Path(raw).is_file():
            raw = Path(raw).read_text(encoding="utf-8")
        params = json.loads(raw)
    result = run_function(args.function, params)
    if args.pretty:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result))


if __name__ == "__main__":
    main()

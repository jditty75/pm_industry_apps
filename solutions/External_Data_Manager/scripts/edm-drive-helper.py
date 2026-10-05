#!/usr/bin/env python3
"""Drive helpers for EDM setup when Apps Script API run is unavailable."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path


def load_clasp_token() -> str:
    clasprc = Path.home() / ".clasprc.json"
    data = json.loads(clasprc.read_text(encoding="utf-8"))
    tokens = data.get("tokens", {}).get("default", data.get("token", {}))
    if isinstance(tokens, dict) and tokens.get("access_token"):
        return tokens["access_token"]
    raise SystemExit("Missing clasp access token; run clasp login")


def find_folders_named(name: str) -> list[dict]:
    token = load_clasp_token()
    q = urllib.parse.quote(f"mimeType='application/vnd.google-apps.folder' and name='{name}' and trashed=false")
    url = f"https://www.googleapis.com/drive/v3/files?q={q}&fields=files(id,name,parents)&pageSize=20"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload.get("files", [])


def main() -> None:
    folders = find_folders_named("External Data")
    print(f"matches={len(folders)}")
    for f in folders:
        print(f"name={f.get('name')} id_len={len(f.get('id',''))}")


if __name__ == "__main__":
    main()

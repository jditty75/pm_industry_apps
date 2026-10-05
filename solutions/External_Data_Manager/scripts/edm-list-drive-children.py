#!/usr/bin/env python3
"""List child file names in a Drive folder (shared-drive safe; no IDs printed)."""
import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path


def token() -> str:
    data = json.loads((Path.home() / ".clasprc.json").read_text(encoding="utf-8"))
    return data["tokens"]["default"]["access_token"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent-folder-id", required=True)
    args = parser.parse_args()
    q = urllib.parse.quote(f"'{args.parent_folder_id}' in parents and trashed=false")
    url = (
        f"https://www.googleapis.com/drive/v3/files?q={q}"
        "&fields=files(name,mimeType)&pageSize=50"
        "&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        files = json.loads(resp.read().decode("utf-8")).get("files", [])
    for f in sorted(files, key=lambda x: x.get("name", "")):
        print(f["name"], f.get("mimeType", ""))


if __name__ == "__main__":
    main()

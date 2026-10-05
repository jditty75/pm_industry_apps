#!/usr/bin/env python3
"""Drive/Sheets bootstrap when scripts.run is unavailable (no Script Properties)."""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIXTURE = REPO / "solutions/External_Data_Manager/test/fixtures/synthetic-qualtrics.csv"
SYNTH_NAME = "synthetic-qualtrics-dryrun.csv"


def token() -> str:
    data = json.loads((Path.home() / ".clasprc.json").read_text(encoding="utf-8"))
    t = data.get("tokens", {}).get("default", {})
    return t["access_token"]


def drive_url(path: str) -> str:
    sep = "&" if "?" in path else "?"
    if "supportsAllDrives=true" not in path:
        path = f"{path}{sep}supportsAllDrives=true"
    return path


def api(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {token()}"}
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        h["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {url} -> HTTP {exc.code}: {exc.read().decode()}") from exc


def find_child_folder(parent_id: str, name: str) -> str | None:
    q = urllib.parse.quote(
        f"mimeType='application/vnd.google-apps.folder' and '{parent_id}' in parents and name='{name}' and trashed=false"
    )
    url = drive_url(
        f"https://www.googleapis.com/drive/v3/files?q={q}&fields=files(id,name)&pageSize=5"
        "&includeItemsFromAllDrives=true&corpora=allDrives"
    )
    res = api("GET", url)
    files = res.get("files", [])
    if len(files) > 1:
        raise SystemExit(f"Ambiguous folder {name} under parent")
    return files[0]["id"] if files else None


def create_folder(parent_id: str, name: str) -> str:
    body = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    res = api("POST", drive_url("https://www.googleapis.com/drive/v3/files?fields=id"), body)
    return res["id"]


def find_or_create(parent_id: str, name: str) -> str:
    existing = find_child_folder(parent_id, name)
    if existing:
        return existing
    return create_folder(parent_id, name)


def create_ledger_spreadsheet() -> str:
    body = {"properties": {"title": "External Data Manager — Job Ledger"}}
    res = api("POST", "https://sheets.googleapis.com/v4/spreadsheets", body)
    ss_id = res["spreadsheetId"]
    sheet_id = res["sheets"][0]["properties"]["sheetId"]
    headers = [
        "job_id",
        "pipeline",
        "source_filename",
        "source_checksum",
        "source_export_timestamp",
        "created_at",
        "updated_at",
        "transformer_version",
        "source_row_count",
        "healthcare_count",
        "sled_count",
        "hc_ingest_count",
        "slg_ingest_count",
        "henp_ingest_count",
        "destination_statuses",
        "overall_status",
        "error_category",
        "error_message",
        "source_disposition",
        "git_sha",
        "override_flags",
        "hc_eligible",
        "slg_eligible",
        "henp_eligible",
    ]
    api(
        "POST",
        f"https://sheets.googleapis.com/v4/spreadsheets/{ss_id}:batchUpdate",
        {
            "requests": [
                {
                    "updateSheetProperties": {
                        "properties": {"sheetId": sheet_id, "title": "EdmJobLedger"},
                        "fields": "title",
                    }
                }
            ]
        },
    )
    api(
        "PUT",
        f"https://sheets.googleapis.com/v4/spreadsheets/{ss_id}/values/EdmJobLedger!A1?valueInputOption=RAW",
        {"values": [headers]},
        headers={"Content-Type": "application/json"},
    )
    return ss_id


def upload_text_to_folder(folder_id: str, name: str, text: str, mime: str) -> str:
    q = urllib.parse.quote(f"'{folder_id}' in parents and name='{name}' and trashed=false")
    res = api("GET", drive_url(f"https://www.googleapis.com/drive/v3/files?q={q}&fields=files(id)&pageSize=10"))
    for f in res.get("files", []):
        api("PATCH", drive_url(f"https://www.googleapis.com/drive/v3/files/{f['id']}"), {"trashed": True})
    metadata = json.dumps({"name": name, "parents": [folder_id], "mimeType": mime})
    # multipart upload
    import base64

    boundary = "edm_boundary"
    body = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: {mime}\r\n\r\n"
        f"{text}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    req = urllib.request.Request(
        drive_url("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id"),
        data=body,
        headers={
            "Authorization": f"Bearer {token()}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))["id"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent-folder-id", required=True)
    parser.add_argument("--dest-json", help="path to resolve-edm-destinations --json output")
    parser.add_argument("--skip-csv", action="store_true")
    args = parser.parse_args()
    parent = args.parent_folder_id
    qualtrics = find_or_create(parent, "Qualtrics")
    inbox = find_or_create(qualtrics, "Inbox")
    failed = find_or_create(qualtrics, "Failed")
    dest: dict[str, str] = {}
    if args.dest_json:
        raw = Path(args.dest_json).read_text(encoding="utf-8").strip()
        if raw.startswith("{"):
            dest = json.loads(raw)
        else:
            dest = json.loads(raw.splitlines()[-1])
    out = {
        "ok": True,
        "parent_len": len(parent),
        "inbox_len": len(inbox),
        "failed_len": len(failed),
        "dest_keys": list(dest.keys()),
        "property_values": {
            "EXTERNAL_DATA_PARENT_FOLDER_ID": parent,
            "QUALTRICS_INBOX_FOLDER_ID": inbox,
            "QUALTRICS_FAILED_FOLDER_ID": failed,
            "EDM_DEST_HC_DM_SPREADSHEET_ID": dest.get("HC_DM", ""),
            "EDM_DEST_SLG_DM_SPREADSHEET_ID": dest.get("SLG_DM", ""),
            "EDM_DEST_HENP_DM_SPREADSHEET_ID": dest.get("HENP_DM", ""),
        },
    }
    if not args.skip_csv:
        csv = FIXTURE.read_text(encoding="utf-8")
        fid = upload_text_to_folder(inbox, SYNTH_NAME, csv, "text/csv")
        out["inbox_csv_len"] = len(fid)
    # Write bootstrap file for GAS import (local only, gitignored path)
    bootstrap_path = REPO / ".ai/edm-v1b-bootstrap-properties.json"
    bootstrap_path.parent.mkdir(parents=True, exist_ok=True)
    bootstrap_path.write_text(json.dumps(out["property_values"], indent=2), encoding="utf-8")
    bootstrap_json = json.dumps(out["property_values"])
    upload_text_to_folder(parent, "edm-v1b-bootstrap.json", bootstrap_json, "application/json")
    safe = {k: v for k, v in out.items() if k != "property_values"}
    safe["properties_written_to"] = str(bootstrap_path)
    safe["property_names"] = list(out["property_values"].keys())
    print(json.dumps(safe, indent=2))


if __name__ == "__main__":
    main()

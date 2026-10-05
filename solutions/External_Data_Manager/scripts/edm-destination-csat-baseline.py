#!/usr/bin/env python3
"""Read-only CSAT_InFlight baselines for HC/SLG/HENP DM workbooks (no PII in output)."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
APPS = ("HC_DM", "SLG_DM", "HENP_DM")
SHEET = "CSAT_InFlight"
EXPECTED_HEADERS = [
    "deployment_id",
    "account_name",
    "deployment_name",
    "survey_type",
    "tracking_status",
    "response_received",
    "contact_name",
    "contact_email",
    "contact_role",
    "engagement_manager",
    "partner_name",
    "sent_date",
    "opened_date",
    "started_date",
    "finished_date",
    "survey_expires",
]


def load_access_token() -> str:
    clasprc = Path.home() / ".clasprc.json"
    data = json.loads(clasprc.read_text(encoding="utf-8"))
    tokens = data.get("tokens", {}).get("default", data.get("token", {}))
    if isinstance(tokens, dict) and tokens.get("access_token"):
        return tokens["access_token"]
    raise SystemExit("Missing clasp access token; run clasp login")


def script_parent_id(script_id: str, token: str) -> str:
    url = f"https://script.googleapis.com/v1/projects/{script_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        project = json.loads(resp.read().decode("utf-8"))
    parent = project.get("parentId") or ""
    if not parent:
        raise ValueError("no parentId")
    return parent


def sheet_row_count(spreadsheet_id: str, sheet_title: str, token: str) -> int:
    enc = urllib.parse.quote(sheet_title)
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
        f"?fields=sheets(properties(title,gridProperties(rowCount,columnCount)))"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        meta = json.loads(resp.read().decode("utf-8"))
    for sh in meta.get("sheets", []):
        props = sh.get("properties", {})
        if props.get("title") == sheet_title:
            grid = props.get("gridProperties", {})
            return int(grid.get("rowCount") or 0)
    return 0


def sheet_header_row(spreadsheet_id: str, sheet_title: str, token: str) -> list[str]:
    enc = urllib.parse.quote(f"'{sheet_title}'!1:1")
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{enc}"
        "?majorDimension=ROWS"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    rows = payload.get("values") or []
    return [str(c) for c in (rows[0] if rows else [])]


def consumer_manifest_corelib_version(app: str, token: str) -> str:
    clasp_path = REPO / f"solutions/{app}/.clasp.json"
    script_id = json.loads(clasp_path.read_text(encoding="utf-8-sig")).get("scriptId", "")
    url = f"https://script.googleapis.com/v1/projects/{script_id}/content"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        content = json.loads(resp.read().decode("utf-8"))
    for f in content.get("files", []):
        if f.get("name") == "appsscript":
            manifest = json.loads(f.get("source", "{}"))
            for lib in manifest.get("dependencies", {}).get("libraries", []):
                if lib.get("userSymbol") == "CoreLib":
                    return str(lib.get("version", "?"))
    return "?"


def main() -> None:
    token = load_access_token()
    report: dict = {"apps": {}, "expectedCsatHeaders": EXPECTED_HEADERS}
    for app in APPS:
        clasp_path = REPO / f"solutions/{app}/.clasp.json"
        script_id = json.loads(clasp_path.read_text(encoding="utf-8-sig")).get("scriptId", "")
        spreadsheet_id = script_parent_id(script_id, token)
        headers = sheet_header_row(spreadsheet_id, SHEET, token)
        grid_rows = sheet_row_count(spreadsheet_id, SHEET, token)
        data_rows = max(0, grid_rows - 1) if headers else 0
        corelib = consumer_manifest_corelib_version(app, token)
        report["apps"][app] = {
            "coreLibPinLive": corelib,
            "csatInFlightSheetPresent": bool(headers),
            "headerColumnCount": len(headers),
            "headersMatchExpected": headers == EXPECTED_HEADERS,
            "csatInFlightDataRowCount": data_rows,
            "gridRowCountIncludingHeader": grid_rows,
            "backupFolderName": "DHM_CSAT_Imports",
        }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

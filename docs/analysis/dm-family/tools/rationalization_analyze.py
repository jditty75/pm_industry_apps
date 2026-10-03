#!/usr/bin/env python3
"""Generate DM family rationalization artifacts (sanitized, no customer data)."""

from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
OUT = REPO / "docs" / "analysis" / "dm-family"
APPS = ["SLG_DM", "HC_DM", "HENP_DM", "EVI_DM", "PDX_DM", "HS_DM"]
CONFIG_FILES = {
    "SLG_DM": "Config_SLG.js",
    "HC_DM": "Config_HC.js",
    "HENP_DM": "Config_HENP.js",
    "EVI_DM": "Config_EVI.js",
    "PDX_DM": "Config_PDX.js",
    "HS_DM": "Config_HS.js",
}

CLASSIFICATIONS = (
    "ACTIVE_SHARED",
    "ACTIVE_APP_SPECIFIC",
    "POSSIBLY_LEGACY",
    "HIGH_CONFIDENCE_UNUSED",
    "UNKNOWN_RUNTIME_DEPENDENCY",
)


def git_sha() -> str:
    try:
        return (
            subprocess.check_output(
                ["git", "-C", str(REPO), "rev-parse", "HEAD"],
                stderr=subprocess.DEVNULL,
                text=True,
            ).strip()
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def load_structure(app: str) -> dict:
    return json.loads((OUT / f"{app}.structure.json").read_text(encoding="utf-8"))


def webapp_functions(app: str) -> set[str]:
    p = REPO / "solutions" / app / "src" / "WebAppCode.js"
    if not p.is_file():
        return set()
    text = p.read_text(encoding="utf-8")
    return set(re.findall(r"^function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", text, re.M))


def extract_sheets_config(app: str) -> dict[str, str]:
    p = REPO / "solutions" / app / "src" / CONFIG_FILES[app]
    text = p.read_text(encoding="utf-8")
    m = re.search(r"sheets:\s*\{", text)
    if not m:
        return {}
    start = m.end()
    depth = 1
    i = start
    while i < len(text) and depth:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    block = text[start : i - 1]
    return dict(
        re.findall(r'^\s+([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*[\'"]([^\'"]+)[\'"]', block, re.M)
    )


UI_RUN_METHOD_ALLOWLIST = (
    "getIdentityBoot",
    "getDataFreshnessForUI",
    "getAllDeploymentsForUI",
    "getRecentGoLivesData",
    "getUpcomingGoLivesData",
    "getGoLivesExplorerDataForUI",
    "getGoLivesExplorerData",
    "getMdsPglBatchViewForUI",
    "getAllActiveOverridesForUI",
    "getOverrideAuditLogForUI",
    "getExecutiveSummaryHtml",
    "saveExecutiveSummaryHtml",
    "getGmailReportPreview",
    "getDeploymentAuditSummaryForUI",
    "updateDeploymentWithMetaAndOverride",
    "updateGoLivesOverride",
    "setOverrideClassificationForUI",
    "clearSingleOverrideForUI",
    "bulkClearMonthlyOverridesForUI",
    "bulkClearAllOverridesForUI",
    "getPortfolioHealthData",
    "createPortfolioHealthSlides",
    "getPortfolioMomentumData",
    "getTrendsDashboardData",
    "getTrendsTimeInRedData",
    "getTrendsHealthTrajectoryData",
    "getTrendsHealthByPartnerData",
    "getTrendsHealthByDeliveryDirectorData",
    "getTrendsTimeInStageData",
    "getTrendsTimeToGoLiveData",
    "getTrendsGoLiveOutcomeData",
    "getCsatTabDataForUI",
    "uploadCsatInFlightCsvForUI",
    "upsertNotificationRuleForUI",
    "sendTestNotificationForUI",
    "getDistributionLogDataForUI",
    "getNotableData",
    "addNotable",
    "updateNotable",
    "getGoLivesForNotablePicker",
    "getReportSendConfigForUI",
    "sendMonthlyReportFromUI",
    "sendMonthlyReportTestFromUI",
    "getReportSendLogForUI",
    "getOverviewData",
    "getStudentTabData",
    "saveStudentDeploymentFields",
    "getEscalationsDashboardData",
)


def client_run_methods() -> list[str]:
    """Terminal methods chained on google.script.run in CoreUI_Js (curated allowlist)."""
    js = (REPO / "libraries/DepMngr/src/CoreUI_Js.js").read_text(encoding="utf-8")
    return sorted(m for m in UI_RUN_METHOD_ALLOWLIST if m in js)


def corelib_refs_by_app() -> dict[str, set[str]]:
    pat = re.compile(r"CoreLib\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)")
    out: dict[str, set[str]] = {a: set() for a in APPS}
    for app in APPS:
        src = REPO / "solutions" / app / "src"
        for f in src.glob("*.js"):
            if f.name.startswith("Config"):
                continue
            for m in pat.finditer(f.read_text(encoding="utf-8", errors="replace")):
                out[app].add(f"{m.group(1)}.{m.group(2)}")
    return out


def depmngr_exported_symbols() -> dict[str, list[str]]:
    """Approximate public surface: functions assigned to namespace objects in DepMngr."""
    modules = {}
    for f in sorted((REPO / "libraries/DepMngr/src").glob("Core*.js")):
        text = f.read_text(encoding="utf-8", errors="replace")
        mod = f.stem
        funcs = sorted(
            set(re.findall(r"^function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", text, re.M))
        )
        modules[mod] = funcs
    return modules


def grep_cfg_sheets_reads() -> dict[str, list[str]]:
    """Which cfg.sheets.* keys are referenced in DepMngr."""
    dep = REPO / "libraries/DepMngr/src"
    keys: set[str] = set()
    for f in dep.glob("*.js"):
        for m in re.finditer(
            r"cfg\.sheets\.([a-zA-Z][a-zA-Z0-9_]*)|sheets\.([a-zA-Z][a-zA-Z0-9_]*)",
            f.read_text(encoding="utf-8", errors="replace"),
        ):
            keys.add(m.group(1) or m.group(2))
    return {"referenced_keys": sorted(keys)}


def classify_sheet(name: str, apps_present: list[str], formula_refs: set[str]) -> str:
    if name.startswith("DNU_") or name.startswith("DNU ") or "DNU_" in name:
        if formula_refs:
            return "POSSIBLY_LEGACY"
        return "HIGH_CONFIDENCE_UNUSED"
    core = {
        "SFDC_Deployments",
        "SFDC_DeploymentProductFunctions",
        "SFDC_DeploymentContacts",
        "SFDC_DeploymentHistory",
        "SFDC_Wellness",
        "SFDC_DHP",
        "DeploymentOverrides",
        "GoLivesOverrides",
        "DeploymentsMeta",
        "AppUsers",
        "CSAT_InFlight",
        "NotificationConfig",
        "ReportDistributionLog",
        "ExecSummary",
        "Dashboard",
        "RedYellow_TBL",
        "RecentGL_TBL",
        "FutureGL_TBL",
        "HealthReportSnapshots",
    }
    if name in core and len(apps_present) >= 5:
        return "ACTIVE_SHARED"
    if name == "StudentDeploymentData":
        return "ACTIVE_APP_SPECIFIC"
    if name in ("Escalation_Configuration", "Current Escalation State", "Escalation Update History"):
        return "ACTIVE_APP_SPECIFIC"
    if name in ("AI_Deployments", "AI_ProductFunction", "Channel Registry", "Processing Log"):
        return "ACTIVE_APP_SPECIFIC"
    if len(apps_present) == 1:
        return "POSSIBLY_LEGACY"
    if len(apps_present) < 6:
        return "UNKNOWN_RUNTIME_DEPENDENCY"
    return "ACTIVE_SHARED"


def build_workbook_matrix(structs: dict[str, dict]) -> dict:
    all_sheets: dict[str, dict] = {}
    for app, s in structs.items():
        for sh in s["sheets"]:
            nm = sh["name"]
            all_sheets.setdefault(nm, {})[app] = {
                "hidden": sh.get("hidden"),
                "maxRow": sh.get("maxRow"),
                "headers": sh.get("headerRow1") or [],
            }
    formula_targets: dict[str, set[str]] = defaultdict(set)
    for app, s in structs.items():
        for ref in s.get("formulaCrossReferencesSample") or []:
            formula_targets[ref.get("refSheet", "")].add(app)

    rows = []
    for name in sorted(all_sheets.keys()):
        present = [a for a in APPS if a in all_sheets[name]]
        hdr_groups: dict[str, list[str]] = defaultdict(list)
        for a in present:
            h = "|".join(all_sheets[name][a]["headers"][:12])
            hdr_groups[h].append(a)
        rows.append(
            {
                "sheet": name,
                "presence": {a: (a in all_sheets[name]) for a in APPS},
                "classification": classify_sheet(name, present, formula_targets.get(name, set())),
                "headerDrift": len(hdr_groups) > 1,
                "formulaSampleRefsTo": sorted(formula_targets.get(name, set())),
                "hiddenIn": [
                    a
                    for a in present
                    if all_sheets[name][a].get("hidden")
                ],
            }
        )
    return {"generatedAtUtc": datetime.now(timezone.utc).isoformat(), "rows": rows}


def main() -> None:
    structs = {a: load_structure(a) for a in APPS}
    matrix = build_workbook_matrix(structs)
    (OUT / "workbook-consistency-matrix.json").write_text(
        json.dumps(matrix, indent=2), encoding="utf-8"
    )

    server_by_app = {a: webapp_functions(a) for a in APPS}
    client_calls = client_run_methods()
    refs = corelib_refs_by_app()
    all_refs = set().union(*refs.values())
    ref_apps = {sym: [a for a in APPS if sym in refs[a]] for sym in sorted(all_refs)}

    sheets_cfg = {a: extract_sheets_config(a) for a in APPS}
    all_keys = sorted(set().union(*[set(v.keys()) for v in sheets_cfg.values()]))

    manifest = {}
    for app in APPS:
        mpath = REPO / "solutions" / app / "src" / "appsscript.json"
        m = json.loads(mpath.read_text(encoding="utf-8"))
        lib = m.get("dependencies", {}).get("libraries", [{}])[0]
        manifest[app] = {
            "coreLibVersion": lib.get("version"),
            "developmentMode": lib.get("developmentMode", False),
            "extraScopes": [
                s
                for s in m.get("oauthScopes", [])
                if "presentations" in s or "send_mail" in s
            ],
        }

    run_contracts = {
        "clientMethodsInCoreUI_Js": client_calls,
        "serverWrappersByApp": {a: sorted(server_by_app[a]) for a in APPS},
        "clientNotInAnyWebAppCode": sorted(
            set(client_calls) - set().union(*server_by_app.values())
        ),
        "webAppOnlyNotInClient": sorted(
            set().union(*server_by_app.values()) - set(client_calls)
        ),
    }
    (OUT / "google-script-run-contracts.json").write_text(
        json.dumps(run_contracts, indent=2), encoding="utf-8"
    )

    dep_usage = {
        "gitSha": git_sha(),
        "coreLibRefsUnion": ref_apps,
        "singleAppCoreLibRefs": {
            sym: ref_apps[sym]
            for sym in ref_apps
            if len(ref_apps[sym]) == 1
        },
        "depMngrModules": depmngr_exported_symbols(),
        "cfgSheetsReferencedInDepMngr": grep_cfg_sheets_reads(),
        "configSheetsByApp": sheets_cfg,
        "configSheetKeyDrift": {
            k: {a: sheets_cfg[a].get(k) for a in APPS if k in sheets_cfg[a]}
            for k in all_keys
            if len({sheets_cfg[a].get(k) for a in APPS if k in sheets_cfg[a]}) > 1
        },
        "manifestPins": manifest,
    }
    (OUT / "depmngr-consumer-usage.json").write_text(
        json.dumps(dep_usage, indent=2), encoding="utf-8"
    )

    print("Wrote workbook-consistency-matrix.json")
    print("Wrote google-script-run-contracts.json")
    print("Wrote depmngr-consumer-usage.json")


if __name__ == "__main__":
    main()

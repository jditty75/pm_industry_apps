#!/usr/bin/env python3
"""Generate local-only deployment-signal-context-v1 packets for SLG portfolio pilot."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from deployment_trajectory_validation.calibration_compare import CALIBRATION_CHECKS
from deployment_trajectory_validation.context_assembler import (
    approximate_packet_byte_size,
    build_context_packet,
    packet_size_stats,
)
from deployment_trajectory_validation.evidence import index_dhp_and_actions
from deployment_trajectory_validation.fields import normalize_id
from deployment_trajectory_validation.pipeline import build_all_bundles
from deployment_trajectory_validation.portfolio_harness import write_portfolio_artifacts
from deployment_trajectory_validation.workbook import load_workbook_data


def _pf_by_deployment(pf_rows):
    out = defaultdict(list)
    for pf in pf_rows:
        dep = normalize_id(pf.get("Deployment__c"))
        if dep:
            out[dep].append(pf)
    return out


def _active_deployments(deploy_rows, trajectory):
    active_ids = {normalize_id(t.get("deployment_id")) for t in trajectory}
    return [d for d in deploy_rows if normalize_id(d.get("Id")) in active_ids]


def _actions_for_dep(dhp_rows, all_actions, dep_id):
    dhp_ids = {normalize_id(d.get("Id")) for d in dhp_rows}
    return [
        a
        for a in all_actions
        if normalize_id(a.get("Deployment_Health_Plan__c")) in dhp_ids
    ]


def _load_calibration_manifest(out_dir: Path) -> dict:
    candidates = [
        out_dir.parent / "sana-calibration-manifest.json",
        Path(".ai/signal-exports/sana-calibration-manifest.json"),
    ]
    for path in candidates:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _find_cal01(bundles, manifest: dict):
    label = str((manifest.get("CAL-01") or {}).get("label") or "").strip()
    if label:
        for dep_id, b in bundles.items():
            name = str(b.get("name") or b.get("trajectory", {}).get("deployment_name") or "")
            if label.upper() in name.upper():
                return dep_id, b
    raise KeyError("CAL-01 label not found — create sana-calibration-manifest.json locally")


def _find_by_prefix(bundles, manifest_entry: dict, cal_key: str):
    prefix = str(manifest_entry.get("deployment_id_prefix") or "").strip()
    if not prefix:
        raise KeyError(f"{cal_key} deployment_id_prefix missing in local manifest")
    for k, b in bundles.items():
        if k.startswith(prefix[:15]):
            return k, b
    raise KeyError(cal_key)


def render_review_html(packets_by_id: dict, inspection_ids: list, today_str: str) -> str:
    sections = []
    for dep_id in inspection_ids:
        pkt = packets_by_id.get(dep_id)
        if not pkt:
            continue
        label = (pkt.get("metadata") or {}).get("deployment_label") or dep_id
        sections.append(
            f"<section><h2>{label}</h2><pre>{json.dumps(pkt, indent=2)}</pre></section>"
        )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Context packet review — {today_str}</title>
<style>body{{font-family:system-ui;margin:1rem}} pre{{white-space:pre-wrap;font-size:12px}}</style>
</head><body>
<h1>Deployment Signal context — Sana-facing review set</h1>
<p>Schema: deployment-signal-context-v1. Local only — do not commit.</p>
{"".join(sections)}
</body></html>"""


def pick_inspection_set(
    bundles, packets_by_id, cal_ids, today_str
) -> list:
    """~8–10 packets for human inspection."""
    chosen = list(cal_ids.values())
    profiles_needed = [
        ("stable_green", lambda b: str(b.get("trajectory", {}).get("current_health")).lower() == "green"),
        ("yellow_or_red", lambda b: str(b.get("trajectory", {}).get("current_health")).lower() in ("yellow", "red")),
        ("sparse", lambda b: (b.get("trajectory", {}).get("health_event_count") or 0) == 0),
        ("pf_grain", lambda b: b.get("trajectory", {}).get("mtp_analysis_grain") == "PRODUCT_FUNCTION"),
        (
            "parent_recon_warning",
            lambda b: str(b.get("trajectory", {}).get("parent_mtp_reconciliation_status") or "") not in (
                "",
                "MATCH",
                "NOT_APPLICABLE_PRODUCT_FUNCTION_GRAIN",
            ),
        ),
        (
            "intervention_heavy",
            lambda b: (b.get("trajectory", {}).get("action_history_record_count") or 0) > 5,
        ),
    ]
    for _name, pred in profiles_needed:
        for dep_id, b in sorted(bundles.items()):
            if dep_id in chosen:
                continue
            if pred(b):
                chosen.append(dep_id)
                break
    return chosen[:12]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", default=".ai/signal-exports/SLG DeploymentHealth_v1.xlsx")
    parser.add_argument("--out-dir", default=".ai/signal-exports/context-packets")
    parser.add_argument("--today", default=date.today().isoformat())
    args = parser.parse_args()

    wb_path = Path(args.workbook)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    _, data, _ = load_workbook_data(str(wb_path))
    trajectory = data["Deployment_Trajectory"]
    active = _active_deployments(data["SFDC_Deployments"], trajectory)
    pf_by_dep = _pf_by_deployment(data["SFDC_DeploymentProductFunctions"])

    dhp_by_dep, _, _, _ = index_dhp_and_actions(
        data["SFDC_DHP"],
        data["SFDC_DHPActionHistory"],
        data["Deployment_Trajectory_ActionHistory_Index"],
    )

    bundles = build_all_bundles(
        trajectory,
        data["Deployment_Trajectory_HealthEvents"],
        data["Deployment_Trajectory_MtpEvents"],
        active,
        pf_by_dep,
        data["SFDC_DHP"],
        data["SFDC_DHPActionHistory"],
        data["Deployment_Trajectory_ActionHistory_Index"],
        args.today,
    )

    packets = []
    packets_by_id = {}
    errors = []
    for dep_id, bundle in sorted(bundles.items()):
        try:
            narratives = _actions_for_dep(dhp_by_dep.get(dep_id, []), data["SFDC_DHPActionHistory"], dep_id)
            pkt = build_context_packet(bundle, args.today, action_narratives=narratives)
            packets.append(pkt)
            packets_by_id[dep_id] = pkt
            ind = out_dir / "by-deployment" / f"{dep_id}.json"
            ind.parent.mkdir(parents=True, exist_ok=True)
            ind.write_text(json.dumps(pkt, indent=2), encoding="utf-8")
        except Exception as exc:  # noqa: BLE001 — aggregate local generation errors
            errors.append({"deployment_id": dep_id, "error": str(exc)})

    jsonl_path = out_dir / "deployment-signal-contexts.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as fh:
        for pkt in packets:
            fh.write(json.dumps(pkt, ensure_ascii=False) + "\n")

    stats = packet_size_stats(packets)
    stats_path = out_dir / "packet-size-stats.json"
    stats_path.write_text(json.dumps(stats, indent=2), encoding="utf-8")

    manifest = _load_calibration_manifest(out_dir)
    cal01_id, _ = _find_cal01(bundles, manifest)
    cal02_id, _ = _find_by_prefix(bundles, manifest.get("CAL-02") or {}, "CAL-02")
    cal03_id, _ = _find_by_prefix(bundles, manifest.get("CAL-03") or {}, "CAL-03")
    cal_ids = {"CAL-01": cal01_id, "CAL-02": cal02_id, "CAL-03": cal03_id}

    cal_report = {"generated_at": args.today, "cases": {}}
    for cal_key, dep_id in cal_ids.items():
        pkt = packets_by_id[dep_id]
        ok, missing = CALIBRATION_CHECKS[cal_key](pkt)
        cal_report["cases"][cal_key] = {
            "deployment_id_prefix": dep_id[:15],
            "semantic_equivalence_pass": ok,
            "missing_material_evidence": missing,
            "packet_bytes": approximate_packet_byte_size(pkt),
        }

    cal_path = out_dir / "calibration-comparison-report.json"
    cal_path.write_text(json.dumps(cal_report, indent=2), encoding="utf-8")

    inspection_ids = pick_inspection_set(bundles, packets_by_id, cal_ids, args.today)
    review_html = render_review_html(packets_by_id, inspection_ids, args.today)
    review_path = Path(".ai/signal-exports/context-packet-review.html")
    review_path.write_text(review_html, encoding="utf-8")

    manifest = write_portfolio_artifacts(Path(".ai/signal-exports"), packets)

    summary = {
        "eligible_trajectory_rows": len(trajectory),
        "packets_generated": len(packets),
        "skipped_errors": len(errors),
        "packet_size_stats": stats,
        "calibration_report": str(cal_path),
        "jsonl": str(jsonl_path),
        "review_html": str(review_path),
        "portfolio_manifest": manifest,
    }
    (out_dir / "generation-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps({k: summary[k] for k in summary if k != "portfolio_manifest"}, indent=2))
    if errors:
        print(f"Generation errors: {len(errors)}", file=sys.stderr)
        return 1
    if not all(cal_report["cases"][k]["semantic_equivalence_pass"] for k in cal_report["cases"]):
        print("Calibration semantic equivalence FAILED", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

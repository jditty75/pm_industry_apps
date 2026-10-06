#!/usr/bin/env python3
"""Generate local-only Sana calibration packets from a read-only SLG workbook export."""

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

from deployment_trajectory_validation.evidence import index_dhp_and_actions
from deployment_trajectory_validation.fields import normalize_id, resolve_dhp_deployment_id
from deployment_trajectory_validation.pipeline import build_all_bundles
from deployment_trajectory_validation.sana_packet import render_calibration_packet
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--workbook",
        default=".ai/signal-exports/SLG DeploymentHealth_v1.xlsx",
        help="Read-only SLG export (gitignored)",
    )
    parser.add_argument(
        "--out-dir",
        default=".ai/signal-exports",
        help="Local output directory (gitignored)",
    )
    parser.add_argument("--today", default=date.today().isoformat())
    args = parser.parse_args()

    wb_path = Path(args.workbook)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    _, data, _ = load_workbook_data(str(wb_path))
    trajectory = data["Deployment_Trajectory"]
    active = _active_deployments(data["SFDC_Deployments"], trajectory)
    pf_by_dep = _pf_by_deployment(data["SFDC_DeploymentProductFunctions"])

    dhp_by_dep, action_by_dep, action_idx_by_dep, dhp_id_to_dep = index_dhp_and_actions(
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

    # CAL-02: Maryland G3 candidate (validator cohort)
    cal02_prefix = "a0r4X00000CrVjp"
    cal03_prefix = "a0rVT0000135GBZ"

    def find_bundle(prefix: str):
        for k, b in bundles.items():
            if k.startswith(prefix[:15]):
                return k, b
        raise KeyError(prefix)

    _, b02 = find_bundle(cal02_prefix)
    dep03, b03 = find_bundle(cal03_prefix)

    dhp03 = dhp_by_dep.get(normalize_id(dep03), [])
    dhp_ids = {normalize_id(d.get("Id")) for d in dhp03}
    actions03 = [
        a
        for a in data["SFDC_DHPActionHistory"]
        if normalize_id(a.get("Deployment_Health_Plan__c")) in dhp_ids
    ]

    pkt02 = render_calibration_packet(
        b02,
        "CAL-02",
        "historical volatility + lifecycle/production exposure (Green)",
        args.today,
    )
    pkt03 = render_calibration_packet(
        b03,
        "CAL-03",
        "Green + active intervention (Health Plan / Action History)",
        args.today,
        dhp_rows=dhp03,
        dhp_actions=actions03,
    )

    path02 = out_dir / "sana-calibration-02-maryland.txt"
    path03 = out_dir / "sana-calibration-03-green-intervention.txt"
    path02.write_text(pkt02, encoding="utf-8")
    path03.write_text(pkt03, encoding="utf-8")

    manifest = {
        "CAL-01": {
            "label": "LADWP",
            "purpose": "historical volatility / current stabilization",
            "human_ground_truth": "Sana NO_SIGNAL confirmed correct by deployment leader",
            "sana_outcome": "NO_SIGNAL",
        },
        "CAL-02": {
            "deployment_id_prefix": cal02_prefix[:15],
            "purpose": "historical volatility + lifecycle exposure",
            "ground_truth": "PENDING",
            "packet": str(path02),
        },
        "CAL-03": {
            "deployment_id_prefix": cal03_prefix[:15],
            "purpose": "Green + active intervention",
            "ground_truth": "PENDING",
            "packet": str(path03),
        },
    }
    manifest_path = out_dir / "sana-calibration-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {path02}")
    print(f"Wrote {path03}")
    print(f"Wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

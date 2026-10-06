#!/usr/bin/env python3
"""Build Stage-2 portfolio compression + data stewardship artifacts (no LLM calls)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from deployment_trajectory_validation.data_stewardship import scan_portfolio_stewardship
from deployment_trajectory_validation.stage1_ingest import (
    Stage1IngestError,
    ingest_stage1_directory,
)
from deployment_trajectory_validation.stage2_harness import (
    attach_health_stage_to_stewardship_rows,
    build_stewardship_summary_json,
    load_packets_jsonl,
    packets_by_id,
    render_stewardship_review_html,
    write_stage2_artifacts,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--jsonl",
        default=".ai/signal-exports/context-packets/deployment-signal-contexts.jsonl",
    )
    parser.add_argument("--out-dir", default=".ai/signal-exports")
    parser.add_argument(
        "--stage1-dir",
        default=".ai/signal-exports/stage1",
        help="Directory with verbatim Sana Stage-1 batch outputs (*.txt)",
    )
    parser.add_argument(
        "--expected-candidates",
        type=int,
        default=17,
    )
    args = parser.parse_args()

    jsonl_path = Path(args.jsonl)
    if not jsonl_path.is_file():
        print(f"Missing context JSONL: {jsonl_path}", file=sys.stderr)
        return 2

    packets = load_packets_jsonl(jsonl_path)
    if len(packets) != 184:
        print(f"Expected 184 context packets; found {len(packets)}", file=sys.stderr)
        return 2

    stewardship_rows, stewardship_summary = scan_portfolio_stewardship(packets)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pmap = packets_by_id(packets)
    stewardship_rows = attach_health_stage_to_stewardship_rows(stewardship_rows, pmap)
    stew_html_path = out_dir / "data-stewardship-review.html"
    stew_html_path.write_text(
        render_stewardship_review_html(stewardship_rows, set(), stewardship_summary),
        encoding="utf-8",
    )
    stew_json_path = out_dir / "data-stewardship-summary.json"
    stew_doc = build_stewardship_summary_json(
        stewardship_rows, stewardship_summary, set(), stew_html_path
    )
    stew_json_path.write_text(json.dumps(stew_doc, indent=2), encoding="utf-8")

    stage1_dir = Path(args.stage1_dir)
    try:
        candidates, stage1_manifest = ingest_stage1_directory(
            stage1_dir,
            packets_by_id(packets),
            expected_count=args.expected_candidates,
        )
    except Stage1IngestError as exc:
        print(str(exc), file=sys.stderr)
        print(
            "\nPlace verbatim Sana Stage-1 batch outputs under:\n"
            f"  {stage1_dir.resolve()}\n"
            "  sana-batch-01-output.txt\n"
            "  sana-batch-02-output.txt\n"
            "  sana-batch-03-output.txt\n",
            file=sys.stderr,
        )
        return 3

    manifest = write_stage2_artifacts(
        out_dir,
        candidates,
        packets,
        stage1_manifest,
        stewardship_rows,
        stewardship_summary,
    )
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

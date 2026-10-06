#!/usr/bin/env python3
"""Build Sana portfolio pilot input from generated context JSONL (no LLM calls)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from deployment_trajectory_validation.portfolio_harness import write_portfolio_artifacts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--jsonl",
        default=".ai/signal-exports/context-packets/deployment-signal-contexts.jsonl",
    )
    parser.add_argument("--out-dir", default=".ai/signal-exports")
    parser.add_argument("--max-batch-bytes", type=int, default=450_000)
    args = parser.parse_args()

    packets = []
    for line in Path(args.jsonl).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            packets.append(json.loads(line))

    manifest = write_portfolio_artifacts(Path(args.out_dir), packets, args.max_batch_bytes)
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

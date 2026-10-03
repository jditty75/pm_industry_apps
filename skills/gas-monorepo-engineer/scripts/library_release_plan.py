#!/usr/bin/env python3
"""CLI: read-only shared-library release plan."""

import argparse
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "scripts"))

from library_release.plan import build_release_plan, format_plan_text  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Shared GAS library release plan (read-only)")
    parser.add_argument("library", help="DepMngr or GoLives (aliases: corelib, depmngr, golives)")
    parser.add_argument("--json", action="store_true", help="Emit JSON plan")
    parser.add_argument("--description", default=None, help="Release description for the plan")
    parser.add_argument(
        "--feature",
        action="append",
        default=[],
        help="Feature tag for validation context (e.g. notable)",
    )
    args = parser.parse_args()

    plan = build_release_plan(
        os.path.abspath(REPO),
        args.library,
        release_description=args.description,
        feature_tags=args.feature or None,
    )

    if args.json:
        print(json.dumps(plan, indent=2))
    else:
        print(format_plan_text(plan))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

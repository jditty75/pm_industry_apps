#!/usr/bin/env python3
"""Deterministic checks for preview_engine assembly (no browser)."""

import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.dirname(__file__))
from preview_engine import build_app  # noqa: E402

CHECKS = [
    ("SLG_DM", [b"app-shell", b"LOCAL PREVIEW", b"--color-primary"]),
    ("SLG_GoLives", [b"Go Lives", b"LOCAL PREVIEW"]),
    ("SLG_Capacity", [b"wfm25-topbar", b".wfm25-shell", b"LOCAL PREVIEW"]),
    ("PS_SPA", [b"<!DOCTYPE html>", b"LOCAL PREVIEW"]),
]


def main():
    failed = 0
    for app, needles in CHECKS:
        path, log = build_app(app, open_browser=False)
        data = open(path, "rb").read()
        size = len(data)
        if size < 500:
            print(f"FAIL {app}: output too small ({size} bytes)")
            failed += 1
            continue
        missing = [n.decode() for n in needles if n not in data]
        if missing:
            print(f"FAIL {app}: missing markers {missing}")
            failed += 1
        else:
            print(f"PASS {app}: {size} bytes -> {path}")
    if failed:
        sys.exit(1)
    print("All preview self-tests passed.")


if __name__ == "__main__":
    main()

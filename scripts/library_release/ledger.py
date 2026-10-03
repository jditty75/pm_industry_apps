"""Read append-only library release ledger (JSONL)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_ledger(repo_root: Path, ledger_rel_path: str) -> list[dict[str, Any]]:
    path = repo_root / ledger_rel_path
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def last_release_record(repo_root: Path, ledger_rel_path: str) -> dict[str, Any] | None:
    records = read_ledger(repo_root, ledger_rel_path)
    return records[-1] if records else None

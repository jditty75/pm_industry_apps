"""Load library registry and ui-preview application map."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_registry(repo_root: Path) -> dict[str, Any]:
    path = repo_root / "config" / "library-registry.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("libraries") or {}


def load_preview_app_ids(repo_root: Path) -> set[str]:
    path = repo_root / "config" / "ui-preview.json"
    if not path.is_file():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    apps = data.get("applications") or {}
    ids: set[str] = set()
    for _path, meta in apps.items():
        if isinstance(meta, dict) and meta.get("appId"):
            ids.add(str(meta["appId"]))
    return ids


def get_library_config(registry: dict[str, Any], library_key: str) -> dict[str, Any]:
    key = library_key.strip()
    aliases = {
        "depmngr": "DepMngr",
        "corelib": "DepMngr",
        "golives": "GoLives",
    }
    normalized = aliases.get(key.lower(), key)
    if normalized not in registry:
        raise KeyError(f"Unknown library '{library_key}'. Known: {', '.join(sorted(registry))}")
    return registry[normalized]

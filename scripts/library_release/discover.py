"""Discover shared-library consumers from appsscript.json manifests."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ConsumerPin:
    app_id: str
    project_path: str
    user_symbol: str
    library_id: str
    version: str
    development_mode: bool
    consumes_head: bool
    has_production_deployment_id: bool
    preview_capable: bool
    notable_tab_exposed: bool | None  # None when not a *_DM consumer


def _app_id_from_path(project_path: str) -> str:
    name = Path(project_path).name
    return name


def _parse_bool(value: Any) -> bool:
    if value is True:
        return True
    if value is False or value is None:
        return False
    if isinstance(value, str):
        return value.lower() == "true"
    return bool(value)


def consumes_head(version: str, development_mode: bool) -> bool:
    """True when manifest resolves to library HEAD (production-impacting on library push)."""
    if development_mode:
        return True
    return str(version).strip() == "0"


def _load_gas_config(repo_root: Path, project_path: str) -> dict:
    path = repo_root / project_path / "gas.config.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def has_production_deployment_id(gas_config: dict) -> bool:
    dep = gas_config.get("deployment") or {}
    prod = dep.get("production") or {}
    dep_id = prod.get("deploymentId")
    return isinstance(dep_id, str) and len(dep_id.strip()) > 0


def _notable_tab_exposed(repo_root: Path, project_path: str) -> bool | None:
    if not project_path.endswith("_DM"):
        return None
    src = repo_root / project_path / "src"
    if not src.is_dir():
        return False
    configs = list(src.glob("Config_*.js"))
    if not configs:
        return False
    text = configs[0].read_text(encoding="utf-8", errors="replace")
    if re.search(r"ui\s*:\s*\{[^}]*notable\s*:\s*\{\s*enabled\s*:\s*false", text, re.S):
        return False
    if re.search(r"notable\s*:\s*\{\s*enabled\s*:\s*false", text):
        return False
    if "id: 'notable'" in text or 'id: "notable"' in text:
        return True
    return False


def discover_consumers(
    repo_root: Path,
    user_symbol: str,
    consumer_dir_pattern: str,
    preview_app_ids: set[str] | None = None,
) -> list[ConsumerPin]:
    """Scan solutions/* matching consumer_dir_pattern suffix."""
    solutions = repo_root / "solutions"
    if not solutions.is_dir():
        return []

    preview_app_ids = preview_app_ids or set()
    consumers: list[ConsumerPin] = []

    for child in sorted(solutions.iterdir()):
        if not child.is_dir():
            continue
        if not child.name.endswith(consumer_dir_pattern):
            continue
        manifest_path = child / "src" / "appsscript.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        deps = manifest.get("dependencies") or {}
        libraries = deps.get("libraries") or []
        for lib in libraries:
            if lib.get("userSymbol") != user_symbol:
                continue
            version = str(lib.get("version", ""))
            dev_mode = _parse_bool(lib.get("developmentMode"))
            project_rel = f"solutions/{child.name}"
            app_id = _app_id_from_path(project_rel)
            gas_cfg = _load_gas_config(repo_root, project_rel)
            consumers.append(
                ConsumerPin(
                    app_id=app_id,
                    project_path=project_rel,
                    user_symbol=user_symbol,
                    library_id=str(lib.get("libraryId", "")),
                    version=version,
                    development_mode=dev_mode,
                    consumes_head=consumes_head(version, dev_mode),
                    has_production_deployment_id=has_production_deployment_id(gas_cfg),
                    preview_capable=app_id in preview_app_ids,
                    notable_tab_exposed=_notable_tab_exposed(repo_root, project_rel),
                )
            )
            break

    return consumers


def manifest_fingerprint(consumers: list[ConsumerPin]) -> str:
    """Stable hash input for plan invalidation when pins change."""
    import hashlib

    parts = []
    for c in sorted(consumers, key=lambda x: x.app_id):
        parts.append(
            f"{c.app_id}|{c.version}|{int(c.development_mode)}|{c.library_id}"
        )
    blob = "\n".join(parts).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]

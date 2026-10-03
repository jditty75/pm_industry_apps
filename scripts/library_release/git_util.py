"""Read-only Git helpers for release planning."""

from __future__ import annotations

import subprocess
from pathlib import Path


def git_rev_parse(repo_root: Path, ref: str = "HEAD") -> str:
    out = subprocess.check_output(
        ["git", "rev-parse", ref],
        cwd=str(repo_root),
        text=True,
        stderr=subprocess.DEVNULL,
    )
    return out.strip()


def git_changed_files_since(
    repo_root: Path, since_sha: str | None, path_prefix: str
) -> list[str] | None:
    """Return changed files under path_prefix since since_sha, or None if indeterminate."""
    if not since_sha:
        return None
    try:
        out = subprocess.check_output(
            ["git", "diff", "--name-only", f"{since_sha}..HEAD", "--", path_prefix],
            cwd=str(repo_root),
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return None
    files = [line.strip() for line in out.splitlines() if line.strip()]
    return files


def git_log_oneline_for_paths(
    repo_root: Path, path_prefix: str, max_count: int = 5
) -> list[str]:
    try:
        out = subprocess.check_output(
            [
                "git",
                "log",
                f"-{max_count}",
                "--oneline",
                "--",
                path_prefix,
            ],
            cwd=str(repo_root),
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]

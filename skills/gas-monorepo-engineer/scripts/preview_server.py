#!/usr/bin/env python3
"""
Localhost-only static server for .preview-out/ HTML previews.

Binds 127.0.0.1 only. No network exposure.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEFAULT_OUT = os.path.join(REPO_ROOT, ".preview-out")
STATE_NAME = ".preview-server.json"
DEFAULT_PORT = 18765


def state_path(out_dir: str) -> str:
    return os.path.join(out_dir, STATE_NAME)


def read_state(out_dir: str) -> dict | None:
    path = state_path(out_dir)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def write_state(out_dir: str, data: dict) -> None:
    os.makedirs(out_dir, exist_ok=True)
    with open(state_path(out_dir), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def clear_state(out_dir: str) -> None:
    path = state_path(out_dir)
    if os.path.isfile(path):
        os.remove(path)


def _ping(base_url: str, timeout: float = 0.5) -> bool:
    try:
        with urllib.request.urlopen(base_url + "/", timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            out = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            return str(pid) in (out.stdout or "")
        except OSError:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def stop_server(out_dir: str) -> bool:
    state = read_state(out_dir)
    if not state:
        print("preview server: not running (no state file)")
        return True
    pid = int(state.get("pid", 0))
    if _pid_alive(pid):
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                capture_output=True,
                check=False,
            )
        else:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        time.sleep(0.3)
    clear_state(out_dir)
    print(f"preview server: stopped (was pid {pid})")
    return True


class PreviewHandler(SimpleHTTPRequestHandler):
    """Serve files with explicit HTML content type."""

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self):
        if self.path.endswith(".html") or self.path.endswith(".htm"):
            self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def _pick_port(host: str, preferred: int) -> int:
    for port in (preferred, preferred + 1, preferred + 2, 0):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind((host, port))
                return s.getsockname()[1]
        except OSError:
            continue
    raise RuntimeError("could not bind a localhost port for preview server")


def run_server(out_dir: str, port: int) -> None:
    host = "127.0.0.1"
    os.makedirs(out_dir, exist_ok=True)
    port = _pick_port(host, port)
    handler = lambda *args, **kwargs: PreviewHandler(  # noqa: E731
        *args, directory=out_dir, **kwargs
    )
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    pid = os.getpid()
    base = f"http://{host}:{port}"
    write_state(
        out_dir,
        {"pid": pid, "port": port, "host": host, "baseUrl": base, "outDir": out_dir},
    )
    print(f"preview server: {base}  (pid {pid}, serving {out_dir})")
    try:
        httpd.serve_forever()
    finally:
        clear_state(out_dir)


def ensure_server(out_dir: str, port: int = DEFAULT_PORT) -> str:
    """Start server subprocess if needed; return base URL (no trailing slash)."""
    os.makedirs(out_dir, exist_ok=True)
    state = read_state(out_dir)
    if state:
        base = state.get("baseUrl") or f"http://127.0.0.1:{state.get('port', port)}"
        pid = int(state.get("pid", 0))
        if _pid_alive(pid) and _ping(base):
            return base.rstrip("/")
        clear_state(out_dir)

    port = _pick_port("127.0.0.1", port)
    script = os.path.join(os.path.dirname(__file__), "preview_server.py")
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    proc = subprocess.Popen(
        [sys.executable, script, "--serve", "--out-dir", out_dir, "--port", str(port)],
        cwd=REPO_ROOT,
        creationflags=creationflags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(40):
        time.sleep(0.1)
        if _ping(base):
            st = read_state(out_dir)
            if st:
                return (st.get("baseUrl") or base).rstrip("/")
        if proc.poll() is not None:
            break
    raise RuntimeError("preview server failed to start on localhost")


def main():
    ap = argparse.ArgumentParser(description="Localhost preview static server")
    ap.add_argument("--serve", action="store_true", help="Run until interrupted (internal)")
    ap.add_argument("--stop", action="store_true", help="Stop background preview server")
    ap.add_argument("--out-dir", default=DEFAULT_OUT)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args()

    out_dir = os.path.abspath(args.out_dir)
    if args.stop:
        stop_server(out_dir)
        return
    if args.serve:
        run_server(out_dir, args.port)
        return
    ap.print_help()
    sys.exit(2)


if __name__ == "__main__":
    main()

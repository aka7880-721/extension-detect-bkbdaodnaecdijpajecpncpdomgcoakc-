"""Local static server + /api/result.json (fresh check per request)."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SERVER_DIR = Path(__file__).resolve().parent
ROOT = SERVER_DIR.parent
PUBLIC = ROOT / "public"
VAR = ROOT / "var"
VAR_RESULT = VAR / "result.json"
RUN_ID_FILE = VAR / "run-id.txt"
RUN_PROFILE_FILE = VAR / "run-profile.txt"
CHECK_SCRIPT = SERVER_DIR / "chrome-check.ps1"
_check_lock = threading.Lock()


def read_run_id() -> str:
    if RUN_ID_FILE.is_file():
        return RUN_ID_FILE.read_text(encoding="utf-8").strip()
    return ""


def _invoke_check(run_id: str) -> None:
    args = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(CHECK_SCRIPT),
    ]
    if run_id:
        args.extend(["-RunId", run_id])
    subprocess.run(
        args,
        cwd=str(ROOT),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def run_profile_check(run_id: str) -> None:
    """Run check twice: first pass often hits locked prefs / stale reads."""
    if not CHECK_SCRIPT.is_file():
        return
    with _check_lock:
        _invoke_check(run_id)
        _invoke_check(run_id)


def read_run_profile() -> str:
    if RUN_PROFILE_FILE.is_file():
        return RUN_PROFILE_FILE.read_text(encoding="utf-8").strip()
    return ""


def open_browser(url: str, delay: float) -> None:
    time.sleep(delay)
    profile_dir = read_run_profile()
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for exe in candidates:
        if exe and os.path.isfile(exe):
            cmd = [exe, "--disable-popup-blocking"]
            if profile_dir:
                cmd.append(f"--profile-directory={profile_dir}")
            cmd.append(url)
            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
    subprocess.Popen(["cmd", "/c", "start", "", url], shell=False)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/result.json":
            qs = parse_qs(parsed.query)
            req_run = (qs.get("run") or [""])[0].strip()
            current_run = read_run_id()
            run_id = req_run or current_run
            run_profile_check(run_id)
            if not VAR_RESULT.is_file():
                self.send_error(404, "result not ready")
                return
            body = VAR_RESULT.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()

    if not PUBLIC.is_dir():
        print("Missing public/ folder", file=sys.stderr)
        return 1

    VAR.mkdir(exist_ok=True)
    run_id = read_run_id()
    base = f"http://{args.bind}:{args.port}/"
    url = base + (f"?run={run_id}" if run_id else "")

    threading.Thread(target=open_browser, args=(url, 1.5), daemon=True).start()

    server = ThreadingHTTPServer((args.bind, args.port), AppHandler)
    print(f"Serving {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

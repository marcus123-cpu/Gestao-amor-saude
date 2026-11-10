"""Confere se o executável Windows responde depois de empacotado."""
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


stage = Path(sys.argv[1]).resolve()
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]

with tempfile.TemporaryDirectory(prefix="agenda-clara-smoke-") as data_dir:
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["AGENDA_CLARA_DATA_DIR"] = data_dir
    process = subprocess.Popen([str(stage / "AgendaClara.exe")], cwd=stage, env=env)
    try:
        deadline = time.monotonic() + 20
        while True:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=2) as response:
                    assert response.status == 200 and b'"agendas"' in response.read()
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as response:
                    assert response.status == 200 and b"<html" in response.read().lower()
                break
            except (OSError, AssertionError):
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise
                time.sleep(0.5)
    finally:
        process.terminate()
        process.wait(timeout=5)

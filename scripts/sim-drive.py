"""Even Hub 模拟器自动化驱动小工具(开发期用)。

用法(在 dev/ 目录):
    python scripts/sim-drive.py ping                 # 等模拟器 automation 就绪
    python scripts/sim-drive.py shot out.png         # 抓眼镜原始帧(576x288 RGBA)
    python scripts/sim-drive.py input click|down|up|double_click
    python scripts/sim-drive.py console [since_id]   # 读 WebView console
    python scripts/sim-drive.py restart "<url>"      # 杀旧进程 + 起新模拟器(全新页面)

注意:模拟器二进制在
    node_modules/@evenrealities/sim-win32-x64/bin/evenhub-simulator.exe
启动时务必带 `--automation-port 9898`;抓图/输入都走 http://127.0.0.1:9898。
"""
import io
import json
import subprocess
import sys
import time
import urllib.request

AUTO = "http://127.0.0.1:9898"
SIM_EXE = r"node_modules\@evenrealities\sim-win32-x64\bin\evenhub-simulator.exe"


def api(path, data=None, method="GET", timeout=10):
    req = urllib.request.Request(AUTO + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def wait_ping(limit=60):
    t0 = time.time()
    while time.time() - t0 < limit:
        try:
            if api("/api/ping", timeout=2) == b"pong":
                return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def restart(url):
    """必须用全新进程:页面重载后旧页面还在,createStartUpPageContainer 会返回 1。"""
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-Process evenhub-simulator -ErrorAction SilentlyContinue | Stop-Process -Force"],
                   capture_output=True)
    time.sleep(3)
    subprocess.Popen([SIM_EXE, url, "--automation-port", "9898"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return wait_ping()


def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return
    cmd = argv[0]
    if cmd == "ping":
        print("pong" if wait_ping() else "timeout")
    elif cmd == "shot":
        data = api("/api/screenshot/glasses")
        path = argv[1] if len(argv) > 1 else "shot.png"
        with open(path, "wb") as f:
            f.write(data)
        print(f"{path} {len(data)} bytes")
    elif cmd == "input":
        action = argv[1] if len(argv) > 1 else "click"
        api("/api/input", json.dumps({"action": action}).encode(), "POST")
        print("sent", action)
    elif cmd == "console":
        since = argv[1] if len(argv) > 1 else "0"
        data = json.loads(api(f"/api/console?since_id={since}").decode())
        for e in data.get("entries", []):
            print(e["id"], e["level"], e["message"][:160])
    elif cmd == "restart":
        url = argv[1] if len(argv) > 1 else "http://127.0.0.1:5173/?demo=1"
        print("ready" if restart(url) else "timeout")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

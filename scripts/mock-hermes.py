"""Mock Hermes gateway —— 只为在模拟器里抓「原始截图」用,内容全是编造的样例数据。"""
import json, time, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = 8799

SESSIONS = [
    {"id": "demo-1", "title": "Reflow oven profile", "preview": "re-run at 120 C, held 30 min", "source": "desktop"},
    {"id": "demo-2", "title": "SPM scan notes", "preview": "sample B clean; re-take sample C", "source": "desktop"},
    {"id": "demo-3", "title": "Weekly lab standup", "preview": "actions for this week", "source": "desktop"},
    {"id": "demo-4", "title": "Paper figures checklist", "preview": "fig 2 redraw, fig 4 caption", "source": "desktop"},
    {"id": "demo-5", "title": "ESP32 wiring debug", "preview": "pin map and pull-ups", "source": "desktop"},
    {"id": "demo-6", "title": "Travel plan draft", "preview": "flights and hotel options", "source": "desktop"},
    {"id": "demo-7", "title": "Fiber coupling alignment", "preview": "re-check after the swap"},
    {"id": "demo-8", "title": "Dichroic filter order", "preview": "two 550 nm long-pass"},
    {"id": "demo-9", "title": "Cleanroom slot booking", "preview": "Thursday afternoon"},
    {"id": "demo-10", "title": "Cryostat maintenance", "preview": "helium top-up done"},
]

MESSAGES = {
    "demo-1": [
        {"role": "user", "content": "Did the oven re-run finish cleanly?"},
        {"role": "assistant", "content": "Yes - the profile ran to completion. Peak 120 C held for 30 minutes, cool-down on schedule."},
        {"role": "user", "content": "And the SPM scan of sample B?"},
        {"role": "assistant", "content": "Sample B looks clean: no streaks, roughness is within the usual range, and the step edges are sharp. I would still re-take sample C with a shorter dwell because the tip picked up some residue from the previous scan."},
        {"role": "user", "content": "Fine. What about the figures for the paper?"},
        {"role": "assistant", "content": "Figure 2 was redrawn with the new colour scale; figure 4 only needs a caption that mentions the 0.12 nm linewidth and the 30 A threshold. I also re-checked the axis labels so they match the text."},
        {"role": "user", "content": "Good, and remind me of the meeting time."},
        {"role": "assistant", "content": "The group meeting is Thursday at 14:00 in the small seminar room. I put the slides and the sample list in the shared folder."},
        {"role": "user", "content": "Thanks."},
        {"role": "assistant", "content": "Anytime. Ping me if the reflow logs need a second pair of eyes."},
        {"role": "user", "content": "顺便把烘箱的升温曲线和扫描探针的结果一起整理成一份中文小结，明早发我。"},
        {"role": "assistant", "content": "好的：升温曲线取 120°C 保温 30 分钟那一段，扫描探针部分用 B 样品的数据并注明 C 样品需要重测，明早一并发给你。"},
        {"role": "assistant", "content": ""},
        {"role": "tool", "content": "{\"command\": \"hermes sessions list --limit 5\", \"status\": \"exited\", \"exit_code\": 0}"},
        {"role": "assistant", "content": "先查了最近 5 个会话，确认烘箱那条是 demo-1。"},
        {"role": "tool", "content": "{\"output\": \"120C hold 30min, cool-down on schedule\\npeak 120.4C at t=18min\\nsample B clean\", \"status\": \"ok\"}"},
    ],
    "demo-2": [
        {"role": "user", "content": "How did sample B look?"},
        {"role": "assistant", "content": "Sample B looks clean; sample C should be re-taken with a shorter dwell."},
    ],
}

REPLY_DELTAS = [
    "Three notes from your last sessions:\n\n",
    "1. The reflow profile finished cleanly - 120 C held for 30 min. ",
    "2. The SPM scan of sample B looks clean; ",
    "re-take sample C with a shorter dwell.\n",
    "3. The paper figures are ready for review - ",
    "figure 2 was redrawn and figure 4 just needs a caption.",
]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("[mock]", fmt % args, flush=True)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/sessions":
            return self._json({"object": "list", "data": SESSIONS})
        m = re.match(r"^/api/sessions/([^/]+)/messages$", path)
        if m:
            sid = m.group(1)
            return self._json({"object": "list", "data": MESSAGES.get(sid, MESSAGES["demo-1"])})
        if path == "/health":
            return self._json({"status": "ok"})
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        if re.match(r"^/api/sessions/[^/]+/chat/stream$", path):
            length = int(self.headers.get("Content-Length") or 0)
            _ = self.rfile.read(length)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Connection", "keep-alive")
            self._cors()
            self.end_headers()

            def frame(name, obj):
                self.wfile.write(("event: %s\ndata: %s\n\n" % (name, json.dumps(obj))).encode())
                self.wfile.flush()

            frame("run.started", {"run_id": "demo"})
            time.sleep(0.4)
            # 工具阶段 → 状态栏显示 | thinking
            frame("tool.progress", {"tool_name": "thinking", "detail": "planning the answer"})
            time.sleep(1.2)
            for chunk in REPLY_DELTAS:
                frame("assistant.delta", {"delta": chunk})
                time.sleep(0.9)
            frame("assistant.completed", {"content": "".join(REPLY_DELTAS)})
            frame("run.completed", {"status": "ok"})
            return
        self._json({"error": "not found"}, 404)


if __name__ == "__main__":
    print(f"[mock] Hermes gateway on http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

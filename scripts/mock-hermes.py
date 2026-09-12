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
    "先按你说的顺序整理。\n\n",
    "一、烘箱升温曲线:取 120 C 保温 30 分钟那一段,峰值 120.4 C 出现在第 18 分钟,降温阶段与设定一致。",
    "我把原始日志里的采样点也保留下来了,方便你核对。\n\n",
    "二、扫描探针:样品 B 表面干净,均方根粗糙度落在常规范围内,台阶边缘清晰;",
    "样品 C 建议用更短的驻留时间重测,因为上一次扫描时针尖上带了残留物。\n\n",
    "三、论文图:图 2 已按新的配色重画,图 4 只差图注;",
    "图注里要提到 0.12 nm 的线宽和 30 A 的阈值,坐标轴标签也已和正文对齐。",
    "另外我把这一轮的要点写成了三句话的摘要,放在文件开头,你可以直接贴进周报。\n\n",
    "需要我再把烘箱日志导成 CSV 一起附上吗?",
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
        m2 = re.match(r"^/api/sessions/([^/]+)/chat/stream$", path)
        if m2:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length)
            try:  # 记录本次提问与回复,使重载历史与真机一致
                sent = json.loads(body.decode("utf-8", "replace")).get("message", "")
                if isinstance(sent, list):
                    sent = " ".join(p.get("text", "") for p in sent if isinstance(p, dict))
                MESSAGES.setdefault(m2.group(1), []).extend([
                    {"role": "user", "content": str(sent)},
                    {"role": "assistant", "content": "".join(REPLY_DELTAS)},
                ])
            except Exception as exc:
                print("[mock] record failed", exc, flush=True)
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
            # 交错序列:工具 → 文本 → 工具 → 文本(用来验证工具行留在它发生的位置,
            # 而不是被整体提到回复之前);中间插一条空 label 的事件,验证它不产生行。
            half = max(1, len(REPLY_DELTAS) // 2)
            for tool in ("thinking", "reading files"):
                frame("tool.progress", {"tool_name": tool, "detail": ""})
                time.sleep(0.35)
            for chunk in REPLY_DELTAS[:half]:
                frame("assistant.delta", {"delta": chunk})
                time.sleep(0.7)
            frame("tool.progress", {"tool_name": "", "detail": ""})
            for tool in ("running terminal", "thinking"):
                frame("tool.progress", {"tool_name": tool, "detail": ""})
                time.sleep(0.35)
            for chunk in REPLY_DELTAS[half:]:
                frame("assistant.delta", {"delta": chunk})
                time.sleep(0.7)
            frame("assistant.completed", {"content": "".join(REPLY_DELTAS)})
            frame("run.completed", {"status": "ok"})
            return
        self._json({"error": "not found"}, 404)


if __name__ == "__main__":
    print(f"[mock] Hermes gateway on http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

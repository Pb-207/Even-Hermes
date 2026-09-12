"""Mock streaming-STT server —— 供开发期在模拟器里端到端验证「流式转写」链路。

和 hermes-lens-skill/scripts/server.py 的协议一致(Deepgram 风格):
  WS   : 首条 config JSON -> {"type":"Started"} -> 收 PCM 帧 -> 定期 PARTIAL -> 静音 FINAL
  REST : POST /v1/audio/transcriptions(整段回落路径,直接返回固定文本)

跑法(在 dev/ 目录):
  uv run --with fastapi --with uvicorn python scripts/mock-stt.py
默认监听 127.0.0.1:8798;把插件配置里的 STT 地址指向它即可(不做鉴权)。
"""
import asyncio
import json
import os
import time

from fastapi import FastAPI, File, UploadFile, WebSocket

PORT = int(os.environ.get("MOCK_STT_PORT", "8798"))
PARTIALS = ["今天的", "今天的实验", "今天的实验做完了"]
FINAL = "今天的实验做完了,请汇总成一份小结"
TURN = 0   # 每次连接 +1,并把轮次写进文案,方便肉眼区分是第几轮

app = FastAPI()


@app.post("/v1/audio/transcriptions")
async def rest_transcribe(file: UploadFile = File(...)):
    """REST 回落路径:直接给最终文本。"""
    await file.read()
    return {"text": FINAL}


@app.websocket("/{path:path}")
async def ws_stt(websocket: WebSocket, path: str):
    await websocket.accept()
    print(f"[mock-stt] ws connected path=/{path}", flush=True)
    global TURN
    TURN += 1
    tag = f"[第{TURN}轮] "
    frames = 0
    sent = 0
    last_partial = time.monotonic()
    try:
        while True:
            try:
                m = await asyncio.wait_for(websocket.receive(), timeout=0.7)
            except asyncio.TimeoutError:
                print(f"[mock-stt] silence -> FINAL (frames={frames})", flush=True)
                await websocket.send_text(json.dumps({
                    "type": "Results", "is_final": True,
                    "channel": {"alternatives": [{"transcript": tag + FINAL}]},
                }))
                break
            if m.get("type") == "websocket.disconnect":
                break
            data = m.get("bytes")
            if data:
                frames += 1
                # 每 ~1s 发一条 partial(按时间,不按帧数)
                if time.monotonic() - last_partial >= 1.0 and sent < len(PARTIALS):
                    last_partial = time.monotonic()
                    text = PARTIALS[sent]
                    sent += 1
                    print(f"[mock-stt] PARTIAL {text!r}", flush=True)
                    await websocket.send_text(json.dumps({
                        "type": "Results", "is_final": False,
                        "channel": {"alternatives": [{"transcript": tag + text}]},
                    }))
                continue
            raw = m.get("text") or ""
            if raw:
                print(f"[mock-stt] config {raw[:120]}", flush=True)
                await websocket.send_text(json.dumps({"type": "Started"}))
    except Exception as exc:  # noqa: BLE001
        print("[mock-stt] err", exc, flush=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")

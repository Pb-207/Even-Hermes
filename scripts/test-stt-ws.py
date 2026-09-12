"""用真实 WAV 验证 server.py 的流式 WS:config -> 按 100ms 推 PCM -> 收集 PARTIAL/FINAL。"""
import asyncio
import json
import os
import sys
import time
import wave

import websockets

PORT = int(os.environ.get("STT_PORT", "8878"))
KEY = os.environ.get("STT_KEY", "test-key-123")
WAV = os.environ.get("STT_WAV", r"C:\Users\Administrator\AppData\Local\Temp\stt-probe.wav")
CHUNK_MS = 100

with wave.open(WAV, "rb") as w:
    print(f"wav: {w.getframerate()} Hz, {w.getnchannels()} ch, {w.getsampwidth()*8} bit, "
          f"{w.getnframes()} frames = {w.getnframes()/w.getframerate():.1f}s", flush=True)
    pcm = w.readframes(w.getnframes())
    rate = w.getframerate()
    mono16 = w.getsampwidth() == 2 and w.getnchannels() == 1

bytes_per_chunk = int(rate * 2 * CHUNK_MS / 1000)


async def main():
    url = f"ws://127.0.0.1:{PORT}/?api_key={KEY}"
    partials, final = [], None
    t0 = time.monotonic()
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"config": {"sampleRate": rate if mono16 else 16000,
                                              "language": "zh", "model": "", "api_key": KEY}}))
        print("config sent", flush=True)

        async def reader():
            nonlocal final
            async for raw in ws:
                try:
                    o = json.loads(raw)
                except Exception:
                    continue
                if o.get("type") == "Started":
                    print(f"[{time.monotonic()-t0:5.1f}s] Started (服务端已就绪)", flush=True)
                elif o.get("type") == "Error":
                    print(f"[{time.monotonic()-t0:5.1f}s] Error: {o}", flush=True)
                else:
                    txt = o.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
                    if o.get("is_final"):
                        final = txt
                        print(f"[{time.monotonic()-t0:5.1f}s] FINAL: {txt!r}", flush=True)
                    else:
                        partials.append(txt)
                        print(f"[{time.monotonic()-t0:5.1f}s] partial: {txt!r}", flush=True)

        task = asyncio.create_task(reader())
        # 按 100ms 一片推完(真机就是 3200B/100ms)
        for i in range(0, len(pcm), bytes_per_chunk):
            await ws.send(pcm[i:i + bytes_per_chunk])
            await asyncio.sleep(CHUNK_MS / 1000)
        print(f"[{time.monotonic()-t0:5.1f}s] 音频推完,等静音触发 FINAL …", flush=True)
        try:
            await asyncio.wait_for(task, timeout=25)
        except asyncio.TimeoutError:
            print("!! 超时:没收到 FINAL", flush=True)
        await ws.close()

    print()
    print(f"结果:partial {len(partials)} 条 / FINAL {'有' if final else '无'}")
    for p in partials:
        print("   partial:", p)
    print("   final  :", final)
    return 0 if final else 1


sys.exit(asyncio.run(main()))

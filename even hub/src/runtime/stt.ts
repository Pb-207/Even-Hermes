export type SttConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export class SttError extends Error {
  public readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'SttError'
    this.status = status
  }
}

/** 非流式(OpenAI 兼容 REST)转写:整段 WAV → 整段文本。 */
export async function transcribe(cfg: SttConfig, wav: Blob, signal?: AbortSignal): Promise<string> {
  const url = `${cfg.baseUrl}/v1/audio/transcriptions`
  const form = new FormData()
  form.append('file', wav, 'audio.wav')
  form.append('model', cfg.model)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal,
    })
  } catch (err) {
    throw new SttError(`network: ${(err as Error).message}`)
  }

  if (!res.ok) {
    throw new SttError(`http ${res.status}`, res.status)
  }

  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}

/* ------------------------------------------------------------------ *
 * 流式转写(WebSocket)
 *
 * 协议(与本仓库 hermes-lens-skill/scripts/server.py 一致,Deepgram 风格):
 *   连上后先发一条 config JSON → 服务端回 {"type":"Started"} →
 *   之后推 16kHz/16bit/mono PCM 帧 → 每约 1 秒回一条 PARTIAL
 *   ({"type":"Results","is_final":false,"channel":{"alternatives":[{"transcript":"…"}]}}) →
 *   静音或断开时回 FINAL。
 *
 * 只有支持这套协议的服务端才能流式(自带 server.py 可以);纯 OpenAI 兼容端点不行 →
 * 建连失败或未收到 Started 时标记为不可用,由调用方回落到 REST。
 * ------------------------------------------------------------------ */

export type SttStream = {
  /** 推一帧 PCM(不可用时是 no-op) */
  send(pcm: Uint8Array): void
  /** 停止推流并等待服务端 FINAL(最多 waitMs),返回最终文本;不可用/超时返回 null */
  finish(waitMs?: number): Promise<string | null>
  close(): void
  readonly usable: boolean
}

export type SttStreamHandlers = {
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onUnavailable?: () => void
}

function toWsUrl(baseUrl: string, apiKey: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const ws = trimmed.replace(/^http/i, 'ws') // http→ws, https→wss
  const key = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  return `${ws}/${key}`
}

export function openSttStream(cfg: SttConfig, handlers: SttStreamHandlers = {}): SttStream {
  let ws: WebSocket | null = null
  let usable = false
  let closed = false
  let lastPartial = ''
  let finalText: string | null = null
  let onFinalWait: ((t: string | null) => void) | null = null

  const extract = (raw: unknown): string => {
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>)
      const ch = (o as { channel?: { alternatives?: Array<{ transcript?: string }> } }).channel
      return ch?.alternatives?.[0]?.transcript ?? ''
    } catch {
      return ''
    }
  }

  try {
    ws = new WebSocket(toWsUrl(cfg.baseUrl, cfg.apiKey))
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      try {
        // 浏览器 WebSocket 不能带请求头 → key 放在 config JSON 里(服务端也接受 ?api_key=)
        ws?.send(JSON.stringify({
          config: { sampleRate: 16000, language: 'zh-CN', model: cfg.model, api_key: cfg.apiKey },
        }))
      } catch { /* ignore */ }
    }
    ws.onmessage = (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      if (!raw) return
      try {
        const o = JSON.parse(raw) as { type?: string; is_final?: boolean }
        if (o.type === 'Started') { usable = true; return }
        if (o.type === 'Error') { handlers.onUnavailable?.(); return }
        if (o.type === 'Results') {
          const text = extract(o)
          if (!text) return
          if (o.is_final) {
            finalText = text
            handlers.onFinal?.(text)
            onFinalWait?.(text)
          } else if (text !== lastPartial) {
            lastPartial = text
            handlers.onPartial?.(text)
          }
        }
      } catch { /* ignore */ }
    }
    ws.onerror = () => { if (!usable) handlers.onUnavailable?.() }
    ws.onclose = () => { closed = true; if (!usable) handlers.onUnavailable?.() }
  } catch {
    handlers.onUnavailable?.()
  }

  return {
    get usable() { return usable },
    send(pcm: Uint8Array) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      try { ws.send(pcm) } catch { /* ignore */ }
    },
    finish(waitMs = 1500) {
      return new Promise<string | null>((resolve) => {
        if (!usable) { resolve(null); return }
        if (finalText != null) { resolve(finalText); return }
        const timer = setTimeout(() => { onFinalWait = null; resolve(lastPartial || null) }, waitMs)
        onFinalWait = (t) => { clearTimeout(timer); onFinalWait = null; resolve(t) }
      })
    },
    close() {
      closed = true
      try { ws?.close() } catch { /* ignore */ }
      void closed
    },
  }
}

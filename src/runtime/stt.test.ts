import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transcribe, openSttStream, SttError, type SttConfig } from './stt'

const CFG: SttConfig = { baseUrl: 'http://host:8000', apiKey: 'sk-test', model: 'whisper-1' }
const WAV = new Blob([new Uint8Array([0, 1, 2])], { type: 'audio/wav' })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('transcribe', () => {
  it('POSTs multipart/form-data to /v1/audio/transcriptions with Bearer auth', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify({ text: 'hello world' }), { status: 200 }))
    const text = await transcribe(CFG, WAV)
    expect(text).toBe('hello world')

    const [url, init] = (globalThis.fetch as any).mock.calls[0]
    expect(url).toBe('http://host:8000/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('returns empty string when STT returns empty text', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify({ text: '' }), { status: 200 }))
    const text = await transcribe(CFG, WAV)
    expect(text).toBe('')
  })

  it('throws SttError with status on HTTP 401', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response('unauthorized', { status: 401 }))
    const promise = transcribe(CFG, WAV)
    await expect(promise).rejects.toBeInstanceOf(SttError)
    await expect(promise).rejects.toMatchObject({ status: 401 })
  })

  it('throws SttError on network failure', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(transcribe(CFG, WAV)).rejects.toMatchObject({ name: 'SttError', status: 0 })
  })

  it('forwards the AbortSignal to fetch', async () => {
    const ac = new AbortController();
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify({ text: 'x' }), { status: 200 }))
    await transcribe(CFG, WAV, ac.signal)
    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(init.signal).toBe(ac.signal)
  })
})

/* ------------------------------------------------------------------ *
 * 流式(WebSocket):用一个假 WebSocket 验证握手、partial/final 与回落
 * ------------------------------------------------------------------ */
class FakeWS {
  static last: FakeWS | null = null
  static OPEN = 1
  readyState = 0
  binaryType = ''
  url: string
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(url: string) { this.url = url; FakeWS.last = this }
  send(d: unknown) { this.sent.push(d) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  emit(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) } as MessageEvent) }
}
const dg = (text: string, isFinal: boolean) => ({
  type: 'Results', is_final: isFinal, channel: { alternatives: [{ transcript: text }] },
})

describe('openSttStream', () => {
  it('opens ws:// with the key in the query string and sends the config JSON on open', () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    const st = openSttStream({ baseUrl: 'https://stt.example.com/', apiKey: 'sk-test', model: 'whisper-1' })
    const ws = FakeWS.last!
    expect(ws.url).toBe('wss://stt.example.com/?api_key=sk-test')
    ws.open()
    const cfg = JSON.parse(ws.sent[0] as string)
    expect(cfg.config.sampleRate).toBe(16000)
    expect(cfg.config.api_key).toBe('sk-test') // 浏览器不能带请求头,key 走 config 消息
    expect(st.usable).toBe(false) // 还没收到 Started
  })

  it('emits partials and resolves finish() with the FINAL', async () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    const partials: string[] = []
    const st = openSttStream(CFG, { onPartial: (t) => partials.push(t) })
    const ws = FakeWS.last!
    ws.open()
    ws.emit({ type: 'Started' })
    expect(st.usable).toBe(true)
    ws.emit(dg('今天的', false))
    ws.emit(dg('今天的实验做完了', false))
    ws.emit(dg('今天的实验做完了，请汇总', true))
    expect(partials).toEqual(['今天的', '今天的实验做完了'])
    await expect(st.finish(50)).resolves.toBe('今天的实验做完了，请汇总')
  })

  it('falls back to the last partial when no FINAL arrives', async () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    const st = openSttStream(CFG)
    const ws = FakeWS.last!
    ws.open()
    ws.emit({ type: 'Started' })
    ws.emit(dg('说到一半', false))
    await expect(st.finish(0)).resolves.toBe('说到一半')
  })

  it('reports unavailable (REST fallback) when the socket fails before Started', async () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    let unavailable = false
    const st = openSttStream(CFG, { onUnavailable: () => { unavailable = true } })
    FakeWS.last!.onerror?.()
    expect(unavailable).toBe(true)
    expect(st.usable).toBe(false)
    await expect(st.finish(10)).resolves.toBeNull() // 交给 REST 整段转写
  })

  it('reports unavailable on an Error message from the server (e.g. bad key)', () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    let unavailable = false
    openSttStream(CFG, { onUnavailable: () => { unavailable = true } })
    const ws = FakeWS.last!
    ws.open()
    ws.emit({ type: 'Error', message: 'unauthorized' })
    expect(unavailable).toBe(true)
  })
  it('ready() resolves true once Started arrives', async () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    const st = openSttStream(CFG)
    const p = st.ready(1000)
    const ws = FakeWS.last!
    ws.open()
    ws.emit({ type: 'Started' })
    await expect(p).resolves.toBe(true)
  })

  it('ready() resolves false when the stream never becomes usable', async () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    const st = openSttStream(CFG)
    await expect(st.ready(30)).resolves.toBe(false)
  })

  it('buffers frames during the handshake and flushes them once Started arrives', async () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    const st = openSttStream(CFG)
    const ws = FakeWS.last!
    st.send(new Uint8Array([1, 2, 3]))       // 还没 open → 缓冲
    expect(ws.sent.some((x) => x instanceof Uint8Array)).toBe(false)
    ws.open()
    ws.emit({ type: 'Started' })
    expect(ws.sent.some((x) => x instanceof Uint8Array)).toBe(true)
  })

  it('reconnects once when the socket closes before Started (真机偶发 1006)', async () => {
    vi.stubGlobal('WebSocket', FakeWS as any)
    openSttStream(CFG)
    const first = FakeWS.last!
    first.close()                            // 未 Started 就断开
    await new Promise((r) => setTimeout(r, 300))
    expect(FakeWS.last).not.toBe(first)      // 已经重连(新 socket)
  })
})

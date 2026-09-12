import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transcribe, SttError, type SttConfig } from './stt'

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

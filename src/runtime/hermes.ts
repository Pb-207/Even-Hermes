import { toolLabel } from './tool-labels';

export type HermesConfig = {
  baseUrl: string
  apiKey: string
  model: string
  instructions: string
}

export type HermesResponseRaw = {
  id?: string
  status?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
}

export type HermesStreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'tool'; label: string }
  | { kind: 'tool_end' }
  | { kind: 'done'; text: string }

export class HermesError extends Error {
  public readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'HermesError'
    this.status = status
  }
}

export type HermesSession = { id: string; title: string; preview?: string };

export async function listSessions(cfg: HermesConfig): Promise<HermesSession[]> {
  const res = await fetch(`${cfg.baseUrl}/api/sessions`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  })
  if (!res.ok) throw new HermesError(`http ${res.status}`, res.status)
  const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
  return (data.data ?? [])
    .filter((s) => !(s as any).archived)
    .map((s) => ({
      id: String(s.id),
      title: String((s as any).title || s.id),
      preview: (s as any).preview ? String((s as any).preview) : undefined,
    }))
}

// 'assistantMore' = 同一条回复被工具调用打断后的续行(不再重复 'Hermes: ' 前缀)
export type HermesMessage = { role: 'user' | 'assistant' | 'assistantMore' | 'meta'; text: string };

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => p?.text ?? p?.content ?? '').join(' ');
  if (content && typeof content === 'object') return String((content as any).text ?? '');
  return '';
}

/** 非 user/assistant 的消息(tool / system / thinking… )折叠成**一行**摘要,
 *  与 Desktop 端把工具调用收起的做法一致;绝不当成用户输入打印。 */
function collapseMeta(role: string, raw: string): string {
  const label = '[' + (role || 'tool') + '] ';
  const flat = raw.replace(/\s+/g, ' ').trim();
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const bits: string[] = [];
    for (const k of ['command', 'name', 'tool', 'status', 'error', 'output', 'detail', 'text', 'content']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) bits.push(v.replace(/\s+/g, ' ').trim());
      if (bits.join(' · ').length > 90) break;
    }
    if (bits.length) return label + bits.join(' · ');
  } catch { /* 不是 JSON:按纯文本折叠 */ }
  return label + flat;
}

export async function getSessionMessages(cfg: HermesConfig, sessionId: string): Promise<HermesMessage[]> {
  const res = await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages?order=latest&limit=20`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  })
  if (!res.ok) throw new HermesError(`http ${res.status}`, res.status)
  const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
  const arr = data.data ?? [] // 保持服务器返回顺序(旧→新)
  const out: HermesMessage[] = []
  for (const m of arr) {
    const role = String(m.role ?? '')
    const text = messageText(m.content)
    if (role === 'user') { out.push({ role: 'user', text }); continue }
    if (role === 'assistant') {
      if (text.trim()) out.push({ role: 'assistant', text }) // 空回复(纯工具轮)直接跳过
      continue
    }
    // tool / system / 其它 → 折叠成一行 meta(不当成用户输入)
    if (!text.trim()) continue
    out.push({ role: 'meta', text: collapseMeta(role, text) })
  }
  return out
}

export async function sessionChat(cfg: HermesConfig, sessionId: string, message: string): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new HermesError(`http ${res.status}`, res.status)
  const data = (await res.json()) as { message?: { content?: unknown } }
  return messageText(data.message?.content ?? data.message ?? '')
}

// Hermes 会话接口支持多模态:纯文本直接传字符串;有图片时传 text + image_url 的 part 数组。
function buildMessagePayload(text: string, images: string[]): unknown {
  if (!images.length) return text
  return [
    { type: 'text', text },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ]
}

export async function* sessionChatStream(
  cfg: HermesConfig,
  sessionId: string,
  message: string,
  images: string[] = [],
  signal?: AbortSignal,
): AsyncGenerator<HermesStreamEvent, void, void> {
  // 与 streamRespond 相同的健壮结构(watchdog + readOrAbort);端点接续桌面会话
  const ac = new AbortController()
  const start = Date.now()
  let lastEventAt = start
  const abortWith = (reason: string) => { if (!ac.signal.aborted) (ac as any)._abortReason = reason; ac.abort() }
  if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', () => ac.abort(), { once: true }) }
  const watchdog = setInterval(() => {
    const now = Date.now()
    if (now - start > STREAM_TOTAL_TIMEOUT_MS) abortWith('total timeout')
    else if (now - lastEventAt > STREAM_NO_EVENT_TIMEOUT_MS) abortWith('no-event timeout')
  }, 1_000)
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ message: buildMessagePayload(message, images) }),
      signal: ac.signal,
    })
  } catch (err) {
    clearInterval(watchdog)
    const reason = (ac as any)._abortReason as string | undefined
    if (reason) throw new HermesError(`stream: ${reason}`)
    throw new HermesError(`network: ${(err as Error).message}`)
  }
  if (!res.ok) { clearInterval(watchdog); throw new HermesError(`http ${res.status}`, res.status) }
  if (!res.body) { clearInterval(watchdog); throw new HermesError('stream: no body') }
  const ctype = res.headers.get('content-type') || ''
  if (!ctype.includes('text/event-stream')) {
    const text = await res.text()
    let reply = text
    try { const d = JSON.parse(text); reply = messageText(d.message?.content ?? d.message ?? d.error?.message ?? text) } catch {}
    clearInterval(watchdog)
    yield { kind: 'done', text: reply }
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final = ''
  let emittedDone = false
  const readOrAbort = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (ac.signal.aborted) return Promise.reject(new Error('aborted'))
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new Error('aborted'))
      ac.signal.addEventListener('abort', onAbort, { once: true })
      reader.read().then(
        (r) => { ac.signal.removeEventListener('abort', onAbort); resolve(r) },
        (e) => { ac.signal.removeEventListener('abort', onAbort); reject(e) },
      )
    })
  }
  try {
    while (true) {
      const { value, done } = await readOrAbort()
      if (done) break
      lastEventAt = Date.now()
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const ev = parseChatStreamFrame(frame)
        if (ev) { if (ev.kind === 'delta') final += ev.text; if (ev.kind === 'done') emittedDone = true; yield ev }
      }
    }
    if (buffer.trim()) {
      const ev = parseChatStreamFrame(buffer)
      if (ev) { if (ev.kind === 'delta') final += ev.text; if (ev.kind === 'done') emittedDone = true; yield ev }
    }
    if (!emittedDone && final) yield { kind: 'done', text: final }
  } catch (err) {
    const reason = (ac as any)._abortReason as string | undefined
    if (reason) throw new HermesError(`stream: ${reason}`)
    throw err
  } finally {
    clearInterval(watchdog)
  }
}

function parseChatStreamFrame(frame: string): HermesStreamEvent | null {
  let evName = ''; let dataStr = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) evName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
  }
  if (!dataStr) return null
  let d: any
  try { d = JSON.parse(dataStr) } catch { return null }
  if (evName === 'assistant.delta') return { kind: 'delta', text: String(d.delta ?? '') }
  if (evName === 'assistant.completed') return { kind: 'done', text: messageText(d.content ?? '') }
  if (evName === 'tool.progress' || evName === 'tool.started') return { kind: 'tool', label: String(d.tool_name ?? '_thinking') }
  if (evName === 'tool.completed' || evName === 'tool.failed') return { kind: 'tool_end' }
  return null
}

export async function createSession(cfg: HermesConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new HermesError(`http ${res.status}`, res.status)
  const data = (await res.json()) as any
  const s = data?.session ?? data
  const id = String(s?.id ?? '')
  if (!id) throw new HermesError('create session: no id')
  return id
}

export async function deleteSession(cfg: HermesConfig, sessionId: string): Promise<boolean> {
  const res = await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  })
  if (!res.ok) throw new HermesError(`http ${res.status}`, res.status)
  const data = (await res.json().catch(() => ({}))) as { deleted?: boolean }
  return !!data.deleted
}

export function extractText(data: HermesResponseRaw): string {
  const message = data.output?.find(o => o.type === 'message')
  const piece = message?.content?.find(c => c.type === 'output_text')
  return piece?.text ?? ''
}

function buildBody(cfg: HermesConfig, conversation: string, input: string, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    conversation,
    input,
    store: true,
  }
  if (cfg.instructions) body.instructions = cfg.instructions
  if (stream) body.stream = true
  return body
}

export async function respond(
  cfg: HermesConfig,
  conversation: string,
  input: string,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildBody(cfg, conversation, input, false)),
      signal,
    })
  } catch (err) {
    throw new HermesError(`network: ${(err as Error).message}`)
  }

  if (!res.ok) {
    throw new HermesError(`http ${res.status}`, res.status)
  }

  const data = (await res.json()) as HermesResponseRaw
  return extractText(data)
}

// Total bound: still 30s if the network or server is fully wedged.
// Per-chunk bound: 60s. Real Hermes responses with mid-stream tool calls
// (search, code execution, file reads) can easily sit silent for 30+ seconds
// while the agent works; 10s aborted legitimate responses in practice.
export const STREAM_TOTAL_TIMEOUT_MS = 600_000
export const STREAM_NO_EVENT_TIMEOUT_MS = 180_000

export async function* streamRespond(
  cfg: HermesConfig,
  conversation: string,
  input: string,
  signal?: AbortSignal,
): AsyncGenerator<HermesStreamEvent, void, void> {
  // Two timeouts: 30s from request initiation, plus 10s of "no event arrived
  // at all" insurance. Both abort via a local AbortController which is chained
  // to the caller's signal so external cancellation still wins.
  const ac = new AbortController()
  const start = Date.now()
  let lastEventAt = start
  const abortWith = (reason: string) => {
    if (!ac.signal.aborted) (ac as any)._abortReason = reason
    ac.abort()
  }
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  const watchdog = setInterval(() => {
    const now = Date.now()
    if (now - start > STREAM_TOTAL_TIMEOUT_MS) abortWith('total timeout')
    else if (now - lastEventAt > STREAM_NO_EVENT_TIMEOUT_MS) abortWith('no-event timeout')
  }, 1_000)

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(buildBody(cfg, conversation, input, true)),
      signal: ac.signal,
    })
  } catch (err) {
    clearInterval(watchdog)
    const reason = (ac as any)._abortReason as string | undefined
    if (reason) throw new HermesError(`stream: ${reason}`)
    throw new HermesError(`network: ${(err as Error).message}`)
  }

  if (!res.ok) {
    clearInterval(watchdog)
    throw new HermesError(`http ${res.status}`, res.status)
  }
  if (!res.body) {
    clearInterval(watchdog)
    throw new HermesError('stream: no body')
  }

  // If the server ignored stream:true and returned a single JSON blob,
  // parse the whole body once and yield a single done event.
  const ctype = res.headers.get('content-type') || ''
  if (!ctype.includes('text/event-stream')) {
    console.log('[hermes-stream] non-SSE response, falling back to JSON parse. content-type=', ctype)
    try {
      const text = await res.text()
      const data = JSON.parse(text) as HermesResponseRaw
      yield { kind: 'done', text: extractText(data) }
    } catch (err) {
      const reason = (ac as any)._abortReason as string | undefined
      if (reason) throw new HermesError(`stream: ${reason}`)
      throw new HermesError(`stream: non-SSE parse failed: ${(err as Error).message}`)
    } finally {
      clearInterval(watchdog)
    }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emittedDone = false

  // Race reader.read() against ac.signal so the watchdog (which only flips the
  // signal) actually unblocks a stuck read in environments where aborting a
  // fetch controller doesn't propagate into the body stream.
  const readOrAbort = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (ac.signal.aborted) return Promise.reject(new Error('aborted'))
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new Error('aborted'))
      ac.signal.addEventListener('abort', onAbort, { once: true })
      reader.read().then(
        (result) => { ac.signal.removeEventListener('abort', onAbort); resolve(result) },
        (err) => { ac.signal.removeEventListener('abort', onAbort); reject(err) },
      )
    })
  }

  try {
    while (true) {
      const { value, done } = await readOrAbort()
      if (done) break
      lastEventAt = Date.now()
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const ev = parseFrame(frame)
        if (ev) {
          if (ev.kind === 'done') emittedDone = true
          yield ev
        }
      }
    }
    // Flush any final frame without trailing blank line.
    if (buffer.trim()) {
      const ev = parseFrame(buffer)
      if (ev) {
        if (ev.kind === 'done') emittedDone = true
        yield ev
      }
    }
    if (!emittedDone) {
      console.warn('[hermes-stream] stream closed without a response.completed event')
    }
  } catch (err) {
    const reason = (ac as any)._abortReason as string | undefined
    if (reason) throw new HermesError(`stream: ${reason}`)
    throw err
  } finally {
    clearInterval(watchdog)
    try { reader.releaseLock() } catch { /* ignore */ }
  }
}

function parseFrame(frame: string): HermesStreamEvent | null {
  let eventName = ''
  let dataLine = ''
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
  }
  if (!dataLine) return null
  if (dataLine === '[DONE]') return null

  let payload: any
  try { payload = JSON.parse(dataLine) } catch { return null }

  const type = eventName || payload?.type
  switch (type) {
    case 'response.output_text.delta': {
      const delta = typeof payload?.delta === 'string' ? payload.delta : ''
      if (!delta) return null
      return { kind: 'delta', text: delta }
    }
    case 'response.output_item.added': {
      const item = payload?.item
      if (item?.type === 'function_call' && typeof item.name === 'string') {
        return { kind: 'tool', label: toolLabel(item.name) }
      }
      return null
    }
    case 'response.output_item.done': {
      const item = payload?.item
      if (item?.type === 'function_call') return { kind: 'tool_end' }
      return null
    }
    case 'response.completed': {
      const resp = (payload?.response ?? payload) as HermesResponseRaw
      return { kind: 'done', text: extractText(resp) }
    }
    default:
      return null
  }
}

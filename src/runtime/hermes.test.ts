import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  respond,
  streamRespond,
  extractText,
  HermesError,
  type HermesConfig,
  type HermesResponseRaw,
  type HermesStreamEvent,
} from './hermes';

const CFG: HermesConfig = {
  baseUrl: 'http://host:8642',
  apiKey: 'sk-test',
  model: 'hermes-agent',
  instructions: '',
};

const FIXTURE_SUCCESS: HermesResponseRaw = {
  id: 'resp_5743470f71374ff594ab5bc87cd6',
  status: 'completed',
  output: [{
    type: 'message',
    content: [{ type: 'output_text', text: 'pong' }],
  }],
  usage: { input_tokens: 19819, output_tokens: 16, total_tokens: 19835 },
};

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const enc = new TextEncoder();
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(gen: AsyncGenerator<HermesStreamEvent>): Promise<HermesStreamEvent[]> {
  const out: HermesStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('extractText', () => {
  it('pulls output_text from the message output', () => {
    expect(extractText(FIXTURE_SUCCESS)).toBe('pong');
  });
  it('returns empty string when no message output is present', () => {
    expect(extractText({ output: [] })).toBe('');
    expect(extractText({})).toBe('');
  });
  it('returns empty string when message has no output_text content', () => {
    expect(extractText({ output: [{ type: 'message', content: [{ type: 'image', text: 'ignored' } as any] }] })).toBe('');
  });
});

describe('respond', () => {
  it('POSTs JSON to /v1/responses with model, conversation, input, store, Bearer auth', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify(FIXTURE_SUCCESS), { status: 200 }));
    const text = await respond(CFG, 'g2-conv-1', 'say pong');
    expect(text).toBe('pong');

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('http://host:8642/v1/responses');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'hermes-agent',
      conversation: 'g2-conv-1',
      input: 'say pong',
      store: true,
    });
    expect(body.instructions).toBeUndefined();   // empty instructions are omitted
    expect(body.stream).toBeUndefined();         // non-streaming path does not request stream
  });

  it('includes instructions when configured', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify(FIXTURE_SUCCESS), { status: 200 }));
    await respond({ ...CFG, instructions: 'be concise' }, 'c', 'hi');
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.instructions).toBe('be concise');
  });

  it('throws HermesError with status on HTTP 401', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response('nope', { status: 401 }));
    const promise = respond(CFG, 'c', 'hi');
    await expect(promise).rejects.toBeInstanceOf(HermesError);
    await expect(promise).rejects.toMatchObject({ status: 401 });
  });

  it('throws HermesError on network failure', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(respond(CFG, 'c', 'hi')).rejects.toMatchObject({ name: 'HermesError', status: 0 });
  });

  it('forwards the AbortSignal to fetch', async () => {
    const ac = new AbortController();
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify(FIXTURE_SUCCESS), { status: 200 }));
    await respond(CFG, 'c', 'hi', ac.signal);
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.signal).toBe(ac.signal);
  });
});

describe('streamRespond', () => {
  it('POSTs with stream:true and Accept: text/event-stream', async () => {
    (globalThis.fetch as any).mockResolvedValue(sseResponse([
      'event: response.completed\n',
      'data: {"type":"response.completed","response":' + JSON.stringify(FIXTURE_SUCCESS) + '}\n\n',
    ]));
    await collect(streamRespond(CFG, 'c', 'hi'));

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('http://host:8642/v1/responses');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('hermes-agent');
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
  });

  it('yields delta events for response.output_text.delta', async () => {
    (globalThis.fetch as any).mockResolvedValue(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}]}}\n\n',
    ]));
    const evts = await collect(streamRespond(CFG, 'c', 'hi'));
    expect(evts).toEqual([
      { kind: 'delta', text: 'Hel' },
      { kind: 'delta', text: 'lo' },
      { kind: 'done', text: 'Hello' },
    ]);
  });

  it('yields tool events for response.output_item.added with function_call, then tool_end on done', async () => {
    (globalThis.fetch as any).mockResolvedValue(sseResponse([
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call","name":"web_search"}}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","name":"web_search"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n',
    ]));
    const evts = await collect(streamRespond(CFG, 'c', 'hi'));
    expect(evts).toEqual([
      { kind: 'tool', label: 'searching' },
      { kind: 'tool_end' },
      { kind: 'done', text: 'ok' },
    ]);
  });

  it('ignores output_item events that are not function_call', async () => {
    (globalThis.fetch as any).mockResolvedValue(sseResponse([
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"message"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"hey"}]}]}}\n\n',
    ]));
    const evts = await collect(streamRespond(CFG, 'c', 'hi'));
    expect(evts).toEqual([{ kind: 'done', text: 'hey' }]);
  });

  it('handles chunks split mid-event-frame', async () => {
    (globalThis.fetch as any).mockResolvedValue(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_t',
      'ext.delta","delta":"split"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"split"}]}]}}\n\n',
    ]));
    const evts = await collect(streamRespond(CFG, 'c', 'hi'));
    expect(evts).toEqual([
      { kind: 'delta', text: 'split' },
      { kind: 'done', text: 'split' },
    ]);
  });

  it('throws HermesError on HTTP error', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(collect(streamRespond(CFG, 'c', 'hi'))).rejects.toMatchObject({
      name: 'HermesError',
      status: 503,
    });
  });

  it('throws HermesError on network failure', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(collect(streamRespond(CFG, 'c', 'hi'))).rejects.toMatchObject({
      name: 'HermesError',
      status: 0,
    });
  });

  it('honors a caller-supplied AbortSignal by passing a derived signal to fetch', async () => {
    const ac = new AbortController();
    (globalThis.fetch as any).mockResolvedValue(sseResponse([
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n',
    ]));
    await collect(streamRespond(CFG, 'c', 'hi', ac.signal));
    // We chain the caller's signal through a local AbortController so the
    // 10s/30s watchdog can also abort. fetch must still receive an AbortSignal.
    const passed = (globalThis.fetch as any).mock.calls[0][1].signal;
    expect(passed).toBeInstanceOf(AbortSignal);
  });

  it('throws HermesError when response body is missing', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(null, { status: 200 }));
    await expect(collect(streamRespond(CFG, 'c', 'hi'))).rejects.toBeInstanceOf(HermesError);
  });

  it('times out after the no-event threshold on a silent open stream', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(_ctrl) { /* enqueue nothing, never close */ },
    });
    (globalThis.fetch as any).mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const promise = collect(streamRespond(CFG, 'c', 'hi'));
    const guarded = promise.catch((e) => e);
    // Advance past the no-event watchdog threshold (60s). Walk in 5s steps so
    // the 1s setInterval has chances to fire and re-evaluate.
    for (let i = 0; i < 14; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    const err = await guarded;
    expect(err).toBeInstanceOf(HermesError);
    expect(String(err.message)).toMatch(/no-event timeout|total timeout/);
    vi.useRealTimers();
  });
});

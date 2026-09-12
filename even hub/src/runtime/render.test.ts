import { describe, it, expect, vi } from 'vitest';
import { RenderQueue, statusLine, mainContent, footerHint, MAX_MAIN_CHARS } from './render';
import type { State, HomeItem } from './state-machine';
import type { TurnEntry } from './history';

const CONV = 'g2-2026-05-22-01';

describe('statusLine', () => {
  it('idle shows just the conversation name (no badge, no verb)', () => {
    expect(statusLine({ kind: 'idle', conversation: CONV })).toBe(CONV);
  });

  it('recording shows ASCII spinner badge + listening verb', () => {
    expect(statusLine({ kind: 'recording', conversation: CONV, startedAt: 0 }))
      .toBe(`${CONV} · | listening`);
  });

  it('transcribing shows ASCII spinner + thinking verb', () => {
    expect(statusLine({ kind: 'transcribing', conversation: CONV }))
      .toBe(`${CONV} · | thinking`);
  });

  it('thinking with no tool shows ASCII spinner + thinking verb', () => {
    expect(statusLine({ kind: 'thinking', conversation: CONV, transcript: 'x', toolLabel: null }))
      .toBe(`${CONV} · | thinking`);
  });

  it('thinking with tool shows ASCII spinner + tool verb', () => {
    expect(statusLine({ kind: 'thinking', conversation: CONV, transcript: 'x', toolLabel: 'searching' }))
      .toBe(`${CONV} · | searching`);
  });

  it('displaying-streaming without tool shows no badge or verb', () => {
    expect(statusLine({ kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'r', streaming: true, toolLabel: null, scrollOffset: 0 }))
      .toBe(CONV);
  });

  it('displaying with tool label shows ASCII spinner + verb (mid-stream tool call)', () => {
    expect(statusLine({ kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'r', streaming: true, toolLabel: 'reading', scrollOffset: 0 }))
      .toBe(`${CONV} · | reading`);
  });

  it('displaying-done shows nothing in status', () => {
    expect(statusLine({ kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'r', streaming: false, toolLabel: null, scrollOffset: 0 }))
      .toBe(CONV);
  });

  it('error shows × badge + error verb', () => {
    expect(statusLine({ kind: 'error', conversation: CONV, message: 'oops', lastTranscript: '' }))
      .toBe(`${CONV} · × error`);
  });

  it('disconnected shows nothing extra in status', () => {
    expect(statusLine({ kind: 'disconnected', conversation: CONV })).toBe(CONV);
  });

  it('recording badge spins through the 4-frame ASCII cycle', () => {
    const rec = { kind: 'recording', conversation: CONV, startedAt: 0 } as State;
    expect(statusLine(rec, 0)).toBe(`${CONV} · | listening`);
    expect(statusLine(rec, 1)).toBe(`${CONV} · / listening`);
    expect(statusLine(rec, 2)).toBe(`${CONV} · - listening`);
    expect(statusLine(rec, 3)).toBe(`${CONV} · \\ listening`);
    expect(statusLine(rec, 4)).toBe(`${CONV} · | listening`);
  });

  it('thinking spinner rotates through the same 4-frame ASCII cycle', () => {
    const th = { kind: 'thinking', conversation: CONV, transcript: 'x', toolLabel: null } as State;
    const frames = ['|', '/', '-', '\\'];
    for (let i = 0; i < 8; i++) {
      expect(statusLine(th, i)).toBe(`${CONV} · ${frames[i % 4]} thinking`);
    }
  });
});

describe('home render', () => {
  const turn = (q: string): TurnEntry => ({ conversation: 'daily', transcript: q, reply: 'r', ts: 1, source: 'glasses' });
  const items: HomeItem[] = [
    { kind: 'new' },
    { kind: 'turn', turn: turn('what time is it') },
    { kind: 'turn', turn: turn('tell me a really really really long story please') },
  ];
  const home: State = { kind: 'home', conversation: CONV, items, selectedIdx: 0 };

  it('mainContent renders one line per item with > cursor on the selected one', () => {
    const out = mainContent(home);
    expect(out.split('\n')).toEqual([
      '> + new session',
      '  what time is it',
      '  tell me a really really really…',
    ]);
  });
  it('cursor moves with selectedIdx', () => {
    const out = mainContent({ ...home, selectedIdx: 1 });
    const lines = out.split('\n');
    expect(lines[0]).toBe('  + new session');
    expect(lines[1].startsWith('> ')).toBe(true);
  });
  it('truncates long transcripts to 32 chars + ellipsis', () => {
    const out = mainContent(home);
    const longLine = out.split('\n')[2];
    expect(longLine.length).toBeLessThanOrEqual(34); // 2 (cursor) + 32 (text)
    expect(longLine.endsWith('…')).toBe(true);
  });
  it('footerHint says "tap to select · 2× to exit"', () => {
    expect(footerHint(home)).toBe('tap to select · 2× to exit');
  });
  it('statusLine shows the home verb but no badge', () => {
    expect(statusLine(home)).toBe(`${CONV} · home`);
  });
});

describe('mainContent', () => {
  it('idle shows the tap-to-talk hint', () => {
    expect(mainContent({ kind: 'idle', conversation: CONV })).toMatch(/tap to talk/i);
  });
  it('recording keeps the idle hint in the center (badge in status carries the change)', () => {
    expect(mainContent({ kind: 'recording', conversation: CONV, startedAt: 0 })).toMatch(/tap to talk/i);
  });
  it('transcribing shows a dim ellipsis only', () => {
    expect(mainContent({ kind: 'transcribing', conversation: CONV })).toBe('...');
  });
  it('thinking shows a dim ellipsis only', () => {
    expect(mainContent({ kind: 'thinking', conversation: CONV, transcript: 'hi', toolLabel: null })).toBe('...');
  });
  it('displaying done shows the reply with no prefix', () => {
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'what time is it', reply: '7:42 pm', streaming: false, toolLabel: null, scrollOffset: 0 };
    expect(mainContent(s)).toBe('7:42 pm');
  });
  it('displaying streaming shows the reply with no trailing cursor', () => {
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'Hel', streaming: true, toolLabel: null, scrollOffset: 0 };
    expect(mainContent(s, 0)).toBe('Hel');
    expect(mainContent(s, 1)).toBe('Hel');
  });
  it('displaying-done truncates very long replies at MAX_MAIN_CHARS with ASCII ellipsis', () => {
    const long = 'x'.repeat(2000);
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: long, streaming: false, toolLabel: null, scrollOffset: 0 };
    const out = mainContent(s);
    expect(out.length).toBe(MAX_MAIN_CHARS);
    expect(out.endsWith('...')).toBe(true);
  });
  it('displaying-streaming keeps the tail visible by truncating the head', () => {
    const long = 'a'.repeat(2000) + 'TAIL';
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: long, streaming: true, toolLabel: null, scrollOffset: 0 };
    const out = mainContent(s);
    expect(out.startsWith('...')).toBe(true);
    expect(out.endsWith('TAIL')).toBe(true);
    expect(out.length).toBe(MAX_MAIN_CHARS);
  });
  it('error shows just the error message in the center', () => {
    const s: State = { kind: 'error', conversation: CONV, message: 'http 500', lastTranscript: '' };
    expect(mainContent(s)).toBe('http 500');
  });
  it('disconnected shows the reconnect hint', () => {
    expect(mainContent({ kind: 'disconnected', conversation: CONV })).toMatch(/disconnected/i);
  });
  it('displaying strips markdown from the reply before render', () => {
    const s: State = {
      kind: 'displaying',
      conversation: CONV,
      transcript: 'q',
      reply: '## Title\nThis is **bold** and a [link](https://x.io).',
      streaming: false,
      toolLabel: null,
      scrollOffset: 0,
    };
    expect(mainContent(s)).toBe('Title\nThis is bold and a link.');
  });
});

describe('footerHint', () => {
  it('idle, recording and disconnected have no footer', () => {
    expect(footerHint({ kind: 'idle', conversation: CONV })).toBe('');
    expect(footerHint({ kind: 'recording', conversation: CONV, startedAt: 0 })).toBe('');
    expect(footerHint({ kind: 'disconnected', conversation: CONV })).toBe('');
  });
  it('transcribing and thinking show "tap to cancel"', () => {
    expect(footerHint({ kind: 'transcribing', conversation: CONV })).toBe('tap to cancel');
    expect(footerHint({ kind: 'thinking', conversation: CONV, transcript: 'x', toolLabel: null })).toBe('tap to cancel');
  });
  it('displaying-streaming shows "tap to interrupt"', () => {
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'r', streaming: true, toolLabel: null, scrollOffset: 0 };
    expect(footerHint(s)).toBe('tap to interrupt');
  });
  it('displaying-done (short reply) shows "tap to talk again · 2× to back"', () => {
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'r', streaming: false, toolLabel: null, scrollOffset: 0 };
    expect(footerHint(s)).toBe('tap to talk again · 2× to back');
  });
  it('error shows "tap to retry"', () => {
    const s: State = { kind: 'error', conversation: CONV, message: 'oops', lastTranscript: '' };
    expect(footerHint(s)).toBe('tap to retry');
  });
  it('displaying-done with a scrollable reply shows the scroll-to-read hint', () => {
    const long = 'x'.repeat(1500);
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: long, streaming: false, toolLabel: null, scrollOffset: 0 };
    expect(footerHint(s)).toBe('scroll up to read · 2× to back');
  });
});

describe('mainContent — scroll windowing', () => {
  it('done + overflows + offset 0 shows the head with a tail "..."', () => {
    const reply = 'HEAD' + 'm'.repeat(1500) + 'TAIL';
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply, streaming: false, toolLabel: null, scrollOffset: 0 };
    const out = mainContent(s);
    expect(out.startsWith('HEAD')).toBe(true);
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBe(MAX_MAIN_CHARS);
  });
  it('done + overflows + offset > 0 shows "..." on both ends', () => {
    const reply = 'HEAD' + 'm'.repeat(1500) + 'TAIL';
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply, streaming: false, toolLabel: null, scrollOffset: 300 };
    const out = mainContent(s);
    expect(out.startsWith('...')).toBe(true);
    expect(out.endsWith('...')).toBe(true);
  });
  it('done + overflows + offset at max shows the tail with a leading "..."', () => {
    const reply = 'HEAD' + 'm'.repeat(1500) + 'TAIL';
    const max = reply.length - MAX_MAIN_CHARS;
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply, streaming: false, toolLabel: null, scrollOffset: max };
    const out = mainContent(s);
    expect(out.startsWith('...')).toBe(true);
    expect(out.endsWith('TAIL')).toBe(true);
  });
});

describe('RenderQueue', () => {
  function makeBridge() {
    return { textContainerUpgrade: vi.fn().mockResolvedValue(true) };
  }

  it('writes status and main on the first idle render (footer stays empty)', async () => {
    const bridge = makeBridge();
    const q = new RenderQueue(bridge as any);
    await q.render({ kind: 'idle', conversation: CONV });
    const ids = bridge.textContainerUpgrade.mock.calls.map((c: any) => c[0].containerID);
    expect(ids).toEqual([1, 2]);
  });

  it('writes all three containers when transitioning idle → displaying-done', async () => {
    const bridge = makeBridge();
    const q = new RenderQueue(bridge as any);
    await q.render({ kind: 'idle', conversation: CONV });
    bridge.textContainerUpgrade.mockClear();
    const s: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'reply', streaming: false, toolLabel: null, scrollOffset: 0 };
    await q.render(s);
    const ids = bridge.textContainerUpgrade.mock.calls.map((c: any) => c[0].containerID);
    // main changed (idle hint → reply) and footer changed ('' → 'tap to talk again'); status unchanged
    expect(ids).toEqual([2, 3]);
  });

  it('skips unchanged containers on the next render', async () => {
    const bridge = makeBridge();
    const q = new RenderQueue(bridge as any);
    await q.render({ kind: 'idle', conversation: CONV });
    bridge.textContainerUpgrade.mockClear();
    await q.render({ kind: 'idle', conversation: CONV });
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
  });

  it('serializes overlapping renders so writes happen in order', async () => {
    const order: number[] = [];
    let pausePromise: Promise<void> | null = null;
    let releaseFunc: (() => void) | null = null;
    const bridge = {
      textContainerUpgrade: vi.fn().mockImplementation(async (arg: any) => {
        order.push(arg.containerID);
        if (arg.containerID === 1 && order.length === 1) {
          pausePromise = new Promise<void>(r => { releaseFunc = r; });
          await pausePromise;
        }
        return true;
      }),
    };
    const q = new RenderQueue(bridge as any);
    const a = q.render({ kind: 'idle', conversation: CONV });
    // Give a small delay to ensure first render starts
    await new Promise(r => setTimeout(r, 50));
    const b = q.render({ kind: 'recording', conversation: CONV, startedAt: 0 });
    // Release the pause
    if (releaseFunc) releaseFunc();
    await Promise.all([a, b]);
    // Idle → status (1) + main (2). Then recording: only status changes (badge appears),
    // main is unchanged (still the idle hint), footer is unchanged (still empty).
    expect(order).toEqual([1, 2, 1]);
  }, { timeout: 10000 });
});

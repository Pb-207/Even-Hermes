import { describe, it, expect } from 'vitest';
import { reduce, initialState, newConversationName, type State, type Effect, type HomeItem } from './state-machine';
import type { TurnEntry } from './history';

const CONV = 'g2-2026-05-22-01';
const idle: State = { kind: 'idle', conversation: CONV };
const recording: State = { kind: 'recording', conversation: CONV, startedAt: 1_000 };
const transcribing: State = { kind: 'transcribing', conversation: CONV };
const thinking: State = { kind: 'thinking', conversation: CONV, transcript: 'hello', toolLabel: null };
const displaying: State = { kind: 'displaying', conversation: CONV, transcript: 'hello', reply: 'hi back', streaming: false, toolLabel: null, scrollOffset: 0 };
const error: State = { kind: 'error', conversation: CONV, message: 'oops', lastTranscript: '' };
const disconnected: State = { kind: 'disconnected', conversation: CONV };

const kinds = (effects: Effect[]) => effects.map(e => e.kind);

describe('newConversationName', () => {
  it('formats as g2-YYYY-MM-DD-NN', () => {
    expect(newConversationName(new Date('2026-05-22T12:00:00Z'), 1)).toBe('g2-2026-05-22-01');
  });
});

describe('initialState', () => {
  it('returns home with the given conversation and a single "+ new session" item', () => {
    const s = initialState('g2-x');
    expect(s.kind).toBe('home');
    if (s.kind === 'home') {
      expect(s.conversation).toBe('g2-x');
      expect(s.items).toEqual([{ kind: 'new' }]);
      expect(s.selectedIdx).toBe(0);
    }
  });
});

describe('reduce — idle', () => {
  it('TAP starts recording', () => {
    const t = reduce(idle, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('recording');
    expect(kinds(t.effects)).toEqual(['mic_on', 'render']);
  });
  it('SCROLL_UP requests a new conversation', () => {
    const t = reduce(idle, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state.kind).toBe('idle');
    expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'new_conversation', 'render']);
  });
  it('DOUBLE_CLICK from idle goes back to home (abort + reload + render)', () => {
    const t = reduce(idle, { kind: 'gesture', gesture: 'DOUBLE_CLICK' });
    expect(t.state.kind).toBe('home');
    expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'reload_history', 'render']);
  });
  it('SCROLL_DOWN is ignored', () => {
    const t = reduce(idle, { kind: 'gesture', gesture: 'SCROLL_DOWN' });
    expect(t.state).toBe(idle);
    expect(t.effects).toEqual([]);
  });
});

describe('reduce — recording', () => {
  it('TAP stops mic and goes to transcribing', () => {
    const t = reduce(recording, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('transcribing');
    expect(kinds(t.effects)).toEqual(['mic_off', 'transcribe', 'render']);
  });
  it('recording_timeout behaves like TAP', () => {
    const t = reduce(recording, { kind: 'recording_timeout' });
    expect(t.state.kind).toBe('transcribing');
    expect(kinds(t.effects)).toEqual(['mic_off', 'transcribe', 'render']);
  });
  it('SCROLL_UP aborts and goes to idle/new', () => {
    const t = reduce(recording, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state.kind).toBe('idle');
    expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'new_conversation', 'render']);
  });
});

describe('reduce — transcribing', () => {
  it('stt_ok with non-empty text moves to thinking and sends', () => {
    const t = reduce(transcribing, { kind: 'stt_ok', text: 'hello' });
    expect(t.state.kind).toBe('thinking');
    if (t.state.kind === 'thinking') expect(t.state.transcript).toBe('hello');
    expect(kinds(t.effects)).toEqual(['send', 'render']);
  });
  it('stt_ok with empty text becomes an error', () => {
    const t = reduce(transcribing, { kind: 'stt_ok', text: '   ' });
    expect(t.state.kind).toBe('error');
    if (t.state.kind === 'error') expect(t.state.message).toMatch(/heard nothing/i);
    expect(kinds(t.effects)).toEqual(['render']);
  });
  it('stt_err becomes an error', () => {
    const t = reduce(transcribing, { kind: 'stt_err', message: 'http 401' });
    expect(t.state.kind).toBe('error');
    if (t.state.kind === 'error') expect(t.state.message).toBe('http 401');
  });
});

describe('reduce — home', () => {
  const turn = (q: string, conv = 'daily'): TurnEntry => ({
    conversation: conv, transcript: q, reply: 'r', ts: 1, source: 'glasses',
  });
  const home3: State = {
    kind: 'home', conversation: CONV, selectedIdx: 0,
    items: [{ kind: 'new' }, { kind: 'turn', turn: turn('q1') }, { kind: 'turn', turn: turn('q2') }],
  };

  it('home_loaded replaces items and resets cursor to 0', () => {
    const fresh: HomeItem[] = [{ kind: 'new' }, { kind: 'turn', turn: turn('q3') }];
    const start: State = { ...home3, selectedIdx: 2 };
    const t = reduce(start, { kind: 'home_loaded', items: fresh });
    if (t.state.kind === 'home') {
      expect(t.state.items).toEqual(fresh);
      expect(t.state.selectedIdx).toBe(0);
    }
    expect(kinds(t.effects)).toEqual(['render']);
  });

  it('SCROLL_DOWN advances the cursor', () => {
    const t = reduce(home3, { kind: 'gesture', gesture: 'SCROLL_DOWN' });
    if (t.state.kind === 'home') expect(t.state.selectedIdx).toBe(1);
  });

  it('SCROLL_UP retreats the cursor', () => {
    const mid: State = { ...home3, selectedIdx: 2 };
    const t = reduce(mid, { kind: 'gesture', gesture: 'SCROLL_UP' });
    if (t.state.kind === 'home') expect(t.state.selectedIdx).toBe(1);
  });

  it('SCROLL_UP clamps at 0', () => {
    const t = reduce(home3, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state).toBe(home3);
    expect(t.effects).toEqual([]);
  });

  it('SCROLL_DOWN clamps at items.length - 1', () => {
    const last: State = { ...home3, selectedIdx: 2 };
    const t = reduce(last, { kind: 'gesture', gesture: 'SCROLL_DOWN' });
    expect(t.state).toBe(last);
    expect(t.effects).toEqual([]);
  });

  it('TAP on "+ new session" emits new_conversation and lands in idle', () => {
    const t = reduce(home3, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('idle');
    expect(kinds(t.effects)).toEqual(['new_conversation', 'render']);
  });

  it('TAP on a historical turn lands in displaying-done with that turn loaded', () => {
    const onTurn: State = { ...home3, selectedIdx: 1 };
    const t = reduce(onTurn, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('displaying');
    if (t.state.kind === 'displaying') {
      expect(t.state.conversation).toBe('daily');
      expect(t.state.transcript).toBe('q1');
      expect(t.state.reply).toBe('r');
      expect(t.state.streaming).toBe(false);
      expect(t.state.scrollOffset).toBe(0);
    }
  });

  it('DOUBLE_CLICK from home exits the app', () => {
    const t = reduce(home3, { kind: 'gesture', gesture: 'DOUBLE_CLICK' });
    expect(t.state).toBe(home3);
    expect(kinds(t.effects)).toEqual(['exit_confirm']);
  });
});

describe('reduce — back to home (DOUBLE_CLICK from non-home)', () => {
  it('from recording', () => {
    const t = reduce(recording, { kind: 'gesture', gesture: 'DOUBLE_CLICK' });
    expect(t.state.kind).toBe('home');
    expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'reload_history', 'render']);
  });
  it('from thinking', () => {
    const t = reduce(thinking, { kind: 'gesture', gesture: 'DOUBLE_CLICK' });
    expect(t.state.kind).toBe('home');
    expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'reload_history', 'render']);
  });
  it('from displaying', () => {
    const t = reduce(displaying, { kind: 'gesture', gesture: 'DOUBLE_CLICK' });
    expect(t.state.kind).toBe('home');
    expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'reload_history', 'render']);
  });
});

describe('reduce — set_conversation', () => {
  it('switches the active conversation while idle', () => {
    const t = reduce(idle, { kind: 'set_conversation', conversation: 'daily journal' });
    expect(t.state).toEqual({ kind: 'idle', conversation: 'daily journal' });
    expect(kinds(t.effects)).toEqual(['render']);
  });
  it('is ignored mid-conversation (no switching during recording/thinking/etc.)', () => {
    for (const state of [recording, transcribing, thinking, displaying, error]) {
      const t = reduce(state, { kind: 'set_conversation', conversation: 'other' });
      expect(t.state).toBe(state);
      expect(t.effects).toEqual([]);
    }
  });
});

describe('reduce — interrupt gestures', () => {
  it('TAP in transcribing aborts and returns to idle', () => {
    const t = reduce(transcribing, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('idle');
    expect(kinds(t.effects)).toEqual(['abort_inflight', 'render']);
  });
  it('TAP in thinking aborts and returns to idle', () => {
    const t = reduce(thinking, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('idle');
    expect(kinds(t.effects)).toEqual(['abort_inflight', 'render']);
  });
  it('TAP in displaying-streaming aborts the stream AND starts a new utterance', () => {
    const streaming: State = { kind: 'displaying', conversation: CONV, transcript: 'q', reply: 'partial', streaming: true, toolLabel: null, scrollOffset: 0 };
    const t = reduce(streaming, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('recording');
    expect(kinds(t.effects)).toEqual(['abort_inflight', 'mic_on', 'render']);
  });
  it('TAP in displaying-done just starts a new utterance (no abort needed)', () => {
    const t = reduce(displaying, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('recording');
    expect(kinds(t.effects)).toEqual(['mic_on', 'render']);
  });
});

describe('reduce — thinking', () => {
  it('hermes_ok moves to displaying with both transcript and reply', () => {
    const t = reduce(thinking, { kind: 'hermes_ok', text: 'hi back' });
    expect(t.state.kind).toBe('displaying');
    if (t.state.kind === 'displaying') {
      expect(t.state.transcript).toBe('hello');
      expect(t.state.reply).toBe('hi back');
    }
    expect(kinds(t.effects)).toEqual(['render']);
  });
  it('hermes_err preserves the transcript for retry', () => {
    const t = reduce(thinking, { kind: 'hermes_err', message: 'http 500' });
    expect(t.state.kind).toBe('error');
    if (t.state.kind === 'error') {
      expect(t.state.message).toBe('http 500');
      expect(t.state.lastTranscript).toBe('hello');
    }
  });
  it('SCROLL_UP aborts and goes to idle/new', () => {
    const t = reduce(thinking, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state.kind).toBe('idle');
    expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'new_conversation', 'render']);
  });
});

describe('reduce — displaying', () => {
  it('TAP starts the next recording', () => {
    const t = reduce(displaying, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('recording');
    expect(kinds(t.effects)).toEqual(['mic_on', 'render']);
  });
  it('SCROLL_UP on a short reply is a no-op (spec: scroll gestures are repurposed in displaying)', () => {
    // Reply "hi back" is shorter than the scroll threshold, so SCROLL_UP does nothing.
    const t = reduce(displaying, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state).toBe(displaying);
    expect(t.effects).toEqual([]);
  });
});

describe('reduce — error', () => {
  it('TAP retries the send when lastTranscript is set', () => {
    const e: State = { kind: 'error', conversation: CONV, message: 'http 500', lastTranscript: 'hello again' };
    const t = reduce(e, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('thinking');
    if (t.state.kind === 'thinking') expect(t.state.transcript).toBe('hello again');
    expect(kinds(t.effects)).toEqual(['send', 'render']);
  });
  it('TAP without a lastTranscript returns to idle', () => {
    const t = reduce(error, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state.kind).toBe('idle');
  });
});

describe('reduce — disconnected', () => {
  it('any gesture is ignored except DOUBLE_CLICK', () => {
    const t = reduce(disconnected, { kind: 'gesture', gesture: 'TAP' });
    expect(t.state).toBe(disconnected);
    expect(t.effects).toEqual([]);
  });
  it('DOUBLE_CLICK still triggers exit_confirm', () => {
    const t = reduce(disconnected, { kind: 'gesture', gesture: 'DOUBLE_CLICK' });
    expect(kinds(t.effects)).toEqual(['exit_confirm']);
  });
  it('device_reconnected returns to home with reload', () => {
    const t = reduce(disconnected, { kind: 'device_reconnected' });
    expect(t.state.kind).toBe('home');
    expect(kinds(t.effects)).toEqual(['reload_history', 'render']);
  });
});

describe('reduce — universal device_disconnected', () => {
  const states = { idle, recording, transcribing, thinking, displaying, error };
  for (const name of Object.keys(states) as Array<keyof typeof states>) {
    it(`from ${name} → disconnected`, () => {
      const t = reduce(states[name], { kind: 'device_disconnected' });
      expect(t.state.kind).toBe('disconnected');
      expect(kinds(t.effects)).toEqual(['mic_off', 'abort_inflight', 'render']);
    });
  }
});

describe('reduce — streaming', () => {
  it('thinking + hermes_delta → displaying with streaming:true and reply seeded', () => {
    const t = reduce(thinking, { kind: 'hermes_delta', text: 'Hel' });
    expect(t.state.kind).toBe('displaying');
    if (t.state.kind === 'displaying') {
      expect(t.state.reply).toBe('Hel');
      expect(t.state.streaming).toBe(true);
      expect(t.state.transcript).toBe('hello');
      expect(t.state.toolLabel).toBeNull();
    }
    expect(kinds(t.effects)).toEqual(['render']);
  });

  it('thinking + hermes_tool sets toolLabel and stays in thinking', () => {
    const t = reduce(thinking, { kind: 'hermes_tool', label: 'searching' });
    expect(t.state.kind).toBe('thinking');
    if (t.state.kind === 'thinking') expect(t.state.toolLabel).toBe('searching');
    expect(kinds(t.effects)).toEqual(['render']);
  });

  it('thinking carries toolLabel into the streaming displaying state on first delta', () => {
    const withTool: State = { ...thinking, toolLabel: 'searching' };
    const t = reduce(withTool, { kind: 'hermes_delta', text: 'ok' });
    if (t.state.kind === 'displaying') {
      expect(t.state.toolLabel).toBe('searching');
      expect(t.state.streaming).toBe(true);
    }
  });

  it('displaying{streaming:true} + hermes_delta grows reply', () => {
    const streaming: State = { kind: 'displaying', conversation: CONV, transcript: 'hi', reply: 'Hel', streaming: true, toolLabel: null, scrollOffset: 0 };
    const t = reduce(streaming, { kind: 'hermes_delta', text: 'lo' });
    if (t.state.kind === 'displaying') {
      expect(t.state.reply).toBe('Hello');
      expect(t.state.streaming).toBe(true);
    }
  });

  it('displaying{streaming:true} + hermes_tool updates toolLabel', () => {
    const streaming: State = { kind: 'displaying', conversation: CONV, transcript: 'hi', reply: 'a', streaming: true, toolLabel: null, scrollOffset: 0 };
    const t = reduce(streaming, { kind: 'hermes_tool', label: 'reading' });
    if (t.state.kind === 'displaying') expect(t.state.toolLabel).toBe('reading');
  });

  it('displaying{streaming:true} + hermes_ok finalizes with streaming:false and clears toolLabel', () => {
    const streaming: State = { kind: 'displaying', conversation: CONV, transcript: 'hi', reply: 'a', streaming: true, toolLabel: 'searching', scrollOffset: 0 };
    const t = reduce(streaming, { kind: 'hermes_ok', text: 'all done' });
    if (t.state.kind === 'displaying') {
      expect(t.state.streaming).toBe(false);
      expect(t.state.reply).toBe('all done');
      expect(t.state.toolLabel).toBeNull();
    }
  });

  it('displaying{streaming:true} + hermes_err goes to error preserving transcript', () => {
    const streaming: State = { kind: 'displaying', conversation: CONV, transcript: 'hi', reply: 'a', streaming: true, toolLabel: null, scrollOffset: 0 };
    const t = reduce(streaming, { kind: 'hermes_err', message: 'http 500' });
    expect(t.state.kind).toBe('error');
    if (t.state.kind === 'error') {
      expect(t.state.message).toBe('http 500');
      expect(t.state.lastTranscript).toBe('hi');
    }
  });

  it('displaying{streaming:false} ignores hermes_delta and hermes_tool', () => {
    expect(reduce(displaying, { kind: 'hermes_delta', text: 'x' }).state).toBe(displaying);
    expect(reduce(displaying, { kind: 'hermes_tool', label: 'reading' }).state).toBe(displaying);
  });

  it('thinking + hermes_ok (non-streaming path) still works and clears toolLabel', () => {
    const withTool: State = { ...thinking, toolLabel: 'searching' };
    const t = reduce(withTool, { kind: 'hermes_ok', text: 'hi back' });
    expect(t.state.kind).toBe('displaying');
    if (t.state.kind === 'displaying') {
      expect(t.state.streaming).toBe(false);
      expect(t.state.toolLabel).toBeNull();
      expect(t.state.reply).toBe('hi back');
    }
  });
});

describe('reduce — scroll gestures in displaying', () => {
  const longReply = 'x'.repeat(1500);
  const longDone: State = {
    kind: 'displaying', conversation: CONV, transcript: 'q',
    reply: longReply, streaming: false, toolLabel: null, scrollOffset: 0,
  };

  it('SCROLL_UP on a scrollable reply increases scrollOffset by SCROLL_STEP_CHARS', () => {
    const t = reduce(longDone, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state.kind).toBe('displaying');
    if (t.state.kind === 'displaying') expect(t.state.scrollOffset).toBe(300);
    expect(kinds(t.effects)).toEqual(['render']);
  });

  it('SCROLL_UP clamps to (reply.length - VISIBLE_CHARS)', () => {
    // 1500 - 950 = 550 max
    const near: State = { ...longDone, scrollOffset: 500 };
    const t = reduce(near, { kind: 'gesture', gesture: 'SCROLL_UP' });
    if (t.state.kind === 'displaying') expect(t.state.scrollOffset).toBe(550);
  });

  it('SCROLL_UP at the max offset is a no-op', () => {
    const atMax: State = { ...longDone, scrollOffset: 550 };
    const t = reduce(atMax, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state).toBe(atMax);
    expect(t.effects).toEqual([]);
  });

  it('SCROLL_DOWN decreases scrollOffset by SCROLL_STEP_CHARS', () => {
    const mid: State = { ...longDone, scrollOffset: 400 };
    const t = reduce(mid, { kind: 'gesture', gesture: 'SCROLL_DOWN' });
    if (t.state.kind === 'displaying') expect(t.state.scrollOffset).toBe(100);
  });

  it('SCROLL_DOWN clamps to 0', () => {
    const t = reduce(longDone, { kind: 'gesture', gesture: 'SCROLL_DOWN' });
    expect(t.state).toBe(longDone);
    expect(t.effects).toEqual([]);
  });

  it('SCROLL_DOWN on a non-scrollable reply is a no-op', () => {
    const short: State = { ...longDone, reply: 'short', scrollOffset: 0 };
    const t = reduce(short, { kind: 'gesture', gesture: 'SCROLL_DOWN' });
    expect(t.state).toBe(short);
    expect(t.effects).toEqual([]);
  });

  it('SCROLL_UP during streaming is ignored (scroll only after reply finalizes)', () => {
    const midStream: State = { ...longDone, streaming: true };
    const t = reduce(midStream, { kind: 'gesture', gesture: 'SCROLL_UP' });
    expect(t.state).toBe(midStream);
    expect(t.effects).toEqual([]);
  });

  it('a new hermes_ok resets scrollOffset back to 0', () => {
    const scrolled: State = { ...longDone, scrollOffset: 400 };
    // Simulate the next round-trip arriving via thinking → displaying.
    const t = reduce({ kind: 'thinking', conversation: CONV, transcript: 'q2', toolLabel: null },
      { kind: 'hermes_ok', text: 'new reply' });
    if (t.state.kind === 'displaying') expect(t.state.scrollOffset).toBe(0);
    // Reference scrolled so the linter doesn't complain about unused.
    expect(scrolled.scrollOffset).toBe(400);
  });
});

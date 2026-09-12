import { describe, it, expect, vi } from 'vitest';
import { loadHistory, appendTurn, turnsFor, MAX_TURNS, type TurnEntry } from './history';
import type { StorageLike } from '../config';

function makeStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getLocalStorage: vi.fn(async (k: string) => store.get(k) ?? ''),
    setLocalStorage: vi.fn(async (k: string, v: string) => { store.set(k, v); return true; }),
  };
}

const turn = (i: number, conversation = 'daily'): TurnEntry => ({
  conversation,
  transcript: `q${i}`,
  reply: `a${i}`,
  ts: 1_000_000 + i,
  source: 'glasses',
});

describe('loadHistory', () => {
  it('returns empty when storage is empty', async () => {
    expect(await loadHistory(makeStorage())).toEqual([]);
  });

  it('returns empty when stored value is not JSON', async () => {
    expect(await loadHistory(makeStorage({ 'history.turns': '{not json' }))).toEqual([]);
  });

  it('returns empty when stored value is not an array', async () => {
    expect(await loadHistory(makeStorage({ 'history.turns': '{"x":1}' }))).toEqual([]);
  });

  it('filters out entries with the wrong shape', async () => {
    const stored = JSON.stringify([
      turn(1),
      { conversation: 'a', transcript: 'q', reply: 'r', ts: 'no', source: 'glasses' }, // bad ts
      { conversation: 'a' }, // partial
      turn(2),
    ]);
    const out = await loadHistory(makeStorage({ 'history.turns': stored }));
    expect(out.map((t) => t.transcript)).toEqual(['q1', 'q2']);
  });
});

describe('appendTurn', () => {
  it('appends and persists in chronological order', async () => {
    const s = makeStorage();
    await appendTurn(s, turn(1));
    await appendTurn(s, turn(2));
    const out = await loadHistory(s);
    expect(out.map((t) => t.transcript)).toEqual(['q1', 'q2']);
  });

  it('drops the oldest turn once MAX_TURNS is exceeded', async () => {
    const s = makeStorage();
    const seed = JSON.stringify(Array.from({ length: MAX_TURNS }, (_, i) => turn(i)));
    s.store.set('history.turns', seed);
    await appendTurn(s, turn(MAX_TURNS));
    const out = await loadHistory(s);
    expect(out.length).toBe(MAX_TURNS);
    expect(out[0].transcript).toBe('q1');
    expect(out[out.length - 1].transcript).toBe(`q${MAX_TURNS}`);
  });
});

describe('turnsFor', () => {
  it('filters by conversation and returns most-recent-first', () => {
    const all: TurnEntry[] = [
      turn(1, 'daily'),
      turn(2, 'work'),
      turn(3, 'daily'),
      turn(4, 'daily'),
    ];
    expect(turnsFor(all, 'daily').map((t) => t.transcript)).toEqual(['q4', 'q3', 'q1']);
  });

  it('returns empty for a conversation with no turns', () => {
    expect(turnsFor([turn(1, 'daily')], 'work')).toEqual([]);
  });
});

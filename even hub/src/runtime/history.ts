import type { StorageLike } from '../config';

export type TurnEntry = {
  conversation: string;
  transcript: string;
  reply: string;
  ts: number;       // Date.now() at the time hermes_ok finalized
  source: 'glasses' // glasses-local only for now; cloud-sourced turns will use 'hermes' later
};

export const HISTORY_KEY = 'history.turns';
// Hard cap so localStorage doesn't grow unbounded. 200 turns ≈ a few months of
// occasional use even with verbose replies.
export const MAX_TURNS = 200;

export async function loadHistory(storage: StorageLike): Promise<TurnEntry[]> {
  const raw = await storage.getLocalStorage(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTurn);
  } catch {
    return [];
  }
}

export async function appendTurn(storage: StorageLike, turn: TurnEntry): Promise<TurnEntry[]> {
  const existing = await loadHistory(storage);
  // Drop the oldest if we'd exceed the cap. Single-element shift is fine at N=200.
  const next = [...existing, turn].slice(-MAX_TURNS);
  await storage.setLocalStorage(HISTORY_KEY, JSON.stringify(next));
  return next;
}

// Most-recent-first list for a single conversation. Other conversations are filtered out.
export function turnsFor(turns: TurnEntry[], conversation: string): TurnEntry[] {
  return turns
    .filter((t) => t.conversation === conversation)
    .slice()
    .reverse();
}

function isValidTurn(x: unknown): x is TurnEntry {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.conversation === 'string' &&
    typeof t.transcript === 'string' &&
    typeof t.reply === 'string' &&
    typeof t.ts === 'number' &&
    (t.source === 'glasses' || t.source === 'hermes')
  );
}

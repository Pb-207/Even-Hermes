import { describe, it, expect, vi } from 'vitest'
import { loadConfig, saveConfig, isConfigured, trimTrailingSlash, parseLabels, serializeLabels, type AppConfig, type StorageLike } from './config'

function makeStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    getLocalStorage: vi.fn(async (k: string) => store.get(k) ?? ''),
    setLocalStorage: vi.fn(async (k: string, v: string) => { store.set(k, v); return true }),
  }
}

describe('trimTrailingSlash', () => {
  it('removes a single trailing slash', () => {
    expect(trimTrailingSlash('http://x/')).toBe('http://x')
  })
  it('removes multiple trailing slashes', () => {
    expect(trimTrailingSlash('http://x///')).toBe('http://x')
  })
  it('leaves no-trailing-slash unchanged', () => {
    expect(trimTrailingSlash('http://x')).toBe('http://x')
  })
})

describe('loadConfig', () => {
  it('returns env fallbacks (or empty) + defaults when storage is empty', async () => {
    const s = makeStorage()
    const c = await loadConfig(s)
    // 发布安全:构建期 env 注入已移除,所有字段都来自手机配置页 → 空存储时全为空串
    expect(typeof c.hermes.baseUrl).toBe('string')
    expect(c.hermes.apiKey).toBe('')
    expect(c.hermes.model).toBe('')
    expect(c.stt.model).toBe('')
    expect(c.session.lastName).toBe('')
  })

  it('honors stored values and overrides defaults', async () => {
    const s = makeStorage({
      'hermes.baseUrl': 'http://1.2.3.4:8642/',  // trailing slash
      'hermes.apiKey': 'k1',
      'hermes.model': 'custom-model',
      'stt.baseUrl': 'http://1.2.3.4:8000',
      'stt.apiKey': 'k2',
      'stt.model': 'whisper-large',
      'session.lastName': 'g2-prev',
    })
    const c = await loadConfig(s)
    expect(c.hermes.baseUrl).toBe('http://1.2.3.4:8642')   // trimmed
    expect(c.hermes.apiKey).toBe('k1')
    expect(c.hermes.model).toBe('custom-model')             // override sticks
    expect(c.stt.model).toBe('whisper-large')
    expect(c.session.lastName).toBe('g2-prev')
  })
})

describe('saveConfig', () => {
  it('writes all fields, trimming trailing slashes', async () => {
    const s = makeStorage()
    const cfg: AppConfig = {
      hermes: { baseUrl: 'http://x:1//', apiKey: 'k', model: 'm', instructions: 'be brief' },
      stt: { baseUrl: 'http://y:2/', apiKey: 'k2', model: 'whisper-1' },
      session: { lastName: 'g2-2026-05-22-01', labels: [] },
    }
    await saveConfig(s, cfg)
    expect(s.store.get('hermes.baseUrl')).toBe('http://x:1')
    expect(s.store.get('stt.baseUrl')).toBe('http://y:2')
    expect(s.store.get('hermes.instructions')).toBe('be brief')
    expect(s.store.get('session.lastName')).toBe('g2-2026-05-22-01')
  })
})

describe('parseLabels / serializeLabels', () => {
  it('trims blank lines and whitespace', () => {
    expect(parseLabels('  daily journal  \n\n work \n  ')).toEqual(['daily journal', 'work']);
  });
  it('returns empty array on empty input', () => {
    expect(parseLabels('')).toEqual([]);
  });
  it('round-trips through serialize', () => {
    expect(parseLabels(serializeLabels(['a', 'b']))).toEqual(['a', 'b']);
  });
});

describe('isConfigured', () => {
  it('is false when any required field is empty', () => {
    const c: AppConfig = {
      hermes: { baseUrl: '', apiKey: 'k', model: 'm', instructions: '' },
      stt: { baseUrl: 'http://y', apiKey: 'k', model: 'whisper-1' },
      session: { lastName: '', labels: [] },
    }
    expect(isConfigured(c)).toBe(false)
  })
  it('is true when all six required fields are present', () => {
    const c: AppConfig = {
      hermes: { baseUrl: 'http://x', apiKey: 'k', model: 'm', instructions: '' },
      stt: { baseUrl: 'http://y', apiKey: 'k', model: 'whisper-1' },
      session: { lastName: '', labels: [] },
    }
    expect(isConfigured(c)).toBe(true)
  })
})

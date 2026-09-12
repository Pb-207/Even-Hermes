export type AppConfig = {
  hermes: { baseUrl: string; apiKey: string; model: string; instructions: string }
  stt: { baseUrl: string; apiKey: string; model: string }
  session: { lastName: string; labels: string[] }
  lang?: 'zh' | 'en'
}

export type StorageLike = {
  getLocalStorage: (key: string) => Promise<string>
  setLocalStorage: (key: string, value: string) => Promise<boolean>
}

const KEYS = {
  HERMES_BASE_URL: 'hermes.baseUrl',
  HERMES_API_KEY: 'hermes.apiKey',
  HERMES_MODEL: 'hermes.model',
  HERMES_INSTRUCTIONS: 'hermes.instructions',
  STT_BASE_URL: 'stt.baseUrl',
  STT_API_KEY: 'stt.apiKey',
  STT_MODEL: 'stt.model',
  SESSION_LAST_NAME: 'session.lastName',
  SESSION_LABELS: 'session.labels',
  UI_LANG: 'ui.lang',
} as const

export function parseLabels(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function serializeLabels(labels: string[]): string {
  return labels.join('\n')
}

export function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

export async function loadConfig(storage: StorageLike): Promise<AppConfig> {
  const g = (k: string) => storage.getLocalStorage(k)
  const [hUrl, hKey, hModel, hInst, sUrl, sKey, sModel, sLast, sLabels, uiLang] = await Promise.all([
    g(KEYS.HERMES_BASE_URL), g(KEYS.HERMES_API_KEY), g(KEYS.HERMES_MODEL), g(KEYS.HERMES_INSTRUCTIONS),
    g(KEYS.STT_BASE_URL),    g(KEYS.STT_API_KEY),    g(KEYS.STT_MODEL),    g(KEYS.SESSION_LAST_NAME),
    g(KEYS.SESSION_LABELS),  g(KEYS.UI_LANG),
  ])
  return {
    hermes: {
      baseUrl: trimTrailingSlash(hUrl),
      apiKey: hKey,
      model: hModel,
      instructions: hInst,
    },
    stt: {
      baseUrl: trimTrailingSlash(sUrl),
      apiKey: sKey,
      model: sModel,
    },
    session: { lastName: sLast, labels: parseLabels(sLabels) },
    lang: uiLang === 'en' ? 'en' : 'zh',
  }
}

export async function saveConfig(storage: StorageLike, c: AppConfig): Promise<void> {
  await Promise.all([
    storage.setLocalStorage(KEYS.HERMES_BASE_URL, trimTrailingSlash(c.hermes.baseUrl)),
    storage.setLocalStorage(KEYS.HERMES_API_KEY, c.hermes.apiKey),
    storage.setLocalStorage(KEYS.HERMES_MODEL, c.hermes.model),
    storage.setLocalStorage(KEYS.HERMES_INSTRUCTIONS, c.hermes.instructions),
    storage.setLocalStorage(KEYS.STT_BASE_URL, trimTrailingSlash(c.stt.baseUrl)),
    storage.setLocalStorage(KEYS.STT_API_KEY, c.stt.apiKey),
    storage.setLocalStorage(KEYS.STT_MODEL, c.stt.model),
    storage.setLocalStorage(KEYS.SESSION_LAST_NAME, c.session.lastName),
    storage.setLocalStorage(KEYS.SESSION_LABELS, serializeLabels(c.session.labels)),
    storage.setLocalStorage(KEYS.UI_LANG, c.lang === 'en' ? 'en' : 'zh'),
  ])
}

export function isConfigured(c: AppConfig): boolean {
  return Boolean(
    c.hermes.baseUrl && c.hermes.apiKey && c.hermes.model &&
    c.stt.baseUrl && c.stt.apiKey && c.stt.model,
  )
}

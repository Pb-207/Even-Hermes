/**
 * DEV-ONLY demo helpers — 用于在 EvenHub 模拟器里驱动出「根目录 / 会话列表 / 回复页」三个画面,
 * 以便用模拟器的 /api/screenshot/glasses 抓取**原始**截图(官方要求:未加工的原始截图)。
 *
 * 只在 `import.meta.env.DEV` 且 URL 带 `?demo=1` 时生效,生产构建中会被摇树剔除。
 */
import { saveConfig, type StorageLike } from './config'

export const MOCK_BASE = 'http://127.0.0.1:8799'

export function isDemoMode(): boolean {
  try {
    return new URLSearchParams(location.search).has('demo')
  } catch {
    return false
  }
}

/** 预置一份指向本地 mock 网关的配置,免得在模拟器里手填表单。 */
export async function seedDemoConfig(storage: StorageLike): Promise<void> {
  await saveConfig(storage, {
    hermes: { baseUrl: MOCK_BASE, apiKey: 'demo', model: 'demo-model', instructions: '' },
    stt: { baseUrl: MOCK_BASE, apiKey: 'demo', model: 'demo' },
    session: { lastName: 'demo', labels: ['demo'] },
    lang: 'zh',
  })
  console.log('[demo] seeded config ->', MOCK_BASE)
}

/** 自动发一条演示消息,好让眼镜进入「回复页」并显示 thinking/流式。 */
export const DEMO_REQUEST = 'summarise my last three experiment notes'

export function scheduleDemoSend(send: (text: string) => void, delayMs = 20000): void {
  console.log('[demo] auto-send scheduled in', delayMs, 'ms')
  setTimeout(() => {
    console.log('[demo] auto-send now')
    send(DEMO_REQUEST)
  }, delayMs)
}

// Browser-dev shim: when no Even companion app is hosting us, fall back to a
// localStorage-backed mock bridge so the setup view renders and the Test
// buttons can hit a real Hermes / STT server. Glasses-driving calls
// (createStartUpPageContainer, textContainerUpgrade, audioControl, etc.) are
// no-ops that just log to the console.
//
// In production builds (`import.meta.env.DEV === false`) this module is
// imported but never used — `main.ts` skips the race entirely.

import { waitForEvenAppBridge, EvenAppBridge } from '@evenrealities/even_hub_sdk'

const DEV_MOCK_TIMEOUT_MS = 12000
const STORAGE_PREFIX = 'hermes-even.mock.'

function makeMockBridge(): EvenAppBridge {
  const store = typeof window !== 'undefined' ? window.localStorage : null

  const noop = () => () => {}

  const mock = {
    getLocalStorage: async (k: string): Promise<string> => {
      return store?.getItem(STORAGE_PREFIX + k) ?? ''
    },
    setLocalStorage: async (k: string, v: string): Promise<boolean> => {
      store?.setItem(STORAGE_PREFIX + k, v)
      return true
    },
    getUserInfo: async () => ({ uid: 0, name: 'dev', avatar: '', country: 'US' }),
    getDeviceInfo: async () => null,
    createStartUpPageContainer: async (...args: unknown[]) => {
      console.log('[mock-bridge] createStartUpPageContainer', args[0])
      return 0
    },
    rebuildPageContainer: async (...args: unknown[]) => {
      console.log('[mock-bridge] rebuildPageContainer', args[0])
      return true
    },
    textContainerUpgrade: async (payload: unknown) => {
      console.log('[mock-bridge] textContainerUpgrade', payload)
      return true
    },
    updateImageRawData: async (payload: unknown) => {
      console.log('[mock-bridge] updateImageRawData', payload)
      return 'success'
    },
    shutDownPageContainer: async (mode?: number) => {
      console.log('[mock-bridge] shutDownPageContainer', mode)
      if (mode === 1 && typeof window !== 'undefined') {
        window.confirm('Mock bridge: exit?')
      }
      return true
    },
    onLaunchSource: noop,
    onDeviceStatusChanged: noop,
    onEvenHubEvent: noop,
    audioControl: async (isOpen: boolean) => {
      console.log('[mock-bridge] audioControl', isOpen)
      return true
    },
    imuControl: async (isOpen: boolean, pace?: unknown) => {
      console.log('[mock-bridge] imuControl', isOpen, pace)
      return true
    },
    callEvenApp: async (method: string, params?: unknown) => {
      console.log('[mock-bridge] callEvenApp', method, params)
      return null
    },
  }

  return mock as unknown as EvenAppBridge
}


/** DEV-only 假麦克风:模拟器不发麦克风数据。`?fakemic=1` 时按 100ms 推 1600 样点。 */
function withFakeMic(bridge: EvenAppBridge): EvenAppBridge {
  const listeners: Array<(e: unknown) => void> = []
  let timer: ReturnType<typeof setInterval> | null = null
  console.log('[dev] fake mic enabled')
  return new Proxy(bridge, {
    get(target, prop, recv) {
      if (prop === 'onEvenHubEvent') {
        return (cb: (e: unknown) => void) => {
          listeners.push(cb)
          return (target as unknown as { onEvenHubEvent: (c: unknown) => () => void }).onEvenHubEvent(cb)
        }
      }
      if (prop === 'audioControl') {
        return async (open: boolean) => {
          const r = await (target as unknown as { audioControl: (o: boolean) => Promise<boolean> }).audioControl(open)
          if (open) {
            if (!timer) timer = setInterval(() => {
              const frame = new Array(3200).fill(0)
              for (const cb of listeners) cb({ audioEvent: { audioPcm: frame } })
            }, 100)
          } else if (timer) { clearInterval(timer); timer = null }
          return r
        }
      }
      const v = Reflect.get(target, prop, recv)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

export async function getBridgeWithDevFallback(): Promise<EvenAppBridge> {
  if (!import.meta.env.DEV) {
    return waitForEvenAppBridge()
  }
  // 模拟器等宿主里单例可能已经就绪:优先直接取,避免 race 超时后误用 mock bridge
  try {
    const inst = EvenAppBridge.getInstance()
    if (inst && typeof inst.createStartUpPageContainer === 'function') {
      console.log('[dev] using the initialized EvenAppBridge singleton')
      const fm = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fakemic') === '1'
      return fm ? withFakeMic(inst) : inst
    }
  } catch (err) {
    console.log('[dev] EvenAppBridge.getInstance() unavailable:', String(err))
  }
  return Promise.race([
    waitForEvenAppBridge(),
    new Promise<EvenAppBridge>((resolve) => {
      setTimeout(() => {
        console.warn(`[dev] no Even host detected within ${DEV_MOCK_TIMEOUT_MS} ms — using mock bridge`)
        resolve(makeMockBridge())
      }, DEV_MOCK_TIMEOUT_MS)
    }),
  ])
}

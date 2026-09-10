import { loadConfig, isConfigured } from './config'
import { renderSetupView } from './setup-view'
import { startRuntime } from './runtime/runtime'
import { getBridgeWithDevFallback } from './dev-bridge'

async function boot(): Promise<void> {
  const bridge = await getBridgeWithDevFallback()

  // 运行时提示页:始终带「Configure / 配置」按钮(否则保存启动后按钮会消失)
  const mountShim = (): void => {
    const app = document.getElementById('app')
    if (!app) return
    app.innerHTML = `
    <main class="runtime-shim">
      Glasses runtime active. See your G2.
      <br /><button id="reconfigure">Configure / 配置</button>
    </main>
  `
    document.getElementById('reconfigure')?.addEventListener('click', () => { void openSetup() })
  }

  // 保存并启动:沿用旧流程(shim + startRuntime);不做页面重载
  const onLaunch = async (): Promise<void> => {
    const reloaded = await loadConfig(bridge)
    mountShim()
    await startRuntime({ bridge, config: reloaded })
  }

  const openSetup = async (): Promise<void> => {
    await renderSetupView({ storage: bridge, onLaunch })
  }

  const config = await loadConfig(bridge)
  if (!isConfigured(config)) {
    await openSetup()
    return
  }

  mountShim()
  await startRuntime({ bridge, config })
}

boot().catch((err) => {
  console.error('[boot] fatal:', err)
  const root = document.getElementById('app')
  if (root) root.innerHTML = `<main class="runtime-shim">⚠ ${String(err)}</main>`
})

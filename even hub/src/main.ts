import { loadConfig, isConfigured } from './config'
import { renderSetupView } from './setup-view'
import { startRuntime } from './runtime/runtime'
import { getBridgeWithDevFallback } from './dev-bridge'
import { createStartupPage, sleep, STARTUP_DWELL_MS } from './startup-page'

async function boot(): Promise<void> {
  const bridge = await getBridgeWithDevFallback()

  // 官方要求:app 启动后眼镜上必须「立刻」有渲染(哪怕一闪),不能黑屏。
  // 先创建启动页;runtime 稍后复用同一批容器直接渲染,不会重复建页。
  const pageCreated = await createStartupPage(bridge)

  // 让启动页在眼镜上**看得见**:停留时间从建页开始计时,与下面的读配置并行。
  // 未配置时会停在启动页(提示去手机端),配置好则由 runtime 接管同一批容器。
  const dwell = pageCreated ? sleep(STARTUP_DWELL_MS) : Promise.resolve()

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
    await startRuntime({ bridge, config: reloaded, pageCreated })
  }

  const openSetup = async (): Promise<void> => {
    await renderSetupView({ storage: bridge, onLaunch })
  }

  // DEV-ONLY:模拟器演示模式(?demo=1)预置一份指向本地 mock 网关的配置,便于抓原始截图
  if (import.meta.env.DEV) {
    const demo = await import('./dev-demo')
    if (demo.isDemoMode()) await demo.seedDemoConfig(bridge)
  }

  const config = await loadConfig(bridge)
  if (!isConfigured(config)) {
    await openSetup()
    return
  }

  mountShim()
  await dwell
  await startRuntime({ bridge, config, pageCreated })
}

boot().catch((err) => {
  console.error('[boot] fatal:', err)
  const root = document.getElementById('app')
  if (root) root.innerHTML = `<main class="runtime-shim">⚠ ${String(err)}</main>`
})

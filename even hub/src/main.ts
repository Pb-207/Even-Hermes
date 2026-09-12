import { loadConfig, isConfigured } from './config'
import { renderSetupView } from './setup-view'
import { startRuntime } from './runtime/runtime'
import { getBridgeWithDevFallback } from './dev-bridge'
import { APP_DISPLAY_NAME, STARTUP_DWELL_MS, sleep } from './startup-page'
import { createAnimationPage, playLogoIntro, typeName, waitForStartTap, showMessagePage } from './startup-animation'

/** 提示页文案(启动动画结束后显示,随后进入会话界面) */
const LINES_MESSAGE = [
  'Hermes Lens 已启动,',
  '请在手机上配置。',
  '',
  'Hermes Lens started,',
  'please configure on the phone.',
]

async function boot(): Promise<void> {
  const bridge = await getBridgeWithDevFallback()

  // 官方要求:app 启动后眼镜上必须「立刻」有渲染,不能黑屏。
  // 第一步就建启动动画页(LOGO + 名称),所以首帧一定有内容。
  const pageMode = await createAnimationPage(bridge)

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
    await startRuntime({ bridge, config: reloaded, pageCreated: true })
  }

  const openSetup = async (): Promise<void> => {
    await renderSetupView({ storage: bridge, onLaunch })
  }

  // DEV-ONLY:模拟器演示模式(?demo=1)预置一份指向本地 mock 网关的配置,便于抓原始截图
  if (import.meta.env.DEV) {
    const demo = await import('./dev-demo')
    if (demo.isDemoMode()) await demo.seedDemoConfig(bridge)
  }

  // 读配置与动画并行(只是一次本地读,不会拖慢启动)
  const config = await loadConfig(bridge)
  const configured = isConfigured(config)

  if (pageMode !== 'fail') {
    // 1. LOGO(He -> 头像) 2. 打字机打出名字 3. —— Tap to start —— 闪烁,直到点击
    await playLogoIntro(bridge, pageMode)
    await typeName(bridge)
    await waitForStartTap(bridge)
    // 点击后换成提示页(同一批 runtime 容器布局,LOGO 图像容器随重建一起消失)
    await showMessagePage(bridge, LINES_MESSAGE)
  } else {
    // 建页失败(例如已有页面):退化为只显示提示页,至少不黑屏
    await showMessagePage(bridge, LINES_MESSAGE)
  }

  // 提示页在眼镜上停一会儿,让人看清
  await sleep(STARTUP_DWELL_MS)

  if (!configured) {
    await openSetup()
    return
  }

  mountShim()
  await startRuntime({ bridge, config, pageCreated: true })
}

boot().catch((err) => {
  console.error('[boot] fatal:', err)
  const root = document.getElementById('app')
  if (root) root.innerHTML = `<main class="runtime-shim">⚠ ${String(err)}</main>`
})

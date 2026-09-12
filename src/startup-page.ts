import {
  EvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
} from '@evenrealities/even_hub_sdk'

/**
 * 启动画面(官方要求):app 启动后,眼镜上必须**立刻**有渲染内容——即使只有一瞬间,
 * 用来证明进程正常渲染;并且绝不允许黑屏(尤其是还没配置、需要去手机端设置的时候)。
 *
 * 这里创建的容器与 runtime 使用**完全相同的几何/ID**,因此 runtime 不需要重新建页,
 * 直接往同一批容器里渲染即可(见 startRuntime 的 pageCreated 选项)。
 */

export const APP_DISPLAY_NAME = 'Hermes Lens'

export const STARTUP_MESSAGE = [
  APP_DISPLAY_NAME + ' started.',
  'Please continue on the phone.',
  '',
  '已启动,请在手机上继续。',
].join('\n')

/** status(28px) / main(232px) / footer(28px):合计 288px = G2 画布高度。 */
export function makeLayoutContainers(statusText: string, mainText: string, footerText = ''): TextContainerProperty[] {
  return [
    new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: 28,
      borderWidth: 0, paddingLength: 4,
      containerID: 1, containerName: 'status',
      content: statusText, isEventCapture: 0,
    }),
    new TextContainerProperty({
      xPosition: 0, yPosition: 28, width: 576, height: 232,
      borderWidth: 0, paddingLength: 4,
      containerID: 2, containerName: 'main',
      content: mainText, isEventCapture: 1,
    }),
    new TextContainerProperty({
      xPosition: 0, yPosition: 260, width: 576, height: 28,
      borderWidth: 0, paddingLength: 4,
      containerID: 3, containerName: 'footer',
      content: footerText, isEventCapture: 0,
    }),
  ]
}

/** 创建启动页;返回 true 表示页面已由本函数创建(后续 runtime 会复用它)。 */
export async function createStartupPage(bridge: EvenAppBridge): Promise<boolean> {
  try {
    const containers = makeLayoutContainers(APP_DISPLAY_NAME, STARTUP_MESSAGE)
    const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: containers,
    }))
    if (result !== 0) {
      console.error('[boot] startup page rejected:', result)
      return false
    }
    return true
  } catch (err) {
    console.error('[boot] startup page failed:', err)
    return false
  }
}

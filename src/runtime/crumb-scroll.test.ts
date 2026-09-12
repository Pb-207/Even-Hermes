import { describe, it, expect } from 'vitest'
import { reduce } from './state-machine'
import type { State } from './state-machine'

/** 回归:新建会话(空历史)后上滑,状态栏不能回到根目录。 */
describe('空会话上滑', () => {
  it('滚动不该重置 crumb / desktop(旧实现会落到 scrollUpReset 丢掉它们)', () => {
    const s = {
      kind: 'idle', conversation: 'api_new', desktop: true, crumb: '/Desktop',
      history: [], transcript: 'hello',
    } as unknown as State
    const up = reduce(s, { kind: 'gesture', gesture: 'SCROLL_UP' } as never).state as unknown as { crumb?: string; desktop?: boolean; kind: string }
    expect(up.kind).toBe('idle')
    expect(up.crumb).toBe('/Desktop')
    expect(up.desktop).toBe(true)

    const down = reduce(s, { kind: 'gesture', gesture: 'SCROLL_DOWN' } as never).state as unknown as { crumb?: string }
    expect(down.crumb).toBe('/Desktop')
  })

  it('多页时仍然正常翻页', () => {
    const hist = Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, text: 'line ' + i }))
    const s = { kind: 'idle', conversation: 'api_1', desktop: true, crumb: '/Desktop', history: hist, rowAnchor: null } as unknown as State
    const up = reduce(s, { kind: 'gesture', gesture: 'SCROLL_UP' } as never).state as unknown as { rowAnchor?: number | null }
    expect(typeof up.rowAnchor).toBe('number')
  })
})

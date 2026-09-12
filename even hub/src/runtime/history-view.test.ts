import { describe, it, expect } from 'vitest'
import { viewRows, pageWindow, PAGE_ROWS } from './history-view'
import type { HermesMessage } from './hermes'

const hist: HermesMessage[] = [
  { role: 'user', text: 'earlier question' },
  { role: 'assistant', text: 'earlier answer' },
]

describe('viewRows (history + streaming turn)', () => {
  it('appends the in-flight request and only the revealed part of the reply', () => {
    const rows = viewRows(hist, { transcript: 'what time is it', reply: 'It is 7:42', reveal: 6 })
    const text = rows.join('\n')
    expect(text).toContain('> what time is it')
    expect(text).toContain('Hermes: It is') // reveal 到第 6 个字符
    expect(text).not.toContain('7:42')       // 未揭示的部分不出现
  })

  it('folds tool notes into single meta rows, between request and reply', () => {
    const rows = viewRows(hist, { transcript: 'summarise notes', reply: 'ok', toolNotes: ['thinking', 'running terminal'] })
    expect(rows.filter((r) => r.startsWith('· '))).toEqual(['· [tool] thinking', '· [tool] running terminal'])
    const qi = rows.findIndex((r) => r.includes('summarise notes'))
    const mi = rows.findIndex((r) => r === '· [tool] thinking')
    const ri = rows.findIndex((r) => r.startsWith('Hermes: ok'))
    expect(qi).toBeGreaterThanOrEqual(0)
    expect(mi).toBeGreaterThan(qi)   // 工具行在请求之后
    expect(ri).toBeGreaterThan(mi)   // 回复在工具行之后
  })

  it('keeps one page within one screen (the firmware must never take over scrolling)', () => {
    const many: HermesMessage[] = Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: 'line ' + i }))
    const rows = viewRows(many, {})
    const { pages, start } = pageWindow(rows.length, null)
    expect(pages).toBeGreaterThan(1)
    expect(rows.slice(start, start + PAGE_ROWS).length).toBeLessThanOrEqual(PAGE_ROWS)
  })
})

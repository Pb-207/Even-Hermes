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
    const rows = viewRows(hist, { transcript: 'summarise notes', reply: 'ok', toolMarks: [{ label: 'thinking', at: 0 }, { label: 'running terminal', at: 0 }] })
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

describe('工具行按发生位置插入', () => {
  it('工具→文本→工具→文本:第二条工具行留在两段文本之间', () => {
    const rows = viewRows(undefined, {
      transcript: 'q',
      reply: 'first. second.',
      toolMarks: [{ label: 'a', at: 0 }, { label: 'b', at: 'first. '.length }],
    })
    const i = (n: string) => rows.findIndex((r) => r.includes(n))
    expect(i('· [tool] a')).toBeGreaterThan(-1)
    expect(i('· [tool] a')).toBeLessThan(i('first.'))
    expect(i('first.')).toBeLessThan(i('· [tool] b'))
    expect(i('· [tool] b')).toBeLessThan(i('second.'))
  })
})

describe('录音态:转写行必须最后(否则被旧回复顶出可视页)', () => {
  it('transcriptLast=true 时,转写行排在回复之后', () => {
    const rows = viewRows(undefined, {
      transcript: '今天的实验',
      reply: '这是上一轮的回复,很长很长很长',
      transcriptLast: true,
    })
    const iT = rows.findIndex((r) => r.includes('今天的实验'))
    const iR = rows.findIndex((r) => r.includes('这是上一轮的回复'))
    expect(iT).toBeGreaterThan(iR)
  })
  it('默认(流式/正常)保持 请求 → 回复 的顺序', () => {
    const rows = viewRows(undefined, { transcript: 'q', reply: 'a' })
    expect(rows.findIndex((r) => r.includes('q'))).toBeLessThan(rows.findIndex((r) => r.includes('a')))
  })
})

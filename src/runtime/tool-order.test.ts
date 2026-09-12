import { describe, it, expect } from 'vitest'
import { reduce } from './state-machine'
import { viewRows } from './history-view'
import type { State, ToolMark } from './state-machine'

/** 守住:一轮里「工具→文本→工具→文本」交错时,工具行必须留在它发生的位置。 */
describe('流式工具调用的行序', () => {
  it('工具调用按发生位置插在回复中间,而不是整体提到回复之前', () => {
    let s: State = {
      kind: 'idle', conversation: 'api_1', desktop: true, crumb: '/Desktop/demo',
      history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }],
      streaming: true, transcript: 'summarise my notes', reply: '',
    } as unknown as State

    s = reduce(s, { kind: 'hermes_tool', label: 'running terminal' } as never).state
    s = reduce(s, { kind: 'hermes_delta', text: 'first half. ' } as never).state
    s = reduce(s, { kind: 'hermes_tool', label: 'terminal exited' } as never).state
    s = reduce(s, { kind: 'hermes_tool', label: null } as never).state   // 结束事件应被忽略
    s = reduce(s, { kind: 'hermes_delta', text: 'second half.' } as never).state

    const marks = (s as unknown as { toolMarks?: ToolMark[] }).toolMarks ?? []
    console.log('toolMarks =', JSON.stringify(marks))
    const rows = viewRows((s as unknown as { history?: never[] }).history, {
      transcript: 'summarise my notes',
      reply: (s as unknown as { reply?: string }).reply,
      toolMarks: marks,
    })
    rows.forEach((r, i) => console.log(`  ${i}: ${r}`))

    const i = (n: string) => rows.findIndex((r) => r.includes(n))
    expect(marks.map((m) => m.label)).toEqual(['running terminal', 'terminal exited'])
    expect(marks[0].at).toBe(0)
    expect(marks[1].at).toBe('first half. '.length)
    expect(i('running terminal')).toBeLessThan(i('first half'))
    expect(i('first half')).toBeLessThan(i('terminal exited'))
    expect(i('terminal exited')).toBeLessThan(i('second half'))
    expect(rows.filter((r) => r.startsWith('· ')).length).toBe(2)   // null 不产生行
  })
})

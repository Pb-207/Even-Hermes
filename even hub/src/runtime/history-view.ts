import type { HermesMessage } from './hermes'
import { stripMarkdown } from './markdown-strip'

/**
 * 会话历史页的「整段显示 + 分页」逻辑(纯函数,render 与 state-machine 共用)。
 *
 * 设计要点(都是实机结论):
 * - **不做缩略**:每条消息按完整文本展开成显示行,长行按词折行(续行缩进);
 * - **一页必须装得下**:主容器 232px ≈ 8 行,超过就会被固件接管滚动、SCROLL 手势
 *   不再回到插件手里(那样就没法「滑动 = 翻页」了),所以每页固定 8 行;
 * - **按显示宽度折行**:容器 576px;模拟器里量到的拉丁字宽≈9.5px,但**真机字体更宽**
 *   (模拟器是自行实现的绘制,度量与固件不同):取 54 单位时真机会把最后几个词挤到下一行,
 *   出现「很短的单行」。现在取 **48 单位**,给真机留 ~26% 余量。
 */

/** 每行显示宽度上限(单位:拉丁字母 1、CJK/全角 2) */
export const ROW_UNITS = 48
/** 每页行数(主容器一屏) */
export const PAGE_ROWS = 8

type Row = string

/** 单个码点的显示宽度单位 */
function unitOf(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  return c >= 0x1100 ? 2 : 1 // CJK / 假名 / 韩文 等按 2 单位
}

function unitsOf(s: string): number {
  let n = 0
  for (const ch of s) n += unitOf(ch)
  return n
}

/** 按词折行(按显示宽度);单词本身超宽时按单位硬切。 */
function wrapWords(text: string, widthUnits: number): string[] {
  const out: string[] = []
  let line = ''
  let used = 0
  for (const word of text.split(' ')) {
    const wu = unitsOf(word)
    if (used === 0) {
      line = word
      used = wu
    } else if (used + 1 + wu <= widthUnits) {
      line += ' ' + word
      used += 1 + wu
    } else {
      out.push(line)
      line = word
      used = wu
    }
    while (used > widthUnits) { // 单词自身超宽 → 按单位硬切
      let cut = 0
      let acc = 0
      for (const ch of line) {
        const u = unitOf(ch)
        if (acc + u > widthUnits) break
        acc += u
        cut += ch.length
      }
      out.push(line.slice(0, cut))
      line = line.slice(cut)
      used -= acc
    }
  }
  out.push(line)
  return out
}

/** 单行截断(按显示宽度;超宽截断加 …)。折叠行专用:永不折行。 */
function clampUnits(text: string, width: number): string {
  if (unitsOf(text) <= width) return text
  let acc = 0
  let cut = 0
  for (const ch of text) {
    const u = unitOf(ch)
    if (acc + u > width - 1) break
    acc += u
    cut += ch.length
  }
  return text.slice(0, cut).trimEnd() + '…'
}

/**
 * 把整段会话展开成显示行(不缩略)。
 * 角色前缀只加在消息第一行,续行用等宽空格缩进;消息自身的换行保留。
 */
export function historyRows(h: HermesMessage[] | undefined): Row[] {
  if (!h || !h.length) return []
  const rows: Row[] = []
  for (const m of h) {
    // 工具调用/思考等 meta:像 Desktop 端一样折叠,只占一行(超宽截断,不折行)
    if (m.role === 'meta') {
      const folded = stripMarkdown(String(m.text ?? '')).replace(/\s+/g, ' ').trim()
      if (folded) rows.push('· ' + clampUnits(folded, ROW_UNITS - 2))
      continue
    }
    const prefix = m.role === 'assistant' ? 'Hermes: ' : '> '
    const indent = ' '.repeat(prefix.length)
    const width = Math.max(16, ROW_UNITS - unitsOf(prefix))
    const lines = String(m.text ?? '').replace(/\r/g, '').split('\n')
    let first = true
    for (const rawLine of lines) {
      const text = rawLine.trim()
      if (!text) {
        rows.push('') // 保留空行(段落间隔)
        first = false
        continue
      }
      const wrapped = wrapWords(stripMarkdown(text), width)
      for (let i = 0; i < wrapped.length; i += 1) {
        const head = first && i === 0 ? prefix : indent
        rows.push(head + wrapped[i])
      }
      first = false
    }
  }
  return rows
}

/** 分页:每页 PAGE_ROWS 行,返回 旧→新 的页面数组(空历史 → 一个空页)。 */
export function historyPages(h: HermesMessage[] | undefined): string[] {
  const rows = historyRows(h)
  if (!rows.length) return ['']
  const pages: string[] = []
  for (let i = 0; i < rows.length; i += PAGE_ROWS) {
    pages.push(rows.slice(i, i + PAGE_ROWS).join('\n'))
  }
  return pages
}

/** 总页数 */
export function historyPageCount(h: HermesMessage[] | undefined): number {
  return historyPages(h).length
}

/** 取某页文本;fromEnd = 0 表示最新一页(超出范围自动夹到边界)。 */
export function historyPageText(h: HermesMessage[] | undefined, fromEnd = 0): string {
  const pages = historyPages(h)
  const clamped = Math.max(0, Math.min(pages.length - 1, Math.max(0, Math.floor(fromEnd) || 0)))
  return pages[pages.length - 1 - clamped]
}

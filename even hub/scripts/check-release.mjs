#!/usr/bin/env node
/**
 * 发布前闸门 / Release preflight guard
 *
 * 目的:确保上架 Even Hub 的产物里 **不含任何真实 key,也不含任何真实网址**
 * (插件所有字段都在手机配置页填写)。
 *
 * 检查范围:
 *   - dist/**  (真正打进 .ehpk 的前端产物)
 *   - app.json
 *
 * 失败即退出码 1,不要继续 pack。
 * Usage: node scripts/check-release.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = process.cwd()
const ERRORS = []
const WARN = []

// 允许出现的“占位符/无害”主机名(配置页示例地址、标准命名空间等)
const ALLOWED_HOSTS = [
  'your-hermes-host',
  'your-stt-host',
  'example.com',
  'localhost',
  '127.0.0.1',
  'w3.org',
  'schema.org',
]

const HEX_LONG = /[0-9a-fA-F]{32,}/g          // 长 hex:API key / token 形态
const SK_KEY = /\bsk-[A-Za-z0-9_-]{12,}/g      // OpenAI 风格 key
const URL_RE = /https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function checkText(file, text) {
  const rel = file.replace(ROOT + '/', '')
  for (const m of text.match(HEX_LONG) ?? []) {
    ERRORS.push(`${rel}: 发现长 hex 字符串(${m.slice(0, 6)}…, 长度 ${m.length})——疑似 key/token`)
  }
  for (const m of text.match(SK_KEY) ?? []) {
    ERRORS.push(`${rel}: 发现疑似 API key(${m.slice(0, 8)}…)`)
  }
  for (const m of text.match(URL_RE) ?? []) {
    const host = (() => {
      try { return new URL(m).hostname } catch { return m }
    })()
    const ok = ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))
    if (!ok) ERRORS.push(`${rel}: 发现真实网址 ${m}——发布版不应内置任何网址`)
  }
}

// 1) dist 产物
const distDir = join(ROOT, 'dist')
if (!existsSync(distDir)) {
  WARN.push('dist/ 不存在(请先 build)')
} else {
  const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.txt', '.map'])
  for (const f of walk(distDir)) {
    if (!TEXT_EXT.has(extname(f))) continue
    checkText(f, readFileSync(f, 'utf8'))
  }
}

// 2) app.json(会被打进 ehpk)
const appJson = join(ROOT, 'app.json')
if (!existsSync(appJson)) {
  ERRORS.push('app.json 不存在')
} else {
  checkText(appJson, readFileSync(appJson, 'utf8'))
}

// 3) 额外提示:app.json 里若声明了白名单,发布版会只允许这些域名
try {
  const aj = JSON.parse(readFileSync(appJson, 'utf8'))
  const net = (aj.permissions ?? []).find((p) => p.name === 'network')
  if (net && Array.isArray(net.whitelist) && net.whitelist.length === 0) {
    WARN.push('network.whitelist 为空数组:按 Even 文档,运行时可能拦截所有请求(需真机确认)')
  }
} catch { /* ignore */ }

for (const w of WARN) console.log('WARN  ' + w)
if (ERRORS.length) {
  console.error('\n发布校验失败,已阻止打包:')
  for (const e of ERRORS) console.error('  ✗ ' + e)
  process.exit(1)
}
console.log('OK    发布校验通过:dist/ 与 app.json 中无 key、无真实网址')

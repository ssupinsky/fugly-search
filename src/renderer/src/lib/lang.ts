import hljs from 'highlight.js/lib/core'
import ts from 'highlight.js/lib/languages/typescript'
import js from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import scss from 'highlight.js/lib/languages/scss'
import xml from 'highlight.js/lib/languages/xml'
import md from 'highlight.js/lib/languages/markdown'
import py from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import kotlin from 'highlight.js/lib/languages/kotlin'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'
import ini from 'highlight.js/lib/languages/ini'
import sql from 'highlight.js/lib/languages/sql'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import swift from 'highlight.js/lib/languages/swift'

const reg: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  typescript: ts, javascript: js, json, css, scss, xml, markdown: md, python: py, go, rust, java,
  kotlin, ruby, php, bash, yaml, ini, sql, c, cpp, swift
}
for (const [k, v] of Object.entries(reg)) hljs.registerLanguage(k, v)

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', json: 'json', css: 'css', scss: 'scss', html: 'xml', htm: 'xml', xml: 'xml',
  svg: 'xml', vue: 'xml', md: 'markdown', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  rb: 'ruby', php: 'php', sh: 'bash', zsh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini',
  ini: 'ini', sql: 'sql', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', swift: 'swift'
}

export function langOf(file: string): string | null {
  const base = file.slice(file.lastIndexOf('/') + 1)
  if (base === 'Dockerfile' || base === 'Makefile' || base.startsWith('.env') || base === '.gitignore') return 'bash'
  const i = base.lastIndexOf('.')
  return i < 0 ? null : (EXT[base.slice(i + 1).toLowerCase()] ?? null)
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const cache = new Map<string, string>()
const CAP = 5000

/** Syntax highlight a single line (cached, LRU-ish). */
export function highlightLine(text: string, lang: string | null): string {
  if (!lang) return esc(text)
  const key = lang + '\0' + text
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let out: string
  try {
    out = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    out = esc(text)
  }
  cache.set(key, out)
  if (cache.size > CAP) cache.delete(cache.keys().next().value as string)
  return out
}

/** Highlight a block of lines at once (keeps multi-line state), then split into balanced per-line HTML. */
export function highlightLines(lines: string[], lang: string | null): string[] {
  if (!lang) return lines.map(esc)
  let html: string
  try { html = hljs.highlight(lines.join('\n'), { language: lang, ignoreIllegals: true }).value } catch { return lines.map(esc) }
  const out: string[] = []
  let stack: string[] = []
  for (const raw of html.split('\n')) {
    let line = stack.join('') + raw
    const re = /<(\/?)span([^>]*)>/g
    const st: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) { if (m[1]) st.pop(); else st.push(m[0]) }
    stack = st
    line += '</span>'.repeat(st.length)
    out.push(line)
  }
  return out
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }

/** Wrap [start,end) text ranges in <mark> inside highlighted HTML, closing/reopening around tags. */
export function applyMarks(html: string, ranges: [number, number][], cls = 'm'): string {
  if (!ranges.length) return html
  let out = ''
  let pos = 0
  let ri = 0
  let open = false
  const n = html.length
  for (let i = 0; i < n; ) {
    const ch = html[i]
    if (ch === '<') {
      const j = html.indexOf('>', i)
      if (open) { out += '</mark>'; }
      out += html.slice(i, j + 1)
      if (open) out += `<mark class="${cls}">`
      i = j + 1
      continue
    }
    let len = 1
    let piece = ch
    if (ch === '&') {
      const j = html.indexOf(';', i)
      if (j > 0 && j - i < 8) { piece = html.slice(i, j + 1); len = piece.length; if (!ENT[piece] && !piece.startsWith('&#')) { piece = '&'; len = 1 } }
    }
    while (ri < ranges.length && pos >= ranges[ri][1]) {
      if (open) { out += '</mark>'; open = false }
      ri++
    }
    if (!open && ri < ranges.length && pos >= ranges[ri][0] && pos < ranges[ri][1]) {
      out += `<mark class="${cls}">`
      open = true
    }
    out += piece
    i += len
    pos++
  }
  if (open) out += '</mark>'
  return out
}

export interface Trimmed { text: string; ranges: [number, number][]; prefix: boolean }
/** Window long lines around the first match. */
export function trimLine(text: string, ranges: [number, number][], max = 220): Trimmed {
  const t = text.replace(/^\s+/, (m) => (m.length > 0 ? '' : m))
  const lead = text.length - t.length
  let r = ranges.map(([a, b]) => [Math.max(0, a - lead), Math.max(0, b - lead)] as [number, number])
  let s = t
  let prefix = false
  const first = r[0]?.[0] ?? 0
  if (s.length > max) {
    const start = first > 50 ? first - 40 : 0
    s = s.slice(start, start + max)
    if (start > 0) prefix = true
    r = r.map(([a, b]) => [a - start, b - start] as [number, number]).filter(([a, b]) => b > 0 && a < s.length)
    r = r.map(([a, b]) => [Math.max(0, a), Math.min(s.length, b)] as [number, number])
  }
  return { text: s, ranges: r, prefix }
}

export function splitPath(p: string): { name: string; dir: string } {
  const i = p.lastIndexOf('/')
  return i < 0 ? { name: p, dir: '' } : { name: p.slice(i + 1), dir: p.slice(0, i) }
}

const COLORS: Record<string, string> = {
  ts: '#3b82c4', tsx: '#3b82c4', js: '#d4b73a', jsx: '#d4b73a', mjs: '#d4b73a', json: '#c99a3c', md: '#8a8f99',
  css: '#9b6fd3', scss: '#c6538c', html: '#e0703c', py: '#4a8fd0', go: '#3cb4c9', rs: '#d0703a', java: '#d0703a',
  kt: '#b373d9', rb: '#d04a4a', sh: '#6aab73', yml: '#c77d7d', yaml: '#c77d7d', swift: '#e8643c'
}
export function extInfo(file: string): { label: string; color: string } {
  const base = file.slice(file.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  const ext = i < 0 ? '' : base.slice(i + 1).toLowerCase()
  return { label: (ext || base.slice(0, 2)).slice(0, 3), color: COLORS[ext] ?? '#8a8f99' }
}

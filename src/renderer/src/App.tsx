import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './lib/api'
import type { EditorId, EditorInfo, IndexStatus, SearchMatch, SearchResponse } from '@shared/types'
import { Results } from './components/Results'
import { Preview } from './components/Preview'
import { EditorPicker } from './components/EditorPicker'
import { Welcome } from './components/Welcome'

const MAX = 10000
const ls = {
  get: (k: string, d: string) => { try { return localStorage.getItem('fugly.' + k) ?? d } catch { return d } },
  set: (k: string, v: string) => { try { localStorage.setItem('fugly.' + k, v) } catch { /* ignore */ } }
}
const fmt = (n: number) => n.toLocaleString('en-US')

function useTheme(pref: string | undefined) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const q = new URLSearchParams(location.search + location.hash.replace('#', '&')).get('theme') ?? (pref === 'light' || pref === 'dark' ? pref : null)
    const apply = () => { document.documentElement.dataset.theme = q === 'light' || q === 'dark' ? q : mq.matches ? 'dark' : 'light' }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])
}

function useWindowFocus() {
  const [f, setF] = useState(document.hasFocus())
  useEffect(() => {
    const on = () => setF(true), off = () => setF(false)
    window.addEventListener('focus', on); window.addEventListener('blur', off)
    return () => { window.removeEventListener('focus', on); window.removeEventListener('blur', off) }
  }, [])
  return f
}

export default function App() {
  const [themePref, setThemePref] = useState<string | undefined>()
  useTheme(themePref)
  const [toast, setToast] = useState<string | null>(null)
  const winFocus = useWindowFocus()
  const [status, setStatus] = useState<IndexStatus>({ state: 'idle', files: 0, lines: 0, root: null })
  const [tick, setTick] = useState(0)
  const [recents, setRecents] = useState<string[]>([])
  const [editors, setEditors] = useState<EditorInfo[]>([])
  const [editor, setEditor] = useState<EditorId>('webstorm')
  const [opening, setOpening] = useState(false)
  const [openErr, setOpenErr] = useState<string | null>(null)
  const [booted, setBooted] = useState(false)

  const [query, setQuery] = useState('')
  const [cs, setCs] = useState(ls.get('cs', '0') === '1')
  const [grouped, setGrouped] = useState(ls.get('grouped', '0') === '1')
  const [showPreview, setShowPreview] = useState(ls.get('preview', '1') === '1')
  const [ratio, setRatio] = useState(Math.min(0.75, Math.max(0.15, parseFloat(ls.get('ratio', '0.42')) || 0.42)))
  const [resp, setResp] = useState<SearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [inputFocus, setInputFocus] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)
  const lastKey = useRef('')

  const root = status.root
  const wsName = root ? root.slice(root.lastIndexOf('/') + 1) : ''

  useEffect(() => {
    const off = api.onIndexStatus((s) => { setStatus(s); setTick((t) => t + 1) })
    void (async () => {
      const [s, eds, start] = await Promise.all([api.getSettings(), api.listEditors(), api.getStartupWorkspace()])
      setRecents(s.recentWorkspaces); setEditors(eds); setEditor(s.editor); setThemePref(s.theme)
      if (start) await openWs(start)
      setBooted(true)
    })()
    return off
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openWs = useCallback(async (p: string) => {
    setOpening(true); setOpenErr(null)
    try {
      setQuery(''); setResp(null); setSelected(0)
      const st = await api.openWorkspace(p)
      setStatus((cur) => (cur.root === p ? cur : st))
      setRecents((await api.getSettings()).recentWorkspaces)
    } catch (e) {
      setOpenErr(`Could not open folder: ${(e as Error).message ?? e}`)
    } finally { setOpening(false) }
  }, [])

  const pick = useCallback(async () => {
    const p = await api.pickWorkspace()
    if (p) await openWs(p)
  }, [openWs])

  const run = useCallback(async () => {
    const q = query
    const id = ++reqId.current
    if (!q.trim()) { setResp(null); setSearching(false); setError(null); return }
    setSearching(true)
    try {
      const r = await api.search({ id, query: q, caseSensitive: cs, maxResults: MAX })
      if (id !== reqId.current) return
      setResp(r); setError(null)
      const key = q + '|' + cs
      if (key !== lastKey.current) { setSelected(0); lastKey.current = key }
    } catch (e) {
      if (id !== reqId.current) return
      setError((e as Error).message ?? String(e)); setResp(null)
    } finally { if (id === reqId.current) setSearching(false) }
  }, [query, cs])

  // instant search; re-run as the index fills / settles
  useEffect(() => { if (root) void run() }, [run, root, status.state, status.state === 'indexing' ? Math.floor(status.files / 50) : tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches: SearchMatch[] = useMemo(() => {
    const m = resp?.matches ?? []
    if (!grouped) return m
    const g = new Map<string, SearchMatch[]>()
    for (const x of m) { const a = g.get(x.file); a ? a.push(x) : g.set(x.file, [x]) }
    return [...g.values()].flat()
  }, [resp, grouped])

  const sel = Math.min(selected, Math.max(0, matches.length - 1))
  const current = matches[sel] ?? null

  const open = useCallback((i: number) => {
    const m = matches[i]
    if (!m) return
    api.openInEditor(m.file, m.line, (m.matchRanges[0]?.[0] ?? 0) + 1, editor).then(
      (ok) => { if (!ok) setToast('Could not open file in editor') },
      (e) => setToast(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    )
  }, [matches, editor])

  const changeEditor = (e: EditorId) => { setEditor(e); void api.setSettings({ editor: e }) }
  const toggleCs = () => { setCs((v) => { ls.set('cs', v ? '0' : '1'); return !v }) }
  const toggleGroup = () => { setGrouped((v) => { ls.set('grouped', v ? '0' : '1'); return !v }) }
  const togglePreview = () => { setShowPreview((v) => { ls.set('preview', v ? '0' : '1'); return !v }) }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => api.onMenu((c) => {
    if (c === 'open-folder') void pick()
    else if (c === 'focus-search') { input.current?.focus(); input.current?.select() }
    else if (c === 'toggle-preview') togglePreview()
    else if (c === 'toggle-case') toggleCs()
    else if (c === 'toggle-group') toggleGroup()
  }), [pick])

  useEffect(() => {
    if (root) input.current?.focus()
  }, [root])

  const onKey = (e: React.KeyboardEvent) => {
    const n = matches.length
    const go = (i: number) => { e.preventDefault(); if (n) setSelected(Math.max(0, Math.min(n - 1, i))) }
    if (e.key === 'ArrowDown') go(e.metaKey ? n - 1 : sel + 1)
    else if (e.key === 'ArrowUp') go(e.metaKey ? 0 : sel - 1)
    else if (e.key === 'PageDown') go(sel + 10)
    else if (e.key === 'PageUp') go(sel - 10)
    else if (e.key === 'Enter') { e.preventDefault(); open(sel) }
    else if (e.key === 'Escape') { if (query) { setQuery(''); e.preventDefault() } else input.current?.blur() }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.metaKey && e.shiftKey && k === 'f') { e.preventDefault(); input.current?.focus(); input.current?.select() }
      else if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); openRef.current(Number(e.key) - 1) }
      else if (e.metaKey && e.altKey && (k === 'c' || e.code === 'KeyC')) { e.preventDefault(); toggleCs() }
      else if (e.metaKey && !e.shiftKey && !e.altKey && k === 'p') { e.preventDefault(); togglePreview() }
      else if (e.metaKey && !e.shiftKey && !e.altKey && k === 'o') { e.preventDefault(); void pick() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [pick])

  const startDrag = (e: React.PointerEvent) => {
    const el = bodyRef.current
    if (!el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    let r = ratio
    const move = (ev: PointerEvent) => { r = Math.min(0.75, Math.max(0.15, (rect.bottom - ev.clientY) / rect.height)); setRatio(r) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ls.set('ratio', String(r)); document.body.classList.remove('resizing') }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  if (!booted && !root) return <div className="boot" />
  if (!root) return <Welcome recents={recents} onPick={pick} onOpen={openWs} onRemove={async (p) => setRecents((await api.removeRecentWorkspace(p)).recentWorkspaces)} error={openErr} />

  const indexing = status.state === 'indexing'
  const q = query.trim()
  const kind = error ? 'error' : !q ? 'idle' : !resp ? 'loading' : matches.length === 0 ? 'none' : 'results'
  const activeId = current ? `opt-${sel}` : undefined

  return (
    <div className={'app' + (winFocus ? '' : ' blurred')}>
      <header className="titlebar">
        <div className="ws">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h6.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" /></svg>
          <span className="ws-name" title={root}>{wsName}</span>
          <span className={'pill ' + status.state}>
            {indexing ? <><span className="spin" />Indexing</> : status.state === 'ready' ? <><span className="dot" />Ready</> : 'Idle'}
          </span>
          <span className="muted tnum counts">{fmt(status.files)} files · {fmt(status.lines)} lines</span>
        </div>
        <div className="sp" />
        <div className="tools nodrag">
          <button className="btn" onClick={() => void pick()} title="Open another folder (⌘O)">Open…</button>
          <EditorPicker editors={editors} value={editor} onChange={changeEditor} />
        </div>
      </header>

      <div className="searchrow">
        <div className={'field' + (inputFocus ? ' focus' : '') + (error ? ' bad' : '')}>
          <svg className="mag" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setInputFocus(true)}
            onBlur={() => setInputFocus(false)}
            placeholder="Search in files"
            spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off"
            role="combobox" aria-expanded={kind === 'results'} aria-controls="results" aria-activedescendant={activeId}
            aria-autocomplete="none" aria-label="Search in files"
          />
          {query && <button className="clear" aria-label="Clear" onClick={() => { setQuery(''); input.current?.focus() }}>×</button>}
          <button className={'tg' + (cs ? ' on' : '')} aria-pressed={cs} aria-label="Match case" title="Match case (⌘⌥C)" onClick={toggleCs}>Cc</button>
          <button className={'tg' + (grouped ? ' on' : '')} aria-pressed={grouped} aria-label="Group by file" title="Group by file" onClick={toggleGroup}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 3.5h12M5 7h9M5 10h9M2 13.5h12" /></svg>
          </button>
          <button className={'tg' + (showPreview ? ' on' : '')} aria-pressed={showPreview} aria-label="Show preview" title="Show preview (⌘P)" onClick={togglePreview}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 9h12" /></svg>
          </button>
          <div className={'bar' + (searching || (indexing && q) ? ' on' : '')} />
        </div>
      </div>

      <div className="body" ref={bodyRef}>
        <div className="pane list">
          {kind === 'results' && (
            <Results matches={matches} grouped={grouped} selected={sel} focused={inputFocus} listId="results" onSelect={(i) => { setSelected(i); input.current?.focus() }} onOpen={open} />
          )}
          {kind === 'idle' && (
            <div className="state">
              <svg width="34" height="34" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
              <div className="st-title">Type to search in {wsName}</div>
              <div className="muted">⌘⇧F focus · ↑↓ navigate · ⏎ open in editor · ⌘⌥C match case · ⌘P preview</div>
            </div>
          )}
          {kind === 'loading' && <div className="state"><span className="spin big" /><div className="muted">Searching…</div></div>}
          {kind === 'none' && (
            <div className="state">
              <div className="st-title">No matches for “{q}”</div>
              <div className="muted">{indexing ? 'Still indexing, results may appear shortly.' : `Nothing found in ${fmt(status.files)} files.`}</div>
              {cs && <button className="chip" onClick={toggleCs}>Turn off Match Case</button>}
            </div>
          )}
          {kind === 'error' && (
            <div className="state">
              <div className="banner err" role="alert">Search failed: {error}</div>
              <button className="chip" onClick={() => void run()}>Retry</button>
            </div>
          )}
        </div>
        {showPreview && kind === 'results' && (
          <>
            <div className="split" role="separator" aria-orientation="horizontal" aria-label="Resize preview" onPointerDown={startDrag} />
            <div className="pane pv" style={{ height: `${ratio * 100}%` }}>
              <Preview match={current} onOpen={() => open(sel)} />
            </div>
          </>
        )}
      </div>

      {toast && <div className="banner err toast" role="alert" onClick={() => setToast(null)}>{toast}</div>}
      <footer className="status" role="status" aria-live="polite">
        {kind === 'results' && resp ? (
          <span title={`${resp.tookMs.toFixed(1)} ms`}>
            {fmt(resp.matches.length)}{resp.truncated ? '+' : ''} matches in {fmt(resp.totalFiles)} files
            {resp.truncated && <span className="muted"> · showing first {fmt(resp.matches.length)}, refine your query</span>}
          </span>
        ) : kind === 'loading' ? 'Searching…' : kind === 'none' ? 'No results' : kind === 'error' ? 'Error' : indexing ? 'Indexing…' : 'Ready'}
        <span className="sp" />
        {resp && kind === 'results' && <span className="muted tnum">{resp.tookMs.toFixed(0)} ms</span>}
        <span className="muted hint">⏎ open in {editors.find((e) => e.id === editor)?.label ?? editor}</span>
      </footer>
    </div>
  )
}

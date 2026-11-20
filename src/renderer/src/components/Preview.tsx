import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { FileContextResponse, SearchMatch } from '@shared/types'
import { applyMarks, highlightLines, langOf, splitPath } from '../lib/lang'
import { FileIcon } from './Results'

export function Preview({ match, onOpen }: { match: SearchMatch | null; onOpen: () => void }) {
  const [ctx, setCtx] = useState<FileContextResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const key = match ? match.file + ':' + match.line : ''

  useEffect(() => {
    if (!match) { setCtx(null); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      api.readFile({ file: match.file, line: match.line, radius: 60 })
        .then((r) => alive && setCtx(r))
        .catch((e) => alive && setCtx({ file: match.file, startLine: 1, lines: [], totalLines: 0, ok: false, error: String(e?.message ?? e) }))
        .finally(() => alive && setLoading(false))
    }, 40)
    return () => { alive = false; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => {
    if (!ctx || !ctx.ok || !match) return null
    const hl = highlightLines(ctx.lines, langOf(ctx.file))
    return hl
  }, [ctx, match])

  useEffect(() => {
    const el = body.current?.querySelector('.cl.cur') as HTMLElement | null
    if (el && body.current) body.current.scrollTop = Math.max(0, el.offsetTop - body.current.clientHeight / 2 + 10)
  }, [html])

  if (!match) return <div className="preview empty" role="region" aria-label="File preview"><span className="muted">No selection</span></div>
  const { name, dir } = splitPath(match.file)
  const first = match.matchRanges[0]?.[0] ?? 0
  const stale = ctx && ctx.file !== match.file
  return (
    <div className="preview" role="region" aria-label="File preview">
      <div className="pv-head">
        <FileIcon file={match.file} />
        <span className="fname">{name}</span>
        <span className="fdir">{dir}</span>
        <span className="sp" />
        <span className="muted tnum">{match.line}:{first + 1}</span>
        <button className="link" onClick={onOpen}>Open in editor</button>
      </div>
      <div className={'pv-body' + (loading || stale ? ' dim' : '')} ref={body} tabIndex={0}>
        {ctx && !ctx.ok && <div className="pv-msg">{ctx.error ?? 'Preview unavailable'}</div>}
        {html && ctx && (
          <div className="code-block">
            {html.map((h, i) => {
              const ln = ctx.startLine + i
              const cur = ln === match.line && ctx.file === match.file
              return (
                <div key={i} className={'cl' + (cur ? ' cur' : '')}>
                  <span className="gut">{ln}</span>
                  <span className="code" dangerouslySetInnerHTML={{ __html: cur ? applyMarks(h, match.matchRanges, 'm strong') : h || ' ' }} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

import { memo, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SearchMatch } from '@shared/types'
import { applyMarks, extInfo, highlightLine, langOf, splitPath, trimLine } from '../lib/lang'

export type Row = { t: 'head'; file: string; count: number } | { t: 'match'; m: SearchMatch; idx: number }

export function FileIcon({ file }: { file: string }) {
  const { label, color } = extInfo(file)
  return <span className="ficon" style={{ ['--c' as string]: color }}>{label}</span>
}

const Line = memo(function Line({ m }: { m: SearchMatch }) {
  const html = useMemo(() => {
    const tr = trimLine(m.text, m.matchRanges)
    return (tr.prefix ? '…' : '') + applyMarks(highlightLine(tr.text, langOf(m.file)), tr.ranges)
  }, [m])
  return <span className="code" dangerouslySetInnerHTML={{ __html: html }} />
})

interface Props {
  matches: SearchMatch[]
  grouped: boolean
  selected: number
  focused: boolean
  onSelect: (i: number) => void
  onOpen: (i: number) => void
  listId: string
}

export function Results({ matches, grouped, selected, focused, onSelect, onOpen, listId }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const { rows, rowOf } = useMemo(() => {
    const rows: Row[] = []
    const rowOf: number[] = []
    if (!grouped) {
      matches.forEach((m, idx) => { rowOf[idx] = rows.length; rows.push({ t: 'match', m, idx }) })
    } else {
      const g = new Map<string, number[]>()
      matches.forEach((m, i) => { const a = g.get(m.file); a ? a.push(i) : g.set(m.file, [i]) })
      // grouped order differs from flat; map idx -> position in matches array order stays the same
      for (const [file, ids] of g) {
        rows.push({ t: 'head', file, count: ids.length })
        for (const i of ids) { rowOf[i] = rows.length; rows.push({ t: 'match', m: matches[i], idx: i }) }
      }
    }
    return { rows, rowOf }
  }, [matches, grouped])

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i].t === 'head' ? 28 : 24),
    overscan: 12
  })

  useEffect(() => {
    const r = rowOf[selected]
    if (r !== undefined) v.scrollToIndex(r, { align: 'auto' })
  }, [selected, rowOf, v])
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [grouped])

  return (
    <div ref={scroller} className="results" id={listId} role="listbox" aria-label="Search results" tabIndex={-1}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          const style = { height: vi.size, transform: `translateY(${vi.start}px)` }
          if (row.t === 'head') {
            const { name, dir } = splitPath(row.file)
            return (
              <div key={'h' + row.file} className="row head" style={style} role="presentation">
                <FileIcon file={row.file} />
                <span className="fname">{name}</span>
                <span className="fdir">{dir}</span>
                <span className="badge">{row.count}</span>
              </div>
            )
          }
          const { m, idx } = row
          const { name, dir } = splitPath(m.file)
          const sel = idx === selected
          return (
            <div
              key={m.file + ':' + m.line + ':' + idx}
              id={`opt-${idx}`}
              role="option"
              aria-selected={sel}
              aria-posinset={idx + 1}
              aria-setsize={matches.length}
              className={'row item' + (sel ? ' sel' : '') + (sel && !focused ? ' inactive' : '') + (grouped ? ' grouped' : '')}
              style={style}
              onClick={() => onSelect(idx)}
              onDoubleClick={() => onOpen(idx)}
            >
              {grouped ? <span className="lno">{m.line}</span> : <FileIcon file={m.file} />}
              <Line m={m} />
              {!grouped && (
                <span className="where">
                  <span className="fname">{name}</span>
                  <span className="fdir">{dir}</span>
                  <span className="lnum">:{m.line}</span>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

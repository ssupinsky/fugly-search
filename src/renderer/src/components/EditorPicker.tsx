import { useEffect, useRef, useState } from 'react'
import type { EditorId, EditorInfo } from '@shared/types'

export function EditorPicker({ editors, value, onChange }: { editors: EditorInfo[]; value: EditorId; onChange: (e: EditorId) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', k, true)
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k, true) }
  }, [open])
  const cur = editors.find((e) => e.id === value)
  return (
    <div className="picker nodrag" ref={ref}>
      <button className="btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} title="Editor used to open results">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4 2 8l4 4M10 4l4 4-4 4" /></svg>
        {cur?.label ?? value}
        <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 2.5 4 5.5 7 2.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
      {open && (
        <div className="menu" role="listbox" aria-label="Editor">
          {editors.map((e) => (
            <button key={e.id} role="option" aria-selected={e.id === value} disabled={!e.available}
              className={'mi' + (e.id === value ? ' on' : '')} onClick={() => { onChange(e.id); setOpen(false) }}>
              <span className="chk">{e.id === value ? '✓' : ''}</span>{e.label}
              {!e.available && <span className="muted"> not found</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

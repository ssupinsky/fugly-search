export function Welcome({ recents, onPick, onOpen, onRemove, error }: { recents: string[]; onPick: () => void; onOpen: (p: string) => void; onRemove: (p: string) => void; error?: string | null }) {
  const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
  return (
    <div className="welcome">
      <div className="drag-strip" />
      <div className="w-card">
        <div className="logo" aria-hidden>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
        </div>
        <h1>Fugly Search</h1>
        <p className="muted">Fuzzy find any line in your repo, instantly.</p>
        <button className="primary" onClick={onPick} autoFocus>Open Folder…</button>
        {error && <div className="banner err" role="alert">{error}</div>}
        {recents.length > 0 && (
          <div className="recents">
            <div className="label">Recent</div>
            {recents.slice(0, 6).map((r) => {
              const name = r.slice(r.lastIndexOf('/') + 1)
              return (
                <div key={r} className="recent-row">
                  <button className="recent" onClick={() => onOpen(r)} title={r}
                    onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove(r) } }}>
                    <span className="rname">{name}</span><span className="rpath">{home(r)}</span>
                  </button>
                  <button className="recent-x" aria-label={`Remove ${name} from recent workspaces`} title="Remove from recent"
                    onClick={(e) => { e.stopPropagation(); onRemove(r) }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M2 2l6 6M8 2l-6 6" /></svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

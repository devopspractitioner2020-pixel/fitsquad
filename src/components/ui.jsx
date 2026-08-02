// Small shared presentational pieces used across screens.

export function Flame({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2c1 3-1 4-1 6a3 3 0 0 0 6 0c0-1 0-1.5-.3-2.2C18.7 8 20 10.5 20 13.5A8 8 0 1 1 6.3 8.2C7.5 7 9 6 9 4c1 1 2 1.5 3-2Z" fill="#05201A"/>
    </svg>
  )
}

export function Header({ onSignOut, onActivity, unseen = 0 }) {
  return (
    <header className="flex items-center justify-between px-5 pt-4 pb-3">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-mint grid place-items-center shadow-glow">
          <Flame />
        </div>
        <span className="font-display text-[22px] font-700 text-cream">Fit Squad</span>
      </div>
      {onActivity && (
        <button
          onClick={onActivity}
          className="relative text-muted p-2"
          aria-label={unseen > 0 ? `Activity, ${unseen} new` : 'Activity'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {unseen > 0 && (
            <span
              className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-mint text-[#05201A] text-[11px] font-800 grid place-items-center"
              data-testid="unseen-badge"
            >
              {unseen > 9 ? '9+' : unseen}
            </span>
          )}
        </button>
      )}
      {onSignOut && (
        <button onClick={onSignOut} aria-label="Sign out" className="text-muted p-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      )}
    </header>
  )
}

export function Eyebrow({ children }) {
  return <p className="text-muted tracking-[0.18em] text-[13px] uppercase font-600">{children}</p>
}

export function Card({ children, className = '' }) {
  return <div className={`bg-card border border-line rounded-xl2 shadow-card ${className}`}>{children}</div>
}

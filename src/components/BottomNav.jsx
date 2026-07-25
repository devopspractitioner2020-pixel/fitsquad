import { useNavigate, useLocation } from 'react-router-dom'

function Icon({ name, active }) {
  const stroke = active ? '#2FE6A8' : '#7C938C'
  const common = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (name === 'feed') return <svg {...common}><path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/></svg>
  if (name === 'me') return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>
  if (name === 'squad') return <svg {...common}><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.4 3-5 6.5-5s6.5 1.6 6.5 5"/><path d="M17 7.5a3 3 0 0 1 0 5.8M22 20c0-2.6-1.6-4.2-4-4.8"/></svg>
  return null
}

export default function BottomNav({ onAdd }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const is = (p) => pathname === p

  const Item = ({ to, name, label }) => (
    <button onClick={() => nav(to)} className="flex flex-col items-center gap-1 w-16 py-1">
      <div className={`px-4 py-1.5 rounded-full ${is(to) ? 'bg-mint/15' : ''}`}>
        <Icon name={name} active={is(to)} />
      </div>
      <span className="text-[12px]" style={{ color: is(to) ? '#2FE6A8' : '#7C938C' }}>{label}</span>
    </button>
  )

  return (
    <nav className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-32px)] max-w-[448px]">
      <div className="flex items-center justify-between px-4 py-2 rounded-xl3 border border-line bg-panel/90 backdrop-blur">
        <Item to="/feed" name="feed" label="Feed" />
        <Item to="/me" name="me" label="Me" />
        <button
          onClick={onAdd}
          aria-label="Add log"
          className="w-16 h-16 -mt-6 rounded-full bg-mint grid place-items-center shadow-glow-lg active:translate-y-0.5"
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#05201A" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <Item to="/squad" name="squad" label="Squad" />
      </div>
    </nav>
  )
}

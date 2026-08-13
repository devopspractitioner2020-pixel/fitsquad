import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'
import Stories from '../components/Stories'
import {
  getRecap, buildStories, hasContent, lastWeekKey, weekLabel, availableAt, isReady,
} from '../lib/recap'

// The weekly recap, opened as stories.
//
// Three states worth telling apart, because they need different sentences:
//   waiting  — the week is not out yet (Sunday 6pm)
//   empty    — it is out, and nobody did anything
//   ready    — play it
export default function Recap() {
  const { user, signOut } = useAuth()
  const nav = useNavigate()
  const [state, setState] = useState('loading')
  const [cards, setCards] = useState([])
  const [key, setKey] = useState(() => lastWeekKey())
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      setState('loading')
      try {
        const { data: squads, error } = await supabase.rpc('my_squads')
        if (error) throw error
        const squad = (squads ?? [])[0]
        if (!squad) { if (!cancelled) setState('no-squad'); return }

        const wk = lastWeekKey()
        setKey(wk)
        const recap = await getRecap(squad.id, wk)
        if (cancelled) return

        // null means the server has not opened this week yet. Distinguishing
        // that from an empty week is the whole point — one is "come back
        // Sunday", the other is "nobody logged anything".
        if (recap === null) { setState('waiting'); return }

        setCards(buildStories(recap))
        // Asked of the week, not of the card count — a quiet week still
        // produces a cover and an outro, so counting cards would call it
        // full.
        setState(hasContent(recap) ? 'ready' : 'empty')
      } catch (e) {
        if (!cancelled) { setErr(e?.message || 'Could not load the recap.'); setState('error') }
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  if (state === 'ready') {
    return <Stories cards={cards} onClose={() => nav('/feed')} />
  }

  return (
    <div className="app-shell">
      <Header onSignOut={signOut} />
      <div className="px-5">
        <button onClick={() => nav('/feed')} className="text-muted mb-3">← Back to feed</button>
        <h1 className="font-display text-[32px] font-800 mb-1">Weekly recap</h1>
        <p className="text-muted mb-6">{weekLabel(key)}</p>

        {state === 'loading' && <p className="text-muted py-6">Loading…</p>}

        {state === 'waiting' && (
          <div className="bg-card border border-line rounded-xl2 p-6 text-center">
            <div className="text-[44px] mb-2" aria-hidden="true">🍿</div>
            <p className="font-display text-[22px] font-700 mb-2">Not out yet</p>
            <p className="text-muted">
              This week’s recap lands on Sunday at 6pm. Keep logging — what you do
              between now and then is what it is made of.
            </p>
            <p className="text-muted-2 text-[12px] mt-3">
              Ready {availableAt(key).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        )}

        {state === 'empty' && (
          <div className="bg-card border border-line rounded-xl2 p-6 text-center">
            <p className="font-display text-[22px] font-700 mb-2">A quiet week</p>
            <p className="text-muted">
              Nobody in the squad logged much. Nothing to replay — but the next one
              starts today.
            </p>
          </div>
        )}

        {state === 'no-squad' && (
          <p className="text-muted">
            Recaps are about a squad. Join or create one on the Squad tab and yours
            starts this week.
          </p>
        )}

        {state === 'error' && <p className="text-[#ff9b8a]">{err}</p>}
      </div>
    </div>
  )
}

export { isReady }

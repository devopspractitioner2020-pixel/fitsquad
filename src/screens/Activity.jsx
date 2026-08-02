import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'
import { getActivity, markActivitySeen, describeActivity } from '../lib/reactions'
import { timeAgo } from '../components/PostCard'

// "How does anyone know someone reacted to my post?" They did not — the
// reaction went into the void. This is the answer: everything other people
// have left on your posts, newest first.
//
// Read on open. Opening this screen IS the acknowledgement, so there is no
// separate "mark all read" to forget to tap.
export default function Activity() {
  const { user, signOut } = useAuth()
  const nav = useNavigate()
  const [items, setItems] = useState(null) // null = still loading
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await getActivity()
        if (cancelled) return
        setItems(rows)

        // Only after the list is on screen. Marking first would clear the
        // badge for someone whose connection then dropped before they saw
        // anything.
        //
        // Its own try/catch, deliberately: this is bookkeeping, and failing
        // it must not take the list down with it. Sharing the outer catch
        // meant a failed write replaced the activity the reader had already
        // read with an error message — the badge stays, which is the right
        // failure, and they see their activity, which is what they came for.
        try {
          await markActivitySeen()
          window.dispatchEvent(new Event('fitsquad:activity-seen'))
        } catch {
          // Left unseen. It will mark on the next visit.
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e?.message || 'Could not load your activity.')
          setItems([])
        }
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  return (
    <div className="app-shell">
      <Header onSignOut={signOut} />
      <div className="px-5">
        <button onClick={() => nav('/feed')} className="text-muted mb-3">← Back to feed</button>
        <h1 className="font-display text-[32px] font-800 mb-1">Activity</h1>
        <p className="text-muted mb-6">Reactions and comments your squad left on your posts.</p>

        {err && <p className="text-[#ff9b8a] text-sm mb-4">{err}</p>}

        {items === null && <p className="text-muted py-6">Loading…</p>}

        {items?.length === 0 && (
          <p className="text-muted py-10 text-center">
            Nothing yet. When someone reacts or replies to one of your posts, it shows up here.
          </p>
        )}

        <div className="space-y-2">
          {(items ?? []).map((item, i) => (
            <div
              key={`${item.post_id}-${item.kind ?? 'reaction'}-${item.emoji ?? ''}-${item.created_at}-${i}`}
              className="flex items-center gap-3 bg-card border border-line rounded-xl2 p-4"
            >
              <span className="text-[22px]" aria-hidden="true">
                {item.kind === 'comment' ? '💬' : item.emoji}
              </span>
              <div className="flex-1 min-w-0">
                {/* One node, so a screen reader reads one sentence rather
                    than "María" … "reacted" … "Push day". */}
                <p className="text-cream leading-snug">{describeActivity(item)}</p>
                {item.body && (
                  <p className="text-muted text-sm mt-1 break-words">“{item.body}”</p>
                )}
                <p className="text-muted-2 text-[12px] mt-0.5">{timeAgo(item.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

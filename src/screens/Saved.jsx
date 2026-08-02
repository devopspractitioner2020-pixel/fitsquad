import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'
import PostCard from '../components/PostCard'
import { getSavedPosts, setSaved, SLUG_TO_KIND, KIND_LABEL } from '../lib/saved'
import { getReactions } from '../lib/reactions'
import { getCommentCounts } from '../lib/comments'

// One list of saved posts, of one kind. Reached from the two boxes on Me.
export default function Saved() {
  const { kind: slug } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const kind = SLUG_TO_KIND[slug]

  const [posts, setPosts] = useState(null) // null = still loading
  const [reactions, setReactions] = useState(() => new Map())
  const [commentCounts, setCommentCounts] = useState(() => new Map())
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!user?.id || !kind) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await getSavedPosts(user.id, kind)
        if (!cancelled) setPosts(rows)
        // Same card, same counts as the feed — a saved post showing no
        // reactions while the feed shows three reads as a bug.
        try {
          const ids = rows.map((x) => x.id)
          const [r, c] = await Promise.all([getReactions(ids, user.id), getCommentCounts(ids)])
          if (!cancelled) { setReactions(r); setCommentCounts(c) }
        } catch { /* decoration; the list matters more */ }
      } catch (e) {
        if (!cancelled) { setErr(e?.message || 'Could not load your saved items.'); setPosts([]) }
      }
    })()
    return () => { cancelled = true }
  }, [user?.id, kind])

  // Unsaving from this screen removes the card immediately. Leaving a card
  // sitting in a list called "Saved" after the reader just unsaved it would
  // read as the tap not having worked.
  function onSavedChange(postId, next) {
    if (!next) setPosts((prev) => (prev ?? []).filter((p) => p.id !== postId))
  }

  async function unsaveAll() {
    if (!posts?.length) return
    const previous = posts
    setPosts([])
    try {
      await Promise.all(previous.map((p) => setSaved(user.id, p.id, false)))
    } catch (e) {
      setPosts(previous)
      setErr(e?.message || 'Could not clear those. Try again.')
    }
  }

  if (!kind) {
    return (
      <Shell nav={nav} title="Saved">
        <p className="text-muted px-5">That saved list does not exist.</p>
      </Shell>
    )
  }

  const label = KIND_LABEL[kind]
  const noun = kind === 'tip' ? 'tips' : 'meals'

  return (
    <Shell nav={nav} title={label}>
      <div className="px-5">
        {posts === null && <p className="text-muted">Loading…</p>}

        {err && <p className="text-[#ff9b8a] text-sm mb-4">{err}</p>}

        {posts?.length === 0 && !err && (
          <div className="text-center text-muted py-16">
            <p className="font-display text-[19px] text-cream mb-1">Nothing saved yet.</p>
            <p className="mb-6">
              Tap the bookmark on any {noun} in the feed and it will be waiting here.
            </p>
            <button className="btn-ghost" onClick={() => nav('/feed')}>Go to the feed</button>
          </div>
        )}

        {posts?.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-muted">
                {posts.length} saved {posts.length === 1 ? noun.replace(/s$/, '') : noun}
              </p>
              <button onClick={unsaveAll} className="text-muted text-sm underline decoration-line underline-offset-4">
                Clear all
              </button>
            </div>
            <div className="space-y-4">
              {posts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  userId={user?.id}
                  saved
                  onSavedChange={onSavedChange}
                  reactions={reactions.get(p.id)}
                  commentCount={commentCounts.get(p.id) ?? 0}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children, nav, title }) {
  return (
    <div className="app-shell">
      <Header />
      <div className="px-5">
        <button onClick={() => nav('/me')} className="text-muted mb-3">← Back to Me</button>
        <p className="text-muted uppercase tracking-[0.14em] text-[13px]">Your collection</p>
        <h1 className="font-display text-[38px] font-800 mb-5">{title}</h1>
      </div>
      {children}
    </div>
  )
}

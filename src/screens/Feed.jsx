import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'
import { useUnseenActivity } from '../lib/useUnseenActivity'
import PostCard from '../components/PostCard'
import { getSavedPostIds } from '../lib/saved'
import { getReactions } from '../lib/reactions'
import { getCommentCounts } from '../lib/comments'

export default function Feed() {
  const { user, profile, signOut } = useAuth()
  const nav = useNavigate()
  const { unseen } = useUnseenActivity(user?.id)
  const [posts, setPosts] = useState([])
  const [savedIds, setSavedIds] = useState(() => new Set())
  const [reactions, setReactions] = useState(() => new Map())
  const [commentCounts, setCommentCounts] = useState(() => new Map())
  const [summary, setSummary] = useState({ meals: 0, workouts: 0, cheats: 0 })

  async function load() {
    const sevenAgo = new Date(Date.now() - 7 * 864e5).toISOString()
    const { data: recent } = await supabase
      .from('posts').select('*').order('created_at', { ascending: false }).limit(50)
    setPosts(recent ?? [])

    // One query for the whole feed. Fifty cards each fetching their own
    // reactions would be fifty round trips before anything settled.
    const ids = (recent ?? []).map((p) => p.id)
    try {
      setCommentCounts(await getCommentCounts(ids))
    } catch {
      // Same reasoning as reactions below: decoration, not the feed itself.
    }
    try {
      setReactions(await getReactions(ids, user?.id))
    } catch {
      // Reactions are decoration on top of the feed; failing to read them
      // must not cost the reader the posts. The buttons render at zero and
      // correct themselves on the next load.
    }

    const { data: week } = await supabase
      .from('posts').select('kind,is_healthy,is_cheat').gte('created_at', sevenAgo)
    const meals = (week ?? []).filter((p) => p.kind === 'meal' && p.is_healthy).length
    const workouts = (week ?? []).filter((p) => p.kind === 'workout').length
    const cheats = (week ?? []).filter((p) => p.is_cheat).length
    setSummary({ meals, workouts, cheats })
  }

  // Which posts this reader has already saved, so the bookmark icons render
  // filled on first paint rather than popping in a moment later.
  async function loadSaved() {
    if (!user?.id) return
    try {
      setSavedIds(await getSavedPostIds(user.id))
    } catch {
      // A failed read here should not stop the feed rendering; the icons
      // simply show as unsaved and correct themselves on the next load.
    }
  }

  useEffect(() => { load() }, [user?.id])
  useEffect(() => { loadSaved() }, [user?.id])

  function onReactionChange(postId, emoji, on) {
    setReactions((prev) => {
      const copy = new Map(prev)
      const entry = copy.get(postId) ?? { counts: {}, mine: new Set() }
      const counts = { ...entry.counts }
      const mine = new Set(entry.mine)
      if (on) {
        if (!mine.has(emoji)) counts[emoji] = (counts[emoji] ?? 0) + 1
        mine.add(emoji)
      } else {
        if (mine.has(emoji)) counts[emoji] = Math.max(0, (counts[emoji] ?? 0) - 1)
        mine.delete(emoji)
      }
      copy.set(postId, { counts, mine })
      return copy
    })
  }

  function onCommentCountChange(postId, count) {
    setCommentCounts((prev) => new Map(prev).set(postId, count))
  }

  function onSavedChange(postId, next) {
    setSavedIds((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(postId)
      else copy.delete(postId)
      return copy
    })
  }

  return (
    <div className="app-shell">
      <Header onSignOut={signOut} onActivity={() => nav('/activity')} unseen={unseen} />
      <div className="px-5">
        {/* "Squad Feed" is gone. It was a 42px heading naming the screen you
            already navigated to, and on a phone it pushed the first real post
            most of the way off the bottom. The greeting carries the same
            context in a fraction of the space. */}
        <h1 className="font-display text-[28px] font-800 mt-2 mb-5">
          Hey {profile?.display_name ?? 'there'}
        </h1>

        {/* Weekly summary */}
        <div className="bg-card border border-line rounded-xl2 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-[20px] font-700">Squad this week</h3>
            <span className="text-muted text-sm">last 7 days</span>
          </div>
          <SummaryRow icon="🥗" label="Healthy meals" value={summary.meals} />
          <SummaryRow icon="🏋️" label="Workouts" value={summary.workouts} />
          <SummaryRow icon="✨" label="Cheat meals owned" value={summary.cheats} />
          {summary.cheats > 0 && <p className="text-muted text-sm mt-3">{summary.cheats} cheat meal owned up to — no shame.</p>}
        </div>

        {/* Posts */}
        <div className="space-y-4">
          {posts.length === 0 && (
            <div className="text-center text-muted py-16">
              <p className="font-display text-[19px] text-cream mb-1">Nothing logged yet.</p>
              <p>Tap + to log your first workout or meal.</p>
            </div>
          )}
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              userId={user?.id}
              saved={savedIds.has(p.id)}
              onSavedChange={onSavedChange}
              reactions={reactions.get(p.id)}
              onReactionChange={onReactionChange}
              commentCount={commentCounts.get(p.id) ?? 0}
              onCommentCountChange={onCommentCountChange}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ icon, label, value }) {
  return (
    <div className="flex items-center gap-4 bg-panel/60 border border-line rounded-2xl px-4 py-3 mb-3 last:mb-0">
      <div className="w-11 h-11 rounded-xl bg-mint/10 grid place-items-center text-[20px]">{icon}</div>
      <div className="flex-1">
        <div className="text-muted uppercase tracking-wide text-[13px]">{label}</div>
        <div className="font-display text-[26px] font-800 text-mint leading-none">{value}</div>
      </div>
    </div>
  )
}

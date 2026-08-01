import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'
import PostCard from '../components/PostCard'
import { getSavedPostIds } from '../lib/saved'

export default function Feed() {
  const { user, profile, signOut } = useAuth()
  const [posts, setPosts] = useState([])
  const [savedIds, setSavedIds] = useState(() => new Set())
  const [summary, setSummary] = useState({ meals: 0, workouts: 0, cheats: 0 })

  async function load() {
    const sevenAgo = new Date(Date.now() - 7 * 864e5).toISOString()
    const { data: recent } = await supabase
      .from('posts').select('*').order('created_at', { ascending: false }).limit(50)
    setPosts(recent ?? [])

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

  useEffect(() => { load() }, [])
  useEffect(() => { loadSaved() }, [user?.id])

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
      <Header onSignOut={signOut} />
      <div className="px-5">
        <p className="text-muted uppercase tracking-[0.14em] text-[13px] mt-2">Hey {profile?.display_name ?? 'there'}</p>
        <h1 className="font-display text-[42px] font-800 mb-5">Squad Feed</h1>

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

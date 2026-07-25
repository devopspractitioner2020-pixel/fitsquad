import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'

const REACTIONS = ['🔥', '💪', '👏', '😅']

export default function Feed() {
  const { profile, signOut } = useAuth()
  const [posts, setPosts] = useState([])
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

  useEffect(() => { load() }, [])

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
          {posts.map((p) => <PostCard key={p.id} post={p} />)}
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

function PostCard({ post }) {
  const when = timeAgo(post.created_at)
  const kindLabel = post.kind === 'workout' ? 'Strength' : post.kind === 'meal' ? 'Healthy Meal' : 'Tip'
  const kindIcon = post.kind === 'meal' ? '🍽️' : post.kind === 'tip' ? '✨' : '🏋️'
  return (
    <div className="bg-card border border-line rounded-xl2 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-mint/15 grid place-items-center text-mint font-display font-700">
          {(post.author_name ?? '?')[0]?.toUpperCase()}
        </div>
        <div>
          <div className="font-display font-700">{post.author_name} <span className="text-muted font-body font-400">· {when}</span></div>
          <div className="text-muted text-sm">{kindIcon} {kindLabel}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h4 className="font-display text-[26px] font-700">{post.title}</h4>
        {post.is_healthy && <span className="text-mint bg-mint/12 rounded-full px-3 py-0.5 text-sm font-700">healthy</span>}
        {post.is_cheat && <span className="text-[#ff8bd0] bg-[#ff8bd0]/12 rounded-full px-3 py-0.5 text-sm font-700">cheat 😈</span>}
      </div>
      {post.minutes && <p className="text-muted mb-2">{post.minutes} min · Strength</p>}
      {post.note && <p className="text-muted mb-2">{post.note}</p>}

      {post.photo_url && (
        <img src={post.photo_url} alt={post.title} className="w-full max-h-72 object-cover rounded-2xl border border-line my-3" />
      )}

      <div className="flex items-center gap-2 mt-3">
        {REACTIONS.map((r) => (
          <button key={r} className="w-11 h-9 rounded-full border border-line grid place-items-center text-[16px] active:bg-card-2">{r}</button>
        ))}
        <button className="ml-auto text-muted">Comment</button>
      </div>
    </div>
  )
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86400) return `about ${Math.floor(s / 3600)} hours ago`
  return `${Math.floor(s / 86400)} day${s < 172800 ? '' : 's'} ago`
}

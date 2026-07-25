import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'

export default function Squad() {
  const { signOut } = useAuth()
  const [range, setRange] = useState('week') // week | all
  const [rows, setRows] = useState([])

  async function load() {
    const since = range === 'week' ? new Date(Date.now() - 7 * 864e5).toISOString() : '1970-01-01'
    // Aggregate logs per author. For a real multi-user squad this would be a
    // Postgres view; here we roll it up client-side from posts + weigh_ins.
    const { data: posts } = await supabase.from('posts').select('author_name,user_id,kind,is_healthy,created_at').gte('created_at', since)
    const { data: weighs } = await supabase.from('weigh_ins').select('user_id,weight_kg,created_at').order('created_at')

    const byUser = {}
    for (const p of posts ?? []) {
      const k = p.user_id
      byUser[k] ??= { name: p.author_name, meals: 0, workouts: 0 }
      if (p.kind === 'meal' && p.is_healthy) byUser[k].meals++
      if (p.kind === 'workout') byUser[k].workouts++
    }
    // weight change per user
    const firstLast = {}
    for (const w of weighs ?? []) {
      firstLast[w.user_id] ??= { first: w.weight_kg, last: w.weight_kg }
      firstLast[w.user_id].last = w.weight_kg
    }
    const list = Object.entries(byUser).map(([uid, v]) => ({
      uid,
      name: v.name,
      meals: v.meals,
      workouts: v.workouts,
      logs: v.meals + v.workouts,
      change: firstLast[uid] ? +(firstLast[uid].last - firstLast[uid].first).toFixed(1) : null,
    })).sort((a, b) => b.logs - a.logs)
    setRows(list)
  }

  useEffect(() => { load() }, [range])

  return (
    <div className="app-shell">
      <Header onSignOut={signOut} />
      <div className="px-5">
        <p className="text-muted uppercase tracking-[0.14em] text-[13px] mt-2">The squad</p>
        <h1 className="font-display text-[42px] font-800 mb-1">Leaderboard</h1>
        <p className="text-muted mb-5">Ranked by healthy meals + workouts logged.</p>

        <div className="flex bg-ink/60 border border-line rounded-2xl p-1 mb-6">
          <button onClick={() => setRange('week')} className={`flex-1 py-3 rounded-xl font-display font-700 ${range === 'week' ? 'bg-card text-cream' : 'text-muted'}`}>This week</button>
          <button onClick={() => setRange('all')} className={`flex-1 py-3 rounded-xl font-display font-700 ${range === 'all' ? 'bg-card text-cream' : 'text-muted'}`}>All-time</button>
        </div>

        <div className="space-y-3">
          {rows.length === 0 && <p className="text-muted text-center py-16">No logs in this range yet. Be the first.</p>}
          {rows.map((r, i) => (
            <div key={r.uid} className="flex items-center gap-4 bg-card border border-line rounded-xl2 p-5">
              <div className="w-12 h-12 rounded-full bg-mint grid place-items-center font-display text-[20px] font-800 text-[#05201A]">{i + 1}</div>
              <div className="flex-1">
                <div className="font-display text-[22px] font-700">{r.name}</div>
                <div className="text-muted text-sm">🥗 {r.meals} · 🏋️ {r.workouts}{r.change != null && ` · ${r.change > 0 ? '+' : ''}${r.change} kg`}</div>
              </div>
              <div className="text-right">
                <div className="font-display text-[34px] font-800 text-mint leading-none">{r.logs}</div>
                <div className="text-muted text-[12px] uppercase tracking-wide">logs</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'

// The leaderboard and the squad roster.
//
// Note what is NOT here: any filtering by squad. Row Level Security scopes
// `posts` and `weigh_ins` to people you share a squad with, so a plain
// `select *` already returns exactly your squad's rows. Putting the filter in
// the query too would be duplicated logic that could drift from the policy.
export default function Squad() {
  const { user, signOut } = useAuth()
  const [range, setRange] = useState('week') // week | all
  const [rows, setRows] = useState([])
  const [squads, setSquads] = useState([])
  const [showJoin, setShowJoin] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  async function loadSquads() {
    const { data, error } = await supabase.rpc('my_squads')
    if (error) { setErr(error.message); return }
    setSquads(data ?? [])
  }

  async function load() {
    const since = range === 'week' ? new Date(Date.now() - 7 * 864e5).toISOString() : '1970-01-01'

    // Posts drive the ranking; weigh-ins add the weight column. Both are
    // fetched for the SAME window — the old version filtered posts by range
    // but read every weigh-in ever, so "This week" showed all-time change.
    const [{ data: posts }, { data: weighs }, { data: profiles }] = await Promise.all([
      supabase.from('posts').select('user_id,kind,is_healthy,created_at').gte('created_at', since),
      supabase.from('weigh_ins').select('user_id,weight_kg,created_at').gte('created_at', since).order('created_at'),
      supabase.from('profiles').select('id,display_name'),
    ])

    // Names come from `profiles`, not from the denormalised `posts.author_name`.
    // A rename should update the whole leaderboard, and a member who has
    // logged only weigh-ins must still appear — under the old post-driven
    // rollup they were invisible.
    const nameOf = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name]))
    const byUser = {}
    const seed = (uid) => (byUser[uid] ??= { meals: 0, workouts: 0, first: null, last: null })

    for (const p of posts ?? []) {
      const u = seed(p.user_id)
      if (p.kind === 'meal' && p.is_healthy) u.meals++
      if (p.kind === 'workout') u.workouts++
    }
    for (const w of weighs ?? []) {
      const u = seed(w.user_id)
      if (u.first == null) u.first = w.weight_kg
      u.last = w.weight_kg
    }

    const list = Object.entries(byUser)
      .map(([uid, v]) => ({
        uid,
        name: nameOf[uid] ?? 'Squad member',
        meals: v.meals,
        workouts: v.workouts,
        logs: v.meals + v.workouts,
        change: v.first != null && v.last != null ? +(v.last - v.first).toFixed(1) : null,
        isMe: uid === user?.id,
      }))
      .sort((a, b) => b.logs - a.logs || a.name.localeCompare(b.name))

    setRows(list)
  }

  useEffect(() => { loadSquads() }, [user?.id])
  useEffect(() => { load() }, [range, user?.id])

  const squad = squads[0]

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      setErr('Could not copy — select the code and copy it manually.')
    }
  }

  async function joinSquad() {
    setErr(''); setBusy(true)
    try {
      const { error } = await supabase.rpc('join_squad', { code })
      if (error) throw error
      setCode(''); setShowJoin(false)
      await Promise.all([loadSquads(), load()])
    } catch (e) {
      setErr(e?.message || 'Could not join that squad.')
    } finally {
      setBusy(false)
    }
  }

  const inviteUrl = squad ? `${window.location.origin}/?join=${squad.join_code}` : ''

  return (
    <div className="app-shell">
      <Header onSignOut={signOut} />
      <div className="px-5">
        <p className="text-muted uppercase tracking-[0.14em] text-[13px] mt-2">The squad</p>
        <h1 className="font-display text-[42px] font-800 mb-1">{squad?.name ?? 'Leaderboard'}</h1>
        <p className="text-muted mb-5">Ranked by healthy meals + workouts logged.</p>

        {/* Invite panel — the answer to "how do I add people". */}
        {squad && (
          <div className="bg-card border border-mint/40 rounded-xl2 p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-muted uppercase tracking-wide text-[12px]">Join code</div>
                <div className="font-display text-[30px] font-800 text-mint tracking-[0.18em] leading-tight">
                  {squad.join_code}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-[26px] font-800">{squad.member_count}</div>
                <div className="text-muted text-[12px] uppercase tracking-wide">
                  member{Number(squad.member_count) === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <p className="text-muted text-sm mb-3">
              Share this code — or the link — and whoever signs up with it lands straight in your squad.
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 py-3" onClick={() => copy(squad.join_code, 'code')}>
                {copied === 'code' ? 'Copied ✓' : 'Copy code'}
              </button>
              <button className="btn-ghost flex-1 py-3" onClick={() => copy(inviteUrl, 'link')}>
                {copied === 'link' ? 'Copied ✓' : 'Copy invite link'}
              </button>
            </div>
          </div>
        )}

        {/* Join someone else's squad. */}
        {!showJoin ? (
          <button className="btn-ghost mb-6 py-3" onClick={() => setShowJoin(true)}>
            Join another squad with a code
          </button>
        ) : (
          <div className="bg-card border border-line rounded-xl2 p-4 mb-6">
            <label className="block">
              <span className="label">Squad join code</span>
              <input
                className="input tracking-[0.18em] uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
              />
            </label>
            <div className="flex gap-3 mt-3">
              <button className="btn-ghost flex-1" onClick={() => { setShowJoin(false); setErr('') }}>Cancel</button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={joinSquad}
                disabled={busy || code.trim().length < 4}
              >
                {busy ? <><span className="spinner" /> Joining…</> : 'Join squad'}
              </button>
            </div>
          </div>
        )}

        {err && <p className="text-[#ff9b8a] text-sm mb-4">{err}</p>}

        <div className="flex bg-ink/60 border border-line rounded-2xl p-1 mb-6">
          <button onClick={() => setRange('week')} className={`flex-1 py-3 rounded-xl font-display font-700 ${range === 'week' ? 'bg-card text-cream' : 'text-muted'}`}>This week</button>
          <button onClick={() => setRange('all')} className={`flex-1 py-3 rounded-xl font-display font-700 ${range === 'all' ? 'bg-card text-cream' : 'text-muted'}`}>All-time</button>
        </div>

        <div className="space-y-3">
          {rows.length === 0 && <p className="text-muted text-center py-16">No logs in this range yet. Be the first.</p>}
          {rows.map((r, i) => (
            <div
              key={r.uid}
              className={`flex items-center gap-4 bg-card border rounded-xl2 p-5 ${r.isMe ? 'border-mint/50' : 'border-line'}`}
            >
              <div className="w-12 h-12 rounded-full bg-mint grid place-items-center font-display text-[20px] font-800 text-[#05201A]">{i + 1}</div>
              <div className="flex-1">
                <div className="font-display text-[22px] font-700">
                  {r.name}{r.isMe && <span className="text-mint text-sm font-400 ml-2">you</span>}
                </div>
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

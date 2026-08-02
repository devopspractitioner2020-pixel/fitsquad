import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/ui'

// Matches the name the signup trigger gives a squad in migration 0004, so a
// squad created here and one created at signup are indistinguishable.
const defaultSquadName = (displayName) => `${displayName?.trim() || 'My'}'s Squad`

// The leaderboard and the squad roster.
//
// THE RULE THIS SCREEN GOT WRONG, and it is worth stating plainly because it
// made the core feature look broken: MEMBERSHIP IS NOT ACTIVITY.
//
// The leaderboard used to be built purely from `posts` and `weigh_ins`, so a
// person only existed on this screen once they had logged something. Two
// people who joined with a valid code and had not yet logged a meal showed
// up nowhere — the panel above said "3 members" and the list below said "No
// logs in this range yet", and everyone involved reasonably concluded the
// join had failed. It had not.
//
// The list is now driven by the roster: every member appears from the moment
// they join, with zeroes until they log. Activity decorates the roster; it
// does not decide who is on it.
export default function Squad() {
  const { user, profile, signOut } = useAuth()
  const [range, setRange] = useState('week') // week | all
  const [rows, setRows] = useState([])
  const [squads, setSquads] = useState([])
  const [squadId, setSquadId] = useState(null)
  const [roster, setRoster] = useState([])
  const [loadedSquads, setLoadedSquads] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [code, setCode] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  async function loadSquads() {
    const { data, error } = await supabase.rpc('my_squads')
    // `loadedSquads` distinguishes "you have no squad" from "we have not
    // asked yet". Without it the create-a-squad panel flashes on screen for
    // every user on every visit, in the moment before the answer arrives.
    setLoadedSquads(true)
    if (error) { setErr(error.message); return }
    const list = data ?? []
    setSquads(list)

    // Signed up with a code and still in no squad: the database did not
    // honour it. That was a real bug (see migration 0009), and even with it
    // fixed this is the cheapest possible recovery — offer the code they
    // already typed, pre-filled, instead of making them find it again.
    const signupCode = user?.user_metadata?.join_code
    if (list.length === 0 && signupCode) {
      setCode(String(signupCode).toUpperCase())
      setShowJoin(true)
    }
    // Keep the current selection if it still exists; otherwise fall back to
    // the first. Re-selecting blindly would bounce you back to squad one
    // every time this reloads.
    setSquadId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id ?? null))
    return list
  }

  async function load(sid = squadId) {
    if (!sid) { setRows([]); setRoster([]); return }

    const since = range === 'week' ? new Date(Date.now() - 7 * 864e5).toISOString() : '1970-01-01'

    // Posts drive the ranking; weigh-ins add the weight column. Both are
    // fetched for the SAME window — an earlier version filtered posts by
    // range but read every weigh-in ever, so "This week" showed all-time
    // change.
    //
    // RLS scopes both to people you share a squad with, which is a wider net
    // than one squad once you are in two. The roster is what narrows it.
    const [{ data: members, error: rosterErr }, { data: posts }, { data: weighs }] = await Promise.all([
      supabase.rpc('squad_roster', { sid }),
      supabase.from('posts').select('user_id,kind,is_healthy,created_at').gte('created_at', since),
      supabase.from('weigh_ins').select('user_id,weight_kg,created_at').gte('created_at', since).order('created_at'),
    ])

    if (rosterErr) { setErr(rosterErr.message); return }
    const people = members ?? []
    setRoster(people)

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

    // Start from the roster, not from the activity. Everyone in the squad is
    // on the board; the ones who have not logged sit at the bottom on zero.
    const list = people
      .map((m) => {
        const v = byUser[m.user_id] ?? { meals: 0, workouts: 0, first: null, last: null }
        return {
          uid: m.user_id,
          name: m.display_name,
          role: m.role,
          meals: v.meals,
          workouts: v.workouts,
          logs: v.meals + v.workouts,
          change: v.first != null && v.last != null ? +(v.last - v.first).toFixed(1) : null,
          isMe: m.user_id === user?.id,
        }
      })
      .sort((a, b) => b.logs - a.logs || a.name.localeCompare(b.name))

    setRows(list)
  }

  // One effect asks which squads you are in; the other loads whichever is
  // selected. Loading from both would fetch everything twice on mount.
  useEffect(() => { loadSquads() }, [user?.id])
  useEffect(() => { load(squadId) }, [range, squadId])

  const squad = squads.find((s) => s.id === squadId) ?? squads[0]
  const memberCount = roster.length || Number(squad?.member_count ?? 0)

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      setErr('Could not copy — select the code and copy it manually.')
    }
  }

  // The missing half of the squad feature. `create_squad` has existed in the
  // database since migration 0004 and was granted to every authenticated
  // user — but nothing in the app ever called it. So anyone who ended up
  // without a squad (an account created before the signup trigger existed, a
  // trigger that failed, or simply leaving your last squad, which the RLS
  // policy permits) could only ever join someone else's. There was no way
  // back to having one of your own.
  async function createSquad() {
    setErr(''); setBusy(true)
    try {
      const name = newName.trim() || defaultSquadName(profile?.display_name)
      const { error } = await supabase.rpc('create_squad', { squad_name: name })
      if (error) throw error
      setNewName('')
      await Promise.all([loadSquads(), load()])
    } catch (e) {
      setErr(e?.message || 'Could not create your squad.')
    } finally {
      setBusy(false)
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

        {/* More than one squad, so say which one you are looking at and let
            people switch. Without this the screen silently showed the oldest
            one — including its join code, which is a good way to hand out a
            code to the wrong squad and then wonder why nobody appears. */}
        {squads.length > 1 && (
          <div className="flex gap-2 flex-wrap mb-4" role="tablist" aria-label="Your squads">
            {squads.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === squad?.id}
                onClick={() => setSquadId(s.id)}
                className={`px-4 py-2 rounded-full border text-sm font-700 ${
                  s.id === squad?.id
                    ? 'bg-mint/[0.12] border-mint/50 text-mint'
                    : 'bg-card border-line text-muted'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

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
              {/* Counted from the roster once it has loaded, not from the
                  separate member_count. Two numbers from two queries is how
                  you end up displaying "3 members" above a list of one. */}
              <div className="text-right">
                <div className="font-display text-[26px] font-800" data-testid="member-count">{memberCount}</div>
                <div className="text-muted text-[12px] uppercase tracking-wide">
                  member{memberCount === 1 ? '' : 's'}
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

        {/* No squad. Previously this screen rendered nothing here at all —
            no code, no member count, no explanation — and the only action on
            offer was joining someone else's squad with a code you would have
            to go and ask for. */}
        {loadedSquads && !squad && (
          <div className="bg-card border border-mint/40 rounded-xl2 p-5 mb-6">
            <div className="font-display text-[22px] font-700 mb-1">You’re not in a squad yet</div>
            <p className="text-muted text-sm mb-4">
              {user?.user_metadata?.join_code
                ? 'You signed up with a join code but it didn’t take. The code is filled in below — tap Join squad to fix it. Or start your own here.'
                : 'Create one and you’ll get a join code to share. Your logs stay with you either way — a squad decides who can see them.'}
            </p>
            <label className="block">
              <span className="label">Squad name</span>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={defaultSquadName(profile?.display_name)}
                maxLength={60}
              />
            </label>
            <button
              className="btn-primary w-full mt-3 flex items-center justify-center gap-2"
              onClick={createSquad}
              disabled={busy}
            >
              {busy ? <><span className="spinner" /> Creating…</> : 'Create my squad'}
            </button>
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
          {/* "No logs" is no longer the empty state — an empty list now means
              an empty squad, which is a different sentence and a different
              problem. Everyone in the squad is listed regardless of activity;
              the ones on zero are simply on zero. */}
          {rows.length === 0 && squad && (
            <p className="text-muted text-center py-16">
              Just you so far. Share the join code above to fill this out.
            </p>
          )}
          {rows.length > 0 && rows.every((r) => r.logs === 0) && (
            <p className="text-muted-2 text-sm text-center pb-2">
              Nobody has logged anything {range === 'week' ? 'this week' : 'yet'} — the squad is
              here, the board is just waiting.
            </p>
          )}
          {rows.map((r, i) => (
            <div
              key={r.uid}
              data-testid="leaderboard-row"
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

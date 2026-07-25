import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getLatestPlan } from '../lib/api'
import { Header } from '../components/ui'

export default function Me() {
  const { user, profile, signOut } = useAuth()
  const nav = useNavigate()
  const [plan, setPlan] = useState(null)
  const [weighIns, setWeighIns] = useState([])
  const [counts, setCounts] = useState({ meals: 0, workouts: 0 })
  const pollRef = useRef(null)

  async function loadPlan() {
    if (!user) return
    const p = await getLatestPlan(user.id)
    setPlan(p)
    return p
  }

  async function loadRest() {
    const { data: w } = await supabase
      .from('weigh_ins').select('weight_kg,created_at').eq('user_id', user.id).order('created_at')
    setWeighIns(w ?? [])
    const { data: posts } = await supabase.from('posts').select('kind').eq('user_id', user.id)
    setCounts({
      meals: (posts ?? []).filter((p) => p.kind === 'meal').length,
      workouts: (posts ?? []).filter((p) => p.kind === 'workout').length,
    })
  }

  useEffect(() => { loadPlan(); loadRest() }, [user])

  // While a plan is generating, poll every 3s until it's ready or errored.
  useEffect(() => {
    if (plan?.status === 'generating') {
      pollRef.current = setInterval(async () => {
        const p = await loadPlan()
        if (p && p.status !== 'generating') clearInterval(pollRef.current)
      }, 3000)
      return () => clearInterval(pollRef.current)
    }
  }, [plan?.status, plan?.id])

  const first = weighIns[0]?.weight_kg
  const current = weighIns[weighIns.length - 1]?.weight_kg
  const change = first != null && current != null ? +(current - first).toFixed(1) : null

  const chartData = weighIns.map((w) => ({
    d: new Date(w.created_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
    kg: w.weight_kg,
  }))

  return (
    <div className="app-shell">
      <Header onSignOut={signOut} />
      <div className="px-5">
        <p className="text-muted uppercase tracking-[0.14em] text-[13px] mt-2">Personal</p>
        <h1 className="font-display text-[42px] font-800 mb-5">{profile?.display_name ?? 'You'}</h1>

        {/* FitPlan card — the state machine you asked to fix */}
        <PlanCard plan={plan} onOpen={() => nav('/plan')} onCreate={() => nav('/intake')} />

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 my-6">
          <Stat label="Meals" value={counts.meals} />
          <Stat label="Workouts" value={counts.workouts} />
          <Stat label="Change" value={change == null ? '—' : `${change > 0 ? '+' : ''}${change}`} unit="kg" />
        </div>

        {/* Weight chart */}
        <div className="bg-card border border-line rounded-xl2 p-5 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-[22px] font-700">Weight over time</h3>
            <button onClick={() => nav('/feed')} className="text-[#05201A] bg-mint rounded-full px-4 py-2 font-700 text-sm shadow-glow">⚖ Log weigh-in</button>
          </div>
          {current != null ? (
            <>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-display text-[40px] font-800 text-mint leading-none">{current}</span>
                <span className="text-muted">kg</span>
                {change != null && <span className="ml-auto text-mint">{change > 0 ? '+' : ''}{change} since start</span>}
              </div>
              <div className="h-44 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="d" tick={{ fill: '#7C938C', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: '#7C938C', fontSize: 12 }} axisLine={false} tickLine={false} width={38} />
                    <Tooltip contentStyle={{ background: '#0C1A18', border: '1px solid #1E3A34', borderRadius: 12, color: '#EAF3EF' }} />
                    <Line type="monotone" dataKey="kg" stroke="#2FE6A8" strokeWidth={3} dot={{ r: 4, fill: '#2FE6A8' }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p className="text-muted py-6">No weigh-ins yet. Tap + and choose “Weigh in” to start your line.</p>
          )}
        </div>

        {/* Badges */}
        <div className="bg-card border border-line rounded-xl2 p-5">
          <h3 className="font-display text-[22px] font-700 mb-4">Badges</h3>
          <div className="grid grid-cols-4 gap-3">
            <Badge emoji="🎉" label="First log" on={counts.meals + counts.workouts > 0} />
            <Badge emoji="🏋️" label="10 workouts" on={counts.workouts >= 10} />
            <Badge emoji="🥗" label="Clean week" on={counts.meals >= 5} />
            <Badge emoji="📉" label="Lost 5" on={change != null && change <= -5} />
          </div>
        </div>
      </div>
    </div>
  )
}

function PlanCard({ plan, onOpen, onCreate }) {
  // No plan yet → invite to create.
  if (!plan) {
    return (
      <button onClick={onCreate} className="w-full flex items-center gap-4 bg-card border border-mint/40 rounded-xl2 p-5 text-left">
        <div className="w-14 h-14 rounded-full bg-mint grid place-items-center text-[24px]">✨</div>
        <div className="flex-1">
          <div className="font-display text-[22px] font-700">Your FitPlan</div>
          <div className="text-muted">Not created yet — tap to build your plan.</div>
        </div>
        <Chevron />
      </button>
    )
  }

  // Generating → spinner + disabled feel, no navigation to a half-baked plan.
  if (plan.status === 'generating') {
    return (
      <div className="w-full flex items-center gap-4 bg-card border border-mint/40 rounded-xl2 p-5 pulsing">
        <div className="w-14 h-14 rounded-full bg-mint grid place-items-center">
          <span className="spinner" />
        </div>
        <div className="flex-1">
          <div className="font-display text-[22px] font-700">Your FitPlan</div>
          <div className="text-muted">Generating your plan… this takes ~30–60s. You can leave this screen.</div>
        </div>
      </div>
    )
  }

  // Errored → let them retry.
  if (plan.status === 'error') {
    return (
      <button onClick={onCreate} className="w-full flex items-center gap-4 bg-card border border-[#ff8b6b]/40 rounded-xl2 p-5 text-left">
        <div className="w-14 h-14 rounded-full bg-[#ff8b6b]/20 grid place-items-center text-[24px]">⚠️</div>
        <div className="flex-1">
          <div className="font-display text-[22px] font-700">Your FitPlan</div>
          <div className="text-muted">Generation failed. Tap to review your info and try again.</div>
        </div>
        <Chevron />
      </button>
    )
  }

  // Ready → open it.
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-4 bg-card border border-mint/40 rounded-xl2 p-5 text-left">
      <div className="w-14 h-14 rounded-full bg-mint grid place-items-center text-[24px] shadow-glow">✨</div>
      <div className="flex-1">
        <div className="font-display text-[22px] font-700">Your FitPlan</div>
        <div className="text-muted">Ready — tap to open your plan.</div>
      </div>
      <Chevron />
    </button>
  )
}

function Stat({ label, value, unit }) {
  return (
    <div className="bg-card border border-line rounded-2xl p-4">
      <div className="text-muted text-[13px] uppercase tracking-wide mb-1">{label}</div>
      <div className="font-display text-[30px] font-800 text-mint leading-none">{value}<span className="text-[15px] text-muted ml-1">{unit}</span></div>
    </div>
  )
}

function Badge({ emoji, label, on }) {
  return (
    <div className={`rounded-2xl border p-3 text-center ${on ? 'border-line bg-panel/60' : 'border-line/50 opacity-40'}`}>
      <div className="text-[26px] mb-1">{emoji}</div>
      <div className="text-muted text-[13px] leading-tight">{label}</div>
    </div>
  )
}

const Chevron = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C938C" strokeWidth="2" strokeLinecap="round"><path d="m9 6 6 6-6 6"/></svg>
)

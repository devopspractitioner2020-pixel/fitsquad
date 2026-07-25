import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getLatestPlan, refinePlan, MAX_REFINEMENTS, daysUntilRegen } from '../lib/api'
import { Header } from '../components/ui'

export default function PlanView() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [plan, setPlan] = useState(null)
  const [showRefine, setShowRefine] = useState(false)
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pollRef = useRef(null)

  async function load() {
    const p = await getLatestPlan(user.id)
    setPlan(p)
    return p
  }
  useEffect(() => { load() }, [user])

  // Poll while (re)generating.
  useEffect(() => {
    if (plan?.status === 'generating') {
      pollRef.current = setInterval(async () => {
        const p = await load()
        if (p?.status !== 'generating') { clearInterval(pollRef.current); setBusy(false); setShowRefine(false) }
      }, 3000)
      return () => clearInterval(pollRef.current)
    }
  }, [plan?.status])

  if (!plan) return <Shell nav={nav}><p className="text-muted px-5">Loading your plan…</p></Shell>

  if (plan.status === 'generating') {
    return (
      <Shell nav={nav}>
        <div className="px-5 flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-mint grid place-items-center mb-5 pulsing"><span className="spinner" /></div>
          <h2 className="font-display text-[24px] font-700 mb-1">Building your plan</h2>
          <p className="text-muted">This takes ~30–60 seconds. It’ll appear here automatically.</p>
        </div>
      </Shell>
    )
  }

  if (plan.status === 'error') {
    return (
      <Shell nav={nav}>
        <div className="px-5 py-16 text-center">
          <p className="font-display text-[22px] mb-2">That generation didn’t finish.</p>
          <p className="text-muted mb-6">{plan.error_message || 'Something went wrong while generating.'}</p>
          <button className="btn-primary" onClick={() => nav('/intake')}>Review info & try again</button>
        </div>
      </Shell>
    )
  }

  const refinementsLeft = MAX_REFINEMENTS - (plan.refinements_used ?? 0)
  const canRefine = plan.is_first_plan && refinementsLeft > 0
  const cooldown = daysUntilRegen(plan)

  async function doRefine() {
    setErr('')
    if (!request.trim()) { setErr('Describe what you’d like changed.'); return }
    setBusy(true)
    try {
      await refinePlan(plan.id, request.trim())
      setRequest('')
      await load() // status flips to 'generating', poller takes over
    } catch (e) {
      setErr(e.message ?? 'Could not apply that change.')
      setBusy(false)
    }
  }

  return (
    <Shell nav={nav}>
      <div className="px-5">
        {/* The generated plan renders in a sandboxed iframe (its own HTML/CSS). */}
        <div className="rounded-xl2 overflow-hidden border border-line bg-white">
          <iframe title="Your FitPlan" sandbox="allow-same-origin" srcDoc={plan.html} className="w-full" style={{ height: '78vh', border: 0 }} />
        </div>

        <div className="mt-5 space-y-3">
          {canRefine && !showRefine && (
            <button className="btn-ghost" onClick={() => setShowRefine(true)}>
              Tweak this plan · {refinementsLeft} left
            </button>
          )}

          {canRefine && showRefine && (
            <div className="bg-card border border-line rounded-xl2 p-4">
              <label className="label">What should change?</label>
              <textarea className="input min-h-[90px] resize-none" value={request} onChange={(e) => setRequest(e.target.value)}
                        placeholder="e.g. swap Thursday dinner, I don’t like fish; add more vegetarian options" />
              {err && <p className="text-[#ff9b8a] text-sm mt-2">{err}</p>}
              <div className="flex gap-3 mt-3">
                <button className="btn-ghost flex-1" onClick={() => setShowRefine(false)}>Cancel</button>
                <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={doRefine} disabled={busy}>
                  {busy ? <><span className="spinner" /> Applying…</> : 'Apply change'}
                </button>
              </div>
              <p className="text-muted-2 text-[12px] mt-3">Refinements are only available on your first plan ({refinementsLeft} of {MAX_REFINEMENTS} left).</p>
            </div>
          )}

          {!canRefine && (
            <p className="text-muted-2 text-sm text-center">
              {plan.is_first_plan ? 'No refinements left on this plan.' : 'Refinements apply to your first plan only.'}
            </p>
          )}

          <button className="btn-ghost" onClick={() => nav('/intake')} disabled={cooldown > 0}>
            {cooldown > 0 ? `New plan available in ${cooldown} day${cooldown > 1 ? 's' : ''}` : 'Update info & generate a new plan'}
          </button>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children, nav }) {
  return (
    <div className="app-shell">
      <Header />
      <button onClick={() => nav('/me')} className="text-muted px-5 mb-2">← Back to Me</button>
      {children}
    </div>
  )
}

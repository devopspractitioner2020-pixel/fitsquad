import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getLatestPlan, refinePlan, MAX_REVISIONS, daysUntilRegen,
  effectiveStatus, canRefine as canRefinePlan, refinementsLeft as refinementsLeftFor, pluralDays,
} from '../lib/api'
import { Header } from '../components/ui'
import PlanDocument from '../components/PlanDocument'

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
    if (!user?.id) return null
    const p = await getLatestPlan(user.id)
    setPlan(p)
    return p
  }
  useEffect(() => { load() }, [user?.id])

  // Poll while (re)generating. `effectiveStatus` reports a long-dead
  // 'generating' row as 'error', which also stops the poll — otherwise a
  // worker that died mid-flight would leave this spinning forever.
  const status = effectiveStatus(plan)

  useEffect(() => {
    if (status !== 'generating') return
    pollRef.current = setInterval(async () => {
      const p = await load()
      if (effectiveStatus(p) !== 'generating') {
        clearInterval(pollRef.current); setBusy(false); setShowRefine(false)
      }
    }, 3000)
    return () => clearInterval(pollRef.current)
  }, [status])

  if (!plan) return <Shell nav={nav}><p className="text-muted px-5">Loading your plan…</p></Shell>

  if (status === 'generating') {
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

  if (status === 'error') {
    return (
      <Shell nav={nav}>
        <div className="px-5 py-16 text-center">
          <p className="font-display text-[22px] mb-2">That generation didn’t finish.</p>
          <p className="text-muted mb-6">
            {plan.error_message || 'Something went wrong while generating.'}
          </p>
          <button className="btn-primary" onClick={() => nav('/intake')}>Review info & try again</button>
        </div>
      </Shell>
    )
  }

  const refinementsLeft = refinementsLeftFor(plan)
  const canRefine = canRefinePlan(plan)
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
        {plan.data ? (
          /* Structured plan: rendered by the app in its own design system.
             No untrusted markup is involved, so nothing needs sandboxing. */
          <PlanDocument plan={plan.data} />
        ) : (
          <>
            {/*
              Say which version you are looking at. Without this the fallback
              is silent: an old plan renders perfectly happily in the iframe,
              so the tabs and the app's own styling just appear to be missing
              and it reads as a bug rather than as an old plan.
            */}
            <div className="bg-[#ffd479]/[0.08] border border-[#ffd479]/30 rounded-xl2 p-4 mb-4">
              <p className="font-display font-700 text-[#ffd479] mb-1">Older plan format</p>
              <p className="text-muted text-sm mb-3">
                This plan was written before the app rendered plans itself, so it shows as one
                long document — no tabs, and tweaks are unavailable. Generating a fresh one
                gives you the Overview / Food / Training layout.
              </p>
              <button className="btn-ghost" onClick={() => nav('/intake')}>
                {cooldown > 0
                  ? `Update your answers · new plan in ${pluralDays(cooldown)}`
                  : 'Generate a fresh plan'}
              </button>
            </div>

            {/*
              LEGACY: a plan generated before the structured-output rewrite,
              stored as model-authored HTML. It is untrusted input, so it is
              rendered in a fully sandboxed iframe.

              `sandbox=""` (empty, not omitted) opts in to every restriction:
              no scripts, and — critically — an opaque origin. An earlier
              version used `sandbox="allow-same-origin"`, which gave the frame
              this app's origin; the moment anyone added `allow-scripts`
              alongside it the sandbox would collapse and the frame could read
              the Supabase session out of localStorage. Never add
              `allow-scripts` here.
            */}
            <div className="rounded-xl2 overflow-hidden border border-line bg-white">
              <iframe title="Your FitPlan" sandbox="" referrerPolicy="no-referrer" srcDoc={plan.html} className="w-full" style={{ height: '78vh', border: 0 }} />
            </div>
          </>
        )}

        <div className="mt-5 space-y-3">
          {canRefine && !showRefine && (
            <button className="btn-ghost" onClick={() => setShowRefine(true)}>
              Tweak this plan · {refinementsLeft} change{refinementsLeft === 1 ? '' : 's'} left
            </button>
          )}

          {canRefine && showRefine && (
            <div className="bg-card border border-line rounded-xl2 p-4">
              <label className="block">
                <span className="label">What should change?</span>
                <textarea className="input min-h-[90px] resize-none" value={request} onChange={(e) => setRequest(e.target.value)}
                          placeholder="e.g. swap Thursday dinner, I don’t like fish; add more vegetarian options" />
              </label>
              {err && <p className="text-[#ff9b8a] text-sm mt-2">{err}</p>}
              <div className="flex gap-3 mt-3">
                <button className="btn-ghost flex-1" onClick={() => setShowRefine(false)}>Cancel</button>
                <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={doRefine} disabled={busy}>
                  {busy ? <><span className="spinner" /> Applying…</> : 'Apply change'}
                </button>
              </div>
              <p className="text-muted-2 text-[12px] mt-3">
                Your first plan comes with {MAX_REVISIONS} changes ({refinementsLeft} left).
                A change can be a tweak like this, or a full regenerate with new answers.
              </p>
            </div>
          )}

          {!canRefine && (
            <p className="text-muted-2 text-sm text-center">
              {!plan.data
                ? 'This plan was made with an older version of the app. Generate a fresh one to use tweaks.'
                : plan.is_first_plan
                  ? 'No refinements left on this plan.'
                  : 'Refinements apply to your first plan only.'}
            </p>
          )}

          {/* Always navigable. Disabling this during the cooldown left the
              user with no route to their own answers at all — they could
              neither review nor update them for a week. The cooldown gates
              generating, not editing. */}
          <button className="btn-ghost" onClick={() => nav('/intake')}>
            {cooldown > 0
              ? `Update your answers · new plan in ${pluralDays(cooldown)}`
              : 'Update info & generate a new plan'}
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

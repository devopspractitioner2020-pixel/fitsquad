import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { generatePlan, getLatestPlan, daysUntilRegen } from '../lib/api'
import { Header } from '../components/ui'

const BLANK = {
  name: '', age: '', sex: 'Male', height_cm: '', weight_kg: '', bodyfat_pct: '', goal_weight_kg: '',
  goal: 'Lose fat', event: '',
  activity_level: 'Moderate — active job or regular training', training_freq: '', sport: '', steps: '',
  health_notes: '',
  cuisines_dishes: '', loved_foods: '', disliked_foods: '',
  alcohol: '', eating_out: '', home_pct: '', supplements: '',
}

export default function Intake() {
  const { user, profile } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ ...BLANK, name: profile?.display_name ?? '' })
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [cooldown, setCooldown] = useState(0)

  // Recycle the previous intake so regeneration only needs the new weight.
  useEffect(() => {
    (async () => {
      if (!user) return
      const last = await getLatestPlan(user.id)
      if (last) {
        setCooldown(daysUntilRegen(last))
        if (last.intake) setF((prev) => ({ ...prev, ...last.intake }))
      }
    })()
  }, [user])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function saveIntake() {
    await supabase.from('intakes').upsert({ user_id: user.id, data: f })
  }

  async function generate() {
    setErr('')
    if (!ack) { setErr('Please tick the box to confirm you understand this is not medical advice.'); return }
    if (cooldown > 0) { setErr(`You can regenerate in ${cooldown} day${cooldown > 1 ? 's' : ''}.`); return }
    setBusy(true)
    try {
      await saveIntake()
      await generatePlan(f) // Edge Function inserts a 'generating' plan row
      nav('/me') // Me screen shows the spinner and polls until ready
    } catch (e) {
      setErr(e.message ?? 'Could not start generation. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <Header />
      <div className="px-5">
        <button onClick={() => nav('/me')} className="text-muted mb-3">← Back to Me</button>
        <p className="text-muted uppercase tracking-[0.14em] text-[13px]">Personalized</p>
        <h1 className="font-display text-[38px] font-800 mb-2">FitPlan intake</h1>
        <p className="text-muted mb-6">Tell us about your goals, schedule, food and constraints. All fields except goal are optional — the more you share, the better the plan.</p>

        {cooldown > 0 && (
          <div className="bg-card border border-line rounded-xl2 p-4 mb-5 text-muted">
            Your last plan is recent. You can generate a fresh one in <b className="text-cream">{cooldown} day{cooldown > 1 ? 's' : ''}</b>. You can still edit and save your info now.
          </div>
        )}

        <Section n="1" title="About you">
          <F label="Name"><input className="input" value={f.name} onChange={set('name')} /></F>
          <Row>
            <F label="Age"><input className="input" type="number" value={f.age} onChange={set('age')} /></F>
            <F label="Sex">
              <select className="input" value={f.sex} onChange={set('sex')}><option>Male</option><option>Female</option></select>
            </F>
          </Row>
          <Row>
            <F label="Height (cm)"><input className="input" type="number" value={f.height_cm} onChange={set('height_cm')} /></F>
            <F label="Current weight (kg)"><input className="input" inputMode="decimal" value={f.weight_kg} onChange={set('weight_kg')} /></F>
          </Row>
          <Row>
            <F label="Body-fat % (optional)"><input className="input" type="number" value={f.bodyfat_pct} onChange={set('bodyfat_pct')} placeholder="18" /></F>
            <F label="Goal weight (kg, optional)"><input className="input" inputMode="decimal" value={f.goal_weight_kg} onChange={set('goal_weight_kg')} /></F>
          </Row>
        </Section>

        <Section n="2" title="Your goal">
          <F label="Primary goal *">
            <select className="input" value={f.goal} onChange={set('goal')}>
              <option>Lose fat</option><option>Recomposition</option><option>Gain muscle</option><option>Maintain</option>
            </select>
          </F>
          <F label="Target event & date (optional)"><input className="input" value={f.event} onChange={set('event')} placeholder='e.g. "wedding, 4 months away"' /></F>
        </Section>

        <Section n="3" title="Activity & training">
          <F label="Activity level">
            <select className="input" value={f.activity_level} onChange={set('activity_level')}>
              <option>Sedentary — desk job, little movement</option>
              <option>Light — some walking or 1–2 sessions</option>
              <option>Moderate — active job or regular training</option>
              <option>High — 5–6 sessions a week</option>
            </select>
          </F>
          <F label="Current training frequency"><input className="input" value={f.training_freq} onChange={set('training_freq')} placeholder="2 times a week gym" /></F>
          <F label="Sport played (optional)"><input className="input" value={f.sport} onChange={set('sport')} placeholder="Football once a week" /></F>
          <F label="Average daily steps"><input className="input" type="number" value={f.steps} onChange={set('steps')} placeholder="7000" /></F>
        </Section>

        <Section n="4" title="Health notes">
          <F label="Anything we should know? (optional)"><textarea className="input min-h-[90px] resize-none" value={f.health_notes} onChange={set('health_notes')} placeholder="e.g. bad cholesterol a bit high, good cholesterol a bit low" /></F>
        </Section>

        <Section n="5" title="Food & preferences">
          <F label="Cuisines & typical dishes"><textarea className="input min-h-[90px] resize-none" value={f.cuisines_dishes} onChange={set('cuisines_dishes')} placeholder="Peruvian, and pasta/Italian at home" /></F>
          <F label="Foods you LOVE (never removed)"><textarea className="input min-h-[70px] resize-none" value={f.loved_foods} onChange={set('loved_foods')} placeholder="Bread, rice, potatoes, chicken, meat, fish" /></F>
          <F label="Foods you DISLIKE (never included)"><textarea className="input min-h-[70px] resize-none" value={f.disliked_foods} onChange={set('disliked_foods')} placeholder="Greek yogurt" /></F>
        </Section>

        <Section n="6" title="Lifestyle & habits">
          <F label="Alcohol habits"><input className="input" value={f.alcohol} onChange={set('alcohol')} placeholder="3 beers a week" /></F>
          <F label="Eating-out habits"><input className="input" value={f.eating_out} onChange={set('eating_out')} placeholder="One restaurant dinner a week" /></F>
          <F label="% of meals cooked at home"><input className="input" type="number" value={f.home_pct} onChange={set('home_pct')} placeholder="70" /></F>
          <F label="Current supplements"><input className="input" value={f.supplements} onChange={set('supplements')} placeholder="Magnesium, omega 3, multivitamin" /></F>
        </Section>

        <label className="flex items-start gap-3 bg-card border border-line rounded-xl2 p-4 my-5">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 w-5 h-5 accent-[#2FE6A8]" />
          <span className="text-muted">I understand this is general nutrition and training information, not medical advice. If I have any health condition or take medication I will consult a doctor before making changes.</span>
        </label>

        {err && <p className="text-[#ff9b8a] text-sm mb-3">{err}</p>}

        <button className="btn-ghost mb-3" onClick={async () => { await saveIntake(); nav('/me') }}>Save intake</button>
        <button className="btn-primary flex items-center justify-center gap-2" onClick={generate} disabled={busy || cooldown > 0}>
          {busy ? <><span className="spinner" /> Starting…</> : 'Save & generate my FitPlan'}
        </button>
        <p className="text-muted-2 text-sm text-center mt-3 mb-2">Generating takes ~30–60 seconds. You can leave this screen — track progress on Me → Your FitPlan.</p>
      </div>
    </div>
  )
}

function Section({ n, title, children }) {
  return (
    <div className="bg-card/40 border border-line rounded-xl2 p-5 mb-4">
      <h3 className="font-display text-mint tracking-wide font-700 mb-4">{n} · {title.toUpperCase()}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  )
}
const F = ({ label, children }) => <div><label className="label">{label}</label>{children}</div>
const Row = ({ children }) => <div className="grid grid-cols-2 gap-3">{children}</div>

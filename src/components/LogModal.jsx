import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { uploadPhoto } from '../lib/image'

// Photo picker with instant local preview. Compression + upload happens on submit.
function PhotoField({ file, setFile }) {
  const preview = file ? URL.createObjectURL(file) : null
  return (
    <div>
      <label className="label">Photo (optional)</label>
      {preview ? (
        <div className="relative">
          <img src={preview} alt="Selected" className="w-full h-44 object-cover rounded-2xl border border-line" />
          <button
            type="button"
            onClick={() => setFile(null)}
            className="absolute top-2 right-2 bg-ink/80 border border-line rounded-full w-8 h-8 grid place-items-center text-cream"
            aria-label="Remove photo"
          >×</button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 h-24 rounded-2xl border border-dashed border-line text-muted cursor-pointer">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C938C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>
          Take or choose a photo
          {/* capture attribute opens the camera directly on phones */}
          <input type="file" accept="image/*" capture="environment" className="hidden"
                 onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      )}
      <p className="text-muted-2 text-[12px] mt-2">Photos are shrunk on your phone before upload to save data.</p>
    </div>
  )
}

const TYPES = [
  { key: 'workout', label: 'Workout', icon: 'M6 7l3 3M15 15l3 3M4 12l4-4M12 20l4-4M8 5l11 11' },
  { key: 'meal', label: 'Meal', icon: 'M6 3v8a2 2 0 0 0 4 0V3M8 11v10M18 3c-1.5 0-3 2-3 5s1.5 4 3 4v9' },
  { key: 'weigh', label: 'Weigh in', icon: 'M12 4a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8ZM12 12l3-3' },
  { key: 'tip', label: 'Share tip', icon: 'M12 3l2 5 5 .5-4 3.5 1.3 5L12 19l-4.3 3 1.3-5-4-3.5 5-.5L12 3z' },
]

export default function LogModal({ open, onClose, onLogged }) {
  const { user, profile } = useAuth()
  const [type, setType] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // shared fields
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  // type-specific
  const [minutes, setMinutes] = useState('')
  const [mealType, setMealType] = useState('Lunch')
  const [isCheat, setIsCheat] = useState(false)
  const [weight, setWeight] = useState('')
  const [healthy, setHealthy] = useState(true)

  if (!open) return null

  function reset() {
    setType(null); setTitle(''); setNote(''); setFile(null); setMinutes('')
    setMealType('Lunch'); setIsCheat(false); setWeight(''); setHealthy(true); setErr('')
  }
  function close() { reset(); onClose() }

  async function submit() {
    setErr(''); setBusy(true)
    try {
      let photo_url = null
      if (file) photo_url = await uploadPhoto(supabase, user.id, file)

      if (type === 'weigh') {
        const w = parseFloat(String(weight).replace(',', '.'))
        if (!w) throw new Error('Enter a weight to log.')
        const { error } = await supabase.from('weigh_ins').insert({
          user_id: user.id, weight_kg: w, note: note || null,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.from('posts').insert({
          user_id: user.id,
          author_name: profile?.display_name ?? 'You',
          kind: type, // workout | meal | tip
          title: title || defaultTitle(type),
          note: note || null,
          minutes: type === 'workout' && minutes ? parseInt(minutes) : null,
          meal_type: type === 'meal' ? mealType : null,
          is_cheat: type === 'meal' ? isCheat : null,
          is_healthy: type === 'meal' ? healthy && !isCheat : null,
          photo_url,
        })
        if (error) throw error
      }
      onLogged?.()
      close()
    } catch (e) {
      setErr(e.message ?? 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={close} />
      <div className="relative w-full max-w-[480px] bg-panel border-t border-line rounded-t-xl3 p-6 pb-8 max-h-[88dvh] overflow-y-auto">
        <button onClick={close} className="absolute top-5 right-5 w-9 h-9 rounded-full border border-line text-cream grid place-items-center" aria-label="Close">×</button>

        {!type && (
          <>
            <h2 className="font-display text-[30px] font-700 mb-6">What did you crush?</h2>
            <div className="grid grid-cols-2 gap-4">
              {TYPES.map((t) => (
                <button key={t.key} onClick={() => setType(t.key)}
                        className="bg-card border border-line rounded-2xl py-7 grid place-items-center gap-3 active:bg-card-2">
                  <div className="w-14 h-14 rounded-2xl bg-mint grid place-items-center">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#05201A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon}/></svg>
                  </div>
                  <span className="font-display text-[19px] font-700">{t.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {type && (
          <>
            <h2 className="font-display text-[28px] font-700 mb-5">{headline(type)}</h2>

            {type === 'workout' && (
              <div className="space-y-4">
                <Field label="What did you do?" value={title} setValue={setTitle} placeholder="Push day" />
                <Field label="Minutes" value={minutes} setValue={setMinutes} placeholder="45" type="number" />
                <PhotoField file={file} setFile={setFile} />
                <Field label="Note (optional)" value={note} setValue={setNote} placeholder="Felt strong" textarea />
              </div>
            )}

            {type === 'meal' && (
              <div className="space-y-4">
                <Field label="What did you eat?" value={title} setValue={setTitle} placeholder="Grilled chicken salad" />
                <div>
                  <label className="label">Meal</label>
                  <select className="input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                    <option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option>
                  </select>
                </div>
                <Toggle label="Was it a sin? 😈" hint="Own the cheat meal." value={isCheat} setValue={setIsCheat} />
                <PhotoField file={file} setFile={setFile} />
                <Field label="Note (optional)" value={note} setValue={setNote} placeholder="Extra details…" textarea />
              </div>
            )}

            {type === 'weigh' && (
              <div className="space-y-4">
                <Field label="Weight (kg)" value={weight} setValue={setWeight} placeholder="e.g. 74.5" type="number" />
                <Field label="Note (optional)" value={note} setValue={setNote} placeholder="How are you feeling?" textarea />
              </div>
            )}

            {type === 'tip' && (
              <div className="space-y-4">
                <Field label="Share a tip, recipe, or idea" value={title} setValue={setTitle} placeholder="Try this protein pancake recipe…" textarea />
                <PhotoField file={file} setFile={setFile} />
              </div>
            )}

            {err && <p className="text-[#ff9b8a] text-sm mt-4">{err}</p>}

            <div className="flex gap-3 mt-6">
              <button onClick={() => setType(null)} className="btn-ghost flex-1">Back</button>
              <button onClick={submit} disabled={busy} className="btn-primary flex-1 flex items-center justify-center gap-2">
                {busy ? <><span className="spinner" /> Saving…</> : 'Log it'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, setValue, placeholder, type = 'text', textarea }) {
  return (
    <div>
      <label className="label">{label}</label>
      {textarea
        ? <textarea className="input min-h-[96px] resize-none" value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
        : <input className="input" type={type} inputMode={type === 'number' ? 'decimal' : undefined} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />}
    </div>
  )
}

function Toggle({ label, hint, value, setValue }) {
  return (
    <button type="button" onClick={() => setValue(!value)}
            className="w-full flex items-center justify-between bg-card border border-line rounded-2xl p-4 text-left">
      <div>
        <div className="font-display text-[19px] font-700">{label}</div>
        <div className="text-muted text-sm">{hint}</div>
      </div>
      <div className={`w-14 h-8 rounded-full p-1 transition-colors ${value ? 'bg-mint' : 'bg-line'}`}>
        <div className={`w-6 h-6 rounded-full bg-ink transition-transform ${value ? 'translate-x-6' : ''}`} />
      </div>
    </button>
  )
}

const defaultTitle = (t) => (t === 'workout' ? 'Workout' : t === 'meal' ? 'Meal' : 'Tip')
const headline = (t) => (t === 'workout' ? 'Log a workout' : t === 'meal' ? 'Log a meal' : t === 'weigh' ? 'Log your weight' : 'Share with the squad')

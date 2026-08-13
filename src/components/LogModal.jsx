import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { uploadPhoto } from '../lib/image'
import { parseVideoUrl, explainVideoUrl } from '../lib/embeds'
import { WORKOUT_TYPES, MEAL_TAGS, labelsForKind } from '../lib/postLabels'

// Photo picker with instant local preview. Compression + upload happens on submit.
function PhotoField({ file, setFile }) {
  const preview = file ? URL.createObjectURL(file) : null
  return (
    <div>
      <span className="label">Photo (optional)</span>
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
        /*
          TWO buttons, not one input.
          
          The first version forced the camera with capture="environment" —
          the gallery was unreachable. Dropping the attribute made the
          gallery reachable but handed the decision to the browser, and
          Android went straight to the photo picker with no way to shoot one.
          Neither single input can offer both, because `capture` is a
          statement about the ONLY source, not a preference.
          
          So: one input with capture for the camera, one without for the
          library, and the person picks. No guessing what the OS will do.
        */
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col items-center justify-center gap-2 h-24 rounded-2xl border border-dashed border-line text-muted cursor-pointer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C938C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>
            <span className="text-sm">Take a photo</span>
            <input
              type="file" accept="image/*" capture="environment" className="hidden"
              aria-label="Take a photo"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <label className="flex flex-col items-center justify-center gap-2 h-24 rounded-2xl border border-dashed border-line text-muted cursor-pointer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C938C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            <span className="text-sm">From gallery</span>
            <input
              type="file" accept="image/*" className="hidden"
              aria-label="Choose from gallery"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
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

export default function LogModal({ open, onClose, onLogged, initialType = null }) {
  const { user, profile } = useAuth()
  // Openers that know what the person is here to do (the Log weigh-in button
  // on Me) skip the picker. Back still returns to it, so the shortcut never
  // costs anyone access to the other three.
  const [type, setType] = useState(initialType)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // shared fields
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState('')
  // type-specific
  const [minutes, setMinutes] = useState('')
  const [mealType, setMealType] = useState('Lunch')
  const [isCheat, setIsCheat] = useState(false)
  const [weight, setWeight] = useState('')
  const [healthy, setHealthy] = useState(true)
  const [workoutType, setWorkoutType] = useState('strength')
  const [mealTags, setMealTags] = useState(() => new Set())

  if (!open) return null

  function reset() {
    setType(initialType); setTitle(''); setNote(''); setFile(null); setMinutes('')
    setMealType('Lunch'); setIsCheat(false); setWeight(''); setHealthy(true)
    setWorkoutType('strength'); setMealTags(new Set())
    setVideoUrl(''); setErr('')
  }
  function close() { reset(); onClose() }

  async function submit() {
    setErr(''); setBusy(true)
    try {
      let photo_url = null
      if (file) photo_url = await uploadPhoto(supabase, user.id, file)

      // Short links hide the real video ID behind a redirect. Resolve once,
      // here at save time, so the feed always has an embeddable URL and no
      // reader ever pays for the round trip.
      let video_url = videoUrl.trim() || null
      if (video_url) {
        const parsed = parseVideoUrl(video_url)
        if (!parsed) {
          // The field above already explains exactly what is wrong with the
          // link, so this says what to DO rather than repeating it. Two
          // copies of the same sentence in one sheet is just noise — and
          // two DIFFERENT wordings of it, which is what this used to do, is
          // worse.
          throw new Error('Fix the video link above, or clear it to post without a video.')
        }
        // Normalised: strips any caption text the share sheet included and
        // drops tracking params, so what we store is the canonical link.
        video_url = parsed.url

        if (parsed.needsResolve) {
          // Short links are what the TikTok app actually gives people, so
          // this path is the common case, not the edge case.
          //
          // If expansion fails we save the short link ANYWAY rather than
          // rejecting the post. TikTok's edge sometimes refuses datacenter
          // IPs, and losing a tip somebody just typed because of that would
          // be a far worse outcome than a card in the feed that opens the
          // video in TikTok instead of playing inline.
          try {
            const { data } = await supabase.functions.invoke('resolve-link', { body: { url: video_url } })
            if (data?.url) video_url = data.url
          } catch {
            // Deliberately swallowed — see above.
          }
        }
      }

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
          // Only the labels that belong to this kind. A workout_type on a
          // meal violates a CHECK constraint in migration 0013, and more to
          // the point it is meaningless.
          ...labelsForKind(type, { workoutType, mealTags: [...mealTags] }),
          photo_url,
          video_url,
        })
        if (error) throw error
      }
      // Pass the kind along: the caller decides where to go next, and a
      // weigh-in and a post deserve different answers.
      onLogged?.(type)
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
                {/* There was no way to say this at all before: the card
                    called every single workout "Strength", whether it was a
                    10k, a football match or a yoga class. */}
                <label className="block">
                  <span className="label">Type</span>
                  <select className="input" value={workoutType} onChange={(e) => setWorkoutType(e.target.value)}>
                    {WORKOUT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                </label>
                <Field label="Minutes" value={minutes} setValue={setMinutes} placeholder="45" type="number" />
                <PhotoField file={file} setFile={setFile} />
                <Field label="Note (optional)" value={note} setValue={setNote} placeholder="Felt strong" textarea />
              </div>
            )}

            {type === 'meal' && (
              <div className="space-y-4">
                <Field label="What did you eat?" value={title} setValue={setTitle} placeholder="Grilled chicken salad" />
                <label className="block">
                  <span className="label">Meal</span>
                  <select className="input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                    <option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option>
                  </select>
                </label>
                {/* A meal is not one bit. `is_healthy` is what the
                    leaderboard counts and it stays a boolean, but these
                    describe — a meal can be home-cooked AND high in protein,
                    or none of it, and saying so is not the same as scoring
                    it. */}
                <TagPicker label="Labels (optional)" options={MEAL_TAGS} selected={mealTags} setSelected={setMealTags} />
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
                <LinkField url={videoUrl} setUrl={setVideoUrl} />
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

// Paste a TikTok / Reel / Short link. Validated as they type, so they get
// instant feedback here rather than a dead card in the feed later.
//
// The feedback names the ACTUAL problem. A profile link is the most common
// paste by far — TikTok's "Share profile" hands you `tiktok.com/@user?…`,
// which is close enough to a video link that a generic "not recognised"
// reads like the app is broken rather than like the wrong link was copied.
function LinkField({ url, setUrl }) {
  const verdict = explainVideoUrl(url)
  const show = url.trim() && verdict.reason !== 'empty'
  return (
    <label className="block">
      <span className="label">Video link (optional)</span>
      <input
        className="input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a TikTok, Reel or YouTube Short link"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck="false"
        aria-invalid={show && !verdict.ok ? 'true' : undefined}
      />
      {show && (
        <p className={`text-sm mt-2 ${verdict.ok ? 'text-mint' : 'text-[#ffd479]'}`}>
          {verdict.message}
        </p>
      )}
      <p className="text-muted-2 text-[12px] mt-2">
        The video streams from the original platform. Nothing is copied or stored here.
      </p>
    </label>
  )
}

// The control is nested inside the <label>, which associates the two without
// needing an id. Previously the label was a sibling, so screen readers
// announced every field as an unlabelled text box.
function Field({ label, value, setValue, placeholder, type = 'text', textarea }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {textarea
        ? <textarea className="input min-h-[96px] resize-none" value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
        : <input className="input" type={type} inputMode={type === 'number' ? 'decimal' : undefined} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />}
    </label>
  )
}

/**
 * Multi-select chips.
 *
 * Real checkboxes underneath, visually hidden and styled through `peer`, so
 * the whole group is keyboard-navigable and announced as a set rather than
 * being a row of divs that only respond to a mouse.
 */
function TagPicker({ label, options, selected, setSelected }) {
  const toggle = (value, on) => setSelected((prev) => {
    const next = new Set(prev)
    if (on) next.add(value)
    else next.delete(value)
    return next
  })

  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={selected.has(o.value)}
              onChange={(e) => toggle(o.value, e.target.checked)}
            />
            <span className="inline-block rounded-full border border-line px-4 py-2 text-sm text-muted peer-checked:border-mint/50 peer-checked:bg-mint/[0.12] peer-checked:text-mint peer-focus-visible:ring-2 peer-focus-visible:ring-mint">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
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

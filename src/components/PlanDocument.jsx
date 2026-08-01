import { useRef, useState } from 'react'
import { macroBreakdown, KCAL_PER_G, KCAL_PER_G_ALCOHOL } from '../lib/macros'

// Renders a structured FitPlan using the app's own design system.
//
// This replaces ~90 lines of prompt that described hex codes, border radii and
// section order to the model on every single generation. Three things follow
// from moving it here:
//
//   - Every plan looks the same, because there is one implementation.
//   - Changing the design updates every plan ever generated, including old
//     ones, because the design is no longer baked into stored output.
//   - There is no untrusted HTML to sandbox. Everything below is React
//     rendering text nodes, so injected markup cannot execute.
//
// The shape it consumes is supabase/functions/generate-plan/schema.ts, plus a
// `numbers` object computed server-side by nutrition.ts.
//
// LAYOUT. A full plan is long — nine sections, a seven-day menu and a
// three-day split. As one scroll it meant hunting for Thursday's dinner by
// thumb every time. It is now three tabs, chosen so each answers a different
// question someone actually opens the app to ask:
//
//   Overview  — what are my numbers, and how do I know it's working
//   Food      — what am I eating, and why
//   Training  — what am I doing in the gym
//
// The disclaimer sits OUTSIDE the tabs, always visible. Medical wording that
// only appears if you happen to pick the right tab is not a disclaimer.

const VERDICT_STYLE = {
  keep: { label: 'Keep', className: 'text-mint bg-mint/[0.12]' },
  adjust: { label: 'Adjust', className: 'text-[#ffd479] bg-[#ffd479]/[0.12]' },
  optional: { label: 'Optional', className: 'text-muted bg-white/[0.05]' },
  'dont-start': { label: "Don't start", className: 'text-[#ff8b6b] bg-[#ff8b6b]/[0.12]' },
}

const TAG_LABEL = {
  training: '🏋️ training',
  sport: '⚽ sport',
  'oily-fish': '🐟 oily fish',
  legumes: '🫘 legumes',
  rest: '😌 rest',
  social: '🍻 social',
  restaurant: '🍽️ out',
}

const TABS = [
  { id: 'overview', emoji: '✨', label: 'Overview' },
  { id: 'food', emoji: '🍽️', label: 'Food' },
  { id: 'training', emoji: '🏋️', label: 'Training' },
]

export default function PlanDocument({ plan }) {
  const [tab, setTab] = useState('overview')
  const topRef = useRef(null)

  if (!plan) return null
  const n = plan.numbers

  function go(id) {
    setTab(id)
    // Jump back to the tab bar. Switching from the bottom of a seven-day menu
    // into Training would otherwise drop you halfway down the split.
    topRef.current?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <article lang={plan.language || undefined}>
      <div ref={topRef} />

      {/* Sticky, so the other two sections stay one thumb-reach away no
          matter how far into a section you have scrolled. */}
      <div
        role="tablist"
        aria-label="Plan sections"
        className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-ink/90 backdrop-blur"
      >
        <div className="flex gap-1 bg-panel/70 border border-line rounded-2xl p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`plan-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`plan-panel-${t.id}`}
              onClick={() => go(t.id)}
              className={`flex-1 py-2.5 rounded-xl font-display font-700 text-[15px] transition-colors ${
                tab === t.id ? 'bg-card text-cream' : 'text-muted'
              }`}
            >
              <span aria-hidden="true">{t.emoji}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`plan-panel-${tab}`}
        aria-labelledby={`plan-tab-${tab}`}
        className="space-y-5 mt-4"
      >
        {tab === 'overview' && (
          <>
            <Hero hero={plan.hero} />
            {n && <DailyNumbers numbers={n} explainer={plan.numbers_explainer} />}
            <Tracking tracking={plan.tracking} />
          </>
        )}

        {tab === 'food' && (
          <>
            <Plate plate={plan.plate} />
            <Myths myths={plan.myths} />
            <Week week={plan.week} targets={plan.weekly_targets} />
            <Supplements supplements={plan.supplements} />
          </>
        )}

        {tab === 'training' && <Training training={plan.training} />}
      </div>

      {/* Never behind a tab. */}
      <Disclaimer text={plan.disclaimer} />
    </article>
  )
}

/* ------------------------------------------------------------------ */

function Section({ title, eyebrow, children }) {
  return (
    <section className="bg-card border border-line rounded-xl2 p-5">
      {eyebrow && (
        <p className="text-mint uppercase tracking-[0.14em] text-[12px] font-700 mb-1">{eyebrow}</p>
      )}
      {title && <h2 className="font-display text-[24px] font-800 mb-4">{title}</h2>}
      {children}
    </section>
  )
}

function Hero({ hero }) {
  if (!hero) return null
  return (
    <section className="bg-card border border-mint/40 rounded-xl2 p-6">
      <p className="text-muted uppercase tracking-[0.14em] text-[12px]">Your FitPlan</p>
      <h1 className="font-display text-[34px] font-800 leading-tight mt-1">{hero.name}</h1>
      <p className="text-mint font-display text-[19px] font-700 mt-1">{hero.goal_label}</p>
      {hero.target_event && (
        <p className="text-muted text-sm mt-1">🎯 {hero.target_event}</p>
      )}
      {hero.headline && <p className="text-cream mt-4 leading-relaxed">{hero.headline}</p>}
    </section>
  )
}

function DailyNumbers({ numbers, explainer }) {
  return (
    <Section eyebrow="Daily numbers" title="What to aim for">
      {/* TDEE first and largest — it is the number that reframes everything
          else, and burying it under the target was the old layout's mistake. */}
      <div className="bg-panel/60 border border-line rounded-2xl p-5 mb-3">
        <div className="text-muted uppercase tracking-wide text-[12px]">Calories burned per day</div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[44px] font-800 text-mint leading-none">{numbers.tdee}</span>
          <span className="text-muted">kcal</span>
        </div>
        <p className="text-muted-2 text-[12px] mt-2">
          Estimated with {numbers.formula_label}
          {numbers.lean_body_mass_kg != null && ` from ${numbers.lean_body_mass_kg} kg lean mass`}
          {' · '}BMR {numbers.bmr} × {numbers.activity_multiplier} activity
        </p>
      </div>

      <div className="bg-mint/[0.08] border border-mint/40 rounded-2xl p-5 mb-4">
        <div className="text-muted uppercase tracking-wide text-[12px]">Your daily target</div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[38px] font-800 text-cream leading-none">{numbers.target_kcal}</span>
          <span className="text-muted">kcal</span>
          {numbers.goal_adjustment_kcal !== 0 && (
            <span className="ml-auto text-mint font-700">
              {numbers.goal_adjustment_kcal > 0 ? '+' : ''}{numbers.goal_adjustment_kcal}
            </span>
          )}
        </div>
      </div>

      <Macros numbers={numbers} />

      {explainer && <p className="text-muted mt-4 leading-relaxed">{explainer}</p>}

      {/* Surfaced, not hidden: if the safety floor moved the target, the
          person is told why rather than just seeing a number they didn't
          expect. */}
      {numbers.adjustments?.length > 0 && (
        <ul className="mt-4 space-y-2">
          {numbers.adjustments.map((a, i) => (
            <li key={i} className="text-[13px] text-[#ffd479] bg-[#ffd479]/[0.08] border border-[#ffd479]/30 rounded-xl px-3 py-2">
              {a}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// Three full-width rows rather than three small tiles side by side.
//
// The tiles fitted a number and a unit and nothing else, which meant the plan
// stated three gram figures and never once said what any of them were for, or
// how they related to the calorie target directly above them. Reading it, the
// macros looked like three extra rules on top of the calories rather than
// what they are: the calories, itemised.
const MACRO_BAR = {
  protein: '#7CC5FF',
  carbs: '#FFD479',
  fat: '#2FE6A8',
}

function Macros({ numbers }) {
  const breakdown = macroBreakdown(numbers)
  if (!breakdown) return null

  return (
    <div className="space-y-3">
      {breakdown.macros.map((m) => (
        <div key={m.key} className="bg-panel/60 border border-line rounded-2xl p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-muted uppercase tracking-wide text-[12px] flex-1">{m.label}</span>
            <span className="font-display text-[30px] font-800 leading-none" style={{ color: MACRO_BAR[m.key] }}>
              {m.grams}
            </span>
            <span className="text-muted text-sm">g</span>
          </div>

          {/* The share of the day's energy, as a bar and as a number. This is
              the part that makes the three rows add up to the target above
              instead of floating next to it. */}
          <div className="h-1.5 rounded-full bg-white/[0.06] mt-3 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${m.share}%`, background: MACRO_BAR[m.key] }}
            />
          </div>
          <p className="text-muted-2 text-[12px] mt-2">
            {m.kcal} kcal · {m.share}% of your calories · {m.kcalPerG} kcal per gram
            {m.perKg != null && ` · ${m.perKg} g/kg`}
          </p>

          <p className="text-muted text-[13px] mt-2 leading-relaxed">
            <span className="text-cream">{m.what}</span> {m.why}
          </p>
        </div>
      ))}

      {/* The point the tiles could never make. */}
      <div className="bg-mint/[0.06] border border-mint/30 rounded-2xl p-4">
        <div className="font-display font-700 text-mint mb-1">It all turns into calories</div>
        <p className="text-muted text-[13px] leading-relaxed">
          Protein and carbohydrate carry {KCAL_PER_G.protein} kcal per gram; fat carries{' '}
          {KCAL_PER_G.fat}, more than twice as much. Add the three rows above and you get{' '}
          <span className="text-cream">{breakdown.totalKcal} kcal</span> — your daily
          target, itemised. Nothing else contributes energy except alcohol, at{' '}
          {KCAL_PER_G_ALCOHOL} kcal per gram.
        </p>
        <p className="text-muted-2 text-[12px] mt-2 leading-relaxed">
          So the total decides which direction your weight moves, and the split decides
          what you lose on the way — enough protein and hard training is the difference
          between losing fat and losing muscle.
        </p>
      </div>
    </div>
  )
}

function Myths({ myths }) {
  if (!myths?.length) return null
  return (
    <Section eyebrow="Worth unlearning" title="A few things you may have heard">
      <div className="space-y-3">
        {myths.map((m, i) => (
          <div key={i} className="bg-panel/60 border border-line rounded-2xl p-4">
            <div className="font-display text-[17px] font-700 mb-1">{m.title}</div>
            <p className="text-muted leading-relaxed">{m.correction}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

function Plate({ plate }) {
  if (!plate) return null
  return (
    <Section eyebrow="Every meal" title="The plate rule">
      <div className="flex items-center gap-5 mb-4">
        <PlatePie />
        <div className="flex-1 space-y-2 text-sm">
          <Legend color="#2FE6A8" pct="50%" label="Vegetables" />
          <Legend color="#7CC5FF" pct="25%" label="Protein" />
          <Legend color="#FFD479" pct="25%" label="Carbs" />
        </div>
      </div>
      <PlateList label="Veg" items={plate.veg_examples} />
      <PlateList label="Protein" items={plate.protein_examples} />
      <PlateList label="Carbs" items={plate.carb_examples} />
      {plate.hand_cues?.length > 0 && (
        <ul className="mt-4 space-y-1">
          {plate.hand_cues.map((c, i) => (
            <li key={i} className="text-muted text-sm">✋ {c}</li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// A static SVG rather than a generated one — same picture every time, and no
// chance of the model emitting a malformed path.
function PlatePie() {
  const r = 44, c = 2 * Math.PI * r
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="Half vegetables, a quarter protein, a quarter carbohydrate">
      <g transform="rotate(-90 52 52)" fill="none" strokeWidth="16">
        <circle cx="52" cy="52" r={r} stroke="#2FE6A8" strokeDasharray={`${c * 0.5} ${c}`} />
        <circle cx="52" cy="52" r={r} stroke="#7CC5FF" strokeDasharray={`${c * 0.25} ${c}`} strokeDashoffset={-c * 0.5} />
        <circle cx="52" cy="52" r={r} stroke="#FFD479" strokeDasharray={`${c * 0.25} ${c}`} strokeDashoffset={-c * 0.75} />
      </g>
    </svg>
  )
}

const Legend = ({ color, pct, label }) => (
  <div className="flex items-center gap-2">
    <span className="w-3 h-3 rounded-full" style={{ background: color }} />
    <span className="text-cream font-700">{pct}</span>
    <span className="text-muted">{label}</span>
  </div>
)

const PlateList = ({ label, items }) =>
  !items?.length ? null : (
    <p className="text-sm mb-1">
      <span className="text-mint font-700">{label}: </span>
      <span className="text-muted">{items.join(', ')}</span>
    </p>
  )

function Week({ week, targets }) {
  if (!week?.length) return null
  return (
    <Section eyebrow="Seven days" title="Your week of food">
      <div className="space-y-3">
        {week.map((d, i) => (
          <div key={i} className="bg-panel/60 border border-line rounded-2xl p-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="font-display text-[19px] font-700">{d.day}</span>
              {d.label && <span className="text-muted text-sm">· {d.label}</span>}
              <span className="flex gap-1 flex-wrap ml-auto">
                {(d.tags ?? []).map((t) => (
                  <span key={t} className="text-[11px] text-mint bg-mint/[0.12] rounded-full px-2 py-0.5">
                    {TAG_LABEL[t] ?? t}
                  </span>
                ))}
              </span>
            </div>
            <Meal label="Breakfast" text={d.breakfast} />
            <Meal label="Lunch" text={d.lunch} />
            <Meal label="Dinner" text={d.dinner} />
            {d.snack && <Meal label="Snack" text={d.snack} />}
            {d.note && <p className="text-muted-2 text-[13px] mt-2 italic">{d.note}</p>}
          </div>
        ))}
      </div>

      {targets?.length > 0 && (
        <div className="mt-4 bg-mint/[0.08] border border-mint/30 rounded-2xl p-4">
          <div className="font-display font-700 mb-2">Across the week</div>
          <ul className="space-y-1">
            {targets.map((t, i) => <li key={i} className="text-muted text-sm">✓ {t}</li>)}
          </ul>
        </div>
      )}
    </Section>
  )
}

// The meal label was text-muted-2 (#5A6E68) on the panel — about 2.6:1, below
// the 4.5:1 minimum for text this size, and it read as disabled rather than
// as a label. Mint on the same background is ~9:1 and doubles as the cue that
// these four rows are a set.
const Meal = ({ label, text }) => (
  <p className="text-sm leading-relaxed mb-1">
    <span className="text-mint/80 uppercase tracking-wide text-[11px] font-700 mr-2">{label}</span>
    <span className="text-cream">{text}</span>
  </p>
)

function Training({ training }) {
  if (!training?.split?.length) return null
  return (
    <Section eyebrow="Strength" title="Your training split">
      <div className="space-y-3">
        {training.split.map((day, i) => (
          <div key={i} className="bg-panel/60 border border-line rounded-2xl p-4">
            <div className="flex items-baseline gap-2 mb-3">
              <span className="font-display text-[19px] font-700">{day.day}</span>
              <span className="text-mint text-sm font-700">{day.focus}</span>
            </div>
            <div className="space-y-1.5">
              {(day.exercises ?? []).map((ex, j) => (
                <div key={j} className="flex items-baseline gap-3 text-sm">
                  <span className="text-cream flex-1">{ex.name}</span>
                  <span className="text-mint font-700 whitespace-nowrap">{ex.sets} × {ex.reps}</span>
                </div>
              ))}
            </div>
            {day.exercises?.some((e) => e.note) && (
              <ul className="mt-2 space-y-0.5">
                {day.exercises.filter((e) => e.note).map((e, j) => (
                  <li key={j} className="text-muted-2 text-[12px]">{e.name}: {e.note}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {training.progression_note && (
        <p className="text-muted mt-4 leading-relaxed">📈 {training.progression_note}</p>
      )}
      {training.cardio_note && (
        <p className="text-muted mt-2 leading-relaxed">👟 {training.cardio_note}</p>
      )}
    </Section>
  )
}

function Supplements({ supplements }) {
  if (!supplements?.length) return null
  return (
    <Section eyebrow="What you're taking" title="Supplement review">
      <div className="space-y-2">
        {supplements.map((s, i) => {
          const v = VERDICT_STYLE[s.verdict] ?? VERDICT_STYLE.optional
          return (
            <div key={i} className="bg-panel/60 border border-line rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-display text-[17px] font-700">{s.name}</span>
                <span className={`text-[12px] font-700 rounded-full px-2.5 py-0.5 ml-auto ${v.className}`}>
                  {v.label}
                </span>
              </div>
              <p className="text-muted text-sm leading-relaxed">{s.rationale}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function Tracking({ tracking }) {
  if (!tracking?.length) return null
  return (
    <Section eyebrow="Staying honest" title="How to track progress">
      <ul className="space-y-2">
        {tracking.map((t, i) => (
          <li key={i} className="flex gap-3 text-muted leading-relaxed">
            <span className="text-mint">→</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Disclaimer({ text }) {
  if (!text) return null
  return (
    <p className="text-muted-2 text-[12px] leading-relaxed border-t border-line mt-5 pt-4 px-1">
      {text}
    </p>
  )
}

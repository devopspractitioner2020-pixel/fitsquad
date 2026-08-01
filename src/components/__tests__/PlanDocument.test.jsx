// The renderer replaced ~90 lines of prompt that described the design to the
// model on every generation. These tests are what that prompt could never
// have: an assertion that the plan actually renders correctly.
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlanDocument from '../PlanDocument'
import { computeNutrition } from '../../../supabase/functions/generate-plan/nutrition.ts'

const NUTRITION_INPUTS = {
  weight_kg: 82, height_cm: 178, age: 34, sex: 'male',
  formula: 'mifflin-st-jeor', activity_multiplier: 1.55,
  goal: 'lose-fat', goal_adjustment_kcal: -400,
}

const PLAN = {
  language: 'es',
  hero: {
    name: 'Vic', goal_label: 'Perder grasa', target_event: 'boda, en 4 meses',
    headline: 'Es alcanzable si mantienes la constancia.',
  },
  numbers: computeNutrition(NUTRITION_INPUTS),
  numbers_explainer: 'Estos números son tu punto de partida.',
  myths: [{ title: 'El pan engorda', correction: 'El pan no engorda por sí solo.' }],
  plate: {
    veg_examples: ['brócoli', 'ensalada'],
    protein_examples: ['pollo', 'pescado'],
    carb_examples: ['arroz', 'pan'],
    hand_cues: ['una palma de proteína por comida'],
  },
  week: [
    { day: 'Lunes', label: 'día de gimnasio', tags: ['training'], breakfast: 'Huevos', lunch: 'Lomo saltado', dinner: 'Pescado', snack: 'Fruta', note: 'Bebe agua.' },
    { day: 'Martes', tags: ['oily-fish'], breakfast: 'Avena', lunch: 'Pollo', dinner: 'Salmón' },
    { day: 'Miércoles', breakfast: 'Tostada', lunch: 'Pasta', dinner: 'Sopa' },
    { day: 'Jueves', tags: ['legumes'], breakfast: 'Huevos', lunch: 'Lentejas', dinner: 'Pollo' },
    { day: 'Viernes', label: 'cena fuera', tags: ['restaurant', 'social'], breakfast: 'Avena', lunch: 'Arroz', dinner: 'Restaurante' },
    { day: 'Sábado', tags: ['sport'], breakfast: 'Tostada', lunch: 'Ceviche', dinner: 'Pollo' },
    { day: 'Domingo', tags: ['rest'], breakfast: 'Huevos', lunch: 'Guiso', dinner: 'Ensalada' },
  ],
  weekly_targets: ['pescado azul dos veces', 'legumbres tres veces'],
  training: {
    split: [
      { day: 'Lunes', focus: 'Empuje', exercises: [{ name: 'Press banca', sets: 4, reps: '6-10', note: 'controla la bajada' }, { name: 'Press militar', sets: 3, reps: '8-12' }, { name: 'Fondos', sets: 3, reps: '8-12' }] },
      { day: 'Miércoles', focus: 'Tirón + abdominales', exercises: [{ name: 'Remo', sets: 4, reps: '6-10' }, { name: 'Dominadas', sets: 3, reps: '6-10' }, { name: 'Plancha', sets: 3, reps: '45s' }] },
      { day: 'Viernes', focus: 'Piernas + abdominales', exercises: [{ name: 'Sentadilla', sets: 4, reps: '6-10' }, { name: 'Peso muerto', sets: 3, reps: '6-8' }, { name: 'Elevaciones', sets: 3, reps: '12-15' }] },
    ],
    progression_note: 'Sube el peso cuando completes el rango.',
    cardio_note: 'El fútbol del sábado ya cuenta como cardio.',
  },
  supplements: [
    { name: 'Omega 3', verdict: 'keep', rationale: 'Útil si comes poco pescado.' },
    { name: 'Levadura roja de arroz', verdict: 'dont-start', rationale: 'Es en la práctica una estatina de dosis baja. Consulta a tu médico.' },
  ],
  tracking: ['Pésate a diario y usa la media semanal.'],
  disclaimer: 'Esta es información general de nutrición, no consejo médico.',
}

describe('PlanDocument', () => {
  it('renders nothing when there is no plan', () => {
    const { container } = render(<PlanDocument plan={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows who the plan is for and what it is for', () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.getByRole('heading', { name: 'Vic' })).toBeInTheDocument()
    expect(screen.getByText('Perder grasa')).toBeInTheDocument()
    expect(screen.getByText(/boda, en 4 meses/)).toBeInTheDocument()
  })

  // The plan text is written in the user's language; marking it on the
  // element is what lets a screen reader switch voice.
  it('marks the document with the language the plan is written in', () => {
    const { container } = render(<PlanDocument plan={PLAN} />)
    expect(container.querySelector('article')).toHaveAttribute('lang', 'es')
  })
})

/** Switch to a tab before asserting on what it contains. */
const openTab = (name) => userEvent.click(screen.getByRole('tab', { name: new RegExp(name, 'i') }))

describe('the three sections', () => {
  it('offers Overview, Food and Training', () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    for (const name of ['Overview', 'Food', 'Training']) {
      expect(screen.getByRole('tab', { name: new RegExp(name, 'i') })).toBeInTheDocument()
    }
  })

  it('opens on Overview', () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.getByRole('tab', { name: /overview/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Vic' })).toBeInTheDocument()
  })

  // The whole point: a seven-day menu and a three-day split are no longer
  // between you and the numbers you opened the app to check.
  it('shows only the section you picked', async () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.queryByText('Lomo saltado')).toBeNull()
    expect(screen.queryByText('Press banca')).toBeNull()

    await openTab('Food')
    expect(screen.getByText('Lomo saltado')).toBeInTheDocument()
    expect(screen.queryByText('Press banca')).toBeNull()

    await openTab('Training')
    expect(screen.getByText('Press banca')).toBeInTheDocument()
    expect(screen.queryByText('Lomo saltado')).toBeNull()
  })

  it('groups the food sections together', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')

    expect(screen.getByRole('heading', { name: /the plate rule/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /you may have heard/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /your week of food/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /supplement review/i })).toBeInTheDocument()
  })

  it('keeps the numbers and progress tracking on Overview', () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.getByRole('heading', { name: /what to aim for/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /how to track progress/i })).toBeInTheDocument()
  })

  it('marks the selected tab for assistive tech', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Training')

    expect(screen.getByRole('tab', { name: /training/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /overview/i })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'plan-tab-training')
  })
})

// A medical disclaimer that only appears if you happen to pick the right tab
// is not a disclaimer.
describe('the disclaimer', () => {
  it('stays visible on every tab', async () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.getByText(/no consejo médico/)).toBeInTheDocument()

    await openTab('Food')
    expect(screen.getByText(/no consejo médico/)).toBeInTheDocument()

    await openTab('Training')
    expect(screen.getByText(/no consejo médico/)).toBeInTheDocument()
  })
})

describe('the daily numbers', () => {
  it('shows the computed TDEE, target and macros', () => {
    render(<PlanDocument plan={PLAN} />)
    const n = PLAN.numbers
    expect(screen.getByText(String(n.tdee))).toBeInTheDocument()
    expect(screen.getByText(String(n.target_kcal))).toBeInTheDocument()
    expect(screen.getByText(String(n.protein_g))).toBeInTheDocument()
    expect(screen.getByText(String(n.carbs_g))).toBeInTheDocument()
    expect(screen.getByText(String(n.fat_g))).toBeInTheDocument()
  })

  // "Show which method was used" was a line in the old prompt that the model
  // could simply forget. Now it is structural.
  it('always names the formula behind the numbers', () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.getByText(/Mifflin-St Jeor/)).toBeInTheDocument()
    expect(screen.getByText(/BMR \d+ × 1\.55 activity/)).toBeInTheDocument()
  })

  it('shows lean body mass when Katch-McArdle was used', () => {
    const numbers = computeNutrition({ ...NUTRITION_INPUTS, formula: 'katch-mcardle', bodyfat_pct: 19 })
    render(<PlanDocument plan={{ ...PLAN, numbers }} />)
    expect(screen.getByText(/Katch-McArdle/)).toBeInTheDocument()
    expect(screen.getByText(/66\.4 kg lean mass/)).toBeInTheDocument()
  })

  // If a safety floor moved the target, the person is told why rather than
  // just seeing a number that doesn't match the deficit they expected.
  it('surfaces safety adjustments instead of silently applying them', () => {
    const numbers = computeNutrition({
      weight_kg: 48, height_cm: 152, age: 62, sex: 'female',
      formula: 'mifflin-st-jeor', activity_multiplier: 1.2,
      goal: 'lose-fat', goal_adjustment_kcal: -500,
    })
    render(<PlanDocument plan={{ ...PLAN, numbers }} />)
    expect(screen.getByText(/without medical supervision/i)).toBeInTheDocument()
  })

  it('omits the numbers block entirely rather than rendering NaN', async () => {
    render(<PlanDocument plan={{ ...PLAN, numbers: undefined }} />)
    expect(screen.queryByText(/Calories burned per day/i)).toBeNull()
    // The rest of the plan still renders.
    await openTab('Food')
    expect(screen.getByText('Lomo saltado')).toBeInTheDocument()
  })
})

describe('the macro breakdown', () => {
  const n = PLAN.numbers

  // The old layout was three small tiles in a row: a number, a unit, nothing
  // else. It never said what any macro was for, and it left the calorie
  // target above looking like a fourth, separate rule.
  it('gives each macro a full row with its calories, share and purpose', () => {
    render(<PlanDocument plan={PLAN} />)

    for (const label of ['Protein', 'Carbohydrates', 'Fat']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText(`${n.protein_g * 4} kcal · ${Math.round((n.protein_g * 4 / (n.protein_g * 4 + n.carbs_g * 4 + n.fat_g * 9)) * 100)}% of your calories · 4 kcal per gram`, { exact: false }))
      .toBeInTheDocument()
    expect(screen.getByText(/repair material/i)).toBeInTheDocument()
    expect(screen.getByText(/training fuel/i)).toBeInTheDocument()
    expect(screen.getByText(/hormone production/i)).toBeInTheDocument()
  })

  // The point the tiles could not make, and the one the reader asked for.
  it('says outright that the three macros ARE the calories', () => {
    render(<PlanDocument plan={PLAN} />)
    expect(screen.getByText(/it all turns into calories/i)).toBeInTheDocument()
    expect(screen.getByText(/4 kcal per gram; fat carries 9/i)).toBeInTheDocument()
    expect(screen.getByText(/alcohol, at 7 kcal per gram/i)).toBeInTheDocument()
  })

  it('shows a total that agrees with the calorie target above it', () => {
    render(<PlanDocument plan={PLAN} />)
    const total = n.protein_g * 4 + n.carbs_g * 4 + n.fat_g * 9
    expect(screen.getByText(`${total} kcal`)).toBeInTheDocument()
    expect(Math.abs(total - n.target_kcal)).toBeLessThanOrEqual(10)
  })

  it('renders no macro rows at all rather than NaN when the grams are missing', () => {
    render(<PlanDocument plan={{ ...PLAN, numbers: { ...n, protein_g: undefined } }} />)
    expect(screen.queryByText(/it all turns into calories/i)).toBeNull()
    // The calorie target above is unaffected.
    expect(screen.getByText(String(n.target_kcal))).toBeInTheDocument()
  })
})

// Day names repeat between the meal week and the training split, which is
// exactly what a real plan looks like — so queries are scoped to a section.
const section = (heading) =>
  screen.getByRole('heading', { name: heading }).closest('section')

describe('the week', () => {
  it('renders all seven days with every meal', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')
    const week = within(section('Your week of food'))
    for (const day of PLAN.week) {
      expect(week.getByText(day.day)).toBeInTheDocument()
      // Meals repeat across days on purpose — a real week reuses breakfasts.
      expect(week.getAllByText(day.breakfast).length).toBeGreaterThan(0)
      expect(week.getAllByText(day.lunch).length).toBeGreaterThan(0)
      expect(week.getAllByText(day.dinner).length).toBeGreaterThan(0)
    }
    expect(week.getAllByText(/^Breakfast$/i)).toHaveLength(7)
  })

  it('shows a snack and a note only when the day has them', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')
    expect(screen.getByText('Fruta')).toBeInTheDocument()
    expect(screen.getByText('Bebe agua.')).toBeInTheDocument()
    expect(screen.getAllByText(/^Snack$/i)).toHaveLength(1)
  })

  it('translates day tags into readable labels', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')
    const week = within(section('Your week of food'))
    expect(week.getByText(/oily fish/)).toBeInTheDocument()
    expect(week.getByText(/legumes/)).toBeInTheDocument()
    expect(week.getByText(/🏋️ training/)).toBeInTheDocument()
    expect(week.getByText(/🍽️ out/)).toBeInTheDocument()
  })

  it('falls back to the raw tag when it has no label', async () => {
    const week = PLAN.week.map((d, i) => (i === 0 ? { ...d, tags: ['unknown-tag'] } : d))
    render(<PlanDocument plan={{ ...PLAN, week }} />)
    await openTab('Food')
    expect(screen.getByText('unknown-tag')).toBeInTheDocument()
  })

  it('lists the weekly background targets', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')
    expect(screen.getByText(/pescado azul dos veces/)).toBeInTheDocument()
  })
})

describe('legibility', () => {
  // BREAKFAST / LUNCH / DINNER were text-muted-2 (#5A6E68) on the panel:
  // roughly 2.6:1, under the 4.5:1 floor for text this small, and they read
  // as disabled rather than as labels. This pins the fix, because contrast
  // is invisible to every other test in this file.
  it('does not render the meal labels in the tertiary grey', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')

    const label = within(section('Your week of food')).getAllByText('Breakfast')[0]
    expect(label.className).not.toMatch(/text-muted-2/)
    expect(label.className).toMatch(/text-mint/)
  })
})

describe('training', () => {
  it('renders each day with its exercises and set/rep scheme', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Training')
    const t = within(section('Your training split'))
    const exercises = PLAN.training.split.flatMap((d) => d.exercises)

    for (const ex of exercises) {
      expect(t.getByText(ex.name)).toBeInTheDocument()
    }
    for (const day of PLAN.training.split) {
      expect(t.getByText(day.focus)).toBeInTheDocument()
    }
    // One set/rep badge per exercise, no more and no fewer. Schemes repeat
    // across days, so count each distinct scheme against how many exercises
    // actually use it.
    const expected = new Map()
    for (const e of exercises) {
      const scheme = `${e.sets} × ${e.reps}`
      expected.set(scheme, (expected.get(scheme) ?? 0) + 1)
    }
    for (const [scheme, count] of expected) {
      expect(t.queryAllByText(scheme), scheme).toHaveLength(count)
    }
    expect(t.getByText('3 × 45s')).toBeInTheDocument()
  })

  it('surfaces per-exercise notes without dropping them', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Training')
    expect(screen.getByText(/controla la bajada/)).toBeInTheDocument()
  })

  it('shows progression and cardio guidance', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Training')
    expect(screen.getByText(/Sube el peso/)).toBeInTheDocument()
    expect(screen.getByText(/fútbol del sábado/)).toBeInTheDocument()
  })
})

describe('supplements', () => {
  it('renders a verdict badge per supplement', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')
    expect(screen.getByText('Keep')).toBeInTheDocument()
    expect(screen.getByText("Don't start")).toBeInTheDocument()
  })

  // The statin warning is a safety-relevant instruction in the prompt. The
  // renderer must not swallow the rationale that carries it.
  it('keeps the rationale visible, including the statin warning', async () => {
    render(<PlanDocument plan={PLAN} />)
    await openTab('Food')
    expect(screen.getByText(/estatina de dosis baja/)).toBeInTheDocument()
  })

  it('hides the section when the user listed no supplements', async () => {
    render(<PlanDocument plan={{ ...PLAN, supplements: [] }} />)
    await openTab('Food')
    expect(screen.queryByText(/Supplement review/i)).toBeNull()
  })
})

describe('optional sections degrade quietly', () => {
  it.each(['myths', 'plate', 'supplements', 'tracking', 'weekly_targets'])(
    'renders without %s rather than crashing',
    (key) => {
      const partial = { ...PLAN, [key]: undefined }
      expect(() => render(<PlanDocument plan={partial} />)).not.toThrow()
    },
  )

  it('renders a plan with only the required fields', () => {
    const minimal = {
      hero: { name: 'Ana', goal_label: 'Maintain', headline: 'Steady.' },
      week: PLAN.week,
      training: PLAN.training,
      disclaimer: 'Not medical advice.',
    }
    render(<PlanDocument plan={minimal} />)
    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByText('Not medical advice.')).toBeInTheDocument()
  })
})



describe('untrusted content is rendered as text, never as markup', () => {
  // The whole class of bug that the sandboxed iframe existed to contain is
  // gone: React escapes everything below.
  it('does not execute markup smuggled into plan fields', async () => {
    const nasty = {
      ...PLAN,
      hero: { ...PLAN.hero, headline: '<img src=x onerror="window.__pwned=1">' },
      week: PLAN.week.map((d, i) => (i === 0 ? { ...d, dinner: '<script>window.__pwned=1</script>' } : d)),
    }
    const { container } = render(<PlanDocument plan={nasty} />)
    await openTab('Food')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(window.__pwned).toBeUndefined()
    // It shows up as the literal text it is.
    expect(screen.getByText('<script>window.__pwned=1</script>')).toBeInTheDocument()
  })
})

// The calorie maths used to happen inside the model's head. These tests are
// why moving it into code was worth doing: every number below has one correct
// answer, verifiable by hand, and none of them can drift.
import { describe, it, expect } from 'vitest'
import {
  computeNutrition,
  calculateBmr,
  calculateMacros,
  applySafetyFloor,
  macroKcal,
  GOAL_BANDS,
  PROTEIN_G_PER_KG,
  FAT_G_PER_KG,
  ABSOLUTE_FLOOR_KCAL,
} from '../../../supabase/functions/generate-plan/nutrition.ts'

const base = {
  weight_kg: 82, height_cm: 178, age: 34, sex: 'male',
  formula: 'mifflin-st-jeor', activity_multiplier: 1.55,
  goal: 'lose-fat', goal_adjustment_kcal: -400,
}

describe('calculateBmr — Mifflin-St Jeor', () => {
  // men: 10×kg + 6.25×cm − 5×age + 5
  // 10(82) + 6.25(178) − 5(34) + 5 = 820 + 1112.5 − 170 + 5 = 1767.5
  it('matches the worked example for a man', () => {
    const { bmr, lbm } = calculateBmr(base)
    expect(bmr).toBeCloseTo(1767.5, 5)
    expect(lbm).toBeNull()
  })

  // women: 10×kg + 6.25×cm − 5×age − 161
  // 10(62) + 6.25(165) − 5(30) − 161 = 620 + 1031.25 − 150 − 161 = 1340.25
  it('matches the worked example for a woman', () => {
    const { bmr } = calculateBmr({
      ...base, weight_kg: 62, height_cm: 165, age: 30, sex: 'female',
    })
    expect(bmr).toBeCloseTo(1340.25, 5)
  })

  it('treats any sex string starting with f as female', () => {
    const f = calculateBmr({ ...base, sex: 'Female' }).bmr
    const f2 = calculateBmr({ ...base, sex: 'f' }).bmr
    expect(f).toBe(f2)
    expect(f).toBeLessThan(calculateBmr({ ...base, sex: 'male' }).bmr)
  })
})

describe('calculateBmr — Katch-McArdle', () => {
  // LBM = 82 × (1 − 0.19) = 66.42
  // BMR = 370 + 21.6 × 66.42 = 370 + 1434.672 = 1804.672
  it('matches the worked example when body fat is known', () => {
    const { bmr, lbm, formula } = calculateBmr({
      ...base, formula: 'katch-mcardle', bodyfat_pct: 19,
    })
    expect(lbm).toBeCloseTo(66.42, 5)
    expect(bmr).toBeCloseTo(1804.672, 3)
    expect(formula).toBe('katch-mcardle')
  })

  // Katch-McArdle without body fat is undefined, so it must degrade rather
  // than produce NaN — which would propagate into every number on the plan.
  it('falls back to Mifflin when body fat is missing', () => {
    const { formula, lbm } = calculateBmr({ ...base, formula: 'katch-mcardle' })
    expect(formula).toBe('mifflin-st-jeor')
    expect(lbm).toBeNull()
  })

  it('falls back when body fat is implausible', () => {
    for (const bf of [0, -5, 85]) {
      expect(calculateBmr({ ...base, formula: 'katch-mcardle', bodyfat_pct: bf }).formula)
        .toBe('mifflin-st-jeor')
    }
  })
})

describe('calculateBmr — missing data', () => {
  it('uses a bodyweight estimate rather than returning NaN', () => {
    const { bmr } = calculateBmr({
      weight_kg: 80, formula: 'mifflin-st-jeor', activity_multiplier: 1.2,
      goal: 'maintain', goal_adjustment_kcal: 0,
    })
    expect(Number.isFinite(bmr)).toBe(true)
    expect(bmr).toBe(22 * 80)
  })
})

describe('computeNutrition — end to end', () => {
  it('produces the expected TDEE and target for the worked example', () => {
    const r = computeNutrition(base)
    // BMR 1767.5 × 1.55 = 2739.625 -> 2740
    expect(r.tdee).toBe(2740)
    // 2739.625 − 400 = 2339.625 -> 2340
    expect(r.target_kcal).toBe(2340)
    expect(r.formula_label).toBe('Mifflin-St Jeor')
    expect(r.adjustments).toEqual([])
  })

  it('defaults protein and fat to the middle of their bands', () => {
    const r = computeNutrition(base)
    expect(r.protein_g).toBe(Math.round(PROTEIN_G_PER_KG.default * 82)) // 148
    expect(r.fat_g).toBe(Math.round(FAT_G_PER_KG.default * 82))         // 66
  })

  it('fills the remaining calories with carbohydrate', () => {
    const r = computeNutrition(base)
    // Each macro is rounded to whole grams independently, so the reconstructed
    // calorie total drifts by up to ~10 kcal. That is rounding, not error.
    expect(Math.abs(macroKcal(r) - r.target_kcal)).toBeLessThan(12)
    expect(r.carbs_g).toBeGreaterThan(100)
  })

  it('adds calories for a muscle-gain goal', () => {
    const r = computeNutrition({ ...base, goal: 'gain-muscle', goal_adjustment_kcal: 300 })
    expect(r.target_kcal).toBeGreaterThan(r.tdee)
    expect(r.goal_adjustment_kcal).toBe(300)
  })

  it('leaves the target at TDEE when maintaining', () => {
    const r = computeNutrition({ ...base, goal: 'maintain', goal_adjustment_kcal: 0 })
    expect(r.target_kcal).toBe(r.tdee)
  })
})

describe('computeNutrition — clamping the model to its allowed bands', () => {
  // The prompt states the bands. Nothing enforced them until now, and a model
  // that decides on a -900 deficit is exactly the failure that should never
  // reach a user.
  it('clamps an over-aggressive deficit to the bottom of the band', () => {
    const r = computeNutrition({ ...base, goal_adjustment_kcal: -900 })
    expect(r.goal_adjustment_kcal).toBe(GOAL_BANDS['lose-fat'].min)
    expect(r.adjustments.join(' ')).toMatch(/clamped to -500/)
  })

  it('clamps a token deficit up to the top of the band', () => {
    const r = computeNutrition({ ...base, goal_adjustment_kcal: -50 })
    expect(r.goal_adjustment_kcal).toBe(GOAL_BANDS['lose-fat'].max)
  })

  it('rejects a surplus disguised as a fat-loss goal', () => {
    const r = computeNutrition({ ...base, goal: 'lose-fat', goal_adjustment_kcal: 400 })
    expect(r.goal_adjustment_kcal).toBe(-300)
    expect(r.target_kcal).toBeLessThan(r.tdee)
  })

  it('clamps the activity multiplier to the Mifflin range', () => {
    expect(computeNutrition({ ...base, activity_multiplier: 3 }).activity_multiplier).toBe(1.9)
    expect(computeNutrition({ ...base, activity_multiplier: 0.5 }).activity_multiplier).toBe(1.2)
  })

  // Katch-McArdle already accounts for lean mass, so it uses a narrower
  // multiplier range. Applying a Mifflin multiplier on top double-counts.
  it('clamps to the narrower Katch range when that formula is used', () => {
    const r = computeNutrition({ ...base, formula: 'katch-mcardle', bodyfat_pct: 19, activity_multiplier: 1.9 })
    expect(r.activity_multiplier).toBe(1.5)
    expect(r.adjustments.join(' ')).toMatch(/katch/i)
  })

  it('clamps protein and fat to their bands', () => {
    const r = computeNutrition({ ...base, protein_g_per_kg: 5, fat_g_per_kg: 0.1 })
    expect(r.protein_g_per_kg).toBe(PROTEIN_G_PER_KG.max)
    expect(r.fat_g_per_kg).toBe(FAT_G_PER_KG.min)
  })

  it('notes when it had to fall back from Katch-McArdle', () => {
    const r = computeNutrition({ ...base, formula: 'katch-mcardle' })
    expect(r.formula).toBe('mifflin-st-jeor')
    expect(r.adjustments.join(' ')).toMatch(/Mifflin/)
  })
})

describe('applySafetyFloor', () => {
  // This is the guard a prompt cannot provide. A small, older, low-activity
  // person can have a TDEE close enough to their BMR that any deficit at all
  // puts them under it.
  it('never prescribes below BMR', () => {
    const adj = []
    expect(applySafetyFloor(1400, 1600, 'male', adj)).toBe(1600)
    expect(adj.join(' ')).toMatch(/BMR/)
  })

  it('never prescribes below the absolute floor for women', () => {
    const adj = []
    expect(applySafetyFloor(900, 1000, 'female', adj)).toBe(ABSOLUTE_FLOOR_KCAL.female)
    expect(adj).toHaveLength(1)
  })

  it('never prescribes below the absolute floor for men', () => {
    const adj = []
    expect(applySafetyFloor(1200, 1300, 'male', adj)).toBe(ABSOLUTE_FLOOR_KCAL.male)
  })

  it('leaves a sane target untouched and says nothing', () => {
    const adj = []
    expect(applySafetyFloor(2340, 1767, 'male', adj)).toBe(2340)
    expect(adj).toEqual([])
  })

  it('applies through computeNutrition for a small sedentary person', () => {
    const r = computeNutrition({
      weight_kg: 48, height_cm: 152, age: 62, sex: 'female',
      formula: 'mifflin-st-jeor', activity_multiplier: 1.2,
      goal: 'lose-fat', goal_adjustment_kcal: -500,
    })
    expect(r.target_kcal).toBeGreaterThanOrEqual(r.bmr)
    expect(r.target_kcal).toBeGreaterThanOrEqual(ABSOLUTE_FLOOR_KCAL.female)
    expect(r.adjustments.length).toBeGreaterThan(0)
  })
})

describe('calculateMacros', () => {
  it('anchors protein and fat per kg and fills with carbs', () => {
    const adj = []
    const m = calculateMacros(2340, 82, 1.8, 0.8, adj)
    expect(m.protein_g).toBe(148)
    expect(m.fat_g).toBe(66)
    // 2340 − 147.6×4 − 65.6×9 = 2340 − 590.4 − 590.4 = 1159.2 → 289.8 → 290
    expect(m.carbs_g).toBe(290)
    expect(adj).toEqual([])
  })

  // A tight target with high protein and fat can mathematically leave no room
  // for carbohydrate. Zeroing carbs is never the right prescription, so fat
  // gives way first.
  it('walks fat back before letting carbs bottom out', () => {
    const adj = []
    const m = calculateMacros(1500, 90, 2.0, 0.9, adj)
    expect(m.carbs_g).toBeGreaterThanOrEqual(40)
    expect(m.fat_g_per_kg).toBeLessThan(0.9)
    expect(adj.join(' ')).toMatch(/fat lowered/i)
  })

  it('never returns negative carbohydrate even at an impossible target', () => {
    const m = calculateMacros(800, 110, 2.0, 0.9, [])
    expect(m.carbs_g).toBeGreaterThanOrEqual(0)
  })

  it('keeps fat at or above the bottom of its band', () => {
    const m = calculateMacros(1500, 90, 2.0, 0.9, [])
    expect(m.fat_g).toBeGreaterThanOrEqual(Math.round(FAT_G_PER_KG.min * 90) - 1)
  })
})

describe('the numbers hold together', () => {
  const people = [
    { label: 'active man cutting', input: base },
    { label: 'woman recomping', input: { ...base, weight_kg: 62, height_cm: 165, age: 30, sex: 'female', goal: 'recomposition', goal_adjustment_kcal: -250 } },
    { label: 'lean man bulking', input: { ...base, formula: 'katch-mcardle', bodyfat_pct: 12, goal: 'gain-muscle', goal_adjustment_kcal: 300, activity_multiplier: 1.5 } },
    { label: 'sedentary maintainer', input: { ...base, activity_multiplier: 1.2, goal: 'maintain', goal_adjustment_kcal: 0 } },
    { label: 'older lighter woman', input: { weight_kg: 55, height_cm: 158, age: 58, sex: 'female', formula: 'mifflin-st-jeor', activity_multiplier: 1.375, goal: 'lose-fat', goal_adjustment_kcal: -400 } },
  ]

  it.each(people)('$label: every figure is finite, positive and consistent', ({ input }) => {
    const r = computeNutrition(input)

    for (const k of ['bmr', 'tdee', 'target_kcal', 'protein_g', 'fat_g', 'carbs_g']) {
      expect(Number.isFinite(r[k]), `${k} is finite`).toBe(true)
      expect(r[k], `${k} is positive`).toBeGreaterThan(0)
    }

    expect(r.tdee).toBeGreaterThanOrEqual(r.bmr)
    expect(r.target_kcal).toBeGreaterThanOrEqual(r.bmr)
    // Macro grams must account for the target, allowing for rounding.
    expect(Math.abs(macroKcal(r) - r.target_kcal)).toBeLessThan(20)
  })
})

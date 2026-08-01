// Calorie and macronutrient maths.
//
// This used to happen inside the model's head. It doesn't any more: the model
// now returns the *inputs* it chose — which formula, which activity
// multiplier, how big a deficit, how many grams of protein per kg — and this
// module does the arithmetic. Two reasons:
//
//   1. Arithmetic is the one part of a nutrition plan that has a single right
//      answer, and a language model doing it in prose is the only place in the
//      pipeline where a wrong number would propagate silently into every meal
//      of every day. Here it is exact and unit-tested.
//   2. Safety floors can be *enforced*. A prompt can ask for a sensible
//      deficit; only code can guarantee one. See applySafetyFloor().
//
// The model still makes every judgement call — which formula suits this
// person, how active they really are, whether to lean aggressive or gentle
// within the allowed band. Those are the parts it is good at.
//
// Pure functions, no I/O. Tested in src/lib/__tests__/nutrition.test.js.

export type Formula = 'katch-mcardle' | 'mifflin-st-jeor'
export type Goal = 'lose-fat' | 'recomposition' | 'gain-muscle' | 'maintain'

/** Adjustment bands per goal, in kcal/day. The model picks within these. */
export const GOAL_BANDS: Record<Goal, { min: number; max: number }> = {
  'lose-fat': { min: -500, max: -300 },
  'recomposition': { min: -350, max: -200 },
  'maintain': { min: 0, max: 0 },
  'gain-muscle': { min: 200, max: 350 },
}

/** Protein and fat are prescribed per kg of bodyweight, within these bands. */
export const PROTEIN_G_PER_KG = { min: 1.6, max: 2.0, default: 1.8 }
export const FAT_G_PER_KG = { min: 0.7, max: 0.9, default: 0.8 }

/** Activity multipliers, by formula. */
export const MIFFLIN_MULTIPLIERS = { min: 1.2, max: 1.9 }
export const KATCH_MULTIPLIERS = { min: 1.2, max: 1.5 }

/**
 * Absolute daily calorie floors. Widely used clinical guidance is not to
 * prescribe below these without medical supervision, and this app explicitly
 * is not medical supervision.
 */
export const ABSOLUTE_FLOOR_KCAL = { male: 1500, female: 1200 }

const kcalFromProtein = 4
const kcalFromCarbs = 4
const kcalFromFat = 9

export interface NutritionInputs {
  weight_kg: number
  height_cm?: number
  age?: number
  sex?: string
  bodyfat_pct?: number
  formula: Formula
  activity_multiplier: number
  goal: Goal
  goal_adjustment_kcal: number
  protein_g_per_kg?: number
  fat_g_per_kg?: number
}

export interface NutritionResult {
  formula: Formula
  formula_label: string
  lean_body_mass_kg: number | null
  bmr: number
  activity_multiplier: number
  tdee: number
  goal_adjustment_kcal: number
  target_kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  protein_g_per_kg: number
  fat_g_per_kg: number
  /** Non-fatal adjustments this module made to what the model asked for. */
  adjustments: string[]
}

const round = (n: number) => Math.round(n)
const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function isFemale(sex?: string): boolean {
  return typeof sex === 'string' && /^f/i.test(sex.trim())
}

/**
 * Basal metabolic rate.
 *
 * Katch-McArdle uses lean mass and is the better estimate when body-fat % is
 * known. Mifflin-St Jeor is the fallback. Falling back is not an error — most
 * people don't know their body fat.
 */
export function calculateBmr(input: NutritionInputs): { bmr: number; lbm: number | null; formula: Formula } {
  const { weight_kg, height_cm, age, sex, bodyfat_pct } = input

  const canKatch = input.formula === 'katch-mcardle'
    && typeof bodyfat_pct === 'number' && bodyfat_pct > 0 && bodyfat_pct < 70

  if (canKatch) {
    const lbm = weight_kg * (1 - bodyfat_pct! / 100)
    return { bmr: 370 + 21.6 * lbm, lbm, formula: 'katch-mcardle' }
  }

  // Mifflin-St Jeor needs height and age; without them fall back to a
  // bodyweight-only estimate rather than producing NaN.
  if (typeof height_cm !== 'number' || typeof age !== 'number') {
    return { bmr: 22 * weight_kg, lbm: null, formula: 'mifflin-st-jeor' }
  }

  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age
  return {
    bmr: base + (isFemale(sex) ? -161 : 5),
    lbm: null,
    formula: 'mifflin-st-jeor',
  }
}

/**
 * Never prescribe below BMR, and never below the absolute floor.
 *
 * A model asked for "a sustainable deficit" will usually give you one. It only
 * has to be wrong once — for a small, older, or low-activity person whose TDEE
 * is already near their BMR — to hand someone a genuinely unsafe target. This
 * is the guard that a prompt cannot provide.
 */
export function applySafetyFloor(
  target: number,
  bmr: number,
  sex: string | undefined,
  adjustments: string[],
): number {
  const absolute = isFemale(sex) ? ABSOLUTE_FLOOR_KCAL.female : ABSOLUTE_FLOOR_KCAL.male
  const floor = Math.max(bmr, absolute)

  if (target < floor) {
    adjustments.push(
      `Daily target raised to ${round(floor)} kcal — the requested deficit fell below ` +
      `${target < bmr ? 'your estimated BMR' : 'the minimum safe intake'}, which is not ` +
      `something to sustain without medical supervision.`,
    )
    return floor
  }
  return target
}

/**
 * Split a calorie target into grams of protein, fat and carbohydrate.
 *
 * Protein and fat are anchored per kg of bodyweight; carbohydrate fills
 * whatever is left. If the target is tight enough that carbs would go
 * negative, fat is walked back toward its lower bound before carbs are
 * allowed to bottom out — cutting carbs to zero is never the right answer.
 */
export function calculateMacros(
  targetKcal: number,
  weightKg: number,
  proteinPerKg: number,
  fatPerKg: number,
  adjustments: string[],
): { protein_g: number; fat_g: number; carbs_g: number; protein_g_per_kg: number; fat_g_per_kg: number } {
  const protein_g = proteinPerKg * weightKg
  let fat_g = fatPerKg * weightKg
  let effectiveFatPerKg = fatPerKg

  let remaining = targetKcal - protein_g * kcalFromProtein - fat_g * kcalFromFat

  const MIN_CARBS_G = 50
  if (remaining < MIN_CARBS_G * kcalFromCarbs) {
    // Reclaim calories from fat, but not below the bottom of the fat band.
    const minFat = FAT_G_PER_KG.min * weightKg
    const needed = MIN_CARBS_G * kcalFromCarbs - remaining
    const fatReduction = Math.min(needed / kcalFromFat, fat_g - minFat)
    if (fatReduction > 0) {
      fat_g -= fatReduction
      effectiveFatPerKg = fat_g / weightKg
      remaining += fatReduction * kcalFromFat
      adjustments.push(
        `Fat lowered to ${round1(effectiveFatPerKg)} g/kg so carbohydrate stays at a workable level.`,
      )
    }
  }

  const carbs_g = Math.max(0, remaining / kcalFromCarbs)

  return {
    protein_g: round(protein_g),
    fat_g: round(fat_g),
    carbs_g: round(carbs_g),
    protein_g_per_kg: round1(proteinPerKg),
    fat_g_per_kg: round1(effectiveFatPerKg),
  }
}

/**
 * The whole calculation, from the model's chosen inputs to the numbers shown
 * on the plan. Every value the model supplied is clamped to its allowed band
 * first, so an out-of-range choice degrades to the nearest sane value instead
 * of producing a bad plan.
 */
export function computeNutrition(input: NutritionInputs): NutritionResult {
  const adjustments: string[] = []
  const weight = input.weight_kg

  const { bmr, lbm, formula } = calculateBmr(input)

  if (formula !== input.formula) {
    adjustments.push('Body-fat % was not usable, so Mifflin-St Jeor was used instead of Katch-McArdle.')
  }

  const multiplierBand = formula === 'katch-mcardle' ? KATCH_MULTIPLIERS : MIFFLIN_MULTIPLIERS
  const activity = clamp(input.activity_multiplier, multiplierBand.min, multiplierBand.max)
  if (activity !== input.activity_multiplier) {
    adjustments.push(`Activity multiplier clamped to ${activity} for the ${formula} method.`)
  }

  const tdee = bmr * activity

  const band = GOAL_BANDS[input.goal] ?? GOAL_BANDS.maintain
  const adjustment = clamp(input.goal_adjustment_kcal, band.min, band.max)
  if (adjustment !== input.goal_adjustment_kcal) {
    adjustments.push(`Calorie adjustment clamped to ${adjustment} kcal for a ${input.goal} goal.`)
  }

  const rawTarget = tdee + adjustment
  const target = applySafetyFloor(rawTarget, bmr, input.sex, adjustments)

  const proteinPerKg = clamp(
    input.protein_g_per_kg ?? PROTEIN_G_PER_KG.default,
    PROTEIN_G_PER_KG.min, PROTEIN_G_PER_KG.max,
  )
  const fatPerKg = clamp(
    input.fat_g_per_kg ?? FAT_G_PER_KG.default,
    FAT_G_PER_KG.min, FAT_G_PER_KG.max,
  )

  const macros = calculateMacros(target, weight, proteinPerKg, fatPerKg, adjustments)

  return {
    formula,
    formula_label: formula === 'katch-mcardle' ? 'Katch-McArdle' : 'Mifflin-St Jeor',
    lean_body_mass_kg: lbm == null ? null : round1(lbm),
    bmr: round(bmr),
    activity_multiplier: activity,
    tdee: round(tdee),
    goal_adjustment_kcal: adjustment,
    target_kcal: round(target),
    ...macros,
    adjustments,
  }
}

/**
 * Sanity check used by the tests and available as a runtime assertion: the
 * macro grams should account for the calorie target to within rounding.
 */
export function macroKcal(r: Pick<NutritionResult, 'protein_g' | 'fat_g' | 'carbs_g'>): number {
  return r.protein_g * kcalFromProtein + r.carbs_g * kcalFromCarbs + r.fat_g * kcalFromFat
}

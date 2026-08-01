// Turning macro grams into the energy they represent.
//
// The plan hands the screen three gram figures and a calorie target as four
// unrelated numbers, which invites the most common misreading in nutrition:
// that protein, carbs and fat are separate things you manage separately, and
// calories are a fifth thing on top. They are not. Every one of those grams
// IS calories — the three columns are just different rates.
//
// So the numbers are computed here rather than written by the model: this is
// arithmetic, and arithmetic belongs in code where it can be tested.

/**
 * Atwater factors — the standard energy yield of each macronutrient, used on
 * every food label in the world. Alcohol is 7, which is why a few drinks add
 * up faster than people expect; it is not a macro you plan around, so it is
 * noted rather than budgeted.
 */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 }
export const KCAL_PER_G_ALCOHOL = 7

// Written here, not generated. This is general nutrition education that does
// not vary by person, so having a model rewrite it on every generation would
// cost tokens, vary between plans, and risk inventing something.
export const MACRO_COPY = {
  protein: {
    label: 'Protein',
    what: 'Meat, fish, eggs, dairy, legumes.',
    why: 'The repair material. In a calorie deficit your body will break down muscle for fuel unless you give it enough protein — this is the number that decides whether you lose fat or lose weight. It is also the most filling of the three per calorie.',
  },
  carbs: {
    label: 'Carbohydrates',
    what: 'Rice, bread, pasta, potatoes, fruit, oats.',
    why: 'Your training fuel. Stored in the muscles and liver as glycogen, which is what you run on in the gym and in sport. Cutting them does not burn fat faster; it mostly makes hard sessions feel harder.',
  },
  fat: {
    label: 'Fat',
    what: 'Olive oil, oily fish, nuts, avocado, eggs.',
    why: 'Needed for hormone production and to absorb vitamins A, D, E and K, so it cannot be driven to zero. It carries more than twice the energy per gram of the other two, which is the only reason it is easy to overshoot on.',
  },
}

const round = (n) => Math.round(n)
const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0)

/**
 * Energy contributed by each macro, and its share of the day.
 *
 * Shares are taken against the sum of the three, not against `target_kcal`,
 * so they always total 100%. The two differ by a few kcal because the grams
 * are rounded to whole numbers before they get here — `totalKcal` is returned
 * alongside so the screen can show the real sum rather than implying the
 * target was hit to the calorie.
 *
 * @param {{protein_g:number, carbs_g:number, fat_g:number, protein_g_per_kg?:number, fat_g_per_kg?:number}} numbers
 * @returns {{macros: object[], totalKcal: number}|null}
 */
export function macroBreakdown(numbers) {
  if (!numbers) return null

  const grams = {
    protein: Number(numbers.protein_g),
    carbs: Number(numbers.carbs_g),
    fat: Number(numbers.fat_g),
  }
  if (!Object.values(grams).every((g) => Number.isFinite(g) && g >= 0)) return null

  const kcal = {
    protein: grams.protein * KCAL_PER_G.protein,
    carbs: grams.carbs * KCAL_PER_G.carbs,
    fat: grams.fat * KCAL_PER_G.fat,
  }
  const totalKcal = kcal.protein + kcal.carbs + kcal.fat

  const perKg = {
    protein: numbers.protein_g_per_kg,
    carbs: undefined,
    fat: numbers.fat_g_per_kg,
  }

  return {
    totalKcal: round(totalKcal),
    macros: ['protein', 'carbs', 'fat'].map((key) => ({
      key,
      ...MACRO_COPY[key],
      grams: round(grams[key]),
      kcalPerG: KCAL_PER_G[key],
      kcal: round(kcal[key]),
      share: pct(kcal[key], totalKcal),
      perKg: perKg[key] ?? null,
    })),
  }
}

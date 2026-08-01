import { describe, it, expect } from 'vitest'
import { macroBreakdown, KCAL_PER_G, MACRO_COPY } from '../macros'

const NUMBERS = {
  protein_g: 150, carbs_g: 250, fat_g: 70,
  protein_g_per_kg: 1.8, fat_g_per_kg: 0.85,
  target_kcal: 2230,
}

const byKey = (b, key) => b.macros.find((m) => m.key === key)

describe('the energy values themselves', () => {
  // Atwater factors. If these ever drift, every number on the screen is wrong
  // and nothing else would fail.
  it('are the standard 4 / 4 / 9', () => {
    expect(KCAL_PER_G).toEqual({ protein: 4, carbs: 4, fat: 9 })
  })
})

describe('macroBreakdown', () => {
  it('converts each macro to the calories it carries', () => {
    const b = macroBreakdown(NUMBERS)
    expect(byKey(b, 'protein').kcal).toBe(600)  // 150 × 4
    expect(byKey(b, 'carbs').kcal).toBe(1000)   // 250 × 4
    expect(byKey(b, 'fat').kcal).toBe(630)      // 70 × 9
  })

  it('totals to the sum of the three', () => {
    expect(macroBreakdown(NUMBERS).totalKcal).toBe(2230)
  })

  // The total is shown next to the calorie target, so the two must land in
  // the same place — the grams are rounded to whole numbers upstream, so a
  // handful of kcal of drift is expected and anything more is a bug.
  it('lands within a few kcal of the calorie target it was derived from', () => {
    const b = macroBreakdown(NUMBERS)
    expect(Math.abs(b.totalKcal - NUMBERS.target_kcal)).toBeLessThanOrEqual(10)
  })

  it('gives each macro its share of the day, totalling 100%', () => {
    const b = macroBreakdown(NUMBERS)
    const shares = b.macros.map((m) => m.share)
    expect(shares.reduce((a, c) => a + c, 0)).toBe(100)
    expect(byKey(b, 'carbs').share).toBeGreaterThan(byKey(b, 'protein').share)
  })

  it('keeps the macros in a fixed order, so the layout never reshuffles', () => {
    expect(macroBreakdown(NUMBERS).macros.map((m) => m.key))
      .toEqual(['protein', 'carbs', 'fat'])
  })

  it('carries the per-kg figures where they exist, and null where they do not', () => {
    const b = macroBreakdown(NUMBERS)
    expect(byKey(b, 'protein').perKg).toBe(1.8)
    expect(byKey(b, 'fat').perKg).toBe(0.85)
    // Carbs are the remainder, so a per-kg target for them would be invented.
    expect(byKey(b, 'carbs').perKg).toBeNull()
  })

  it('attaches the explanation for each macro', () => {
    for (const m of macroBreakdown(NUMBERS).macros) {
      expect(m.label).toBe(MACRO_COPY[m.key].label)
      expect(m.why.length).toBeGreaterThan(40)
      expect(m.what.length).toBeGreaterThan(10)
    }
  })

  it('reports fat as the dense one, which is the whole point of showing this', () => {
    const b = macroBreakdown({ protein_g: 100, carbs_g: 100, fat_g: 100 })
    expect(byKey(b, 'fat').kcal).toBe(900)
    expect(byKey(b, 'protein').kcal).toBe(400)
    // Equal grams, unequal calories — the misconception the row is there for.
    expect(byKey(b, 'fat').share).toBeGreaterThan(byKey(b, 'carbs').share)
  })

  it('rounds grams and calories to whole numbers', () => {
    const b = macroBreakdown({ protein_g: 149.6, carbs_g: 250.4, fat_g: 69.7 })
    for (const m of b.macros) {
      expect(Number.isInteger(m.grams)).toBe(true)
      expect(Number.isInteger(m.kcal)).toBe(true)
    }
  })

  describe('bad input', () => {
    it('is null rather than a row of NaN', () => {
      expect(macroBreakdown(null)).toBeNull()
      expect(macroBreakdown(undefined)).toBeNull()
      expect(macroBreakdown({})).toBeNull()
      expect(macroBreakdown({ protein_g: 150, carbs_g: 250 })).toBeNull()
      expect(macroBreakdown({ protein_g: 'lots', carbs_g: 250, fat_g: 70 })).toBeNull()
      expect(macroBreakdown({ protein_g: -10, carbs_g: 250, fat_g: 70 })).toBeNull()
    })

    it('survives an all-zero plan without dividing by zero', () => {
      const b = macroBreakdown({ protein_g: 0, carbs_g: 0, fat_g: 0 })
      expect(b.totalKcal).toBe(0)
      expect(b.macros.every((m) => m.share === 0)).toBe(true)
    })
  })
})

import { describe, it, expect } from 'vitest'
import { weeklyWeights, weekStartMs, weightChange } from '../weight'

// A Wednesday, so bucketing to Monday is a real move rather than a no-op.
const WED = new Date(2026, 6, 22, 9, 0, 0)
const at = (dayOffset, hour = 9) => {
  const d = new Date(WED)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}
const w = (dayOffset, kg, hour) => ({ created_at: at(dayOffset, hour), weight_kg: kg })
const kgs = (series) => series.map((s) => s.kg)

describe('weekStartMs', () => {
  it('moves any day back to the Monday of its week', () => {
    const monday = new Date(2026, 6, 20)
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(2026, 6, 20 + i, 13, 45)
      expect(new Date(weekStartMs(d)).getTime()).toBe(monday.getTime())
    }
  })

  it('treats Sunday as the end of its week, not the start of the next', () => {
    const sunday = new Date(2026, 6, 26, 23, 30)
    expect(new Date(weekStartMs(sunday)).getDate()).toBe(20)
  })

  it('lands on local midnight', () => {
    const d = new Date(weekStartMs(new Date(2026, 6, 22, 17, 5)))
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0])
  })
})

describe('weeklyWeights', () => {
  it('is empty for no weigh-ins', () => {
    expect(weeklyWeights([])).toEqual([])
    expect(weeklyWeights(null)).toEqual([])
    expect(weeklyWeights(undefined)).toEqual([])
  })

  it('gives one point per week', () => {
    const series = weeklyWeights([w(0, 80), w(7, 79), w(14, 78)])
    expect(series).toHaveLength(3)
    expect(kgs(series)).toEqual([80, 79, 78])
  })

  // The whole reason the chart is weekly: several readings in a week collapse
  // to their mean, so water weight stops looking like progress.
  it('averages every reading logged in the same week', () => {
    const series = weeklyWeights([w(0, 80.0, 7), w(1, 81.0, 8), w(2, 79.0, 9)])
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({ kg: 80, count: 3 })
  })

  it('rounds the average to one decimal, like a bathroom scale', () => {
    // 80.1, 80.2, 80.4 → 80.2333…
    expect(weeklyWeights([w(0, 80.1), w(1, 80.2), w(2, 80.4)])[0].kg).toBe(80.2)
  })

  it('splits readings either side of a Monday into different weeks', () => {
    // Sunday then Monday: consecutive days, different weeks.
    const sunday = w(-3, 82) // Sunday 19 Jul
    const monday = w(-2, 81) // Monday 20 Jul
    const series = weeklyWeights([sunday, monday])
    expect(series).toHaveLength(2)
    expect(kgs(series)).toEqual([82, 81])
  })

  it('does not care what order the rows arrive in', () => {
    const rows = [w(14, 78), w(0, 80), w(7, 79)]
    expect(kgs(weeklyWeights(rows))).toEqual([80, 79, 78])
  })

  // A dropped empty week would slide everything after it leftwards, redrawing
  // a month off the scale as a single week. The gap has to occupy space.
  it('keeps a week with nothing logged, as a hole in the line', () => {
    const series = weeklyWeights([w(0, 80), w(21, 77)])
    expect(series).toHaveLength(4)
    expect(kgs(series)).toEqual([80, null, null, 77])
    expect(series.map((s) => s.count)).toEqual([1, 0, 0, 1])
  })

  it('starts at the first weigh-in and ends at the last, with nothing beyond', () => {
    const series = weeklyWeights([w(0, 80), w(7, 79)])
    expect(series[0].start.getDay()).toBe(1) // Monday
    expect(series).toHaveLength(2)
  })

  it('labels each point with the date its week starts', () => {
    const [only] = weeklyWeights([w(0, 80)])
    expect(only.key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(only.label).toEqual(expect.any(String))
    expect(only.label.length).toBeGreaterThan(0)
  })

  it('ignores rows with an unusable date or weight', () => {
    const series = weeklyWeights([
      w(0, 80),
      { created_at: 'not a date', weight_kg: 79 },
      { created_at: at(1), weight_kg: null },
      { created_at: at(1), weight_kg: 'heavy' },
    ])
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({ kg: 80, count: 1 })
  })

  // A year of weekly points is the case the horizontal scroll exists for.
  it('handles a long history without collapsing or duplicating weeks', () => {
    const rows = Array.from({ length: 52 }, (_, i) => w(i * 7, 90 - i * 0.2))
    const series = weeklyWeights(rows)
    expect(series).toHaveLength(52)
    expect(new Set(series.map((s) => s.key)).size).toBe(52)
    expect(series.every((s) => s.count === 1)).toBe(true)
  })
})

describe('weightChange', () => {
  it('is the difference between the first and last reading', () => {
    expect(weightChange([w(0, 86.4), w(7, 85.1), w(14, 83.9)])).toBe(-2.5)
  })

  it('is positive when the weight went up', () => {
    expect(weightChange([w(0, 80), w(7, 81.5)])).toBe(1.5)
  })

  it('is null until there are two readings to compare', () => {
    expect(weightChange([])).toBeNull()
    expect(weightChange([w(0, 80)])).toBeNull()
  })

  // Deliberately the raw readings, not the weekly means — this number sits
  // under "since start" and has to match the scale the person stood on.
  it('uses the raw first and last, not the weekly averages', () => {
    // Week one averages 80.5; the first actual reading is 81.
    const series = [w(0, 81), w(1, 80), w(7, 79)]
    expect(weightChange(series)).toBe(-2)
  })

  it('sorts before comparing, so row order cannot flip the sign', () => {
    expect(weightChange([w(7, 79), w(0, 81)])).toBe(-2)
  })
})

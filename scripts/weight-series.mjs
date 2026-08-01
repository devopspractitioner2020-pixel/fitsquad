/**
 * Generates a believable weigh-in history.
 *
 * Shared by seed.mjs (the demo squad) and seed-weights.mjs (your own account)
 * so the chart you develop against and the chart you demo look the same.
 *
 * The shape matters more than the numbers. A clean straight line would hide
 * every rendering bug worth catching: it would not show whether the weekly
 * average is actually averaging, whether a gap week is drawn as a gap, or
 * whether the line survives a plateau. So this produces a downward trend with
 * daily noise, a plateau, weekend bumps, several readings in some weeks and
 * exactly one deliberate week with nothing logged at all.
 */

const day = (n) => new Date(Date.now() - n * 864e5).toISOString()

// Must match weekStartMs in src/lib/weight.js — the chart buckets by local
// Monday, so "a week with nothing logged" has to mean the same Monday-to-
// Sunday span here or the gap lands across two weeks and neither is empty.
const weekStartOf = (value) => {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

/**
 * Deterministic PRNG — re-running gives the same history, not a new one.
 *
 * Math.imul, not `*`: the plain multiply overflows 2^53 on the second step,
 * so the low bits — the only ones that carry any randomness in an LCG — are
 * silently rounded away and the sequence degenerates.
 */
export function rng(seed = 20260727) {
  let s = seed | 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) | 0
    return (s >>> 0) / 4294967296
  }
}

/**
 * @param {object}   opts
 * @param {number}   opts.start   starting weight in kg
 * @param {number}   opts.target  where they are heading
 * @param {number}   opts.days    how far back to go
 * @param {number}   opts.keen    0–1: how consistently they weigh in and how
 *                                fast they actually move
 * @param {Function} opts.rnd     PRNG from rng()
 * @param {number}   [opts.skipWeeksAgo]  a week with nothing logged, so the
 *                                gap handling in the chart is exercised
 */
export function weightSeries({ start, target, days, keen = 1, rnd, skipWeeksAgo = 3 }) {
  const out = []
  let w = start
  const perDay = ((start - target) / days) * keen
  const skippedWeek = weekStartOf(Date.now() - skipWeeksAgo * 7 * 864e5)

  for (let d = days; d >= 0; d -= 1) {
    // The holiday week: still losing weight underneath, just not stepping on
    // the scale. The chart should span it, not pretend it did not happen.
    const inSkippedWeek = weekStartOf(day(d)) === skippedWeek

    // The underlying trend. Noise and weekend bumps are added to the READING
    // below, not to `w` — a bump you fold back into the running value is not
    // a bump, it is a permanent gain, and over a long history it out-runs the
    // downward trend entirely and draws a chart going the wrong way.
    const plateau = d > days * 0.35 && d < days * 0.5 ? 0.25 : 1
    w -= perDay * plateau

    const reading = w + (rnd() - 0.5) * 0.9 + (d % 7 === 6 ? 0.35 : 0)

    // Monday always, plus most other days for a keen logger — which is what
    // makes the weekly average a real average rather than one reading.
    const logsToday = d % 7 === 0 || rnd() < 0.45 * keen
    if (logsToday && !inSkippedWeek) {
      out.push({ created_at: day(d), weight_kg: +reading.toFixed(1) })
    }
  }
  return out
}

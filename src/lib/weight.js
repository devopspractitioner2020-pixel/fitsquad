// Turning a list of weigh-ins into the series the chart draws.
//
// People are told to weigh in daily and judge by the weekly average — it is
// in the plan's own tracking advice — because day-to-day movement is water,
// food volume and salt, not fat. A chart of raw daily readings shows that
// noise as if it were progress, and on a phone it also shows sixty dots in
// the width of a thumb. So the chart is weekly: one point per week, the mean
// of everything logged in it.

const DAY_MS = 864e5

/** Local midnight on the Monday of the week containing `value`. */
export function weekStartMs(value) {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  // getDay() is Sunday-based; shift so Monday is 0. A week that runs Mon–Sun
  // matches how people talk about "this week" and how the leaderboard resets.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

// Adding 7 * 864e5 would drift by an hour across a daylight-saving boundary
// and eventually land the "week start" on a Sunday evening. Stepping the date
// field and re-normalising keeps every bucket on a local Monday midnight.
const nextWeekMs = (ms) => {
  const d = new Date(ms)
  d.setDate(d.getDate() + 7)
  return weekStartMs(d)
}

const round1 = (n) => Math.round(n * 10) / 10

// Number(null) and Number('') are both 0, which is finite — so a null weight
// would sail through a plain isFinite check and pull a week's average down
// towards zero. Anything that is not a positive number is not a weight.
const toKg = (value) => {
  if (value == null || value === '') return NaN
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

const labelOf = (ms) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/**
 * Weekly averages, oldest first, one entry per calendar week between the
 * first and last weigh-in.
 *
 * Weeks with nothing logged are included with `kg: null` rather than dropped.
 * Dropping them would slide the following week leftwards and quietly redraw a
 * three-week gap as a one-week one — the chart would be lying about how long
 * something took. The line is drawn across the gap; the missing dot is what
 * says nothing was logged.
 *
 * @param {{created_at: string, weight_kg: number}[]} weighIns  any order
 * @returns {{key: string, start: Date, label: string, kg: number|null, count: number}[]}
 */
export function weeklyWeights(weighIns) {
  const rows = (weighIns ?? [])
    .map((w) => ({ t: new Date(w?.created_at).getTime(), kg: toKg(w?.weight_kg) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.kg))
    .sort((a, b) => a.t - b.t)

  if (!rows.length) return []

  const buckets = new Map()
  for (const r of rows) {
    const k = weekStartMs(r.t)
    const b = buckets.get(k) ?? { sum: 0, count: 0 }
    b.sum += r.kg
    b.count += 1
    buckets.set(k, b)
  }

  const out = []
  const last = weekStartMs(rows[rows.length - 1].t)
  for (let k = weekStartMs(rows[0].t); k <= last; k = nextWeekMs(k)) {
    const b = buckets.get(k)
    out.push({
      key: new Date(k).toISOString().slice(0, 10),
      start: new Date(k),
      label: labelOf(k),
      kg: b ? round1(b.sum / b.count) : null,
      count: b?.count ?? 0,
    })
  }
  return out
}

/**
 * Total change between the first and last weigh-in, in kg.
 *
 * Deliberately taken from the raw readings, not the weekly means: this is the
 * number under "since start", and a person comparing it against the scale in
 * their bathroom should see the scale's number, not an average that includes
 * days they were heavier.
 */
export function weightChange(weighIns) {
  const rows = (weighIns ?? [])
    .filter((w) => Number.isFinite(toKg(w?.weight_kg)) && Number.isFinite(new Date(w?.created_at).getTime()))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  if (rows.length < 2) return null
  return round1(toKg(rows[rows.length - 1].weight_kg) - toKg(rows[0].weight_kg))
}

export { DAY_MS }

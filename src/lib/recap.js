import { supabase } from './supabase'
import { WORKOUT_TYPES } from './postLabels'

// The weekly recap: one squad's week, as a set of story cards.
//
// The week boundary is Monday, matching src/lib/weight.js and the SQL in
// migration 0012. Three definitions of "this week" in one app is how a chart
// and a recap end up disagreeing about which days they covered.

const DAY_MS = 864e5

/** Monday 00:00 UTC of the week containing `value`. */
export function weekStart(value = new Date()) {
  const d = new Date(value)
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const day = new Date(utc).getUTCDay() // 0 = Sunday
  return new Date(utc - ((day + 6) % 7) * DAY_MS)
}

/** The ISO date string the RPC takes, e.g. '2026-07-27'. */
export const weekKey = (value = new Date()) => weekStart(value).toISOString().slice(0, 10)

/** The Monday of the week before the one containing `value`. */
export const lastWeekKey = (value = new Date()) =>
  weekKey(new Date(weekStart(value).getTime() - DAY_MS))

/**
 * When a week's recap unlocks: Sunday 18:00 UTC.
 *
 * Deliberately the same rule as `recap_available_at` in SQL. The client uses
 * it only to decide what to SAY while waiting — the server enforces it, so a
 * clock skewed forward on someone's phone cannot open the week early.
 */
export function availableAt(key) {
  const monday = new Date(`${key}T00:00:00.000Z`)
  return new Date(monday.getTime() + 6 * DAY_MS + 18 * 3600_000)
}

export const isReady = (key, now = new Date()) => now >= availableAt(key)

/** "27 Jul – 2 Aug" */
export function weekLabel(key) {
  const monday = new Date(`${key}T00:00:00.000Z`)
  const sunday = new Date(monday.getTime() + 6 * DAY_MS)
  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${fmt(monday)} – ${fmt(sunday)}`
}

/**
 * Fetch one week.
 *
 * Resolves to null when the week has not unlocked yet — the server returns
 * null for that, and it is a different thing from an empty week.
 */
export async function getRecap(squadId, key) {
  if (!squadId) return null
  const { data, error } = await supabase.rpc('squad_recap', { sid: squadId, wk: key })
  if (error) throw error
  return data ?? null
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Derived from the same list the log sheet and the card use, rather than a
// second copy that could drift. A type the client does not recognise falls
// back below rather than rendering `undefined`.
const WORKOUT_LABEL = Object.fromEntries(WORKOUT_TYPES.map((t) => [t.value, t.label]))
const WORKOUT_EMOJI = Object.fromEntries(WORKOUT_TYPES.map((t) => [t.value, t.icon]))

/**
 * Did anything actually happen this week?
 *
 * Asked of the totals rather than of the number of story cards. Counting
 * cards conflates "a full week" with "the scaffolding a quiet week still
 * gets" — cover and outro exist either way, so a card count can never tell
 * the two apart.
 */
export function hasContent(recap) {
  const t = recap?.totals
  if (!t) return false
  return ['workouts', 'healthy_meals', 'cheats', 'weigh_ins', 'reactions', 'comments']
    .some((k) => Number(t[k] ?? 0) > 0)
}

/**
 * Turn a recap into the ordered cards the story player shows.
 *
 * Built here rather than in the component so the sequence is testable and so
 * a quiet week produces a short story instead of five cards of zeroes. Every
 * card earns its place: no data, no card.
 */
export function buildStories(recap) {
  if (!recap) return []
  const t = recap.totals ?? {}
  const cards = []
  const seen = new Set()

  // Guards against the same post appearing twice under two headings.
  const postCard = (post, { id, eyebrow, emoji }) => {
    if (!post || seen.has(post.id)) return null
    seen.add(post.id)

    // The reactions themselves, not a count of them. "2 reactions" tells you
    // the number and hides the thing — 🔥 and 🤤 say something a number
    // cannot. Ordered by count so the loudest one leads.
    const reactions = Object.entries(post.reaction_emoji ?? {})
      .map(([e, count]) => ({ emoji: e, count: Number(count) || 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))

    return {
      id,
      kind: 'post',
      eyebrow,
      // The emoji is a stand-in for a picture. A card with a photo or a video
      // has one, so it does not need a symbol as well.
      emoji: post.photo_url || post.video_url ? null : emoji,
      title: post.title,
      subtitle: post.author,
      photo: post.photo_url ?? null,
      // A tip whose whole content is an Instagram video used to render as its
      // title and nothing else — a card reading "Dinner" for a video of
      // somebody making dinner. Now the card shows the video.
      video: post.photo_url ? null : (post.video_url ?? null),
      reactions,
    }
  }

  cards.push({
    id: 'cover',
    kind: 'cover',
    eyebrow: 'Weekly recap',
    title: recap.squad_name ?? 'Your squad',
    subtitle: weekLabel(recap.week_start),
  })

  const logged = (t.workouts ?? 0) + (t.healthy_meals ?? 0)
  cards.push({
    id: 'totals',
    kind: 'stats',
    eyebrow: 'The week in numbers',
    title: logged > 0 ? `${logged} logs` : 'A quiet week',
    subtitle: logged > 0
      ? `across ${plural(t.members ?? 0, 'member')}`
      : 'Nobody logged much — next week is a clean slate.',
    stats: [
      { label: 'Workouts', value: t.workouts ?? 0 },
      { label: 'Healthy meals', value: t.healthy_meals ?? 0 },
      { label: 'Weigh-ins', value: t.weigh_ins ?? 0 },
      { label: 'Cheat meals', value: t.cheats ?? 0 },
    ],
  })

  // In the gym. The old recap never said a word about training beyond a
  // count in the totals grid.
  const tr = recap.training
  if (tr?.sessions > 0) {
    const hours = Math.round((tr.minutes ?? 0) / 6) / 10
    cards.push({
      id: 'training',
      kind: 'stats',
      eyebrow: 'In the gym',
      title: plural(tr.sessions, 'session'),
      subtitle: tr.minutes > 0
        ? `${hours} hours of training between ${plural(tr.people ?? 0, 'person', 'people')}`
        : `between ${plural(tr.people ?? 0, 'person', 'people')}`,
      emoji: WORKOUT_EMOJI[tr.top_type] ?? '🏋️',
      stats: tr.top_type
        ? [{ label: 'Most common', value: WORKOUT_LABEL[tr.top_type] ?? tr.top_type }]
        : [],
    })
  }

  if (recap.top_logger?.logs > 0) {
    cards.push({
      id: 'top-logger',
      kind: 'champion',
      eyebrow: 'Most consistent',
      title: recap.top_logger.name,
      subtitle: `${plural(recap.top_logger.logs, 'log')} this week`,
      emoji: '🏆',
    })
  }

  if (recap.biggest_drop?.delta < 0) {
    cards.push({
      id: 'biggest-drop',
      kind: 'champion',
      eyebrow: 'Biggest move on the scale',
      title: recap.biggest_drop.name,
      // The sign is already negative; formatting it as "down X" reads better
      // than "-1.4 kg" and avoids the minus getting lost at display size.
      subtitle: `down ${Math.abs(recap.biggest_drop.delta)} kg`,
      emoji: '📉',
    })
  }

  // One card per KIND, and no overall winner.
  //
  // The previous version had both, so when the week's top post was a meal —
  // which it usually is, most of what gets posted is food — the story showed
  // two meal cards captioned "Most loved" and "Best plate" and nothing
  // distinguished them. The best meal already IS the most-loved meal.
  const picks = [
    postCard(recap.top_workout, { id: 'top-workout', eyebrow: 'Session of the week', emoji: '🏋️' }),
    postCard(recap.top_meal, { id: 'top-meal', eyebrow: 'Plate of the week', emoji: '🍽️' }),
    postCard(recap.top_tip, { id: 'top-tip', eyebrow: 'Tip worth keeping', emoji: '✨' }),
  ].filter(Boolean)

  // Falls back to the older shapes so a response from before 0014 or 0015
  // still produces a story rather than a gap.
  if (!picks.length) {
    const legacy = recap.top_post ? [recap.top_post] : (recap.top_posts ?? [])
    for (const post of legacy) {
      const card = postCard(post, { id: `post-${post.id}`, eyebrow: 'Most loved', emoji: '❤️‍🔥' })
      if (card) picks.push(card)
    }
  }
  cards.push(...picks)

  if ((t.reactions ?? 0) + (t.comments ?? 0) > 0) {
    cards.push({
      id: 'engagement',
      kind: 'stats',
      eyebrow: 'Cheering each other on',
      title: `${plural(t.reactions ?? 0, 'reaction')}`,
      subtitle: `and ${plural(t.comments ?? 0, 'comment')} between you`,
      stats: [],
    })
  }

  cards.push({
    id: 'outro',
    kind: 'outro',
    eyebrow: 'Next week',
    title: 'Same time, same squad',
    subtitle: 'A new recap lands every Sunday at 6pm.',
  })

  return cards
}

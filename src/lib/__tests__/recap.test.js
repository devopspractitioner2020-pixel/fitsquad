import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const {
  weekStart, weekKey, lastWeekKey, availableAt, isReady, weekLabel,
  getRecap, buildStories,
} = await import('../recap')

beforeEach(() => rpc.mockReset())

describe('the week boundary', () => {
  // Must match weekStartMs in src/lib/weight.js and week_start() in SQL.
  // Three definitions of "this week" is how a chart and a recap end up
  // disagreeing about which days they covered.
  it('is Monday, for every day of the week', () => {
    const monday = '2026-07-27'
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(Date.UTC(2026, 6, 27 + i, 13, 30))
      expect(weekKey(d)).toBe(monday)
    }
  })

  it('treats Sunday as the end of its week, not the start of the next', () => {
    expect(weekKey(new Date('2026-08-02T23:59:00Z'))).toBe('2026-07-27')
    expect(weekKey(new Date('2026-08-03T00:01:00Z'))).toBe('2026-08-03')
  })

  it('starts at midnight', () => {
    const d = weekStart(new Date('2026-07-29T17:05:00Z'))
    expect(d.toISOString()).toBe('2026-07-27T00:00:00.000Z')
  })

  it('gives the previous week for the recap', () => {
    expect(lastWeekKey(new Date('2026-08-05T10:00:00Z'))).toBe('2026-07-27')
  })
})

describe('when a recap opens', () => {
  // Sunday at 6pm, as asked for.
  it('is Sunday 18:00 UTC of that week', () => {
    expect(availableAt('2026-07-27').toISOString()).toBe('2026-08-02T18:00:00.000Z')
  })

  it('is not ready a minute before', () => {
    expect(isReady('2026-07-27', new Date('2026-08-02T17:59:00Z'))).toBe(false)
  })

  it('is ready on the minute, and stays ready', () => {
    expect(isReady('2026-07-27', new Date('2026-08-02T18:00:00Z'))).toBe(true)
    expect(isReady('2026-07-27', new Date('2026-12-01T00:00:00Z'))).toBe(true)
  })

  // Deliberately locale-agnostic. The label goes through
  // toLocaleDateString, so a test that pins "27 Jul" passes in London and
  // fails in New York — and the thing worth asserting is that it spans the
  // right two dates, not which order the parts come in.
  it('labels the week as a range covering both ends', () => {
    const label = weekLabel('2026-07-27')
    expect(label).toMatch(/27/)
    expect(label).toMatch(/Jul/)
    expect(label).toMatch(/Aug/)
    expect(label).toMatch(/\b2\b/)
    expect(label).toContain('–')
  })
})

describe('getRecap', () => {
  it('asks for one squad and one week', async () => {
    rpc.mockResolvedValue({ data: { week_start: '2026-07-27' }, error: null })
    await getRecap('s1', '2026-07-27')
    expect(rpc).toHaveBeenCalledWith('squad_recap', { sid: 's1', wk: '2026-07-27' })
  })

  // The server returns null for a week that has not opened. That is not the
  // same as an empty week, and the screen says something different for each.
  it('passes a locked week through as null rather than inventing a recap', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await getRecap('s1', '2026-07-27')).toBeNull()
  })

  it('does not call the database with no squad', async () => {
    expect(await getRecap(undefined, '2026-07-27')).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('throws so the screen can say what went wrong', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Not a member of that squad.' } })
    await expect(getRecap('s1', '2026-07-27')).rejects.toMatchObject({
      message: 'Not a member of that squad.',
    })
  })
})

const recap = (over = {}) => ({
  week_start: '2026-07-27',
  squad_name: 'The Test Squad',
  totals: { workouts: 9, healthy_meals: 14, cheats: 2, weigh_ins: 11, reactions: 20, comments: 4, members: 3 },
  leaderboard: [{ name: 'Vic', logs: 12 }, { name: 'María', logs: 8 }],
  top_logger: { name: 'Vic', logs: 12 },
  biggest_drop: { name: 'María', delta: -1.4 },
  training: { sessions: 9, minutes: 480, top_type: 'strength', people: 3 },
  top_workout: {
    id: 'p2', title: 'Morning run', author: 'María', reactions: 4, kind: 'workout',
    reaction_emoji: { '🔥': 3, '💪': 1 },
  },
  top_meal: {
    id: 'p3', title: 'Ceviche', author: 'Diego', reactions: 3, kind: 'meal',
    photo_url: 'https://x/y.jpg', reaction_emoji: { '🤤': 3 },
  },
  top_tip: {
    id: 'p4', title: 'Prep on Sunday', author: 'Sam', reactions: 2, kind: 'tip',
    video_url: 'https://www.instagram.com/reel/abc/', reaction_emoji: { '👏': 2 },
  },
  ...over,
})

describe('buildStories', () => {
  const ids = (r) => buildStories(r).map((c) => c.id)

  it('opens on a cover and ends on an outro', () => {
    const cards = buildStories(recap())
    expect(cards[0].kind).toBe('cover')
    expect(cards[cards.length - 1].kind).toBe('outro')
  })

  it('names the squad and the week on the cover', () => {
    const [cover] = buildStories(recap())
    expect(cover.title).toBe('The Test Squad')
    expect(cover.subtitle).toBe(weekLabel('2026-07-27'))
  })

  it('puts the week in numbers', () => {
    const stats = buildStories(recap()).find((c) => c.id === 'totals')
    expect(stats.title).toBe('23 logs')
    expect(stats.stats).toEqual([
      { label: 'Workouts', value: 9 },
      { label: 'Healthy meals', value: 14 },
      { label: 'Weigh-ins', value: 11 },
      { label: 'Cheat meals', value: 2 },
    ])
  })

  it('crowns the most consistent logger', () => {
    const card = buildStories(recap()).find((c) => c.id === 'top-logger')
    expect(card.title).toBe('Vic')
    expect(card.subtitle).toBe('12 logs this week')
  })

  // "-1.4 kg" loses its minus sign at 34px. "down 1.4 kg" cannot.
  it('reads a weight loss as "down", not as a negative number', () => {
    const card = buildStories(recap()).find((c) => c.id === 'biggest-drop')
    expect(card.subtitle).toBe('down 1.4 kg')
  })

  it('names the author under the title, without a reaction count', () => {
    const card = buildStories(recap()).find((c) => c.id === 'top-meal')
    expect(card.title).toBe('Ceviche')
    expect(card.subtitle).toBe('Diego')
    expect(card.subtitle).not.toMatch(/reaction/)
  })

  it('carries a post photo through, so the card can show it', () => {
    const card = buildStories(recap()).find((c) => c.id === 'top-meal')
    expect(card.photo).toBe('https://x/y.jpg')
  })

  // Every card has to earn its place. Five cards of zeroes is worse than
  // three honest ones.
  describe('a quiet week', () => {
    const quiet = recap({
      totals: { workouts: 0, healthy_meals: 0, cheats: 0, weigh_ins: 0, reactions: 0, comments: 0, members: 3 },
      training: { sessions: 0, minutes: 0, top_type: null, people: 0 },
      top_logger: null,
      biggest_drop: null,
      top_workout: null, top_meal: null, top_tip: null,
      top_posts: [],
    })

    it('drops the champion cards rather than crowning nobody', () => {
      expect(ids(quiet)).toEqual(['cover', 'totals', 'outro'])
    })

    it('says so instead of announcing "0 logs"', () => {
      const stats = buildStories(quiet).find((c) => c.id === 'totals')
      expect(stats.title).toBe('A quiet week')
      expect(stats.subtitle).toMatch(/clean slate/i)
    })
  })

  it('drops the drop card when the squad gained weight', () => {
    expect(ids(recap({ biggest_drop: { name: 'Vic', delta: 0.6 } }))).not.toContain('biggest-drop')
  })

  it('drops the top-logger card when nobody logged', () => {
    expect(ids(recap({ top_logger: { name: 'Vic', logs: 0 } }))).not.toContain('top-logger')
  })

  it('drops the engagement card when nobody reacted or commented', () => {
    const totals = { workouts: 3, healthy_meals: 1, cheats: 0, weigh_ins: 0, reactions: 0, comments: 0, members: 2 }
    expect(ids(recap({ totals }))).not.toContain('engagement')
  })

  it('pluralises everything it counts', () => {
    const one = buildStories(recap({ top_logger: { name: 'Vic', logs: 1 } }))
    expect(one.find((c) => c.id === 'top-logger').subtitle).toBe('1 log this week')
  })

  it('is empty for no recap at all', () => {
    expect(buildStories(null)).toEqual([])
    expect(buildStories(undefined)).toEqual([])
  })

  it('survives a recap missing its optional halves', () => {
    expect(() => buildStories({ week_start: '2026-07-27' })).not.toThrow()
    expect(buildStories({ week_start: '2026-07-27' }).length).toBeGreaterThan(0)
  })

  it('gives every card a unique id, so React keys are stable', () => {
    const all = buildStories(recap()).map((c) => c.id)
    expect(new Set(all).size).toBe(all.length)
  })
})

// The screenshot: three cards in a row, each captioned MOST LOVED. A
// superlative has one winner — repeating it three times is the same card
// three times with different nouns.
describe('every story card says something different', () => {
  const eyebrows = (r) => buildStories(r).map((c) => c.eyebrow)

  // "Most loved" and "Best plate" were both meals — most of what gets posted
  // is food, so the overall winner usually WAS the top meal, and no reader
  // could say what separated the two cards.
  it('has no overall superlative competing with the per-kind cards', () => {
    expect(eyebrows(recap())).not.toContain('Most loved')
    expect(buildStories(recap()).map((c) => c.id)).not.toContain('top-post')
  })

  it('never repeats any eyebrow', () => {
    const all = eyebrows(recap())
    expect(new Set(all).size).toBe(all.length)
  })

  it('covers the session and the plate as separate cards', () => {
    const cards = buildStories(recap())
    expect(cards.find((c) => c.id === 'top-workout').eyebrow).toBe('Session of the week')
    expect(cards.find((c) => c.id === 'top-meal').eyebrow).toBe('Plate of the week')
  })

  it('shows each post once, even if one wins two categories', () => {
    const dup = { id: 'p2', title: 'Morning run', author: 'María', reactions: 4 }
    const cards = buildStories(recap({ top_workout: dup, top_meal: dup }))
    expect(cards.filter((c) => c.title === 'Morning run')).toHaveLength(1)
  })

  it('skips the kinds nobody posted rather than showing an empty card', () => {
    const ids2 = buildStories(recap({ top_meal: null })).map((c) => c.id)
    expect(ids2).toContain('top-workout')
    expect(ids2).not.toContain('top-meal')
  })
})

// Tips are mostly TikTok and Instagram links, and a link has nothing to show
// in a five-second card: the title alone gave cards reading "Dinner" for a
// video of somebody cooking, and embedding the player gave a card you had to
// stop and watch — in a format built to keep moving.
describe('tips are not story material', () => {
  it('never builds a tip card, even when there is a good one', () => {
    const cards = buildStories(recap())
    expect(cards.map((c) => c.id)).not.toContain('top-tip')
    expect(cards.map((c) => c.eyebrow)).not.toContain('Tip worth keeping')
    expect(cards.map((c) => c.title)).not.toContain('Prep on Sunday')
  })

  it('leaves the rest of the story intact', () => {
    const ids2 = buildStories(recap()).map((c) => c.id)
    expect(ids2).toContain('top-workout')
    expect(ids2).toContain('top-meal')
    expect(ids2).toContain('training')
  })

  // The old shape returned a flat list that could contain one.
  it('filters a tip out of an older response too', () => {
    const cards = buildStories(recap({
      top_workout: undefined, top_meal: undefined, top_tip: undefined,
      top_posts: [
        { id: 'p9', kind: 'tip', title: 'Dinner', author: 'Kati', reaction_emoji: { '👏': 2 } },
        { id: 'p8', kind: 'meal', title: 'Ceviche', author: 'Diego', reaction_emoji: { '🤤': 1 } },
      ],
    }))
    expect(cards.map((c) => c.title)).not.toContain('Dinner')
    expect(cards.map((c) => c.title)).toContain('Ceviche')
  })

  // No card carries a video any more, so nothing in the player can block on
  // one loading.
  it('puts no video on any card', () => {
    for (const card of buildStories(recap())) {
      expect(card.video).toBeUndefined()
    }
  })
})

// "It is better you show the reactions than just mention the number."
describe('the reactions on a post card', () => {
  const card = (r, id = 'top-workout') => buildStories(r).find((c) => c.id === id)

  it('carries the emoji and their counts, not a total', () => {
    expect(card(recap()).reactions).toEqual([
      { emoji: '🔥', count: 3 },
      { emoji: '💪', count: 1 },
    ])
  })

  it('leads with the loudest one', () => {
    const c = card(recap({
      top_workout: { id: 'p2', title: 'x', author: 'a', reaction_emoji: { '💪': 1, '🤤': 5 } },
    }))
    expect(c.reactions[0]).toEqual({ emoji: '🤤', count: 5 })
  })

  it('drops any emoji sitting at zero', () => {
    const c = card(recap({
      top_workout: { id: 'p2', title: 'x', author: 'a', reaction_emoji: { '🔥': 2, '😅': 0 } },
    }))
    expect(c.reactions.map((r) => r.emoji)).toEqual(['🔥'])
  })

  it('is an empty list, not undefined, when the breakdown is missing', () => {
    const c = card(recap({ top_workout: { id: 'p2', title: 'x', author: 'a' } }))
    expect(c.reactions).toEqual([])
  })
})

describe('the picture on a post card', () => {
  it('shows a photo when the post has one, and drops the stand-in emoji', () => {
    const card = buildStories(recap()).find((c) => c.id === 'top-meal')
    expect(card.photo).toBe('https://x/y.jpg')
    expect(card.emoji).toBeNull()
  })

  it('falls back to an emoji when there is no photo', () => {
    const card = buildStories(recap()).find((c) => c.id === 'top-workout')
    expect(card.photo).toBeNull()
    expect(card.emoji).toBe('🏋️')
  })

  // A meal or workout logged with a video and no photo still reads fine: its
  // title says what it is, which was never true of a tip called "Dinner".
  it('ignores a video url rather than trying to embed it', () => {
    const card = buildStories(recap({
      top_meal: { id: 'p3', title: 'Ceviche', author: 'Diego', video_url: 'https://x/v' },
    })).find((c) => c.id === 'top-meal')
    expect(card.video).toBeUndefined()
    expect(card.emoji).toBe('🍽️')
  })
})

// The gym was never mentioned beyond a number in the totals grid.
describe('the training card', () => {
  it('reports sessions, hours and how many people trained', () => {
    const card = buildStories(recap()).find((c) => c.id === 'training')
    expect(card.title).toBe('9 sessions')
    expect(card.subtitle).toBe('8 hours of training between 3 people')
  })

  it('names the most common type, with its own icon', () => {
    const card = buildStories(recap({
      training: { sessions: 4, minutes: 120, top_type: 'cardio', people: 2 },
    })).find((c) => c.id === 'training')
    expect(card.stats).toEqual([{ label: 'Most common', value: 'Cardio' }])
    expect(card.emoji).toBe('🏃')
  })

  it('copes with a type the client does not know', () => {
    const card = buildStories(recap({
      training: { sessions: 2, minutes: 60, top_type: 'crossfit', people: 1 },
    })).find((c) => c.id === 'training')
    expect(card.stats).toEqual([{ label: 'Most common', value: 'crossfit' }])
    expect(card.emoji).toBe('🏋️')
  })

  it('says "1 person" rather than "1 persons"', () => {
    const card = buildStories(recap({
      training: { sessions: 1, minutes: 45, top_type: 'strength', people: 1 },
    })).find((c) => c.id === 'training')
    expect(card.subtitle).toMatch(/between 1 person$/)
  })

  it('is absent when nobody trained', () => {
    const ids2 = buildStories(recap({ training: { sessions: 0, minutes: 0, people: 0 } })).map((c) => c.id)
    expect(ids2).not.toContain('training')
  })

  it('drops the hours when no minutes were recorded', () => {
    const card = buildStories(recap({
      training: { sessions: 3, minutes: 0, top_type: null, people: 2 },
    })).find((c) => c.id === 'training')
    expect(card.subtitle).toBe('between 2 people')
    expect(card.stats).toEqual([])
  })
})

// A response from before migration 0014 has only `top_posts`.
describe('a recap from the older shape', () => {
  const old = recap({
    training: undefined,
    top_workout: undefined, top_meal: undefined, top_tip: undefined,
    top_posts: [
      { id: 'p1', title: 'Push day', author: 'Vic', reactions: 6 },
      { id: 'p2', title: 'Ceviche', author: 'María', reactions: 4 },
    ],
  })

  it('still produces a story rather than a gap', () => {
    const cards = buildStories(old)
    expect(cards.map((c) => c.title)).toContain('Push day')
    expect(cards.map((c) => c.title)).toContain('Ceviche')
  })

  it('does not throw on a missing training block', () => {
    expect(() => buildStories(old)).not.toThrow()
  })
})

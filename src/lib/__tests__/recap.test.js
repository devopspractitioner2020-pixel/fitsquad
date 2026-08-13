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
  top_posts: [
    { id: 'p1', title: 'Push day', author: 'Vic', reactions: 6, photo_url: null, kind: 'workout' },
  ],
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

  it('shows the most-loved posts', () => {
    const card = buildStories(recap()).find((c) => c.id === 'post-p1')
    expect(card.title).toBe('Push day')
    expect(card.subtitle).toBe('Vic · 6 reactions')
  })

  it('carries a post photo through, so the card can show it', () => {
    const card = buildStories(recap({
      top_posts: [{ id: 'p1', title: 'Ceviche', author: 'María', reactions: 3, photo_url: 'https://x/y.jpg' }],
    })).find((c) => c.id === 'post-p1')
    expect(card.photo).toBe('https://x/y.jpg')
  })

  // Every card has to earn its place. Five cards of zeroes is worse than
  // three honest ones.
  describe('a quiet week', () => {
    const quiet = recap({
      totals: { workouts: 0, healthy_meals: 0, cheats: 0, weigh_ins: 0, reactions: 0, comments: 0, members: 3 },
      top_logger: null,
      biggest_drop: null,
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
    const one = buildStories(recap({
      top_logger: { name: 'Vic', logs: 1 },
      top_posts: [{ id: 'p1', title: 'x', author: 'Vic', reactions: 1 }],
    }))
    expect(one.find((c) => c.id === 'top-logger').subtitle).toBe('1 log this week')
    expect(one.find((c) => c.id === 'post-p1').subtitle).toBe('Vic · 1 reaction')
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
    const all = buildStories(recap({
      top_posts: [
        { id: 'p1', title: 'a', author: 'Vic', reactions: 3 },
        { id: 'p2', title: 'b', author: 'María', reactions: 2 },
      ],
    })).map((c) => c.id)
    expect(new Set(all).size).toBe(all.length)
  })
})

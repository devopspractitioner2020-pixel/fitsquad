import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

const {
  REACTIONS, isReaction, getReactions, setReaction,
  describeReactionError, getActivity, getUnseenCount, markActivitySeen, describeActivity,
} = await import('../reactions')

// Chainable stub. Terminal methods resolve; `in` returns the rows.
function table({ rows = [], error = null } = {}) {
  const t = {}
  t.select = vi.fn(() => t)
  t.in = vi.fn(async () => ({ data: rows, error }))
  t.upsert = vi.fn(async () => ({ data: null, error }))
  t.delete = vi.fn(() => t)
  t.eq = vi.fn(() => t)
  t.then = (resolve) => resolve({ data: null, error })
  return t
}

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('the reaction set', () => {
  // Mirrors the CHECK constraint in migration 0010. If these drift, every
  // write fails at the database with a constraint violation.
  it('is exactly the four emoji the database accepts', () => {
    expect(REACTIONS).toEqual(['🔥', '💪', '👏', '😅'])
  })

  it('recognises its own members and nothing else', () => {
    for (const r of REACTIONS) expect(isReaction(r)).toBe(true)
    expect(isReaction('🍕')).toBe(false)
    expect(isReaction('')).toBe(false)
    expect(isReaction(undefined)).toBe(false)
  })
})

describe('getReactions', () => {
  it('rolls counts up per post', async () => {
    from.mockReturnValue(table({ rows: [
      { post_id: 'p1', user_id: 'u2', emoji: '🔥' },
      { post_id: 'p1', user_id: 'u3', emoji: '🔥' },
      { post_id: 'p1', user_id: 'u3', emoji: '💪' },
      { post_id: 'p2', user_id: 'u2', emoji: '👏' },
    ] }))

    const map = await getReactions(['p1', 'p2'], 'u1')
    expect(map.get('p1').counts).toEqual({ '🔥': 2, '💪': 1 })
    expect(map.get('p2').counts).toEqual({ '👏': 1 })
  })

  it('marks which ones are mine, so the buttons render filled', async () => {
    from.mockReturnValue(table({ rows: [
      { post_id: 'p1', user_id: 'u1', emoji: '🔥' },
      { post_id: 'p1', user_id: 'u2', emoji: '💪' },
    ] }))

    const map = await getReactions(['p1'], 'u1')
    expect([...map.get('p1').mine]).toEqual(['🔥'])
  })

  // Fifty cards each fetching their own reactions is fifty round trips.
  it('asks once for the whole feed, de-duplicating the ids', async () => {
    const t = table({ rows: [] })
    from.mockReturnValue(t)
    await getReactions(['p1', 'p1', 'p2', null, undefined], 'u1')

    expect(from).toHaveBeenCalledTimes(1)
    expect(t.in).toHaveBeenCalledWith('post_id', ['p1', 'p2'])
  })

  it('does not hit the database at all for an empty feed', async () => {
    expect((await getReactions([], 'u1')).size).toBe(0)
    expect((await getReactions(undefined, 'u1')).size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })

  it('throws rather than silently returning nothing', async () => {
    from.mockReturnValue(table({ error: { message: 'boom' } }))
    await expect(getReactions(['p1'], 'u1')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('setReaction', () => {
  it('writes an upsert when turning one on', async () => {
    const t = table()
    from.mockReturnValue(t)
    await setReaction('u1', 'p1', '🔥', true)

    expect(from).toHaveBeenCalledWith('reactions')
    expect(t.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', post_id: 'p1', emoji: '🔥' },
      { onConflict: 'post_id,user_id,emoji' },
    )
  })

  // Presence is the state — the primary key is (post, user, emoji), so there
  // is no row to carry a false in.
  it('deletes the row when turning one off', async () => {
    const t = table()
    from.mockReturnValue(t)
    await setReaction('u1', 'p1', '🔥', false)

    expect(t.delete).toHaveBeenCalled()
    expect(t.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(t.eq).toHaveBeenCalledWith('post_id', 'p1')
    expect(t.eq).toHaveBeenCalledWith('emoji', '🔥')
    expect(t.upsert).not.toHaveBeenCalled()
  })

  it('refuses an emoji the database would reject anyway', async () => {
    await expect(setReaction('u1', 'p1', '🍕', true)).rejects.toThrow(/not one of the four/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses when signed out instead of writing a null user', async () => {
    await expect(setReaction(undefined, 'p1', '🔥', true)).rejects.toThrow(/sign in/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('surfaces a write failure', async () => {
    from.mockReturnValue(table({ error: { message: 'nope' } }))
    await expect(setReaction('u1', 'p1', '🔥', true)).rejects.toMatchObject({ message: 'nope' })
  })
})

describe('describeReactionError', () => {
  // A PostgREST 404 on a collection means the relation is missing from the
  // schema cache, not that the post is gone — the same trap saved_posts hit.
  it('names the missing migration rather than blaming the post', () => {
    expect(describeReactionError({ code: 'PGRST205' })).toMatch(/reactions table is missing/i)
    expect(describeReactionError({ message: 'Could not find it in the schema cache' }))
      .toMatch(/reactions table is missing/i)
  })

  it('explains a check-constraint violation in the app\'s own terms', () => {
    expect(describeReactionError({ code: '23514' })).toMatch(/not one of the four/i)
  })

  it('explains an RLS rejection as a squad boundary', () => {
    expect(describeReactionError({ code: '42501' })).toMatch(/own squad/i)
  })

  it('passes anything else through rather than inventing a cause', () => {
    expect(describeReactionError({ message: 'offline' })).toBe('offline')
    expect(describeReactionError({})).toMatch(/could not save/i)
  })
})

describe('activity', () => {
  it('asks for my activity with a bounded limit', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await getActivity(25)
    expect(rpc).toHaveBeenCalledWith('my_activity', { limit_n: 25 })
  })

  it('returns an array even when the RPC gives null', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await getActivity()).toEqual([])
  })

  it('counts what has arrived since the last look', async () => {
    rpc.mockResolvedValue({ data: 4, error: null })
    expect(await getUnseenCount()).toBe(4)
  })

  it('treats a null count as zero, not NaN', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await getUnseenCount()).toBe(0)
  })

  it('throws when the count cannot be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'denied' } })
    await expect(getUnseenCount()).rejects.toMatchObject({ message: 'denied' })
  })

  it('marks everything seen through the RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await markActivitySeen()
    expect(rpc).toHaveBeenCalledWith('mark_activity_seen')
  })

  // One sentence, one text node — a screen reader should not read
  // "María" … "reacted" … "Push day" as three separate things.
  it('describes an item as a single sentence', () => {
    expect(describeActivity({ actor_name: 'María', emoji: '🔥', post_title: 'Push day' }))
      .toBe('María reacted 🔥 to “Push day”')
  })
})

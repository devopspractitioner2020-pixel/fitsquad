import { describe, it, expect, vi, beforeEach } from 'vitest'

// A chainable query stub. `result` is what the terminal await resolves to.
function makeQuery() {
  const q = {}
  q.result = { data: [], error: null }
  for (const m of ['select', 'eq', 'order', 'delete', 'upsert', 'insert']) {
    q[m] = vi.fn(() => q)
  }
  // Awaiting the builder resolves it, which is how supabase-js behaves.
  q.then = (resolve) => resolve(q.result)
  return q
}

let query
const from = vi.fn(() => query)
vi.mock('../supabase', () => ({ supabase: { from: (...a) => from(...a) } }))

const {
  getSavedPostIds, setSaved, getSavedPosts, getSavedCounts, describeSaveError,
  SAVEABLE_KINDS, SLUG_TO_KIND, KIND_TO_SLUG,
} = await import('../saved')

beforeEach(() => {
  query = makeQuery()
  from.mockClear()
})

describe('getSavedPostIds', () => {
  it('returns a Set for O(1) lookup while rendering a feed', async () => {
    query.result = { data: [{ post_id: 'a' }, { post_id: 'b' }], error: null }
    const ids = await getSavedPostIds('u1')

    expect(ids).toBeInstanceOf(Set)
    expect(ids.has('a')).toBe(true)
    expect(ids.has('zzz')).toBe(false)
    expect(from).toHaveBeenCalledWith('saved_posts')
    expect(query.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('returns an empty Set without querying when signed out', async () => {
    expect((await getSavedPostIds(null)).size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })

  it('propagates a database error rather than pretending nothing is saved', async () => {
    query.result = { data: null, error: new Error('permission denied') }
    await expect(getSavedPostIds('u1')).rejects.toThrow('permission denied')
  })
})

describe('setSaved', () => {
  // Upsert, not insert: a double tap or a second device saving the same post
  // should be a no-op, not an error the reader has to see.
  it('upserts on save so saving twice is harmless', async () => {
    await setSaved('u1', 'p1', true)
    expect(from).toHaveBeenCalledWith('saved_posts')
    expect(query.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', post_id: 'p1' },
      { onConflict: 'user_id,post_id' },
    )
  })

  it('deletes the exact row on unsave', async () => {
    await setSaved('u1', 'p1', false)
    expect(query.delete).toHaveBeenCalled()
    expect(query.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(query.eq).toHaveBeenCalledWith('post_id', 'p1')
  })

  it('refuses when signed out', async () => {
    await expect(setSaved(null, 'p1', true)).rejects.toThrow(/not signed in/i)
  })

  it('surfaces a failed write so the icon can revert', async () => {
    query.result = { data: null, error: new Error('violates row-level security policy') }
    await expect(setSaved('u1', 'p1', true)).rejects.toThrow(/row-level security/)
  })
})

describe('getSavedPosts', () => {
  it('returns the joined posts, newest save first', async () => {
    query.result = {
      data: [
        { post_id: 'p2', created_at: '2026-07-02T00:00:00Z', posts: { id: 'p2', kind: 'tip', title: 'Second' } },
        { post_id: 'p1', created_at: '2026-07-01T00:00:00Z', posts: { id: 'p1', kind: 'tip', title: 'First' } },
      ],
      error: null,
    }
    const rows = await getSavedPosts('u1', 'tip')

    expect(rows.map((r) => r.title)).toEqual(['Second', 'First'])
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(query.eq).toHaveBeenCalledWith('posts.kind', 'tip')
  })

  // The saved list is a list of the post, not of the bookmark — but when it
  // was saved is still useful, so it rides along.
  it('flattens the post to the top level and keeps saved_at', async () => {
    query.result = {
      data: [{ post_id: 'p1', created_at: '2026-07-01T00:00:00Z', posts: { id: 'p1', title: 'Tip' } }],
      error: null,
    }
    const [row] = await getSavedPosts('u1', 'tip')
    expect(row).toMatchObject({ id: 'p1', title: 'Tip', saved_at: '2026-07-01T00:00:00Z' })
    expect(row.posts).toBeUndefined()
  })

  // `posts!inner` is load-bearing: an inner join drops saves whose post is
  // gone or no longer readable, so the list can never render a hole.
  it('uses an inner join so unreadable posts drop out', async () => {
    await getSavedPosts('u1', 'meal')
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('posts!inner'))
  })

  it('returns nothing without querying when signed out', async () => {
    expect(await getSavedPosts(null, 'tip')).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})

describe('getSavedCounts', () => {
  it('counts each kind separately', async () => {
    query.result = {
      data: [
        { post_id: 'a', posts: { kind: 'tip' } },
        { post_id: 'b', posts: { kind: 'tip' } },
        { post_id: 'c', posts: { kind: 'meal' } },
      ],
      error: null,
    }
    expect(await getSavedCounts('u1')).toEqual({ tip: 2, meal: 1 })
  })

  it('reports zero for a kind with nothing saved', async () => {
    query.result = { data: [{ post_id: 'a', posts: { kind: 'tip' } }], error: null }
    expect(await getSavedCounts('u1')).toEqual({ tip: 1, meal: 0 })
  })

  it('starts every saveable kind at zero', async () => {
    query.result = { data: [], error: null }
    const counts = await getSavedCounts('u1')
    for (const k of SAVEABLE_KINDS) expect(counts[k]).toBe(0)
  })

  // A workout could in principle be saved directly through the API; it must
  // not corrupt the two counts the UI shows.
  it('ignores kinds that have no box on the Me screen', async () => {
    query.result = {
      data: [{ post_id: 'a', posts: { kind: 'workout' } }, { post_id: 'b', posts: { kind: 'tip' } }],
      error: null,
    }
    expect(await getSavedCounts('u1')).toEqual({ tip: 1, meal: 0 })
  })

  it('returns zeroes without querying when signed out', async () => {
    expect(await getSavedCounts(null)).toEqual({ tip: 0, meal: 0 })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('kind and slug mapping', () => {
  // Routes read as /saved/tips; the database column says 'tip'. The two maps
  // must stay each other's inverse or a box opens an empty list.
  it('round-trips every saveable kind', () => {
    for (const kind of SAVEABLE_KINDS) {
      expect(SLUG_TO_KIND[KIND_TO_SLUG[kind]]).toBe(kind)
    }
  })

  it('maps the two slugs the UI actually links to', () => {
    expect(SLUG_TO_KIND.tips).toBe('tip')
    expect(SLUG_TO_KIND.meals).toBe('meal')
  })

  it('has no mapping for an unknown slug, so the screen can say so', () => {
    expect(SLUG_TO_KIND.workouts).toBeUndefined()
    expect(SLUG_TO_KIND.nonsense).toBeUndefined()
  })

  it('does not offer workouts as saveable', () => {
    expect(SAVEABLE_KINDS).not.toContain('workout')
  })
})


// Regression: saving failed with a PostgREST 404 because migration 0006 had
// not been run, and the UI said nothing at all — the icon just reverted,
// which is indistinguishable from the tap never registering. The console had
// the answer; the person tapping did not.
describe('describeSaveError', () => {
  it('names a missing table, which always means the migration is not run', () => {
    const err = {
      code: 'PGRST205',
      message: "Could not find the table 'public.saved_posts' in the schema cache",
    }
    expect(describeSaveError(err)).toMatch(/not set up|saved_posts table is missing/i)
  })

  it('recognises the missing table from the message alone', () => {
    expect(describeSaveError({ message: 'Could not find the table in the schema cache' }))
      .toMatch(/saved_posts table is missing/i)
  })

  it('does not blame the schema for a permission problem', () => {
    const err = { code: '42501', message: 'new row violates row-level security policy' }
    expect(describeSaveError(err)).toMatch(/permission/i)
    expect(describeSaveError(err)).not.toMatch(/table is missing/i)
  })

  it('calls a network failure what it is', () => {
    expect(describeSaveError(new TypeError('Failed to fetch'))).toMatch(/no connection/i)
  })

  it('falls back to something actionable for anything else', () => {
    expect(describeSaveError(new Error('boom'))).toMatch(/try again/i)
    expect(describeSaveError(null)).toMatch(/try again/i)
    expect(describeSaveError(undefined)).toMatch(/try again/i)
  })

  it('never returns an empty string, which would render as no feedback', () => {
    for (const e of [null, undefined, {}, new Error(''), 'weird']) {
      expect(describeSaveError(e).length).toBeGreaterThan(0)
    }
  })
})

describe('setSaved surfaces the original error', () => {
  // describeSaveError needs the Supabase error's `code`, so the raw object
  // has to reach it rather than being wrapped in a generic Error.
  it('throws the Supabase error object, code intact', async () => {
    query.result = {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.saved_posts' in the schema cache" },
    }
    const err = await setSaved('u1', 'p1', true).catch((e) => e)
    expect(err.code).toBe('PGRST205')
    expect(describeSaveError(err)).toMatch(/table is missing/i)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

const {
  MAX_COMMENT_CHARS, getCommentCounts, getComments,
  addComment, deleteComment, describeCommentError,
} = await import('../comments')

function table({ rows = [], error = null } = {}) {
  const t = {}
  t.select = vi.fn(() => t)
  t.in = vi.fn(async () => ({ data: rows, error }))
  t.insert = vi.fn(async () => ({ data: null, error }))
  t.delete = vi.fn(() => t)
  t.eq = vi.fn(async () => ({ data: null, error }))
  return t
}

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('getCommentCounts', () => {
  // The feed shows a number per card. Fetching every comment body to render
  // fifty small numbers would pull the whole conversation history.
  it('counts per post without fetching the bodies', async () => {
    const t = table({ rows: [
      { post_id: 'p1' }, { post_id: 'p1' }, { post_id: 'p2' },
    ] })
    from.mockReturnValue(t)

    const counts = await getCommentCounts(['p1', 'p2'])
    expect(counts.get('p1')).toBe(2)
    expect(counts.get('p2')).toBe(1)
    expect(t.select).toHaveBeenCalledWith('post_id')
  })

  it('leaves a post with no comments absent rather than at zero', async () => {
    from.mockReturnValue(table({ rows: [] }))
    expect((await getCommentCounts(['p1'])).has('p1')).toBe(false)
  })

  it('asks once, de-duplicating the ids', async () => {
    const t = table({ rows: [] })
    from.mockReturnValue(t)
    await getCommentCounts(['p1', 'p1', 'p2'])
    expect(t.in).toHaveBeenCalledWith('post_id', ['p1', 'p2'])
  })

  it('does not query for an empty feed', async () => {
    expect((await getCommentCounts([])).size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('getComments', () => {
  it('reads one thread through the RPC that attaches names', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'c1', body: 'nice' }], error: null })
    expect(await getComments('p1')).toHaveLength(1)
    expect(rpc).toHaveBeenCalledWith('post_comments', { pid: 'p1' })
  })

  it('returns an array when the RPC gives null', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await getComments('p1')).toEqual([])
  })

  it('throws rather than showing an empty thread that is not empty', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'denied' } })
    await expect(getComments('p1')).rejects.toMatchObject({ message: 'denied' })
  })
})

describe('addComment', () => {
  it('inserts the trimmed body', async () => {
    const t = table()
    from.mockReturnValue(t)
    await addComment('u1', 'p1', '  well done  ')
    expect(t.insert).toHaveBeenCalledWith({ user_id: 'u1', post_id: 'p1', body: 'well done' })
  })

  it('refuses an empty or whitespace-only comment before the round trip', async () => {
    await expect(addComment('u1', 'p1', '   ')).rejects.toThrow(/write something/i)
    await expect(addComment('u1', 'p1', '')).rejects.toThrow(/write something/i)
    expect(from).not.toHaveBeenCalled()
  })

  // The database has the same CHECK. This one is only to give a better
  // sentence than a constraint violation.
  it('refuses one that is too long', async () => {
    await expect(addComment('u1', 'p1', 'x'.repeat(MAX_COMMENT_CHARS + 1)))
      .rejects.toThrow(new RegExp(`${MAX_COMMENT_CHARS} characters`))
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts one exactly at the limit', async () => {
    const t = table()
    from.mockReturnValue(t)
    await addComment('u1', 'p1', 'x'.repeat(MAX_COMMENT_CHARS))
    expect(t.insert).toHaveBeenCalled()
  })

  it('refuses when signed out', async () => {
    await expect(addComment(undefined, 'p1', 'hi')).rejects.toThrow(/sign in/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('surfaces a write failure', async () => {
    from.mockReturnValue(table({ error: { message: 'nope' } }))
    await expect(addComment('u1', 'p1', 'hi')).rejects.toMatchObject({ message: 'nope' })
  })
})

describe('deleteComment', () => {
  it('deletes by id', async () => {
    const t = table()
    from.mockReturnValue(t)
    await deleteComment('c1')
    expect(t.delete).toHaveBeenCalled()
    expect(t.eq).toHaveBeenCalledWith('id', 'c1')
  })

  it('surfaces a refusal', async () => {
    from.mockReturnValue(table({ error: { message: 'not yours' } }))
    await expect(deleteComment('c1')).rejects.toMatchObject({ message: 'not yours' })
  })
})

describe('describeCommentError', () => {
  it('names the missing migration rather than blaming the post', () => {
    expect(describeCommentError({ code: 'PGRST205' })).toMatch(/comments table is missing/i)
  })

  it('explains the length constraint in the app\'s own terms', () => {
    expect(describeCommentError({ code: '23514' })).toMatch(/1 and 500 characters/i)
  })

  it('explains an RLS rejection as a squad boundary', () => {
    expect(describeCommentError({ code: '42501' })).toMatch(/own squad/i)
  })

  it('passes anything else through', () => {
    expect(describeCommentError({ message: 'offline' })).toBe('offline')
    expect(describeCommentError({})).toMatch(/could not post/i)
  })
})

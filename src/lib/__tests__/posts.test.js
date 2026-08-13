import { describe, it, expect, vi, beforeEach } from 'vitest'

const from = vi.fn()
vi.mock('../supabase', () => ({ supabase: { from: (...a) => from(...a) } }))

const { updatePost, deletePost, describePostError, MAX_TITLE_CHARS } = await import('../posts')

function table({ error = null } = {}) {
  const t = {}
  t.update = vi.fn(() => t)
  t.delete = vi.fn(() => t)
  t.eq = vi.fn(async () => ({ data: null, error }))
  return t
}

beforeEach(() => from.mockReset())

describe('updatePost', () => {
  it('saves the trimmed title and note against the right row', async () => {
    const t = table()
    from.mockReturnValue(t)
    await updatePost('p1', { title: '  Push day  ', note: '  felt strong ' })

    expect(from).toHaveBeenCalledWith('posts')
    expect(t.update).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Push day', note: 'felt strong',
    }))
    expect(t.eq).toHaveBeenCalledWith('id', 'p1')
  })

  // So the card can say "edited" rather than changing silently under
  // somebody who already replied to it.
  it('stamps edited_at', async () => {
    const t = table()
    from.mockReturnValue(t)
    await updatePost('p1', { title: 'x' })
    expect(t.update.mock.calls[0][0].edited_at).toEqual(expect.any(String))
  })

  it('stores an emptied note as null rather than an empty string', async () => {
    const t = table()
    from.mockReturnValue(t)
    await updatePost('p1', { title: 'x', note: '   ' })
    expect(t.update.mock.calls[0][0].note).toBeNull()
  })

  it('refuses a title that is only whitespace', async () => {
    await expect(updatePost('p1', { title: '   ' })).rejects.toThrow(/give the post a title/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses a title that is too long', async () => {
    await expect(updatePost('p1', { title: 'x'.repeat(MAX_TITLE_CHARS + 1) }))
      .rejects.toThrow(new RegExp(`${MAX_TITLE_CHARS} characters`))
  })

  it('only touches minutes when the caller offers them', async () => {
    const t = table()
    from.mockReturnValue(t)
    await updatePost('p1', { title: 'x' })
    expect(t.update.mock.calls[0][0]).not.toHaveProperty('minutes')

    from.mockReturnValue(table())
    await updatePost('p1', { title: 'x', minutes: '45' })
    expect(from.mock.results[1].value.update.mock.calls[0][0].minutes).toBe(45)
  })

  it('nulls out a minutes value that is not a positive number', async () => {
    const t = table()
    from.mockReturnValue(t)
    await updatePost('p1', { title: 'x', minutes: 'abc' })
    expect(t.update.mock.calls[0][0].minutes).toBeNull()
  })

  // Two contradicting pills on one card is not a state the feed should be
  // able to render.
  it('keeps cheat and healthy mutually exclusive', async () => {
    const t = table()
    from.mockReturnValue(t)
    await updatePost('p1', { title: 'x', is_cheat: true })
    expect(t.update.mock.calls[0][0]).toMatchObject({ is_cheat: true, is_healthy: false })

    const t2 = table()
    from.mockReturnValue(t2)
    await updatePost('p1', { title: 'x', is_cheat: false })
    expect(t2.update.mock.calls[0][0]).toMatchObject({ is_cheat: false, is_healthy: true })
  })

  // Changing what a post IS, after people have reacted to it, rewrites what
  // they were reacting to.
  it('never lets an edit change the kind or the owner', async () => {
    const t = table()
    from.mockReturnValue(t)
    await updatePost('p1', { title: 'x', kind: 'tip', user_id: 'someone-else' })
    const patch = t.update.mock.calls[0][0]
    expect(patch).not.toHaveProperty('kind')
    expect(patch).not.toHaveProperty('user_id')
  })

  it('surfaces a refusal', async () => {
    from.mockReturnValue(table({ error: { message: 'denied' } }))
    await expect(updatePost('p1', { title: 'x' })).rejects.toMatchObject({ message: 'denied' })
  })
})

describe('deletePost', () => {
  it('deletes by id', async () => {
    const t = table()
    from.mockReturnValue(t)
    await deletePost('p1')
    expect(t.delete).toHaveBeenCalled()
    expect(t.eq).toHaveBeenCalledWith('id', 'p1')
  })
})

describe('describePostError', () => {
  it('explains an RLS rejection as ownership', () => {
    expect(describePostError({ code: '42501' })).toMatch(/only edit your own/i)
  })

  it('names the missing migration when the column is absent', () => {
    expect(describePostError({ message: "column 'edited_at' does not exist" }))
      .toMatch(/migration 0012/i)
  })

  it('passes anything else through', () => {
    expect(describePostError({ message: 'offline' })).toBe('offline')
    expect(describePostError({})).toMatch(/could not save/i)
  })
})

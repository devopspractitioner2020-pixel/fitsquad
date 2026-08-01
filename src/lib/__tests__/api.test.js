import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Supabase client before importing the module under test.
const invoke = vi.fn()
const maybeSingle = vi.fn()
const query = {
  select: vi.fn(() => query),
  eq: vi.fn(() => query),
  order: vi.fn(() => query),
  limit: vi.fn(() => query),
  maybeSingle,
}
vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (...a) => invoke(...a) },
    from: vi.fn(() => query),
  },
}))

const { generatePlan, refinePlan, getLatestPlan } = await import('../api')
const { supabase } = await import('../supabase')

beforeEach(() => {
  invoke.mockReset()
  maybeSingle.mockReset()
  supabase.from.mockClear()
  Object.values(query).forEach((f) => f.mockClear?.())
})

/** Build the FunctionsHttpError shape supabase-js produces for non-2xx. */
function httpError(status, body) {
  const err = new Error('Edge Function returned a non-2xx status code')
  err.name = 'FunctionsHttpError'
  err.context = { status, json: async () => body }
  return err
}

describe('generatePlan', () => {
  it('invokes the edge function with the generate payload', async () => {
    invoke.mockResolvedValue({ data: { planId: 'p1', status: 'generating' }, error: null })
    const intake = { name: 'Vic', goal: 'Lose fat' }

    await expect(generatePlan(intake)).resolves.toEqual({ planId: 'p1', status: 'generating' })
    expect(invoke).toHaveBeenCalledWith('generate-plan', {
      body: { mode: 'generate', intake },
    })
  })

  // The function returns as soon as the row exists; Claude runs in the
  // background. This test pins that contract: no plan HTML comes back here.
  it('resolves with only an id and a generating status', async () => {
    invoke.mockResolvedValue({ data: { planId: 'p1', status: 'generating' }, error: null })
    const res = await generatePlan({ name: 'Vic' })
    expect(res.status).toBe('generating')
    expect(res).not.toHaveProperty('html')
  })

  // Regression: supabase-js hides the response body on non-2xx, so the user
  // used to see "Edge Function returned a non-2xx status code" instead of
  // "You can generate a fresh plan in 5 days".
  it('surfaces the server message for a rate-limited request', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(429, { error: 'You can generate a fresh plan in 5 days.', daysLeft: 5 }),
    })

    await expect(generatePlan({ name: 'Vic' }))
      .rejects.toThrow('You can generate a fresh plan in 5 days.')
  })

  it('attaches status and daysLeft so the UI can update its cooldown', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(429, { error: 'Too soon.', daysLeft: 3 }),
    })

    const err = await generatePlan({ name: 'Vic' }).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.daysLeft).toBe(3)
  })

  it('reports the in-flight plan id on a 409', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: 'A plan is already being generated.', planId: 'live' }),
    })
    const err = await generatePlan({ name: 'Vic' }).catch((e) => e)
    expect(err.planId).toBe('live')
  })

  it('falls back to the raw error when the body cannot be parsed', async () => {
    const raw = new Error('network down')
    raw.context = { status: 0, json: async () => { throw new Error('not json') } }
    invoke.mockResolvedValue({ data: null, error: raw })

    await expect(generatePlan({ name: 'Vic' })).rejects.toThrow('network down')
  })

  it('throws when the function replies 200 with an error body', async () => {
    invoke.mockResolvedValue({ data: { error: 'Unknown mode.' }, error: null })
    await expect(generatePlan({ name: 'Vic' })).rejects.toThrow('Unknown mode.')
  })
})

describe('refinePlan', () => {
  it('sends the plan id and the change request', async () => {
    invoke.mockResolvedValue({ data: { planId: 'p1', status: 'generating' }, error: null })

    await refinePlan('p1', 'more vegetarian options')
    expect(invoke).toHaveBeenCalledWith('generate-plan', {
      body: { mode: 'refine', planId: 'p1', request: 'more vegetarian options' },
    })
  })

  it('surfaces the cap message from the server', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'No refinements left.' }) })
    await expect(refinePlan('p1', 'again')).rejects.toThrow('No refinements left.')
  })
})

describe('getLatestPlan', () => {
  it('reads the newest plan for the user', async () => {
    const plan = { id: 'p1', status: 'ready' }
    maybeSingle.mockResolvedValue({ data: plan, error: null })

    await expect(getLatestPlan('u1')).resolves.toEqual(plan)
    expect(supabase.from).toHaveBeenCalledWith('plans')
    expect(query.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(query.limit).toHaveBeenCalledWith(1)
  })

  it('returns null when the user has no plans', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(getLatestPlan('u1')).resolves.toBeNull()
  })

  // Guard against the screens calling this during the first render, before
  // AuthContext has resolved a session.
  it('short-circuits without querying when there is no user id', async () => {
    await expect(getLatestPlan(undefined)).resolves.toBeNull()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('propagates a database error rather than pretending there is no plan', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error('permission denied') })
    await expect(getLatestPlan('u1')).rejects.toThrow('permission denied')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const AUTH = { user: { id: 'u1' }, profile: { display_name: 'Vic' }, signOut: vi.fn() }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => AUTH }))

// Chainable stub for the leaderboard queries.
function query(data) {
  const q = {}
  for (const m of ['select', 'gte', 'order', 'eq']) q[m] = vi.fn(() => q)
  q.then = (resolve) => resolve({ data, error: null })
  return q
}

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: vi.fn(() => query([])) },
}))

import Squad from '../Squad'

const SQUAD = { id: 's1', name: 'The Test Squad', join_code: 'ABC234', role: 'owner', member_count: 3 }

// my_squads is called on mount and again after create/join; everything else
// resolves empty unless a test says otherwise.
const withSquads = (...responses) => {
  rpc.mockImplementation((fn) => {
    if (fn === 'my_squads') {
      const next = responses.length > 1 ? responses.shift() : responses[0]
      return Promise.resolve({ data: next, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })
}

const renderSquad = async () => {
  render(<MemoryRouter><Squad /></MemoryRouter>)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('my_squads'))
}

const createBtn = () => screen.getByRole('button', { name: /create my squad/i })

beforeEach(() => {
  rpc.mockReset()
  AUTH.profile = { display_name: 'Vic' }
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
})

describe('when you are in a squad', () => {
  beforeEach(() => withSquads([SQUAD]))

  it('shows the join code, the member count and both copy buttons', async () => {
    await renderSquad()
    expect(await screen.findByText('ABC234')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeInTheDocument()
  })

  it('uses the squad name as the heading', async () => {
    await renderSquad()
    expect(await screen.findByRole('heading', { name: 'The Test Squad' })).toBeInTheDocument()
  })

  it('copies the raw code, not the link, from the code button', async () => {
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /copy code/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC234')
  })

  it('copies an invite link carrying the code', async () => {
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /copy invite link/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('?join=ABC234'))
  })

  // Nothing to create — you already have one.
  it('does not offer to create another', async () => {
    await renderSquad()
    await screen.findByText('ABC234')
    expect(screen.queryByRole('button', { name: /create my squad/i })).toBeNull()
  })
})

// The reported bug. One account showed a join code and another showed
// nothing at all — no code, no member count, no explanation, and the only
// action on the screen was "join another squad with a code", which needs a
// code you would have to go and ask someone else for.
describe('when you are in no squad', () => {
  beforeEach(() => withSquads([]))

  it('says so, instead of rendering an empty space', async () => {
    await renderSquad()
    expect(await screen.findByText(/not in a squad yet/i)).toBeInTheDocument()
  })

  it('offers to create one — the way out that did not exist', async () => {
    await renderSquad()
    expect(await createBtn()).toBeInTheDocument()
  })

  it('creates the squad through the RPC that was already in the database', async () => {
    await renderSquad()
    await userEvent.type(await screen.findByLabelText(/squad name/i), 'Los Fuertes')
    await userEvent.click(createBtn())

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: 'Los Fuertes' }))
  })

  it('falls back to a name built from your own, so the field can be left blank', async () => {
    await renderSquad()
    await userEvent.click(await createBtn())
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: "Vic's Squad" }))
  })

  it('does not send a name of pure whitespace', async () => {
    await renderSquad()
    await userEvent.type(await screen.findByLabelText(/squad name/i), '   ')
    await userEvent.click(createBtn())
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: "Vic's Squad" }))
  })

  it('copes with a profile that has no display name', async () => {
    AUTH.profile = null
    await renderSquad()
    await userEvent.click(await createBtn())
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: "My's Squad" }))
  })

  it('shows the new join code once the squad exists', async () => {
    withSquads([], [SQUAD])
    await renderSquad()
    await userEvent.click(await createBtn())

    expect(await screen.findByText('ABC234')).toBeInTheDocument()
    expect(screen.queryByText(/not in a squad yet/i)).toBeNull()
  })

  it('surfaces a failure rather than silently doing nothing', async () => {
    rpc.mockImplementation((fn) =>
      fn === 'my_squads'
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: null, error: { message: 'permission denied' } }))

    await renderSquad()
    await userEvent.click(await createBtn())
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
  })

  // Joining someone else's squad is still there — creating is an addition,
  // not a replacement.
  it('still offers to join an existing squad with a code', async () => {
    await renderSquad()
    expect(screen.getByRole('button', { name: /join another squad with a code/i })).toBeInTheDocument()
  })
})

describe('before the answer arrives', () => {
  it('does not flash the create panel at people who do have a squad', async () => {
    let resolve
    rpc.mockImplementation((fn) =>
      fn === 'my_squads'
        ? new Promise((r) => { resolve = r })
        : Promise.resolve({ data: null, error: null }))

    render(<MemoryRouter><Squad /></MemoryRouter>)
    // Nothing is known yet, so nothing is claimed.
    expect(screen.queryByText(/not in a squad yet/i)).toBeNull()

    resolve({ data: [SQUAD], error: null })
    expect(await screen.findByText('ABC234')).toBeInTheDocument()
    expect(screen.queryByText(/not in a squad yet/i)).toBeNull()
  })
})

describe('joining with a code', () => {
  beforeEach(() => withSquads([]))

  it('sends the code to join_squad', async () => {
    await renderSquad()
    await userEvent.click(screen.getByRole('button', { name: /join another squad with a code/i }))
    await userEvent.type(screen.getByLabelText(/squad join code/i), 'xyz789')
    await userEvent.click(screen.getByRole('button', { name: /^join squad$/i }))

    // Upper-cased as they type, because the codes are read off screenshots.
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('join_squad', { code: 'XYZ789' }))
  })

  it('will not submit a code too short to be one', async () => {
    await renderSquad()
    await userEvent.click(screen.getByRole('button', { name: /join another squad with a code/i }))
    await userEvent.type(screen.getByLabelText(/squad join code/i), 'AB')
    expect(screen.getByRole('button', { name: /^join squad$/i })).toBeDisabled()
  })
})

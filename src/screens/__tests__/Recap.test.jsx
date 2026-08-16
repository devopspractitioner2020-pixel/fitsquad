import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

const AUTH = { user: { id: 'u1' }, profile: { display_name: 'Vic' }, signOut: vi.fn() }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => AUTH }))

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const getRecap = vi.fn(async () => null)
vi.mock('../../lib/recap', async (importOriginal) => ({
  ...(await importOriginal()),
  getRecap: (...a) => getRecap(...a),
}))

import Recap from '../Recap'

const SQUAD = { id: 's1', name: 'The Test Squad', join_code: 'ABC234', role: 'owner', member_count: 3 }

const fullRecap = (over = {}) => ({
  week_start: '2026-07-27',
  squad_name: 'The Test Squad',
  totals: { workouts: 9, healthy_meals: 14, cheats: 2, weigh_ins: 11, reactions: 20, comments: 4, members: 3 },
  top_logger: { name: 'Vic', logs: 12 },
  biggest_drop: { name: 'María', delta: -1.4 },
  top_posts: [{ id: 'p1', title: 'Push day', author: 'Vic', reactions: 6 }],
  ...over,
})

const renderRecap = async () => {
  render(<MemoryRouter><Recap /></MemoryRouter>)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('my_squads'))
}

beforeEach(() => {
  navigate.mockClear()
  rpc.mockReset().mockResolvedValue({ data: [SQUAD], error: null })
  getRecap.mockReset().mockResolvedValue(null)
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

describe('a week that is ready', () => {
  beforeEach(() => getRecap.mockResolvedValue(fullRecap()))

  it('plays as stories rather than a page', async () => {
    await renderRecap()
    expect(await screen.findByRole('dialog', { name: /weekly recap/i })).toBeInTheDocument()
  })

  it('opens on the squad name', async () => {
    await renderRecap()
    expect(await screen.findByText('The Test Squad')).toBeInTheDocument()
  })

  it('asks for last week, not this one — this one is not over', async () => {
    await renderRecap()
    await waitFor(() => expect(getRecap).toHaveBeenCalledWith('s1', expect.any(String)))
    const [, key] = getRecap.mock.calls[0]
    expect(new Date(`${key}T00:00:00Z`).getTime()).toBeLessThan(Date.now())
  })
})

// The three states that need different sentences. Collapsing "not out yet"
// into "nothing here" is the difference between "come back Sunday" and
// "your squad did nothing", and only one of those is true.
describe('a week that is not out yet', () => {
  it('says so, and when it will be', async () => {
    getRecap.mockResolvedValue(null)
    await renderRecap()

    expect(await screen.findByText(/not out yet/i)).toBeInTheDocument()
    expect(screen.getByText(/sunday evening/i)).toBeInTheDocument()
  })

  it('does not open the story player on an empty recap', async () => {
    getRecap.mockResolvedValue(null)
    await renderRecap()
    await screen.findByText(/not out yet/i)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('a week where nothing happened', () => {
  it('says the week was quiet rather than that it is not ready', async () => {
    getRecap.mockResolvedValue(fullRecap({
      totals: { workouts: 0, healthy_meals: 0, cheats: 0, weigh_ins: 0, reactions: 0, comments: 0, members: 3 },
      top_logger: null, biggest_drop: null, top_posts: [],
    }))
    await renderRecap()

    expect(await screen.findByText(/a quiet week/i)).toBeInTheDocument()
    expect(screen.queryByText(/not out yet/i)).toBeNull()
  })
})

describe('edge cases', () => {
  it('explains that recaps need a squad', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await renderRecap()
    expect(await screen.findByText(/recaps are about a squad/i)).toBeInTheDocument()
  })

  it('surfaces a server refusal', async () => {
    getRecap.mockRejectedValue(new Error('Not a member of that squad.'))
    await renderRecap()
    expect(await screen.findByText(/not a member of that squad/i)).toBeInTheDocument()
  })

  it('returns to the feed when the story player closes', async () => {
    getRecap.mockResolvedValue(fullRecap())
    await renderRecap()

    const close = await screen.findByRole('button', { name: /close recap/i })
    close.click()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/feed'))
  })
})

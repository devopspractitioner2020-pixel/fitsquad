import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

const AUTH = { user: { id: 'u1' }, profile: { display_name: 'Vic' }, signOut: vi.fn() }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => AUTH }))

// Chainable stub for the weigh-in and post queries.
function query(data) {
  const q = {}
  for (const m of ['select', 'eq', 'order']) q[m] = vi.fn(() => q)
  q.then = (resolve) => resolve({ data, error: null })
  return q
}
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(() => query([])) } }))

const getLatestPlan = vi.fn(async () => null)
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getLatestPlan: (...a) => getLatestPlan(...a),
}))

const getSavedCounts = vi.fn(async () => ({ tip: 0, meal: 0 }))
vi.mock('../../lib/saved', async (importOriginal) => ({
  ...(await importOriginal()),
  getSavedCounts: (...a) => getSavedCounts(...a),
}))

import Me from '../Me'

const renderMe = async () => {
  render(<MemoryRouter><Me /></MemoryRouter>)
  await waitFor(() => expect(getSavedCounts).toHaveBeenCalled())
}

beforeEach(() => {
  navigate.mockClear()
  getLatestPlan.mockClear().mockResolvedValue(null)
  getSavedCounts.mockClear().mockResolvedValue({ tip: 0, meal: 0 })
})

describe('the saved collection', () => {
  it('shows a box for tips and a box for meals', async () => {
    await renderMe()
    expect(screen.getByRole('button', { name: /saved tips/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /saved meals/i })).toBeInTheDocument()
  })

  // The count is on the box so an empty collection is obvious before
  // tapping into it, not after.
  it('shows the count on each box', async () => {
    getSavedCounts.mockResolvedValue({ tip: 4, meal: 2 })
    await renderMe()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saved tips/i })).toHaveTextContent('4'))
    expect(screen.getByRole('button', { name: /saved meals/i })).toHaveTextContent('2')
  })

  it('opens the matching list', async () => {
    await renderMe()

    await userEvent.click(screen.getByRole('button', { name: /saved tips/i }))
    expect(navigate).toHaveBeenCalledWith('/saved/tips')

    await userEvent.click(screen.getByRole('button', { name: /saved meals/i }))
    expect(navigate).toHaveBeenCalledWith('/saved/meals')
  })

  it('still renders the boxes when the counts fail to load', async () => {
    getSavedCounts.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><Me /></MemoryRouter>)

    // Counts are decoration; being unable to read them must not cost the
    // reader the route into their collection.
    expect(await screen.findByRole('button', { name: /saved tips/i })).toBeInTheDocument()
  })
})

describe('badges', () => {
  it('are gone', async () => {
    await renderMe()
    expect(screen.queryByText(/^Badges$/)).toBeNull()
    for (const label of ['First log', '10 workouts', 'Clean week', 'Lost 5']) {
      expect(screen.queryByText(label), label).toBeNull()
    }
  })
})

describe('what stayed', () => {
  it('keeps the plan card, the stats and the weight section', async () => {
    await renderMe()
    expect(screen.getByText(/your fitplan/i)).toBeInTheDocument()
    expect(screen.getByText(/weight over time/i)).toBeInTheDocument()
    expect(screen.getByText(/^Meals$/)).toBeInTheDocument()
    expect(screen.getByText(/^Workouts$/)).toBeInTheDocument()
  })
})

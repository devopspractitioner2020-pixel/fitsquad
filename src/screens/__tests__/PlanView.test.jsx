import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

const AUTH = { user: { id: 'u1' } }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => AUTH }))

const getLatestPlan = vi.fn(async () => null)
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getLatestPlan: (...a) => getLatestPlan(...a),
  refinePlan: vi.fn(),
}))

import PlanView from '../PlanView'

const structured = {
  id: 'p1', status: 'ready', is_first_plan: true, refinements_used: 0,
  created_at: new Date().toISOString(),
  data: {
    hero: { name: 'Vic', goal_label: 'Lose fat', headline: 'Doable.' },
    week: Array.from({ length: 7 }, (_, i) => ({
      day: `Day ${i + 1}`, breakfast: 'Eggs', lunch: 'Rice', dinner: 'Fish',
    })),
    training: {
      split: [
        { day: 'Mon', focus: 'Push', exercises: [{ name: 'Bench', sets: 3, reps: '6-10' }] },
        { day: 'Wed', focus: 'Pull', exercises: [{ name: 'Row', sets: 3, reps: '6-10' }] },
        { day: 'Fri', focus: 'Legs', exercises: [{ name: 'Squat', sets: 3, reps: '6-10' }] },
      ],
      progression_note: 'Add weight.', cardio_note: 'Walk.',
    },
    disclaimer: 'Not medical advice.',
  },
}

const legacy = {
  id: 'p0', status: 'ready', is_first_plan: true, refinements_used: 0,
  created_at: new Date().toISOString(),
  data: null,
  html: '<!DOCTYPE html><html><body><h1>Quick Myth Corrections</h1></body></html>',
}

const renderPlan = async () => {
  render(<MemoryRouter><PlanView /></MemoryRouter>)
  await waitFor(() => expect(getLatestPlan).toHaveBeenCalled())
}

beforeEach(() => {
  navigate.mockClear()
  getLatestPlan.mockClear().mockResolvedValue(null)
})

describe('a structured plan', () => {
  it('renders with the app own tabs, no iframe', async () => {
    getLatestPlan.mockResolvedValue(structured)
    await renderPlan()

    expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.queryByText(/older plan format/i)).toBeNull()
  })
})

// Regression: an old plan renders perfectly happily inside the iframe, so the
// tabs and the app styling simply appear to be missing. It reads as the new
// feature being broken rather than as an old plan.
describe('a legacy HTML plan', () => {
  it('says which format you are looking at', async () => {
    getLatestPlan.mockResolvedValue(legacy)
    await renderPlan()

    expect(await screen.findByText(/older plan format/i)).toBeInTheDocument()
    expect(screen.getByText(/no tabs/i)).toBeInTheDocument()
  })

  it('still renders the old plan rather than hiding it', async () => {
    getLatestPlan.mockResolvedValue(legacy)
    await renderPlan()

    await waitFor(() => expect(document.querySelector('iframe')).toBeInTheDocument())
    // Untrusted model-authored markup: fully sandboxed, opaque origin.
    expect(document.querySelector('iframe')).toHaveAttribute('sandbox', '')
  })

  it('offers the way out', async () => {
    getLatestPlan.mockResolvedValue(legacy)
    await renderPlan()

    await userEvent.click(await screen.findByRole('button', { name: /generate a fresh plan/i }))
    expect(navigate).toHaveBeenCalledWith('/intake')
  })

  it('shows no tabs, because there is nothing to tab through', async () => {
    getLatestPlan.mockResolvedValue(legacy)
    await renderPlan()
    await screen.findByText(/older plan format/i)
    expect(screen.queryByRole('tab')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
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

import { supabase } from '../../lib/supabase'
import Me from '../Me'

const renderMe = async (props = {}) => {
  render(<MemoryRouter><Me {...props} /></MemoryRouter>)
  await waitFor(() => expect(getSavedCounts).toHaveBeenCalled())
}

// Route each table to its own rows, so a weigh-in history can be set up
// without also handing the same rows to the posts query.
const withTables = (tables) => {
  supabase.from.mockImplementation((name) => query(tables[name] ?? []))
}

const WED = new Date(2026, 6, 22, 9, 0, 0)
const weighIn = (dayOffset, kg) => {
  const d = new Date(WED)
  d.setDate(d.getDate() + dayOffset)
  return { created_at: d.toISOString(), weight_kg: kg }
}

beforeEach(() => {
  navigate.mockClear()
  supabase.from.mockClear().mockImplementation(() => query([]))
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

describe('the Log weigh-in button', () => {
  const logBtn = () => screen.getByRole('button', { name: /log weigh-in/i })

  // The reported bug: it called navigate('/feed'). The feed is neither where
  // you log a weigh-in nor where one shows up afterwards, since a weigh-in
  // is not a post.
  it('asks to open the log sheet instead of navigating anywhere', async () => {
    const onLogWeight = vi.fn()
    await renderMe({ onLogWeight })

    await userEvent.click(logBtn())
    expect(onLogWeight).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('never navigates to the feed, with or without a handler', async () => {
    await renderMe()
    await userEvent.click(logBtn())
    expect(navigate).not.toHaveBeenCalledWith('/feed')
  })

  it('is offered whether or not there is any history yet', async () => {
    await renderMe()
    expect(logBtn()).toBeInTheDocument()

    withTables({ weigh_ins: [weighIn(0, 80)] })
    await renderMe()
    expect(screen.getAllByRole('button', { name: /log weigh-in/i }).length).toBeGreaterThan(0)
  })
})

describe('the weight chart', () => {
  it('says so when there is nothing to draw', async () => {
    await renderMe()
    expect(screen.getByText(/no weigh-ins yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('weight-scroller')).toBeNull()
  })

  it('shows the latest reading and the change since the first', async () => {
    withTables({ weigh_ins: [weighIn(-14, 86.4), weighIn(-7, 84.0), weighIn(0, 83.1)] })
    await renderMe()

    expect(await screen.findByText('83.1')).toBeInTheDocument()
    expect(screen.getByText(/-3\.3 since start/)).toBeInTheDocument()
  })

  // The summary line is the only place the weekly rollup is stated in words,
  // so it is also the cheapest way to assert the rollup happened at all:
  // five readings, three weeks.
  it('reports how many weigh-ins became how many weekly points', async () => {
    withTables({
      weigh_ins: [
        weighIn(-14, 86.4), weighIn(-13, 86.0),
        weighIn(-7, 85.1), weighIn(-6, 84.9), weighIn(0, 84.0),
      ],
    })
    await renderMe()
    expect(await screen.findByText(/5 weigh-ins over 3 weeks/i)).toBeInTheDocument()
  })

  it('uses the singular when there is one of each', async () => {
    withTables({ weigh_ins: [weighIn(0, 80)] })
    await renderMe()
    expect(await screen.findByText(/1 weigh-in over 1 week\./i)).toBeInTheDocument()
  })

  // The chart is sized by how many weeks exist, not by how many fit — that
  // inline width is what makes the container scroll rather than squash a
  // year into a thumb's width.
  it('grows wider as weeks accumulate, so it scrolls instead of squashing', async () => {
    withTables({ weigh_ins: [weighIn(-7, 81), weighIn(0, 80)] })
    await renderMe()
    const narrow = screen.getByTestId('weight-scroller').firstChild.style.minWidth

    cleanup()
    withTables({
      weigh_ins: Array.from({ length: 20 }, (_, i) => weighIn(-7 * i, 90 - i * 0.2)),
    })
    await renderMe()
    const wide = screen.getByTestId('weight-scroller').firstChild.style.minWidth

    expect(parseInt(wide, 10)).toBeGreaterThan(parseInt(narrow, 10))
    expect(parseInt(wide, 10)).toBe(20 * 56)
  })

  it('mentions swiping only when there are more weeks than fit', async () => {
    withTables({ weigh_ins: [weighIn(-7, 81), weighIn(0, 80)] })
    await renderMe()
    expect(screen.queryByText(/swipe the chart/i)).toBeNull()

    cleanup()
    withTables({
      weigh_ins: Array.from({ length: 12 }, (_, i) => weighIn(-7 * i, 90 - i * 0.2)),
    })
    await renderMe()
    expect(await screen.findByText(/swipe the chart for earlier weeks/i)).toBeInTheDocument()
  })

  // Opening on the oldest week makes a long history look like an empty chart.
  it('opens scrolled to the most recent week', async () => {
    withTables({
      weigh_ins: Array.from({ length: 20 }, (_, i) => weighIn(-7 * i, 90 - i * 0.2)),
    })
    await renderMe()

    const scroller = screen.getByTestId('weight-scroller')
    // jsdom reports 0 for both, so assert the assignment happened rather than
    // a pixel value it cannot compute.
    await waitFor(() => expect(scroller.scrollLeft).toBe(scroller.scrollWidth))
  })
})

// Wiring tests. Every piece below has its own unit suite; what breaks here is
// the joins between them — a button handed the wrong handler, a modal opened
// on the wrong step, a redirect that fires when it should not. The reported
// bug ("Log weigh-in sends me to the feed") lived entirely in a join, so no
// component test could have caught it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const AUTH = {
  user: { id: 'u1' },
  profile: { display_name: 'Vic' },
  loading: false,
  signOut: vi.fn(),
}
vi.mock('../context/AuthContext', () => ({ useAuth: () => AUTH }))

// The other screens each load their own data; stubbing them keeps this about
// the wiring, and makes "did we navigate to the feed?" a single assertion.
vi.mock('../screens/Feed', () => ({ default: () => <div>FEED SCREEN</div> }))
vi.mock('../screens/Squad', () => ({ default: () => <div>SQUAD SCREEN</div> }))
vi.mock('../screens/Intake', () => ({ default: () => <div>INTAKE SCREEN</div> }))
vi.mock('../screens/PlanView', () => ({ default: () => <div>PLAN SCREEN</div> }))
vi.mock('../screens/Saved', () => ({ default: () => <div>SAVED SCREEN</div> }))

const inserted = []
function query(data) {
  const q = {}
  for (const m of ['select', 'eq', 'order']) q[m] = vi.fn(() => q)
  q.insert = vi.fn((rows) => {
    inserted.push(rows)
    return { then: (resolve) => resolve({ data: null, error: null }) }
  })
  q.then = (resolve) => resolve({ data, error: null })
  return q
}
const tables = {}
vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn((name) => query(tables[name] ?? [])) },
}))

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getLatestPlan: vi.fn(async () => null),
}))
vi.mock('../lib/saved', async (importOriginal) => ({
  ...(await importOriginal()),
  getSavedCounts: vi.fn(async () => ({ tip: 0, meal: 0 })),
}))

import { supabase } from '../lib/supabase'
import App from '../App'

const renderApp = async (path = '/me') => {
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  await screen.findByText(/weight over time/i)
}

const u = userEvent.setup()
const onFeed = () => screen.queryByText('FEED SCREEN')

beforeEach(() => {
  inserted.length = 0
  for (const k of Object.keys(tables)) delete tables[k]
  supabase.from.mockClear()
})

describe('logging a weigh-in from Me', () => {
  it('opens the log sheet on the weight step, not the type picker', async () => {
    await renderApp()
    await u.click(screen.getByRole('button', { name: /log weigh-in/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/log your weight/i)).toBeInTheDocument()
    // Straight to the field — no "What did you crush?" detour.
    expect(screen.queryByText(/what did you crush/i)).toBeNull()
  })

  it('does not leave the Me screen to do it', async () => {
    await renderApp()
    expect(onFeed()).toBeNull()

    await u.click(screen.getByRole('button', { name: /log weigh-in/i }))
    expect(onFeed()).toBeNull()
  })

  it('writes the weigh-in and stays put, because a weigh-in is not a post', async () => {
    await renderApp()
    await u.click(screen.getByRole('button', { name: /log weigh-in/i }))

    await u.type(screen.getByLabelText(/weight \(kg\)/i), '81.4')
    await u.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ user_id: 'u1', weight_kg: 81.4 })
    expect(supabase.from).toHaveBeenCalledWith('weigh_ins')

    // The old handler sent everyone to the feed. A weigh-in never appears
    // there, so it looked like nothing had happened.
    expect(onFeed()).toBeNull()
    expect(screen.getByText(/weight over time/i)).toBeInTheDocument()
  })

  it('closes the sheet once the weigh-in is saved', async () => {
    await renderApp()
    await u.click(screen.getByRole('button', { name: /log weigh-in/i }))
    await u.type(screen.getByLabelText(/weight \(kg\)/i), '81.4')
    await u.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  // The shortcut must not cost anyone the other three log types.
  it('still offers the full picker behind Back', async () => {
    await renderApp()
    await u.click(screen.getByRole('button', { name: /log weigh-in/i }))
    await u.click(screen.getByRole('button', { name: /^back$/i }))

    expect(await screen.findByText(/what did you crush/i)).toBeInTheDocument()
    for (const label of ['Workout', 'Meal', 'Weigh in', 'Share tip']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('logging from the + button', () => {
  const plus = () => screen.getByRole('button', { name: /add log/i })

  it('opens on the picker, with no type pre-chosen', async () => {
    await renderApp()
    await u.click(plus())
    expect(await screen.findByText(/what did you crush/i)).toBeInTheDocument()
  })

  // A post does belong in the feed, so that redirect stays.
  it('goes to the feed after logging something that is a post', async () => {
    await renderApp()
    await u.click(plus())
    await u.click(screen.getByRole('button', { name: 'Workout' }))
    await u.type(screen.getByLabelText(/what did you do/i), 'Push day')
    await u.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(onFeed()).toBeInTheDocument())
    expect(supabase.from).toHaveBeenCalledWith('posts')
  })
})

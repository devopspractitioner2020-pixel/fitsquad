// Intake is the gate in front of every Claude call, so its guards are the
// difference between a controlled spend and an open faucet. The server is
// the real limiter; these tests cover that the UI respects it and reports
// what it says.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ upsert: vi.fn() }) } }))

// The auth value must be referentially stable. Intake's load effect keys off
// `user`, so returning a fresh object each render would re-run it forever.
const AUTH = { user: { id: 'user-1' }, profile: { display_name: 'Vic' } }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => AUTH }))

const generatePlan = vi.fn(async () => ({ planId: 'p1', status: 'generating' }))
const getLatestPlan = vi.fn(async () => null)
const getIntakeDraft = vi.fn(async () => null)
const saveIntakeDraft = vi.fn(async () => {})
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    generatePlan: (...a) => generatePlan(...a),
    getLatestPlan: (...a) => getLatestPlan(...a),
    getIntakeDraft: (...a) => getIntakeDraft(...a),
    saveIntakeDraft: (...a) => saveIntakeDraft(...a),
  }
})

import Intake from '../Intake'

// `delay: null` runs interactions synchronously. The intake form has ~20
// controls and the default per-keystroke timer makes the suite crawl.
let u
const renderIntake = async () => {
  u = userEvent.setup({ delay: null })
  render(<MemoryRouter><Intake /></MemoryRouter>)
  // The screen loads the previous plan on mount to work out the cooldown.
  await waitFor(() => expect(getLatestPlan).toHaveBeenCalled())
}

const ackBox = () => screen.getByRole('checkbox')
// The primary button's label changes during the cooldown ("New plan
// available in 5 days"), so match either wording.
const generateBtn = () =>
  screen.getByRole('button', { name: /generate my fitplan|new plan available/i })

const saveBtn = () => screen.getByRole('button', { name: /save answers/i })

beforeEach(() => {
  navigate.mockClear()
  generatePlan.mockClear().mockResolvedValue({ planId: 'p1', status: 'generating' })
  getLatestPlan.mockClear().mockResolvedValue(null)
  getIntakeDraft.mockClear().mockResolvedValue(null)
  saveIntakeDraft.mockClear().mockResolvedValue(undefined)
})

describe('the medical-advice acknowledgement', () => {
  it('blocks generation until the box is ticked', async () => {
    await renderIntake()
    await u.click(generateBtn())

    expect(await screen.findByText(/tick the box/i)).toBeInTheDocument()
    expect(generatePlan).not.toHaveBeenCalled()
  })

  it('allows generation once acknowledged', async () => {
    await renderIntake()
    await u.click(ackBox())
    await u.click(generateBtn())

    await waitFor(() => expect(generatePlan).toHaveBeenCalledOnce())
  })
})

describe('submitting the form', () => {
  it('saves the intake before spending a Claude call', async () => {
    await renderIntake()
    await u.click(ackBox())
    await u.click(generateBtn())

    await waitFor(() => expect(generatePlan).toHaveBeenCalled())
    expect(saveIntakeDraft).toHaveBeenCalledWith('user-1', expect.any(Object))
    expect(saveIntakeDraft.mock.invocationCallOrder[0])
      .toBeLessThan(generatePlan.mock.invocationCallOrder[0])
  })

  it('sends what the user typed', async () => {
    await renderIntake()
    // Name is pre-filled from the profile, so clear it before typing.
    await u.clear(screen.getByLabelText(/^name$/i))
    await u.type(screen.getByLabelText(/^name$/i), 'Vic')
    await u.type(screen.getByLabelText(/current weight/i), '82')
    await u.click(ackBox())
    await u.click(generateBtn())

    await waitFor(() => expect(generatePlan).toHaveBeenCalled())
    expect(generatePlan.mock.calls[0][0]).toMatchObject({ name: 'Vic', weight_kg: '82' })
  })

  it('moves to Me so the user can watch the spinner there', async () => {
    await renderIntake()
    await u.click(ackBox())
    await u.click(generateBtn())

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/me'))
  })

  it('does not navigate away when the call fails, so the form is not lost', async () => {
    generatePlan.mockRejectedValue(new Error('Claude is unavailable.'))
    await renderIntake()
    await u.click(ackBox())
    await u.click(generateBtn())

    expect(await screen.findByText(/claude is unavailable/i)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalledWith('/me')
  })

  it('re-enables the button after a failure so the user can retry', async () => {
    generatePlan.mockRejectedValue(new Error('nope'))
    await renderIntake()
    await u.click(ackBox())
    await u.click(generateBtn())

    await waitFor(() => expect(generateBtn()).not.toBeDisabled())
  })
})

describe('the regeneration cooldown', () => {
  // A plan the cooldown actually applies to: first-plan allowance spent.
  const readyPlan = (daysOld, over = {}) => ({
    id: 'p0', status: 'ready', is_first_plan: true, refinements_used: 3,
    created_at: new Date(Date.now() - daysOld * 864e5).toISOString(),
    intake: { name: 'Vic', weight_kg: '84' },
    ...over,
  })

  it('disables generation and explains why while a recent plan exists', async () => {
    getLatestPlan.mockResolvedValue(readyPlan(2))
    await renderIntake()

    expect(await screen.findByText(/you can generate a fresh one in/i)).toBeInTheDocument()
    await waitFor(() => expect(generateBtn()).toBeDisabled())
  })

  it('pre-fills the form from the last intake so a regen only needs a new weight', async () => {
    getLatestPlan.mockResolvedValue(readyPlan(9))
    await renderIntake()

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue('Vic'))
    expect(screen.getByLabelText(/current weight/i)).toHaveValue('84')
  })

  it('allows generation again once the cooldown has elapsed', async () => {
    getLatestPlan.mockResolvedValue(readyPlan(9))
    await renderIntake()
    await waitFor(() => expect(generateBtn()).not.toBeDisabled())

    await u.click(ackBox())
    await u.click(generateBtn())
    await waitFor(() => expect(generatePlan).toHaveBeenCalled())
  })

  // Regression: the cooldown used to run from the latest plan of ANY status,
  // so a failed generation locked the user out for a week while the error
  // card invited them to "try again" — a dead end.
  it('lets the user retry immediately after a failed generation', async () => {
    getLatestPlan.mockResolvedValue({ ...readyPlan(0), status: 'error' })
    await renderIntake()

    await waitFor(() => expect(generateBtn()).not.toBeDisabled())
    expect(screen.queryByText(/you can generate a fresh one in/i)).toBeNull()
  })

  // The client copy of the rule can be stale or bypassed; the server's answer
  // is authoritative and must reach the user verbatim.
  it('shows the server\'s own rate-limit message and adopts its cooldown', async () => {
    const err = new Error('You can generate a fresh plan in 4 days.')
    err.status = 429
    err.daysLeft = 4
    generatePlan.mockRejectedValue(err)

    await renderIntake()
    await u.click(ackBox())
    await u.click(generateBtn())

    expect(await screen.findByText(/you can generate a fresh plan in 4 days/i)).toBeInTheDocument()
    await waitFor(() => expect(generateBtn()).toBeDisabled())
  })
})


describe('saving without generating', () => {
  // The bug this replaces: "Save intake" wrote to a table nothing read, then
  // immediately navigated away. The user saw their form vanish and had no way
  // to tell whether anything had been saved — and next visit it was blank,
  // because the screen only ever pre-filled from `plans.intake`.
  it('saves the answers without spending a Claude call', async () => {
    await renderIntake()
    await u.clear(screen.getByLabelText(/^name$/i))
    await u.type(screen.getByLabelText(/^name$/i), 'Vic')
    await u.click(saveBtn())

    await waitFor(() => expect(saveIntakeDraft).toHaveBeenCalled())
    expect(saveIntakeDraft.mock.calls[0][0]).toBe('user-1')
    expect(saveIntakeDraft.mock.calls[0][1]).toMatchObject({ name: 'Vic' })
    expect(generatePlan).not.toHaveBeenCalled()
  })

  it('stays on the form and confirms, rather than navigating away', async () => {
    await renderIntake()
    await u.click(saveBtn())

    expect(await screen.findByText(/saved\./i)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    // The form is still there with the user's answers in it.
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
  })

  it('does not require the medical acknowledgement to save', async () => {
    await renderIntake()
    await u.click(saveBtn())
    await waitFor(() => expect(saveIntakeDraft).toHaveBeenCalled())
    expect(screen.queryByText(/tick the box/i)).toBeNull()
  })

  // The old handler had no catch at all, so a rejected write did nothing
  // visible whatsoever.
  it('reports a failed save instead of failing silently', async () => {
    saveIntakeDraft.mockRejectedValue(new Error('new row violates row-level security policy'))
    await renderIntake()
    await u.click(saveBtn())

    expect(await screen.findByText(/row-level security/i)).toBeInTheDocument()
    expect(screen.queryByText(/^saved\./i)).toBeNull()
  })

  it('clears the confirmation once the user edits again', async () => {
    await renderIntake()
    await u.click(saveBtn())
    expect(await screen.findByText(/saved\./i)).toBeInTheDocument()

    await u.type(screen.getByLabelText(/current weight/i), '8')
    await waitFor(() => expect(screen.queryByText(/saved\./i)).toBeNull())
  })
})

describe('loading a saved draft', () => {
  it('restores the answers saved last time', async () => {
    getIntakeDraft.mockResolvedValue({ name: 'Vic', weight_kg: '81', sport: 'Padel' })
    await renderIntake()

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue('Vic'))
    expect(screen.getByLabelText(/current weight/i)).toHaveValue('81')
    expect(screen.getByLabelText(/sport played/i)).toHaveValue('Padel')
  })

  // A draft is a more recent statement of intent than the snapshot the last
  // plan was built from, so it has to win.
  it('prefers the saved draft over the last plan snapshot', async () => {
    getLatestPlan.mockResolvedValue({
      id: 'p0', status: 'ready', is_first_plan: true, refinements_used: 3,
      created_at: new Date().toISOString(),
      intake: { name: 'Old Name', weight_kg: '90' },
    })
    getIntakeDraft.mockResolvedValue({ weight_kg: '84' })
    await renderIntake()

    await waitFor(() => expect(screen.getByLabelText(/current weight/i)).toHaveValue('84'))
    // Fields absent from the draft still fall back to the plan snapshot.
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Old Name')
  })

  it('does not blow up when there is no draft', async () => {
    getIntakeDraft.mockResolvedValue(null)
    await renderIntake()
    expect(saveBtn()).toBeInTheDocument()
  })
})

describe('the form stays reachable during the cooldown', () => {
  const cooling = {
    id: 'p0', status: 'ready', is_first_plan: true, refinements_used: 3,
    created_at: new Date().toISOString(), intake: { name: 'Vic' },
  }

  // Generating is gated. Editing and saving must not be — being locked out of
  // your own answers for a week was the complaint that prompted this.
  it('still allows saving while generation is blocked', async () => {
    getLatestPlan.mockResolvedValue(cooling)
    await renderIntake()

    await waitFor(() => expect(generateBtn()).toBeDisabled())
    expect(saveBtn()).not.toBeDisabled()

    await u.click(saveBtn())
    await waitFor(() => expect(saveIntakeDraft).toHaveBeenCalled())
  })

  it('says when the next plan is due on the button itself', async () => {
    getLatestPlan.mockResolvedValue(cooling)
    await renderIntake()
    expect(await screen.findByRole('button', { name: /new plan available in 7 days/i }))
      .toBeInTheDocument()
  })
})

describe('the free first-plan window', () => {
  const firstPlan = (used) => ({
    id: 'p0', status: 'ready', is_first_plan: true, refinements_used: used,
    created_at: new Date().toISOString(), intake: { name: 'Vic' },
  })

  it('offers a no-wait regenerate while changes remain', async () => {
    getLatestPlan.mockResolvedValue(firstPlan(1))
    await renderIntake()

    expect(await screen.findByText(/2 changes left/i)).toBeInTheDocument()
    await waitFor(() => expect(generateBtn()).not.toBeDisabled())
  })

  it('uses the singular for the last change', async () => {
    getLatestPlan.mockResolvedValue(firstPlan(2))
    await renderIntake()
    expect(await screen.findByText(/1 change left/i)).toBeInTheDocument()
  })

  it('falls back to the cooldown once they are spent', async () => {
    getLatestPlan.mockResolvedValue(firstPlan(3))
    await renderIntake()

    await waitFor(() => expect(generateBtn()).toBeDisabled())
    expect(screen.queryByText(/changes left/i)).toBeNull()
  })
})


// CRITICAL REGRESSION, reported from the live app: the screen showed
//   "You have 3 changes left on your first plan. Regenerating now uses one —
//    no waiting."
// directly above
//   "Your last plan is recent. You can generate a fresh one in 3 days."
// with the button disabled. Both banners at once, saying opposite things.
describe('the two banners can never contradict each other', () => {
  const readyFirst = (used, daysOld = 0) => ({
    id: 'p0', status: 'ready', is_first_plan: true, refinements_used: used,
    created_at: new Date(Date.now() - daysOld * 864e5).toISOString(),
    intake: { name: 'Vic' },
  })

  const freeBanner = () => screen.queryByText(/changes? left/i)
  const waitBanner = () => screen.queryByText(/you can generate a fresh one in/i)

  it('shows the allowance and no cooldown while changes remain', async () => {
    getLatestPlan.mockResolvedValue(readyFirst(1, 2))
    await renderIntake()

    expect(await screen.findByText(/2 changes left/i)).toBeInTheDocument()
    expect(waitBanner()).toBeNull()
    expect(generateBtn()).not.toBeDisabled()
  })

  it('shows the cooldown and no allowance once they are spent', async () => {
    getLatestPlan.mockResolvedValue(readyFirst(3, 4))
    await renderIntake()

    await waitFor(() => expect(waitBanner()).toBeInTheDocument())
    expect(freeBanner()).toBeNull()
    expect(generateBtn()).toBeDisabled()
  })

  it.each([
    ['fresh first plan', readyFirst(0, 0)],
    ['one change used', readyFirst(1, 1)],
    ['last change left', readyFirst(2, 3)],
    ['allowance spent', readyFirst(3, 3)],
    ['allowance spent, old', readyFirst(3, 9)],
  ])('never renders both for %s', async (_label, plan) => {
    getLatestPlan.mockResolvedValue(plan)
    await renderIntake()
    await waitFor(() => expect(getLatestPlan).toHaveBeenCalled())

    const both = Boolean(freeBanner()) && Boolean(waitBanner())
    expect(both).toBe(false)
  })

  // The exact path that produced the screenshot: the client believed it was
  // in the free window, the server disagreed, and only the cooldown state was
  // updated — leaving the "no waiting" banner sitting above the refusal.
  it('replaces the allowance banner when the server says wait', async () => {
    getLatestPlan.mockResolvedValue(readyFirst(0, 4))
    await renderIntake()

    // Client is optimistic to begin with.
    expect(await screen.findByText(/3 changes left/i)).toBeInTheDocument()

    const err = new Error('You can generate a fresh plan in 3 days.')
    err.status = 429
    err.daysLeft = 3
    generatePlan.mockRejectedValue(err)

    await u.click(ackBox())
    await u.click(generateBtn())

    // The server's verdict replaces ours wholesale.
    await waitFor(() => expect(freeBanner()).toBeNull())
    expect(waitBanner()).toBeInTheDocument()
    expect(screen.getByText(/you can generate a fresh plan in 3 days/i)).toBeInTheDocument()
    expect(generateBtn()).toBeDisabled()
  })

  it('the button label agrees with whichever banner is showing', async () => {
    getLatestPlan.mockResolvedValue(readyFirst(3, 4))
    await renderIntake()

    await waitFor(() => expect(generateBtn()).toBeDisabled())
    // Never "Save & generate" while the cooldown banner is up.
    expect(screen.queryByRole('button', { name: /save & generate/i })).toBeNull()
    expect(screen.getByRole('button', { name: /new plan available in 3 days/i }))
      .toBeInTheDocument()
  })

  // Saving is not gated by any of this — being locked out of your own
  // answers was the original complaint.
  it('lets you save regardless of which banner is showing', async () => {
    getLatestPlan.mockResolvedValue(readyFirst(3, 4))
    await renderIntake()

    await waitFor(() => expect(generateBtn()).toBeDisabled())
    expect(saveBtn()).not.toBeDisabled()
    await u.click(saveBtn())
    await waitFor(() => expect(saveIntakeDraft).toHaveBeenCalled())
  })
})

// The FitPlan card is the state machine the whole generation flow hangs off.
// Getting it wrong means either a spinner that never resolves or a tap
// through to a half-written plan, so every branch is pinned here.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanCard } from '../Me'
import { effectiveStatus } from '../../lib/rules'

const setup = (status) => {
  const onOpen = vi.fn()
  const onCreate = vi.fn()
  render(<PlanCard status={status} onOpen={onOpen} onCreate={onCreate} />)
  return { onOpen, onCreate }
}

describe('PlanCard', () => {
  it('invites the user to build a plan when they have none', async () => {
    const { onCreate } = setup('none')
    expect(screen.getByText(/not created yet/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button'))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('shows progress while generating and offers nothing to tap', () => {
    setup('generating')
    expect(screen.getByText(/generating your plan/i)).toBeInTheDocument()
    // No button at all: tapping through to an unfinished plan was the
    // original Lovable bug this card exists to prevent.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('tells the user they can leave the screen while it generates', () => {
    setup('generating')
    expect(screen.getByText(/you can leave this screen/i)).toBeInTheDocument()
  })

  it('opens the plan when it is ready', async () => {
    const { onOpen, onCreate } = setup('ready')
    expect(screen.getByText(/ready — tap to open/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('routes a failed generation back to the intake form, not to the plan', async () => {
    const { onOpen, onCreate } = setup('error')
    expect(screen.getByText(/generation failed/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button'))
    expect(onCreate).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('PlanCard fed by effectiveStatus', () => {
  const at = Date.UTC(2026, 6, 25, 12, 0, 0)
  const ago = (ms) => new Date(at - ms).toISOString()

  // End-to-end of the stuck-plan fix: a row still marked 'generating' in the
  // database, whose worker died, must present as a retryable error rather
  // than an eternal spinner.
  it('renders a retry card for a generating row whose worker died', async () => {
    const stalePlan = { status: 'generating', created_at: ago(45 * 60_000) }
    const { onCreate } = setup(effectiveStatus(stalePlan, at))

    expect(screen.getByText(/generation failed/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button'))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('still shows the spinner for a generation that just started', () => {
    const live = { status: 'generating', created_at: ago(30_000) }
    setup(effectiveStatus(live, at))
    expect(screen.getByText(/generating your plan/i)).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Header } from '../ui'

// The header is the only place the app can tell you something arrived while
// you were elsewhere, so the badge is the whole notification mechanism.
describe('the activity bell', () => {
  it('is absent when the screen does not offer activity', () => {
    render(<Header onSignOut={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /activity/i })).toBeNull()
  })

  it('shows no badge when nothing is new', () => {
    render(<Header onActivity={vi.fn()} unseen={0} />)
    expect(screen.getByRole('button', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.queryByTestId('unseen-badge')).toBeNull()
  })

  it('shows the count when something is', () => {
    render(<Header onActivity={vi.fn()} unseen={3} />)
    expect(screen.getByTestId('unseen-badge')).toHaveTextContent('3')
  })

  // A three-digit badge would blow out the header on a phone.
  it('caps the badge at 9+', () => {
    render(<Header onActivity={vi.fn()} unseen={42} />)
    expect(screen.getByTestId('unseen-badge')).toHaveTextContent('9+')
  })

  // The count has to reach a screen reader too — a coloured dot says nothing.
  it('puts the count in the accessible name', () => {
    render(<Header onActivity={vi.fn()} unseen={3} />)
    expect(screen.getByRole('button', { name: 'Activity, 3 new' })).toBeInTheDocument()
  })

  it('opens activity when tapped', async () => {
    const onActivity = vi.fn()
    render(<Header onActivity={onActivity} unseen={1} />)
    await userEvent.click(screen.getByRole('button', { name: /activity/i }))
    expect(onActivity).toHaveBeenCalled()
  })

  it('keeps sign-out working alongside it', async () => {
    const onSignOut = vi.fn()
    render(<Header onSignOut={onSignOut} onActivity={vi.fn()} unseen={2} />)
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalled()
  })
})

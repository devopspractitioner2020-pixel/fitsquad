import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const setSaved = vi.fn(async () => {})
vi.mock('../../lib/saved', async (importOriginal) => ({
  ...(await importOriginal()),
  setSaved: (...a) => setSaved(...a),
}))

// The embed has its own suite; here it would just add noise and an
// IntersectionObserver dependency.
vi.mock('../VideoEmbed', () => ({
  default: ({ url }) => <div data-testid="embed">{url}</div>,
}))

const PostCard = (await import('../PostCard')).default

const post = (over = {}) => ({
  id: 'p1',
  kind: 'tip',
  title: 'Prep chicken on Sunday',
  author_name: 'María',
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  ...over,
})

const saveBtn = () => screen.getByRole('button', { name: /save|unsave/i })

beforeEach(() => { setSaved.mockClear().mockResolvedValue(undefined) })

describe('which posts can be saved', () => {
  it.each(['tip', 'meal'])('offers a bookmark on a %s', (kind) => {
    render(<PostCard post={post({ kind })} userId="u1" />)
    expect(saveBtn()).toBeInTheDocument()
  })

  // A workout is a log of something that happened, not reference material
  // to come back to — and there is no box for it on Me.
  it('offers no bookmark on a workout', () => {
    render(<PostCard post={post({ kind: 'workout' })} userId="u1" />)
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })
})

describe('saving', () => {
  it('writes the save and tells the parent', async () => {
    const onSavedChange = vi.fn()
    render(<PostCard post={post()} userId="u1" saved={false} onSavedChange={onSavedChange} />)

    await userEvent.click(saveBtn())
    await waitFor(() => expect(setSaved).toHaveBeenCalledWith('u1', 'p1', true))
    expect(onSavedChange).toHaveBeenCalledWith('p1', true)
  })

  it('unsaves an already-saved post', async () => {
    const onSavedChange = vi.fn()
    render(<PostCard post={post()} userId="u1" saved onSavedChange={onSavedChange} />)

    await userEvent.click(saveBtn())
    await waitFor(() => expect(setSaved).toHaveBeenCalledWith('u1', 'p1', false))
    expect(onSavedChange).toHaveBeenCalledWith('p1', false)
  })

  // Optimistic: waiting on a round trip before filling the icon makes the
  // whole feed feel sluggish, and being briefly wrong costs nothing.
  it('fills the icon immediately, before the write resolves', async () => {
    let release
    setSaved.mockImplementation(() => new Promise((r) => { release = r }))
    render(<PostCard post={post()} userId="u1" saved={false} />)

    await userEvent.click(saveBtn())
    expect(saveBtn()).toHaveAttribute('aria-pressed', 'true')

    release()
    await waitFor(() => expect(setSaved).toHaveBeenCalled())
  })

  it('puts the icon back when the write fails', async () => {
    setSaved.mockRejectedValue(new Error('offline'))
    const onSavedChange = vi.fn()
    render(<PostCard post={post()} userId="u1" saved={false} onSavedChange={onSavedChange} />)

    await userEvent.click(saveBtn())
    await waitFor(() => expect(saveBtn()).toHaveAttribute('aria-pressed', 'false'))
    // The parent is never told about a save that did not happen.
    expect(onSavedChange).not.toHaveBeenCalled()
  })

  // Regression: reverting the icon was the ONLY signal, and it looks exactly
  // like the tap not having registered. The person got nothing; only the
  // console knew the table was missing.
  it('says something when the write fails', async () => {
    setSaved.mockRejectedValue(new Error('offline'))
    render(<PostCard post={post()} userId="u1" saved={false} />)

    await userEvent.click(saveBtn())
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('names the missing table rather than blaming the reader', async () => {
    setSaved.mockRejectedValue({
      code: 'PGRST205',
      message: "Could not find the table 'public.saved_posts' in the schema cache",
    })
    render(<PostCard post={post()} userId="u1" saved={false} />)

    await userEvent.click(saveBtn())
    expect(await screen.findByText(/saved_posts table is missing/i)).toBeInTheDocument()
  })

  it('clears the message when the next attempt succeeds', async () => {
    setSaved.mockRejectedValueOnce(new Error('offline'))
    render(<PostCard post={post()} userId="u1" saved={false} />)

    await userEvent.click(saveBtn())
    await screen.findByRole('status')

    setSaved.mockResolvedValue(undefined)
    await userEvent.click(saveBtn())
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('shows nothing at all when saving works', async () => {
    render(<PostCard post={post()} userId="u1" saved={false} />)
    await userEvent.click(saveBtn())
    await waitFor(() => expect(setSaved).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does nothing when signed out', async () => {
    render(<PostCard post={post()} userId={undefined} />)
    await userEvent.click(saveBtn())
    expect(setSaved).not.toHaveBeenCalled()
  })

  it('names the post in the button label, for screen readers', () => {
    render(<PostCard post={post()} userId="u1" saved={false} />)
    expect(screen.getByRole('button', { name: 'Save Prep chicken on Sunday' })).toBeInTheDocument()
  })

  it('changes the label once saved', () => {
    render(<PostCard post={post()} userId="u1" saved />)
    expect(screen.getByRole('button', { name: 'Unsave Prep chicken on Sunday' })).toBeInTheDocument()
  })
})

describe('the rest of the card', () => {
  it('shows the author, title and relative time', () => {
    render(<PostCard post={post()} userId="u1" />)
    expect(screen.getByText('Prep chicken on Sunday')).toBeInTheDocument()
    expect(screen.getByText(/María/)).toBeInTheDocument()
    expect(screen.getByText(/about 1 hours ago/)).toBeInTheDocument()
  })

  it('renders a video embed only when there is a video', () => {
    const { rerender } = render(<PostCard post={post()} userId="u1" />)
    expect(screen.queryByTestId('embed')).toBeNull()

    rerender(<PostCard post={post({ video_url: 'https://x.test/v' })} userId="u1" />)
    expect(screen.getByTestId('embed')).toHaveTextContent('https://x.test/v')
  })

  it('shows the healthy and cheat pills from the meal flags', () => {
    render(<PostCard post={post({ kind: 'meal', is_healthy: true })} userId="u1" />)
    expect(screen.getByText('healthy')).toBeInTheDocument()

    render(<PostCard post={post({ id: 'p2', kind: 'meal', is_cheat: true })} userId="u1" />)
    expect(screen.getByText(/cheat/)).toBeInTheDocument()
  })
})

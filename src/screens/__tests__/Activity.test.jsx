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

const getActivity = vi.fn(async () => [])
const markActivitySeen = vi.fn(async () => {})
vi.mock('../../lib/reactions', async (importOriginal) => ({
  ...(await importOriginal()),
  getActivity: (...a) => getActivity(...a),
  markActivitySeen: (...a) => markActivitySeen(...a),
}))

import Activity from '../Activity'

const item = (over = {}) => ({
  post_id: 'p1',
  post_title: 'Push day',
  post_kind: 'workout',
  emoji: '🔥',
  actor_name: 'María',
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  ...over,
})

const renderActivity = async () => {
  render(<MemoryRouter><Activity /></MemoryRouter>)
  await waitFor(() => expect(getActivity).toHaveBeenCalled())
}

beforeEach(() => {
  navigate.mockClear()
  getActivity.mockClear().mockResolvedValue([])
  markActivitySeen.mockClear().mockResolvedValue(undefined)
})

// "How does someone know that someone reacted on their post? There is no
// functionality of notifications." This screen is the answer.
describe('the activity list', () => {
  it('names who reacted, with what, on which post', async () => {
    getActivity.mockResolvedValue([item()])
    await renderActivity()
    expect(await screen.findByText('María reacted 🔥 to “Push day”')).toBeInTheDocument()
  })

  it('says when', async () => {
    getActivity.mockResolvedValue([item()])
    await renderActivity()
    expect(await screen.findByText(/about 1 hours ago/)).toBeInTheDocument()
  })

  it('lists several, newest first as the database returned them', async () => {
    getActivity.mockResolvedValue([
      item({ actor_name: 'María', emoji: '🔥' }),
      item({ actor_name: 'Diego', emoji: '💪', post_title: 'Leg day' }),
    ])
    await renderActivity()

    await screen.findByText(/María/)
    const lines = screen.getAllByText(/reacted/).map((n) => n.textContent)
    expect(lines[0]).toMatch(/María/)
    expect(lines[1]).toMatch(/Diego/)
  })

  it('explains the empty case instead of showing a blank page', async () => {
    await renderActivity()
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument()
  })

  it('shows a loading state rather than an empty one while fetching', async () => {
    let resolve
    getActivity.mockImplementation(() => new Promise((r) => { resolve = r }))
    render(<MemoryRouter><Activity /></MemoryRouter>)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing yet/i)).toBeNull()
    resolve([])
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument()
  })
})

describe('marking things seen', () => {
  // Opening the screen IS the acknowledgement — no "mark all read" to forget.
  it('marks activity seen once the list is on screen', async () => {
    getActivity.mockResolvedValue([item()])
    await renderActivity()
    await waitFor(() => expect(markActivitySeen).toHaveBeenCalledTimes(1))
  })

  // Order matters: clearing the badge for someone whose connection dropped
  // before they saw anything loses the notification entirely.
  it('does not mark anything seen when the list fails to load', async () => {
    getActivity.mockRejectedValue(new Error('offline'))
    await renderActivity()

    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
    expect(markActivitySeen).not.toHaveBeenCalled()
  })

  it('tells every mounted header to clear its badge', async () => {
    const heard = vi.fn()
    window.addEventListener('fitsquad:activity-seen', heard)
    getActivity.mockResolvedValue([item()])
    await renderActivity()

    await waitFor(() => expect(heard).toHaveBeenCalled())
    window.removeEventListener('fitsquad:activity-seen', heard)
  })

  it('still renders the list when marking seen fails', async () => {
    getActivity.mockResolvedValue([item()])
    markActivitySeen.mockRejectedValue(new Error('denied'))
    await renderActivity()

    // The reader has already read it; a failed bookkeeping write must not
    // replace what they came to see.
    expect(await screen.findByText(/María reacted/)).toBeInTheDocument()
  })
})

describe('getting back', () => {
  it('offers a way back to the feed', async () => {
    await renderActivity()
    expect(screen.getByRole('button', { name: /back to feed/i })).toBeInTheDocument()
  })
})

// Migration 0011 widened activity to cover replies. A notification list that
// reports reactions but not comments is worse than none: the silence looks
// authoritative.
describe('comments in the activity list', () => {
  const commentItem = (over = {}) => item({
    kind: 'comment', emoji: null, body: 'Strong work', ...over,
  })

  it('reads as a reply, not as a reaction', async () => {
    getActivity.mockResolvedValue([commentItem()])
    await renderActivity()
    expect(await screen.findByText('María commented on “Push day”')).toBeInTheDocument()
  })

  it('quotes what they said', async () => {
    getActivity.mockResolvedValue([commentItem()])
    await renderActivity()
    expect(await screen.findByText(/Strong work/)).toBeInTheDocument()
  })

  it('mixes both kinds in one list', async () => {
    getActivity.mockResolvedValue([
      commentItem({ actor_name: 'Diego' }),
      item({ kind: 'reaction', actor_name: 'María', emoji: '🔥' }),
    ])
    await renderActivity()

    expect(await screen.findByText(/Diego commented/)).toBeInTheDocument()
    expect(screen.getByText(/María reacted 🔥/)).toBeInTheDocument()
  })

  // Rows stored before 0011 come back with no `kind`. They are reactions.
  it('treats an item with no kind as a reaction', async () => {
    getActivity.mockResolvedValue([item({ kind: undefined })])
    await renderActivity()
    expect(await screen.findByText(/reacted 🔥/)).toBeInTheDocument()
  })
})

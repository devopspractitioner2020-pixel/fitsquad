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

function query(data) {
  const q = {}
  for (const m of ['select', 'order', 'limit', 'gte', 'eq', 'in']) q[m] = vi.fn(() => q)
  q.then = (resolve) => resolve({ data, error: null })
  return q
}
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(() => query([])), rpc: vi.fn(async () => ({ data: 0, error: null })) },
}))

vi.mock('../../lib/saved', async (importOriginal) => ({
  ...(await importOriginal()),
  getSavedPostIds: vi.fn(async () => new Set()),
}))

const getReactions = vi.fn(async () => new Map())
const setReaction = vi.fn(async () => {})
vi.mock('../../lib/reactions', async (importOriginal) => ({
  ...(await importOriginal()),
  getReactions: (...a) => getReactions(...a),
  setReaction: (...a) => setReaction(...a),
}))

// The embed has its own suite and would drag IntersectionObserver in here.
vi.mock('../../components/VideoEmbed', () => ({ default: () => <div /> }))

import { supabase } from '../../lib/supabase'
import Feed from '../Feed'

const post = (over = {}) => ({
  id: 'p1', kind: 'workout', title: 'Push day', author_name: 'María',
  created_at: new Date(Date.now() - 3600_000).toISOString(), ...over,
})

const withPosts = (posts) => {
  supabase.from.mockImplementation(() => query(posts))
}

const renderFeed = async () => {
  render(<MemoryRouter><Feed /></MemoryRouter>)
  await waitFor(() => expect(supabase.from).toHaveBeenCalled())
}

beforeEach(() => {
  navigate.mockClear()
  supabase.from.mockReset().mockImplementation(() => query([]))
  supabase.rpc.mockReset().mockResolvedValue({ data: 0, error: null })
  getReactions.mockClear().mockResolvedValue(new Map())
  setReaction.mockClear().mockResolvedValue(undefined)
})

describe('the heading', () => {
  // "In the Feed section I don't think there is a need to have the 'squad
  // feed' title, it is redundant and occupies a lot of space." It was a 42px
  // heading naming the screen you had just navigated to, above a greeting
  // that said the same thing in less room.
  it('does not name the screen you are already on', async () => {
    await renderFeed()
    expect(screen.queryByText(/squad feed/i)).toBeNull()
  })

  it('greets you instead, as the only heading', async () => {
    await renderFeed()
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Hey Vic')
  })

  it('copes with a missing display name', async () => {
    AUTH.profile = null
    await renderFeed()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hey there')
    AUTH.profile = { display_name: 'Vic' }
  })
})

describe('reactions in the feed', () => {
  it('fetches them once for every post on screen', async () => {
    withPosts([post({ id: 'p1' }), post({ id: 'p2' })])
    await renderFeed()

    await waitFor(() => expect(getReactions).toHaveBeenCalledWith(['p1', 'p2'], 'u1'))
    expect(getReactions).toHaveBeenCalledTimes(1)
  })

  it('renders the counts it got back', async () => {
    withPosts([post()])
    getReactions.mockResolvedValue(new Map([['p1', { counts: { '🔥': 4 }, mine: new Set() }]]))
    await renderFeed()

    expect(await screen.findByRole('button', { name: /🔥 reaction, 4 so far/ })).toBeInTheDocument()
  })

  // The count has to survive the parent re-rendering, or it snaps back the
  // moment anything else on the screen changes.
  it('keeps a new reaction after the card hands it up', async () => {
    withPosts([post()])
    getReactions.mockResolvedValue(new Map([['p1', { counts: { '🔥': 1 }, mine: new Set() }]]))
    await renderFeed()

    const fire = await screen.findByRole('button', { name: /🔥 reaction/ })
    await userEvent.click(fire)

    await waitFor(() => expect(setReaction).toHaveBeenCalledWith('u1', 'p1', '🔥', true))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /🔥 reaction/ })).toHaveTextContent('2'))
  })

  // Reactions are decoration on top of the feed. Losing them must not cost
  // the reader the posts.
  it('still shows the posts when reactions cannot be read', async () => {
    withPosts([post()])
    getReactions.mockRejectedValue(new Error('table missing'))
    await renderFeed()

    expect(await screen.findByText('Push day')).toBeInTheDocument()
  })
})

describe('the activity bell', () => {
  it('shows the unseen count from the database', async () => {
    supabase.rpc.mockResolvedValue({ data: 3, error: null })
    await renderFeed()
    expect(await screen.findByTestId('unseen-badge')).toHaveTextContent('3')
  })

  it('opens the activity screen', async () => {
    supabase.rpc.mockResolvedValue({ data: 1, error: null })
    await renderFeed()
    await userEvent.click(await screen.findByRole('button', { name: /activity/i }))
    expect(navigate).toHaveBeenCalledWith('/activity')
  })

  // Migration 0010 not run yet, say. A badge is not worth an error message.
  it('shows no badge rather than an error when the count cannot be read', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'missing function' } })
    await renderFeed()

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled())
    expect(screen.queryByTestId('unseen-badge')).toBeNull()
    expect(screen.queryByText(/missing function/i)).toBeNull()
  })

  it('clears when the activity screen says it has been seen', async () => {
    supabase.rpc.mockResolvedValue({ data: 5, error: null })
    await renderFeed()
    expect(await screen.findByTestId('unseen-badge')).toBeInTheDocument()

    window.dispatchEvent(new Event('fitsquad:activity-seen'))
    await waitFor(() => expect(screen.queryByTestId('unseen-badge')).toBeNull())
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

// Referentially stable: the load effect keys off `user`, and a fresh object
// each render would re-run it forever.
const AUTH = { user: { id: 'u1' }, profile: { display_name: 'Vic' } }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => AUTH }))

const getSavedPosts = vi.fn(async () => [])
const setSaved = vi.fn(async () => {})
vi.mock('../../lib/saved', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getSavedPosts: (...a) => getSavedPosts(...a),
    setSaved: (...a) => setSaved(...a),
  }
})

vi.mock('../../components/VideoEmbed', () => ({ default: () => null }))

import Saved from '../Saved'

const post = (id, title, kind = 'tip') => ({
  id, title, kind, author_name: 'María', created_at: new Date().toISOString(),
})

const renderAt = (slug) =>
  render(
    <MemoryRouter initialEntries={[`/saved/${slug}`]}>
      <Routes><Route path="/saved/:kind" element={<Saved />} /></Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  navigate.mockClear()
  getSavedPosts.mockClear().mockResolvedValue([])
  setSaved.mockClear().mockResolvedValue(undefined)
})

describe('which list is shown', () => {
  it('asks for tips on /saved/tips', async () => {
    renderAt('tips')
    await waitFor(() => expect(getSavedPosts).toHaveBeenCalledWith('u1', 'tip'))
    expect(screen.getByRole('heading', { name: /saved tips/i })).toBeInTheDocument()
  })

  it('asks for meals on /saved/meals', async () => {
    renderAt('meals')
    await waitFor(() => expect(getSavedPosts).toHaveBeenCalledWith('u1', 'meal'))
    expect(screen.getByRole('heading', { name: /saved meals/i })).toBeInTheDocument()
  })

  // A hand-typed or stale URL should say so rather than sitting on a
  // spinner that never resolves.
  it('says so for a slug that has no list', async () => {
    renderAt('workouts')
    expect(await screen.findByText(/does not exist/i)).toBeInTheDocument()
    expect(getSavedPosts).not.toHaveBeenCalled()
  })
})

describe('with saved posts', () => {
  beforeEach(() => {
    getSavedPosts.mockResolvedValue([post('p1', 'Prep chicken'), post('p2', 'Weigh daily')])
  })

  it('lists them', async () => {
    renderAt('tips')
    expect(await screen.findByText('Prep chicken')).toBeInTheDocument()
    expect(screen.getByText('Weigh daily')).toBeInTheDocument()
  })

  it('counts them, with the noun agreeing', async () => {
    renderAt('tips')
    expect(await screen.findByText(/2 saved tips/i)).toBeInTheDocument()
  })

  it('uses the singular for one', async () => {
    getSavedPosts.mockResolvedValue([post('p1', 'Prep chicken')])
    renderAt('tips')
    expect(await screen.findByText(/1 saved tip$/i)).toBeInTheDocument()
  })

  // Leaving a card sitting in a list called "Saved" right after the reader
  // unsaved it reads as the tap not having worked.
  it('removes a card the moment it is unsaved', async () => {
    renderAt('tips')
    await screen.findByText('Prep chicken')

    await userEvent.click(screen.getByRole('button', { name: /unsave prep chicken/i }))
    await waitFor(() => expect(screen.queryByText('Prep chicken')).toBeNull())
    expect(screen.getByText('Weigh daily')).toBeInTheDocument()
  })

  it('clears the whole list on Clear all', async () => {
    renderAt('tips')
    await screen.findByText('Prep chicken')

    await userEvent.click(screen.getByRole('button', { name: /clear all/i }))
    await waitFor(() => expect(setSaved).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/nothing saved yet/i)).toBeInTheDocument()
  })

  it('puts the list back if clearing fails', async () => {
    setSaved.mockRejectedValue(new Error('offline'))
    renderAt('tips')
    await screen.findByText('Prep chicken')

    await userEvent.click(screen.getByRole('button', { name: /clear all/i }))
    await waitFor(() => expect(screen.getByText('Prep chicken')).toBeInTheDocument())
    expect(screen.getByText(/offline/i)).toBeInTheDocument()
  })
})

describe('with nothing saved', () => {
  it('explains how to save something, and offers a way there', async () => {
    renderAt('meals')
    expect(await screen.findByText(/nothing saved yet/i)).toBeInTheDocument()
    expect(screen.getByText(/tap the bookmark on any meals/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /go to the feed/i }))
    expect(navigate).toHaveBeenCalledWith('/feed')
  })

  it('offers no Clear all when there is nothing to clear', async () => {
    renderAt('tips')
    await screen.findByText(/nothing saved yet/i)
    expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull()
  })
})

describe('failures', () => {
  it('reports a load failure instead of an endless spinner', async () => {
    getSavedPosts.mockRejectedValue(new Error('permission denied'))
    renderAt('tips')
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Loading…$/)).toBeNull()
  })
})

describe('getting back', () => {
  it('offers a route back to Me', async () => {
    renderAt('tips')
    await userEvent.click(screen.getByRole('button', { name: /back to me/i }))
    expect(navigate).toHaveBeenCalledWith('/me')
  })
})

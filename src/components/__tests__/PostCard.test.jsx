import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const setSaved = vi.fn(async () => {})
vi.mock('../../lib/saved', async (importOriginal) => ({
  ...(await importOriginal()),
  setSaved: (...a) => setSaved(...a),
}))

const setReaction = vi.fn(async () => {})
vi.mock('../../lib/reactions', async (importOriginal) => ({
  ...(await importOriginal()),
  setReaction: (...a) => setReaction(...a),
}))

const updatePost = vi.fn(async () => ({ title: 'x' }))
vi.mock('../../lib/posts', async (importOriginal) => ({
  ...(await importOriginal()),
  updatePost: (...a) => updatePost(...a),
}))

const getComments = vi.fn(async () => [])
const addComment = vi.fn(async () => {})
const deleteComment = vi.fn(async () => {})
vi.mock('../../lib/comments', async (importOriginal) => ({
  ...(await importOriginal()),
  getComments: (...a) => getComments(...a),
  addComment: (...a) => addComment(...a),
  deleteComment: (...a) => deleteComment(...a),
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

beforeEach(() => {
  setSaved.mockClear().mockResolvedValue(undefined)
  setReaction.mockClear().mockResolvedValue(undefined)
  getComments.mockClear().mockResolvedValue([])
  addComment.mockClear().mockResolvedValue(undefined)
  deleteComment.mockClear().mockResolvedValue(undefined)
  updatePost.mockClear().mockResolvedValue({ title: 'Edited', edited_at: 'now' })
})

const fire = () => screen.getByRole('button', { name: /🔥 reaction/ })

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

// ---------------------------------------------------------------------
// "I just clicked on someone's post 'fire' reaction and nothing happened."
//
// Nothing happened because nothing was there: four <button> elements with
// no onClick and no table behind them. They looked finished, which is the
// worst way for a feature to be missing.
// ---------------------------------------------------------------------
describe('reactions', () => {
  it('offers all four, on every kind of post', () => {
    for (const kind of ['tip', 'meal', 'workout']) {
      cleanup()
      render(<PostCard post={post({ kind })} userId="u1" />)
      for (const emoji of ['🔥', '💪', '👏', '😅']) {
        expect(screen.getByRole('button', { name: new RegExp(`${emoji} reaction`) })).toBeInTheDocument()
      }
    }
  })

  it('writes the reaction and tells the parent', async () => {
    const onReactionChange = vi.fn()
    render(<PostCard post={post()} userId="u1" onReactionChange={onReactionChange} />)

    await userEvent.click(fire())
    await waitFor(() => expect(setReaction).toHaveBeenCalledWith('u1', 'p1', '🔥', true))
    expect(onReactionChange).toHaveBeenCalledWith('p1', '🔥', true)
  })

  it('removes it on a second tap', async () => {
    render(
      <PostCard
        post={post()} userId="u1"
        reactions={{ counts: { '🔥': 1 }, mine: new Set(['🔥']) }}
      />,
    )
    await userEvent.click(fire())
    await waitFor(() => expect(setReaction).toHaveBeenCalledWith('u1', 'p1', '🔥', false))
  })

  it('shows the count, and hides it at zero', () => {
    render(
      <PostCard post={post()} userId="u1" reactions={{ counts: { '🔥': 3 }, mine: new Set() }} />,
    )
    expect(fire()).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: /💪 reaction/ })).not.toHaveTextContent(/\d/)
  })

  it('marks the ones you already left', () => {
    render(
      <PostCard post={post()} userId="u1" reactions={{ counts: { '🔥': 1 }, mine: new Set(['🔥']) }} />,
    )
    expect(fire()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /💪 reaction/ })).toHaveAttribute('aria-pressed', 'false')
  })

  // Optimistic, like the bookmark: a reaction is a throwaway gesture, and a
  // spinner turns it into a decision.
  it('moves the count immediately, before the write resolves', async () => {
    let release
    setReaction.mockImplementation(() => new Promise((r) => { release = r }))
    render(
      <PostCard post={post()} userId="u1" reactions={{ counts: { '🔥': 2 }, mine: new Set() }} />,
    )

    await userEvent.click(fire())
    expect(fire()).toHaveTextContent('3')
    expect(fire()).toHaveAttribute('aria-pressed', 'true')

    release()
    await waitFor(() => expect(setReaction).toHaveBeenCalled())
  })

  it('counts down when removing your own', async () => {
    let release
    setReaction.mockImplementation(() => new Promise((r) => { release = r }))
    render(
      <PostCard post={post()} userId="u1" reactions={{ counts: { '🔥': 2 }, mine: new Set(['🔥']) }} />,
    )

    await userEvent.click(fire())
    expect(fire()).toHaveTextContent('1')
    release()
    await waitFor(() => expect(setReaction).toHaveBeenCalled())
  })

  it('never renders a negative count', async () => {
    render(
      <PostCard post={post()} userId="u1" reactions={{ counts: {}, mine: new Set(['🔥']) }} />,
    )
    await userEvent.click(fire())
    expect(fire().textContent).not.toMatch(/-/)
  })

  it('rolls back and says why when the write fails', async () => {
    setReaction.mockRejectedValue({ code: 'PGRST205' })
    const onReactionChange = vi.fn()
    render(
      <PostCard
        post={post()} userId="u1"
        reactions={{ counts: { '🔥': 1 }, mine: new Set() }}
        onReactionChange={onReactionChange}
      />,
    )

    await userEvent.click(fire())
    expect(await screen.findByText(/reactions table is missing/i)).toBeInTheDocument()
    await waitFor(() => expect(fire()).toHaveAttribute('aria-pressed', 'false'))
    expect(fire()).toHaveTextContent('1')
    // The parent is never told about a reaction that did not happen.
    expect(onReactionChange).not.toHaveBeenCalled()
  })

  it('asks a signed-out reader to sign in rather than failing silently', async () => {
    render(<PostCard post={post()} userId={undefined} />)
    await userEvent.click(fire())
    expect(await screen.findByText(/sign in to react/i)).toBeInTheDocument()
    expect(setReaction).not.toHaveBeenCalled()
  })

  it('works with no reaction data at all, rather than crashing', async () => {
    render(<PostCard post={post()} userId="u1" reactions={undefined} />)
    expect(fire()).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(fire())
    await waitFor(() => expect(setReaction).toHaveBeenCalledWith('u1', 'p1', '🔥', true))
  })

  it('handles two different reactions on the same post independently', async () => {
    render(
      <PostCard post={post()} userId="u1" reactions={{ counts: { '🔥': 1 }, mine: new Set(['🔥']) }} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /💪 reaction/ }))
    await waitFor(() => expect(setReaction).toHaveBeenCalledWith('u1', 'p1', '💪', true))
    // The fire one is untouched.
    expect(fire()).toHaveAttribute('aria-pressed', 'true')
  })

  // The Comment button next to them did nothing either, and unlike the
  // reactions there is no comments feature to wire it to.
  it('no longer shows a Comment button that does nothing', () => {
    render(<PostCard post={post()} userId="u1" />)
    expect(screen.queryByRole('button', { name: /^comment$/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------
// "The comments also weren't working." Same story as the reactions: a
// button labelled Comment, with no handler and no table.
// ---------------------------------------------------------------------
const comment = (over = {}) => ({
  id: 'c1',
  post_id: 'p1',
  user_id: 'u2',
  author_name: 'María',
  body: 'Strong work',
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  is_mine: false,
  ...over,
})

const commentToggle = () => screen.getByRole('button', { name: /comment/i })

describe('comments', () => {
  it('invites a comment when there are none', () => {
    render(<PostCard post={post()} userId="u1" />)
    expect(screen.getByRole('button', { name: 'Add a comment' })).toBeInTheDocument()
  })

  it('shows the count when there are some, and pluralises it', () => {
    const { rerender } = render(<PostCard post={post()} userId="u1" commentCount={1} />)
    expect(screen.getByRole('button', { name: 'Show 1 comment' })).toBeInTheDocument()

    rerender(<PostCard post={post()} userId="u1" commentCount={3} />)
    expect(screen.getByRole('button', { name: 'Show 3 comments' })).toBeInTheDocument()
  })

  // Collapsed by default and fetched on open — otherwise the feed pulls
  // every comment on every post before it can render anything.
  it('fetches nothing until the thread is opened', async () => {
    render(<PostCard post={post()} userId="u1" commentCount={2} />)
    expect(getComments).not.toHaveBeenCalled()

    await userEvent.click(commentToggle())
    await waitFor(() => expect(getComments).toHaveBeenCalledWith('p1'))
  })

  it('shows the comments once open, with who wrote each', async () => {
    // Deliberately not "María" — she is the post's author, and a name that
    // matches the card header would make this assertion prove nothing.
    getComments.mockResolvedValue([
      comment({ author_name: 'Diego', body: 'Strong work' }),
      comment({ id: 'c2', author_name: 'Sam', body: 'Nice one' }),
    ])
    render(<PostCard post={post()} userId="u1" commentCount={2} />)

    await userEvent.click(commentToggle())
    expect(await screen.findByText('Strong work')).toBeInTheDocument()
    expect(screen.getByText('Nice one')).toBeInTheDocument()
    expect(screen.getByText('Diego')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
  })

  it('does not re-fetch when reopened', async () => {
    render(<PostCard post={post()} userId="u1" commentCount={1} />)
    await userEvent.click(commentToggle())
    await waitFor(() => expect(getComments).toHaveBeenCalledTimes(1))

    await userEvent.click(commentToggle()) // close
    await userEvent.click(commentToggle()) // open
    expect(getComments).toHaveBeenCalledTimes(1)
  })

  it('says so when a thread is empty', async () => {
    render(<PostCard post={post()} userId="u1" />)
    await userEvent.click(commentToggle())
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument()
  })

  it('posts a comment and refreshes the thread', async () => {
    const onCommentCountChange = vi.fn()
    getComments.mockResolvedValueOnce([]).mockResolvedValueOnce([comment({ body: 'Great session' })])
    render(<PostCard post={post()} userId="u1" onCommentCountChange={onCommentCountChange} />)

    await userEvent.click(commentToggle())
    await userEvent.type(await screen.findByLabelText(/your comment/i), 'Great session')
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }))

    await waitFor(() => expect(addComment).toHaveBeenCalledWith('u1', 'p1', 'Great session'))
    expect(await screen.findByText('Great session')).toBeInTheDocument()
    // The feed's count follows the thread it just fetched.
    expect(onCommentCountChange).toHaveBeenCalledWith('p1', 1)
  })

  it('will not post an empty comment', async () => {
    render(<PostCard post={post()} userId="u1" />)
    await userEvent.click(commentToggle())
    expect(await screen.findByRole('button', { name: /^post$/i })).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/your comment/i), '   ')
    expect(screen.getByRole('button', { name: /^post$/i })).toBeDisabled()
  })

  // Losing what someone just typed because the network blinked is the kind
  // of thing people do not forgive.
  it('keeps the draft when posting fails, and says why', async () => {
    addComment.mockRejectedValue({ code: 'PGRST205' })
    render(<PostCard post={post()} userId="u1" />)

    await userEvent.click(commentToggle())
    await userEvent.type(await screen.findByLabelText(/your comment/i), 'Great session')
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }))

    expect(await screen.findByText(/comments table is missing/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your comment/i)).toHaveValue('Great session')
  })

  it('shows a character counter against the limit', async () => {
    render(<PostCard post={post()} userId="u1" />)
    await userEvent.click(commentToggle())
    await userEvent.type(await screen.findByLabelText(/your comment/i), 'hey')
    expect(screen.getByText('3/500')).toBeInTheDocument()
  })

  it('offers Delete on your own comment only', async () => {
    getComments.mockResolvedValue([
      comment({ id: 'c1', is_mine: true, body: 'mine' }),
      comment({ id: 'c2', is_mine: false, body: 'theirs' }),
    ])
    render(<PostCard post={post()} userId="u1" commentCount={2} />)

    await userEvent.click(commentToggle())
    await screen.findByText('mine')
    expect(screen.getAllByRole('button', { name: /delete your comment/i })).toHaveLength(1)
  })

  it('removes a deleted comment immediately and tells the feed', async () => {
    const onCommentCountChange = vi.fn()
    getComments.mockResolvedValue([comment({ is_mine: true })])
    render(<PostCard post={post()} userId="u1" commentCount={1} onCommentCountChange={onCommentCountChange} />)

    await userEvent.click(commentToggle())
    await userEvent.click(await screen.findByRole('button', { name: /delete your comment/i }))

    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith('c1'))
    expect(screen.queryByText('Strong work')).toBeNull()
    expect(onCommentCountChange).toHaveBeenCalledWith('p1', 0)
  })

  it('puts a comment back when the delete fails', async () => {
    deleteComment.mockRejectedValue({ message: 'not yours' })
    getComments.mockResolvedValue([comment({ is_mine: true })])
    render(<PostCard post={post()} userId="u1" commentCount={1} />)

    await userEvent.click(commentToggle())
    await userEvent.click(await screen.findByRole('button', { name: /delete your comment/i }))

    expect(await screen.findByText(/not yours/i)).toBeInTheDocument()
    expect(screen.getByText('Strong work')).toBeInTheDocument()
  })

  it('asks a signed-out reader to sign in instead of showing a dead box', async () => {
    render(<PostCard post={post()} userId={undefined} />)
    await userEvent.click(commentToggle())
    expect(await screen.findByText(/sign in to comment/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/your comment/i)).toBeNull()
  })

  it('explains a thread that will not load', async () => {
    getComments.mockRejectedValue({ code: 'PGRST205' })
    render(<PostCard post={post()} userId="u1" commentCount={2} />)

    await userEvent.click(commentToggle())
    expect(await screen.findByText(/comments table is missing/i)).toBeInTheDocument()
  })
})

// "También quiero que soluciones la opción de poder editar un post."
// There was no UPDATE policy on `posts` at all, so this was impossible in
// the database as well as absent from the screen — fixing a typo meant
// deleting the post, and that took its reactions and comments with it.
describe('editing your own post', () => {
  const mine = (over = {}) => post({ user_id: 'u1', ...over })
  const editBtn = () => screen.getByRole('button', { name: /^edit /i })

  it('offers Edit on your own post', () => {
    render(<PostCard post={mine()} userId="u1" />)
    expect(editBtn()).toBeInTheDocument()
  })

  it('does not offer it on somebody else\'s', () => {
    render(<PostCard post={post({ user_id: 'u2' })} userId="u1" />)
    expect(screen.queryByRole('button', { name: /^edit /i })).toBeNull()
  })

  it('does not offer it when signed out', () => {
    render(<PostCard post={post({ user_id: 'u1' })} userId={undefined} />)
    expect(screen.queryByRole('button', { name: /^edit /i })).toBeNull()
  })

  it('opens pre-filled, so it is an edit and not a retype', async () => {
    render(<PostCard post={mine({ title: 'Push day', note: 'felt strong' })} userId="u1" />)
    await userEvent.click(editBtn())

    expect(screen.getByLabelText('Title')).toHaveValue('Push day')
    expect(screen.getByLabelText('Note')).toHaveValue('felt strong')
  })

  it('saves the change', async () => {
    render(<PostCard post={mine()} userId="u1" />)
    await userEvent.click(editBtn())

    const title = screen.getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Pull day')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePost).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'Pull day',
    })))
  })

  it('hands the change up so the feed shows it without a refetch', async () => {
    const onPostChange = vi.fn()
    updatePost.mockResolvedValue({ title: 'Pull day', note: null, edited_at: 'now' })
    render(<PostCard post={mine()} userId="u1" onPostChange={onPostChange} />)

    await userEvent.click(editBtn())
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onPostChange).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'Pull day',
    })))
  })

  it('offers minutes on a workout', async () => {
    render(<PostCard post={mine({ kind: 'workout', minutes: 45 })} userId="u1" />)
    await userEvent.click(editBtn())
    expect(screen.getByLabelText('Minutes')).toHaveValue(45)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('offers the cheat toggle on a meal', async () => {
    render(<PostCard post={mine({ kind: 'meal', is_cheat: true })} userId="u1" />)
    await userEvent.click(editBtn())
    expect(screen.getByRole('checkbox', { name: /cheat meal/i })).toBeChecked()
    expect(screen.queryByLabelText('Minutes')).toBeNull()
  })

  it('will not save an empty title', async () => {
    render(<PostCard post={mine()} userId="u1" />)
    await userEvent.click(editBtn())
    await userEvent.clear(screen.getByLabelText('Title'))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('keeps what you typed when the save fails, and says why', async () => {
    updatePost.mockRejectedValue({ code: '42501' })
    render(<PostCard post={mine()} userId="u1" />)

    await userEvent.click(editBtn())
    const title = screen.getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Pull day')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/only edit your own posts/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Pull day')
  })

  it('closes without saving on Cancel', async () => {
    render(<PostCard post={mine()} userId="u1" />)
    await userEvent.click(editBtn())
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(updatePost).not.toHaveBeenCalled()
  })

  // A post that changes under someone who already replied to it should not
  // do so silently.
  it('marks an edited post as edited', () => {
    render(<PostCard post={mine({ edited_at: '2026-08-02T10:00:00Z' })} userId="u1" />)
    expect(screen.getByText(/· edited/)).toBeInTheDocument()
  })

  it('says nothing on a post that has never been edited', () => {
    render(<PostCard post={mine()} userId="u1" />)
    expect(screen.queryByText(/· edited/)).toBeNull()
  })

  // Reactions and comments belong to the post, not to the draft.
  it('keeps the reactions reachable while editing', async () => {
    render(<PostCard post={mine()} userId="u1" />)
    await userEvent.click(editBtn())
    expect(screen.getByRole('button', { name: /🔥 reaction/ })).toBeInTheDocument()
  })
})

// The screenshot: a post titled "Fried rice and dessert", carrying a pink
// "cheat 😈" pill, with "🍽️ Healthy Meal" printed directly under the
// author's name.
describe('what the card says a post is', () => {
  it('does not call a cheat meal a healthy meal', () => {
    render(<PostCard post={post({ kind: 'meal', is_cheat: true, is_healthy: false, meal_type: 'Dinner' })} userId="u1" />)
    expect(screen.queryByText(/healthy meal/i)).toBeNull()
    expect(screen.getByText(/Dinner/)).toBeInTheDocument()
    expect(screen.getByText(/cheat/)).toBeInTheDocument()
  })

  it('does not claim every workout is strength', () => {
    render(<PostCard post={post({ kind: 'workout', workout_type: 'cardio' })} userId="u1" />)
    expect(screen.getByText(/Cardio/)).toBeInTheDocument()
    expect(screen.queryByText(/Strength/)).toBeNull()
  })

  it('says plain Workout for a post logged before there was a choice', () => {
    render(<PostCard post={post({ kind: 'workout', workout_type: null })} userId="u1" />)
    expect(screen.getByText(/🏋️ Workout/)).toBeInTheDocument()
  })

  it('uses the type in the minutes line too', () => {
    render(<PostCard post={post({ kind: 'workout', workout_type: 'sport', minutes: 90 })} userId="u1" />)
    expect(screen.getByText('90 min · Sport')).toBeInTheDocument()
  })

  it('shows the descriptive tags a meal carries', () => {
    render(<PostCard post={post({ kind: 'meal', is_healthy: true, meal_tags: ['high-protein', 'home-cooked'] })} userId="u1" />)
    expect(screen.getByText('healthy')).toBeInTheDocument()
    expect(screen.getByText('High protein')).toBeInTheDocument()
    expect(screen.getByText('Home-cooked')).toBeInTheDocument()
  })

  it('shows no pill at all on a meal that is neither healthy nor a cheat', () => {
    render(<PostCard post={post({ kind: 'meal', is_healthy: false, is_cheat: false, meal_type: 'Snack' })} userId="u1" />)
    expect(screen.queryByText('healthy')).toBeNull()
    expect(screen.queryByText(/cheat/)).toBeNull()
    expect(screen.getByText(/Snack/)).toBeInTheDocument()
  })
})

describe('editing the labels', () => {
  const mineMeal = (over = {}) => post({ user_id: 'u1', kind: 'meal', ...over })

  it('lets you correct a workout that was logged as the wrong type', async () => {
    render(<PostCard post={post({ user_id: 'u1', kind: 'workout', workout_type: 'strength' })} userId="u1" />)
    await userEvent.click(screen.getByRole('button', { name: /^edit /i }))

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'cardio')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePost).toHaveBeenCalledWith('p1', expect.objectContaining({
      workout_type: 'cardio',
    })))
  })

  it('lets you add and remove meal labels', async () => {
    render(<PostCard post={mineMeal({ meal_tags: ['veggie'] })} userId="u1" />)
    await userEvent.click(screen.getByRole('button', { name: /^edit /i }))

    expect(screen.getByRole('checkbox', { name: 'Veggie' })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Veggie' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'High protein' }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePost).toHaveBeenCalledWith('p1', expect.objectContaining({
      meal_tags: ['high-protein'],
    })))
  })

  it('does not offer meal labels on a workout, or a type on a meal', async () => {
    render(<PostCard post={post({ user_id: 'u1', kind: 'workout' })} userId="u1" />)
    await userEvent.click(screen.getByRole('button', { name: /^edit /i }))
    expect(screen.queryByRole('checkbox', { name: 'Veggie' })).toBeNull()

    cleanup()
    render(<PostCard post={mineMeal({ id: 'p2' })} userId="u1" />)
    await userEvent.click(screen.getByRole('button', { name: /^edit /i }))
    expect(screen.queryByLabelText('Type')).toBeNull()
  })
})

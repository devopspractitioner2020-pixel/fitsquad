import { useState } from 'react'
import VideoEmbed from './VideoEmbed'
import { SAVEABLE_KINDS, setSaved, describeSaveError } from '../lib/saved'
import { REACTIONS, setReaction, describeReactionError } from '../lib/reactions'
import {
  getComments, addComment, deleteComment, describeCommentError, MAX_COMMENT_CHARS,
} from '../lib/comments'


// One post, used by both the feed and the saved lists. It lived inside
// Feed.jsx until saving needed the same card in two places — duplicating it
// would have meant every future tweak had to be made twice.

export default function PostCard({
  post,
  userId,
  saved = false,
  onSavedChange,
  reactions,
  onReactionChange,
  commentCount = 0,
  onCommentCountChange,
}) {
  const [saveError, setSaveError] = useState('')
  const when = timeAgo(post.created_at)
  const kindLabel = post.kind === 'workout' ? 'Strength' : post.kind === 'meal' ? 'Healthy Meal' : 'Tip'
  const kindIcon = post.kind === 'meal' ? '🍽️' : post.kind === 'tip' ? '✨' : '🏋️'

  return (
    <div className="bg-card border border-line rounded-xl2 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-mint/15 grid place-items-center text-mint font-display font-700">
          {(post.author_name ?? '?')[0]?.toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="font-display font-700">{post.author_name} <span className="text-muted font-body font-400">· {when}</span></div>
          <div className="text-muted text-sm">{kindIcon} {kindLabel}</div>
        </div>

        {/* Saving sits in the header rather than down with the reactions:
            it is about the reader, not about the author, and it should not
            read as another way of applauding the post. */}
        {SAVEABLE_KINDS.includes(post.kind) && (
          <SaveButton
            post={post}
            userId={userId}
            saved={saved}
            onSavedChange={onSavedChange}
            onError={setSaveError}
          />
        )}
      </div>

      {saveError && (
        <p className="text-[#ffd479] text-sm mb-3" role="status">{saveError}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h4 className="font-display text-[26px] font-700">{post.title}</h4>
        {/* /12 is not on Tailwind's opacity scale — these pills had no
            background at all until the arbitrary-value syntax was used. */}
        {post.is_healthy && <span className="text-mint bg-mint/[0.12] rounded-full px-3 py-0.5 text-sm font-700">healthy</span>}
        {post.is_cheat && <span className="text-[#ff8bd0] bg-[#ff8bd0]/[0.12] rounded-full px-3 py-0.5 text-sm font-700">cheat 😈</span>}
      </div>
      {post.minutes && <p className="text-muted mb-2">{post.minutes} min · Strength</p>}
      {post.note && <p className="text-muted mb-2">{post.note}</p>}

      {post.photo_url && (
        <img src={post.photo_url} alt={post.title} className="w-full max-h-72 object-cover rounded-2xl border border-line my-3" />
      )}

      {post.video_url && <VideoEmbed url={post.video_url} />}

      <Reactions
        post={post}
        userId={userId}
        reactions={reactions}
        onReactionChange={onReactionChange}
        commentCount={commentCount}
        onCommentCountChange={onCommentCountChange}
      />
    </div>
  )
}

/**
 * The comment thread, opened on demand.
 *
 * Collapsed by default and fetched only when opened: the feed shows a count,
 * which is one small query for every card, rather than every comment on every
 * post before anything renders.
 */
function Comments({ post, userId, count, onCountChange }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null) // null = not loaded yet
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || items !== null) return
    try {
      setItems(await getComments(post.id))
    } catch (e) {
      setErr(describeCommentError(e))
      setItems([])
    }
  }

  async function submit() {
    const text = draft.trim()
    if (!text) return
    setErr(''); setBusy(true)
    try {
      await addComment(userId, post.id, text)
      setDraft('')
      const fresh = await getComments(post.id)
      setItems(fresh)
      onCountChange?.(post.id, fresh.length)
    } catch (e) {
      // The draft is deliberately NOT cleared on failure — losing what
      // someone just typed because the network blinked is unforgivable.
      setErr(describeCommentError(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    setErr('')
    const previous = items
    setItems((prev) => prev.filter((c) => c.id !== id))
    onCountChange?.(post.id, Math.max(0, (previous?.length ?? 1) - 1))
    try {
      await deleteComment(id)
    } catch (e) {
      setItems(previous)
      onCountChange?.(post.id, previous.length)
      setErr(describeCommentError(e))
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="text-muted text-sm"
      >
        {count > 0
          ? `${open ? 'Hide' : 'Show'} ${count} comment${count === 1 ? '' : 's'}`
          : 'Add a comment'}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {items === null && <p className="text-muted-2 text-sm">Loading…</p>}

          {items?.map((c) => (
            <div key={c.id} className="bg-panel/60 border border-line rounded-2xl p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-display font-700 text-[15px]">{c.author_name}</span>
                <span className="text-muted-2 text-[12px]">{timeAgo(c.created_at)}</span>
                {c.is_mine && (
                  <button
                    onClick={() => remove(c.id)}
                    className="ml-auto text-muted-2 text-[12px] underline"
                    aria-label={`Delete your comment: ${c.body}`}
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="text-cream text-sm mt-1 whitespace-pre-line break-words">{c.body}</p>
            </div>
          ))}

          {items?.length === 0 && (
            <p className="text-muted-2 text-sm">No comments yet. Say something.</p>
          )}

          {userId ? (
            <div>
              <label className="block">
                <span className="sr-only">Your comment</span>
                <textarea
                  className="input min-h-[64px] resize-none text-sm"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={MAX_COMMENT_CHARS}
                  placeholder="Add a comment…"
                  aria-label="Your comment"
                />
              </label>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-muted-2 text-[12px]">
                  {draft.length}/{MAX_COMMENT_CHARS}
                </span>
                <button
                  className="btn-primary ml-auto px-5 py-2 text-sm flex items-center gap-2"
                  onClick={submit}
                  disabled={busy || !draft.trim()}
                >
                  {busy ? <><span className="spinner" /> Posting…</> : 'Post'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-muted-2 text-sm">Sign in to comment.</p>
          )}

          {err && <p className="text-[#ffd479] text-sm" role="status">{err}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * The four emoji, wired up at last.
 *
 * Optimistic like the bookmark, and for the same reason: a reaction is a
 * throwaway gesture, and making someone watch a spinner for one turns it
 * into a decision. The count moves immediately and rolls back if the write
 * fails — with a message, because a silently reverting count is exactly what
 * "I tapped fire and nothing happened" looked like.
 */
function Reactions({ post, userId, reactions, onReactionChange, commentCount, onCommentCountChange }) {
  const [err, setErr] = useState('')
  // Overrides applied on top of the parent's data while a write is in
  // flight, keyed by emoji: true = just added, false = just removed.
  const [pending, setPending] = useState({})

  const counts = reactions?.counts ?? {}
  const mine = reactions?.mine ?? new Set()

  const isOn = (emoji) => pending[emoji] ?? mine.has(emoji)

  // The parent's count still reflects the state before the tap, so the
  // optimistic count is the stored one plus the difference my own pending
  // change makes to it — +1, -1, or nothing.
  const countOf = (emoji) => {
    const was = mine.has(emoji)
    const now = isOn(emoji)
    return Math.max(0, (counts[emoji] ?? 0) + ((now ? 1 : 0) - (was ? 1 : 0)))
  }

  async function toggle(emoji) {
    if (!userId) { setErr('Sign in to react.'); return }
    const next = !isOn(emoji)
    setErr('')
    setPending((p) => ({ ...p, [emoji]: next }))
    try {
      await setReaction(userId, post.id, emoji, next)
      onReactionChange?.(post.id, emoji, next)
      // The parent is authoritative again.
      setPending((p) => { const { [emoji]: _drop, ...rest } = p; return rest })
    } catch (e) {
      setPending((p) => { const { [emoji]: _drop, ...rest } = p; return rest })
      setErr(describeReactionError(e))
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {REACTIONS.map((emoji) => {
          const on = isOn(emoji)
          const n = countOf(emoji)
          return (
            <button
              key={emoji}
              onClick={() => toggle(emoji)}
              aria-pressed={on}
              aria-label={`${on ? 'Remove' : 'Add'} ${emoji} reaction${n ? `, ${n} so far` : ''}`}
              className={`h-9 min-w-11 px-3 rounded-full border flex items-center justify-center gap-1.5 text-[16px] transition-colors ${
                on ? 'border-mint/50 bg-mint/[0.12]' : 'border-line active:bg-card-2'
              }`}
            >
              <span aria-hidden="true">{emoji}</span>
              {n > 0 && (
                <span className={`text-[13px] font-700 ${on ? 'text-mint' : 'text-muted'}`}>{n}</span>
              )}
            </button>
          )
        })}
      </div>
      {err && <p className="text-[#ffd479] text-sm mt-2" role="status">{err}</p>}

      <Comments
        post={post}
        userId={userId}
        count={commentCount}
        onCountChange={onCommentCountChange}
      />
    </>
  )
}

/**
 * Bookmark toggle.
 *
 * Optimistic: the icon fills the instant it is tapped and reverts only if
 * the write fails. Waiting on a round trip to confirm a bookmark makes the
 * whole feed feel sluggish, and the cost of being briefly wrong is nil.
 */
function SaveButton({ post, userId, saved, onSavedChange, onError }) {
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(null) // optimistic override
  const isSaved = local ?? saved

  async function toggle() {
    if (busy || !userId) return
    const next = !isSaved
    setLocal(next)
    setBusy(true)
    onError?.('')
    try {
      await setSaved(userId, post.id, next)
      onSavedChange?.(post.id, next)
      setLocal(null) // parent state is now authoritative
    } catch (e) {
      setLocal(!next) // put the icon back where it was
      // Reverting the icon on its own is not feedback: it looks identical to
      // the tap never having registered. Say what happened.
      onError?.(describeSaveError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={isSaved}
      aria-label={isSaved ? `Unsave ${post.title}` : `Save ${post.title}`}
      title={isSaved ? 'Saved' : 'Save for later'}
      className={`w-10 h-10 rounded-full grid place-items-center border transition-colors ${
        isSaved ? 'border-mint/50 bg-mint/[0.12]' : 'border-line active:bg-card-2'
      }`}
    >
      <svg
        width="20" height="20" viewBox="0 0 24 24"
        fill={isSaved ? '#2FE6A8' : 'none'}
        stroke={isSaved ? '#2FE6A8' : '#7C938C'}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  )
}

export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86400) return `about ${Math.floor(s / 3600)} hours ago`
  return `${Math.floor(s / 86400)} day${s < 172800 ? '' : 's'} ago`
}

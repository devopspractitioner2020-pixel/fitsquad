import { useState } from 'react'
import VideoEmbed from './VideoEmbed'
import { SAVEABLE_KINDS, setSaved, describeSaveError } from '../lib/saved'

// One post, used by both the feed and the saved lists. It lived inside
// Feed.jsx until saving needed the same card in two places — duplicating it
// would have meant every future tweak had to be made twice.

const REACTIONS = ['🔥', '💪', '👏', '😅']

export default function PostCard({ post, userId, saved = false, onSavedChange }) {
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

      <div className="flex items-center gap-2 mt-3">
        {REACTIONS.map((r) => (
          <button key={r} className="w-11 h-9 rounded-full border border-line grid place-items-center text-[16px] active:bg-card-2">{r}</button>
        ))}
        <button className="ml-auto text-muted">Comment</button>
      </div>
    </div>
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

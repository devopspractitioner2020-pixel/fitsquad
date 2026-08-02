import { supabase } from './supabase'

// Reactions on posts, and the activity list they feed.
//
// The four buttons under every post were decoration until now: real
// `<button>` elements with no handler and no table behind them. Tapping one
// did nothing and said nothing, which is worse than not having them.

export const REACTIONS = ['🔥', '💪', '👏', '😅']

// Matches the CHECK constraint in migration 0010. Sending anything else is a
// database error, so it is worth refusing locally with a sentence a person
// could act on.
export const isReaction = (emoji) => REACTIONS.includes(emoji)

/**
 * Every reaction on a set of posts, rolled up per post.
 *
 * Returns a Map keyed by post id:
 *   { counts: { '🔥': 3 }, mine: Set<'🔥'> }
 *
 * One query for the whole feed rather than one per card — fifty posts would
 * otherwise be fifty round trips before anything rendered.
 */
export async function getReactions(postIds, userId) {
  const ids = [...new Set((postIds ?? []).filter(Boolean))]
  const byPost = new Map()
  if (!ids.length) return byPost

  const { data, error } = await supabase
    .from('reactions')
    .select('post_id,user_id,emoji')
    .in('post_id', ids)
  if (error) throw error

  for (const r of data ?? []) {
    let entry = byPost.get(r.post_id)
    if (!entry) {
      entry = { counts: {}, mine: new Set() }
      byPost.set(r.post_id, entry)
    }
    entry.counts[r.emoji] = (entry.counts[r.emoji] ?? 0) + 1
    if (r.user_id === userId) entry.mine.add(r.emoji)
  }
  return byPost
}

/**
 * Add or remove one reaction.
 *
 * Insert and delete rather than an upsert with a flag: the primary key is
 * (post_id, user_id, emoji), so presence IS the state. There is no row to
 * carry a false in.
 */
export async function setReaction(userId, postId, emoji, on) {
  if (!userId) throw new Error('Sign in to react.')
  if (!isReaction(emoji)) throw new Error('That reaction is not one of the four.')

  if (on) {
    const { error } = await supabase
      .from('reactions')
      .upsert({ user_id: userId, post_id: postId, emoji }, { onConflict: 'post_id,user_id,emoji' })
    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('reactions').delete()
    .eq('user_id', userId).eq('post_id', postId).eq('emoji', emoji)
  if (error) throw error
}

/**
 * Turn a failed reaction into a sentence.
 *
 * PostgREST answers a missing relation with 404 on the collection endpoint
 * and code PGRST205 — which reads as "not found" and sends people hunting
 * for a missing post rather than a missing migration.
 */
export function describeReactionError(error) {
  const code = error?.code
  const message = error?.message ?? ''
  if (code === 'PGRST205' || /schema cache/i.test(message)) {
    return 'Reactions are not set up on this project yet — the reactions table is missing.'
  }
  if (code === '23514' || /violates check constraint/i.test(message)) {
    return 'That reaction is not one of the four.'
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You can only react to posts from your own squad.'
  }
  return message || 'Could not save that reaction.'
}

/** Reactions other people left on your posts, newest first. */
export async function getActivity(limit = 50) {
  const { data, error } = await supabase.rpc('my_activity', { limit_n: limit })
  if (error) throw error
  return data ?? []
}

/** How many of those arrived since the last look. Drives the badge. */
export async function getUnseenCount() {
  const { data, error } = await supabase.rpc('unseen_activity_count')
  if (error) throw error
  return Number(data ?? 0)
}

export async function markActivitySeen() {
  const { error } = await supabase.rpc('mark_activity_seen')
  if (error) throw error
}

/**
 * One line per activity item, built here rather than in the JSX so both
 * kinds read as one sentence to a screen reader.
 *
 * `kind` arrived with comments in migration 0011. Items from before that
 * have no kind and are always reactions, so the default keeps an older
 * response rendering rather than falling through to nothing.
 */
export function describeActivity(item) {
  if (item?.kind === 'comment') {
    return `${item.actor_name} commented on “${item.post_title}”`
  }
  return `${item.actor_name} reacted ${item.emoji} to “${item.post_title}”`
}

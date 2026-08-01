import { supabase } from './supabase'

// Saving a post is a bookmark, not a copy: `saved_posts` stores a reference
// and every read joins back to `posts`. So an edited post shows its new text
// in the saved list, and a deleted one disappears from it rather than
// lingering as a ghost.

/**
 * Turn a Supabase error into something worth showing a person.
 *
 * The case worth special-casing is a missing table. PostgREST answers 404
 * with code PGRST205 when the relation is not in its schema cache, which in
 * practice means one thing: migration 0006 has not been run against this
 * project. A generic "could not save" would send someone hunting through
 * their own code for a bug that is not there.
 */
export function describeSaveError(error) {
  const code = error?.code ?? ''
  const message = String(error?.message ?? error ?? '')

  if (code === 'PGRST205' || /schema cache|could not find the table/i.test(message)) {
    return 'Saving is not set up on this project yet — the saved_posts table is missing.'
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You do not have permission to save that.'
  }
  if (/failed to fetch|networkerror/i.test(message)) {
    return 'No connection — that did not save.'
  }
  return 'Could not save that. Try again.'
}

/** Kinds that can be saved. Workouts are logs, not reference material. */
export const SAVEABLE_KINDS = ['tip', 'meal']

export const KIND_LABEL = {
  tip: 'Saved tips',
  meal: 'Saved meals',
}

/** URL slug ↔ post kind, so routes read as /saved/tips not /saved/tip. */
export const SLUG_TO_KIND = { tips: 'tip', meals: 'meal' }
export const KIND_TO_SLUG = { tip: 'tips', meal: 'meals' }

/**
 * The ids this user has saved, as a Set for O(1) lookup while rendering a
 * feed. Only ids — the posts themselves are already on screen.
 */
export async function getSavedPostIds(userId) {
  if (!userId) return new Set()
  const { data, error } = await supabase
    .from('saved_posts').select('post_id').eq('user_id', userId)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.post_id))
}

/**
 * Save or unsave, depending on `next`.
 *
 * Insert uses upsert so a double-tap (or two devices) is not an error —
 * saving something already saved should be a no-op, not a failure toast.
 */
export async function setSaved(userId, postId, next) {
  if (!userId) throw new Error('Not signed in.')
  if (next) {
    const { error } = await supabase
      .from('saved_posts')
      .upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id' })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('saved_posts').delete().eq('user_id', userId).eq('post_id', postId)
    if (error) throw error
  }
}

/**
 * Saved posts of one kind, newest save first.
 *
 * `posts!inner` matters: an inner join drops rows whose post is no longer
 * readable — deleted, or by someone who has since left the squad — so the
 * list can never render a hole.
 */
export async function getSavedPosts(userId, kind) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('saved_posts')
    .select('post_id, created_at, posts!inner(*)')
    .eq('user_id', userId)
    .eq('posts.kind', kind)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({ ...r.posts, saved_at: r.created_at }))
}

/** How many of each saveable kind this user has saved. */
export async function getSavedCounts(userId) {
  const empty = Object.fromEntries(SAVEABLE_KINDS.map((k) => [k, 0]))
  if (!userId) return empty
  const { data, error } = await supabase
    .from('saved_posts')
    .select('post_id, posts!inner(kind)')
    .eq('user_id', userId)
  if (error) throw error

  const counts = { ...empty }
  for (const row of data ?? []) {
    const kind = row.posts?.kind
    if (kind in counts) counts[kind] += 1
  }
  return counts
}

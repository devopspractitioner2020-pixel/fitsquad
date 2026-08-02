import { supabase } from './supabase'

// Comments on posts.
//
// The "Comment" button sat next to the four reaction emoji and did exactly
// what they did: nothing at all. No handler, no table. Reactions were wired
// up first; this is the rest of it.

export const MAX_COMMENT_CHARS = 500

/**
 * How many comments each of these posts has.
 *
 * Counts only — the bodies are fetched when someone actually opens a thread.
 * Loading every comment on every card would mean pulling the whole
 * conversation history of fifty posts to render fifty small numbers.
 */
export async function getCommentCounts(postIds) {
  const ids = [...new Set((postIds ?? []).filter(Boolean))]
  const counts = new Map()
  if (!ids.length) return counts

  const { data, error } = await supabase
    .from('comments').select('post_id').in('post_id', ids)
  if (error) throw error

  for (const row of data ?? []) {
    counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1)
  }
  return counts
}

/** One post's comments, oldest first, with author names attached. */
export async function getComments(postId) {
  const { data, error } = await supabase.rpc('post_comments', { pid: postId })
  if (error) throw error
  return data ?? []
}

export async function addComment(userId, postId, body) {
  if (!userId) throw new Error('Sign in to comment.')
  const text = String(body ?? '').trim()
  if (!text) throw new Error('Write something first.')
  if (text.length > MAX_COMMENT_CHARS) {
    throw new Error(`Comments are ${MAX_COMMENT_CHARS} characters at most.`)
  }

  const { error } = await supabase
    .from('comments').insert({ user_id: userId, post_id: postId, body: text })
  if (error) throw error
}

export async function deleteComment(id) {
  // RLS restricts this to your own; the filter is here so a mistake is a
  // no-op rather than an attempt the database has to refuse.
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

/** Turn a failed comment into a sentence worth reading. */
export function describeCommentError(error) {
  const code = error?.code
  const message = error?.message ?? ''
  if (code === 'PGRST205' || /schema cache/i.test(message)) {
    return 'Comments are not set up on this project yet — the comments table is missing.'
  }
  if (code === '23514' || /violates check constraint/i.test(message)) {
    return `Comments are between 1 and ${MAX_COMMENT_CHARS} characters.`
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You can only comment on posts from your own squad.'
  }
  return message || 'Could not post that comment.'
}

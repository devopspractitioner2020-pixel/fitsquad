import { supabase } from './supabase'
import { WORKOUT_VALUES, MEAL_TAG_VALUES } from './postLabels'

// Editing a post you already made.
//
// Until migration 0012 there was no UPDATE policy on `posts` at all, so this
// was impossible in the database as well as absent from the screen: fixing a
// typo meant deleting the post, and deleting it took its reactions and
// comments with it.

export const MAX_TITLE_CHARS = 120
export const MAX_NOTE_CHARS = 500

/**
 * Save an edit.
 *
 * Only the fields a person can reasonably have got wrong. Deliberately NOT
 * `kind` or `user_id`: changing what a post is after people have reacted to
 * it rewrites what they responded to, and `user_id` is guarded by the RLS
 * WITH CHECK anyway.
 */
export async function updatePost(postId, fields) {
  const title = String(fields?.title ?? '').trim()
  if (!title) throw new Error('Give the post a title.')
  if (title.length > MAX_TITLE_CHARS) {
    throw new Error(`Titles are ${MAX_TITLE_CHARS} characters at most.`)
  }
  const note = String(fields?.note ?? '').trim()
  if (note.length > MAX_NOTE_CHARS) {
    throw new Error(`Notes are ${MAX_NOTE_CHARS} characters at most.`)
  }

  const patch = { title, note: note || null, edited_at: new Date().toISOString() }
  if (fields.minutes !== undefined) {
    const n = parseInt(fields.minutes, 10)
    patch.minutes = Number.isFinite(n) && n > 0 ? n : null
  }
  // Validated against the same lists the CHECK constraints use, so a bad
  // value fails here with a sentence rather than at the database with
  // "violates check constraint posts_workout_type_valid".
  if (fields.workout_type !== undefined) {
    const v = fields.workout_type || null
    if (v !== null && !WORKOUT_VALUES.includes(v)) {
      throw new Error('That is not one of the workout types.')
    }
    patch.workout_type = v
  }
  if (fields.meal_tags !== undefined) {
    patch.meal_tags = (fields.meal_tags ?? []).filter((t) => MEAL_TAG_VALUES.includes(t))
  }
  if (fields.is_cheat !== undefined) {
    patch.is_cheat = !!fields.is_cheat
    // Kept consistent with LogModal: a cheat meal is never also a healthy
    // one, and letting an edit set both would put two contradicting pills on
    // the same card.
    patch.is_healthy = !fields.is_cheat
  }

  const { error } = await supabase.from('posts').update(patch).eq('id', postId)
  if (error) throw error
  return patch
}

export async function deletePost(postId) {
  const { error } = await supabase.from('posts').delete().eq('id', postId)
  if (error) throw error
}

export function describePostError(error) {
  const code = error?.code
  const message = error?.message ?? ''
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You can only edit your own posts.'
  }
  if (code === 'PGRST204' || /edited_at/i.test(message)) {
    return 'Editing is not set up on this project yet — run migration 0012.'
  }
  return message || 'Could not save that change.'
}

// What a post says it is.
//
// One source of truth for the label sets, shared by the log sheet, the card
// and the edit form. When these lived as a hardcoded ternary inside the card
// they went wrong in both directions at once: every workout claimed to be
// "Strength", and a cheat meal — pink pill and all — announced itself as a
// "Healthy Meal".
//
// The values here must match the CHECK constraints in migration 0013.
// src/__tests__/db-contract.test.js asserts that they do, because a mismatch
// is a constraint violation at write time and nowhere earlier.

export const WORKOUT_TYPES = [
  { value: 'strength', label: 'Strength', icon: '🏋️' },
  { value: 'cardio', label: 'Cardio', icon: '🏃' },
  { value: 'sport', label: 'Sport', icon: '⚽' },
  { value: 'mobility', label: 'Mobility', icon: '🧘' },
  { value: 'class', label: 'Class', icon: '💃' },
  { value: 'other', label: 'Other', icon: '💪' },
]

export const MEAL_TAGS = [
  { value: 'high-protein', label: 'High protein' },
  { value: 'home-cooked', label: 'Home-cooked' },
  { value: 'eating-out', label: 'Eating out' },
  { value: 'veggie', label: 'Veggie' },
  { value: 'quick', label: 'Quick' },
]

export const WORKOUT_VALUES = WORKOUT_TYPES.map((t) => t.value)
export const MEAL_TAG_VALUES = MEAL_TAGS.map((t) => t.value)

const workoutByValue = new Map(WORKOUT_TYPES.map((t) => [t.value, t]))
const mealTagByValue = new Map(MEAL_TAGS.map((t) => [t.value, t]))

export const workoutLabel = (value) => workoutByValue.get(value)?.label ?? null
export const mealTagLabel = (value) => mealTagByValue.get(value)?.label ?? null

/**
 * The line under the author's name.
 *
 * Only ever says something the post actually carries. An unlabelled workout
 * is a "Workout", not a guess — the posts logged before there was anything
 * to choose were never categorised by anyone, and "Strength" was the card
 * inventing it.
 */
export function postSubtitle(post) {
  if (!post) return ''
  if (post.kind === 'workout') return workoutLabel(post.workout_type) ?? 'Workout'
  // A meal is described by WHEN it was, which is a fact we already store, and
  // never by whether it was healthy — the pills below say that, and saying it
  // here was how a cheat meal came to be labelled a healthy one.
  if (post.kind === 'meal') return post.meal_type || 'Meal'
  return 'Tip'
}

export function postIcon(post) {
  if (post?.kind === 'workout') {
    return workoutByValue.get(post.workout_type)?.icon ?? '🏋️'
  }
  if (post?.kind === 'meal') return '🍽️'
  return '✨'
}

/**
 * The pills on the card, in order.
 *
 * A cheat meal gets exactly one — "cheat" — and never "healthy" beside it.
 * The two are mutually exclusive everywhere they are written, and this is
 * the last line of defence for rows written before that was true.
 */
export function postPills(post) {
  const pills = []
  if (post?.kind !== 'meal') return pills

  if (post.is_cheat) {
    pills.push({ key: 'cheat', label: 'cheat 😈', tone: 'cheat' })
  } else if (post.is_healthy) {
    pills.push({ key: 'healthy', label: 'healthy', tone: 'healthy' })
  }

  for (const tag of post.meal_tags ?? []) {
    const label = mealTagLabel(tag)
    // Unknown tags are dropped rather than rendered raw: a value that is not
    // in the set came from somewhere this app does not control.
    if (label) pills.push({ key: tag, label, tone: 'tag' })
  }
  return pills
}

/** Only the fields that belong to this kind of post. */
export function labelsForKind(kind, { workoutType, mealTags } = {}) {
  return {
    workout_type: kind === 'workout' ? (workoutType || null) : null,
    meal_tags: kind === 'meal' ? (mealTags ?? []).filter((t) => MEAL_TAG_VALUES.includes(t)) : [],
  }
}

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  WORKOUT_TYPES, MEAL_TAGS, WORKOUT_VALUES, MEAL_TAG_VALUES,
  workoutLabel, mealTagLabel, postSubtitle, postIcon, postPills, labelsForKind,
} from '../postLabels'

const meal = (over = {}) => ({ kind: 'meal', meal_type: 'Dinner', meal_tags: [], ...over })
const workout = (over = {}) => ({ kind: 'workout', ...over })

// ---------------------------------------------------------------------
// The reported bug, in one sentence: the label was a constant when it
// should have been data.
//
//   kind === 'workout' ? 'Strength' : kind === 'meal' ? 'Healthy Meal' : 'Tip'
//
// So a cheat meal — pink "cheat 😈" pill and all — called itself a Healthy
// Meal, and a football match called itself Strength.
// ---------------------------------------------------------------------
describe('the line under the author name', () => {
  it('never calls a cheat meal healthy', () => {
    expect(postSubtitle(meal({ is_cheat: true, is_healthy: false }))).not.toMatch(/healthy/i)
  })

  // Not even a healthy one. The pill below already says it, and repeating a
  // judgement in the place that should state a fact is what caused this.
  it('does not call a healthy meal healthy either — it says when it was', () => {
    expect(postSubtitle(meal({ is_healthy: true, meal_type: 'Lunch' }))).toBe('Lunch')
  })

  it('falls back to "Meal" when there is no meal time', () => {
    expect(postSubtitle(meal({ meal_type: null }))).toBe('Meal')
  })

  it('names the workout the author actually chose', () => {
    expect(postSubtitle(workout({ workout_type: 'cardio' }))).toBe('Cardio')
    expect(postSubtitle(workout({ workout_type: 'sport' }))).toBe('Sport')
    expect(postSubtitle(workout({ workout_type: 'mobility' }))).toBe('Mobility')
  })

  // Posts logged before there was anything to choose were never categorised
  // by anyone. Calling them "Strength" was the bug, not a fact.
  it('says plain "Workout" for an unlabelled one rather than guessing', () => {
    expect(postSubtitle(workout({ workout_type: null }))).toBe('Workout')
    expect(postSubtitle(workout())).toBe('Workout')
  })

  it('ignores a value that is not in the set', () => {
    expect(postSubtitle(workout({ workout_type: 'crossfit' }))).toBe('Workout')
  })

  it('still labels a tip', () => {
    expect(postSubtitle({ kind: 'tip' })).toBe('Tip')
  })

  it('does not throw on nothing', () => {
    expect(postSubtitle(null)).toBe('')
  })
})

describe('the icon', () => {
  it('follows the workout type', () => {
    expect(postIcon(workout({ workout_type: 'cardio' }))).toBe('🏃')
    expect(postIcon(workout({ workout_type: 'sport' }))).toBe('⚽')
  })

  it('falls back rather than rendering undefined', () => {
    expect(postIcon(workout({ workout_type: 'nonsense' }))).toBe('🏋️')
    expect(postIcon(meal())).toBe('🍽️')
    expect(postIcon({ kind: 'tip' })).toBe('✨')
  })
})

describe('the pills', () => {
  it('shows cheat and never healthy alongside it', () => {
    const pills = postPills(meal({ is_cheat: true, is_healthy: true }))
    expect(pills.map((p) => p.key)).toEqual(['cheat'])
  })

  it('shows healthy when it is not a cheat', () => {
    expect(postPills(meal({ is_healthy: true })).map((p) => p.key)).toEqual(['healthy'])
  })

  // "a cheat meal does not need to have a label" — and a plain meal that is
  // neither gets none either.
  it('shows nothing for a meal that is neither', () => {
    expect(postPills(meal({ is_healthy: false, is_cheat: false }))).toEqual([])
  })

  // "meals not only are healthy but they can have other labels".
  it('adds the descriptive tags after the verdict', () => {
    const pills = postPills(meal({ is_healthy: true, meal_tags: ['high-protein', 'home-cooked'] }))
    expect(pills.map((p) => p.label)).toEqual(['healthy', 'High protein', 'Home-cooked'])
  })

  it('lets a cheat meal carry tags too', () => {
    const pills = postPills(meal({ is_cheat: true, meal_tags: ['eating-out'] }))
    expect(pills.map((p) => p.label)).toEqual(['cheat 😈', 'Eating out'])
  })

  // A value outside the set came from somewhere this app does not control.
  it('drops an unknown tag rather than rendering it raw', () => {
    const pills = postPills(meal({ meal_tags: ['high-protein', '<script>'] }))
    expect(pills.map((p) => p.label)).toEqual(['High protein'])
  })

  it('puts no pills on a workout or a tip', () => {
    expect(postPills(workout({ is_healthy: true }))).toEqual([])
    expect(postPills({ kind: 'tip' })).toEqual([])
  })

  it('gives each pill a unique key', () => {
    const pills = postPills(meal({ is_healthy: true, meal_tags: ['veggie', 'quick'] }))
    expect(new Set(pills.map((p) => p.key)).size).toBe(pills.length)
  })
})

describe('labelsForKind', () => {
  it('keeps a workout type off a meal, and tags off a workout', () => {
    expect(labelsForKind('meal', { workoutType: 'cardio', mealTags: ['veggie'] }))
      .toEqual({ workout_type: null, meal_tags: ['veggie'] })
    expect(labelsForKind('workout', { workoutType: 'cardio', mealTags: ['veggie'] }))
      .toEqual({ workout_type: 'cardio', meal_tags: [] })
  })

  it('clears both for a tip', () => {
    expect(labelsForKind('tip', { workoutType: 'cardio', mealTags: ['veggie'] }))
      .toEqual({ workout_type: null, meal_tags: [] })
  })

  it('drops tags that are not in the set before they reach the database', () => {
    expect(labelsForKind('meal', { mealTags: ['veggie', 'made-up'] }).meal_tags).toEqual(['veggie'])
  })

  it('treats an empty workout type as none, not as an empty string', () => {
    expect(labelsForKind('workout', { workoutType: '' }).workout_type).toBeNull()
  })
})

// The lists here and the CHECK constraints in migration 0013 have to agree.
// A mismatch is not caught anywhere else: it fails at write time, in
// production, as "violates check constraint".
describe('the sets match the database', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../../supabase/migrations/0013_post_labels.sql'),
    'utf8',
  )

  it.each(WORKOUT_VALUES)('workout type %s is allowed by the constraint', (value) => {
    expect(sql).toContain(`'${value}'`)
  })

  it.each(MEAL_TAG_VALUES)('meal tag %s is allowed by the constraint', (value) => {
    expect(sql).toContain(`'${value}'`)
  })

  it('has no constraint value the app cannot produce', () => {
    const inWorkoutCheck = sql
      .match(/workout_type in \(([^)]+)\)/)[1]
      .match(/'([a-z-]+)'/g)
      .map((s) => s.replace(/'/g, ''))
    expect(inWorkoutCheck.sort()).toEqual([...WORKOUT_VALUES].sort())
  })

  it('every option has a label and a distinct value', () => {
    for (const t of [...WORKOUT_TYPES, ...MEAL_TAGS]) {
      expect(t.label.length).toBeGreaterThan(0)
    }
    expect(new Set(WORKOUT_VALUES).size).toBe(WORKOUT_VALUES.length)
    expect(new Set(MEAL_TAG_VALUES).size).toBe(MEAL_TAG_VALUES.length)
  })

  it('resolves every value to its label', () => {
    for (const v of WORKOUT_VALUES) expect(workoutLabel(v)).toBeTruthy()
    for (const v of MEAL_TAG_VALUES) expect(mealTagLabel(v)).toBeTruthy()
    expect(workoutLabel('nope')).toBeNull()
    expect(mealTagLabel('nope')).toBeNull()
  })
})

// Pure business rules — no network, no React. These are mirrored by the
// Edge Function (which is the real enforcement point); the copies here exist
// so the UI can disable buttons and explain *why* before making a round trip.
//
// Everything in this file is deterministic and unit-tested in
// src/lib/__tests__/rules.test.js.

export const REGEN_COOLDOWN_DAYS = 7

/**
 * The first-plan allowance: 3 revisions, spendable either way.
 *
 * A revision is a tweak (same plan, new wording) OR a full regeneration with
 * changed intake data. Both draw on one budget, and the 7-day cooldown does
 * not start until it is spent. Someone dialling in their very first plan
 * should not be told to come back next week.
 */
export const MAX_REVISIONS = 3
/** Kept as an alias: this budget used to cover tweaks only. */
export const MAX_REFINEMENTS = MAX_REVISIONS

// A plan left in 'generating' for longer than this had its worker killed
// mid-flight. Treat it as failed so the user is never stuck behind a spinner.
export const STALE_GENERATING_MS = 10 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** True when a 'generating' row is old enough to be considered dead. */
export function isPlanStale(plan, now = Date.now()) {
  if (!plan || plan.status !== 'generating') return false
  return now - new Date(plan.created_at).getTime() > STALE_GENERATING_MS
}

/**
 * The status the UI should act on, which is not always the stored status:
 * a stale 'generating' row is surfaced as 'error' so the user can retry.
 */
export function effectiveStatus(plan, now = Date.now()) {
  if (!plan) return 'none'
  return isPlanStale(plan, now) ? 'error' : plan.status
}

/** Revisions remaining against the first-plan allowance (never negative). */
export function revisionsLeft(plan) {
  if (!plan) return 0
  if (!plan.is_first_plan) return 0
  return Math.max(0, MAX_REVISIONS - (plan.refinements_used ?? 0))
}

/** Kept as an alias for the older name. */
export const refinementsLeft = revisionsLeft

/**
 * Is this user still inside the free first-plan window?
 *
 * While they are, they can regenerate as often as their remaining budget
 * allows without waiting out the cooldown.
 */
export function inFreeRevisionWindow(latestPlan, now = Date.now()) {
  return planGate(latestPlan, now).kind === 'free'
}

/**
 * The single answer to "can this person generate right now, and why not".
 *
 * ONE function, returning ONE of three mutually exclusive states. That
 * exclusivity is the whole point. The screen previously derived "changes
 * left" and "days to wait" from two separate pieces of state, which meant it
 * could — and did — render "You have 3 changes left, no waiting" directly
 * above "You can generate a fresh one in 3 days". Two states that must agree
 * will eventually disagree; one state cannot.
 *
 *   { kind: 'open' }                        — go ahead
 *   { kind: 'free', revisionsLeft: n }      — first-plan allowance, no wait
 *   { kind: 'cooldown', daysLeft: n }       — allowance spent, must wait
 */
export function planGate(latestPlan, now = Date.now()) {
  if (!latestPlan) return { kind: 'open' }

  // A failed or abandoned generation must never lock anyone out — the error
  // card invites them to try again, so trying again has to work.
  if (effectiveStatus(latestPlan, now) !== 'ready') return { kind: 'open' }

  // The first-plan allowance beats the cooldown. Someone still dialling in
  // their very first plan should never be told to come back next week.
  const left = revisionsLeft(latestPlan)
  if (left > 0) return { kind: 'free', revisionsLeft: left }

  const elapsedDays = (now - new Date(latestPlan.created_at).getTime()) / DAY_MS
  const daysLeft = Math.max(0, Math.ceil(REGEN_COOLDOWN_DAYS - elapsedDays))
  return daysLeft > 0 ? { kind: 'cooldown', daysLeft } : { kind: 'open' }
}

/** Whole days until the user may generate a fresh plan. Derived from the gate. */
export function daysUntilRegen(latestPlan, now = Date.now()) {
  const gate = planGate(latestPlan, now)
  return gate.kind === 'cooldown' ? gate.daysLeft : 0
}

/**
 * Refinements are first-plan-only, and only once it is actually ready.
 *
 * Legacy plans (stored HTML, no structured `data`) cannot be refined: there
 * is no JSON to hand back to the model. The server returns the same verdict.
 */
export function canRefine(plan, now = Date.now()) {
  if (!plan) return false
  if (!plan.is_first_plan) return false
  if (effectiveStatus(plan, now) !== 'ready') return false
  if (!plan.data) return false
  return revisionsLeft(plan) > 0
}

/** Human-readable "3 days" / "1 day". */
export function pluralDays(n) {
  return `${n} day${n === 1 ? '' : 's'}`
}

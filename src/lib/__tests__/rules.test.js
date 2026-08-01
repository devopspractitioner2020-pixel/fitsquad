import { describe, it, expect } from 'vitest'
import {
  REGEN_COOLDOWN_DAYS,
  MAX_REVISIONS,
  MAX_REFINEMENTS,
  STALE_GENERATING_MS,
  revisionsLeft,
  inFreeRevisionWindow,
  planGate,
  isPlanStale,
  effectiveStatus,
  daysUntilRegen,
  refinementsLeft,
  canRefine,
  pluralDays,
} from '../rules'

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0)
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString()
const minutesAgo = (n) => new Date(NOW - n * 60_000).toISOString()

const plan = (over = {}) => ({
  id: 'p1',
  status: 'ready',
  created_at: daysAgo(0),
  is_first_plan: true,
  refinements_used: 0,
  data: { hero: { name: 'Vic' }, week: [] },
  ...over,
})

// A plan the cooldown actually applies to: either a later plan, or a first
// plan whose 3 revisions are spent. The default fixture above is exempt.
const settled = (over = {}) => plan({ is_first_plan: false, ...over })

describe('isPlanStale', () => {
  it('is false for a plan that is not generating', () => {
    expect(isPlanStale(plan({ status: 'ready', created_at: daysAgo(30) }), NOW)).toBe(false)
    expect(isPlanStale(plan({ status: 'error', created_at: daysAgo(30) }), NOW)).toBe(false)
  })

  it('is false while a generation is still plausibly running', () => {
    expect(isPlanStale(plan({ status: 'generating', created_at: minutesAgo(2) }), NOW)).toBe(false)
  })

  it('is true once a generating row passes the stale window', () => {
    const justOver = new Date(NOW - STALE_GENERATING_MS - 1000).toISOString()
    expect(isPlanStale(plan({ status: 'generating', created_at: justOver }), NOW)).toBe(true)
  })

  it('handles a missing plan', () => {
    expect(isPlanStale(null, NOW)).toBe(false)
  })
})

describe('effectiveStatus', () => {
  it('reports "none" when there is no plan', () => {
    expect(effectiveStatus(null, NOW)).toBe('none')
  })

  it('passes through live statuses unchanged', () => {
    expect(effectiveStatus(plan({ status: 'ready' }), NOW)).toBe('ready')
    expect(effectiveStatus(plan({ status: 'error' }), NOW)).toBe('error')
    expect(effectiveStatus(plan({ status: 'generating', created_at: minutesAgo(1) }), NOW))
      .toBe('generating')
  })

  // Regression: a killed worker used to leave the row 'generating' forever,
  // so Me and PlanView polled a spinner that could never resolve.
  it('surfaces a long-dead generating row as an error so the user can retry', () => {
    expect(effectiveStatus(plan({ status: 'generating', created_at: minutesAgo(45) }), NOW))
      .toBe('error')
  })
})

describe('daysUntilRegen', () => {
  it('allows generation when the user has no plan yet', () => {
    expect(daysUntilRegen(null, NOW)).toBe(0)
  })

  it('blocks for the remainder of the cooldown after a successful plan', () => {
    expect(daysUntilRegen(settled({ created_at: daysAgo(0) }), NOW)).toBe(REGEN_COOLDOWN_DAYS)
    expect(daysUntilRegen(settled({ created_at: daysAgo(5) }), NOW)).toBe(2)
    expect(daysUntilRegen(settled({ created_at: daysAgo(6.5) }), NOW)).toBe(1)
  })

  it('unblocks exactly at the cooldown boundary', () => {
    expect(daysUntilRegen(settled({ created_at: daysAgo(7) }), NOW)).toBe(0)
    expect(daysUntilRegen(settled({ created_at: daysAgo(7.1) }), NOW)).toBe(0)
  })

  it('never returns a negative number for a very old plan', () => {
    expect(daysUntilRegen(settled({ created_at: daysAgo(400) }), NOW)).toBe(0)
  })

  // The first plan comes with 3 revisions and no waiting. Being told to come
  // back next week while still setting up your very first plan is the worst
  // possible moment for that message.
  it('does not apply while the first-plan allowance has room', () => {
    for (const used of [0, 1, 2]) {
      expect(daysUntilRegen(plan({ refinements_used: used }), NOW)).toBe(0)
    }
  })

  it('starts the cooldown once the allowance is spent', () => {
    expect(daysUntilRegen(plan({ refinements_used: MAX_REVISIONS }), NOW))
      .toBe(REGEN_COOLDOWN_DAYS)
  })

  // Regression: the cooldown used to be measured from *any* latest plan.
  // A failed generation therefore locked the user out for a week, while the
  // error card told them to "try again" — a dead end.
  it('does not start a cooldown from a failed plan', () => {
    expect(daysUntilRegen(settled({ status: 'error', created_at: daysAgo(0) }), NOW)).toBe(0)
  })

  // Same trap via the other door: a row abandoned in 'generating'.
  it('does not start a cooldown from an abandoned generation', () => {
    expect(daysUntilRegen(settled({ status: 'generating', created_at: minutesAgo(45) }), NOW)).toBe(0)
  })

  it('does not block while a generation is genuinely in flight', () => {
    // Not stale yet, so not 'ready' either -> no cooldown, the in-flight
    // guard on the server is what prevents a double submit.
    expect(daysUntilRegen(plan({ status: 'generating', created_at: minutesAgo(1) }), NOW)).toBe(0)
  })
})

describe('revisionsLeft', () => {
  it('counts down from the cap', () => {
    expect(revisionsLeft(plan({ refinements_used: 0 }))).toBe(MAX_REVISIONS)
    expect(revisionsLeft(plan({ refinements_used: 2 }))).toBe(1)
    expect(revisionsLeft(plan({ refinements_used: 3 }))).toBe(0)
  })

  it('never goes negative even if the counter overshoots', () => {
    expect(revisionsLeft(plan({ refinements_used: 9 }))).toBe(0)
  })

  it('treats a missing counter as unused', () => {
    expect(revisionsLeft(plan({ refinements_used: undefined }))).toBe(MAX_REVISIONS)
  })

  // The allowance belongs to the first plan only, or it would renew on every
  // regeneration and the cooldown would never begin.
  it('is zero on plans after the first', () => {
    expect(revisionsLeft(plan({ is_first_plan: false, refinements_used: 0 }))).toBe(0)
  })

  it('is still exported under the old name', () => {
    expect(refinementsLeft).toBe(revisionsLeft)
  })
})

describe('inFreeRevisionWindow', () => {
  it('is true for a ready first plan with budget left', () => {
    expect(inFreeRevisionWindow(plan(), NOW)).toBe(true)
  })

  it('is false once the budget is spent', () => {
    expect(inFreeRevisionWindow(plan({ refinements_used: MAX_REVISIONS }), NOW)).toBe(false)
  })

  it('is false for later plans and for plans that are not ready', () => {
    expect(inFreeRevisionWindow(plan({ is_first_plan: false }), NOW)).toBe(false)
    expect(inFreeRevisionWindow(plan({ status: 'error' }), NOW)).toBe(false)
    expect(inFreeRevisionWindow(null, NOW)).toBe(false)
  })
})

describe('canRefine', () => {
  it('allows refining a ready first plan with budget left', () => {
    expect(canRefine(plan(), NOW)).toBe(true)
  })

  it('refuses on plans after the first', () => {
    expect(canRefine(plan({ is_first_plan: false }), NOW)).toBe(false)
  })

  it('refuses once the cap is spent', () => {
    expect(canRefine(plan({ refinements_used: MAX_REFINEMENTS }), NOW)).toBe(false)
  })

  it('refuses while the plan is still generating or has errored', () => {
    expect(canRefine(plan({ status: 'generating', created_at: minutesAgo(1) }), NOW)).toBe(false)
    expect(canRefine(plan({ status: 'error' }), NOW)).toBe(false)
  })

  it('refuses when there is no plan', () => {
    expect(canRefine(null, NOW)).toBe(false)
  })

  // Plans made before the structured-output rewrite are stored as HTML with
  // no JSON to hand back to the model, so they cannot be refined. The server
  // returns the same verdict; this stops the button appearing at all.
  it('refuses on a legacy HTML-only plan', () => {
    expect(canRefine(plan({ data: undefined, html: '<!DOCTYPE html><p>old</p>' }), NOW)).toBe(false)
  })
})

describe('pluralDays', () => {
  it('uses the singular only for exactly one day', () => {
    expect(pluralDays(1)).toBe('1 day')
    expect(pluralDays(2)).toBe('2 days')
    // Regression: the old inline `n > 1 ? 's' : ''` rendered "0 day".
    expect(pluralDays(0)).toBe('0 days')
  })
})


// CRITICAL REGRESSION. The intake screen rendered "You have 3 changes left —
// no waiting" directly above "You can generate a fresh one in 3 days", with
// the button disabled. Two pieces of state that had to agree, kept
// separately, and a server rejection updated one of them.
//
// planGate returns ONE of three kinds, so the contradiction is now
// unrepresentable rather than merely avoided.
describe('planGate', () => {
  const ready = (over = {}) => plan({ ...over })

  it('is open when there is no plan at all', () => {
    expect(planGate(null, NOW)).toEqual({ kind: 'open' })
  })

  it('is free while the first-plan allowance has room', () => {
    expect(planGate(ready({ refinements_used: 0 }), NOW))
      .toEqual({ kind: 'free', revisionsLeft: 3 })
    expect(planGate(ready({ refinements_used: 2 }), NOW))
      .toEqual({ kind: 'free', revisionsLeft: 1 })
  })

  it('becomes a cooldown once the allowance is spent', () => {
    expect(planGate(ready({ refinements_used: MAX_REVISIONS }), NOW))
      .toEqual({ kind: 'cooldown', daysLeft: REGEN_COOLDOWN_DAYS })
  })

  it('is open again once the cooldown elapses', () => {
    expect(planGate(ready({ is_first_plan: false, created_at: daysAgo(8) }), NOW))
      .toEqual({ kind: 'open' })
  })

  it('is open after a failure, so "try again" actually works', () => {
    expect(planGate(ready({ status: 'error' }), NOW)).toEqual({ kind: 'open' })
    expect(planGate(ready({ status: 'generating', created_at: minutesAgo(45) }), NOW))
      .toEqual({ kind: 'open' })
  })

  // The property that makes the reported bug impossible.
  it('never reports free and cooldown at the same time', () => {
    const cases = []
    for (const isFirst of [true, false]) {
      for (const used of [0, 1, 2, 3]) {
        for (const age of [0, 2, 6.5, 7, 30]) {
          for (const status of ['ready', 'error', 'generating']) {
            cases.push(ready({
              is_first_plan: isFirst, refinements_used: used,
              created_at: daysAgo(age), status,
            }))
          }
        }
      }
    }

    for (const c of cases) {
      const gate = planGate(c, NOW)
      expect(['open', 'free', 'cooldown']).toContain(gate.kind)
      // A gate carries the field for its own kind and no other.
      if (gate.kind === 'free') {
        expect(gate.revisionsLeft).toBeGreaterThan(0)
        expect(gate.daysLeft).toBeUndefined()
      }
      if (gate.kind === 'cooldown') {
        expect(gate.daysLeft).toBeGreaterThan(0)
        expect(gate.revisionsLeft).toBeUndefined()
      }
    }
  })

  // Everything else is derived from the gate, so nothing can drift from it.
  it('agrees with daysUntilRegen and inFreeRevisionWindow by construction', () => {
    for (const used of [0, 1, 2, 3]) {
      for (const age of [0, 3, 8]) {
        for (const isFirst of [true, false]) {
          const c = ready({ refinements_used: used, created_at: daysAgo(age), is_first_plan: isFirst })
          const gate = planGate(c, NOW)

          expect(daysUntilRegen(c, NOW))
            .toBe(gate.kind === 'cooldown' ? gate.daysLeft : 0)
          expect(inFreeRevisionWindow(c, NOW)).toBe(gate.kind === 'free')

          // The exact impossible pair from the bug report.
          const showsFree = inFreeRevisionWindow(c, NOW)
          const showsCooldown = daysUntilRegen(c, NOW) > 0
          expect(showsFree && showsCooldown).toBe(false)
        }
      }
    }
  })

  it('never returns a cooldown of zero days, which would render as "0 days"', () => {
    for (const age of [7, 7.5, 100]) {
      const gate = planGate(ready({ is_first_plan: false, created_at: daysAgo(age) }), NOW)
      expect(gate.kind).toBe('open')
    }
  })
})

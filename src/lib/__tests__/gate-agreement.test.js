// The client gate and the server gate are two separate implementations of one
// rule. The client one (src/lib/rules.js) decides what the screen says; the
// server one (supabase/functions/generate-plan/logic.ts) decides what actually
// happens. When they disagree, the user is told one thing and handed another —
// which is exactly the "3 changes left" / "wait 3 days" bug.
//
// Each has its own unit suite. This file tests the thing neither can test
// alone: that for the same row they reach the same verdict.
import { describe, it, expect } from 'vitest'
import { planGate } from '../rules'
import { checkGenerateAllowed } from '../../../supabase/functions/generate-plan/logic.ts'

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0)
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString()
const minutesAgo = (n) => new Date(NOW - n * 60_000).toISOString()

const row = (over = {}) => ({
  id: 'p1',
  status: 'ready',
  created_at: daysAgo(0),
  is_first_plan: true,
  refinements_used: 0,
  data: { hero: { name: 'Vic' } },
  ...over,
})

// The client is handed the latest plan; the server is handed the history,
// newest first. One row is the same story told to both.
const verdicts = (plan) => ({
  client: planGate(plan, NOW),
  server: checkGenerateAllowed([plan], NOW),
})

describe('client and server agree on whether a plan can be generated', () => {
  const MATRIX = []
  for (const is_first_plan of [true, false]) {
    for (const refinements_used of [0, 1, 2, 3]) {
      for (const age of [0, 1, 3, 6.5, 7, 30]) {
        for (const status of ['ready', 'error']) {
          MATRIX.push(row({ is_first_plan, refinements_used, created_at: daysAgo(age), status }))
        }
      }
    }
  }

  it.each(MATRIX)(
    'first=$is_first_plan used=$refinements_used status=$status',
    (plan) => {
      const { client, server } = verdicts(plan)

      // A blocked client is a blocked server and vice versa.
      expect(server.ok).toBe(client.kind !== 'cooldown')

      // And when blocked, the same number of days — so the button label and
      // the error toast can never quote different waits.
      if (client.kind === 'cooldown') {
        expect(server.daysLeft).toBe(client.daysLeft)
        expect(server.status).toBe(429)
      }
    },
  )

  // The one place they legitimately differ: a generation already in flight.
  // The client opens the gate (the row is not 'ready', so nothing is being
  // regenerated yet as far as it knows) and the server refuses with a 409.
  // That is a race, not a contradiction — the user never sees two claims at
  // once, they see the request bounce with "already being generated".
  it('lets the server, and only the server, catch a generation in flight', () => {
    const { client, server } = verdicts(row({ status: 'generating', created_at: minutesAgo(1) }))
    expect(client.kind).toBe('open')
    expect(server).toMatchObject({ ok: false, status: 409 })
    expect(server.daysLeft).toBeUndefined()
  })

  // A worker that died mid-flight must not gate anyone forever.
  it('agrees that an abandoned generation is over', () => {
    const { client, server } = verdicts(row({ status: 'generating', created_at: minutesAgo(45) }))
    expect(client.kind).toBe('open')
    expect(server.ok).toBe(true)
  })
})

// The exact row from the report: a first plan, four days old, no changes
// spent. Both sides must let it through — this is the case that was being
// refused, and it was refused by a deployed function that predated the
// free-revision window, not by the rule below.
describe('a fresh first plan inside the cooldown window', () => {
  const first = row({ is_first_plan: true, refinements_used: 0, created_at: daysAgo(4) })

  it('is generatable on both sides despite being four days old', () => {
    const { client, server } = verdicts(first)
    expect(client).toEqual({ kind: 'free', revisionsLeft: 3 })
    expect(server).toMatchObject({ ok: true, isFirst: true, revisionsUsed: 1 })
  })

  // The allowance is finite: spending all three drops back to the wait, and
  // the wait is measured from the same timestamp.
  it('falls back to the cooldown once the three changes are spent', () => {
    const spent = { ...first, refinements_used: 3 }
    const { client, server } = verdicts(spent)
    expect(client).toEqual({ kind: 'cooldown', daysLeft: 3 })
    expect(server).toMatchObject({ ok: false, status: 429, daysLeft: 3 })
  })

  // A later plan never had the allowance, so the cooldown applies from day
  // one. This is the only shape that should ever produce the 3-day refusal.
  it('applies the cooldown from the start to a plan that is not the first', () => {
    const { client, server } = verdicts({ ...first, is_first_plan: false })
    expect(client).toEqual({ kind: 'cooldown', daysLeft: 3 })
    expect(server).toMatchObject({ ok: false, status: 429, daysLeft: 3 })
  })
})

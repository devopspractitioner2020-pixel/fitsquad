import { PLAN_TOOL_NAME, validatePlan } from './schema.ts'

// Pure decision logic for the generate-plan Edge Function.
//
// Deliberately free of Deno globals, network calls and remote imports so it
// can be unit-tested directly (see src/lib/__tests__/edge-logic.test.js).
// index.ts is the thin I/O shell around these functions; every rule that
// costs money or gates access is decided here.

/**
 * The first-plan allowance: 3 revisions, spendable either way.
 *
 * A revision is a tweak (same plan, new wording) or a full regeneration with
 * changed intake data. Both draw on one budget, and the 7-day cooldown does
 * not start until it is spent.
 */
export const MAX_REVISIONS = 3
export const MAX_REFINEMENTS = MAX_REVISIONS
export const REGEN_COOLDOWN_DAYS = 7
/** A 'generating' row older than this had its worker killed mid-flight. */
export const STALE_GENERATING_MS = 10 * 60 * 1000
/** Hard backstop on Claude spend, independent of the cooldown. */
export const MAX_PLANS_PER_DAY = 5
export const MAX_FIELD_CHARS = 2000
export const MAX_REQUEST_CHARS = 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** The only intake keys ever forwarded to the model. */
export const INTAKE_FIELDS = [
  'name', 'age', 'sex', 'height_cm', 'weight_kg', 'bodyfat_pct', 'goal_weight_kg',
  'goal', 'event', 'activity_level', 'training_freq', 'sport', 'steps',
  'health_notes', 'cuisines_dishes', 'loved_foods', 'disliked_foods',
  'alcohol', 'eating_out', 'home_pct', 'supplements',
] as const

export interface PlanRow {
  id: string
  status: 'generating' | 'ready' | 'error'
  created_at: string
  is_first_plan?: boolean
  refinements_used?: number
}

export type Decision =
  /**
   * `isFirst` marks the new plan as part of the first-plan chain, and
   * `revisionsUsed` is the budget counter carried onto the new row — that
   * carry-forward is what lets one allowance span several regenerations.
   */
  | { ok: true; isFirst: boolean; revisionsUsed: number }
  | { ok: false; status: number; error: string; planId?: string; daysLeft?: number }

/**
 * Whitelist + length-cap the intake before it reaches the prompt.
 *
 * Bounds token spend (a caller could otherwise POST megabytes of free text)
 * and stops unexpected keys being smuggled into the message. Returns null
 * when there is nothing worth sending to Claude.
 */
export function sanitizeIntake(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of INTAKE_FIELDS) {
    const v = src[key]
    if (v == null) continue
    if (typeof v !== 'string' && typeof v !== 'number') continue
    const s = String(v).trim()
    if (!s) continue
    out[key] = s.slice(0, MAX_FIELD_CHARS)
  }
  return Object.keys(out).length ? out : null
}

/**
 * Decide whether a user may start a new generation, given their recent plans
 * (newest first). This is the server-side counterpart to the client's
 * daysUntilRegen() — the client copy only disables a button, this one is the
 * actual limit.
 */
export function checkGenerateAllowed(history: PlanRow[], now: number = Date.now()): Decision {
  const plans = history ?? []

  // (a) One generation at a time. A stale row must not block forever.
  const inFlight = plans.find(
    (p) => p.status === 'generating' &&
      now - new Date(p.created_at).getTime() < STALE_GENERATING_MS,
  )
  if (inFlight) {
    return {
      ok: false, status: 409, planId: inFlight.id,
      error: 'A plan is already being generated. Give it a minute.',
    }
  }

  // (b) Daily backstop on Claude spend, counting every attempt.
  const dayAgo = now - DAY_MS
  const today = plans.filter((p) => new Date(p.created_at).getTime() > dayAgo).length
  if (today >= MAX_PLANS_PER_DAY) {
    return { ok: false, status: 429, error: 'Daily plan limit reached. Try again tomorrow.' }
  }

  const lastReady = plans.find((p) => p.status === 'ready')

  // No successful plan yet: this is the first one, with the full allowance.
  // A failed attempt must not burn any of it.
  if (!lastReady) return { ok: true, isFirst: true, revisionsUsed: 0 }

  // (c) The free first-plan window. While the allowance has room, a
  //     regeneration is one of the user's revisions and the cooldown does not
  //     apply — someone still dialling in their first plan should never be
  //     told to come back next week. The new row inherits the incremented
  //     counter, which is how one budget spans several rows.
  const used = lastReady.refinements_used ?? 0
  if (lastReady.is_first_plan && used < MAX_REVISIONS) {
    return { ok: true, isFirst: true, revisionsUsed: used + 1 }
  }

  // (d) Allowance spent: the 7-day cooldown, counted from the last plan that
  //     actually succeeded.
  const elapsed = (now - new Date(lastReady.created_at).getTime()) / DAY_MS
  if (elapsed < REGEN_COOLDOWN_DAYS) {
    const daysLeft = Math.ceil(REGEN_COOLDOWN_DAYS - elapsed)
    return {
      ok: false, status: 429, daysLeft,
      error: `You can generate a fresh plan in ${daysLeft} day${daysLeft > 1 ? 's' : ''}.`,
    }
  }

  return { ok: true, isFirst: false, revisionsUsed: 0 }
}

/** Guard for mode='refine'. Mirrors the checks in index.ts. */
export function checkRefineAllowed(
  plan: {
    is_first_plan?: boolean
    status?: string
    refinements_used?: number
    data?: unknown
    html?: string | null
  } | null,
  request: string,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!request || !request.trim()) {
    return { ok: false, status: 400, error: 'Describe what you would like changed.' }
  }
  if (request.length > MAX_REQUEST_CHARS) {
    return { ok: false, status: 400, error: 'That change request is too long.' }
  }
  if (!plan) return { ok: false, status: 404, error: 'Plan not found.' }
  if (!plan.is_first_plan) {
    return { ok: false, status: 403, error: 'Refinements apply to your first plan only.' }
  }
  if (plan.status !== 'ready') {
    return { ok: false, status: 409, error: 'This plan is not ready to refine yet.' }
  }
  if ((plan.refinements_used ?? 0) >= MAX_REVISIONS) {
    return { ok: false, status: 403, error: 'No changes left on this plan.' }
  }
  // Plans generated before the structured-output rewrite only have `html`.
  // There is no JSON to hand back to the model, so they cannot be refined —
  // regenerating is the path forward for those.
  if (!plan.data) {
    if (plan.html) {
      return {
        ok: false, status: 409,
        error: 'This plan was made with an older version of the app. Generate a fresh one to use tweaks.',
      }
    }
    return { ok: false, status: 409, error: 'This plan has no content to refine.' }
  }
  return { ok: true }
}

/**
 * Pull the structured plan out of a Claude Messages API response.
 *
 * The request forces `tool_choice` to the emit_plan tool, so a well-behaved
 * response contains exactly one tool_use block whose `input` already conforms
 * to PLAN_SCHEMA — the API validated it. This function handles the ways that
 * can still go wrong.
 *
 * Truncation is the important one: `stop_reason === 'max_tokens'` means the
 * tool input JSON was cut off mid-object. Storing that would give the user a
 * plan missing its last three days with nothing to indicate anything failed.
 */
export function extractPlan(data: {
  stop_reason?: string
  content?: Array<{ type?: string; name?: string; input?: unknown }>
}): Record<string, unknown> {
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('The plan came back truncated. Please try generating again.')
  }

  const blocks = data?.content ?? []
  const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === PLAN_TOOL_NAME)

  if (!toolUse) {
    // The model answered in prose instead of calling the tool. With
    // tool_choice forced this should not happen; if it does, a refusal is the
    // likeliest cause and there is nothing useful to store.
    throw new Error('The model did not return a structured plan. Please try again.')
  }

  const plan = toolUse.input
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('The model returned an empty plan. Please try again.')
  }

  const problems = validatePlan(plan)
  if (problems.length) {
    throw new Error(`The generated plan was incomplete: ${problems.slice(0, 3).join(' ')}`)
  }

  return plan as Record<string, unknown>
}

/** Resolve the CORS Allow-Origin value for a request. */
export function resolveAllowOrigin(origin: string, allowlist: string[]): string {
  if (!allowlist || allowlist.length === 0) return '*'
  return allowlist.includes(origin) ? origin : allowlist[0]
}

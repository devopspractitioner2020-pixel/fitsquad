import { supabase } from './supabase'

// Business rules live in rules.js (pure + unit-tested). Re-exported here so
// existing imports keep working.
export {
  REGEN_COOLDOWN_DAYS,
  MAX_REVISIONS,
  MAX_REFINEMENTS,
  STALE_GENERATING_MS,
  daysUntilRegen,
  planGate,
  effectiveStatus,
  isPlanStale,
  revisionsLeft,
  refinementsLeft,
  inFreeRevisionWindow,
  canRefine,
  pluralDays,
} from './rules'

/** Save the intake form without generating anything. */
export async function saveIntakeDraft(userId, data) {
  if (!userId) throw new Error('Not signed in.')
  const { error } = await supabase
    .from('intakes')
    .upsert({ user_id: userId, data }, { onConflict: 'user_id' })
  if (error) throw error
}

/**
 * The most recently saved intake draft.
 *
 * This table has been written on every save since day one and read by
 * nothing, which is why "Save intake" looked like it discarded the form —
 * the screen only ever pre-filled from `plans.intake`.
 */
export async function getIntakeDraft(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('intakes').select('data').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.data ?? null
}

// The Edge Function returns as soon as the 'generating' row exists and runs
// the Claude call as a background task, so this resolves in well under a
// second. The UI then polls the plan row for status.
//
// supabase-js puts non-2xx responses in `error` and swallows the JSON body,
// so we unwrap FunctionsHttpError to surface the server's own message
// ("You can generate a fresh plan in 3 days", "Daily plan limit reached", …).
async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('generate-plan', { body })
  if (error) throw await unwrapFunctionError(error)
  if (data?.error) throw new Error(data.error)
  return data
}

async function unwrapFunctionError(error) {
  try {
    const res = error?.context
    if (res && typeof res.json === 'function') {
      const body = await res.json()
      if (body?.error) {
        const e = new Error(body.error)
        e.status = res.status
        e.daysLeft = body.daysLeft
        e.planId = body.planId
        return e
      }
    }
  } catch {
    // fall through to the generic error below
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** Kick off plan generation. Resolves with { planId, status: 'generating' }. */
export async function generatePlan(intake) {
  return invoke({ mode: 'generate', intake })
}

/** Refine the first plan. The server enforces the 3-refinement cap. */
export async function refinePlan(planId, request) {
  return invoke({ mode: 'refine', planId, request })
}

/** Fetch the newest plan for the signed-in user. */
export async function getLatestPlan(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

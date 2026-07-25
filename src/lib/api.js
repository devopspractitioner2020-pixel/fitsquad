import { supabase } from './supabase'

// Business rules (kept in one place, also enforced server-side / via RLS).
export const REGEN_COOLDOWN_DAYS = 7
export const MAX_REFINEMENTS = 3

// Kick off plan generation. This calls the Edge Function, which:
//  1) inserts a plan row with status='generating'
//  2) calls the Claude API (key lives server-side)
//  3) writes the returned HTML back with status='ready'
// We invoke it and return immediately; the UI polls the plan row for status.
export async function generatePlan(intake) {
  const { data, error } = await supabase.functions.invoke('generate-plan', {
    body: { mode: 'generate', intake },
  })
  if (error) throw error
  return data // { planId }
}

// Refine the current (first) plan. Server enforces the 3-refinement cap.
export async function refinePlan(planId, request) {
  const { data, error } = await supabase.functions.invoke('generate-plan', {
    body: { mode: 'refine', planId, request },
  })
  if (error) throw error
  return data // { planId }
}

// Fetch the newest plan for the signed-in user.
export async function getLatestPlan(userId) {
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

// Whether the user may regenerate yet (7-day cooldown from last plan).
export function daysUntilRegen(latestPlan) {
  if (!latestPlan) return 0
  const last = new Date(latestPlan.created_at).getTime()
  const elapsedDays = (Date.now() - last) / (1000 * 60 * 60 * 24)
  return Math.max(0, Math.ceil(REGEN_COOLDOWN_DAYS - elapsedDays))
}

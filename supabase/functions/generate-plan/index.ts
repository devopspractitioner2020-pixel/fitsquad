// Supabase Edge Function: generate-plan
// ---------------------------------------------------------------
// This runs on Supabase's servers (Deno). It is the ONLY place the
// Anthropic API key exists. The browser never sees it.
//
// Flow:
//   mode='generate'  -> validate + rate-limit, create a 'generating' plan
//                       row, return IMMEDIATELY, then call Claude in a
//                       background task and flip the row to 'ready'/'error'.
//   mode='refine'    -> same shape; takes the plan's JSON + a change request.
//                       Enforces the 3-refinement cap on the first plan.
//
// Two things are worth understanding before editing this file.
//
// 1. WHY BACKGROUND TASKS. A plan takes 20-60s to generate. Holding the HTTP
//    response open that long burns the function's wall-clock budget (150s
//    free / 400s paid) and dies against proxy idle timeouts, which left plan
//    rows stuck in 'generating' forever. EdgeRuntime.waitUntil lets us answer
//    the browser in ~200ms and finish the work after the response. This needs
//    `policy = "per_worker"` in supabase/config.toml to work locally.
//
// 2. WHY STRUCTURED OUTPUT. The model returns a JSON plan via a forced tool
//    call, not an HTML document. The app renders it with its own design
//    system, and the calorie maths is done here in code from the inputs the
//    model chose. See prompt.ts and nutrition.ts for the reasoning.
//
// All the decision logic lives in ./logic.ts so it can be unit-tested without
// a Deno runtime. This file is the I/O shell.
//
// Secrets required (set with `supabase secrets set`):
//   ANTHROPIC_API_KEY          your Claude/Anthropic key
//   ANTHROPIC_MODEL            optional override; defaults below
//   ALLOWED_ORIGINS            comma-separated site origins (recommended)
//   SUPABASE_URL               (auto-provided in the function runtime)
//   SUPABASE_ANON_KEY          (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-provided; bypasses RLS to write plans)
// ---------------------------------------------------------------

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SYSTEM_GENERATE, SYSTEM_REFINE, buildUserMessage, buildRefineMessage,
} from './prompt.ts'
import { PLAN_TOOL_NAME, PLAN_SCHEMA } from './schema.ts'
import { computeNutrition, type NutritionInputs } from './nutrition.ts'
import {
  sanitizeIntake, checkGenerateAllowed, checkRefineAllowed,
  extractPlan, resolveAllowOrigin, type PlanRow,
} from './logic.ts'

// Model IDs are exact strings — never guess or construct them.
// claude-sonnet-5: 1M context, 128k max output, adaptive thinking.
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5'
// Structured output is far more compact than the HTML it replaced — a full
// plan lands around 4-6k tokens rather than 12-15k.
const MAX_TOKENS = 12000
const CLAUDE_TIMEOUT_MS = 120_000

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function corsFor(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveAllowOrigin(req.headers.get('Origin') ?? '', ALLOWED_ORIGINS),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req) => {
  const cors = corsFor(req)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return json({ error: 'Server is missing ANTHROPIC_API_KEY.' }, 500)

    // Client bound to the caller's JWT — used only to identify the user.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not signed in.' }, 401)

    // Admin client — bypasses RLS to write plan rows safely.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Malformed request body.' }, 400)
    }

    // ---------------------------------------------------------------
    // GENERATE
    // ---------------------------------------------------------------
    if (body.mode === 'generate') {
      const intake = sanitizeIntake(body.intake)
      if (!intake) return json({ error: 'Missing or invalid intake data.' }, 400)

      const { data: history, error: histErr } = await admin
        .from('plans')
        .select('id,status,created_at,is_first_plan,refinements_used')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (histErr) throw histErr

      const decision = checkGenerateAllowed((history ?? []) as PlanRow[])
      if (!decision.ok) {
        const { status, ...rest } = decision
        return json(rest, status)
      }

      // revisionsUsed carries the first-plan allowance onto the new row, so
      // one budget of 3 spans however many regenerations the user makes.
      const { data: row, error: insErr } = await admin.from('plans').insert({
        user_id: user.id, status: 'generating', intake,
        is_first_plan: decision.isFirst,
        refinements_used: decision.revisionsUsed,
      }).select('id').single()
      if (insErr) throw insErr

      // Answer now; finish the Claude call after the response is sent.
      EdgeRuntime.waitUntil(runClaude({
        admin, planId: row.id, apiKey: anthropicKey,
        system: SYSTEM_GENERATE, userMessage: buildUserMessage(intake),
      }))
      return json({ planId: row.id, status: 'generating' }, 202)
    }

    // ---------------------------------------------------------------
    // REFINE
    // ---------------------------------------------------------------
    if (body.mode === 'refine') {
      const planId = typeof body.planId === 'string' ? body.planId : null
      const request = typeof body.request === 'string' ? body.request.trim() : ''
      if (!planId) return json({ error: 'Missing planId.' }, 400)

      // Ownership: the user_id filter means another user's planId returns
      // nothing, which checkRefineAllowed reports as a plain 404.
      const { data: plan } = await admin
        .from('plans').select('*').eq('id', planId).eq('user_id', user.id).maybeSingle()

      const decision = checkRefineAllowed(plan, request)
      if (!decision.ok) return json({ error: decision.error }, decision.status)

      await admin.from('plans')
        .update({ status: 'generating', error_message: null }).eq('id', plan.id)

      EdgeRuntime.waitUntil(runClaude({
        admin, planId: plan.id, apiKey: anthropicKey,
        system: SYSTEM_REFINE,
        userMessage: buildRefineMessage(plan.data, request),
        bumpRefinements: (plan.refinements_used ?? 0) + 1,
      }))
      return json({ planId: plan.id, status: 'generating' }, 202)
    }

    return json({ error: 'Unknown mode.' }, 400)
  } catch (e) {
    console.error('generate-plan failed:', e)
    // Never leak internals to the browser.
    return json({ error: 'Something went wrong on our side.' }, 500)
  }
})

// ---------------------------------------------------------------
// Background worker: calls Claude, computes the numbers, stores the plan.
// Always resolves — an unhandled rejection would kill the worker before the
// row is updated, recreating the stuck-'generating' bug.
// ---------------------------------------------------------------
async function runClaude(opts: {
  admin: SupabaseClient
  planId: string
  apiKey: string
  system: string
  userMessage: string
  bumpRefinements?: number
}): Promise<void> {
  const { admin, planId, apiKey, system, userMessage, bumpRefinements } = opts
  try {
    const plan = await callClaude(apiKey, system, userMessage)

    // The model supplied the inputs; the arithmetic happens here, exactly.
    const numbers = computeNutrition(plan.nutrition_inputs as NutritionInputs)
    const data = { ...plan, numbers, generated_at: new Date().toISOString() }

    const patch: Record<string, unknown> = { status: 'ready', data, error_message: null }
    if (bumpRefinements != null) patch.refinements_used = bumpRefinements
    await admin.from('plans').update(patch).eq('id', planId)
  } catch (e) {
    console.error('plan generation failed', planId, e)
    await admin.from('plans').update({
      status: 'error',
      error_message: String((e as Error)?.message ?? e).slice(0, 500),
    }).eq('id', planId)
  }
}

async function callClaude(
  apiKey: string, system: string, userMessage: string,
): Promise<Record<string, unknown>> {
  // Give up before the function's wall-clock budget does.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), CLAUDE_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: userMessage }],
        // Forcing the tool call is what makes the response shape a guarantee
        // rather than a hope — the API validates `input` against the schema.
        tools: [{
          name: PLAN_TOOL_NAME,
          description: 'Emit the complete personalized fitness and nutrition plan.',
          input_schema: PLAN_SCHEMA,
        }],
        tool_choice: { type: 'tool', name: PLAN_TOOL_NAME },
      }),
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('Claude took too long to respond.')
    throw e
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 300)}`)
  }
  return extractPlan(await res.json())
}

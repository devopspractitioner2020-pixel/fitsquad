// Supabase Edge Function: generate-plan
// ---------------------------------------------------------------
// This runs on Supabase's servers (Deno). It is the ONLY place the
// Anthropic API key exists. The browser never sees it.
//
// Flow:
//   mode='generate'  -> create a 'generating' plan row, call Claude,
//                       write the HTML back as 'ready' (or 'error').
//   mode='refine'    -> take the newest plan's HTML + a change request,
//                       call Claude, replace the HTML. Enforces the
//                       3-refinement cap on the first plan.
//
// Secrets required (set with `supabase secrets set`):
//   ANTHROPIC_API_KEY          your Claude/Anthropic key
//   SUPABASE_URL               (auto-provided in the function runtime)
//   SUPABASE_SERVICE_ROLE_KEY  service role (bypasses RLS to write plans)
// ---------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SYSTEM_GENERATE, SYSTEM_REFINE, buildUserMessage } from './prompt.ts'

const MODEL = 'claude-sonnet-5'
const MAX_REFINEMENTS = 3

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('Server is missing ANTHROPIC_API_KEY.')

    // Client bound to the caller's JWT — used to identify the user.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not signed in.' }, 401)

    // Admin client — bypasses RLS to write plan rows safely.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { mode, intake, planId, request } = await req.json()

    if (mode === 'generate') {
      // Is this the user's very first plan? (controls refinement eligibility)
      const { count } = await admin
        .from('plans').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      const isFirst = (count ?? 0) === 0

      // 1) Insert a 'generating' row so the UI can show the spinner immediately.
      const { data: row, error: insErr } = await admin.from('plans').insert({
        user_id: user.id, status: 'generating', intake, is_first_plan: isFirst,
      }).select('id').single()
      if (insErr) throw insErr

      // 2) Call Claude. (Runs within the function invocation.)
      try {
        const html = await callClaude(anthropicKey, SYSTEM_GENERATE, buildUserMessage(intake))
        await admin.from('plans').update({ status: 'ready', html }).eq('id', row.id)
        return json({ planId: row.id, status: 'ready' })
      } catch (e) {
        await admin.from('plans').update({ status: 'error', error_message: String(e?.message ?? e) }).eq('id', row.id)
        return json({ planId: row.id, status: 'error', error: String(e?.message ?? e) }, 200)
      }
    }

    if (mode === 'refine') {
      const { data: plan } = await admin.from('plans').select('*').eq('id', planId).eq('user_id', user.id).single()
      if (!plan) return json({ error: 'Plan not found.' }, 404)
      if (!plan.is_first_plan) return json({ error: 'Refinements apply to your first plan only.' }, 403)
      if ((plan.refinements_used ?? 0) >= MAX_REFINEMENTS) return json({ error: 'No refinements left.' }, 403)

      await admin.from('plans').update({ status: 'generating' }).eq('id', plan.id)
      try {
        const userMsg = `Here is the current plan (full HTML):\n\n${plan.html}\n\nThe user's change request:\n"${request}"\n\nReturn the complete updated HTML.`
        const html = await callClaude(anthropicKey, SYSTEM_REFINE, userMsg)
        await admin.from('plans').update({
          status: 'ready', html, refinements_used: (plan.refinements_used ?? 0) + 1,
        }).eq('id', plan.id)
        return json({ planId: plan.id, status: 'ready' })
      } catch (e) {
        await admin.from('plans').update({ status: 'error', error_message: String(e?.message ?? e) }).eq('id', plan.id)
        return json({ planId: plan.id, status: 'error', error: String(e?.message ?? e) }, 200)
      }
    }

    return json({ error: 'Unknown mode.' }, 400)
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

async function callClaude(apiKey: string, system: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 300)}`)
  }
  const data = await res.json()
  const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  const start = text.indexOf('<!DOCTYPE')
  return start >= 0 ? text.slice(start) : text // strip any stray preamble
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

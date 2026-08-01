#!/usr/bin/env node
/**
 * Give one existing account a weigh-in history, so the weight chart has
 * something to draw.
 *
 * seed.mjs builds a whole demo squad and is meant for a throwaway project.
 * This does one thing to one account you name — useful when you want YOUR
 * login to have a chart, without four fake squad-mates appearing in your feed.
 *
 *   export SUPABASE_URL=https://YOUR_REF.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Settings → API Keys
 *
 *   node scripts/seed-weights.mjs --email you@example.com
 *   node scripts/seed-weights.mjs --email you@example.com --weeks 30
 *   node scripts/seed-weights.mjs --email you@example.com --replace
 *
 * Flags:
 *   --email    required; the account to write to. Must already exist.
 *   --weeks    how far back to go. Default 17 — more weeks than fit on one
 *              screen, which is the point if you are checking the scrolling.
 *   --start    starting weight in kg (default 86.4)
 *   --target   where the trend is heading (default 79.5)
 *   --replace  delete this account's existing weigh-ins first
 *
 * Needs the SERVICE ROLE key: it looks up a user by email and writes rows on
 * their behalf, both of which bypass Row Level Security. Never put that key
 * in .env — Vite inlines .env into the browser bundle. Never run this against
 * a project with real users' data in it.
 */

import { createClient } from '@supabase/supabase-js'
import { rng, weightSeries } from './weight-series.mjs'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const arg = (name, fallback = undefined) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)

const email = arg('email')
const weeks = Number(arg('weeks', 17))
const start = Number(arg('start', 86.4))
const target = Number(arg('target', 79.5))

if (!URL || !KEY || !email) {
  console.error(`
Usage:

  export SUPABASE_URL=https://YOUR_REF.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  node scripts/seed-weights.mjs --email you@example.com [--weeks 17] [--replace]

Both variables and --email are required. Find the keys under
Project Settings → API Keys; use service_role / sb_secret, not the
publishable one.
`)
  process.exit(1)
}

if (!Number.isFinite(weeks) || weeks < 1 || weeks > 104) {
  console.error('\n--weeks must be between 1 and 104.\n')
  process.exit(1)
}
if (!Number.isFinite(start) || !Number.isFinite(target)) {
  console.error('\n--start and --target must be numbers.\n')
  process.exit(1)
}

const db = createClient(URL, KEY, { auth: { persistSession: false } })

async function main() {
  console.log(`\nSeeding weigh-ins on ${URL}\n`)

  const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) throw new Error(`listing users: ${listErr.message}`)

  const user = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) {
    // Creating the account here would be the wrong favour: you would end up
    // with an account whose password you do not know.
    throw new Error(`no account with email ${email}. Sign up in the app first, then re-run this.`)
  }

  if (flag('replace')) {
    const { error } = await db.from('weigh_ins').delete().eq('user_id', user.id)
    if (error) throw new Error(`clearing weigh-ins: ${error.message}`)
    console.log('  · cleared existing weigh-ins')
  } else {
    const { count } = await db
      .from('weigh_ins').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    if (count) {
      console.log(`  · note: ${count} weigh-in${count === 1 ? '' : 's'} already there; adding to them.`)
      console.log('    Re-run with --replace for a clean history.')
    }
  }

  const rows = weightSeries({
    start, target, days: weeks * 7, keen: 1, rnd: rng(20260801),
  }).map((w) => ({ ...w, user_id: user.id, note: null }))

  const { error } = await db.from('weigh_ins').insert(rows)
  if (error) throw new Error(`inserting weigh-ins: ${error.message}`)

  const kgs = rows.map((r) => r.weight_kg)
  console.log(`  · ${rows.length} weigh-ins across ${weeks} weeks for ${email}`)
  console.log(`  · ${kgs[0]} kg → ${kgs[kgs.length - 1]} kg, with one week deliberately left empty`)
  console.log('\nOpen Me. The chart shows one point per week — the average of that week.\n')
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}\n`)
  process.exit(1)
})

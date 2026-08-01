#!/usr/bin/env node
/**
 * Seed a Fit Squad project with a realistic demo squad.
 *
 * Creates test@example.com plus three squad-mates, all in one squad, with
 * ~8 weeks of weigh-ins, meals, workouts and tips, and a finished FitPlan
 * for the test user. Enough history that the feed, the weight chart, the
 * badges and the leaderboard all have something to show.
 *
 *   node scripts/seed.mjs                 # create / top up
 *   node scripts/seed.mjs --reset         # wipe seeded data first
 *
 * Needs the SERVICE ROLE key, because it creates auth users and writes rows
 * on their behalf. That key bypasses Row Level Security entirely, so:
 *   - never put it in .env (which Vite inlines into the browser bundle)
 *   - never run this against a project with real users in it
 *
 * Read it from the environment instead:
 *
 *   export SUPABASE_URL=https://YOUR_REF.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...        # Settings → API Keys
 *   node scripts/seed.mjs
 */

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESET = process.argv.includes('--reset')

if (!URL || !KEY) {
  console.error(`
Missing credentials.

  export SUPABASE_URL=https://YOUR_REF.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  node scripts/seed.mjs

Find both under Project Settings → API / API Keys. Use the service_role or
sb_secret key, NOT the publishable one — this script has to create users.
`)
  process.exit(1)
}

const db = createClient(URL, KEY, { auth: { persistSession: false } })

const PASSWORD = 'fitsquad123'
const SQUAD_NAME = 'The Test Squad'

const PEOPLE = [
  { email: 'test@example.com', name: 'Test User', start: 86.4, target: 79.5, keen: 1.0 },
  { email: 'maria@example.com', name: 'María', start: 68.2, target: 64.0, keen: 0.85 },
  { email: 'diego@example.com', name: 'Diego', start: 94.0, target: 88.0, keen: 0.6 },
  { email: 'sam@example.com', name: 'Sam', start: 72.5, target: 72.0, keen: 0.35 },
]

const WORKOUTS = [
  ['Push day', 52], ['Pull day + abs', 48], ['Leg day', 61], ['Full body', 45],
  ['Football match', 90], ['Morning run', 32], ['Swim', 40], ['Upper body', 55],
]

const MEALS = [
  ['Grilled chicken salad', 'Lunch', true], ['Lomo saltado, half rice', 'Dinner', true],
  ['Oats, banana and peanut butter', 'Breakfast', true], ['Ceviche', 'Lunch', true],
  ['Salmon, potatoes and greens', 'Dinner', true], ['Lentil stew', 'Lunch', true],
  ['Scrambled eggs on toast', 'Breakfast', true], ['Pasta with tuna', 'Dinner', true],
  ['Greek salad and bread', 'Lunch', true], ['Chicken wrap', 'Lunch', true],
  ['Pizza with the lads', 'Dinner', false], ['Burger and fries', 'Dinner', false],
  ['Birthday cake', 'Snack', false], ['Three beers', 'Snack', false],
]

const TIPS = [
  { title: 'Prep chicken on Sunday and the week cooks itself. 20 min, four lunches sorted.' },
  { title: 'Weigh yourself daily but only look at the weekly average — daily noise is water, not fat.' },
  {
    title: 'Best cue I have found for squat depth. Fixed my form in one session.',
    video_url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  },
  {
    title: 'Two-minute high-protein breakfast, no cooking. Genuinely good.',
    video_url: 'https://www.tiktok.com/@fitsquaddemo/video/7300000000000000001',
  },
  {
    title: 'Stretch routine for after leg day — my knees stopped complaining.',
    video_url: 'https://www.instagram.com/reel/CxAbCdEfGhI/',
  },
]

const DAYS = 56 // eight weeks of history
const day = (n) => new Date(Date.now() - n * 864e5).toISOString()

// Deterministic PRNG so re-running produces the same demo squad rather than
// a different-looking one every time.
let seed = 20260727
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

async function ensureUser({ email, name }) {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 })
  const existing = list?.users?.find((u) => u.email === email)
  if (existing) {
    console.log(`  · ${email} already exists`)
    return existing.id
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name },
  })
  if (error) throw new Error(`creating ${email}: ${error.message}`)
  console.log(`  · created ${email}`)
  return data.user.id
}

/**
 * A weight series that looks like a real person: a downward trend with daily
 * noise, the odd plateau, and a small bump after a heavy weekend. A clean
 * straight line would make the chart look fake and hide any rendering bug in
 * the shape of the data.
 */
function weightSeries(start, target, keen) {
  const out = []
  let w = start
  const perDay = ((start - target) / DAYS) * keen
  for (let d = DAYS; d >= 0; d -= 1) {
    if (d % 7 === 0 || rnd() < 0.45) {
      const plateau = d > 20 && d < 30 ? 0.25 : 1
      const weekendBump = d % 7 === 6 ? 0.35 : 0
      w = w - perDay * plateau + (rnd() - 0.5) * 0.45 + weekendBump
      out.push({ created_at: day(d), weight_kg: +w.toFixed(1) })
    }
  }
  return out
}

async function seedPerson(userId, person) {
  const posts = []
  const weighs = weightSeries(person.start, person.target, person.keen)
    .map((w) => ({ ...w, user_id: userId, note: null }))

  for (let d = DAYS; d >= 0; d -= 1) {
    if (rnd() < 0.42 * person.keen) {
      const [title, minutes] = pick(WORKOUTS)
      posts.push({
        user_id: userId, author_name: person.name, kind: 'workout',
        title, minutes, created_at: day(d),
        note: rnd() < 0.3 ? pick(['Felt strong.', 'Tough one.', 'PB on the last set.']) : null,
      })
    }
    if (rnd() < 0.55 * person.keen) {
      const [title, meal_type, healthy] = pick(MEALS)
      posts.push({
        user_id: userId, author_name: person.name, kind: 'meal',
        title, meal_type, is_cheat: !healthy, is_healthy: healthy,
        created_at: day(d), note: null,
      })
    }
  }

  // Tips are rarer, and only the test user posts the ones with videos so the
  // embeds are easy to find in the feed.
  const tips = person.email === 'test@example.com' ? TIPS : TIPS.slice(0, 2)
  tips.forEach((t, i) => {
    posts.push({
      user_id: userId, author_name: person.name, kind: 'tip',
      title: t.title, video_url: t.video_url ?? null,
      created_at: day(2 + i * 5), note: null,
    })
  })

  const { error: pErr } = await db.from('posts').insert(posts)
  if (pErr) throw new Error(`posts for ${person.email}: ${pErr.message}`)
  const { error: wErr } = await db.from('weigh_ins').insert(weighs)
  if (wErr) throw new Error(`weigh-ins for ${person.email}: ${wErr.message}`)

  console.log(`  · ${person.name}: ${posts.length} posts, ${weighs.length} weigh-ins`)
}

/** A finished plan for the test user, in the structured shape the app renders. */
function demoPlan(name) {
  const meals = [
    ['Monday', 'training', 'Oats with banana', 'Lomo saltado, half rice', 'Grilled salmon and greens'],
    ['Tuesday', 'oily-fish', 'Scrambled eggs on toast', 'Chicken and quinoa salad', 'Sardines, potatoes, salad'],
    ['Wednesday', 'training', 'Greek yoghurt and berries', 'Leftover lomo saltado', 'Pasta with tuna and tomato'],
    ['Wednesday', 'legumes', 'Oats with banana', 'Lentil stew with bread', 'Chicken stir-fry with rice'],
    ['Friday', 'social', 'Eggs and avocado toast', 'Chicken wrap', 'Pizza out — enjoy it, no guilt'],
    ['Saturday', 'sport', 'Oats and coffee', 'Ceviche with sweet potato', 'Roast chicken and vegetables'],
    ['Sunday', 'rest', 'Big eggs breakfast', 'Sunday roast, normal portion', 'Soup and bread'],
  ]
  return {
    language: 'en',
    hero: {
      name,
      goal_label: 'Lose fat, keep the strength',
      target_event: 'summer, about 3 months away',
      headline: 'You are already training three times a week — this plan changes what is on the plate, not how hard you work.',
    },
    numbers: {
      formula: 'mifflin-st-jeor', formula_label: 'Mifflin-St Jeor', lean_body_mass_kg: null,
      bmr: 1834, activity_multiplier: 1.55, tdee: 2843,
      goal_adjustment_kcal: -400, target_kcal: 2443,
      protein_g: 155, fat_g: 69, carbs_g: 293,
      protein_g_per_kg: 1.8, fat_g_per_kg: 0.8, adjustments: [],
    },
    numbers_explainer: 'That target leaves you a comfortable deficit without touching the food you actually like. Protein is the number to hit first; the rest has room to move.',
    myths: [{
      title: 'Bread is not the problem',
      correction: 'Bread is not inherently fattening. Portion size across the whole day is what decides the outcome, and bread has stayed in this plan for that reason.',
    }],
    plate: {
      veg_examples: ['salad', 'broccoli', 'roasted peppers'],
      protein_examples: ['chicken', 'salmon', 'eggs', 'lentils'],
      carb_examples: ['rice', 'potatoes', 'bread', 'pasta'],
      hand_cues: ['A palm of protein per meal', 'A cupped hand of carbs', 'Half the plate vegetables'],
    },
    week: meals.map(([d, tag, breakfast, lunch, dinner]) => ({
      day: d, tags: [tag], breakfast, lunch, dinner,
      snack: 'Fruit and a handful of nuts',
    })),
    weekly_targets: ['Oily fish twice', 'Legumes three times', '8,000+ steps most days'],
    training: {
      split: [
        { day: 'Monday', focus: 'Push', exercises: [
          { name: 'Bench press', sets: 4, reps: '6-10', note: 'Control the descent' },
          { name: 'Overhead press', sets: 3, reps: '8-12' },
          { name: 'Dips', sets: 3, reps: '8-12' },
        ] },
        { day: 'Wednesday', focus: 'Pull + abs', exercises: [
          { name: 'Barbell row', sets: 4, reps: '6-10' },
          { name: 'Pull-ups', sets: 3, reps: '6-10' },
          { name: 'Plank', sets: 3, reps: '45s' },
        ] },
        { day: 'Friday', focus: 'Legs + abs', exercises: [
          { name: 'Squat', sets: 4, reps: '6-10' },
          { name: 'Romanian deadlift', sets: 3, reps: '8-10' },
          { name: 'Hanging leg raise', sets: 3, reps: '10-15' },
        ] },
      ],
      progression_note: 'When you hit the top of the rep range on every set, add the smallest available weight next session.',
      cardio_note: 'Saturday football already covers your cardio. Add walking on rest days rather than more sessions.',
    },
    supplements: [
      { name: 'Omega 3', verdict: 'keep', rationale: 'Reasonable if you are not eating oily fish twice a week. This plan gets you there anyway, so it is a backstop rather than a necessity.' },
      { name: 'Magnesium', verdict: 'optional', rationale: 'Harmless. If you sleep well without it, it is not doing much.' },
    ],
    tracking: [
      'Weigh in daily, judge by the weekly average.',
      'Photos every two weeks in the same light.',
      'Log your gym numbers — strength holding while weight falls is the goal.',
      'Waist measurement once a month.',
    ],
    disclaimer: 'This is general nutrition and training information, not medical advice. If you have a health condition or take medication, talk to a doctor before making changes.',
    generated_at: day(9),
  }
}

async function main() {
  console.log(`\nSeeding ${URL}\n`)

  if (RESET) {
    console.log('Resetting seeded data…')
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 })
    const ids = (list?.users ?? [])
      .filter((u) => PEOPLE.some((p) => p.email === u.email))
      .map((u) => u.id)
    for (const id of ids) {
      await db.from('posts').delete().eq('user_id', id)
      await db.from('weigh_ins').delete().eq('user_id', id)
      await db.from('plans').delete().eq('user_id', id)
      await db.from('intakes').delete().eq('user_id', id)
    }
    console.log(`  · cleared data for ${ids.length} seeded users\n`)
  }

  console.log('Users:')
  const ids = {}
  for (const p of PEOPLE) ids[p.email] = await ensureUser(p)

  // Everyone into one squad. The signup trigger gives each new user their own
  // squad; this moves the other three into the test user's so the feed and
  // leaderboard have company.
  console.log('\nSquad:')
  const hostId = ids['test@example.com']
  const { data: hostSquads } = await db
    .from('squad_members').select('squad_id, squads(name, join_code)')
    .eq('user_id', hostId).limit(1)

  let squadId = hostSquads?.[0]?.squad_id
  if (!squadId) {
    const { data: s, error } = await db.from('squads')
      .insert({ name: SQUAD_NAME, join_code: 'DEMO01', created_by: hostId })
      .select().single()
    if (error) throw new Error(`creating squad: ${error.message}`)
    squadId = s.id
    await db.from('squad_members').insert({ squad_id: squadId, user_id: hostId, role: 'owner' })
  }
  await db.from('squads').update({ name: SQUAD_NAME }).eq('id', squadId)

  for (const p of PEOPLE.slice(1)) {
    // Drop the solo squad they were given at signup, then join the demo one.
    await db.from('squad_members').delete().eq('user_id', ids[p.email])
    await db.from('squad_members').insert({ squad_id: squadId, user_id: ids[p.email], role: 'member' })
  }
  const { data: squad } = await db.from('squads').select('name, join_code').eq('id', squadId).single()
  console.log(`  · ${squad.name} — join code ${squad.join_code}, ${PEOPLE.length} members`)

  console.log('\nHistory:')
  for (const p of PEOPLE) await seedPerson(ids[p.email], p)

  console.log('\nFitPlan:')
  await db.from('plans').delete().eq('user_id', hostId)
  const { error: planErr } = await db.from('plans').insert({
    user_id: hostId, status: 'ready', is_first_plan: true, refinements_used: 1,
    created_at: day(9), data: demoPlan('Test User'),
    intake: {
      name: 'Test User', age: '34', sex: 'Male', height_cm: '178', weight_kg: '82',
      goal: 'Lose fat', event: 'summer, about 3 months away',
      activity_level: 'Moderate — active job or regular training',
      training_freq: '3 times a week gym', sport: 'Football on Saturdays', steps: '8000',
      cuisines_dishes: 'Peruvian, and pasta/Italian at home',
      loved_foods: 'Bread, rice, potatoes, chicken, fish',
      disliked_foods: 'Greek yogurt',
      alcohol: '3 beers a week', eating_out: 'One restaurant dinner a week',
      home_pct: '70', supplements: 'Omega 3, magnesium',
    },
  })
  if (planErr) throw new Error(`plan: ${planErr.message}`)
  console.log('  · ready plan for Test User (2 of 3 changes left)')

  console.log(`
Done.

  Sign in as   test@example.com
  Password     ${PASSWORD}
  Join code    ${squad.join_code}

The test user has a finished plan with 2 changes left, so you can exercise
the tweak and regenerate paths without waiting out a cooldown.
`)
}

main().catch((e) => {
  console.error(`\nSeed failed: ${e.message}\n`)
  process.exit(1)
})

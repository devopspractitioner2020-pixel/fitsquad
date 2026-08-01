// The prompt is the product here — if a field silently stops reaching Claude,
// plans quietly get worse and nothing fails. These tests pin the contract.
import { describe, it, expect } from 'vitest'
import {
  SYSTEM_GENERATE,
  SYSTEM_REFINE,
  buildUserMessage,
} from '../../../supabase/functions/generate-plan/prompt.ts'
import { INTAKE_FIELDS } from '../../../supabase/functions/generate-plan/logic.ts'
import { PLAN_SCHEMA } from '../../../supabase/functions/generate-plan/schema.ts'

const FULL_INTAKE = {
  name: 'Vic', age: '34', sex: 'Male', height_cm: '178', weight_kg: '82',
  bodyfat_pct: '19', goal_weight_kg: '76', goal: 'Lose fat',
  event: 'wedding, 4 months away', activity_level: 'Moderate', training_freq: '2x gym',
  sport: 'Football once a week', steps: '7000', health_notes: 'cholesterol slightly high',
  cuisines_dishes: 'Peruvian, Italian', loved_foods: 'Bread, rice',
  disliked_foods: 'Greek yogurt', alcohol: '3 beers a week',
  eating_out: 'One dinner a week', home_pct: '70', supplements: 'Omega 3',
}

describe('buildUserMessage', () => {
  it('includes every intake field that has a value', () => {
    const msg = buildUserMessage(FULL_INTAKE)
    for (const value of Object.values(FULL_INTAKE)) {
      expect(msg).toContain(value)
    }
  })

  it('omits blank and missing answers instead of sending empty labels', () => {
    const msg = buildUserMessage({ name: 'Vic', goal: 'Lose fat', sport: '', steps: null })
    expect(msg).toContain('Name: Vic')
    expect(msg).toContain('Primary goal: Lose fat')
    expect(msg).not.toContain('Sport played:')
    expect(msg).not.toContain('Average daily steps:')
  })

  it('labels the two food constraints unambiguously', () => {
    const msg = buildUserMessage(FULL_INTAKE)
    expect(msg).toContain('Foods they LOVE (never remove): Bread, rice')
    expect(msg).toContain('Foods they DISLIKE (never include): Greek yogurt')
  })

  // Reversed deliberately: the plan used to be written in whatever language
  // the answers were in, which produced Spanish day names and Spanish meal
  // descriptions inside an English app.
  it('asks for the plan in English whatever the answers are written in', () => {
    expect(buildUserMessage({ name: 'Vic' })).toMatch(/entire plan in English/i)
    expect(buildUserMessage({ name: 'Vic' })).not.toMatch(/same language/i)
  })

  it('handles a completely empty intake without throwing', () => {
    expect(() => buildUserMessage({})).not.toThrow()
  })

  // If someone adds a question to the intake form and to the whitelist but
  // forgets the prompt builder, the answer is collected, stored and then
  // thrown away. This catches that.
  it('renders a line for every whitelisted intake field', () => {
    const probe = Object.fromEntries(INTAKE_FIELDS.map((k) => [k, `VALUE_${k}`]))
    const msg = buildUserMessage(probe)
    const missing = INTAKE_FIELDS.filter((k) => !msg.includes(`VALUE_${k}`))
    expect(missing).toEqual([])
  })
})

describe('system prompts', () => {
  it('directs the model to the emit_plan tool rather than to prose', () => {
    for (const p of [SYSTEM_GENERATE, SYSTEM_REFINE]) {
      expect(p).toContain('emit_plan')
      expect(p).toMatch(/exactly once/i)
    }
  })

  // The arithmetic moved into nutrition.ts. If the prompt drifts back to
  // asking for figures, the model's numbers would contradict the computed
  // ones on the same screen.
  it('forbids the model from doing the arithmetic or quoting figures', () => {
    for (const p of [SYSTEM_GENERATE, SYSTEM_REFINE]) {
      expect(p).toMatch(/do not.{0,20}(calculate|do arithmetic)/i)
      expect(p).toMatch(/never state|do not state/i)
    }
  })

  // The design moved into PlanDocument.jsx. A prompt that still specified
  // colours would be dead weight on every request.
  it('no longer describes the visual design', () => {
    expect(SYSTEM_GENERATE).not.toMatch(/#[0-9A-Fa-f]{6}/)
    expect(SYSTEM_GENERATE).not.toMatch(/<style>|border-radius|DOCTYPE/i)
  })

  it('keeps the safety rails that make this responsible advice', () => {
    expect(SYSTEM_GENERATE).toMatch(/not a doctor/i)
    expect(SYSTEM_GENERATE).toMatch(/medical disclaimer/i)
    expect(SYSTEM_GENERATE).toMatch(/never encourage starting statin-like supplements/i)
    // Refinement must not be a way to strip the disclaimer out.
    expect(SYSTEM_REFINE).toMatch(/keep the medical disclaimer/i)
  })

  it('carries the food rules into refinement as well as generation', () => {
    for (const p of [SYSTEM_GENERATE, SYSTEM_REFINE]) {
      expect(p).toMatch(/portions/i)
      expect(p).toMatch(/disliked/i)
    }
  })

  it('tells refinement to return the whole plan, not a patch', () => {
    expect(SYSTEM_REFINE).toMatch(/COMPLETE updated plan/)
    expect(SYSTEM_REFINE).toMatch(/every field must be present/i)
  })
})

describe('the schema and the prompt agree', () => {
  // The schema is what the API enforces; the prompt is what the model reads.
  // If they drift, the model is being asked for something it cannot emit.
  it('states the calorie bands the schema and nutrition.ts enforce', () => {
    const desc = JSON.stringify(PLAN_SCHEMA)
    expect(desc).toMatch(/lose-fat -500\.\.-300/)
    expect(desc).toMatch(/gain-muscle 200\.\.350/)
  })

  it('offers exactly the two BMR formulas nutrition.ts implements', () => {
    const formula = PLAN_SCHEMA.properties.nutrition_inputs.properties.formula
    expect([...formula.enum].sort()).toEqual(['katch-mcardle', 'mifflin-st-jeor'])
  })

  it('requires exactly seven days', () => {
    expect(PLAN_SCHEMA.properties.week.minItems).toBe(7)
    expect(PLAN_SCHEMA.properties.week.maxItems).toBe(7)
  })

  it('requires a disclaimer on every plan', () => {
    expect(PLAN_SCHEMA.required).toContain('disclaimer')
  })

  it('does not ask the model for any computed figure', () => {
    const keys = Object.keys(PLAN_SCHEMA.properties.nutrition_inputs.properties)
    for (const forbidden of ['tdee', 'bmr', 'target_kcal', 'protein_g', 'carbs_g', 'fat_g']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe('the language rule', () => {
  // Plans were coming back in Spanish — Spanish day names, Spanish meal
  // descriptions — inside an English app, because the prompt told the model
  // to mirror the language of the answers.
  it('tells the model to write in English regardless of the input language', () => {
    expect(SYSTEM_GENERATE).toMatch(/write every piece of text in english/i)
    expect(SYSTEM_GENERATE).toMatch(/read spanish, answer in english/i)
  })

  it('names day names specifically, since those slipped through most often', () => {
    expect(SYSTEM_GENERATE).toMatch(/Monday, Tuesday/)
    expect(SYSTEM_GENERATE).toMatch(/Never Lunes/)
  })

  // The exception the reader actually asked for: a dish name is a name.
  it('keeps untranslatable dish names in their own language', () => {
    expect(SYSTEM_GENERATE).toMatch(/lomo saltado/i)
    expect(SYSTEM_GENERATE).toMatch(/no real English equivalent/i)
  })

  it('holds the line on refinements too, including plans already in Spanish', () => {
    expect(SYSTEM_REFINE).toMatch(/stays in English/i)
    expect(SYSTEM_REFINE).toMatch(/translate it as you go/i)
  })

  it('no longer asks for the answers\' language anywhere', () => {
    expect(SYSTEM_GENERATE).not.toMatch(/same language as the user/i)
    expect(SYSTEM_REFINE).not.toMatch(/the same language/i)
  })
})

describe('the myths rule', () => {
  it('asks for several, not one', () => {
    expect(SYSTEM_GENERATE).toMatch(/THREE to FIVE/)
    expect(PLAN_SCHEMA.properties.myths.minItems).toBe(3)
    expect(PLAN_SCHEMA.properties.myths.maxItems).toBe(5)
  })

  it('makes them about foods rather than principles', () => {
    expect(SYSTEM_GENERATE).toMatch(/about specific foods/i)
    for (const food of ['Eggs', 'Avocado', 'Salmon', 'Bread']) {
      expect(SYSTEM_GENERATE).toContain(food)
    }
  })

  // The counterweight: pre-empting a well-known misconception about a food
  // on the plate is fair; inventing an anxiety the person never had is not.
  it('still forbids inventing a fear the person never expressed', () => {
    expect(SYSTEM_GENERATE).toMatch(/not licence to invent/i)
  })

  it('requires them, so a plan cannot come back without any', () => {
    expect(PLAN_SCHEMA.required).toContain('myths')
  })
})

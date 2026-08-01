// JSON Schema for a generated FitPlan, used as an Anthropic tool input_schema.
//
// Passing this as a tool and forcing `tool_choice` means the API itself
// guarantees the response shape — required keys present, enums respected,
// arrays of the right length. That is a materially stronger guarantee than
// asking for JSON in prose and hoping, and it is the reason this rewrite is
// worth doing at all.
//
// Note what is NOT in here: no calorie, BMR, TDEE or macro-gram figures. The
// model supplies the *inputs* to those calculations under `nutrition_inputs`
// and nutrition.ts does the arithmetic. See the comment at the top of that
// file.

export const PLAN_TOOL_NAME = 'emit_plan'

export const PLAN_SCHEMA = {
  type: 'object',
  required: [
    'language', 'hero', 'nutrition_inputs', 'numbers_explainer', 'plate',
    'myths', 'week', 'weekly_targets', 'training', 'tracking', 'disclaimer',
  ],
  properties: {
    language: {
      type: 'string',
      description:
        'Always "en". The plan is written in English regardless of what ' +
        'language the user answered in. The field is kept because plans ' +
        'generated before this rule are stored with other values.',
    },

    hero: {
      type: 'object',
      required: ['name', 'goal_label', 'headline'],
      properties: {
        name: { type: 'string', description: 'The person\'s name, or a friendly stand-in.' },
        goal_label: { type: 'string', description: 'Their goal in a few words, in English.' },
        target_event: {
          type: 'string',
          description: 'Their target event and timeframe, if they gave one. Omit otherwise.',
        },
        headline: {
          type: 'string',
          description:
            'One or two encouraging, specific sentences addressed to this person. ' +
            'Never guarantee a body-fat % or a six-pack — say "likely" or "achievable".',
        },
      },
    },

    nutrition_inputs: {
      type: 'object',
      description:
        'The inputs to the calorie calculation. Do NOT compute calories, BMR, ' +
        'TDEE or macro grams yourself — these values are fed into an exact ' +
        'calculation. Choose them thoughtfully; that judgement is the valuable part.',
      required: ['weight_kg', 'formula', 'activity_multiplier', 'activity_rationale', 'goal', 'goal_adjustment_kcal'],
      properties: {
        weight_kg: { type: 'number' },
        height_cm: { type: 'number' },
        age: { type: 'number' },
        sex: { type: 'string', enum: ['male', 'female'] },
        bodyfat_pct: { type: 'number', description: 'Only if the user gave one.' },
        formula: {
          type: 'string',
          enum: ['katch-mcardle', 'mifflin-st-jeor'],
          description:
            'Use katch-mcardle when body-fat % is known (it uses lean mass), ' +
            'otherwise mifflin-st-jeor.',
        },
        activity_multiplier: {
          type: 'number',
          description:
            'With mifflin-st-jeor: 1.2 sedentary, 1.375 light, 1.55 moderate, ' +
            '1.725 high, 1.9 athlete. With katch-mcardle use training hours: ' +
            '1.2 for 1-3 h/wk, 1.35 for 4-6 h/wk, 1.5 for 6+ h/wk. Factor in ' +
            'steps and any sport played — do not lowball an active person.',
        },
        activity_rationale: {
          type: 'string',
          description: 'One sentence on why that multiplier, citing their job, steps and sport.',
        },
        goal: {
          type: 'string',
          enum: ['lose-fat', 'recomposition', 'gain-muscle', 'maintain'],
        },
        goal_adjustment_kcal: {
          type: 'number',
          description:
            'Daily calorie adjustment. Allowed bands: lose-fat -500..-300, ' +
            'recomposition -350..-200, maintain 0, gain-muscle 200..350. ' +
            'Sustainable fat loss is about 0.25-0.5 kg/week.',
        },
        protein_g_per_kg: { type: 'number', description: '1.6 to 2.0. Default 1.8.' },
        fat_g_per_kg: { type: 'number', description: '0.7 to 0.9.' },
      },
    },

    numbers_explainer: {
      type: 'string',
      description:
        'One short paragraph explaining what the daily numbers mean for this ' +
        'person in plain language. Do not state specific calorie or gram ' +
        'figures — they are rendered separately and would contradict yours.',
    },

    myths: {
      type: 'array',
      description:
        'Three to five quick corrections about SPECIFIC FOODS that appear in ' +
        'this plan or in the user\'s answers — the ordinary misconceptions ' +
        'attached to the things you are asking them to eat. Prioritise the ' +
        'foods they said they love, because those are the ones they have been ' +
        'feeling guilty about.',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['title', 'correction'],
        properties: {
          title: {
            type: 'string',
            description:
              'The food itself, one or two words: "Eggs", "Avocado", ' +
              '"Salmon", "Bread", "Rice", "Potatoes", "Red meat", ' +
              '"Late-night carbs". Not a sentence.',
          },
          correction: {
            type: 'string',
            description:
              'Two or three sentences: what people believe, what the evidence ' +
              'shows, and what it means for this plan. Calm and concrete — ' +
              'never scold the reader for having believed it.',
          },
        },
      },
    },

    plate: {
      type: 'object',
      description: 'The 50% veg / 25% protein / 25% carbs plate rule, using THEIR foods.',
      required: ['veg_examples', 'protein_examples', 'carb_examples', 'hand_cues'],
      properties: {
        veg_examples: { type: 'array', items: { type: 'string' } },
        protein_examples: { type: 'array', items: { type: 'string' } },
        carb_examples: { type: 'array', items: { type: 'string' } },
        hand_cues: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hand-size portion cues, e.g. "a palm of protein per meal".',
        },
      },
    },

    week: {
      type: 'array',
      description:
        'Exactly 7 days, built ONLY from the cuisines and dishes the user ' +
        'listed. Protect their loved foods; never include a disliked food. ' +
        'Weave in training days, any sport, a night out and a restaurant meal ' +
        'if they mentioned them.',
      minItems: 7,
      maxItems: 7,
      items: {
        type: 'object',
        required: ['day', 'breakfast', 'lunch', 'dinner'],
        properties: {
          day: { type: 'string', description: 'English day name: Monday, Tuesday, ... Sunday.' },
          label: { type: 'string', description: 'e.g. "training day", "match day", "night out".' },
          tags: {
            type: 'array',
            items: { type: 'string', enum: ['training', 'sport', 'oily-fish', 'legumes', 'rest', 'social', 'restaurant'] },
          },
          breakfast: { type: 'string' },
          lunch: { type: 'string' },
          dinner: { type: 'string' },
          snack: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },

    weekly_targets: {
      type: 'array',
      items: { type: 'string' },
      description: 'Background weekly targets, e.g. "oily fish twice", "legumes three times".',
    },

    training: {
      type: 'object',
      required: ['split', 'progression_note', 'cardio_note'],
      properties: {
        split: {
          type: 'array',
          description: 'A 3-day split: push, pull + abs, legs + abs.',
          minItems: 3,
          maxItems: 4,
          items: {
            type: 'object',
            required: ['day', 'focus', 'exercises'],
            properties: {
              day: { type: 'string' },
              focus: { type: 'string' },
              exercises: {
                type: 'array',
                minItems: 3,
                items: {
                  type: 'object',
                  required: ['name', 'sets', 'reps'],
                  properties: {
                    name: { type: 'string' },
                    sets: { type: 'integer', minimum: 1, maximum: 10 },
                    reps: { type: 'string', description: 'e.g. "6-12" or "8".' },
                    note: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        progression_note: { type: 'string', description: 'How to apply progressive overload.' },
        cardio_note: { type: 'string', description: 'Steps and cardio, crediting any sport they play.' },
      },
    },

    supplements: {
      type: 'array',
      description:
        'Review ONLY the supplements the user listed. Empty array if they ' +
        'listed none — never suggest starting something they did not mention. ' +
        'If red yeast rice or monacolin appears, note it is effectively a ' +
        'low-dose statin and to consult a doctor.',
      items: {
        type: 'object',
        required: ['name', 'verdict', 'rationale'],
        properties: {
          name: { type: 'string' },
          verdict: { type: 'string', enum: ['keep', 'adjust', 'optional', 'dont-start'] },
          rationale: { type: 'string' },
        },
      },
    },

    tracking: {
      type: 'array',
      items: { type: 'string' },
      description:
        'How to track progress: weigh-in averaging, fortnightly photos, ' +
        'logging gym numbers, monthly waist, and a bloodwork note if they ' +
        'mentioned cholesterol.',
    },

    disclaimer: {
      type: 'string',
      description:
        'A clear medical disclaimer in the plan\'s language: this is general ' +
        'nutrition and training information, not medical advice.',
    },
  },
} as const

/**
 * Structural validation of a plan object, beyond what the tool schema
 * guarantees. The API enforces types and required keys; this catches the
 * semantic gaps that would render as a visibly broken plan.
 */
export function validatePlan(plan: unknown): string[] {
  const errors: string[] = []
  if (!plan || typeof plan !== 'object') return ['Plan is not an object.']
  const p = plan as Record<string, any>

  if (!p.hero?.name) errors.push('Missing hero.name.')
  if (!p.nutrition_inputs) errors.push('Missing nutrition_inputs.')
  else {
    const n = p.nutrition_inputs
    if (typeof n.weight_kg !== 'number' || n.weight_kg <= 0) {
      errors.push('nutrition_inputs.weight_kg must be a positive number.')
    }
    if (typeof n.activity_multiplier !== 'number') {
      errors.push('nutrition_inputs.activity_multiplier must be a number.')
    }
    if (typeof n.goal_adjustment_kcal !== 'number') {
      errors.push('nutrition_inputs.goal_adjustment_kcal must be a number.')
    }
  }

  if (!Array.isArray(p.week) || p.week.length !== 7) {
    errors.push(`week must have exactly 7 days, got ${Array.isArray(p.week) ? p.week.length : 'none'}.`)
  } else {
    p.week.forEach((d: any, i: number) => {
      if (!d?.breakfast || !d?.lunch || !d?.dinner) {
        errors.push(`week[${i}] is missing a meal.`)
      }
    })
  }

  const split = p.training?.split
  if (!Array.isArray(split) || split.length < 3) {
    errors.push('training.split must have at least 3 days.')
  }

  // Myths are the part people quote back at each other, and the schema asks
  // for three. Checking it here too means a model that returns one gets
  // retried rather than quietly producing a thinner plan than the last one.
  if (!Array.isArray(p.myths) || p.myths.length < 3) {
    errors.push(`myths must have at least 3 entries, got ${Array.isArray(p.myths) ? p.myths.length : 'none'}.`)
  } else if (p.myths.some((m: any) => !m?.title || !m?.correction)) {
    errors.push('every myth needs a title and a correction.')
  }

  if (!p.disclaimer) errors.push('Missing disclaimer.')

  return errors
}

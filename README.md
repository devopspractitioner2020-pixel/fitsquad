# Fit Squad

A social fitness app: log workouts, meals (with photos), weigh-ins and tips; climb a squad leaderboard; and generate a personalized **FitPlan** written by Claude from an intake form.

Built to match the design you validated in Lovable — dark teal-black, bright mint accent, floating pill nav.

---

## Architecture (read this first — it explains the API keys)

```
                    ┌──────────────────────────────────────────┐
                    │  BROWSER (React app, static files)        │
                    │  Hosted on Cloudflare Pages                │
                    │                                            │
                    │  Knows only:                               │
                    │   • VITE_SUPABASE_URL                      │
                    │   • VITE_SUPABASE_ANON_KEY  (safe/public)  │
                    └───────────────┬───────────────────────────┘
                                    │  supabase-js (auth, DB reads, photo upload)
                                    │  + invoke('generate-plan')
                                    ▼
        ┌───────────────────────────────────────────────────────┐
        │  SUPABASE  (your backend)                              │
        │                                                        │
        │  • Postgres + Row Level Security (per-user data)       │
        │  • Storage bucket `post-photos` (compressed images)    │
        │  • Edge Function `generate-plan` (Deno, server-side)   │
        │        holds ANTHROPIC_API_KEY as a secret ───────────┐│
        └────────────────────────────────────────────────────┼─┘│
                                                              │  │
                                                              ▼  │
                                         ┌────────────────────────┐
                                         │  Anthropic Claude API   │
                                         │  model: claude-sonnet-5 │
                                         └────────────────────────┘
```

### Why the Claude key can't live in the static app
A Cloudflare Pages site is **static files shipped to the browser**. Anything in that
bundle — including any "secret" — is readable by anyone who opens dev tools. If the
Claude key were there, people could copy it and spend your Anthropic credits.

So the Claude key lives **only** inside the Supabase **Edge Function**, which runs on a
server. The browser calls the Edge Function (`generate-plan`); the function calls Claude
with the key; the result is written back to the database. The key never leaves the server.

### Where each key goes

| Key | Lives in | Exposed to browser? |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend `.env` + Cloudflare env | Yes — safe |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env` + Cloudflare env | Yes — safe (protected by RLS) |
| `ANTHROPIC_API_KEY` | **Supabase Edge Function secret only** | **No — never** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Supabase Edge Function secret only** | **No — never** |

> Do **not** paste keys into chat or commit `.env`. `.gitignore` already excludes it.

---

## Tech stack
- **Frontend:** React + Vite + Tailwind, React Router, Recharts (weight graph).
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions).
- **AI:** Anthropic Claude (`claude-sonnet-5`) via the Edge Function, using
  forced tool use so the plan comes back as validated JSON, not markup.
- **Tests:** Vitest + Testing Library (`npm test` — 384 tests, no live backend needed).
- **Hosting:** Cloudflare Workers static assets (frontend, see `wrangler.jsonc`) + Supabase (backend).

---

## Setup

### 1. Supabase project
1. Create a project at supabase.com.
2. Open **SQL Editor**, paste `supabase/schema.sql`, run it. This creates all tables,
   RLS policies, and the `post-photos` storage bucket.
3. **Auth → Providers → Email**: enable email. For quick testing you can turn off
   "Confirm email" so sign-ups log in immediately.

### 1b. Run the hardening migration
`supabase/schema.sql` alone leaves signup broken once email confirmation is on.
Run `supabase/migrations/0002_hardening.sql` in the SQL editor too. Both files
are idempotent.

### 2. Deploy the Edge Function
**See [DEPLOY.md](./DEPLOY.md) for the full walkthrough, including a curl smoke
test that verifies the function before you wire up the frontend.** In short:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Server-side secrets (NEVER in the frontend):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
supabase secrets set ALLOWED_ORIGINS="https://your-site.example.com"

# SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided
# to the function runtime automatically by Supabase.

supabase functions deploy generate-plan
```

### 3. Frontend env
```bash
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
# (Project Settings → API in Supabase)
```

### 4. Run locally
```bash
npm install
npm test      # 384 tests — run these before deploying
npm run dev
```

---

## Deploy the frontend to Cloudflare Pages
1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. **Settings → Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. To use a subdomain of your domain (e.g. `fitsquad.inkaitech.com`), add a
   **Custom domain** in the Pages project (works once your domain's DNS is on Cloudflare).

Because the frontend is a single-page app, deep links like `/me` need a fallback to
`index.html`. How you get it depends on the platform, and the two are mutually
exclusive: on **Workers** it is `"not_found_handling": "single-page-application"` in
`wrangler.jsonc` (already set), and on **Pages** it is a `public/_redirects` file
containing `/*  /index.html  200`. Workers rejects that redirect rule outright, so do
not add it unless you have actually moved to Pages. Full walkthrough in `DEPLOY.md`.

---

## How the FitPlan generation flow works (the part that was broken in Lovable)

1. User fills the **intake form** and taps **Save & generate my FitPlan**.
   The button disables and shows "Starting…".
2. The app calls the `generate-plan` Edge Function. It validates and rate-limits the
   request, **inserts a plan row with `status = 'generating'`, and responds in ~200ms**
   with `202 {planId, status}`. The Claude call then runs as a background task
   (`EdgeRuntime.waitUntil`), so the HTTP response never has to stay open for it.
3. The app navigates to **Me**. The *Your FitPlan* card shows a **spinner + "Generating your
   plan…"** and polls the plan row every 3 seconds.
4. When the function finishes, the row flips to `status = 'ready'` (or `'error'`), and the
   card updates automatically — **Ready → tap to open**.
5. **Your FitPlan** renders the structured plan with the app's own design
   system (`src/components/PlanDocument.jsx`), split across three tabs —
   **Overview** (numbers, progress tracking), **Food** (plate rule, myths,
   the 7-day menu, supplements) and **Training** (the split). The medical
   disclaimer sits outside the tabs and is always visible. Plans generated
   before the structured-output rewrite are still stored as HTML and render
   in a sandboxed `<iframe>`.
6. **Refine:** on the *first* plan only, the user can request up to **3** changes. The
   server enforces the cap.
7. **Regenerate:** after a **7-day** cooldown, the user updates their info (the form is
   pre-filled from the last intake — they usually just change the weight) and generates a
   fresh plan. Every plan is stored with its date so progress builds over time.
8. **Limits are enforced server-side**, not just in the UI: one generation in flight at a
   time, 5 attempts per user per day, and the 7-day cooldown — which runs only from a plan
   that actually succeeded, so a failure never locks anyone out.
9. **Stuck plans self-heal.** A `generating` row older than 10 minutes (worker killed
   mid-flight) is treated as failed by the UI, so the card offers a retry instead of
   spinning forever.

---

## How the plan is generated (structured output)

The model does not write the document. It calls a single tool, `emit_plan`,
whose `input_schema` (`supabase/functions/generate-plan/schema.ts`) the API
validates — so the response shape is a guarantee rather than a hope. Three
things moved out of the prompt as a result:

| What | Used to live in | Lives in now |
|---|---|---|
| Visual design | ~90 lines of prompt, regenerated per plan | `src/components/PlanDocument.jsx` |
| Calorie & macro maths | the model's head | `supabase/functions/generate-plan/nutrition.ts` |
| Output shape | prose instructions | `schema.ts`, enforced by the API |

The model still makes every judgement call — which BMR formula suits this
person, how active they really are, how aggressive the deficit should be, what
goes in each meal. It supplies those as *inputs*; `nutrition.ts` does the
arithmetic exactly, clamps anything outside its allowed band, and enforces a
calorie floor (never below BMR, never below 1500/1200 kcal). Any adjustment it
makes is shown to the user rather than applied silently.

Because the design is no longer baked into stored output, changing it updates
every plan ever generated — including old ones.

## Photos (meals & tips)
- The photo picker uses `capture="environment"` so phones open the camera directly.
- Before upload, images are **compressed in the browser** (`src/lib/image.js`): the long
  edge is scaled to 1280px and re-encoded as JPEG q0.7 — WhatsApp-style. A multi-MB photo
  becomes ~50–200 KB.
- Compressed images upload to the `post-photos` bucket under `<user_id>/…`; RLS allows
  users to write only their own folder.

---

## Project structure
```
src/
  lib/         supabase client, image compression, API (edge fn) calls
  context/     AuthContext (session + profile)
  components/  BottomNav, LogModal, PostCard, VideoEmbed, PlanDocument, ui atoms
  screens/     Auth, Feed, Me, Squad, Intake, PlanView, Saved
supabase/
  schema.sql                     tables + RLS + storage bucket
  functions/generate-plan/
    index.ts     I/O shell: auth, rate limits, background task
    logic.ts     pure decisions (limits, validation) — unit-tested
    schema.ts    the plan's JSON schema, enforced via tool use
    nutrition.ts BMR / TDEE / macro maths + safety floors
    prompt.ts    coaching philosophy only
  migrations/                    additive migrations, run after schema.sql
```

## Review, tests and deployment
- **[REVIEW.md](./REVIEW.md)** — full code review, security scan and test assessment.
- **[DEPLOY.md](./DEPLOY.md)** — step-by-step deployment from the Edge Function onward.
- `npm test` runs the suite; `npm run test:coverage` reports coverage.

## Squads
Every user belongs to a squad. Signing up creates one named after you, with a
six-character join code (no `0 O 1 I L` — these get read aloud). Share the code
or the invite link from the **Squad** tab; anyone signing up with it lands in
your squad directly.

Visibility is scoped by *shared membership* rather than by stamping a
`squad_id` on every row: RLS lets you read a post if you and its author are in
a squad together. That means history follows a person when they switch squads,
and the app's queries need no squad filter at all — `select * from posts`
already returns exactly your squad's rows.

## Video in tips
A tip can carry a TikTok, Instagram Reel or YouTube Short link, which plays
inline in the feed. Nothing is downloaded or stored — the iframe points at the
platform's own player, so the video streams from their servers and the creator
keeps the view. Short links (`vm.tiktok.com/…`) are resolved once at save time
by the `resolve-link` function, because the real video ID sits behind a
redirect the browser can't follow.

If you add another provider, update `frame-src` in `public/_headers` too. A
CSP frame block is near-silent — the embed just goes blank.

## Saved tips and meals
Any tip or meal in the feed can be bookmarked — your own or a squad-mate's —
and comes back under **Me → Saved tips / Saved meals**. Workouts are not
saveable: they are a log of something that happened, not reference material.

A save is a reference, not a copy. `saved_posts` holds only `(user_id,
post_id)` and every read joins back to `posts`, so an edited post shows its
new text in the saved list and a deleted one disappears from it. Saves are
private — nobody sees what anyone else has bookmarked.

## Known follow-ups
- `posts.author_name` is denormalised and client-supplied. The leaderboard now
  reads names from `profiles`, but the feed still shows the stored copy.
- Feed reactions and the Comment button are not wired up.
- Recharts puts the bundle at ~800KB in one chunk; lazy-load the weight chart.
- Add CI (`npm ci && npm test && npm run build`) before a second contributor.

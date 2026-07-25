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
- **AI:** Anthropic Claude (`claude-sonnet-5`) via the Edge Function.
- **Hosting:** Cloudflare Pages (frontend) + Supabase (backend).

---

## Setup

### 1. Supabase project
1. Create a project at supabase.com.
2. Open **SQL Editor**, paste `supabase/schema.sql`, run it. This creates all tables,
   RLS policies, and the `post-photos` storage bucket.
3. **Auth → Providers → Email**: enable email. For quick testing you can turn off
   "Confirm email" so sign-ups log in immediately.

### 2. Deploy the Edge Function
Install the Supabase CLI, then from the project root:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Set the server-side secrets (NEVER in the frontend):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx

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

Because the frontend is a single-page app, add a `_redirects` file to `public/` with
`/*  /index.html  200` if deep links 404 (Cloudflare Pages usually handles SPAs, but this
guarantees it).

---

## How the FitPlan generation flow works (the part that was broken in Lovable)

1. User fills the **intake form** and taps **Save & generate my FitPlan**.
   The button disables and shows "Starting…".
2. The app calls the `generate-plan` Edge Function, which **immediately inserts a plan row
   with `status = 'generating'`**, then calls Claude.
3. The app navigates to **Me**. The *Your FitPlan* card shows a **spinner + "Generating your
   plan…"** and polls the plan row every 3 seconds.
4. When the function finishes, the row flips to `status = 'ready'` (or `'error'`), and the
   card updates automatically — **Ready → tap to open**.
5. **Your FitPlan** renders the generated HTML in a sandboxed `<iframe>`.
6. **Refine:** on the *first* plan only, the user can request up to **3** changes. The
   server enforces the cap.
7. **Regenerate:** after a **7-day** cooldown, the user updates their info (the form is
   pre-filled from the last intake — they usually just change the weight) and generates a
   fresh plan. Every plan is stored with its date so progress builds over time.

---

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
  components/  BottomNav, LogModal (workout/meal/weigh/tip + photo), ui atoms
  screens/     Auth, Feed, Me, Squad, Intake, PlanView
supabase/
  schema.sql                     tables + RLS + storage bucket
  functions/generate-plan/       Edge Function (holds Claude key) + prompt
```

## Notes for continuing in Claude Cowork
- The leaderboard/feed currently roll up client-side. For a large squad, move these to a
  Postgres **view** or RPC for efficiency.
- Add realtime (`supabase.channel`) on the `plans` row to replace polling if you prefer.
- Consider rate-limiting `generate-plan` per user to control Claude spend.

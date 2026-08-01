# Fit Squad — deployment guide

You have finished **Setup step 1** (Supabase project created, `schema.sql` run,
email auth enabled). This picks up from there and takes you to a live site.

Total time: about 45 minutes, most of it waiting for DNS.

---

## Step 1b. Run the migrations (5 min — do this first)

Five migrations to run in **SQL Editor → New query**, in order. All are
idempotent, so running them twice is harmless.

1. `0002_hardening.sql` — profile-creation trigger and sanity constraints.
2. `0003_plan_data.sql` — adds `plans.data`, where structured plans live.
   Plans generated before this keep working: `html` is retained and rendered.
3. `0004_squads.sql` — real squads with join codes. **Existing users are
   backfilled into one shared squad**, so the feed and leaderboard look
   exactly as they did before. Also replaces the old `using (true)` read
   policies, which let every signed-in user read every row in the database.
4. `0005_video_and_revisions.sql` — `posts.video_url` for embeds, and the
   first-plan revision budget.
5. `0006_saved_posts.sql` — bookmarks. Saves are private to the saver and
   cascade on post delete, so a saved list never shows a post that is gone.
6. `0007_squad_for_everyone.sql` — gives a squad to any account that has
   none. 0004 covered new signups and the users who existed when it ran;
   anyone created in between, or who left their last squad, was left with a
   Squad screen that had no join code and no way to get one.

Confirm all six:

```sql
select tgname from pg_trigger where tgname = 'on_auth_user_created';
select column_name from information_schema.columns
 where table_name = 'plans' and column_name = 'data';
select count(*) as squads, (select count(*) from squad_members) as members from squads;
select column_name from information_schema.columns
 where table_name = 'posts' and column_name = 'video_url';
select to_regclass('public.saved_posts') as saved_posts;

-- Nobody without a squad. Should return zero rows.
select au.email from auth.users au
left join public.squad_members m on m.user_id = au.id
where m.user_id is null;
```

Every user should have a squad. If any don't:

```sql
select u.email from auth.users u
left join squad_members m on m.user_id = u.id
where m.user_id is null;
```

### What 0002 fixes

Since you ran `schema.sql`, a second migration has been added. It fixes a bug
that will bite you the moment you turn email confirmation on: profiles were
created from the browser after signup, but at that point there is no session,
so RLS silently rejected the insert and the user ended up with no display name
anywhere in the app. The migration moves profile creation into a database
trigger, and adds a few sanity constraints.

> `supabase/schema.sql` has also been made re-runnable (every `create policy`
> is now preceded by a `drop policy if exists`). Previously a second run
> failed with `policy already exists`.

---

## Step 2. Deploy the Edge Function

This is the part that holds your Claude key. Nothing here ever reaches the
browser.

### 2.1 Install the Supabase CLI

On macOS:

```bash
brew install supabase/tap/supabase
supabase --version
```

If you do not use Homebrew, `npx supabase@latest <command>` works for every
command below — just prefix them.

> Do **not** install the CLI as a project dependency with `npm i supabase`;
> it is deprecated as a direct dependency and you will get a warning.

### 2.2 Log in and link the project

```bash
cd /Users/macbook/Documents/Projects/fit-squad

supabase login          # opens a browser, generates an access token
supabase link --project-ref YOUR_PROJECT_REF
```

Your `YOUR_PROJECT_REF` is the subdomain of your project URL. If your URL is
`https://abcdefghijklmnop.supabase.co`, the ref is `abcdefghijklmnop`. You can
also read it from **Project Settings → General → Reference ID**.

`link` will ask for your database password (the one you set when creating the
project). If you have lost it, reset it under **Project Settings → Database**.

### 2.3 Set the server-side secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

Then, once you know your production URL, lock down who may call the function.
Until you set this the function accepts requests from any origin:

```bash
supabase secrets set ALLOWED_ORIGINS="https://fitsquad.inkaitech.com,http://localhost:5173"
```

Optionally pin the model explicitly. The function defaults to
`claude-sonnet-5` — 1M context, 128k max output — which is what you want:

```bash
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5
```

Verify — this prints names and digests, never the values:

```bash
supabase secrets list
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected into the function runtime automatically. Do not set them yourself;
Supabase rejects secrets with the `SUPABASE_` prefix.

### 2.4 Deploy

```bash
supabase functions deploy generate-plan
supabase functions deploy resolve-link
```

`resolve-link` follows a TikTok short link to its canonical URL so the feed
can embed it. It holds no secrets and needs none.

The CLI bundles `index.ts` together with `prompt.ts`, `logic.ts`, `schema.ts`
and `nutrition.ts` and uploads them. `supabase/config.toml` (added in this pass) pins two settings
the function depends on: `verify_jwt = true`, and `policy = "per_worker"` for
the edge runtime, which is what allows the Claude call to finish in a
background task after the HTTP response has been sent.

Confirm it is live:

```bash
supabase functions list
```

### 2.5 Smoke-test it before wiring up the frontend

An unauthenticated call must be refused. This is the fastest way to know the
deploy worked at all:

```bash
curl -i -X POST \
  "https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-plan" \
  -H "Content-Type: application/json" \
  -d '{"mode":"generate","intake":{"name":"test"}}'
```

Expect **401** with `{"error":"Not signed in."}`. A 404 means the function did
not deploy; a 500 mentioning `ANTHROPIC_API_KEY` means the secret is missing.

To test the real path you need a user JWT. Create a user in
**Authentication → Users**, then:

```bash
# 1. get an access token
curl -s -X POST "https://YOUR_PROJECT_REF.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: YOUR_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}' | python3 -m json.tool

# 2. call the function with it
curl -i -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-plan" \
  -H "Authorization: Bearer PASTE_ACCESS_TOKEN" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"generate","intake":{"name":"Vic","age":"34","sex":"Male","height_cm":"178","weight_kg":"82","goal":"Lose fat","cuisines_dishes":"Peruvian, Italian"}}'
```

Expect **202** and `{"planId":"...","status":"generating"}` within a second or
two. That fast reply is the point: the Claude call keeps running in the
background after the response. Wait 20–60 seconds, then check the row.

Plans are now stored as structured JSON in `plans.data`, so inspect that
rather than truncating a blob of markup:

```sql
select
  status,
  data->'hero'->>'name'                as plan_for,
  data->'numbers'->>'formula_label'    as method,
  (data->'numbers'->>'tdee')::int      as tdee,
  (data->'numbers'->>'target_kcal')::int as target,
  jsonb_array_length(data->'week')     as days,
  jsonb_array_length(data->'training'->'split') as training_days,
  data->'numbers'->'adjustments'       as safety_adjustments,
  error_message,
  created_at
from plans
order by created_at desc
limit 5;
```

A healthy plan has `days = 7`, `training_days >= 3`, and a `target` that sits
below `tdee` for a fat-loss goal. `safety_adjustments` is normally `[]`; if it
has entries, the calorie floor moved the target and the app shows the person
why.

To read the whole thing, open the row in **Table Editor → plans** and expand
the `data` cell — or log into the app and open the plan, which is the real
test.

### 2.5b Check short-link expansion

Short links are what the TikTok app actually gives people, so this path
matters more than the full-URL one. Test it directly:

```bash
curl -s -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/resolve-link" \
  -H "Authorization: Bearer PASTE_ACCESS_TOKEN" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://vm.tiktok.com/ZN8e1gke2/"}'
```

- `{"url":"https://www.tiktok.com/@someone/video/7123…","reason":"resolved"}`
  — working.
- `404` — the function is not deployed. `supabase functions deploy resolve-link`.
- `{"reason":"upstream-refused"}` — deployed, but TikTok would not co-operate
  with the request. The function tries four ways (HEAD, GET, manual redirect
  hops, then TikTok's public oEmbed endpoint) before reporting this.

Either failure is survivable: the app posts the tip anyway keeping the short
link, and the feed shows a card that opens in TikTok instead of playing
inline. A flaky redirect never costs somebody the tip they just wrote.

### 2.6 Read the logs

**There is no `supabase functions logs` CLI command** — `supabase functions`
only has `list`, `delete`, `download`, `deploy`, `new` and `serve`. Logs live
in the dashboard:

**Dashboard → Edge Functions → generate-plan**, which gives you two tabs:

- **Invocations** — request/response data, status codes, execution duration.
  This is where you confirm the function returned `202` quickly.
- **Logs** — platform events, uncaught exceptions, and anything the function
  `console.log`/`console.error`'d. This is where a failed background task
  shows up, because the Claude call finishes *after* the response and so
  cannot appear in Invocations.

Two platform limits worth knowing: a single log message is truncated at 10,000
characters, and a function is capped at 100 log events per 10-second window.

If you want logs in your terminal, run the function locally instead — they
stream to stdout:

```bash
supabase start                      # needs Docker
supabase functions serve generate-plan --env-file ./supabase/.env.local
```

---

## Step 3. Frontend environment

These two values are **edited into a file**, not typed at the terminal.

> Worth knowing why this trips people up: typing `VITE_SUPABASE_URL=https://...`
> at a bash prompt is valid shell — it sets a variable for that one terminal
> session and prints no error. It looks like it worked. But the variable
> vanishes when you close the terminal and it never reaches `.env`, so Vite
> never sees it. The file is the only thing that counts.

### 3.1 Create the file

```bash
cd /Users/macbook/Documents/Projects/fit-squad
cp .env.example .env
```

You have already done this. `.env` now exists and already contains the two
lines — with placeholder values:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Your job is to replace the two placeholders on the right of the `=` signs.

### 3.2 Get the two values from Supabase

**Project URL** — the fastest route is the green **Connect** button in the top
bar of your project, which shows it directly. It is also under
**Project Settings → API**. It looks like:

```
https://abcdefghijklmnop.supabase.co
```

**The key** — **Project Settings → API Keys**. You will see two tabs:

- **API Keys** (current) — copy the **publishable** key, `sb_publishable_...`
- **Legacy API Keys** — the older **anon** key, a long `eyJ...` JWT

Either works, and both go in the same `VITE_SUPABASE_ANON_KEY` variable
regardless of the name. Prefer the publishable key: Supabase is deprecating
the legacy JWT keys by the end of 2026.

Do **not** touch anything labelled `service_role` or `sb_secret_`. Those
bypass Row Level Security and must never reach the browser.

### 3.3 Edit the file

Any of these — pick whichever you are comfortable with.

**In VS Code:**

```bash
code .env
```

**In nano** (terminal editor; `Ctrl+O`, `Enter` to save, `Ctrl+X` to quit):

```bash
nano .env
```

**On macOS with TextEdit:**

```bash
open -e .env
```

Replace the placeholders so it ends up looking like this — no quotes, no
spaces around the `=`, no trailing slash on the URL:

```
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_AbCdEf123456...
```

**If you would rather stay in the terminal**, this writes the file in one go —
substitute your real values first:

```bash
cat > .env <<'EOF'
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_AbCdEf123456
EOF
```

Note the quoted `'EOF'` — it stops the shell interpreting anything in the key.

### 3.4 Check it

```bash
cat .env
```

You should see your real values. Then confirm nothing was missed:

```bash
grep -E 'YOUR-PROJECT|your-anon-public-key' .env \
  && echo "STILL A PLACEHOLDER — edit .env again" \
  || echo "OK: no placeholders left"
```

Two things to be sure of:

- `.env` sits in the project root, next to `package.json` — not in `src/`.
- It is **not** named `.env.example`, `.env.txt` or `env`. Run `ls -a | grep env`
  and you should see both `.env` and `.env.example` listed.

`.env` is already in `.gitignore`, so it will not be committed. Keep it that
way — and note these two values are safe in the browser anyway: the
publishable key does nothing without a valid session, and Row Level Security
governs what any session can read.

## Step 3b. Seed a demo squad (optional, 1 min)

If you want a populated app to look at rather than an empty one:

```bash
export SUPABASE_URL=https://YOUR_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # Settings → API Keys
npm run seed
```

Creates `test@example.com` (password `fitsquad123`) plus three squad-mates in
one squad, with eight weeks of posts, **seventeen weeks of weigh-ins**, and a
finished FitPlan with 2 of 3 changes left — so you can exercise the tweak and
regenerate paths without waiting out a cooldown. Three of the seeded tips
carry video links, so the embeds are easy to find in the feed.

The weigh-in history runs longer than the post history on purpose: people step
on a scale for far longer than they post about it, and the weight chart needs
more weeks than fit on one screen or the horizontal scrolling never gets
exercised. One week is deliberately left empty, so the gap handling shows.

`npm run seed:reset` wipes the seeded rows first.

### Just a weight history, on your own account

The full seed is for a throwaway project — it invents four users. If you only
want your own login to have a chart to look at:

```bash
npm run seed:weights -- --email you@example.com
npm run seed:weights -- --email you@example.com --weeks 30 --replace
```

The account has to exist already (sign up in the app first). `--replace`
clears that account's existing weigh-ins instead of adding to them; `--start`
and `--target` set where the trend begins and where it is heading.

> The service-role key bypasses Row Level Security completely. Keep it in your
> shell, never in `.env` — Vite inlines `.env` into the browser bundle — and
> never run this against a project with real users in it.

---

## Step 4. Run it locally

```bash
npm install
npm run test     # 207 tests, should be green before you deploy anything
npm run dev
```

Open the printed URL (usually `http://localhost:5173`).

Walk the full path once:

1. **Join squad** — create an account with a display name.
2. **+ → Weigh in** — log a weight. Check the chart appears on **Me**.
3. **+ → Meal** with a photo — confirm it lands in the feed and the image
   loads (that proves storage RLS and the public bucket are right).
4. **Me → Your FitPlan → build your plan** — fill the intake, tick the
   acknowledgement, generate.
5. You should land on **Me** with a spinner within a second. The card flips to
   *Ready* on its own within a minute or two. Open it.
6. **Tweak this plan** — confirm the counter goes 3 → 2.
7. **Squad tab** — you should see your squad name, a 6-character join code and
   two copy buttons. Open the invite link in a private window and sign up:
   the new account lands in your squad and appears on the leaderboard.
8. **+ → Share tip** — paste a TikTok, Reel or YouTube Short link. "…video
   detected" appears under the field, and the feed card shows a mint play
   button that loads the player when tapped.
9. **Bookmark a tip and a meal** in the feed (your own or a squad-mate's).
   The two boxes at the bottom of **Me** should show the counts; tapping one
   opens the list. Unsaving from that list removes the card immediately.

If step 5 spins forever, the background task is not completing. Check
**Dashboard → Edge Functions → generate-plan → Logs**; the most common causes
are a bad `ANTHROPIC_API_KEY` and an Anthropic account with no credit. After 10
minutes the card recovers into a retry state on its own.

### Optional: run the function locally instead

```bash
supabase start                      # needs Docker
supabase functions serve generate-plan --env-file ./supabase/.env.local
```

Put `ANTHROPIC_API_KEY=sk-ant-...` in `supabase/.env.local` and add that file
to `.gitignore`.

---

## Step 5. Push to GitHub

Your remote is already set to
`https://github.com/devopspractitioner2020-pixel/fitsquad.git`.

```bash
git status                 # confirm .env is NOT listed
git add -A
git commit -m "Harden plan generation, add test suite, fix deploy blockers"
git push -u origin main
```

---

## Step 6. Deploy the frontend to Cloudflare

Cloudflare has folded Pages into **Workers**, so the screens now say "Create a
Worker" and "Set up your application" rather than anything about Pages. This
section matches that flow. Nothing about the app changes — it is still a pile
of static files — but the deploy needs one config file that Pages did not.

### 6.1 Commit `wrangler.jsonc` first

**This step is `git commit` and nothing else — do not run `wrangler` yet.**
Cloudflare runs it for you in 6.6, after it has run the build. Running
`npx wrangler deploy` by hand at this point fails with:

> The directory specified by the "assets.directory" field in your
> configuration file does not exist: …/fit-squad/dist

which is correct and not a misconfiguration: `dist/` is build output, it is
gitignored, and it does not exist until Vite writes it. If you do want to
deploy from your laptop, `npm run deploy` builds first and then uploads —
see 6.6b.

Cloudflare's deploy step reads `wrangler.jsonc` to learn what to upload.
Without it that step fails with **"Missing entry-point"**, which is confusing
because there genuinely is no Worker script — this is a static site.

It is already in the repo root:

```jsonc
{
  "name": "fitsquad",
  "compatibility_date": "2026-08-01",
  "assets": {
    "directory": "./dist/",
    "not_found_handling": "single-page-application"
  }
}
```

`not_found_handling` is what makes client-side routing work: a hard refresh on
`/me` or `/saved/tips` has no file behind it, so Workers serves `index.html`
and React Router takes over. Make sure this file is committed and pushed
before you connect the repo.

### 6.2 Connect the repo

**Workers & Pages → Create → Workers → Import a repository**, then pick
`devopspractitioner2020-pixel/fitsquad`.

### 6.3 Fill in "Set up your application"

Matching the fields on that screen, top to bottom:

| Field | Value |
|---|---|
| **Project name** | `fitsquad` — must match `name` in `wrangler.jsonc` |
| **Build command** | `npm run build` |
| **Deploy command** | `npx wrangler deploy` |
| **Non-production branch deploy command** | `npx wrangler versions upload` (the default is right — it uploads a preview without touching production) |
| **Path** | `/` — the repo root, since `package.json` is there |

### 6.4 API token

Leave **Create new token** selected and the name blank. The blue note —
*"A new token will be created automatically"* — is telling you it will handle
this for you. Nothing to do.

### 6.5 Leave the Variable fields EMPTY — this is the one that catches people

The **Variable name / Variable value** boxes on that setup screen create
**runtime Worker variables**. Your two Supabase values are needed at **build**
time: Vite reads anything prefixed `VITE_` while compiling and bakes the value
straight into the JavaScript bundle. A runtime variable is invisible to a
build that already finished.

Set them in the right place instead, after the first deploy:

**Your Worker → Settings → Build → Build Variables and Secrets**, then add:

```
VITE_SUPABASE_URL        https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY   sb_publishable_...
```

Then **re-deploy** — either push a commit or hit *Retry deployment*. Build
variables only apply to builds that run after they are set, so the first
deploy will always be missing them.

> **How to spot this going wrong:** the site loads and looks perfect, but
> nothing reaches Supabase — sign-in hangs or the console shows requests to
> `https://undefined/...`. That is the build having inlined `undefined` for
> both values. It is not a code problem and no amount of redeploying fixes it
> until the variables are set as *build* variables.

Neither value is a secret. The publishable key does nothing without a valid
session, and Row Level Security governs what any session can read — so plain
Build Variables are fine; there is no need to use the encrypted kind.

### 6.6 Deploy

Hit **Deploy**. The first build takes a couple of minutes. When it finishes
you get a `*.workers.dev` URL.

Check the build log for `npm run build` succeeding and `wrangler deploy`
uploading assets. If the log ends at the deploy step with *"Missing
entry-point"*, `wrangler.jsonc` was not committed — see 6.1.

### 6.6b Deploying by hand from your laptop

Cloudflare's pipeline runs two commands, in this order: **build**, then
**deploy**. Running `npx wrangler deploy` on its own runs the second half
without the first, and fails:

```
✘ ERROR  The directory specified by the "assets.directory" field in your
  configuration file does not exist: /Users/…/fit-squad/dist
```

That is not a misconfiguration. `dist/` is build output — it is in
`.gitignore` and does not exist in a fresh clone or after `git clean`. There
is nothing to upload until Vite has written it. Run both halves:

```bash
npm run deploy
```

which is exactly `npm run build && npx wrangler deploy`. Use the script rather
than typing the two commands: the `&&` is what stops a failed build from
silently shipping the *previous* build's `dist/` to production, and it is the
easiest thing to leave out by hand.

Pushing to `main` is still the normal path — Cloudflare builds and deploys on
its own, and the deployed bundle then matches the commit. A hand deploy ships
whatever is on your laptop right now, including uncommitted edits, so keep it
for testing and let git be the record of what is live.

### 6.7 Confirm the security headers survived

`public/_headers` is copied into `dist/` by Vite, and Workers static assets
honour it, same as Pages did. Verify:

```bash
curl -sI https://fitsquad.YOUR-SUBDOMAIN.workers.dev | grep -i \
  -e content-security-policy -e x-content-type-options -e strict-transport
```

You should see all three. If the CSP is missing, the file did not make it into
`dist/` — check `ls dist/_headers` after a local `npm run build`.

> One Workers-specific caveat that does not apply here: `_headers` does not
> affect responses generated by Worker *code*. This deploy has no Worker code,
> so every response is a static asset and every header applies.

### 6.8 Custom domain

**This step is optional.** The `*.workers.dev` URL from 6.6 is a real, working,
HTTPS site. Everything below is only to put the app on
`fitsquad.inkaitech.com` instead. Skip it and come back later if you want to.

The earlier version of this section was one sentence long and assumed the
hard part was already done. It is not, so here is the whole thing.

#### Why "No zones found" appears

Open **Your Worker → Domains → Add → Custom domain** today and the search box
says *No zones found*. That is not a bug and not a permissions problem: a
**zone** is a domain that Cloudflare runs the DNS for, and `inkaitech.com`
currently points at Hostinger —

```
ns1.dns-parking.com
ns2.dns-parking.com
```

Cloudflare will not offer you a domain it does not serve. A Worker Custom
Domain requires the domain to be an **active zone on the same Cloudflare
account**, and Cloudflare's partial (CNAME-only) setup does not work for
Custom Domains — that is a Business-plan feature and it is excluded here
regardless. So the only route on a free plan is to move the domain's
nameservers from Hostinger to Cloudflare.

Nothing is being taken away from Hostinger. They keep the registration — you
still renew there, and the domain stays yours. Only the DNS lookups move.

#### ⚠️ Read this before you touch anything: your email

Moving nameservers moves **all** DNS for `inkaitech.com`, not just the web
records. Your Hostinger checklist shows a business `@inkaitech.com` mailbox,
and mail routing lives in the `MX` records — plus `SPF`, `DKIM` and `DMARC`
`TXT` records that decide whether your mail is trusted or lands in spam.

If those do not make it across, **email stops working** and it is not obvious
for hours. Cloudflare's importer scans and copies what it can find, but it can
miss records, so verify by hand rather than trusting the scan. Step 3 below is
that check. Do not skip it.

#### 1. Write down your current DNS

In Hostinger: **hPanel → DNS → inkaitech.com → DNS / Nameservers → DNS
records**. Screenshot the whole table, or export it. You want every row:
`A`, `CNAME`, `MX`, `TXT`, `SRV`. This is your reference and your undo.

#### 2. Add the domain to Cloudflare

In the Cloudflare dashboard, **Add a domain** (top of the account home, or
**Websites → Add a domain**). Enter `inkaitech.com` — the apex, no `www`, no
`fitsquad.` prefix. Choose **Free**. Cloudflare scans Hostinger's DNS and
shows you what it found.

#### 3. Check the imported records against your screenshot

Compare row by row. Pay attention to:

- every **MX** record, including its priority number
- the **SPF** `TXT` record — the one starting `v=spf1`
- any **DKIM** `TXT` record — usually on a name like `hostingermail._domainkey`
- the **DMARC** `TXT` record on `_dmarc`
- any `A` or `CNAME` for the existing website and for `www`

Add anything missing by hand before continuing. Nothing has changed yet, so
this is the free moment to get it right.

#### 3b. Turn the orange clouds off first

Cloudflare imports records with **Proxied** (orange cloud) switched on by
default. Proxying means Cloudflare answers DNS for that name with its own IP
and relays the traffic — which only works for HTTP and HTTPS. On anything
else it does not degrade, it breaks:

| Record | Proxy status | Why |
|---|---|---|
| `ftp` | **DNS only** | FTP is not HTTP. Cloudflare will not relay it, and the hostname stops resolving to your server. |
| `autoconfig`, `autodiscover` | **DNS only** | Mail clients use these to find your mail server. Proxied, they answer with Cloudflare's IPs and the wrong certificate. |
| `hostingermail-*`, anything under `_domainkey` | **DNS only** | This is DKIM. A proxied record returns Cloudflare's address instead of the key, so signature checks fail and your mail starts landing in spam. |
| `MX`, `TXT`, `SRV` | not proxyable | No cloud icon at all — nothing to do. |
| `inkaitech.com`, `www` | your call | These are the only genuinely web-facing records. |

**The safest way through this migration is to set every record to DNS only
(grey cloud) before you switch the nameservers.** DNS then behaves exactly as
it does on Hostinger today, so if something breaks afterwards you know it was
the nameserver change and not the proxy. Turn the orange cloud back on for
`inkaitech.com` and `www` later, once you have confirmed the site and email
still work.

If you do proxy the apex, check **SSL/TLS → Overview** is set to **Full** or
**Full (strict)**. **Flexible** makes Cloudflare talk to Hostinger over plain
HTTP, which turns the padlock into a lie.

The record for `fitsquad.inkaitech.com` is a separate matter: Cloudflare
creates it itself in step 6, proxied, and that is correct — a Worker only
runs on proxied traffic. Do not touch that one.

#### 4. Point Hostinger at Cloudflare

Cloudflare gives you two nameservers on the domain's **Overview** page, of the
form `xxxx.ns.cloudflare.com`. Then in Hostinger:

**hPanel → DNS → inkaitech.com → DNS / Nameservers → Change nameservers →
Use custom nameservers**, paste both, save.

That is the same **DNS / Nameservers** screen in your screenshot, where
`ns1.dns-parking.com` is showing now.

If Hostinger has DNSSEC switched on for the domain, turn it off first —
DNSSEC signed by the old nameservers will make the domain unresolvable during
the switch.

#### 5. Wait

Usually under an hour, occasionally up to 24. Cloudflare emails you and the
zone flips to **Active**. Until then the Worker's Custom Domain dialog will
still say *No zones found* — that is the wait, not a failure.

#### 6. Now add the Custom Domain

Back to **Your Worker → Domains → Add → Custom domain**. Type
`fitsquad.inkaitech.com`. The search will now find the zone. Cloudflare
creates the DNS record and issues the TLS certificate itself — no CNAME to
copy, no certificate to request. A few minutes later the site answers on
`https://fitsquad.inkaitech.com`.

Verify:

```bash
curl -sI https://fitsquad.inkaitech.com | head -1     # expect HTTP/2 200
```

And confirm your email still arrives — send yourself one from an outside
address.

#### If you would rather not move the nameservers

Keep using the `*.workers.dev` URL. It is HTTPS, it is fast, and nothing in
the app depends on the domain. You can also add the custom domain months from
now; the only thing that changes is the two values in Step 7 below.

### If you would rather use Pages

Cloudflare Pages still exists and still works for this app — it is a plain
static SPA. **Workers & Pages → Create → Pages → Connect to Git**, framework
preset **Vite**, build command `npm run build`, output directory `dist`, and
add the two `VITE_` variables under **Settings → Environment variables**
(where they are build-time by default, which is why this trap does not exist
on Pages). `wrangler.jsonc` is ignored by Pages and harmless. Cloudflare is
steering new projects to Workers, so the instructions above are the path of
least resistance.

If you do switch, recreate `public/_redirects` with the single line:

```
/*  /index.html  200
```

Pages needs it for deep links and ignores `not_found_handling`; Workers is the
other way round and rejects that exact rule. The two platforms are mutually
exclusive on this one file, which is why it is not simply left in place.

## Step 7. Close the loop after the domain is live

Two things must be updated once you know the final URL:

```bash
# 1. Lock both Edge Functions' CORS to your site
supabase secrets set ALLOWED_ORIGINS="https://fitsquad.inkaitech.com"
supabase functions deploy generate-plan   # redeploy to pick it up
supabase functions deploy resolve-link
```

2. In Supabase, **Authentication → URL Configuration**: set **Site URL** to
   `https://fitsquad.inkaitech.com` and add it to **Redirect URLs**. Without
   this, confirmation and password-reset emails point at `localhost`.

3. Tighten the CSP in `public/_headers`: replace the two `https://*.supabase.co`
   wildcards with your exact project URL, then push.

---

## Step 8. Before you invite anyone

- **Turn email confirmation back on** (Authentication → Providers → Email).
  You turned it off for testing. Migration 0002 is what makes signup work
  correctly with it on.
- **Set an Anthropic spend limit** at console.anthropic.com. The function
  caps each user at 5 plans/day and one plan per 7 days, but a budget alert
  is the backstop that does not depend on your own code being right.
- **Check the plans table after the first few real users** to confirm the
  cooldown is behaving:

  ```sql
  select user_id, count(*), max(created_at)
  from plans group by user_id order by 2 desc;
  ```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Plan card spins forever | Background task died, or key is bad | **Dashboard → Edge Functions → generate-plan → Logs** (no CLI equivalent). After 10 min the card self-recovers into a retry state. |
| `Claude API 404: model not found` | Wrong model ID, or your account lacks access | The model must be an exact published ID. Default is `claude-sonnet-5`. |
| `Claude API 401` | Bad or unset key | `supabase secrets set ANTHROPIC_API_KEY=...` then redeploy. |
| `Claude API 400: credit balance too low` | No Anthropic credit | Top up at console.anthropic.com. |
| Live site can't reach Supabase, console shows `https://undefined/...` | The `VITE_` vars were set as runtime Worker variables, not **Build** Variables | Settings → Build → Build Variables and Secrets, then re-deploy. See §6.5. |
| Deploy fails with "Missing entry-point" | `wrangler.jsonc` not committed | It is a static deploy with no Worker script; wrangler still needs the config. See §6.1. |
| Hard refresh on `/me` 404s | `not_found_handling` missing from `wrangler.jsonc` | Should be `"single-page-application"`. |
| Plan shows as one long document with no tabs | It is a plan generated before the structured-output rewrite | Expected — the app now says so in a banner above it. Generate a fresh plan for the tabbed layout. |
| "n changes left" on load, but clicking generate is refused with a cooldown, and the banner then flips to the cooldown and stays there | The **deployed** `generate-plan` predates the first-plan revision window. The client adopts the server's verdict — correctly, it is the authority — so the screen shows the refusal from then on | `supabase functions deploy generate-plan`, then **Check again** in the banner (or reload). Confirm the row first: `select id,status,is_first_plan,refinements_used,created_at from plans order by created_at desc limit 3;` — `is_first_plan = true` with `refinements_used < 3` means the row allows it and only the deploy was stale. |
| `wrangler deploy`: *the directory specified by the "assets.directory" field … does not exist* | `wrangler deploy` was run on its own. `dist/` is gitignored build output and does not exist until Vite writes it | `npm run deploy` — it builds first, then uploads. See §6.6b. |
| Feed loads but names are blank | Migration 0002 not run | Run it; it backfills existing users. |
| Photos upload but don't display | Bucket not public | `select id, public from storage.buckets where id = 'post-photos';` must be `true`. |
| Deep links 404 on a hard refresh | `not_found_handling` missing from `wrangler.jsonc` | It must be `"single-page-application"`. On Workers this — not `_redirects` — is what serves index.html for `/me` and `/saved/tips`. |
| Deploy uploads every asset, then fails: *Invalid _redirects configuration … Infinite loop detected … code 100324* | A `public/_redirects` containing the Pages SPA fallback `/*  /index.html  200`. Workers rejects it: it already normalises `/index.html`, so the rule rematches its own output | Delete `public/_redirects`. `not_found_handling` in `wrangler.jsonc` does the same job on Workers. The failure comes at the very last API call, after a successful upload, which makes it look like an outage rather than a config error. |
| Feed suddenly empty after 0004 | You and your squad-mates are in different squads | `select * from my_squads();` then share the join code. The backfill only runs when no memberships exist yet. |
| Video embed is a blank black box | CSP `frame-src` missing that host | `public/_headers` lists tiktok / instagram / youtube-nocookie. CSP frame blocks are near-silent — this is almost always the cause. |
| "That link isn't recognised" for a good link | It is a profile link, not a video | The field now says so specifically. Open the video itself → Share → Copy link. |
| Short link posts but shows a tap-through card | `resolve-link` not deployed, or TikTok refused | `supabase functions deploy resolve-link`, then check the curl below. The post is never lost over this. |
| Worker → Domains → Add → Custom domain says *No zones found* | `inkaitech.com` is not a Cloudflare zone — its nameservers still point at Hostinger (`ns*.dns-parking.com`) | Add the domain to Cloudflare and move the nameservers. Custom Domains need an active zone on the same account; partial/CNAME setup is not supported for them. Full walkthrough in §6.8. |
| Email stops arriving after moving nameservers | The `MX` / `SPF` / `DKIM` / `DMARC` records did not come across in Cloudflare's import | Re-add them in Cloudflare DNS from the screenshot you took in §6.8 step 1. Mail routing is DNS; moving nameservers moves it. |
| Squad tab shows no join code and no member count, on one account but not another | That account has no `squad_members` row — created before the 0004 signup trigger existed, or it left its last squad | Run `0007_squad_for_everyone.sql`. The screen also has a **Create my squad** button now, which fixes it from the app without any SQL. |
| Join code says no squad found | Code typed with an O or l | The alphabet excludes `0 O 1 I L` deliberately. Re-read the code. |
| Saving does nothing, console shows `404` on `/rest/v1/saved_posts` | Migration 0006 not run | Run `0006_saved_posts.sql`. A PostgREST 404 on a collection means the relation is not in its schema cache. The app now says this in the card rather than only in the console. |
| Saving still 404s right after running 0006 | Stale PostgREST schema cache | Rare — Supabase reloads automatically. Force it with `notify pgrst, 'reload schema';` in the SQL editor. |
| `git add` fails: `Unable to create '.git/index.lock': File exists` | A stale lock, not a running git | `pgrep git` to confirm nothing is running, then `rm -f .git/index.lock`. A zero-byte lock means nothing was part-written, so nothing is at risk. |
| `Tweak this plan` missing on an old plan | Legacy HTML plan, no JSON to refine | Expected. Generate a fresh plan; the button returns. |
| `The generated plan was incomplete: ...` | Model omitted a required part | Now caught before storing. Regenerate; it is usually transient. |
| Plan opens but looks unstyled | `plans.data` missing → legacy iframe path | Run migration 0003, then regenerate. |
| CORS error in the browser console | `ALLOWED_ORIGINS` doesn't include your site | Set it to the exact origin, scheme included, no trailing slash. |

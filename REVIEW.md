# Fit Squad — code review, test assessment and security scan

Reviewed at commit `73a7116` ("Initial commit"), July 2026. Scope: the whole
repository — React frontend, Supabase schema and RLS, the `generate-plan` Edge
Function, and deployment configuration.

**Verdict before this pass: not deployable.** The plan-generation flow did not
work the way its own README describes, and the way it actually worked was
fragile in a manner that failed silently and permanently. There were also no
tests of any kind, and no server-side limit on a feature that spends money per
call.

**After this pass:** the blockers are fixed, 128 tests cover the logic that
matters, and the deployment path is documented end to end in `DEPLOY.md`. Six
medium-severity issues are documented below but deliberately left unfixed —
they need product decisions from you, not just code.

> **Correction (second pass).** An earlier draft of this document claimed the
> model ID `claude-sonnet-5` did not exist and that generation therefore
> failed 100% of the time. That was wrong. `claude-sonnet-5` is current and
> correct — 1M context, 128k max output — and it is what the code now uses. I
> had checked a stale mirror of the model list rather than the official docs,
> which were briefly unreachable at the time. The original code was right on
> this point and I changed it in error; it has been changed back. The
> withdrawal is written up in §2.1 rather than deleted, because the
> consequences for the other findings matter.

---

## 1. What the project is

A phone-shaped social fitness app for a small group of friends. Members log
workouts, meals (with camera photos), weigh-ins and tips into a shared feed;
a leaderboard ranks them by healthy meals plus workouts; and each member can
generate a personalised training-and-nutrition plan written by Claude from a
21-question intake form.

The architecture is sound and the key handling is right. Static React on
Cloudflare Pages holds only the Supabase URL and anon key, both public by
design and governed by Row Level Security. The Anthropic key lives solely in
a Supabase Edge Function secret. The browser asks the function to make a
plan; the function calls Claude and writes the result back to Postgres. That
separation is exactly correct and the README explains it well.

The plan flow is modelled as a state machine on a `plans` row —
`generating → ready | error` — with the UI polling. That is the right shape
for the problem. The bugs below are all in the execution, not the design.

---

## 2. Blockers found and fixed

### 2.1 ~~The Claude model ID does not exist~~ — WITHDRAWN, my error

**This finding was wrong and has been retracted.** `claude-sonnet-5` is a
valid, current model ID — 1M context window, 128k max output, adaptive
thinking — and it is the best Sonnet available. The original code was correct.

I reported it as nonexistent because the official model list at
platform.claude.com returned a server error when I tried to read it, and I
fell back to a third-party mirror of the model table that only went up to the
4.x generation. I should have retried the authoritative source or flagged the
uncertainty instead of treating a fallback as confirmation. Reporting a
working line of code as the single thing breaking the product is a bad failure
mode, and the fact that the rest of the review was accurate does not excuse it.

The model is back to `claude-sonnet-5`, still overridable via an
`ANTHROPIC_MODEL` secret if you ever want to pin something else without a
redeploy of the code.

**This makes the findings below more serious, not less.** If generation had
genuinely been failing at the API call, most requests would have died in a
second or two and §2.2's timeout risk would have been academic. Because
generation actually *succeeds*, every request really did hold an HTTP
connection open for 30–90 seconds against a 150-second budget — so §2.2, §2.3
and §2.4 describe what would have happened to real users on real plans.

The one thing worth carrying forward: a model ID is a string the code cannot
validate for you, and a wrong one fails identically to an expired key. §2.5 of
`DEPLOY.md` has you curl the deployed function and read `plans.error_message`
before touching the frontend, which surfaces either failure in about a minute.

### 2.2 The whole polling architecture was decorative

The README describes the function as inserting a `generating` row and
returning immediately, with the UI polling until the row flips. The code did
not do that. It `await`ed the Claude call inside the request handler and only
responded once the plan was complete — 30 to 90 seconds later.

So `await generatePlan(f)` in the intake screen blocked for the entire
generation. The "Starting…" spinner sat there the whole time. The user never
reached the Me screen while the plan was generating, so the polling code they
were meant to see never ran.

Worse, this is fragile in a way that fails silently. Supabase Edge Functions
have a 150-second wall-clock budget on the free plan and a 150-second request
idle timeout. A slow generation exceeds that, the worker is killed, and the
row stays `generating` **forever** — see §2.3.

Fixed: the function now inserts the row, hands the Claude call to
`EdgeRuntime.waitUntil()`, and returns `202 {planId, status:'generating'}` in
about 200ms. The background task writes the result when it finishes.
`supabase/config.toml` sets `policy = "per_worker"`, without which background
tasks are killed when the response is sent.

### 2.3 A killed worker locked the user out of the feature permanently

Three separate consequences flowed from a row stuck in `generating`:

- `Me` and `PlanView` polled every 3 seconds against a status that could never
  change. An infinite background poll, forever.
- `PlanCard` rendered the spinner branch with no button, so there was no way
  out of the screen except the nav bar.
- `daysUntilRegen()` measured the cooldown from the latest plan *of any
  status*, so the stuck row also blocked regeneration for seven days.

Fixed with a single concept, `effectiveStatus()`, in the new
`src/lib/rules.js`: a `generating` row older than 10 minutes is reported as
`error`. The polls terminate, the card offers a retry, and the cooldown does
not apply. Migration 0002 adds a `fail_stuck_plans()` function so the stored
state can be swept to match, schedulable with pg_cron.

### 2.4 The cooldown counted failures, so "try again" was a dead end

Independent of §2.3: because `daysUntilRegen()` keyed off the latest plan
regardless of status, a *failed* generation started a 7-day lockout. The error
card said "Tap to review your info and try again", the user tapped it, and the
intake form told them to come back in a week.

This bites on any failure — a timed-out worker (§2.2), a transient Anthropic
error, a moment with no credit on the account. One unlucky attempt, then a week
locked out of the headline feature, with the UI actively inviting a retry it
would then refuse.

Fixed: the cooldown now runs only from a plan that reached `ready`, on both
the client and the server. Four regression tests pin this.

### 2.5 No server-side rate limit on a feature that spends money

The README listed "consider rate-limiting `generate-plan` per user" as a
future note. It was the only thing standing between your Anthropic balance and
anyone on the internet.

The anon key is public by design, signup is open, and the function accepted
`mode: 'generate'` with no limit of any kind. The 7-day cooldown existed only
as a disabled button in the browser — trivially bypassed by calling the
function directly with a valid JWT from a throwaway account. Each call is a
16k-token generation.

Fixed, in `logic.ts` so it is unit-testable:

- one generation in flight at a time (stale rows excluded), `409`
- maximum 5 attempts per user per rolling 24 hours, `429`
- the 7-day cooldown, enforced server-side, `429` with `daysLeft`

`src/lib/api.js` now unwraps `FunctionsHttpError` so the server's message
reaches the user instead of "Edge Function returned a non-2xx status code".

### 2.6 Unvalidated intake went straight into the prompt

`buildUserMessage()` interpolated the client-supplied `intake` object with no
whitelist and no length cap. Two problems: any extra key could be smuggled in,
and a caller could POST megabytes of text and have you pay to tokenise it.

Fixed: `sanitizeIntake()` accepts only the 21 known fields, coerces to string,
trims, and caps each at 2000 characters. Refinement requests are capped at
1000 and now arrive fenced in `<change_request>` tags with an explicit
instruction that their contents are data, not instructions.

### 2.7 Truncated plans were stored and presented as finished

`callClaude()` never checked `stop_reason`. At `max_tokens: 8000`, a rich HTML
plan with a 7-day meal table, an SVG pie chart and a supplement table can
plausibly run over. The response would be cut mid-tag, stored, and marked
`ready` — the user opens their plan and it stops in the middle of Thursday.

Fixed: `stop_reason === 'max_tokens'` now raises an error and the row goes to
`error` with a message telling the user to retry. `max_tokens` raised from
8000 to 16000 — Sonnet 5 allows up to 128k, but 16k is ample headroom for a
single-file HTML document without paying for latency you don't need, and the
check now catches it loudly if a plan ever outgrows that. An empty response is
also caught rather than stored as a blank plan.

### 2.8 The plan iframe was one attribute away from full account takeover

```jsx
<iframe sandbox="allow-same-origin" srcDoc={plan.html} />
```

The rendered HTML is model-authored, so it is untrusted input. As written this
was not exploitable — `allow-same-origin` without `allow-scripts` still blocks
JavaScript. But it granted the frame *this app's origin*, so the day anyone
added `allow-scripts` to fix a rendering issue, injected script would run with
access to `localStorage` and therefore the Supabase session token.

Fixed: `sandbox=""` — empty, not omitted, which opts in to every restriction
including an opaque origin — plus `referrerPolicy="no-referrer"`, plus a
comment explaining why `allow-scripts` must never be added.

### 2.9 Thirty-seven Tailwind classes compiled to nothing

`font-800`, `font-700`, `font-600` and `font-400` are not Tailwind classes.
The default scale is named (`font-bold`, `font-extrabold`). Confirmed by
inspecting the built CSS: no `.font-700 { font-weight: 700 }` rule was
generated, and the only `font-weight` declarations in the entire bundle came
from the three hand-written rules in `index.css`.

Because Tailwind's preflight resets `h1`–`h6` to `font-weight: inherit`, every
heading in the app — including the 42px "Squad Feed" and "Leaderboard"
titles — rendered at weight 400. The app did not look like the design you
validated in Lovable, and nothing errored to tell you.

Fixed by adding the numeric scale to `tailwind.config.js`, so all 37 usages
work as written. Also fixed: `bg-mint/12` and `bg-[#ff8bd0]/12` on the feed's
healthy/cheat pills — 12 is not on Tailwind's opacity scale, so those pills
had no background at all. Now `/[0.12]`.

### 2.10 Signup created no profile once email confirmation is on

`AuthContext.signUp()` called `supabase.auth.signUp()` and then inserted the
`profiles` row from the browser. With confirmation off — which the README
tells you to do for testing — there is a session immediately and it works.

Turn confirmation on for production and there is no session at that moment, so
the insert is rejected by RLS. The return value was not checked, so it failed
silently. The user would have no profile: blank name on the feed, blank on the
leaderboard, and `author_name` falling back to the literal string `'You'` on
every post they make.

Fixed: `display_name` now travels in `options.data`, and migration 0002 adds
an `on_auth_user_created` trigger that creates the profile server-side, with a
backfill for existing users.

---

## 3. Security scan

### Dependencies

`npm audit` on the original tree: **4 vulnerabilities (1 high, 3 moderate)**.

| Package | Severity | Issue |
|---|---|---|
| vite ≤6.4.2 | high | Path traversal in optimized-deps `.map` handling; `server.fs.deny` bypass |
| esbuild ≤0.24.2 | moderate | Dev server accepts cross-origin requests |
| react-router 6.0.0–7.17.0 | moderate | Open redirect via backslash in `<Link>`/`useNavigate` (CVE-2025-68470 bypass) |
| react-router-dom | moderate | Depends on the above |

The vite and esbuild issues affect the dev server only, not the Cloudflare
Pages build output. The react-router open redirect ships to production, though
this app never navigates to a user-controlled path — every target is a
hard-coded literal.

Upgraded to vite 8, `@vitejs/plugin-react` 6, vitest 4 and react-router-dom
7.18.1. All 128 tests and the production build pass on the new tree.

**One residual advisory**, disclosed rather than hidden: react-router 7.12.0
onwards carries a high-severity *RSC Mode CSRF bypass*. React Server
Components mode is not used here — this is a client-only SPA using
`BrowserRouter` — so the advisory is not reachable. The alternative is
downgrading to 7.11.0, which reintroduces the open redirect that *is*
theoretically reachable in a SPA. Staying on 7.18.1 is the better trade.
Re-evaluate when a patched release lands.

### Secrets

Clean. No hardcoded credentials anywhere in the tree; `grep` for
`sk-ant-`, JWT-shaped strings, AWS keys and PEM blocks found only
documentation references. `.env` has never been committed — git history
contains one commit and `.env.example` is the only env file in it. `src/`
contains no reference to `ANTHROPIC` or `SERVICE_ROLE`, so nothing
server-side can leak into the browser bundle.

### Row Level Security

Generally well done. Every table has RLS enabled with owner-scoped writes, and
the `plans` table correctly has no client write policy at all — only the
service-role key inside the function can write plan rows. Storage is
namespaced by user id with a matching policy, so a user cannot write into
another user's folder.

Notes:

- `weigh_ins` are readable by every signed-in member. Deliberate, documented,
  and correct for a friends-only squad — but it does mean everyone can see
  everyone's weight. If that is not what you want, the schema comments already
  tell you the one-line change.
- The `post-photos` bucket is public-read. Meal and progress photos are
  therefore readable by anyone holding the URL. Paths contain a UUID so they
  are unguessable, and this is required for the feed to work simply — but it
  is worth knowing.
- `plans` and `intakes` are correctly owner-only.

### Edge Function

CORS was `Access-Control-Allow-Origin: *`. Now driven by an `ALLOWED_ORIGINS`
secret, echoing only allowlisted origins and never reflecting an unknown one.
JWT verification is on and the function independently re-checks the user.
Refinement looks the plan up filtered by `user_id`, so another user's `planId`
is indistinguishable from a missing one — a clean 404 either way. Internal
errors are logged server-side and returned to the browser as a generic
message rather than a stack trace.

### Headers

There were none. Added `public/_headers` with a Content-Security-Policy
scoped to what the app actually loads, plus `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` and HSTS.
`frame-ancestors 'none'` and `base-uri 'none'` are the two that matter most
for an app holding a session token.

### Input constraints

Migration 0002 adds what the schema was missing: weights bounded to
20–400 kg (the original accepted 0 and negatives, which would have corrupted
the chart and the leaderboard permanently, since there was also no UPDATE or
DELETE policy to fix a mistake), workout minutes bounded to 1–1440,
`photo_url` constrained to `^https?://`, and length caps on `title` and
`note`.

---

## 4. Test coverage

### Before

None. No test framework, no test files, no CI, no linter. Nothing in the
repository would have caught any of the ten blockers above — including the
model ID, which is a one-line typo that disabled the product's headline
feature.

### After

**128 tests across 8 files**, run with `npm test`, no live Supabase or
Anthropic account required.

| File | Tests | What it protects |
|---|---:|---|
| `src/lib/__tests__/rules.test.js` | 23 | Cooldown maths, staleness, refinement budget, status derivation |
| `src/lib/__tests__/edge-logic.test.js` | 34 | Rate limits, intake sanitisation, refine guards, response parsing, CORS |
| `src/lib/__tests__/api.test.js` | 13 | Function invocation contract, error unwrapping, plan fetching |
| `src/lib/__tests__/prompt.test.js` | 10 | Every intake field reaches the prompt; safety rails present |
| `src/lib/__tests__/image.test.js` | 14 | Resize maths, JPEG re-encode, white matte, upload path namespacing |
| `src/components/__tests__/LogModal.test.jsx` | 15 | Every write path into `posts` and `weigh_ins` |
| `src/screens/__tests__/Intake.test.jsx` | 12 | The gate in front of every Claude call |
| `src/screens/__tests__/PlanCard.test.jsx` | 7 | The plan state machine, including the stuck-row recovery |

The design principle: business rules were extracted into two pure modules —
`src/lib/rules.js` for the client and
`supabase/functions/generate-plan/logic.ts` for the server — so the rules that
gate access and spend can be tested exhaustively without mocking a network.
`index.ts` is now a thin I/O shell around `logic.ts`.

Nine tests are explicit regression tests, each commented with the bug it pins.
The ones worth knowing about:

- a failed generation must not start a cooldown (§2.4)
- a stale `generating` row must present as retryable (§2.3)
- a truncated Claude response must not be stored as ready (§2.7)
- a cheat meal must never count as healthy, or the leaderboard is farmable
- unknown intake keys must never reach the prompt (§2.6)
- the prompt builder must render a line for every whitelisted field — so
  adding a question to the form without wiring it through fails loudly

That last one is the pattern worth repeating: it is a test that fails when
someone does half a job, not when someone writes a bug.

### Two bugs the tests found while being written

- **Form labels were not associated with their inputs.** Every `<label>` was a
  sibling of its control with no `htmlFor` or nesting, so screen readers
  announced 21 unlabelled boxes on the intake form. Testing Library could not
  find them either, which is how it surfaced. Fixed by nesting controls inside
  their labels in `LogModal`, `Intake`, `Auth` and `PlanView`.
- **Load effects keyed off object identity.** `Intake`, `Me` and `PlanView`
  had `useEffect(..., [user])`. A mocked auth context returning a fresh object
  each render sent the intake screen into an infinite render loop, which is
  exactly what a token refresh producing a new session object would do in
  production. Changed to `[user?.id]`.

### What is still not covered

Honest gaps, in rough priority order:

1. **No end-to-end test.** Nothing exercises signup → intake → generate →
   view against a real Supabase. The `--isolation + Playwright` option was
   offered and not taken; it needs Docker and the Supabase CLI. Worth adding
   before the squad grows.
2. **RLS policies are untested.** The tests assert application logic, not that
   the database actually refuses a cross-user read. That needs a live
   Postgres. `supabase test db` with pgTAP is the tool.
3. **`Feed` and `Squad` aggregation are untested**, because they have known
   bugs (§5) that should be fixed first — testing them now would pin the wrong
   behaviour.
4. **No CI.** The tests only help if they run. A five-line GitHub Actions
   workflow running `npm ci && npm test && npm run build` on every push would
   close this.
5. **No linter.** ESLint would have caught the unused `Eyebrow`/`Card` exports
   and the missing effect dependencies.

---

## 5. Medium-severity issues, documented but not fixed

These need a decision from you rather than an obvious correction, so they were
left alone deliberately.

**The leaderboard's weight column ignores the range toggle.** `Squad.jsx`
filters posts by the selected range but queries `weigh_ins` with no date
filter at all, so "This week" shows all-time weight change. Separately, the
leaderboard is built by iterating posts, so a member who logs weigh-ins but no
posts does not appear at all.

**`author_name` is denormalised and client-supplied.** RLS checks `user_id`
but not `author_name`, so a crafted insert can post under any name. It also
means changing your display name does not update your existing posts. The fix
is to drop the column and join `profiles`, which is also what the README
suggests for the leaderboard.

**The `intakes` table is written but never read.** `Intake.saveIntake()`
upserts to it on every save; nothing anywhere queries it. The pre-fill on
regeneration reads `plans.intake` instead. Either wire it up or drop it —
right now it is a second copy of personal data with no purpose.

**Feed reactions and comments are non-functional.** Four emoji buttons and a
"Comment" button render and do nothing. For a friends' app, silently dead
social buttons are worse than absent ones.

**`URL.createObjectURL` is never revoked.** `PhotoField` creates a new object
URL on every render and never calls `revokeObjectURL`, leaking a blob per
render while the photo sheet is open.

**The bundle is 800 KB (224 KB gzipped) in one chunk.** Recharts is most of
it, and it is used on exactly one screen. A `React.lazy` boundary around the
weight chart would cut the initial download substantially — this is a
phone-first app.

Minor, for completeness: a photo is uploaded before the weight field is
validated, so a rejected weigh-in still leaves an orphaned object in storage;
`App.jsx` remounts the entire route tree via `key={refreshKey}` after every
log, discarding all screen state; and `timeAgo()` will render "0 min ago" as
"1 min ago" but produces nonsense for any future-dated row.

---

## 6. Files changed

**Fixed:** `supabase/functions/generate-plan/index.ts` (rewritten as an I/O
shell; model left as `claude-sonnet-5` per §2.1), `src/lib/api.js`, `src/screens/Me.jsx`, `src/screens/PlanView.jsx`,
`src/screens/Intake.jsx`, `src/screens/Auth.jsx`, `src/screens/Feed.jsx`,
`src/components/LogModal.jsx`, `src/context/AuthContext.jsx`,
`tailwind.config.js`, `supabase/schema.sql` (made re-runnable),
`package.json`, `package-lock.json`.

**Added:** `src/lib/rules.js`,
`supabase/functions/generate-plan/logic.ts`, `supabase/config.toml`,
`supabase/migrations/0002_hardening.sql`, `public/_headers`,
`vitest.config.js`, `test/setup.js`, eight test files, `DEPLOY.md`, this file.

**Verification:** `npm test` → 128 passed. `npm run build` → clean.
`npm audit` → 1 residual advisory, analysed in §3.

---

## 7. What to do next

1. Run `supabase/migrations/0002_hardening.sql` — do this before anything
   else, it fixes signup.
2. Follow `DEPLOY.md` from step 2. Don't skip the curl smoke test in §2.5 — it
   confirms the model, the key and the background task in about a minute,
   before any frontend work can confuse the picture.
3. Set an Anthropic spend limit in the console. Your code now limits usage,
   but a budget alert does not depend on your code being right.
4. Add CI before the second contributor. Five lines, and it is what makes the
   128 tests actually worth having.
5. Decide on the §5 items — particularly `author_name`, since changing it
   later means migrating existing rows.

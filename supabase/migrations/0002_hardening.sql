-- ============================================================
-- Fit Squad — migration 0002: correctness + safety hardening
--
-- Run this AFTER supabase/schema.sql, in the SQL editor (or via
-- `supabase db push`). It is idempotent — safe to run more than once.
--
-- What it fixes:
--   1. Profiles were created client-side after signUp(). With email
--      confirmation ON there is no session at that moment, so the insert
--      was silently rejected by RLS and the user ended up with no profile
--      (blank name on the feed and leaderboard). A trigger on auth.users
--      now creates the row server-side, every time.
--   2. Weigh-ins could be inserted but never corrected or removed, so a
--      single fat-fingered entry permanently skewed "change since start"
--      and the leaderboard.
--   3. No sanity constraints on user-supplied numbers.
--   4. Plans stuck in 'generating' (worker killed mid-flight) blocked the
--      user forever. The app now treats them as stale, and this adds a
--      server-side sweep you can schedule.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Create the profile row from a database trigger
-- ------------------------------------------------------------
-- display_name comes from the signUp options.data payload; fall back to the
-- local part of the email so the column is never empty.
-- ⚠️  DO NOT RE-RUN THIS FILE ON ITS OWN.
--
-- This version of handle_new_user() creates a profile and nothing else.
-- 0004 replaced it with a version that also resolves the signup join_code
-- into a squad membership, and 0009 replaced that again. `create or replace`
-- means the last one to run wins, so re-running THIS file silently reverts
-- new signups to landing in no squad at all — with no error and no warning.
-- That is exactly how two real users ended up squadless.
--
-- If you have run this file since 0004, run 0009_signup_squad_fix.sql. It
-- restores the correct trigger and backfills anyone who was missed.
--
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this trigger existed.
insert into public.profiles (id, display_name)
select u.id,
       coalesce(
         nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
         split_part(u.email, '@', 1)
       )
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- 2. Let people correct their own weigh-ins
-- ------------------------------------------------------------
drop policy if exists "update own weighins" on public.weigh_ins;
create policy "update own weighins"
  on public.weigh_ins for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own weighins" on public.weigh_ins;
create policy "delete own weighins"
  on public.weigh_ins for delete to authenticated
  using (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 3. Sanity constraints on user-supplied numbers
-- ------------------------------------------------------------
-- A human weight in kg. Rejects 0, negatives and typos like 7450.
alter table public.weigh_ins drop constraint if exists weigh_ins_weight_sane;
alter table public.weigh_ins add constraint weigh_ins_weight_sane
  check (weight_kg > 20 and weight_kg < 400);

-- Workout minutes must be positive and can't exceed a day.
alter table public.posts drop constraint if exists posts_minutes_sane;
alter table public.posts add constraint posts_minutes_sane
  check (minutes is null or (minutes > 0 and minutes <= 1440));

-- photo_url is written by the client. Constrain it to http(s) so a post can
-- never carry a javascript: or data: URL into an <img src>.
alter table public.posts drop constraint if exists posts_photo_url_scheme;
alter table public.posts add constraint posts_photo_url_scheme
  check (photo_url is null or photo_url ~ '^https?://');

-- Bound the free-text columns so one user can't push megabytes into the feed.
alter table public.posts drop constraint if exists posts_text_lengths;
alter table public.posts add constraint posts_text_lengths
  check (length(title) <= 300 and (note is null or length(note) <= 2000));


-- ------------------------------------------------------------
-- 4. Sweep plans whose worker died mid-generation
-- ------------------------------------------------------------
-- The app already treats a 'generating' row older than 10 minutes as failed,
-- so this is belt-and-braces: it makes the stored state match what the UI
-- shows. Schedule it with pg_cron if you have the extension enabled:
--
--   select cron.schedule('sweep-stuck-plans', '*/15 * * * *',
--                        $$select public.fail_stuck_plans()$$);
create or replace function public.fail_stuck_plans()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.plans
     set status = 'error',
         error_message = coalesce(error_message,
           'Generation timed out. Please try again.')
   where status = 'generating'
     and created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.fail_stuck_plans() from public, anon, authenticated;


-- ------------------------------------------------------------
-- 5. Index supporting the feed's "last 7 days" query
-- ------------------------------------------------------------
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists weigh_ins_user_created_idx
  on public.weigh_ins (user_id, created_at);

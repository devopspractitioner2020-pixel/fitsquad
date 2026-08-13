-- ============================================================
-- Fit Squad — migration 0012: editing your own posts, and the weekly recap
--
-- Run after 0011. Idempotent.
-- ============================================================

-- ---------- EDITING A POST ----------
-- `posts` has had insert and delete policies since schema.sql and no UPDATE
-- policy at all, so editing was impossible at the database level, not just
-- missing from the screen. A typo in a meal title could only be fixed by
-- deleting the post and losing its reactions and comments with it.
--
-- USING and WITH CHECK both, deliberately. USING alone would let you edit
-- your own row and set `user_id` to somebody else's on the way out — giving
-- away a post, and with it every reaction attached to it.
drop policy if exists "update own posts" on public.posts;
create policy "update own posts"
  on public.posts for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- So a card can say "edited" rather than quietly changing under a reader who
-- already replied to it.
alter table public.posts
  add column if not exists edited_at timestamptz;


-- ---------- THE WEEKLY RECAP ----------
--
-- WHY THIS IS COMPUTED, NOT STORED
--
-- The ask was "generate it Sundays at 6pm". The obvious build is a cron job
-- writing a row every Sunday — and then the recap is only as reliable as the
-- job. A missed run is a week with no recap and nothing to look at, and the
-- failure is invisible until someone asks where their week went.
--
-- This computes the week on demand from the posts, reactions and weigh-ins
-- that are already there, and gates VISIBILITY on Sunday 18:00. The result
-- from the reader's side is exactly what was asked for — nothing to see
-- until Sunday evening, then the week appears — but there is no job to fail,
-- no backfill to write, and a recap from three months ago still renders
-- because it is derived from data that never went anywhere.
--
-- If you later want it materialised (to send a push notification, say), the
-- pg_cron recipe is in DEPLOY.md and it calls this same function.

-- Monday 00:00 of the week containing `ts`, in the squad's reference time.
-- Matches weekStartMs in src/lib/weight.js: same week boundary everywhere,
-- so the chart and the recap never disagree about which week it is.
create or replace function public.week_start(ts timestamptz default now())
returns date
language sql
immutable
as $$
  select (date_trunc('week', ts at time zone 'UTC'))::date;
$$;

-- When a given week's recap becomes visible: Sunday 18:00 UTC, which is the
-- seventh day of a Monday-start week.
create or replace function public.recap_available_at(wk date)
returns timestamptz
language sql
immutable
as $$
  select ((wk + 6) + time '18:00') at time zone 'UTC';
$$;

-- NOTE: SUPERSEDED by 0014_recap_variety.sql, which returns the best post of
-- each KIND instead of the top three overall. `create or replace` means the
-- last one to run wins, so re-running THIS file on its own reverts the recap
-- to three cards all captioned "Most loved". If you re-run it, run 0014
-- afterwards.
/**
 * One week of a squad, as a JSON object the app renders as stories.
 *
 * Returns null when the week is not out yet, so "too early" and "no data"
 * stay distinguishable — one is a wait, the other is an empty week, and they
 * deserve different screens.
 */
create or replace function public.squad_recap(sid uuid, wk date default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  week_from date := coalesce(wk, public.week_start(now() - interval '7 days'));
  starts timestamptz;
  ends timestamptz;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
  if not public.is_squad_member(sid) then
    raise exception 'Not a member of that squad.';
  end if;
  if now() < public.recap_available_at(week_from) then
    return null;
  end if;

  starts := week_from::timestamptz;
  ends := (week_from + 7)::timestamptz;

  with members as (
    select m.user_id,
           coalesce(nullif(trim(p.display_name), ''), 'Squad member') as name
    from squad_members m
    left join profiles p on p.id = m.user_id
    where m.squad_id = sid
  ),
  week_posts as (
    select po.*, me.name
    from posts po join members me on me.user_id = po.user_id
    where po.created_at >= starts and po.created_at < ends
  ),
  week_weighs as (
    select w.*, me.name
    from weigh_ins w join members me on me.user_id = w.user_id
    where w.created_at >= starts and w.created_at < ends
  ),
  reaction_counts as (
    select r.post_id, count(*) as n
    from reactions r join week_posts wp on wp.id = r.post_id
    group by r.post_id
  ),
  totals as (
    select
      (select count(*) from week_posts where kind = 'workout') as workouts,
      (select count(*) from week_posts where kind = 'meal' and is_healthy) as healthy_meals,
      (select count(*) from week_posts where is_cheat) as cheats,
      (select count(*) from week_posts where kind = 'tip') as tips,
      (select count(*) from week_weighs) as weigh_ins,
      (select coalesce(sum(n), 0) from reaction_counts) as reactions,
      (select count(*) from comments c join week_posts wp on wp.id = c.post_id) as comments,
      (select count(*) from members) as members
  ),
  per_person as (
    select me.name,
           count(*) filter (where wp.kind in ('workout', 'meal')) as logs
    from members me left join week_posts wp on wp.user_id = me.user_id
    group by me.user_id, me.name
  ),
  -- First and last reading each, so a week with one weigh-in counts as no
  -- change rather than as a mystery.
  weight_moves as (
    select
      name,
      (array_agg(weight_kg order by created_at desc))[1]
        - (array_agg(weight_kg order by created_at))[1] as delta,
      count(*) as readings
    from week_weighs
    group by user_id, name
  ),
  top_posts as (
    select wp.id, wp.kind, wp.title, wp.name as author, wp.photo_url,
           wp.created_at, coalesce(rc.n, 0) as reactions
    from week_posts wp
    left join reaction_counts rc on rc.post_id = wp.id
    where coalesce(rc.n, 0) > 0
    order by coalesce(rc.n, 0) desc, wp.created_at desc
    limit 3
  )
  select jsonb_build_object(
    'week_start', week_from,
    'week_end', week_from + 6,
    'squad_id', sid,
    'squad_name', (select name from squads where id = sid),
    'totals', (select to_jsonb(t) from totals t),
    'leaderboard', coalesce(
      (select jsonb_agg(to_jsonb(x) order by x.logs desc, x.name)
       from (select name, logs from per_person) x), '[]'::jsonb),
    'top_logger', (
      select to_jsonb(x) from (
        select name, logs from per_person where logs > 0
        order by logs desc, name limit 1
      ) x),
    'biggest_drop', (
      select to_jsonb(x) from (
        select name, round(delta::numeric, 1) as delta from weight_moves
        where readings > 1 and delta < 0
        order by delta asc limit 1
      ) x),
    'top_posts', coalesce((select jsonb_agg(to_jsonb(tp)) from top_posts tp), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.squad_recap(uuid, date) from public, anon;
revoke all on function public.week_start(timestamptz) from public, anon;
revoke all on function public.recap_available_at(date) from public, anon;
grant execute on function public.squad_recap(uuid, date) to authenticated;
grant execute on function public.week_start(timestamptz) to authenticated;
grant execute on function public.recap_available_at(date) to authenticated;

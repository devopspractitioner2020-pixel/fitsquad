-- ============================================================
-- Fit Squad — migration 0015: recap cards that show the post
--
-- Run after 0014. Idempotent.
--
-- THREE THINGS WRONG WITH THE LAST ONE
--
-- 1. "Most loved" and "Best plate" were indistinguishable. 0014 returned the
--    best post overall AND the best of each kind, so when the week's top post
--    was a meal — which it usually is, most of what gets posted is food — the
--    story showed two meal cards captioned "Most loved" and "Best plate" and
--    no reader could say what separated them. The overall winner is dropped:
--    three cards, one per kind, each unambiguous. The best meal IS the most
--    loved meal; it does not need a second card saying so.
--
-- 2. "2 reactions" told you the number and hid the thing itself. Which two?
--    🔥 and 🤤 say something a count cannot. The breakdown comes back now.
--
-- 3. A tip whose content is an Instagram video rendered as its title and
--    nothing else — a card reading "Dinner" for a post that was a video of
--    somebody making dinner. `video_url` comes back so the card can show the
--    actual embed rather than a word.
-- ============================================================

-- NOTE: this REPLACES the squad_recap() from 0014_recap_variety.sql, which
-- replaced 0012's. `create or replace` means the last one to run wins, so
-- re-running either of those on its own reverts the recap. If you re-run one,
-- run this file afterwards.
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
  -- WHICH reactions, not just how many. `{"🔥": 2, "🤤": 1}`.
  reaction_breakdown as (
    select post_id, jsonb_object_agg(emoji, n) as by_emoji
    from (
      select r.post_id, r.emoji, count(*) as n
      from reactions r join week_posts wp on wp.id = r.post_id
      group by r.post_id, r.emoji
    ) per_emoji
    group by post_id
  ),
  ranked as (
    select wp.id, wp.kind, wp.title, wp.name as author, wp.photo_url,
           wp.video_url, wp.minutes, wp.workout_type, wp.meal_tags,
           wp.is_cheat, wp.created_at,
           coalesce(rc.n, 0) as reactions,
           coalesce(rb.by_emoji, '{}'::jsonb) as reaction_emoji
    from week_posts wp
    left join reaction_counts rc on rc.post_id = wp.id
    left join reaction_breakdown rb on rb.post_id = wp.id
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
  training as (
    select
      count(*) as sessions,
      coalesce(sum(minutes), 0) as minutes,
      (select workout_type from week_posts
        where kind = 'workout' and workout_type is not null
        group by workout_type order by count(*) desc, workout_type limit 1) as top_type,
      count(distinct user_id) as people
    from week_posts where kind = 'workout'
  ),
  per_person as (
    select me.name,
           count(*) filter (where wp.kind in ('workout', 'meal')) as logs
    from members me left join week_posts wp on wp.user_id = me.user_id
    group by me.user_id, me.name
  ),
  weight_moves as (
    select
      name,
      (array_agg(weight_kg order by created_at desc))[1]
        - (array_agg(weight_kg order by created_at))[1] as delta,
      count(*) as readings
    from week_weighs
    group by user_id, name
  )
  select jsonb_build_object(
    'week_start', week_from,
    'week_end', week_from + 6,
    'squad_id', sid,
    'squad_name', (select name from squads where id = sid),
    'totals', (select to_jsonb(t) from totals t),
    'training', (select to_jsonb(t) from training t),
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

    -- One per kind, and NO overall winner. The best meal is already the
    -- most-loved meal; a separate "Most loved" card for the same post under a
    -- different name is the bug this migration exists to fix.
    'top_workout', (
      select to_jsonb(x) from (
        select * from ranked where kind = 'workout' and reactions > 0
        order by reactions desc, created_at desc limit 1
      ) x),
    'top_meal', (
      select to_jsonb(x) from (
        select * from ranked where kind = 'meal' and reactions > 0
        order by reactions desc, created_at desc limit 1
      ) x),
    'top_tip', (
      select to_jsonb(x) from (
        select * from ranked where kind = 'tip' and reactions > 0
        order by reactions desc, created_at desc limit 1
      ) x),

    -- Kept so a browser still running the previous bundle does not lose its
    -- story. Neither is used by the current client.
    'top_post', (
      select to_jsonb(x) from (
        select * from ranked where reactions > 0
        order by reactions desc, created_at desc limit 1
      ) x),
    'top_posts', coalesce(
      (select jsonb_agg(to_jsonb(x)) from (
        select * from ranked where reactions > 0
        order by reactions desc, created_at desc limit 3
      ) x), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.squad_recap(uuid, date) from public, anon;
grant execute on function public.squad_recap(uuid, date) to authenticated;

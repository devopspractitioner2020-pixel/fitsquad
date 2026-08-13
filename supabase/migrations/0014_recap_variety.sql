-- ============================================================
-- Fit Squad — migration 0014: a recap with more than one idea in it,
-- and a fifth reaction
--
-- Run after 0013. Idempotent.
--
-- THE RECAP PROBLEM
--
-- `squad_recap()` returned the three most-reacted posts of the week and the
-- app rendered each with the same eyebrow, so the story played:
--
--     MOST LOVED · Beef noodle stir fry
--     MOST LOVED · Dinner
--     MOST LOVED · Turkey, sweet potato and salad
--
-- Three cards claiming to be the top one. "Most loved" is a superlative and
-- there can only be one — repeating it three times is not a recap of a week,
-- it is the same card three times with different nouns.
--
-- So this returns the best post OF EACH KIND instead of the top three
-- overall, plus the training the squad actually did. Each card then says
-- something the others do not: one crowns the week's post, one is about the
-- gym, one is about a tip somebody shared, one is about the plate.
-- ============================================================

-- ---------- A FIFTH REACTION ----------
-- 🤤 for the food, which is most of what gets posted and which the other
-- four had no good answer to.
alter table public.reactions drop constraint if exists reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check
  check (emoji in ('🔥', '💪', '👏', '😅', '🤤'));


-- ---------- THE RECAP ----------
-- NOTE: this REPLACES the squad_recap() defined in 0012_edit_and_recap.sql.
-- `create or replace` means the last one to run wins, so re-running 0012 on
-- its own reverts the recap to three identical "Most loved" cards. If you
-- re-run it, run this file afterwards.
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
  -- Every post with its reaction count, so the "best of" queries below can
  -- each filter this one relation rather than repeating the join.
  ranked as (
    select wp.id, wp.kind, wp.title, wp.name as author, wp.photo_url,
           wp.minutes, wp.workout_type, wp.meal_tags, wp.is_cheat,
           wp.created_at, coalesce(rc.n, 0) as reactions
    from week_posts wp
    left join reaction_counts rc on rc.post_id = wp.id
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
  -- What the squad actually did in the gym, which the old recap never said.
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
  ),
  best_overall as (
    select * from ranked where reactions > 0
    order by reactions desc, created_at desc limit 1
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

    -- One superlative, one winner.
    'top_post', (select to_jsonb(b) from best_overall b),

    -- And then one of each kind, so the cards after it are about different
    -- things rather than the same thing again. Each excludes whatever won
    -- overall, so no post appears twice in one story.
    'top_workout', (
      select to_jsonb(x) from (
        select * from ranked
        where kind = 'workout' and id is distinct from (select id from best_overall)
        order by reactions desc, created_at desc limit 1
      ) x),
    'top_meal', (
      select to_jsonb(x) from (
        select * from ranked
        where kind = 'meal' and id is distinct from (select id from best_overall)
        order by reactions desc, created_at desc limit 1
      ) x),
    'top_tip', (
      select to_jsonb(x) from (
        select * from ranked
        where kind = 'tip' and id is distinct from (select id from best_overall)
        order by reactions desc, created_at desc limit 1
      ) x),

    -- Kept for anything still reading the old shape. The app no longer uses
    -- it; removing a key from a jsonb payload is the kind of change that
    -- breaks a client someone has not reloaded yet.
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

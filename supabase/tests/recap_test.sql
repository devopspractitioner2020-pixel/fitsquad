-- ============================================================
-- Fit Squad — squad_recap() and the signup path, against a real Postgres.
--
-- Run by scripts/test-sql.sh, which loads shim.sql, schema.sql and every
-- migration in order into a throwaway database first. Every check is an
-- `assert`, so the first thing that is wrong aborts with a line number.
--
-- WHY THIS FILE EXISTS
--
-- The squad is the core of the app, and twice now it has broken in ways no
-- JavaScript test could have caught: once because two migrations defined
-- handle_new_user() and the older one won, and once because a recap card
-- came back holding the same post under two different headings. The client
-- tests assert what the app does with a recap. Nothing asserted what the
-- database actually PUT IN one until this file.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

-- ---------- Signing people up ----------
--
-- Straight into auth.users, which is what Supabase Auth does. Everything
-- after that is our triggers.

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'vic@example.com',
   '{"display_name": "Vic"}'::jsonb);

do $$
begin
  assert (select count(*) from public.profiles
          where id = '11111111-1111-1111-1111-111111111111') = 1,
    'signup did not create a profile';
  assert (select count(*) from public.squad_members
          where user_id = '11111111-1111-1111-1111-111111111111') = 1,
    'signup left the founder in no squad';
  assert (select role from public.squad_members
          where user_id = '11111111-1111-1111-1111-111111111111') = 'owner',
    'the founder of a squad is not its owner';
end $$;

-- Someone joining with the code they were sent. This is the exact path that
-- silently dropped two real people into squads of their own.
do $$
declare
  code text;
begin
  select s.join_code into code
  from public.squads s
  join public.squad_members m on m.squad_id = s.id
  where m.user_id = '11111111-1111-1111-1111-111111111111';

  assert code is not null and length(code) > 0, 'the founder got no join code';

  insert into auth.users (id, email, raw_user_meta_data) values
    ('22222222-2222-2222-2222-222222222222', 'maria@example.com',
     jsonb_build_object('display_name', 'María', 'join_code', code)),
    -- Lower case and a stray space, because that is how a code arrives when
    -- it has been through a chat app and a paste.
    ('33333333-3333-3333-3333-333333333333', 'diego@example.com',
     jsonb_build_object('display_name', 'Diego', 'join_code', ' ' || lower(code)));
end $$;

do $$
declare
  sid uuid;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';

  assert (select count(*) from public.squad_members where squad_id = sid) = 3,
    'joining with a code did not land everyone in the same squad';
  assert (select count(distinct squad_id) from public.squad_members) = 1,
    'someone was given a squad of their own despite using a valid code';
end $$;

-- A code that matches nothing still has to leave the person somewhere.
insert into auth.users (id, email, raw_user_meta_data) values
  ('44444444-4444-4444-4444-444444444444', 'lost@example.com',
   '{"display_name": "Sam", "join_code": "NOPE99"}'::jsonb);

do $$
begin
  assert (select count(*) from public.squad_members
          where user_id = '44444444-4444-4444-4444-444444444444') = 1,
    'a bad join code left someone with no squad at all';
end $$;

-- ---------- A week of activity ----------
--
-- Monday 27 Jul 2026 through Sunday 2 Aug. Fixed dates, so the assertions
-- below do not drift with the calendar.

insert into public.posts (id, user_id, author_name, kind, title, is_cheat, is_healthy,
                          photo_url, workout_type, minutes, created_at) values
  -- Vic: three cheats, two of them photographed. The cheater of the week.
  ('aaaaaaa1-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Vic', 'meal', 'Pizza',      true, false, 'https://img/pizza.jpg',  null, null, '2026-07-28 20:00Z'),
  ('aaaaaaa1-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Vic', 'meal', 'Alfajores',  true, false, null,                     null, null, '2026-07-30 16:00Z'),
  ('aaaaaaa1-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Vic', 'meal', 'Burger',     true, false, 'https://img/burger.jpg', null, null, '2026-08-01 21:00Z'),
  -- María: one cheat, and the week's best session.
  ('aaaaaaa2-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222',
   'María', 'meal', 'Ice cream', true, false, null,                    null, null, '2026-07-29 19:00Z'),
  ('aaaaaaa2-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222',
   'María', 'workout', 'Morning run', null, null, null,                'cardio', 45, '2026-07-28 07:00Z'),
  -- Diego: the week's best plate.
  ('aaaaaaa3-0000-4000-8000-000000000001', '33333333-3333-3333-3333-333333333333',
   'Diego', 'meal', 'Ceviche',  false, true, 'https://img/ceviche.jpg', null, null, '2026-07-31 13:00Z'),
  -- The week before, so the boundary gets exercised: a cheat that must NOT
  -- count towards this week's crown.
  ('aaaaaaa9-0000-4000-8000-000000000001', '33333333-3333-3333-3333-333333333333',
   'Diego', 'meal', 'Last week''s churros', true, false, null,          null, null, '2026-07-25 18:00Z');

insert into public.reactions (post_id, user_id, emoji) values
  ('aaaaaaa2-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', '🔥'),
  ('aaaaaaa2-0000-4000-8000-000000000002', '33333333-3333-3333-3333-333333333333', '💪'),
  ('aaaaaaa3-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '🤤'),
  ('aaaaaaa3-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', '🤤');

insert into public.weigh_ins (user_id, weight_kg, created_at) values
  ('22222222-2222-2222-2222-222222222222', 71.4, '2026-07-27 07:00Z'),
  ('22222222-2222-2222-2222-222222222222', 70.0, '2026-08-02 07:00Z');

-- ---------- The recap ----------

do $$
declare
  sid uuid;
  r jsonb;
  ch jsonb;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';

  -- Act as Vic. security definer functions bypass RLS, so the membership
  -- check inside them is the only thing standing between one squad and
  -- another's week.
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  r := public.squad_recap(sid, '2026-07-27');
  assert r is not null, 'the recap for a finished week came back null';

  -- ----- cheater of the week -----
  ch := r -> 'cheater';
  assert ch is not null and ch <> 'null'::jsonb, 'no cheater, though three cheats were logged';
  assert ch ->> 'name' = 'Vic',
    format('the wrong person was crowned: %s', ch ->> 'name');
  assert (ch ->> 'count')::int = 3,
    format('the cheat count is %s, expected 3', ch ->> 'count');

  -- At most four posts, and the photographed ones lead so the collage has
  -- something to show.
  assert jsonb_array_length(ch -> 'posts') = 3,
    'the wrong number of cheat posts came back';
  assert (ch -> 'posts' -> 0 ->> 'photo_url') is not null
     and (ch -> 'posts' -> 1 ->> 'photo_url') is not null,
    'a cheat post with no photo was ordered ahead of one with a photo';
  assert (ch -> 'posts' -> 2 ->> 'title') = 'Alfajores',
    'the unphotographed cheat should be last';

  -- The week boundary: last week's churros belong to last week.
  assert not exists (
    select 1 from jsonb_array_elements(ch -> 'posts') p
    where p ->> 'title' like 'Last week%'),
    'a cheat from the previous week leaked into this one';

  -- ----- the rest of the recap still works -----
  assert (r -> 'totals' ->> 'cheats')::int = 4, 'the cheat total is wrong';
  -- Three: Sam's bad code put them in a squad of their own, which is the
  -- point of that branch.
  assert (r -> 'totals' ->> 'members')::int = 3, 'the member count is wrong';
  assert r -> 'top_workout' ->> 'title' = 'Morning run', 'the wrong session won';
  assert r -> 'top_meal' ->> 'title' = 'Ceviche', 'the wrong plate won';
  assert r -> 'top_meal' -> 'reaction_emoji' ->> '🤤' = '2',
    'the reaction breakdown did not come back';
  assert r -> 'biggest_drop' ->> 'name' = 'María', 'the wrong person dropped the most';
  assert (r -> 'biggest_drop' ->> 'delta')::numeric = -1.4, 'the drop is the wrong size';
end $$;

-- A week nobody cheated in gets no cheater, rather than a crown for zero.
do $$
declare
  sid uuid;
  r jsonb;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  r := public.squad_recap(sid, '2026-07-06');
  assert r -> 'cheater' is null or r -> 'cheater' = 'null'::jsonb,
    'a week with no cheat meals still crowned somebody';
  assert (r -> 'totals' ->> 'cheats')::int = 0, 'an empty week counted cheats';
end $$;

-- Not a member, no recap. Worth pinning: the function is security definer,
-- so without this check it would happily hand out another squad's week.
do $$
declare
  sid uuid;
  ok boolean := false;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.uid', '44444444-4444-4444-4444-444444444444', true);
  begin
    perform public.squad_recap(sid, '2026-07-27');
  exception when others then
    ok := true;
  end;
  assert ok, 'an outsider was served another squad''s recap';
end $$;

-- A week that has not finished stays shut, whatever the caller's clock says.
do $$
declare
  sid uuid;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
  assert public.squad_recap(sid, (public.week_start(now()) + 7)::date) is null,
    'a future week was readable before it happened';
end $$;

select 'sql tests passed' as result;

-- ---------- The unlock is six in the EVENING, not 18:00 UTC ----------
--
-- 0017. It used to be UTC, which is 8pm in Stuttgart and 1pm in Lima.
do $$
begin
  -- Summer: Berlin is UTC+2, so Sunday 18:00 local is 16:00 UTC.
  assert public.recap_available_at('2026-08-10') = '2026-08-16 16:00+00'::timestamptz,
    format('summer unlock is %s, expected 16:00Z', public.recap_available_at('2026-08-10'));
  -- Winter: UTC+1, so 17:00 UTC. A fixed offset would have got one of these
  -- wrong by an hour for half the year.
  assert public.recap_available_at('2026-01-05') = '2026-01-11 17:00+00'::timestamptz,
    format('winter unlock is %s, expected 17:00Z', public.recap_available_at('2026-01-05'));
  -- The Sundays the clocks actually move, which is where an offset computed
  -- once and reused goes wrong.
  assert public.recap_available_at('2026-03-23') = '2026-03-29 16:00+00'::timestamptz,
    'the spring-forward Sunday does not open at 18:00 local';
  assert public.recap_available_at('2026-10-19') = '2026-10-25 17:00+00'::timestamptz,
    'the autumn-back Sunday does not open at 18:00 local';

  -- Both halves say the same thing: it is always 18:00 on the clock in the
  -- room, whatever the offset happens to be that week.
  assert to_char(public.recap_available_at('2026-08-10') at time zone 'Europe/Berlin', 'Dy HH24:MI') = 'Sun 18:00',
    'summer: not Sunday at 18:00 local';
  assert to_char(public.recap_available_at('2026-01-05') at time zone 'Europe/Berlin', 'Dy HH24:MI') = 'Sun 18:00',
    'winter: not Sunday at 18:00 local';
end $$;

-- The week that ends this evening opens this evening — the whole point of
-- the schedule, and what the client was getting wrong by asking for the week
-- before instead.
do $$
declare
  sid uuid;
  this_week date := public.week_start(now());
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  if now() >= public.recap_available_at(this_week) then
    assert public.squad_recap(sid, this_week) is not null,
      'the week that has already opened came back null';
  else
    assert public.squad_recap(sid, this_week) is null,
      'the current week opened before its Sunday evening';
  end if;

  -- Last week is always open, whatever day it is.
  assert public.squad_recap(sid, (this_week - 7)::date) is not null,
    'last week is not readable';
end $$;

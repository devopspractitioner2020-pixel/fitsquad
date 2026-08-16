-- ============================================================
-- Fit Squad — re-running an old migration must not break the app.
--
-- Runs after recap_test.sql, on the same database, and deliberately does the
-- dangerous thing: re-applies migrations out of order.
--
-- THIS IS THE BUG THAT ACTUALLY HAPPENED. `0002` and `0004` both define
-- handle_new_user(), `create or replace` means the last one to run wins, and
-- re-running `0002` reverted every new signup to landing in a squad of their
-- own — with no error, anywhere, and two real people lost before anyone
-- noticed. `0009` added a second, independently-named trigger so that the
-- squad step survives even when the first trigger has been reverted.
--
-- That defence is a claim about the database, and a claim about the database
-- belongs in a test against a database.
-- ============================================================

\set ON_ERROR_STOP on

-- ---------- 1. Re-run 0002 ALONE, which is the mistake ----------
\ir ../migrations/0002_hardening.sql

do $$
declare
  code text;
  sid uuid;
begin
  select s.join_code, s.id into code, sid
  from public.squads s
  join public.squad_members m on m.squad_id = s.id
  where m.user_id = '11111111-1111-1111-1111-111111111111';

  insert into auth.users (id, email, raw_user_meta_data) values
    ('55555555-5555-5555-5555-555555555555', 'hannah@example.com',
     jsonb_build_object('display_name', 'Hannah', 'join_code', code));

  assert (select count(*) from public.profiles
          where id = '55555555-5555-5555-5555-555555555555') = 1,
    're-running 0002 stopped profiles being created';

  -- The whole point of the second trigger.
  assert (select squad_id from public.squad_members
          where user_id = '55555555-5555-5555-5555-555555555555') = sid,
    're-running 0002 put a new signup in the wrong squad — the second trigger did not save it';
end $$;

-- ---------- 2. Re-run the documented remedy ----------
-- DEPLOY.md tells the reader to finish with 0009 if they ever re-run an
-- earlier file. That instruction has to actually work.
\ir ../migrations/0009_signup_squad_fix.sql

do $$
declare
  sid uuid;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';

  insert into auth.users (id, email, raw_user_meta_data) values
    ('66666666-6666-6666-6666-666666666666', 'kati@example.com',
     jsonb_build_object('display_name', 'Kati',
                        'join_code', (select join_code from public.squads where id = sid)));

  assert (select squad_id from public.squad_members
          where user_id = '66666666-6666-6666-6666-666666666666') = sid,
    'signups are broken after re-running 0009';
  -- And it did not move anyone who was already settled.
  assert (select squad_id from public.squad_members
          where user_id = '22222222-2222-2222-2222-222222222222') = sid,
    're-running 0009 moved an existing member out of their squad';
end $$;

-- ---------- 3. Re-run an old squad_recap(), then the newest ----------
-- Same hazard, different function: 0012, 0014, 0015 and 0016 all define
-- squad_recap(). Re-running 0015 alone silently drops the cheater card.
\ir ../migrations/0015_recap_posts.sql

do $$
declare
  sid uuid;
  r jsonb;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  r := public.squad_recap(sid, '2026-07-27');
  -- Pinned so nobody "fixes" this by making 0015 return a cheater: the point
  -- is that an out-of-order re-run REGRESSES, which is why the warning
  -- comment and the DEPLOY.md instruction have to exist.
  assert r -> 'cheater' is null,
    'expected 0015 to lack the cheater key — if it has one, 0016 is redundant';
end $$;

\ir ../migrations/0016_cheater_of_the_week.sql

do $$
declare
  sid uuid;
  r jsonb;
begin
  select squad_id into sid from public.squad_members
  where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  r := public.squad_recap(sid, '2026-07-27');
  assert r -> 'cheater' ->> 'name' = 'Vic',
    'running 0016 after 0015 did not restore the cheater card';
  -- The rest of the recap survived the round trip too.
  assert r -> 'top_meal' ->> 'title' = 'Ceviche', 'the recap lost its best plate';
end $$;

select 'rerun tests passed' as result;

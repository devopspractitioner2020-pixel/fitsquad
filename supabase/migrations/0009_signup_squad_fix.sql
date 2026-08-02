-- ============================================================
-- Fit Squad — migration 0009: new signups actually land in a squad
--
-- Run after 0008. Idempotent, and safe to run as many times as you like.
--
-- ============================================================
-- THE BUG
-- ============================================================
--
-- Two people signed up with a valid join code and ended up in NO squad at
-- all — not the inviter's, not even one of their own. `squad_members` had no
-- row for them.
--
-- Cause: TWO migrations define the same function.
--
--   0002_hardening.sql  → handle_new_user()  creates a profile. That is all.
--   0004_squads.sql     → handle_new_user()  creates a profile AND resolves
--                         the signup join_code into a squad membership.
--
-- Both use `create or replace function`, so whichever ran LAST is the one
-- that exists. Re-running 0002 after 0004 — which the deploy guide actively
-- encouraged, because it described every migration as harmless to repeat —
-- silently reverts the trigger to the profile-only version. Nothing errors.
-- Nothing warns. Signups keep succeeding. They just quietly stop joining
-- squads, and the only visible symptom is a person who swears they used the
-- code and sees an empty squad.
--
-- That is my fault twice over: for naming both functions the same thing, and
-- for documenting a re-run as safe when it was not.
--
-- ============================================================
-- THE FIX, IN THREE PARTS
-- ============================================================
--
-- 1. Restore handle_new_user() to the squad-aware version.
--
-- 2. Add a SECOND trigger, under a different name, that guarantees the
--    membership independently. Re-running 0002 drops and recreates the
--    trigger named `on_auth_user_created` — it knows nothing about
--    `on_auth_user_created_squad`, so it cannot remove it. Whatever happens
--    to the first trigger, the second one still puts every new user in a
--    squad. This is the part that makes the bug unrepeatable rather than
--    merely fixed.
--
--    Postgres fires same-event triggers in alphabetical order by name, so
--    `on_auth_user_created` runs first and `on_auth_user_created_squad`
--    second. The second one returns immediately if the first already did
--    the work, so running both never produces two squads.
--
-- 3. Backfill everyone currently without a squad, HONOURING the join code
--    they signed up with. 0007 gave those people a squad of their own; this
--    supersedes it by first checking whether they were trying to join
--    someone. Hannah and Kati end up in the squad they actually typed the
--    code for.
-- ============================================================


-- ---------- 1. The shared logic, in one place ----------
-- Extracted so the trigger function and the backfill cannot drift apart.
-- Returns the squad the user ended up in, or null if they already had one.
create or replace function public.ensure_user_squad(
  uid uuid,
  display text,
  wanted_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  founded boolean := false;
  clean_code text;
begin
  -- Already sorted. Doing nothing here is what makes the second trigger and
  -- repeated backfills safe.
  if exists (select 1 from squad_members where user_id = uid) then
    return null;
  end if;

  clean_code := upper(regexp_replace(coalesce(wanted_code, ''), '\s', '', 'g'));

  if clean_code <> '' then
    select id into target from squads where join_code = clean_code;
  end if;

  -- A code that matches nothing is not an error — the person still needs
  -- somewhere to be. They get their own squad, and the diagnostic at the
  -- bottom of this file finds them so you can tell them to re-join.
  if target is null then
    insert into squads (name, join_code, created_by)
    values (coalesce(nullif(trim(display), ''), 'My') || '''s Squad',
            new_join_code(), uid)
    returning id into target;
    founded := true;
  end if;

  insert into squad_members (squad_id, user_id, role)
  values (target, uid, case when founded then 'owner' else 'member' end)
  on conflict do nothing;

  return target;
end;
$$;

revoke all on function public.ensure_user_squad(uuid, text, text) from public, anon, authenticated;


-- ---------- 2. Restore the squad-aware signup trigger ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display text;
begin
  display := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, display_name)
  values (new.id, display)
  on conflict (id) do nothing;

  perform public.ensure_user_squad(
    new.id, display, new.raw_user_meta_data ->> 'join_code'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------- 3. The belt-and-braces trigger ----------
-- Deliberately a separate function and a separate trigger name. If anyone
-- ever re-runs 0002 — or writes a new migration that redefines
-- handle_new_user without thinking about squads — this still fires and the
-- squad still happens.
create or replace function public.handle_new_user_squad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display text;
begin
  display := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    (select p.display_name from public.profiles p where p.id = new.id),
    split_part(new.email, '@', 1)
  );

  -- No-op when the first trigger already did it.
  perform public.ensure_user_squad(
    new.id, display, new.raw_user_meta_data ->> 'join_code'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_squad on auth.users;
create trigger on_auth_user_created_squad
  after insert on auth.users
  for each row execute function public.handle_new_user_squad();


-- ---------- 4. Backfill, honouring the code they typed ----------
do $$
declare
  u record;
begin
  for u in
    select
      au.id,
      coalesce(
        nullif(trim(p.display_name), ''),
        nullif(trim(au.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(au.email, '@', 1), ''),
        'My'
      ) as display,
      au.raw_user_meta_data ->> 'join_code' as code
    from auth.users au
    left join public.profiles p on p.id = au.id
    order by au.created_at
  loop
    -- Profiles first: if the trigger was missing entirely rather than merely
    -- out of date, these are absent too, and a member with no profile shows
    -- up on the leaderboard as "Squad member".
    insert into public.profiles (id, display_name)
    values (u.id, u.display)
    on conflict (id) do nothing;

    perform public.ensure_user_squad(u.id, u.display, u.code);
  end loop;
end $$;


-- ============================================================
-- VERIFY — run these after applying. Both should return zero rows.
-- ============================================================
--
-- Nobody without a squad:
--
--   select au.email
--   from auth.users au
--   left join public.squad_members m on m.user_id = au.id
--   where m.user_id is null;
--
-- Nobody who typed a code and landed somewhere else. A row here means they
-- mistyped it (or it was for a squad that no longer exists) — they can fix
-- it themselves with Squad → Join another squad with a code:
--
--   select au.email,
--          au.raw_user_meta_data ->> 'join_code' as code_they_typed,
--          s.name as squad_they_are_in, s.join_code
--   from auth.users au
--   join public.squad_members m on m.user_id = au.id
--   join public.squads s on s.id = m.squad_id
--   where coalesce(au.raw_user_meta_data ->> 'join_code', '') <> ''
--     and s.join_code is distinct from upper(au.raw_user_meta_data ->> 'join_code');
--
-- And both triggers are present:
--
--   select tgname from pg_trigger
--   where tgrelid = 'auth.users'::regclass and not tgisinternal;
--   -- expect: on_auth_user_created, on_auth_user_created_squad

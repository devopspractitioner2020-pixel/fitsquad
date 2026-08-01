-- ============================================================
-- Fit Squad — migration 0007: nobody is left without a squad
--
-- Run after 0006. Idempotent — a second run finds nobody to fix.
--
-- THE BUG THIS CLOSES
--
-- 0004 made every NEW signup land in a squad, via the handle_new_user
-- trigger, and backfilled the users who existed at the time. Between those
-- two there is a gap, and more than one thing falls into it:
--
--   * an account created after 0002 but before 0004 — the trigger of the day
--     created a profile and nothing else, and 0004's backfill deliberately
--     skips if ANY squad_members row already exists, so that account stays
--     squadless forever;
--   * an account created while 0004 had not yet been applied to the project;
--   * anyone who uses the "leave my own squad" DELETE policy on their last
--     squad.
--
-- A user in that state sees a Squad screen with no join code, no member
-- count and no way out — the leaderboard heading falls back to the generic
-- "Leaderboard" and the invite panel is simply absent, because it renders
-- only when my_squads() returns a row.
--
-- The app-side half of the fix is a "create a squad" button on that screen
-- (src/screens/Squad.jsx), which is the real repair: it works no matter how
-- someone ends up squadless, including tomorrow. This migration is the data
-- half, so existing accounts do not have to go and click it.
-- ============================================================

do $$
declare
  u record;
  sid uuid;
begin
  for u in
    select
      au.id,
      coalesce(
        nullif(trim(p.display_name), ''),
        nullif(split_part(au.email, '@', 1), ''),
        'My'
      ) as display
    from auth.users au
    left join public.profiles p on p.id = au.id
    where not exists (
      select 1 from public.squad_members m where m.user_id = au.id
    )
    order by au.created_at
  loop
    -- A squad of their own, named and coded exactly as the signup trigger
    -- would have done it. They own it, so they can rename it.
    insert into public.squads (name, join_code, created_by)
    values (u.display || '''s Squad', public.new_join_code(), u.id)
    returning id into sid;

    insert into public.squad_members (squad_id, user_id, role)
    values (sid, u.id, 'owner')
    on conflict do nothing;
  end loop;
end $$;

-- Check afterwards — this should return no rows.
--
--   select au.email
--   from auth.users au
--   left join public.squad_members m on m.user_id = au.id
--   where m.user_id is null;

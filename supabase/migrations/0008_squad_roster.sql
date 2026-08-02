-- ============================================================
-- Fit Squad — migration 0008: who is actually in the squad
--
-- Run after 0007. Idempotent.
--
-- THE BUG THIS CLOSES
--
-- The Squad screen showed a member COUNT and a leaderboard, and the
-- leaderboard was built entirely from `posts` and `weigh_ins`. So a person
-- was only visible once they had logged something. Two people who joined
-- with a valid code and had not yet logged a meal appeared nowhere at all —
-- the screen said "3 members" above "No logs in this range yet", and every
-- member of that squad concluded the join had silently failed.
--
-- Worse, it was symmetric: if nobody in the squad had logged anything in the
-- selected range, nobody could see anybody, and the natural reading of that
-- is "the squad feature is broken".
--
-- Membership is not activity. This returns the roster itself, so the screen
-- can list who is in the squad before anyone has done a thing.
--
-- WHY AN RPC AND NOT A SELECT
--
-- `profiles` is readable for anyone you share a squad with, so the frontend
-- could nearly build this itself — but "everyone I share ANY squad with" is
-- not "everyone in THIS squad", and once you are in two squads those differ.
-- Asking the database for one squad's members keeps the two from drifting.
-- ============================================================

create or replace function public.squad_roster(sid uuid)
returns table (
  user_id uuid,
  display_name text,
  role text,
  joined_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    m.user_id,
    coalesce(nullif(trim(p.display_name), ''), 'Squad member') as display_name,
    m.role,
    m.joined_at
  from squad_members m
  left join profiles p on p.id = m.user_id
  -- SECURITY DEFINER bypasses RLS, so the membership check has to be here
  -- and explicit. Without it this would hand any signed-in user the full
  -- roster of any squad whose id they could guess.
  where m.squad_id = sid
    and public.is_squad_member(sid)
  order by m.joined_at;
$$;

revoke all on function public.squad_roster(uuid) from public, anon;
grant execute on function public.squad_roster(uuid) to authenticated;


-- ---------- DIAGNOSTIC ----------
-- Not used by the app. Run it in the SQL editor when someone reports that a
-- join "did nothing" — it answers the only question that matters, which is
-- whether the membership row exists.
--
--   select s.name, s.join_code, p.display_name, m.role, m.joined_at
--   from squad_members m
--   join squads s   on s.id = m.squad_id
--   left join profiles p on p.id = m.user_id
--   order by s.name, m.joined_at;
--
-- And to see anyone who signed up with a code that matched nothing — they
-- will own a squad of their own instead of being in yours:
--
--   select au.email,
--          au.raw_user_meta_data ->> 'join_code' as code_they_typed,
--          s.name  as squad_they_landed_in,
--          s.join_code
--   from auth.users au
--   join squad_members m on m.user_id = au.id
--   join squads s on s.id = m.squad_id
--   where coalesce(au.raw_user_meta_data ->> 'join_code', '') <> ''
--     and s.join_code is distinct from upper(au.raw_user_meta_data ->> 'join_code');

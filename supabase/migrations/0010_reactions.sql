-- ============================================================
-- Fit Squad — migration 0010: reactions that actually react
--
-- Run after 0009. Idempotent.
--
-- The four emoji under every post were `<button>` elements with no onClick
-- and no table behind them. Tapping one did nothing, forever, silently —
-- the worst kind of broken, because it looks finished.
--
-- This adds the storage, plus the "someone reacted to your post" feed that
-- makes a reaction worth leaving in the first place. A reaction nobody is
-- told about is a tree falling in a forest.
-- ============================================================

-- ---------- REACTIONS ----------
create table if not exists public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The set is fixed and small on purpose. A free-text emoji column invites
  -- both abuse and a rendering surprise; four is enough to say "seen you".
  emoji text not null check (emoji in ('🔥', '💪', '👏', '😅')),
  created_at timestamptz not null default now(),
  -- One of each emoji per person per post: tapping 🔥 twice removes it,
  -- and you can leave 🔥 and 💪 on the same post.
  primary key (post_id, user_id, emoji)
);
alter table public.reactions enable row level security;

create index if not exists reactions_post_idx on public.reactions (post_id);
create index if not exists reactions_recent_idx on public.reactions (created_at desc);

-- Readable exactly when the post is. The subquery runs under the caller's
-- own RLS, so `posts`' squad policy does the scoping and this cannot drift
-- from it.
drop policy if exists "reactions readable with the post" on public.reactions;
create policy "reactions readable with the post"
  on public.reactions for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

drop policy if exists "react as yourself" on public.reactions;
create policy "react as yourself"
  on public.reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

drop policy if exists "remove own reaction" on public.reactions;
create policy "remove own reaction"
  on public.reactions for delete to authenticated
  using (user_id = auth.uid());


-- ---------- ACTIVITY ----------
-- NOTE: `my_activity()` and `unseen_activity_count()` below are SUPERSEDED by
-- 0011_comments.sql, which widens both to cover comments as well as
-- reactions. `create or replace` means the last definition wins, so
-- re-running THIS file on its own reverts the activity feed to
-- reactions-only — silently, with no error. If you re-run it, run 0011
-- afterwards. (0011 drops them first, because the return type changes.)

-- When this reader last looked at their activity list. Nullable: never
-- looked means everything is new.
alter table public.profiles
  add column if not exists activity_seen_at timestamptz;

-- Reactions other people left on MY posts, newest first.
--
-- Derived rather than stored. A notifications table would need a trigger to
-- fill it, a cleanup job to trim it, and would drift out of sync the moment
-- a post or a reaction is deleted. Reading the reactions directly cannot go
-- stale, and at this size it is a trivial query.
create or replace function public.my_activity(limit_n int default 50)
returns table (
  post_id uuid,
  post_title text,
  post_kind text,
  emoji text,
  actor_name text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.post_id,
    p.title,
    p.kind,
    r.emoji,
    coalesce(nullif(trim(pr.display_name), ''), 'Someone'),
    r.created_at
  from reactions r
  join posts p on p.id = r.post_id
  left join profiles pr on pr.id = r.user_id
  where p.user_id = auth.uid()
    -- Your own reactions on your own post are not news to you.
    and r.user_id <> auth.uid()
  order by r.created_at desc
  limit greatest(1, least(coalesce(limit_n, 50), 200));
$$;

-- How many of those arrived since the last look. Separate from my_activity
-- so the badge does not have to fetch and count the whole list on every
-- screen that shows it.
create or replace function public.unseen_activity_count()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int
  from reactions r
  join posts p on p.id = r.post_id
  where p.user_id = auth.uid()
    and r.user_id <> auth.uid()
    and r.created_at > coalesce(
      (select pr.activity_seen_at from profiles pr where pr.id = auth.uid()),
      '-infinity'::timestamptz
    );
$$;

create or replace function public.mark_activity_seen()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  ts timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  update profiles set activity_seen_at = ts where id = auth.uid();
  return ts;
end;
$$;

revoke all on function public.my_activity(int) from public, anon;
revoke all on function public.unseen_activity_count() from public, anon;
revoke all on function public.mark_activity_seen() from public, anon;
grant execute on function public.my_activity(int) to authenticated;
grant execute on function public.unseen_activity_count() to authenticated;
grant execute on function public.mark_activity_seen() to authenticated;


-- ---------- SQUAD RENAME ----------
-- The UPDATE policy for owners has existed since 0004; nothing ever called
-- it. This RPC gives the app one obvious way in, validates the name the same
-- way create_squad does, and returns the updated row.
create or replace function public.rename_squad(sid uuid, new_name text)
returns public.squads
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.squads;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if new_name is null or length(trim(new_name)) = 0 then
    raise exception 'Give your squad a name.';
  end if;
  if length(trim(new_name)) > 60 then
    raise exception 'That name is too long — 60 characters at most.';
  end if;

  if not exists (
    select 1 from squad_members
    where squad_id = sid and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Only the squad owner can rename it.';
  end if;

  update squads set name = trim(new_name) where id = sid returning * into s;
  return s;
end;
$$;

revoke all on function public.rename_squad(uuid, text) from public, anon;
grant execute on function public.rename_squad(uuid, text) to authenticated;

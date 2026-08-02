-- ============================================================
-- Fit Squad — migration 0011: comments, and activity that covers them
--
-- Run after 0010. Idempotent.
--
-- The "Comment" button next to the reactions was the same kind of nothing:
-- a real-looking control with no handler and no table. Reactions got wired
-- up in 0010; this is the other half.
--
-- It also widens the activity feed. A notification list that reports
-- reactions but not replies is worse than none, because the silence looks
-- authoritative — "nobody said anything" when in fact somebody did.
-- ============================================================

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Bounded in the database, not only in the textarea. A client-side maxLength
  -- is a suggestion; anyone can POST past it.
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;

create index if not exists comments_post_idx on public.comments (post_id, created_at);
create index if not exists comments_recent_idx on public.comments (created_at desc);

-- Same shape as reactions: readable exactly when the post is, because the
-- subquery runs under the caller's own RLS and `posts` already scopes to the
-- squad. One rule, one place.
drop policy if exists "comments readable with the post" on public.comments;
create policy "comments readable with the post"
  on public.comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

drop policy if exists "comment as yourself" on public.comments;
create policy "comment as yourself"
  on public.comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

-- Your own only. Deliberately no UPDATE policy: an edited comment with no
-- edit marker is a small trust problem, and delete-and-repost is honest.
drop policy if exists "remove own comment" on public.comments;
create policy "remove own comment"
  on public.comments for delete to authenticated
  using (user_id = auth.uid());


-- ---------- COMMENTS WITH NAMES ----------
-- `profiles` is readable for squad-mates, so the client could join this
-- itself — but it would need a second query and would have to cope with a
-- missing profile. One RPC keeps the fallback name in one place.
create or replace function public.post_comments(pid uuid)
returns table (
  id uuid,
  post_id uuid,
  user_id uuid,
  author_name text,
  body text,
  created_at timestamptz,
  is_mine boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id, c.post_id, c.user_id,
    coalesce(nullif(trim(p.display_name), ''), 'Squad member'),
    c.body, c.created_at,
    c.user_id = auth.uid()
  from comments c
  left join profiles p on p.id = c.user_id
  -- SECURITY DEFINER bypasses RLS, so the visibility check is explicit.
  -- Without it any signed-in user could read the comments on any post whose
  -- id they could guess.
  where c.post_id = pid
    and exists (
      select 1 from posts po
      where po.id = pid
        and (po.user_id = auth.uid() or public.shares_squad_with(po.user_id))
    )
  order by c.created_at;
$$;

revoke all on function public.post_comments(uuid) from public, anon;
grant execute on function public.post_comments(uuid) to authenticated;


-- ---------- ACTIVITY, NOW WITH REPLIES ----------
-- The return type changes, so these have to be dropped rather than replaced.
drop function if exists public.my_activity(int);
drop function if exists public.unseen_activity_count();

create or replace function public.my_activity(limit_n int default 50)
returns table (
  kind text,
  post_id uuid,
  post_title text,
  emoji text,
  body text,
  actor_name text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select * from (
    select
      'reaction'::text as kind,
      r.post_id,
      p.title as post_title,
      r.emoji,
      null::text as body,
      coalesce(nullif(trim(pr.display_name), ''), 'Someone') as actor_name,
      r.created_at
    from reactions r
    join posts p on p.id = r.post_id
    left join profiles pr on pr.id = r.user_id
    where p.user_id = auth.uid() and r.user_id <> auth.uid()

    union all

    select
      'comment'::text,
      c.post_id,
      p.title,
      null::text,
      c.body,
      coalesce(nullif(trim(pr.display_name), ''), 'Someone'),
      c.created_at
    from comments c
    join posts p on p.id = c.post_id
    left join profiles pr on pr.id = c.user_id
    where p.user_id = auth.uid() and c.user_id <> auth.uid()
  ) both_kinds
  order by created_at desc
  limit greatest(1, least(coalesce(limit_n, 50), 200));
$$;

create or replace function public.unseen_activity_count()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select (
    (select count(*) from reactions r
      join posts p on p.id = r.post_id
     where p.user_id = auth.uid() and r.user_id <> auth.uid()
       and r.created_at > coalesce(
         (select pr.activity_seen_at from profiles pr where pr.id = auth.uid()),
         '-infinity'::timestamptz))
    +
    (select count(*) from comments c
      join posts p on p.id = c.post_id
     where p.user_id = auth.uid() and c.user_id <> auth.uid()
       and c.created_at > coalesce(
         (select pr.activity_seen_at from profiles pr where pr.id = auth.uid()),
         '-infinity'::timestamptz))
  )::int;
$$;

revoke all on function public.my_activity(int) from public, anon;
revoke all on function public.unseen_activity_count() from public, anon;
grant execute on function public.my_activity(int) to authenticated;
grant execute on function public.unseen_activity_count() to authenticated;

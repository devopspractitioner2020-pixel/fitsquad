-- ============================================================
-- Fit Squad — migration 0006: saved posts
--
-- Run after 0005. Idempotent.
--
-- Members can save a tip or a meal from the feed — their own or anyone
-- else's — and find it again under Me. A save is just a bookmark: it points
-- at the original post rather than copying it, so if the author edits or
-- deletes it the saved copy follows.
-- ============================================================

create table if not exists public.saved_posts (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.saved_posts enable row level security;

-- Newest-first listing per user is the only read pattern.
create index if not exists saved_posts_user_created_idx
  on public.saved_posts (user_id, created_at desc);

-- ---------- RLS ----------
-- Saves are private. Nobody sees what anyone else has bookmarked, which
-- matters for meals in particular — a saved-meals list is a fairly personal
-- thing to have on display to the squad.
drop policy if exists "read own saves" on public.saved_posts;
create policy "read own saves"
  on public.saved_posts for select to authenticated
  using (user_id = auth.uid());

-- You may only save a post you can actually see. The EXISTS subquery runs
-- under the caller's own RLS, so `posts` is already scoped to their squad —
-- meaning this one line also stops anyone bookmarking a post id they
-- guessed at from another squad.
drop policy if exists "save a post i can see" on public.saved_posts;
create policy "save a post i can see"
  on public.saved_posts for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

drop policy if exists "unsave own" on public.saved_posts;
create policy "unsave own"
  on public.saved_posts for delete to authenticated
  using (user_id = auth.uid());

comment on table public.saved_posts is
  'Per-user bookmarks of posts. Private to the saver. Cascades on post '
  'delete, so a saved list never shows a post that no longer exists.';

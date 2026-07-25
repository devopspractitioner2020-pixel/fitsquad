-- ============================================================
-- Fit Squad — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- It creates tables, Row Level Security (RLS) policies, and the
-- storage bucket for meal/tip photos.
-- ============================================================

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Anyone signed in can read profiles (needed for the leaderboard / feed names).
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);
-- You may only insert/update your own profile row.
create policy "insert own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "update own profile"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- ---------- POSTS (workouts, meals, tips) ----------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  kind text not null check (kind in ('workout','meal','tip')),
  title text not null,
  note text,
  minutes int,
  meal_type text,
  is_cheat boolean,
  is_healthy boolean,
  photo_url text,
  created_at timestamptz not null default now()
);
alter table public.posts enable row level security;

-- Squad feed: all signed-in members can read all posts.
create policy "posts readable by authenticated"
  on public.posts for select to authenticated using (true);
-- You can only create/delete your own posts.
create policy "insert own posts"
  on public.posts for insert to authenticated with check (auth.uid() = user_id);
create policy "delete own posts"
  on public.posts for delete to authenticated using (auth.uid() = user_id);

-- ---------- WEIGH-INS ----------
create table if not exists public.weigh_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_kg numeric not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.weigh_ins enable row level security;

-- Weigh-ins are readable by the squad (leaderboard shows total change),
-- but only editable by their owner. Tighten the SELECT to own-only if you
-- prefer weights private: change `using (true)` to `using (auth.uid() = user_id)`.
create policy "weighins readable by authenticated"
  on public.weigh_ins for select to authenticated using (true);
create policy "insert own weighins"
  on public.weigh_ins for insert to authenticated with check (auth.uid() = user_id);

-- ---------- INTAKES (latest FitPlan questionnaire) ----------
create table if not exists public.intakes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.intakes enable row level security;
create policy "own intake all"
  on public.intakes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- PLANS (generated FitPlans) ----------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'generating' check (status in ('generating','ready','error')),
  html text,                          -- the generated plan document
  intake jsonb,                       -- snapshot of the intake used
  is_first_plan boolean not null default false,
  refinements_used int not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;

-- Only the owner can read their plans. The Edge Function writes with the
-- service-role key, which bypasses RLS, so no INSERT/UPDATE policy is needed
-- for the server. Users never write plan rows directly from the client.
create policy "read own plans"
  on public.plans for select to authenticated using (auth.uid() = user_id);

create index if not exists plans_user_created_idx on public.plans (user_id, created_at desc);

-- ============================================================
-- STORAGE: bucket for meal / tip photos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', true)
on conflict (id) do nothing;

-- Public read (photos show in the feed). Path is namespaced by user id:
--   post-photos/<user_id>/<uuid>.jpg
create policy "photos public read"
  on storage.objects for select to public
  using (bucket_id = 'post-photos');

-- Users may upload only into their own <user_id>/ folder.
create policy "photos insert own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

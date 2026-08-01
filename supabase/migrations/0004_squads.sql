-- ============================================================
-- Fit Squad — migration 0004: real squads with join codes
--
-- Run after 0003. Idempotent.
--
-- Until now there was no squad concept at all: every signed-in user could
-- read every post and appeared on one global leaderboard. This adds real
-- squads without adding a `squad_id` column to `posts` or `weigh_ins`.
--
-- WHY NO squad_id ON POSTS. The obvious design stamps each post with the
-- squad it was made in. But then switching squads leaves your history
-- stranded in the old one, and every insert has to know the current squad.
-- Scoping on *shared membership* instead — "I can see your post if we are in
-- a squad together" — means history follows the person, inserts stay
-- unchanged, and the frontend queries need no `.eq('squad_id', ...)` at all.
-- RLS does the whole job.
--
-- EXISTING USERS ARE NOT DISRUPTED. Everyone who already has an account is
-- backfilled into a single squad, so the feed and leaderboard look exactly
-- as they did before this ran.
-- ============================================================

-- ---------- SQUADS ----------
create table if not exists public.squads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  -- Six characters, no ambiguous glyphs (see new_join_code below).
  join_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.squads enable row level security;

create table if not exists public.squad_members (
  squad_id uuid not null references public.squads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (squad_id, user_id)
);
alter table public.squad_members enable row level security;

create index if not exists squad_members_user_idx on public.squad_members (user_id);


-- ---------- HELPERS ----------
-- Both are SECURITY DEFINER on purpose: they are called from inside RLS
-- policies on the very tables they read, and a plain query there would
-- recurse. STABLE lets the planner call them once per statement.

-- Do I share at least one squad with this user?
create or replace function public.shares_squad_with(other_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from squad_members mine
    join squad_members theirs on theirs.squad_id = mine.squad_id
    where mine.user_id = auth.uid()
      and theirs.user_id = other_user
  );
$$;

-- Am I a member of this squad?
create or replace function public.is_squad_member(sid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from squad_members
    where squad_id = sid and user_id = auth.uid()
  );
$$;

-- Six characters from an alphabet with no 0/O/1/I/L — join codes get read
-- aloud and typed by hand, so the ambiguous glyphs are removed rather than
-- explained.
create or replace function public.new_join_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from squads where join_code = code);
  end loop;
  return code;
end;
$$;


-- ---------- RLS ----------
drop policy if exists "squads readable by members" on public.squads;
create policy "squads readable by members"
  on public.squads for select to authenticated
  using (public.is_squad_member(id));

-- Renaming is the owner's call. Creating and joining go through the RPCs
-- below, so there is deliberately no INSERT policy here.
drop policy if exists "owner renames squad" on public.squads;
create policy "owner renames squad"
  on public.squads for update to authenticated
  using (exists (
    select 1 from squad_members
    where squad_id = squads.id and user_id = auth.uid() and role = 'owner'
  ));

drop policy if exists "see members of my squads" on public.squad_members;
create policy "see members of my squads"
  on public.squad_members for select to authenticated
  using (public.is_squad_member(squad_id));

-- You may remove yourself. Joining is via join_squad().
drop policy if exists "leave my own squad" on public.squad_members;
create policy "leave my own squad"
  on public.squad_members for delete to authenticated
  using (user_id = auth.uid());


-- ---------- SCOPE THE EXISTING TABLES ----------
-- These replace the old `using (true)` policies, which let every signed-in
-- user read every row in the database.

drop policy if exists "posts readable by authenticated" on public.posts;
drop policy if exists "posts readable by squad" on public.posts;
create policy "posts readable by squad"
  on public.posts for select to authenticated
  using (user_id = auth.uid() or public.shares_squad_with(user_id));

drop policy if exists "weighins readable by authenticated" on public.weigh_ins;
drop policy if exists "weighins readable by squad" on public.weigh_ins;
create policy "weighins readable by squad"
  on public.weigh_ins for select to authenticated
  using (user_id = auth.uid() or public.shares_squad_with(user_id));

drop policy if exists "profiles readable by authenticated" on public.profiles;
drop policy if exists "profiles readable by squad" on public.profiles;
create policy "profiles readable by squad"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_squad_with(id));


-- ---------- CREATING AND JOINING ----------
-- Both are RPCs rather than table policies. Joining needs to look up a squad
-- by code *before* you are a member of it, which no sane SELECT policy can
-- allow — a policy permissive enough to find a squad by code is permissive
-- enough to enumerate every squad.

create or replace function public.create_squad(squad_name text)
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
  if squad_name is null or length(trim(squad_name)) = 0 then
    raise exception 'Give your squad a name.';
  end if;

  insert into squads (name, join_code, created_by)
  values (trim(squad_name), new_join_code(), auth.uid())
  returning * into s;

  insert into squad_members (squad_id, user_id, role)
  values (s.id, auth.uid(), 'owner');

  return s;
end;
$$;

create or replace function public.join_squad(code text)
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

  -- Case- and whitespace-insensitive: people type these off a screenshot.
  select * into s from squads
   where join_code = upper(regexp_replace(coalesce(code, ''), '\s', '', 'g'));

  if s.id is null then
    raise exception 'No squad found with that code.';
  end if;

  insert into squad_members (squad_id, user_id, role)
  values (s.id, auth.uid(), 'member')
  on conflict (squad_id, user_id) do nothing;

  return s;
end;
$$;

-- The Squad screen's one query: which squads am I in, and how many people.
create or replace function public.my_squads()
returns table (id uuid, name text, join_code text, role text, member_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select s.id, s.name, s.join_code, m.role,
         (select count(*) from squad_members x where x.squad_id = s.id)
  from squads s
  join squad_members m on m.squad_id = s.id
  where m.user_id = auth.uid()
  order by m.joined_at;
$$;

revoke all on function public.create_squad(text) from public, anon;
revoke all on function public.join_squad(text) from public, anon;
revoke all on function public.my_squads() from public, anon;
grant execute on function public.create_squad(text) to authenticated;
grant execute on function public.join_squad(text) to authenticated;
grant execute on function public.my_squads() to authenticated;


-- ---------- EVERY NEW USER LANDS IN A SQUAD ----------
-- Extends the 0002 trigger. A user with no squad would see an empty feed and
-- have no way to fix it, so signup always produces one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display text;
  new_squad uuid;
  founded boolean := false;
begin
  display := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, display_name)
  values (new.id, display)
  on conflict (id) do nothing;

  -- If they signed up through an invite link the code rides along in the
  -- metadata; otherwise they get a squad of their own to share.
  if coalesce(trim(new.raw_user_meta_data ->> 'join_code'), '') <> '' then
    select id into new_squad from public.squads
     where join_code = upper(trim(new.raw_user_meta_data ->> 'join_code'));
  end if;

  if new_squad is null then
    insert into public.squads (name, join_code, created_by)
    values (display || '''s Squad', public.new_join_code(), new.id)
    returning id into new_squad;
    founded := true;
  end if;

  -- Owner of the squad they founded; plain member of one they were invited to.
  insert into public.squad_members (squad_id, user_id, role)
  values (new_squad, new.id, case when founded then 'owner' else 'member' end)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------- BACKFILL ----------
-- Everyone who already has an account goes into one squad together, so the
-- app looks exactly as it did before this migration ran.
do $$
declare
  home_squad uuid;
begin
  if not exists (select 1 from public.squad_members) then
    select id into home_squad from public.squads where name = 'Fit Squad' limit 1;

    if home_squad is null then
      insert into public.squads (name, join_code, created_by)
      values ('Fit Squad', public.new_join_code(),
              (select id from auth.users order by created_at limit 1))
      returning id into home_squad;
    end if;

    insert into public.squad_members (squad_id, user_id, role)
    select home_squad, u.id,
           case when u.id = (select id from auth.users order by created_at limit 1)
                then 'owner' else 'member' end
    from auth.users u
    on conflict do nothing;
  end if;
end $$;

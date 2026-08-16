-- ============================================================
-- Fit Squad — a stand-in for the parts of Supabase that are not Postgres.
--
-- This exists so `scripts/test-sql.sh` can run schema.sql and EVERY
-- migration, in order, against a throwaway PostgreSQL instance and then call
-- the functions the app calls. Until this file existed, the only way to find
-- out whether a migration applied cleanly was to paste it into the SQL editor
-- of the live project and see what happened.
--
-- It provides only what the schema references: the `auth` and `storage`
-- schemas, the roles Supabase grants to, and `auth.uid()`. Nothing here
-- pretends to be Supabase — the point is to exercise OUR sql, not theirs.
--
-- `auth.uid()` reads a session setting, so a test can act as a given user:
--     select set_config('test.uid', '<uuid>', false);
-- ============================================================

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists storage;

-- Supabase's four standard roles. The migrations revoke from `anon` and
-- grant to `authenticated` by name, so both have to exist.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

-- Just enough of auth.users to hang foreign keys and triggers off.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated');
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select email from auth.users where id = auth.uid();
$$;

-- Storage, for the photo bucket the schema creates.
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

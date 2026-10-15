-- =============================================================================
-- Local SEO Workbench — Phase 1 schema
--
-- Creates: public.profiles, public.projects, helper trigger functions,
--          indexes, constraints and Row Level Security policies.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting this file into
-- the Supabase Dashboard -> SQL Editor and running it once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Shared helper: keep updated_at current on every UPDATE.
-- search_path is pinned to '' so the function cannot be hijacked by objects in
-- other schemas; everything it touches is schema-qualified.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- profiles: one row per auth user, created automatically at sign-up.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_email_length check (email is null or char_length(email) <= 320)
);

comment on table public.profiles is
  'One row per authenticated user. Created by the on_auth_user_created trigger; never stores passwords.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- projects: one row per client website managed by a user.
--
-- NOTE: These constraints enforce presence and length only. They do NOT validate
-- that website_url is a well-formed http(s) URL; that validation happens in the
-- application (src/lib/url.ts) before data is written.
-- -----------------------------------------------------------------------------
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name           text not null,
  website_url    text not null,
  business_name  text,
  location       text,
  business_type  text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint projects_name_length          check (char_length(btrim(name)) between 1 and 100),
  constraint projects_website_url_length   check (char_length(btrim(website_url)) between 1 and 2048),
  constraint projects_business_name_length check (business_name is null or char_length(btrim(business_name)) between 1 and 150),
  constraint projects_location_length      check (location      is null or char_length(btrim(location))      between 1 and 150),
  constraint projects_business_type_length check (business_type is null or char_length(btrim(business_type)) between 1 and 100),
  constraint projects_notes_length         check (notes         is null or char_length(btrim(notes))         between 1 and 2000)
);

comment on table public.projects is
  'Local SEO projects (one per client website). Access is restricted to the owning user by RLS.';

-- Supports "list my projects, newest first" and the RLS ownership filter.
create index projects_user_id_created_at_idx
  on public.projects (user_id, created_at desc);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Sign-up trigger: create / maintain the profile row for each auth user.
--
-- SECURITY DEFINER is required because the trigger runs as the signing-up user
-- (who has no INSERT privilege on profiles). Hardening:
--   * search_path = ''        -> no implicit schema lookup; all names qualified
--   * EXECUTE revoked from public, anon and authenticated, so the function can
--     only run as a trigger, never be called through the API
--   * it only inserts/updates the row whose id matches the new auth user
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- Keep profiles.email in step when a user changes their auth email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id;
  return new;
end;
$$;

revoke all on function public.handle_user_email_change() from public, anon, authenticated;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();


-- Backfill profiles for users that already existed before this migration.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- Privileges: start from nothing, grant only what the app needs.
-- (Supabase grants broad default privileges on new public tables; remove them.)
-- -----------------------------------------------------------------------------
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.projects from anon, authenticated;

-- Profiles are created and synced only by the triggers above, so signed-in users
-- may read their own row but never write to the table directly.
grant select on table public.profiles to authenticated;

grant select, insert, update, delete on table public.projects to authenticated;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- (select auth.uid()) is wrapped in a sub-select so Postgres evaluates it once
-- per statement instead of once per row.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;

-- profiles: read own row only. There are intentionally NO insert/update/delete
-- policies and no write grants: with RLS enabled that means no client can create
-- or modify any profile, their own or anyone else's.
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- projects: full CRUD, but only on rows the signed-in user owns.
create policy "projects_select_own"
  on public.projects
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "projects_insert_own"
  on public.projects
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- USING checks the existing row; WITH CHECK checks the resulting row, so a user
-- can neither edit someone else's project nor reassign their own to another user.
create policy "projects_update_own"
  on public.projects
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "projects_delete_own"
  on public.projects
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- The anon role has no grants and no policies, so unauthenticated requests
-- cannot read or write either table.

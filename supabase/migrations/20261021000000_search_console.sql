-- =============================================================================
-- Local SEO Workbench — Phase 6: Google Search Console
--
--   * public.gsc_connections — one Google connection per user. Holds the
--     encrypted OAuth tokens, so ONLY the service role (the `gsc` Edge
--     Function) can read or write it. The browser never sees the tokens.
--   * projects.gsc_property  — the Search Console property chosen for a
--     project, e.g. "sc-domain:example.com" or "https://www.example.com/".
--
-- Run AFTER 20261020000000_gbp_profiles.sql. Safe to run twice.
-- =============================================================================

create table if not exists public.gsc_connections (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  google_email             text,
  refresh_token            text not null,
  access_token             text,
  access_token_expires_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint gsc_google_email_length check (google_email is null or char_length(google_email) <= 320),
  constraint gsc_token_lengths check (
    char_length(refresh_token) <= 4000 and (access_token is null or char_length(access_token) <= 8000)
  )
);

comment on table public.gsc_connections is
  'Encrypted Google OAuth tokens for Search Console. Service role only (gsc Edge Function).';

drop trigger if exists gsc_connections_set_updated_at on public.gsc_connections;
create trigger gsc_connections_set_updated_at
  before update on public.gsc_connections
  for each row execute function public.set_updated_at();

-- No access for browser roles; RLS on with no policies as a second lock.
revoke all on table public.gsc_connections from anon, authenticated;
alter table public.gsc_connections enable row level security;

alter table public.projects
  add column if not exists gsc_property text;

alter table public.projects drop constraint if exists projects_gsc_property_format;
alter table public.projects
  add constraint projects_gsc_property_format check (
    gsc_property is null
    or (char_length(gsc_property) <= 300 and gsc_property ~ '^(sc-domain:[A-Za-z0-9.-]+|https?://[^[:space:]/]+/[^[:space:]]*)$')
  );

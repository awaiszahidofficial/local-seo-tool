-- =============================================================================
-- Local SEO Workbench — Phases 7 to 10
--
--   * public.business_listings      — citations/directory listings per project
--                                     (Business Listings)
--   * public.recommendation_states  — which recommendations a user marked done
--                                     or dismissed (Recommendations)
--   * public.reports                — saved client report snapshots (Reports)
--
-- Keyword Opportunities needs no tables: it is worked out from data already
-- stored (services, service areas, crawl) plus live Search Console data.
--
-- Every table: users can read and write only their own rows, and only for
-- projects they own.
--
-- Run AFTER 20261021000000_search_console.sql. Safe to run twice.
-- =============================================================================

-- ---- Business listings ------------------------------------------------------
create table if not exists public.business_listings (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  directory     text not null,
  listing_url   text,
  status        text not null default 'live',
  name          text,
  address       text,
  phone         text,
  website       text,
  notes         text,
  last_checked  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint listings_status_valid check (status in ('live', 'needs_update', 'pending', 'not_listed', 'duplicate')),
  constraint listings_directory_length check (char_length(btrim(directory)) between 1 and 100),
  constraint listings_url_length check (listing_url is null or char_length(listing_url) <= 2048),
  constraint listings_name_length check (name is null or char_length(name) <= 200),
  constraint listings_address_length check (address is null or char_length(address) <= 300),
  constraint listings_phone_length check (phone is null or char_length(phone) <= 40),
  constraint listings_website_length check (website is null or char_length(website) <= 2048),
  constraint listings_notes_length check (notes is null or char_length(notes) <= 1000)
);

create index if not exists business_listings_project_idx on public.business_listings (project_id, directory);
create index if not exists business_listings_user_idx on public.business_listings (user_id);

drop trigger if exists business_listings_set_updated_at on public.business_listings;
create trigger business_listings_set_updated_at
  before update on public.business_listings
  for each row execute function public.set_updated_at();

-- ---- Recommendation states --------------------------------------------------
create table if not exists public.recommendation_states (
  project_id  uuid not null references public.projects (id) on delete cascade,
  rec_key     text not null,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status      text not null,
  updated_at  timestamptz not null default now(),

  primary key (project_id, rec_key),
  constraint rec_states_status_valid check (status in ('done', 'dismissed')),
  constraint rec_states_key_length check (char_length(rec_key) between 1 and 300)
);

create index if not exists recommendation_states_user_idx on public.recommendation_states (user_id);

drop trigger if exists recommendation_states_set_updated_at on public.recommendation_states;
create trigger recommendation_states_set_updated_at
  before update on public.recommendation_states
  for each row execute function public.set_updated_at();

-- ---- Reports ----------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now(),

  constraint reports_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint reports_snapshot_shape check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 1000000)
);

create index if not exists reports_project_created_idx on public.reports (project_id, created_at desc);
create index if not exists reports_user_idx on public.reports (user_id);

-- ---- Privileges and Row Level Security --------------------------------------
revoke all on table public.business_listings from anon, authenticated;
revoke all on table public.recommendation_states from anon, authenticated;
revoke all on table public.reports from anon, authenticated;

grant select, insert, update, delete on table public.business_listings to authenticated;
grant select, insert, update, delete on table public.recommendation_states to authenticated;
-- Reports are immutable snapshots: create, read and delete only.
grant select, insert, delete on table public.reports to authenticated;

alter table public.business_listings enable row level security;
alter table public.recommendation_states enable row level security;
alter table public.reports enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['business_listings', 'recommendation_states', 'reports'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ('
      || '(select auth.uid()) = user_id and exists (select 1 from public.projects p '
      || 'where p.id = project_id and p.user_id = (select auth.uid())))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ('
      || '(select auth.uid()) = user_id and exists (select 1 from public.projects p '
      || 'where p.id = project_id and p.user_id = (select auth.uid())))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
  end loop;
end
$$;

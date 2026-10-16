-- =============================================================================
-- Local SEO Workbench — Phase 5: Google Business Profile Audit
--
-- Stores the Google Business Profile details a user enters for a project (one
-- profile per project). The audit itself runs in the browser.
--
-- NULL in a field means "not entered yet": the audit skips that check and asks
-- for it, rather than counting it as a failure.
--
-- Access: users can read and write only their own rows, and only for projects
-- they own.
--
-- Run AFTER 20261019000000_service_areas.sql.
-- =============================================================================

create table if not exists public.gbp_profiles (
  project_id             uuid primary key references public.projects (id) on delete cascade,
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,

  verified               boolean,
  business_name          text,
  primary_category       text,
  additional_categories  text[] not null default '{}',
  phone                  text,
  website_url            text,
  address                text,
  service_area_business  boolean not null default false,
  gbp_service_areas      text[] not null default '{}',
  has_hours              boolean,
  has_special_hours      boolean,
  description            text,
  services               text[] not null default '{}',
  products_count         integer,
  photos_count           integer,
  has_logo               boolean,
  has_cover_photo        boolean,
  review_count           integer,
  rating                 numeric(2, 1),
  reviews_last_90_days   integer,
  reply_rate             integer,
  last_post_date         date,
  attributes_count       integer,
  has_booking_link       boolean,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint gbp_business_name_length    check (business_name is null or char_length(business_name) between 1 and 200),
  constraint gbp_primary_category_length check (primary_category is null or char_length(primary_category) between 1 and 120),
  constraint gbp_additional_categories   check (cardinality(additional_categories) <= 20
                                                and char_length(array_to_string(additional_categories, '|')) <= 2500),
  constraint gbp_phone_length            check (phone is null or char_length(phone) between 1 and 40),
  constraint gbp_website_url_length      check (website_url is null or char_length(website_url) between 1 and 2048),
  constraint gbp_address_length          check (address is null or char_length(address) between 1 and 300),
  constraint gbp_service_areas_size      check (cardinality(gbp_service_areas) <= 40
                                                and char_length(array_to_string(gbp_service_areas, '|')) <= 4000),
  constraint gbp_description_length      check (description is null or char_length(description) between 1 and 1000),
  constraint gbp_services_size           check (cardinality(services) <= 200
                                                and char_length(array_to_string(services, '|')) <= 20000),
  constraint gbp_counts_range            check (
    (products_count is null or products_count between 0 and 100000)
    and (photos_count is null or photos_count between 0 and 1000000)
    and (review_count is null or review_count between 0 and 10000000)
    and (reviews_last_90_days is null or reviews_last_90_days between 0 and 1000000)
    and (attributes_count is null or attributes_count between 0 and 1000)
  ),
  constraint gbp_rating_range            check (rating is null or rating between 1.0 and 5.0),
  constraint gbp_reply_rate_range        check (reply_rate is null or reply_rate between 0 and 100)
);

comment on table public.gbp_profiles is
  'Google Business Profile details entered by the user, one row per project. RLS: owner only.';

create index if not exists gbp_profiles_user_id_idx on public.gbp_profiles (user_id);

drop trigger if exists gbp_profiles_set_updated_at on public.gbp_profiles;
create trigger gbp_profiles_set_updated_at
  before update on public.gbp_profiles
  for each row execute function public.set_updated_at();

revoke all on table public.gbp_profiles from anon, authenticated;
grant select, insert, update, delete on table public.gbp_profiles to authenticated;

alter table public.gbp_profiles enable row level security;

drop policy if exists "gbp_profiles_select_own" on public.gbp_profiles;
drop policy if exists "gbp_profiles_insert_own" on public.gbp_profiles;
drop policy if exists "gbp_profiles_update_own" on public.gbp_profiles;
drop policy if exists "gbp_profiles_delete_own" on public.gbp_profiles;

create policy "gbp_profiles_select_own"
  on public.gbp_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

-- Inserts and updates must belong to the caller AND point at a project the caller owns.
create policy "gbp_profiles_insert_own"
  on public.gbp_profiles for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

create policy "gbp_profiles_update_own"
  on public.gbp_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

create policy "gbp_profiles_delete_own"
  on public.gbp_profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

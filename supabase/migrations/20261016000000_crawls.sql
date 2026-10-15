-- =============================================================================
-- Local SEO Workbench — Phase 2: Website Crawler storage
--
-- Creates: public.crawls (one row per crawl run) and public.crawl_pages (one row
-- per page found), with Row Level Security.
--
-- Write model: rows are created ONLY by the `crawl-site` Edge Function, which
-- verifies the caller's JWT and project ownership and then writes with the
-- service role. Signed-in users may read and delete their own crawl data but
-- cannot insert or edit it, so crawl results cannot be forged from the browser.
--
-- Run AFTER 20261015000000_init_profiles_and_projects.sql.
-- =============================================================================

create table public.crawls (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          text not null default 'running',
  start_url       text not null,
  pages_crawled   integer not null default 0,
  stopped_reason  text,
  error_message   text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint crawls_status_valid check (status in ('running', 'completed', 'failed')),
  constraint crawls_start_url_length check (char_length(start_url) between 1 and 2048),
  constraint crawls_pages_crawled_range check (pages_crawled between 0 and 1000),
  constraint crawls_stopped_reason_valid check (
    stopped_reason is null
    or stopped_reason in ('completed', 'page_limit', 'time_limit', 'blocked_by_robots')
  ),
  constraint crawls_error_message_length check (error_message is null or char_length(error_message) <= 500)
);

comment on table public.crawls is
  'One row per website crawl. Written only by the crawl-site Edge Function; read by the owning user.';

create index crawls_project_id_created_at_idx on public.crawls (project_id, created_at desc);
create index crawls_user_id_idx on public.crawls (user_id);


create table public.crawl_pages (
  id                    uuid primary key default gen_random_uuid(),
  crawl_id              uuid not null references public.crawls (id) on delete cascade,
  project_id            uuid not null references public.projects (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  url                   text not null,
  final_url             text,
  status_code           integer,
  title                 text,
  meta_description      text,
  h1                    text,
  h1_count              integer not null default 0,
  word_count            integer not null default 0,
  canonical_url         text,
  robots_meta           text,
  internal_links_count  integer not null default 0,
  response_time_ms      integer,
  depth                 integer not null default 0,
  issues                text[] not null default '{}',
  error                 text,
  created_at            timestamptz not null default now(),

  constraint crawl_pages_url_length check (char_length(url) between 1 and 2048),
  constraint crawl_pages_final_url_length check (final_url is null or char_length(final_url) <= 2048),
  constraint crawl_pages_status_code_range check (status_code is null or status_code between 100 and 599),
  constraint crawl_pages_title_length check (title is null or char_length(title) <= 500),
  constraint crawl_pages_meta_length check (meta_description is null or char_length(meta_description) <= 1000),
  constraint crawl_pages_h1_length check (h1 is null or char_length(h1) <= 500),
  constraint crawl_pages_canonical_length check (canonical_url is null or char_length(canonical_url) <= 2048),
  constraint crawl_pages_robots_meta_length check (robots_meta is null or char_length(robots_meta) <= 200),
  constraint crawl_pages_counts_nonnegative check (
    h1_count >= 0 and word_count >= 0 and internal_links_count >= 0 and depth >= 0
  ),
  constraint crawl_pages_error_length check (error is null or char_length(error) <= 300),
  constraint crawl_pages_issues_size check (cardinality(issues) <= 30)
);

comment on table public.crawl_pages is
  'Pages discovered by a crawl, with extracted SEO fields and issue codes. Written only by the crawl-site Edge Function.';

create index crawl_pages_crawl_id_idx on public.crawl_pages (crawl_id);
create index crawl_pages_user_id_idx on public.crawl_pages (user_id);


-- -----------------------------------------------------------------------------
-- Privileges: users can read and delete their own rows; only the service role
-- (the Edge Function) can insert or update.
-- -----------------------------------------------------------------------------
revoke all on table public.crawls from anon, authenticated;
revoke all on table public.crawl_pages from anon, authenticated;

grant select, delete on table public.crawls to authenticated;
grant select, delete on table public.crawl_pages to authenticated;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.crawls enable row level security;
alter table public.crawl_pages enable row level security;

create policy "crawls_select_own"
  on public.crawls
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "crawls_delete_own"
  on public.crawls
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "crawl_pages_select_own"
  on public.crawl_pages
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "crawl_pages_delete_own"
  on public.crawl_pages
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update policies and no insert/update grants for authenticated or
-- anon: the browser cannot write crawl data. The service role bypasses RLS.

-- =============================================================================
-- Local SEO Workbench — crawls of up to 1,000 pages
--
-- Large crawls no longer fit in one Edge Function call (Supabase stops a call
-- after about 150 seconds), so the crawl-site function now works in slices:
-- each call crawls for about a minute, saves its pages plus the list of URLs
-- still to visit, and the browser calls again until the crawl is finished.
--
-- Adds:
--   * crawls.last_activity_at — updated after every slice; a running crawl with
--     no activity for 3 minutes is treated as stopped and can be resumed.
--   * public.crawl_state — the saved queue between slices. Only the Edge
--     Function (service role) can read or write it; it is deleted when the
--     crawl finishes, and cascades away with its crawl.
--
-- Run AFTER 20261017000000_local_signals.sql. Safe to run once; existing crawl
-- data is kept.
-- =============================================================================

alter table public.crawls
  add column last_activity_at timestamptz not null default now();

create table public.crawl_state (
  crawl_id      uuid primary key references public.crawls (id) on delete cascade,
  state         jsonb not null,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now(),

  constraint crawl_state_shape check (jsonb_typeof(state) = 'object'),
  constraint crawl_state_size check (pg_column_size(state) <= 5000000)
);

comment on table public.crawl_state is
  'Resume data (URL queue, robots rules) for crawls in progress. Service role only; deleted when the crawl ends.';

-- No access for browser roles at all; RLS on with no policies as a second lock.
revoke all on table public.crawl_state from anon, authenticated;
alter table public.crawl_state enable row level security;

-- Faster ordered reads of a crawl's pages now that a crawl can hold 1,000 rows.
create index if not exists crawl_pages_crawl_id_depth_url_idx on public.crawl_pages (crawl_id, depth, url);

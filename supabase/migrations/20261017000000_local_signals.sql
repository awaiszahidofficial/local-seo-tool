-- =============================================================================
-- Local SEO Workbench — Phase 3: local signals captured by the crawler
--
-- Adds the extra per-page data the Local Page Auditor needs (schema markup,
-- phone numbers, headings, main-content text, internal link paths, ...).
-- Existing rows keep local_version = 0, which the app treats as "crawled before
-- local signals existed; crawl again".
--
-- Run AFTER 20261016000000_crawls.sql. Row Level Security and privileges on
-- crawl_pages are unchanged: users can read/delete their rows, only the
-- crawl-site Edge Function can write.
-- =============================================================================

alter table public.crawl_pages
  add column h2s            text[]   not null default '{}',
  add column body_text      text,
  add column phones         text[]   not null default '{}',
  add column tel_links      integer  not null default 0,
  add column schema_types   text[]   not null default '{}',
  add column schema_local   jsonb,
  add column has_map_embed  boolean  not null default false,
  add column address_text   text,
  add column link_paths     text[]   not null default '{}',
  add column local_version  smallint not null default 0;

alter table public.crawl_pages
  add constraint crawl_pages_h2s_size check (cardinality(h2s) <= 10),
  add constraint crawl_pages_body_text_length check (body_text is null or char_length(body_text) <= 13000),
  add constraint crawl_pages_phones_size check (cardinality(phones) <= 5),
  add constraint crawl_pages_tel_links_range check (tel_links between 0 and 100),
  add constraint crawl_pages_schema_types_size check (cardinality(schema_types) <= 20),
  add constraint crawl_pages_schema_local_shape check (
    schema_local is null
    or (jsonb_typeof(schema_local) = 'object' and pg_column_size(schema_local) <= 4000)
  ),
  add constraint crawl_pages_address_text_length check (address_text is null or char_length(address_text) <= 400),
  add constraint crawl_pages_link_paths_size check (cardinality(link_paths) <= 60),
  add constraint crawl_pages_local_version_range check (local_version between 0 and 100);

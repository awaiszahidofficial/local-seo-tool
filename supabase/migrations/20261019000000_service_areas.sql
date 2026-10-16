-- =============================================================================
-- Local SEO Workbench — Phase 4: Service-Area Coverage
--
-- Adds two lists to each project, edited on the Service-Area Coverage page:
--   * service_areas — cities / neighbourhoods the business serves, in priority
--                     order (e.g. "Round Rock, TX")
--   * services      — the services it offers (e.g. "Drain cleaning")
--
-- Existing Row Level Security on public.projects already limits reads and
-- updates to the owning user; no new grants or policies are needed.
--
-- Run AFTER 20261018000000_large_crawls.sql. Safe to run twice.
-- =============================================================================

alter table public.projects
  add column if not exists service_areas text[] not null default '{}',
  add column if not exists services      text[] not null default '{}';

alter table public.projects drop constraint if exists projects_service_areas_size;
alter table public.projects drop constraint if exists projects_services_size;

alter table public.projects
  add constraint projects_service_areas_size check (
    cardinality(service_areas) <= 100
    and char_length(array_to_string(service_areas, '|')) <= 10000
  ),
  add constraint projects_services_size check (
    cardinality(services) <= 100
    and char_length(array_to_string(services, '|')) <= 10000
  );

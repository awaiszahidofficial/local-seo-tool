import type { CrawlPageRow, CrawlRow, ProjectRow } from '../types/database'

export const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
export const CRAWL_ID = '33333333-3333-4333-8333-333333333333'
export const USER_ID = '11111111-1111-4111-8111-111111111111'

export function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJECT_ID,
    user_id: USER_ID,
    name: 'Acme Plumbing',
    website_url: 'https://acme.example',
    business_name: null,
    location: null,
    business_type: null,
    notes: null,
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
    ...overrides,
  }
}

export function makeCrawl(overrides: Partial<CrawlRow> = {}): CrawlRow {
  return {
    id: CRAWL_ID,
    project_id: PROJECT_ID,
    user_id: USER_ID,
    status: 'completed',
    start_url: 'https://acme.example/',
    pages_crawled: 2,
    stopped_reason: null,
    error_message: null,
    started_at: '2026-10-16T10:00:00Z',
    finished_at: '2026-10-16T10:00:30Z',
    created_at: '2026-10-16T10:00:00Z',
    ...overrides,
  }
}

let counter = 0

/** A healthy, fully populated crawl page; override fields per test. */
export function makeCrawlPage(overrides: Partial<CrawlPageRow> = {}): CrawlPageRow {
  counter += 1
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    crawl_id: CRAWL_ID,
    project_id: PROJECT_ID,
    user_id: USER_ID,
    url: 'https://acme.example/',
    final_url: null,
    status_code: 200,
    title: 'Home | Acme Plumbing',
    meta_description: null,
    h1: 'Welcome',
    h1_count: 1,
    word_count: 420,
    canonical_url: null,
    robots_meta: null,
    internal_links_count: 3,
    response_time_ms: 200,
    depth: 0,
    issues: [],
    error: null,
    created_at: '2026-10-16T10:00:10Z',
    h2s: [],
    body_text: '',
    phones: [],
    tel_links: 0,
    schema_types: [],
    schema_local: null,
    has_map_embed: false,
    address_text: null,
    link_paths: [],
    local_version: 1,
    ...overrides,
  }
}

/**
 * Crawl size and time limits, shared by the crawl-site Edge Function and the browser UI so the
 * numbers shown to users always match what the server enforces.
 *
 * Large crawls run in slices: each call to the Edge Function crawls for at most
 * CRAWL_SLICE_BUDGET_MS (well under Supabase's ~150 s function limit), saves its pages and the
 * remaining queue, and the browser calls again until the crawl is finished.
 */

/** Maximum pages stored per crawl. The database allows at most 1000 (crawls_pages_crawled_range). */
export const CRAWL_MAX_PAGES = 1000

/** Time one Edge Function call spends fetching pages before it saves and hands back. */
export const CRAWL_SLICE_BUDGET_MS = 60_000

/**
 * Pages fetched per Edge Function call at most. Supabase allows 2 s of CPU time per call; parsing
 * a large page takes roughly 5–10 ms, so 80 pages leaves a wide margin. Keeps inserts small too.
 */
export const CRAWL_SLICE_MAX_PAGES = 80

/** Wall-clock cap for a whole crawl across all slices; after this it stops with "ran out of time". */
export const CRAWL_TOTAL_BUDGET_MS = 20 * 60 * 1000

/** Pages fetched at the same time. */
export const CRAWL_CONCURRENCY = 5

/** A running crawl with no activity for this long is treated as abandoned and can be resumed or replaced. */
export const CRAWL_STALE_AFTER_MS = 3 * 60 * 1000

export function formatPageLimit(): string {
  return CRAWL_MAX_PAGES.toLocaleString('en-US')
}

import { ISSUE_CODES, ISSUE_META, isIssueCode, type IssueCode, type IssueSeverity } from '../../supabase/functions/_shared/issues.ts'
import { CRAWL_MAX_PAGES, formatPageLimit } from '../../supabase/functions/_shared/limits.ts'
import type { CrawlPageRow, CrawlRow } from '../types/database'
import { getDatabaseErrorMessage } from './errors'
import { isUuid, type DataResult } from './projects'
import { supabase } from './supabase'

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'
const NOT_DEPLOYED_ERROR =
  'The crawler service is not available yet. Deploy the crawl-site function in Supabase (see the README), then try again.'
const GENERIC_CRAWL_ERROR = 'The crawl could not be completed. Please try again.'

type FunctionErrorLike = { name?: unknown; context?: unknown }

/**
 * Turns an error from `supabase.functions.invoke` into a user-facing message. The crawl-site
 * function returns `{ error: "<friendly message>" }` for expected failures, which we show as-is.
 */
export async function getCrawlErrorMessage(error: unknown): Promise<string> {
  const err: FunctionErrorLike = typeof error === 'object' && error !== null ? error : {}
  if (err.name === 'FunctionsFetchError') return NETWORK_ERROR

  const context = err.context
  if (context instanceof Response) {
    const body: unknown = await context
      .clone()
      .json()
      .catch(() => null)
    const message =
      typeof body === 'object' && body !== null && 'error' in body ? (body as { error: unknown }).error : null
    if (typeof message === 'string' && message.length > 0 && message.length <= 300) return message
    if (context.status === 404) return NOT_DEPLOYED_ERROR
    if (context.status === 401) return 'Your session has expired. Please sign in again.'
  }
  return GENERIC_CRAWL_ERROR
}

export type StartCrawlResult = { crawlId: string; pagesCrawled: number }

export type StartCrawlOptions = {
  /** Continue (resume) this crawl instead of starting a new one. */
  crawlId?: string
  /** Called after every slice with the crawl id and the number of pages saved so far. */
  onProgress?: (progress: StartCrawlResult) => void
}

/** Safety stop for the slice loop: 1,000 pages at 80 per slice needs about 13 calls. */
const MAX_SLICES = 60
/** Retries for one failed slice call (network blips); the server's lock keeps retries safe. */
const SLICE_RETRIES = 2

type SliceResponse = { crawlId: string; status: 'running' | 'completed'; pagesCrawled: number }

async function invokeSlice(projectId: string, crawlId: string | undefined): Promise<DataResult<SliceResponse>> {
  const body = crawlId ? { projectId, crawlId } : { projectId }
  const { data, error } = await supabase.functions.invoke('crawl-site', { body })
  if (error) return { data: null, error: await getCrawlErrorMessage(error) }
  const result = data as { crawlId?: unknown; pagesCrawled?: unknown; status?: unknown } | null
  if (!result || typeof result.crawlId !== 'string') return { data: null, error: GENERIC_CRAWL_ERROR }
  return {
    data: {
      crawlId: result.crawlId,
      status: result.status === 'running' ? 'running' : 'completed',
      pagesCrawled: typeof result.pagesCrawled === 'number' ? result.pagesCrawled : 0,
    },
    error: null,
  }
}

/**
 * Runs a crawl for a project via the crawl-site Edge Function (the server enforces ownership).
 * Large crawls come back in slices of about a minute each; this keeps calling until the server
 * reports the crawl as completed. Pass `crawlId` to resume a crawl that was interrupted.
 */
export async function startCrawl(
  projectId: string,
  options: StartCrawlOptions = {},
): Promise<DataResult<StartCrawlResult>> {
  if (!isUuid(projectId)) return { data: null, error: 'Choose a project first.' }
  if (options.crawlId !== undefined && !isUuid(options.crawlId)) return { data: null, error: GENERIC_CRAWL_ERROR }
  let crawlId = options.crawlId
  try {
    for (let slice = 0; slice < MAX_SLICES; slice += 1) {
      let result = await invokeSlice(projectId, crawlId)
      // A failed *continuation* may be a dropped connection; retry it. Never retry a fresh start,
      // which could create a second crawl.
      for (let attempt = 0; result.error !== null && crawlId !== undefined && attempt < SLICE_RETRIES; attempt += 1) {
        result = await invokeSlice(projectId, crawlId)
      }
      if (result.data === null) {
        const error =
          crawlId !== undefined
            ? `${result.error ?? GENERIC_CRAWL_ERROR} Pages found so far are saved; you can resume the crawl.`
            : result.error
        return { data: null, error }
      }
      crawlId = result.data.crawlId
      options.onProgress?.({ crawlId, pagesCrawled: result.data.pagesCrawled })
      if (result.data.status === 'completed') {
        return { data: { crawlId, pagesCrawled: result.data.pagesCrawled }, error: null }
      }
    }
    return { data: null, error: 'The crawl is taking longer than expected. Pages found so far are saved; resume it to continue.' }
  } catch (error) {
    return { data: null, error: await getCrawlErrorMessage(error) }
  }
}

/** Most recent crawl for a project, or `data: null, error: null` when it has never been crawled. */
export async function getLatestCrawl(projectId: string): Promise<DataResult<CrawlRow | null>> {
  if (!isUuid(projectId)) return { data: null, error: null }
  try {
    const { data, error } = await supabase
      .from('crawls')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return { data: null, error: getDatabaseErrorMessage(error) }
    return { data, error: null }
  } catch (error) {
    return { data: null, error: getDatabaseErrorMessage(error) }
  }
}

/** Every column except the long page text, for screens that do not need it. */
const LIGHT_PAGE_COLUMNS =
  'id, crawl_id, project_id, user_id, url, final_url, status_code, title, meta_description, h1, h1_count, ' +
  'word_count, canonical_url, robots_meta, internal_links_count, response_time_ms, depth, issues, error, ' +
  'created_at, h2s, phones, tel_links, schema_types, schema_local, has_map_embed, address_text, link_paths, local_version'

/** Rows per request (Supabase returns at most 1000 per request by default). */
const PAGE_BATCH = 500

/**
 * All pages of a crawl (up to the crawl limit), loaded in batches. With `light`, the long
 * `body_text` column is skipped and returned as null.
 */
export async function listCrawlPages(
  crawlId: string,
  options: { light?: boolean } = {},
): Promise<DataResult<CrawlPageRow[]>> {
  if (!isUuid(crawlId)) return { data: [], error: null }
  try {
    const pages: CrawlPageRow[] = []
    for (let from = 0; from < CRAWL_MAX_PAGES; from += PAGE_BATCH) {
      const { data, error } = await supabase
        .from('crawl_pages')
        .select(options.light ? LIGHT_PAGE_COLUMNS : '*')
        .eq('crawl_id', crawlId)
        .order('depth', { ascending: true })
        .order('url', { ascending: true })
        .range(from, Math.min(from + PAGE_BATCH, CRAWL_MAX_PAGES) - 1)
      if (error) return { data: null, error: getDatabaseErrorMessage(error) }
      const rows = (data ?? []) as unknown as CrawlPageRow[]
      pages.push(...(options.light ? rows.map((row) => ({ ...row, body_text: null })) : rows))
      if (rows.length < PAGE_BATCH) break
    }
    return { data: pages, error: null }
  } catch (error) {
    return { data: null, error: getDatabaseErrorMessage(error) }
  }
}

// ---- Pure summarising helpers (used by the UI and unit-tested) ---------------------------------

export type IssueFilter = 'all' | 'errors' | 'warnings' | 'clean'

export type CrawlSummary = {
  totalPages: number
  pagesWithErrors: number
  pagesWithWarnings: number
  cleanPages: number
  issueCounts: { code: IssueCode; severity: IssueSeverity; count: number }[]
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }

export function summarizeCrawl(pages: readonly Pick<CrawlPageRow, 'issues'>[]): CrawlSummary {
  const counts = new Map<IssueCode, number>()
  let pagesWithErrors = 0
  let pagesWithWarnings = 0
  let cleanPages = 0

  for (const page of pages) {
    const known = page.issues.filter(isIssueCode)
    for (const code of known) counts.set(code, (counts.get(code) ?? 0) + 1)
    const severities = new Set(known.map((code) => ISSUE_META[code].severity))
    if (severities.has('error')) pagesWithErrors += 1
    else if (severities.has('warning')) pagesWithWarnings += 1
    if (known.length === 0) cleanPages += 1
  }

  const issueCounts = ISSUE_CODES.filter((code) => counts.has(code))
    .map((code) => ({ code, severity: ISSUE_META[code].severity, count: counts.get(code) ?? 0 }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count)

  return { totalPages: pages.length, pagesWithErrors, pagesWithWarnings, cleanPages, issueCounts }
}

export function filterPages<T extends Pick<CrawlPageRow, 'issues'>>(pages: readonly T[], filter: IssueFilter): T[] {
  if (filter === 'all') return [...pages]
  return pages.filter((page) => {
    const severities = new Set(page.issues.filter(isIssueCode).map((code) => ISSUE_META[code].severity))
    if (filter === 'errors') return severities.has('error')
    if (filter === 'warnings') return !severities.has('error') && severities.has('warning')
    return !severities.has('error') && !severities.has('warning')
  })
}

const STOP_REASON_MESSAGES: Record<string, string> = {
  page_limit: `The crawl stopped at the ${formatPageLimit()}-page limit, so the site may have more pages.`,
  time_limit: 'The crawl stopped because it ran out of time, so some pages were not checked.',
  blocked_by_robots: 'This site’s robots.txt asks crawlers not to visit the start page, so nothing was crawled.',
}

/** Explains why a crawl ended early; null when it finished normally. */
export function describeStopReason(reason: string | null): string | null {
  return reason ? (STOP_REASON_MESSAGES[reason] ?? null) : null
}

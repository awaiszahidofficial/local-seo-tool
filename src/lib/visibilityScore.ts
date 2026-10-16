import type { BusinessListingRow, CrawlPageRow, CrawlRow, GbpProfileRow, ProjectRow } from '../types/database'
import { getLatestCrawl, listCrawlPages, summarizeCrawl } from './crawls'
import { getGbpProfile } from './gbp'
import { auditGbp } from './gbpAudit'
import { DIRECTORIES, listListings, referenceNap, summarizeListings } from './listings'
import { analyzeCoverage, effectiveAreas } from './serviceArea'

/**
 * Local visibility score: one 0–100 number per client, averaged from the parts of local SEO the
 * workbench can measure. Parts with no data are left out (and shown as "not set up"), never
 * counted as zero.
 */

export type ScorePart = 'website' | 'areas' | 'profile' | 'listings'

export const SCORE_PARTS: readonly { id: ScorePart; label: string; weight: number; link: string }[] = [
  { id: 'website', label: 'Website health', weight: 0.25, link: '/crawler' },
  { id: 'areas', label: 'Service-area pages', weight: 0.25, link: '/service-area' },
  { id: 'profile', label: 'Business Profile', weight: 0.3, link: '/gbp-audit' },
  { id: 'listings', label: 'Listings', weight: 0.2, link: '/listings' },
]

export type ScoreBand = 'strong' | 'fair' | 'weak'

export const BAND_LABELS: Record<ScoreBand, string> = { strong: 'Strong', fair: 'Fair', weak: 'Weak' }

export function bandFor(score: number): ScoreBand {
  return score >= 75 ? 'strong' : score >= 50 ? 'fair' : 'weak'
}

export type ClientInputs = {
  crawl: CrawlRow | null
  pages: CrawlPageRow[]
  gbp: GbpProfileRow | null
  listings: BusinessListingRow[] | null
}

export type ClientScore = {
  overall: number | null
  parts: Record<ScorePart, number | null>
  /** The weakest measured part, or the first unmeasured one: what to work on next. */
  focus: ScorePart | null
  pagesCrawled: number
  lastCrawl: string | null
}

export function scoreClient(project: ProjectRow, inputs: ClientInputs): ClientScore {
  const crawled = inputs.crawl?.status === 'completed' && inputs.pages.length > 0
  const parts: Record<ScorePart, number | null> = { website: null, areas: null, profile: null, listings: null }

  if (crawled) {
    const summary = summarizeCrawl(inputs.pages)
    parts.website = summary.totalPages > 0 ? Math.round(((summary.totalPages - summary.pagesWithErrors) / summary.totalPages) * 100) : null
    if (effectiveAreas(project).length > 0) parts.areas = analyzeCoverage(project, inputs.pages).coveragePercent
  }
  if (inputs.gbp) parts.profile = auditGbp(project, inputs.gbp, crawled ? inputs.pages : null).score
  if (inputs.listings && inputs.listings.length > 0) {
    const summary = summarizeListings(inputs.listings, referenceNap(project, inputs.gbp))
    const core = DIRECTORIES.filter((directory) => directory.tier === 'core').length
    const coreCoverage = (core - summary.missingCore.length) / core
    const consistency = summary.live > 0 ? summary.consistent / summary.live : 0
    parts.listings = Math.round((coreCoverage * 0.5 + consistency * 0.5) * 100)
  }

  let weighted = 0
  let weights = 0
  for (const part of SCORE_PARTS) {
    const value = parts[part.id]
    if (value === null) continue
    weighted += value * part.weight
    weights += part.weight
  }

  const unmeasured = SCORE_PARTS.find((part) => parts[part.id] === null)
  const measured = SCORE_PARTS.filter((part) => parts[part.id] !== null).sort((a, b) => (parts[a.id] ?? 0) - (parts[b.id] ?? 0))
  const weakest = measured[0]
  const focus = weakest && (parts[weakest.id] ?? 100) < 75 ? weakest.id : (unmeasured?.id ?? weakest?.id ?? null)

  return {
    overall: weights > 0 ? Math.round(weighted / weights) : null,
    parts,
    focus,
    pagesCrawled: crawled ? inputs.pages.length : 0,
    lastCrawl: inputs.crawl?.status === 'completed' ? inputs.crawl.started_at : null,
  }
}

/** Loads the light data needed to score one client (no page text). */
export async function loadClientInputs(project: ProjectRow): Promise<ClientInputs> {
  const [latest, gbp, listings] = await Promise.all([getLatestCrawl(project.id), getGbpProfile(project.id), listListings(project.id)])
  let pages: CrawlPageRow[] = []
  if (latest.data?.status === 'completed') {
    const result = await listCrawlPages(latest.data.id, { light: true })
    pages = result.data ?? []
  }
  return { crawl: latest.data ?? null, pages, gbp: gbp.data ?? null, listings: listings.data ?? null }
}

/** Runs `task` over `items` with at most `limit` running at once, keeping order. */
export async function mapWithLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index] as T
      results[index] = await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

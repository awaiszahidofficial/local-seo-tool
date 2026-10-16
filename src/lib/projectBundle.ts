import type { BusinessListingRow, CrawlPageRow, CrawlRow, GbpProfileRow, ProjectRow } from '../types/database'
import { getLatestCrawl, listCrawlPages } from './crawls'
import { getGbpProfile } from './gbp'
import { listListings } from './listings'
import { getGscPerformance, getGscStatus, type GscPerformance } from './searchConsole'

/**
 * Everything the other modules know about one project, loaded in parallel. Used by
 * Recommendations and Reports. Each source fails on its own: a missing migration or an
 * unconnected Google account leaves that part empty and is listed in `problems`.
 */

export type GscState = 'ok' | 'not_configured' | 'not_connected' | 'no_property' | 'error'

export type ProjectBundle = {
  crawl: CrawlRow | null
  pages: CrawlPageRow[]
  gbp: GbpProfileRow | null
  listings: BusinessListingRow[] | null
  gsc: GscPerformance | null
  gscState: GscState
  /** Human-readable problems loading individual sources. */
  problems: string[]
}

async function loadCrawl(projectId: string): Promise<{ crawl: CrawlRow | null; pages: CrawlPageRow[]; problem: string | null }> {
  const latest = await getLatestCrawl(projectId)
  if (latest.error) return { crawl: null, pages: [], problem: `Crawl: ${latest.error}` }
  if (!latest.data || latest.data.status !== 'completed') return { crawl: latest.data, pages: [], problem: null }
  const pages = await listCrawlPages(latest.data.id)
  if (pages.error) return { crawl: latest.data, pages: [], problem: `Crawl pages: ${pages.error}` }
  return { crawl: latest.data, pages: pages.data ?? [], problem: null }
}

async function loadGsc(project: ProjectRow): Promise<{ gsc: GscPerformance | null; state: GscState; problem: string | null }> {
  const status = await getGscStatus()
  if (status.data === null) {
    if (status.code === 'not_configured' || status.code === 'not_deployed') return { gsc: null, state: 'not_configured', problem: null }
    return { gsc: null, state: 'error', problem: `Search Console: ${status.error}` }
  }
  if (!status.data.connected) return { gsc: null, state: 'not_connected', problem: null }
  if (!project.gsc_property) return { gsc: null, state: 'no_property', problem: null }
  const performance = await getGscPerformance(project.id, 28)
  if (performance.data === null) {
    if (performance.code === 'reconnect') return { gsc: null, state: 'not_connected', problem: null }
    return { gsc: null, state: 'error', problem: `Search Console: ${performance.error}` }
  }
  return { gsc: performance.data, state: 'ok', problem: null }
}

export async function loadProjectBundle(project: ProjectRow): Promise<ProjectBundle> {
  const [crawl, gbp, listings, gsc] = await Promise.all([
    loadCrawl(project.id),
    getGbpProfile(project.id),
    listListings(project.id),
    loadGsc(project),
  ])
  const problems = [
    crawl.problem,
    gbp.error ? `Business Profile: ${gbp.error}` : null,
    listings.error ? `Listings: ${listings.error}` : null,
    gsc.problem,
  ].filter((problem): problem is string => problem !== null)
  return {
    crawl: crawl.crawl,
    pages: crawl.pages,
    gbp: gbp.data,
    listings: listings.data,
    gsc: gsc.gsc,
    gscState: gsc.state,
    problems,
  }
}

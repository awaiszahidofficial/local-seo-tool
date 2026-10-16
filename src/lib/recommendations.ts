import { ISSUE_META } from '../../supabase/functions/_shared/issues.ts'
import type { ProjectRow, RecommendationStateRow } from '../types/database'
import { summarizeCrawl } from './crawls'
import { auditGbp } from './gbpAudit'
import { lowCtr, mergePeriods, strikingDistance } from './gscAnalysis'
import { buildKeywordReport } from './keywords'
import { DIRECTORIES, referenceNap, summarizeListings } from './listings'
import { auditSite, needsRecrawl } from './localAudit'
import type { ProjectBundle } from './projectBundle'
import { analyzeCoverage, effectiveAreas, slugify } from './serviceArea'

/**
 * Recommendations: every module's findings for one project, turned into one list of next steps
 * ranked by impact and effort. Keys are stable, so "done" and "dismissed" survive re-crawls.
 */

export type Impact = 'high' | 'medium' | 'low'
export type Effort = 'quick' | 'medium' | 'large'
export type RecModule = 'setup' | 'crawler' | 'audit' | 'coverage' | 'gbp' | 'listings' | 'keywords' | 'search_console'

export const MODULE_LABELS: Record<RecModule, string> = {
  setup: 'Setup',
  crawler: 'Website Crawler',
  audit: 'Local Page Auditor',
  coverage: 'Service-Area Coverage',
  gbp: 'Business Profile',
  listings: 'Business Listings',
  keywords: 'Keyword Opportunities',
  search_console: 'Search Console',
}

export const IMPACT_LABELS: Record<Impact, string> = { high: 'High impact', medium: 'Medium impact', low: 'Low impact' }
export const EFFORT_LABELS: Record<Effort, string> = { quick: 'Quick win', medium: 'Some work', large: 'Bigger job' }

export type Recommendation = {
  key: string
  module: RecModule
  title: string
  detail: string
  impact: Impact
  effort: Effort
  /** In-app link to the module page with the details. */
  link: string
}

const IMPACT_SCORE: Record<Impact, number> = { high: 3, medium: 2, low: 1 }
const EFFORT_SCORE: Record<Effort, number> = { quick: 2, medium: 1, large: 0 }

export function recScore(rec: Pick<Recommendation, 'impact' | 'effort'>): number {
  return IMPACT_SCORE[rec.impact] * 10 + EFFORT_SCORE[rec.effort]
}

function effortForPages(count: number): Effort {
  return count <= 3 ? 'quick' : count <= 20 ? 'medium' : 'large'
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function keyPart(value: string): string {
  return slugify(value).slice(0, 80) || 'item'
}

export function buildRecommendations(project: ProjectRow, bundle: ProjectBundle): Recommendation[] {
  const recs: Recommendation[] = []
  const add = (rec: Recommendation) => {
    if (!recs.some((existing) => existing.key === rec.key)) recs.push(rec)
  }
  const q = `?project=${project.id}`
  const pages = bundle.pages
  const crawled = bundle.crawl?.status === 'completed' && pages.length > 0
  const stale = crawled && needsRecrawl(pages)

  // ---- Setup gaps ---------------------------------------------------------------------------
  if (!crawled) {
    add({
      key: 'setup:crawl',
      module: 'setup',
      title: 'Crawl the website',
      detail: 'Most checks (page audit, service-area coverage, keyword mapping) need a completed crawl of the site.',
      impact: 'high',
      effort: 'quick',
      link: `/crawler${q}`,
    })
  } else if (stale) {
    add({
      key: 'setup:recrawl',
      module: 'setup',
      title: 'Crawl the website again',
      detail: 'The latest crawl is from before local signals were collected, so the page audit cannot run.',
      impact: 'high',
      effort: 'quick',
      link: `/crawler${q}`,
    })
  }
  if (!project.location && (project.service_areas ?? []).length === 0) {
    add({
      key: 'setup:areas',
      module: 'setup',
      title: 'Add the location and service areas',
      detail: 'Without them, location checks, coverage and local keyword ideas are skipped.',
      impact: 'high',
      effort: 'quick',
      link: `/service-area${q}`,
    })
  }
  if (!bundle.gbp) {
    add({
      key: 'setup:gbp',
      module: 'setup',
      title: 'Enter the Google Business Profile details',
      detail: 'The profile is usually the biggest local ranking factor. Enter its details to audit it and to check listings against it.',
      impact: 'medium',
      effort: 'quick',
      link: `/gbp-audit${q}`,
    })
  }
  if (bundle.gscState === 'not_connected' || bundle.gscState === 'no_property') {
    add({
      key: 'setup:gsc',
      module: 'setup',
      title: bundle.gscState === 'no_property' ? 'Link this project to its Search Console property' : 'Connect Google Search Console',
      detail: 'Real search data shows which searches are close to page one and which pages are losing clicks.',
      impact: 'low',
      effort: 'quick',
      link: `/search-console${q}`,
    })
  }

  // ---- Crawler issues -----------------------------------------------------------------------
  if (crawled) {
    for (const issue of summarizeCrawl(pages).issueCounts) {
      if (issue.severity === 'info') continue
      add({
        key: `crawler:${issue.code}`,
        module: 'crawler',
        title: ISSUE_META[issue.code].label,
        detail: `Affects ${plural(issue.count, 'page')}. Filter the crawler’s page list to find them.`,
        impact: issue.severity === 'error' ? 'high' : 'medium',
        effort: effortForPages(issue.count),
        link: `/crawler${q}`,
      })
    }
  }

  // ---- Local page audit ---------------------------------------------------------------------
  if (crawled && !stale) {
    const audit = auditSite(project, pages)
    for (const fix of audit.topFixes) {
      add({
        key: `audit:${fix.id}`,
        module: 'audit',
        title: fix.label,
        detail: `${fix.status === 'fail' ? 'Failing' : 'Could be better'} on ${plural(fix.pages, 'page')}. The auditor lists each page and the exact change.`,
        impact: fix.status === 'fail' ? 'high' : 'medium',
        effort: effortForPages(fix.pages),
        link: `/page-auditor${q}`,
      })
    }
  }

  // ---- Service-area coverage ----------------------------------------------------------------
  if (crawled && effectiveAreas(project).length > 0) {
    const coverage = analyzeCoverage(project, pages)
    for (const area of coverage.areas) {
      const slug = keyPart(area.area.label)
      if (area.status === 'missing' || area.status === 'mentioned') {
        add({
          key: `coverage:page:${slug}`,
          module: 'coverage',
          title: `Create a page for ${area.area.name}`,
          detail:
            area.status === 'mentioned'
              ? `${area.area.name} is only mentioned in passing. A dedicated page with genuinely local content helps the business rank there.`
              : `Nothing on the site targets ${area.area.name}.`,
          impact: area.priority < 3 ? 'high' : 'medium',
          effort: 'medium',
          link: `/service-area${q}`,
        })
      } else if (area.status === 'needs_work' && area.bestPage) {
        add({
          key: `coverage:fix:${slug}`,
          module: 'coverage',
          title: `Improve the ${area.area.name} page`,
          detail: area.issues.map((issue) => issue.text).join(' '),
          impact: area.issues.some((issue) => issue.severity === 'fail') ? 'high' : 'medium',
          effort: area.issues.some((issue) => issue.id === 'duplicate' || issue.id === 'thin') ? 'medium' : 'quick',
          link: `/service-area${q}`,
        })
      }
    }
  }

  // ---- Keywords: services with no page at all ----------------------------------------------
  if (crawled) {
    const keywords = buildKeywordReport(project, pages, null, ['near_me'])
    for (const row of keywords.rows) {
      if (row.action !== 'create_page') continue
      add({
        key: `keywords:service:${keyPart(row.service)}`,
        module: 'keywords',
        title: `Create a page for “${row.service}”`,
        detail: `No page on the site is about ${row.service}. Each main service needs its own page to rank for searches like “${row.keyword}”.`,
        impact: 'high',
        effort: 'medium',
        link: `/keywords${q}`,
      })
    }
  }

  // ---- Business Profile ---------------------------------------------------------------------
  if (bundle.gbp) {
    const audit = auditGbp(project, bundle.gbp, crawled ? pages : null)
    for (const check of audit.topFixes) {
      add({
        key: `gbp:${check.id}`,
        module: 'gbp',
        title: check.label,
        detail: check.detail,
        impact: check.status === 'fail' ? (check.weight >= 2 ? 'high' : 'medium') : check.weight >= 2 ? 'medium' : 'low',
        effort: check.group === 'reviews' || check.group === 'posts' ? 'large' : 'quick',
        link: `/gbp-audit${q}`,
      })
    }
  }

  // ---- Listings -----------------------------------------------------------------------------
  if (bundle.listings) {
    const summary = summarizeListings(bundle.listings, referenceNap(project, bundle.gbp))
    for (const check of summary.checks) {
      if (check.listing.status === 'duplicate') {
        add({
          key: `listings:dup:${check.listing.id}`,
          module: 'listings',
          title: `Remove the duplicate ${check.listing.directory} listing`,
          detail: 'Duplicate listings split reviews and confuse search engines. Ask the directory to merge or remove it.',
          impact: 'medium',
          effort: 'quick',
          link: `/listings${q}`,
        })
      } else if (check.consistent === false || check.listing.status === 'needs_update') {
        add({
          key: `listings:fix:${check.listing.id}`,
          module: 'listings',
          title: `Fix the ${check.listing.directory} listing`,
          detail: check.mismatches.length > 0 ? `Different ${check.mismatches.join(', ')} from the correct details.` : 'Marked as needing an update.',
          impact: 'medium',
          effort: 'quick',
          link: `/listings${q}`,
        })
      }
    }
    for (const name of summary.missingCore) {
      const directory = DIRECTORIES.find((item) => item.name === name)
      add({
        key: `listings:add:${keyPart(name)}`,
        module: 'listings',
        title: `Get listed on ${name}`,
        detail: `${name} is one of the essential listings for local businesses.${directory ? ` Start at ${directory.addUrl}` : ''}`,
        impact: name === 'Google Business Profile' ? 'high' : 'medium',
        effort: 'quick',
        link: `/listings${q}`,
      })
    }
  }

  // ---- Search Console -----------------------------------------------------------------------
  if (bundle.gsc) {
    const queries = mergePeriods(bundle.gsc.queries.current, bundle.gsc.queries.previous)
    for (const row of strikingDistance(queries).slice(0, 5)) {
      add({
        key: `gsc:striking:${keyPart(row.key)}`,
        module: 'search_console',
        title: `Push “${row.key}” onto page one’s top spots`,
        detail: `Average position ${row.position?.toFixed(1)} with ${row.impressions} impressions in 28 days. Strengthen the page that ranks: title, headings, local content and internal links.`,
        impact: 'medium',
        effort: 'medium',
        link: `/search-console${q}`,
      })
    }
    for (const row of lowCtr(queries).slice(0, 3)) {
      add({
        key: `gsc:ctr:${keyPart(row.key)}`,
        module: 'search_console',
        title: `Get more clicks for “${row.key}”`,
        detail: `Ranks around ${row.position?.toFixed(1)} but only ${(row.ctr * 100).toFixed(1)}% click. Rewrite the page title and meta description to match the search.`,
        impact: 'medium',
        effort: 'quick',
        link: `/search-console${q}`,
      })
    }
  }

  return recs.sort((a, b) => recScore(b) - recScore(a))
}

export type RecView = 'open' | 'done' | 'dismissed'

export function splitByState(recs: readonly Recommendation[], states: readonly Pick<RecommendationStateRow, 'rec_key' | 'status'>[]) {
  const byKey = new Map(states.map((state) => [state.rec_key, state.status]))
  return {
    open: recs.filter((rec) => !byKey.has(rec.key)),
    done: recs.filter((rec) => byKey.get(rec.key) === 'done'),
    dismissed: recs.filter((rec) => byKey.get(rec.key) === 'dismissed'),
  }
}

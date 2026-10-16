import { ISSUE_META, isIssueCode } from '../../supabase/functions/_shared/issues.ts'
import type { ProjectRow, RecommendationStateRow, ReportRow } from '../types/database'
import { summarizeCrawl } from './crawls'
import { getDatabaseErrorMessage } from './errors'
import { auditGbp } from './gbpAudit'
import { compareTotals, isLocalQuery, localTerms, mergePeriods, sortByClicks, summarizeLocal } from './gscAnalysis'
import { referenceNap, summarizeListings } from './listings'
import { auditSite, needsRecrawl } from './localAudit'
import type { ProjectBundle } from './projectBundle'
import { isUuid, type DataResult } from './projects'
import { buildRecommendations, splitByState, type Effort, type Impact, type RecModule } from './recommendations'
import { analyzeCoverage, effectiveAreas, type AreaStatus } from './serviceArea'
import { supabase } from './supabase'

/**
 * A client report: a frozen JSON summary of every module at one point in time, so past reports
 * stay unchanged when the data moves on.
 */

export const SNAPSHOT_VERSION = 1

export type ReportSnapshot = {
  version: typeof SNAPSHOT_VERSION
  generatedAt: string
  project: { name: string; businessName: string | null; website: string; location: string | null }
  crawl: { date: string; pages: number; pagesWithErrors: number; pagesWithWarnings: number; cleanPages: number; topIssues: { label: string; pages: number; severity: string }[] } | null
  audit: { pages: number; passed: number; warnings: number; failed: number; topFixes: { label: string; pages: number; status: 'fail' | 'warn' }[] } | null
  coverage: { percent: number; totals: Record<AreaStatus, number>; areas: { name: string; status: AreaStatus; page: string | null }[] } | null
  gbp: { score: number | null; passed: number; warnings: number; failed: number; missing: number; topFixes: { label: string; status: string; detail: string }[]; reviews: number | null; rating: number | null } | null
  listings: { tracked: number; live: number; consistent: number; needFixing: number; missingCore: string[] } | null
  searchConsole: {
    property: string
    period: { start: string; end: string }
    clicks: number
    impressions: number
    ctr: number
    position: number
    clicksChangePct: number | null
    impressionsChangePct: number | null
    positionChange: number
    localClicks: number
    localShare: number | null
    topQueries: { query: string; clicks: number; impressions: number; position: number | null }[]
  } | null
  recommendations: { open: number; done: number; top: { title: string; detail: string; impact: Impact; effort: Effort; module: RecModule }[] }
}

export function buildSnapshot(
  project: ProjectRow,
  bundle: ProjectBundle,
  states: readonly Pick<RecommendationStateRow, 'rec_key' | 'status'>[],
  now: Date = new Date(),
): ReportSnapshot {
  const pages = bundle.pages
  const crawled = bundle.crawl?.status === 'completed' && pages.length > 0
  const auditable = crawled && !needsRecrawl(pages)

  const crawlSummary = crawled ? summarizeCrawl(pages) : null
  const audit = auditable ? auditSite(project, pages) : null
  const coverage = crawled && effectiveAreas(project).length > 0 ? analyzeCoverage(project, pages) : null
  const gbp = bundle.gbp ? auditGbp(project, bundle.gbp, crawled ? pages : null, now.toISOString().slice(0, 10)) : null
  const listings = bundle.listings ? summarizeListings(bundle.listings, referenceNap(project, bundle.gbp)) : null
  const recs = splitByState(buildRecommendations(project, bundle), states)

  let searchConsole: ReportSnapshot['searchConsole'] = null
  if (bundle.gsc) {
    const totals = compareTotals(bundle.gsc.totals.current, bundle.gsc.totals.previous)
    const queries = sortByClicks(mergePeriods(bundle.gsc.queries.current, bundle.gsc.queries.previous))
    const terms = localTerms(project)
    const local = summarizeLocal(
      queries.filter((row) => isLocalQuery(row.key, terms)),
      totals.current.clicks,
    )
    searchConsole = {
      property: bundle.gsc.property,
      period: { start: bundle.gsc.ranges.current.startDate, end: bundle.gsc.ranges.current.endDate },
      clicks: totals.current.clicks,
      impressions: totals.current.impressions,
      ctr: totals.current.ctr,
      position: totals.current.position,
      clicksChangePct: totals.clicksPct,
      impressionsChangePct: totals.impressionsPct,
      positionChange: totals.positionChange,
      localClicks: local.clicks,
      localShare: local.shareOfClicks,
      topQueries: queries.slice(0, 10).map((row) => ({ query: row.key, clicks: row.clicks, impressions: row.impressions, position: row.position })),
    }
  }

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    project: { name: project.name, businessName: project.business_name, website: project.website_url, location: project.location },
    crawl:
      crawlSummary && bundle.crawl
        ? {
            date: bundle.crawl.started_at,
            pages: crawlSummary.totalPages,
            pagesWithErrors: crawlSummary.pagesWithErrors,
            pagesWithWarnings: crawlSummary.pagesWithWarnings,
            cleanPages: crawlSummary.cleanPages,
            topIssues: crawlSummary.issueCounts
              .filter((issue) => issue.severity !== 'info')
              .slice(0, 8)
              .map((issue) => ({ label: issueLabel(issue.code), pages: issue.count, severity: issue.severity })),
          }
        : null,
    audit: audit
      ? {
          pages: audit.pages.length,
          passed: audit.totals.passed,
          warnings: audit.totals.warnings,
          failed: audit.totals.failed,
          topFixes: audit.topFixes.slice(0, 8).map((fix) => ({ label: fix.label, pages: fix.pages, status: fix.status })),
        }
      : null,
    coverage: coverage
      ? {
          percent: coverage.coveragePercent,
          totals: coverage.totals,
          areas: coverage.areas.slice(0, 40).map((area) => ({ name: area.area.label, status: area.status, page: area.bestPage?.url ?? null })),
        }
      : null,
    gbp: gbp
      ? {
          score: gbp.score,
          passed: gbp.counts.pass,
          warnings: gbp.counts.warn,
          failed: gbp.counts.fail,
          missing: gbp.counts.missing,
          topFixes: gbp.topFixes.slice(0, 6).map((check) => ({ label: check.label, status: check.status, detail: check.detail })),
          reviews: bundle.gbp?.review_count ?? null,
          rating: bundle.gbp?.rating === null || bundle.gbp?.rating === undefined ? null : Number(bundle.gbp.rating),
        }
      : null,
    listings: listings
      ? {
          tracked: listings.total,
          live: listings.live,
          consistent: listings.consistent,
          needFixing: listings.inconsistent + listings.duplicates,
          missingCore: listings.missingCore,
        }
      : null,
    searchConsole,
    recommendations: {
      open: recs.open.length,
      done: recs.done.length,
      top: recs.open.slice(0, 10).map((rec) => ({ title: rec.title, detail: rec.detail, impact: rec.impact, effort: rec.effort, module: rec.module })),
    },
  }
}

function issueLabel(code: string): string {
  return isIssueCode(code) ? ISSUE_META[code].label : code
}

export function isReportSnapshot(value: unknown): value is ReportSnapshot {
  return typeof value === 'object' && value !== null && (value as { version?: unknown }).version === SNAPSHOT_VERSION
}

export function defaultReportTitle(project: Pick<ProjectRow, 'name'>, now: Date = new Date()): string {
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now)
  return `${project.name}: local SEO report, ${month}`
}

// ---- Storage --------------------------------------------------------------------------------

const MISSING_TABLE =
  'Reports cannot be saved yet. Run the 20261022000000_listings_recommendations_reports.sql migration in Supabase, then try again.'

function mapError(error: unknown): string {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }) : {}
  if (record.code === '42P01' || record.code === 'PGRST205' || String(record.message ?? '').includes('reports')) return MISSING_TABLE
  return getDatabaseErrorMessage(error)
}

export type ReportListItem = Pick<ReportRow, 'id' | 'project_id' | 'title' | 'created_at'>

export async function listReports(projectId: string): Promise<DataResult<ReportListItem[]>> {
  if (!isUuid(projectId)) return { data: [], error: null }
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('id, project_id, title, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return { data: null, error: mapError(error) }
    return { data: (data ?? []) as ReportListItem[], error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

export async function getReport(id: string): Promise<DataResult<ReportRow | null>> {
  if (!isUuid(id)) return { data: null, error: null }
  try {
    const { data, error } = await supabase.from('reports').select('*').eq('id', id).maybeSingle()
    if (error) return { data: null, error: mapError(error) }
    return { data, error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

export async function saveReport(projectId: string, title: string, snapshot: ReportSnapshot): Promise<DataResult<ReportListItem>> {
  const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!isUuid(projectId)) return { data: null, error: 'Choose a project first.' }
  if (!cleanTitle) return { data: null, error: 'Enter a title for the report.' }
  try {
    const { data, error } = await supabase
      .from('reports')
      .insert({ project_id: projectId, title: cleanTitle, snapshot })
      .select('id, project_id, title, created_at')
      .single()
    if (error) return { data: null, error: mapError(error) }
    return { data: data as ReportListItem, error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

export async function deleteReport(id: string): Promise<DataResult<{ id: string }>> {
  if (!isUuid(id)) return { data: null, error: 'Report not found.' }
  try {
    const { data, error } = await supabase.from('reports').delete().eq('id', id).select('id')
    if (error) return { data: null, error: mapError(error) }
    if (!data || data.length === 0) return { data: null, error: 'Report not found, or you do not have access to it.' }
    return { data: { id }, error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

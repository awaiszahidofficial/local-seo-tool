import type { GscRow } from '../../supabase/functions/_shared/gsc.ts'
import { isLocalQuery } from './gscAnalysis'
import {
  buildAreaMatcher,
  buildServiceMatcher,
  effectiveAreas,
  effectiveServices,
  isUsable,
  matchesService,
  textMatchesArea,
  urlMatchesArea,
  urlMatchesService,
  type AreaMatcher,
  type CoveragePage,
  type CoverageProject,
  type ServiceMatcher,
} from './serviceArea'

/**
 * Keyword Opportunities: combines a project's services and service areas into the searches a
 * local customer would make, then checks which have a page on the site and how each is doing
 * in Google Search (when Search Console is connected). No search-volume data is invented.
 */

export type KeywordPattern = 'core' | 'near_me' | 'best' | 'cost' | 'emergency'

export const PATTERN_LABELS: Record<KeywordPattern, string> = {
  core: '[service] [city]',
  near_me: '[service] near me',
  best: 'best [service] [city]',
  cost: '[service] cost [city]',
  emergency: 'emergency [service] [city]',
}

export const DEFAULT_PATTERNS: readonly KeywordPattern[] = ['core', 'near_me']

/** Extra words a search must contain to count for a pattern (Search Console matching). */
const PATTERN_WORDS: Record<KeywordPattern, RegExp | null> = {
  core: null,
  near_me: /\b(near me|nearby|near by|close to me|around me)\b/i,
  best: /\b(best|top|top rated|top-rated)\b/i,
  cost: /\b(cost|costs|price|prices|pricing|how much|quote|estimate)\b/i,
  emergency: /\b(emergency|24 ?hour|24\/7|same day|same-day|urgent)\b/i,
}

export type KeywordStatus = 'top3' | 'page1' | 'striking' | 'low' | 'no_data' | 'unknown'

export const STATUS_LABELS: Record<KeywordStatus, string> = {
  top3: 'Top 3',
  page1: 'Page 1',
  striking: 'Page 2',
  low: 'Beyond page 2',
  no_data: 'Not showing',
  unknown: 'No Search Console data',
}

export type KeywordAction = 'create_page' | 'improve_page' | 'push_top' | 'keep'

export const ACTION_LABELS: Record<KeywordAction, string> = {
  create_page: 'Create a page',
  improve_page: 'Improve the page',
  push_top: 'Push into the top 3',
  keep: 'Keep it up',
}

export type KeywordGsc = {
  clicks: number
  impressions: number
  /** Impression-weighted average position across matching searches. */
  position: number
  matchingQueries: number
  topQuery: string
}

export type KeywordRow = {
  keyword: string
  service: string
  area: string | null
  pattern: KeywordPattern
  page: { url: string; title: string | null; match: 'dedicated' | 'service_only' } | null
  gsc: KeywordGsc | null
  status: KeywordStatus
  action: KeywordAction
  /** Lower is more urgent. */
  priority: number
}

export type KeywordReport = {
  rows: KeywordRow[]
  services: string[]
  areas: string[]
  /** Local searches from Search Console that none of the keywords above covers. */
  discovered: GscRow[]
  gscUsed: boolean
  counts: Record<KeywordAction, number>
}

function lower(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function buildKeyword(pattern: KeywordPattern, service: string, area: string | null): string {
  const s = lower(service)
  const a = area ? lower(area) : ''
  switch (pattern) {
    case 'core':
      return `${s} ${a}`.trim()
    case 'near_me':
      return `${s} near me`
    case 'best':
      return `best ${s} ${a}`.trim()
    case 'cost':
      return `${s} cost ${a}`.trim()
    case 'emergency':
      return `emergency ${s} ${a}`.trim()
  }
}

function findPage(pages: readonly CoveragePage[], service: ServiceMatcher, area: AreaMatcher | null): KeywordRow['page'] {
  const serviceHit = (page: CoveragePage) =>
    urlMatchesService(page.url, service) || matchesService(page.title, service) || matchesService(page.h1, service)
  const areaHit = (page: CoveragePage) =>
    area !== null && (urlMatchesArea(page.url, area) || textMatchesArea(page.title, area) || textMatchesArea(page.h1, area))
  const score = (page: CoveragePage) => (urlMatchesService(page.url, service) ? 2 : 0) + (area && urlMatchesArea(page.url, area) ? 2 : 0) + (page.word_count >= 300 ? 1 : 0)

  const both = area ? pages.filter((page) => serviceHit(page) && areaHit(page)).sort((a, b) => score(b) - score(a))[0] : undefined
  if (both) return { url: both.url, title: both.title, match: 'dedicated' }
  const serviceOnly = pages.filter(serviceHit).sort((a, b) => score(b) - score(a))[0]
  if (serviceOnly) return { url: serviceOnly.url, title: serviceOnly.title, match: area ? 'service_only' : 'dedicated' }
  return null
}

function areaRegex(area: AreaMatcher): RegExp {
  const alternation = [...area.terms].sort((a, b) => b.length - a.length).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'iu')
}

function matchQueries(rows: readonly GscRow[], service: ServiceMatcher, area: AreaMatcher | null, pattern: KeywordPattern): GscRow[] {
  const areaPattern = area ? areaRegex(area) : null
  const extra = PATTERN_WORDS[pattern]
  return rows.filter((row) => {
    if (!matchesService(row.key, service)) return false
    if (areaPattern && !areaPattern.test(row.key)) return false
    if (extra && !extra.test(row.key)) return false
    return true
  })
}

function summarizeQueries(rows: readonly GscRow[]): KeywordGsc | null {
  if (rows.length === 0) return null
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0)
  const weighted = rows.reduce((sum, row) => sum + row.position * row.impressions, 0)
  const top = [...rows].sort((a, b) => b.impressions - a.impressions)[0]
  return {
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    impressions,
    position: impressions > 0 ? Math.round((weighted / impressions) * 10) / 10 : 0,
    matchingQueries: rows.length,
    topQuery: top?.key ?? '',
  }
}

function statusFor(gsc: KeywordGsc | null, gscUsed: boolean): KeywordStatus {
  if (!gscUsed) return 'unknown'
  if (!gsc || gsc.impressions === 0) return 'no_data'
  if (gsc.position <= 3) return 'top3'
  if (gsc.position <= 10) return 'page1'
  if (gsc.position <= 20) return 'striking'
  return 'low'
}

function actionFor(page: KeywordRow['page'], status: KeywordStatus): KeywordAction {
  if (!page || page.match === 'service_only') return status === 'top3' ? 'keep' : 'create_page'
  if (status === 'top3') return 'keep'
  if (status === 'page1') return 'push_top'
  return 'improve_page'
}

const ACTION_RANK: Record<KeywordAction, number> = { create_page: 0, improve_page: 1, push_top: 2, keep: 3 }

export function buildKeywordReport(
  project: CoverageProject,
  pages: readonly CoveragePage[],
  gscQueries: readonly GscRow[] | null,
  patterns: readonly KeywordPattern[] = DEFAULT_PATTERNS,
): KeywordReport {
  const services = effectiveServices(project)
  const areas = effectiveAreas(project)
  const usable = pages.filter((page) => isUsable(page) && !page.final_url)
  const gscUsed = gscQueries !== null
  const queries = gscQueries ?? []
  const rows: KeywordRow[] = []
  const covered = new Set<string>()

  services.forEach((serviceLabel, serviceIndex) => {
    const service = buildServiceMatcher(serviceLabel)
    for (const pattern of patterns) {
      const targets: (string | null)[] = pattern === 'near_me' ? [null] : areas
      targets.forEach((areaLabel, areaIndex) => {
        const area = areaLabel ? buildAreaMatcher(areaLabel) : null
        const matched = matchQueries(queries, service, area, pattern)
        for (const row of matched) covered.add(row.key)
        const gsc = summarizeQueries(matched)
        const page = findPage(usable, service, area)
        const status = statusFor(gsc, gscUsed)
        const action = actionFor(page, status)
        rows.push({
          keyword: buildKeyword(pattern, serviceLabel, area?.name ?? null),
          service: serviceLabel,
          area: area?.name ?? null,
          pattern,
          page,
          gsc,
          status,
          action,
          priority: ACTION_RANK[action] * 100_000 + areaIndex * 1_000 + serviceIndex * 10 + patterns.indexOf(pattern),
        })
      })
    }
  })

  // Same keyword text from two patterns (rare) is shown once.
  const unique = new Map<string, KeywordRow>()
  for (const row of rows) if (!unique.has(row.keyword)) unique.set(row.keyword, row)
  const sorted = [...unique.values()].sort((a, b) => a.priority - b.priority)

  const localTerms = areas.flatMap((label) => buildAreaMatcher(label).terms)
  const discovered = queries
    .filter((row) => row.impressions >= 10 && !covered.has(row.key) && isLocalQuery(row.key, localTerms))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30)

  const counts: Record<KeywordAction, number> = { create_page: 0, improve_page: 0, push_top: 0, keep: 0 }
  for (const row of sorted) counts[row.action] += 1

  return { rows: sorted, services, areas: areas.map((label) => buildAreaMatcher(label).name), discovered, gscUsed, counts }
}

// ---- CSV ------------------------------------------------------------------------------------

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  // Prefix formula-like cells so spreadsheets do not execute them.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function keywordsToCsv(rows: readonly KeywordRow[]): string {
  const header = ['Keyword', 'Service', 'Area', 'Status', 'Avg position', 'Impressions', 'Clicks', 'Top matching search', 'Page', 'Action']
  const lines = rows.map((row) =>
    [
      row.keyword,
      row.service,
      row.area,
      STATUS_LABELS[row.status],
      row.gsc ? row.gsc.position : null,
      row.gsc ? row.gsc.impressions : null,
      row.gsc ? row.gsc.clicks : null,
      row.gsc?.topQuery ?? null,
      row.page?.url ?? null,
      ACTION_LABELS[row.action],
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...lines].join('\r\n')
}

/** Starts a browser download of a text file. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([String.fromCharCode(0xfeff), text], { type }) // BOM so Excel reads UTF-8
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

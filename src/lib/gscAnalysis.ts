import type { GscRow, GscTotals } from '../../supabase/functions/_shared/gsc.ts'
import type { ProjectRow } from '../types/database'
import { buildAreaMatcher, effectiveAreas } from './serviceArea'

/**
 * Search Console analysis: pure functions over the two periods returned by the `gsc` function.
 */

export type RowChange = {
  key: string
  clicks: number
  impressions: number
  ctr: number
  /** Average position this period; null when the row had no impressions this period. */
  position: number | null
  prevClicks: number
  prevImpressions: number
  prevPosition: number | null
  clickChange: number
  /** Positive when the average position improved (moved up the results). */
  positionChange: number | null
}

/** Joins this period's rows with the previous period's, keeping rows that appear in either. */
export function mergePeriods(current: readonly GscRow[], previous: readonly GscRow[]): RowChange[] {
  const before = new Map(previous.map((row) => [row.key, row]))
  const out: RowChange[] = []
  const seen = new Set<string>()
  for (const row of current) {
    seen.add(row.key)
    const prev = before.get(row.key)
    out.push({
      key: row.key,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      prevClicks: prev?.clicks ?? 0,
      prevImpressions: prev?.impressions ?? 0,
      prevPosition: prev ? prev.position : null,
      clickChange: row.clicks - (prev?.clicks ?? 0),
      positionChange: prev ? Math.round((prev.position - row.position) * 10) / 10 : null,
    })
  }
  for (const prev of previous) {
    if (seen.has(prev.key)) continue
    out.push({
      key: prev.key,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: null,
      prevClicks: prev.clicks,
      prevImpressions: prev.impressions,
      prevPosition: prev.position,
      clickChange: -prev.clicks,
      positionChange: null,
    })
  }
  return out
}

export type TotalsChange = {
  current: GscTotals
  previous: GscTotals
  /** Percentage change, or null when the previous value was zero. */
  clicksPct: number | null
  impressionsPct: number | null
  /** Change in CTR, in percentage points. */
  ctrPoints: number
  /** Positive when the average position improved. */
  positionChange: number
}

function pct(now: number, before: number): number | null {
  return before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10
}

export function compareTotals(current: GscTotals, previous: GscTotals): TotalsChange {
  return {
    current,
    previous,
    clicksPct: pct(current.clicks, previous.clicks),
    impressionsPct: pct(current.impressions, previous.impressions),
    ctrPoints: Math.round((current.ctr - previous.ctr) * 1000) / 10,
    positionChange: previous.position === 0 || current.position === 0 ? 0 : Math.round((previous.position - current.position) * 10) / 10,
  }
}

// ---- Local queries ---------------------------------------------------------------------------

const NEAR_ME = /\b(near me|nearby|near by|close to me|around me|in my area)\b/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Terms that make a query "local": every service-area name (or the primary location). */
export function localTerms(project: Pick<ProjectRow, 'location'> & { service_areas?: string[] | null }): string[] {
  const terms = new Set<string>()
  for (const area of effectiveAreas({ ...project, name: '', business_name: null, business_type: null })) {
    for (const term of buildAreaMatcher(area).terms) terms.add(term)
  }
  return [...terms]
}

export function isLocalQuery(query: string, terms: readonly string[]): boolean {
  if (NEAR_ME.test(query)) return true
  if (terms.length === 0) return false
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
  return pattern.test(query)
}

// ---- Opportunities ---------------------------------------------------------------------------

/**
 * "Striking distance": queries ranking on average between positions 4 and 20 with real demand.
 * Moving these onto the top of page one is usually the quickest traffic win.
 */
export function strikingDistance(rows: readonly RowChange[], minImpressions = 20): RowChange[] {
  return rows
    .filter((row) => row.position !== null && row.position >= 4 && row.position <= 20 && row.impressions >= minImpressions)
    .sort((a, b) => b.impressions - a.impressions)
}

/** Rows whose click-through rate is far below what their position usually earns. */
export function lowCtr(rows: readonly RowChange[], minImpressions = 100): RowChange[] {
  return rows
    .filter((row) => row.position !== null && row.position <= 5 && row.impressions >= minImpressions && row.ctr < expectedCtr(row.position) / 2)
    .sort((a, b) => b.impressions - a.impressions)
}

/** Rough typical CTR by average position (organic, desktop and mobile mixed). */
export function expectedCtr(position: number): number {
  if (position <= 1.5) return 0.28
  if (position <= 2.5) return 0.15
  if (position <= 3.5) return 0.1
  if (position <= 5.5) return 0.06
  if (position <= 10.5) return 0.025
  return 0.01
}

export function topMovers(rows: readonly RowChange[], limit = 10): { gainers: RowChange[]; losers: RowChange[] } {
  const gainers = rows.filter((row) => row.clickChange > 0).sort((a, b) => b.clickChange - a.clickChange).slice(0, limit)
  const losers = rows.filter((row) => row.clickChange < 0).sort((a, b) => a.clickChange - b.clickChange).slice(0, limit)
  return { gainers, losers }
}

export function sortByClicks(rows: readonly RowChange[]): RowChange[] {
  return [...rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
}

export type LocalSummary = { queries: number; clicks: number; impressions: number; shareOfClicks: number | null }

export function summarizeLocal(rows: readonly RowChange[], totalClicks: number): LocalSummary {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0)
  return {
    queries: rows.filter((row) => row.impressions > 0).length,
    clicks,
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    shareOfClicks: totalClicks > 0 ? Math.round((clicks / totalClicks) * 1000) / 10 : null,
  }
}

/** Picks the property most likely to belong to a website (domain property first). */
export function suggestProperty(websiteUrl: string, sites: readonly { siteUrl: string }[]): string | null {
  let host: string
  try {
    host = new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  const domain = sites.find((site) => site.siteUrl.toLowerCase() === `sc-domain:${host}`)
  if (domain) return domain.siteUrl
  const prefix = sites.find((site) => {
    try {
      return new URL(site.siteUrl).hostname.toLowerCase().replace(/^www\./, '') === host
    } catch {
      return false
    }
  })
  return prefix?.siteUrl ?? null
}

// ---- Daily trend -----------------------------------------------------------------------------

export type DailyPoint = { date: string; clicks: number; impressions: number }

/** One point per day of the range; days Google reports nothing for count as zero. */
export function dailySeries(range: { startDate: string; endDate: string }, rows: readonly GscRow[]): DailyPoint[] {
  const byDate = new Map(rows.map((row) => [row.key, row]))
  const out: DailyPoint[] = []
  const start = Date.parse(`${range.startDate}T00:00:00Z`)
  const end = Date.parse(`${range.endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out
  for (let time = start; time <= end && out.length < 400; time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10)
    const row = byDate.get(date)
    out.push({ date, clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0 })
  }
  return out
}

/** Rounds a maximum up to a tidy axis limit (1, 2, 2.5, 5 × 10ⁿ). */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * base) return step * base
  }
  return 10 * base
}

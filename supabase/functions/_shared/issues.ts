/**
 * SEO issue rules shared by the crawl-site Edge Function (Deno) and the browser UI.
 * Keep this file dependency-free and free of Deno/DOM globals.
 */

export type IssueSeverity = 'error' | 'warning' | 'info'

export const ISSUE_META = {
  fetch_error: { label: 'Page could not be fetched', severity: 'error' },
  http_error: { label: 'Returns an error status (4xx/5xx)', severity: 'error' },
  missing_title: { label: 'Missing title', severity: 'error' },
  missing_h1: { label: 'Missing H1 heading', severity: 'error' },
  title_too_short: { label: 'Title is short (under 30 characters)', severity: 'warning' },
  title_too_long: { label: 'Title is long (over 60 characters)', severity: 'warning' },
  duplicate_title: { label: 'Title is used on other pages', severity: 'warning' },
  missing_meta_description: { label: 'Missing meta description', severity: 'warning' },
  meta_description_too_long: { label: 'Meta description is long (over 160 characters)', severity: 'warning' },
  duplicate_meta_description: { label: 'Meta description is used on other pages', severity: 'warning' },
  multiple_h1: { label: 'More than one H1 heading', severity: 'warning' },
  thin_content: { label: 'Thin content (under 300 words)', severity: 'warning' },
  noindex: { label: 'Marked noindex (hidden from search)', severity: 'warning' },
  meta_description_too_short: { label: 'Meta description is short (under 70 characters)', severity: 'info' },
  missing_canonical: { label: 'No canonical URL set', severity: 'info' },
  slow_response: { label: 'Slow response (over 3 seconds)', severity: 'info' },
} as const satisfies Record<string, { label: string; severity: IssueSeverity }>

export type IssueCode = keyof typeof ISSUE_META

export const ISSUE_CODES = Object.keys(ISSUE_META) as IssueCode[]

export function isIssueCode(value: string): value is IssueCode {
  return Object.prototype.hasOwnProperty.call(ISSUE_META, value)
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }

/** Highest severity among the given codes, or null when there are none (unknown codes are ignored). */
export function worstSeverity(codes: readonly string[]): IssueSeverity | null {
  let worst: IssueSeverity | null = null
  for (const code of codes) {
    if (!isIssueCode(code)) continue
    const severity = ISSUE_META[code].severity
    if (worst === null || SEVERITY_RANK[severity] < SEVERITY_RANK[worst]) worst = severity
  }
  return worst
}

/** Sorts issue codes most severe first, dropping unknown codes. */
export function sortIssues(codes: readonly string[]): IssueCode[] {
  return codes
    .filter(isIssueCode)
    .sort((a, b) => SEVERITY_RANK[ISSUE_META[a].severity] - SEVERITY_RANK[ISSUE_META[b].severity])
}

export type PageFacts = {
  statusCode: number | null
  fetchFailed: boolean
  title: string | null
  metaDescription: string | null
  h1Count: number
  wordCount: number
  canonicalUrl: string | null
  robotsMeta: string | null
  responseTimeMs: number | null
}

export const THRESHOLDS = {
  titleMin: 30,
  titleMax: 60,
  metaMin: 70,
  metaMax: 160,
  thinWords: 300,
  slowMs: 3000,
} as const

/** Per-page checks. Cross-page checks (duplicates) are added by `findDuplicateIssues`. */
export function analyzePage(facts: PageFacts): IssueCode[] {
  const issues: IssueCode[] = []

  if (facts.fetchFailed) return ['fetch_error']
  if (facts.statusCode !== null && facts.statusCode >= 400) return ['http_error']

  const title = facts.title?.trim() ?? ''
  if (title === '') issues.push('missing_title')
  else if (title.length < THRESHOLDS.titleMin) issues.push('title_too_short')
  else if (title.length > THRESHOLDS.titleMax) issues.push('title_too_long')

  const description = facts.metaDescription?.trim() ?? ''
  if (description === '') issues.push('missing_meta_description')
  else if (description.length > THRESHOLDS.metaMax) issues.push('meta_description_too_long')
  else if (description.length < THRESHOLDS.metaMin) issues.push('meta_description_too_short')

  if (facts.h1Count === 0) issues.push('missing_h1')
  else if (facts.h1Count > 1) issues.push('multiple_h1')

  if (facts.wordCount < THRESHOLDS.thinWords) issues.push('thin_content')
  if (facts.robotsMeta && /\bnoindex\b/i.test(facts.robotsMeta)) issues.push('noindex')
  if (!facts.canonicalUrl) issues.push('missing_canonical')
  if (facts.responseTimeMs !== null && facts.responseTimeMs > THRESHOLDS.slowMs) issues.push('slow_response')

  return issues
}

type DuplicateInput = { title: string | null; metaDescription: string | null }

/**
 * Returns, per input index, the cross-page duplicate issues. Comparison is case-insensitive and
 * ignores surrounding whitespace; empty values are never counted as duplicates.
 */
export function findDuplicateIssues(pages: readonly DuplicateInput[]): IssueCode[][] {
  const countBy = (pick: (page: DuplicateInput) => string | null) => {
    const counts = new Map<string, number>()
    for (const page of pages) {
      const key = pick(page)?.trim().toLowerCase()
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }
  const titles = countBy((page) => page.title)
  const descriptions = countBy((page) => page.metaDescription)

  return pages.map((page) => {
    const issues: IssueCode[] = []
    const title = page.title?.trim().toLowerCase()
    const description = page.metaDescription?.trim().toLowerCase()
    if (title && (titles.get(title) ?? 0) > 1) issues.push('duplicate_title')
    if (description && (descriptions.get(description) ?? 0) > 1) issues.push('duplicate_meta_description')
    return issues
  })
}

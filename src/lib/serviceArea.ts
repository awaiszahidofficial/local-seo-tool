import type { CrawlPageRow, ProjectRow } from '../types/database'
import { buildContext, countTerms } from './localAudit'

/**
 * Service-Area Coverage engine. Pure functions over a project's service areas / services and its
 * latest crawl: which areas have a dedicated page, how good those pages are, which service + area
 * combinations exist, and which pages to create next. No network, no database.
 */

export const MAX_LIST_ITEMS = 100
export const MAX_ITEM_LENGTH = 100

export type CoverageProject = Pick<ProjectRow, 'name' | 'business_name' | 'location' | 'business_type'> & {
  service_areas?: string[] | null
  services?: string[] | null
}

export type CoveragePage = Pick<
  CrawlPageRow,
  'id' | 'url' | 'final_url' | 'status_code' | 'error' | 'title' | 'h1' | 'meta_description' | 'word_count' | 'robots_meta' | 'body_text' | 'link_paths'
>

// ---------------------------------------------------------------------------------------------
// Input lists
// ---------------------------------------------------------------------------------------------

/**
 * Turns textarea input (one item per line; commas inside a line are kept, e.g. "Round Rock, TX")
 * into a clean list: trimmed, de-duplicated case-insensitively, capped in count and length.
 */
export function parseList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n;]+/)) {
    const item = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH).trim()
    const key = item.toLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= MAX_LIST_ITEMS) break
  }
  return out
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

const ABBREVIATIONS: readonly [RegExp, string][] = [
  [/^st\.?\s+/i, 'saint '],
  [/^saint\s+/i, 'st '],
  [/^mt\.?\s+/i, 'mount '],
  [/^mount\s+/i, 'mt '],
  [/^ft\.?\s+/i, 'fort '],
  [/^fort\s+/i, 'ft '],
]

export type AreaMatcher = {
  /** As entered, e.g. "Round Rock, TX". */
  label: string
  /** The place name: text before the first comma ("Round Rock"). */
  name: string
  /** Text after the first comma ("TX"), used in suggested titles. */
  region: string | null
  /** Lower-cased text variants matched as whole words ("round rock", "st louis" / "saint louis"). */
  terms: string[]
  /** URL slug variants ("round-rock", "roundrock"). */
  slugs: string[]
}

export function buildAreaMatcher(label: string): AreaMatcher {
  const [first = '', ...rest] = label.split(',')
  const name = first.trim() || label.trim()
  const region = rest.join(',').trim() || null
  const base = name.toLowerCase().replace(/\s+/g, ' ')
  const variants = new Set([base, base.replace(/\./g, '')])
  for (const [pattern, replacement] of ABBREVIATIONS) {
    if (pattern.test(base)) variants.add(base.replace(pattern, replacement).replace(/\./g, ''))
  }
  const terms = [...variants].filter((term) => term.length >= 2)
  const slugs = new Set<string>()
  for (const term of terms) {
    const slug = slugify(term)
    if (slug.length >= 3) {
      slugs.add(slug)
      if (slug.includes('-')) slugs.add(slug.replace(/-/g, ''))
    }
  }
  return { label, name, region, terms, slugs: [...slugs] }
}

/** Service names plus word stems used to spot them in titles, headings and URLs. */
export type ServiceMatcher = { label: string; terms: string[]; stems: string[] }

const SERVICE_STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'services', 'service', 'company', 'local', 'professional', 'expert', 'best',
  'near', 'affordable', 'emergency', 'residential', 'commercial', 'free', 'same', 'day',
])

function stem(word: string): string {
  const stripped = word.replace(/(ing|ers|er|ists|ist|ians|ian|es|s)$/, '')
  return stripped.length >= 4 ? stripped : word
}

export function buildServiceMatcher(label: string): ServiceMatcher {
  const lower = label.toLowerCase().trim()
  const words = lower.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !SERVICE_STOP_WORDS.has(word))
  return { label, terms: [lower], stems: [...new Set(words.map(stem))] }
}

// ---------------------------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------------------------

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).toLowerCase()
  } catch {
    return ''
  }
}

function segmentsOf(url: string): string[] {
  return pathOf(url).split('/').filter(Boolean).map((segment) => segment.replace(/\.[a-z0-9]+$/, ''))
}

/** True when a URL path segment contains the slug as whole hyphen-separated words. */
function segmentHasSlug(segment: string, slug: string): boolean {
  if (segment === slug) return true
  const at = `-${segment}-`.indexOf(`-${slug}-`)
  return at !== -1
}

export function urlMatchesArea(url: string, area: AreaMatcher): boolean {
  const segments = segmentsOf(url)
  return segments.some((segment) => area.slugs.some((slug) => segmentHasSlug(segment, slug)))
}

export function textMatchesArea(text: string | null | undefined, area: AreaMatcher): boolean {
  return countTerms(text, area.terms) > 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchesService(text: string | null | undefined, service: ServiceMatcher): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  if (service.terms.some((term) => term.length >= 3 && lower.includes(term))) return true
  if (service.stems.length === 0) return false
  // every meaningful word of the service must appear (as a word start) for multi-word services
  return service.stems.every((s) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(s)}`, 'iu').test(lower))
}

export function urlMatchesService(url: string, service: ServiceMatcher): boolean {
  const path = segmentsOf(url).join(' ').replace(/-/g, ' ')
  return matchesService(path, service)
}

export function isUsable(page: CoveragePage): boolean {
  return page.error === null && page.status_code !== null && page.status_code >= 200 && page.status_code < 300
}

function isNoindex(page: CoveragePage): boolean {
  return !!page.robots_meta && /\bnoindex\b/i.test(page.robots_meta)
}

// ---------------------------------------------------------------------------------------------
// Near-duplicate detection (location pages that are the same text with the city swapped)
// ---------------------------------------------------------------------------------------------

const SHINGLE_SIZE = 5
const MIN_SHINGLES = 20
export const DUPLICATE_THRESHOLD = 0.8

/** Word 5-gram set of a text with every service-area name replaced by one placeholder. */
export function shingles(text: string, areas: readonly AreaMatcher[]): Set<string> {
  let normalized = text.toLowerCase()
  const allTerms = areas.flatMap((area) => area.terms).sort((a, b) => b.length - a.length)
  if (allTerms.length > 0) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${allTerms.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
    normalized = normalized.replace(pattern, ' areaname ')
  }
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const out = new Set<string>()
  for (let index = 0; index + SHINGLE_SIZE <= words.length; index += 1) {
    out.add(words.slice(index, index + SHINGLE_SIZE).join(' '))
  }
  return out
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size < MIN_SHINGLES || b.size < MIN_SHINGLES) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const item of small) if (large.has(item)) shared += 1
  return shared / (a.size + b.size - shared)
}

// ---------------------------------------------------------------------------------------------
// Coverage analysis
// ---------------------------------------------------------------------------------------------

export type AreaStatus = 'covered' | 'needs_work' | 'mentioned' | 'missing'

export const AREA_STATUS_LABELS: Record<AreaStatus, string> = {
  covered: 'Covered',
  needs_work: 'Page needs work',
  mentioned: 'Mentioned only',
  missing: 'No content',
}

export type PageIssue = { id: string; severity: 'fail' | 'warn'; text: string }

export type AreaPage = {
  pageId: string
  url: string
  title: string | null
  wordCount: number
  inUrl: boolean
  inTitle: boolean
  inH1: boolean
  mentions: number
}

export type AreaResult = {
  area: AreaMatcher
  /** 0-based position in the user's list (the list order is the priority order). */
  priority: number
  status: AreaStatus
  /** The strongest dedicated page, if any. */
  bestPage: AreaPage | null
  /** Other dedicated pages for this area (possible duplicates competing with each other). */
  otherDedicated: AreaPage[]
  /** Pages that mention the area in their content without being dedicated to it. */
  mentionPages: number
  issues: PageIssue[]
}

export type DuplicatePair = { a: AreaPage; b: AreaPage; areaA: string; areaB: string; similarity: number }

export type MatrixCell = { pageUrl: string | null }

export type CoverageMatrix = {
  services: string[]
  areas: string[]
  /** cells[serviceIndex][areaIndex] */
  cells: MatrixCell[][]
  covered: number
  total: number
}

export type PageSuggestion = {
  area: string
  service: string | null
  reason: 'missing' | 'mentioned' | 'service_gap'
  url: string
  title: string
  h1: string
}

export type CoverageReport = {
  areas: AreaResult[]
  totals: Record<AreaStatus, number>
  /** Share of areas with a dedicated page (covered or needing work), 0–100. */
  coveragePercent: number
  duplicates: DuplicatePair[]
  matrix: CoverageMatrix | null
  suggestions: PageSuggestion[]
  /** Path prefix existing area pages share (e.g. "/service-areas/"), used for suggested URLs. */
  areaPathPrefix: string
  usablePages: number
}

const THIN_WORDS = 300

function scorePage(page: AreaPage): number {
  return (page.inUrl ? 4 : 0) + (page.inH1 ? 3 : 0) + (page.inTitle ? 3 : 0) + Math.min(page.mentions, 5) + Math.min(page.wordCount / 300, 3)
}

function dedicatedPath(url: string): string {
  const path = pathOf(url)
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

/** Most common parent folder of dedicated area pages, e.g. "/service-areas/"; "/" when none. */
function commonAreaPrefix(urls: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const url of urls) {
    const segments = segmentsOf(url)
    if (segments.length < 2) continue
    const prefix = `/${segments.slice(0, -1).join('/')}/`
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  let best = '/'
  let bestCount = 1
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix
      bestCount = count
    }
  }
  return best === '/' ? '/service-areas/' : best
}

export function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

function placeLabel(area: AreaMatcher): string {
  return area.region ? `${area.name}, ${area.region}` : area.name
}

/** Default service list: the saved services, or the project's business type. */
export function effectiveServices(project: CoverageProject): string[] {
  const saved = (project.services ?? []).filter((item) => item.trim())
  if (saved.length > 0) return saved
  const type = project.business_type?.trim()
  return type ? [type] : []
}

/** Default area list: the saved service areas, or the project's primary location. */
export function effectiveAreas(project: CoverageProject): string[] {
  const saved = (project.service_areas ?? []).filter((item) => item.trim())
  if (saved.length > 0) return saved
  const location = project.location?.trim()
  return location ? [location] : []
}

export function analyzeCoverage(project: CoverageProject, allPages: readonly CoveragePage[]): CoverageReport {
  const areas = effectiveAreas(project).map(buildAreaMatcher)
  const services = effectiveServices(project).map(buildServiceMatcher)
  const brand = buildContext(project).brand
  const pages = allPages.filter((page) => isUsable(page) && !page.final_url)

  // Paths linked from other pages (link_paths holds up to 40 internal links per page).
  const inboundCount = new Map<string, number>()
  for (const page of pages) {
    const own = dedicatedPath(page.url)
    for (const raw of new Set(page.link_paths.map((path) => path.split('?')[0] ?? path))) {
      let key = raw.toLowerCase()
      try {
        key = decodeURIComponent(key)
      } catch {
        // keep as is
      }
      key = key.length > 1 ? key.replace(/\/$/, '') : key
      if (key === own) continue
      inboundCount.set(key, (inboundCount.get(key) ?? 0) + 1)
    }
  }

  const results: AreaResult[] = areas.map((area, priority) => {
    const dedicated: AreaPage[] = []
    let mentionPages = 0
    for (const page of pages) {
      const info: AreaPage = {
        pageId: page.id,
        url: page.url,
        title: page.title,
        wordCount: page.word_count,
        inUrl: urlMatchesArea(page.url, area),
        inTitle: textMatchesArea(page.title, area),
        inH1: textMatchesArea(page.h1, area),
        mentions: countTerms(page.body_text, area.terms),
      }
      if (info.inUrl || (info.inTitle && info.inH1)) dedicated.push(info)
      else if (info.mentions > 0 || info.inTitle || info.inH1) mentionPages += 1
    }
    dedicated.sort((a, b) => scorePage(b) - scorePage(a))
    const bestPage = dedicated[0] ?? null
    const issues: PageIssue[] = []

    if (bestPage) {
      const page = pages.find((candidate) => candidate.id === bestPage.pageId)
      if (page && isNoindex(page)) {
        issues.push({ id: 'noindex', severity: 'fail', text: 'The page is set to noindex, so Google will not show it.' })
      }
      if (!bestPage.inTitle) {
        issues.push({ id: 'title', severity: 'fail', text: `Put “${area.name}” in the page title.` })
      }
      if (!bestPage.inH1) {
        issues.push({ id: 'h1', severity: 'fail', text: `Put “${area.name}” in the main heading (H1).` })
      }
      if (bestPage.wordCount < THIN_WORDS) {
        issues.push({
          id: 'thin',
          severity: 'warn',
          text: `Only ${bestPage.wordCount} words. Aim for ${THIN_WORDS}+ words of genuinely local content (neighbourhoods, landmarks, local jobs, reviews).`,
        })
      }
      if (bestPage.mentions < 2) {
        issues.push({
          id: 'mentions',
          severity: 'warn',
          text: `The content mentions “${area.name}” ${bestPage.mentions === 0 ? 'nowhere' : 'only once'}. Work it in naturally a few times.`,
        })
      }
      if (services.length > 0 && page) {
        const text = [page.title, page.h1, page.meta_description, page.body_text].join(' ')
        if (!services.some((service) => matchesService(text, service))) {
          issues.push({
            id: 'service',
            severity: 'warn',
            text: `The page never names a service (${services.map((s) => s.label).slice(0, 3).join(', ')}). Say what you do in ${area.name}.`,
          })
        }
      }
      if ((inboundCount.get(dedicatedPath(bestPage.url)) ?? 0) === 0) {
        issues.push({
          id: 'orphan',
          severity: 'warn',
          text: 'No other crawled page links to it. Link to it from the home page, a service-areas page or the footer.',
        })
      }
      if (dedicated.length > 1) {
        issues.push({
          id: 'competing',
          severity: 'warn',
          text: `${dedicated.length} pages target ${area.name}. Make sure each has a distinct purpose (for example one per service), or merge them.`,
        })
      }
    }

    const hasFail = issues.some((issue) => issue.severity === 'fail')
    const status: AreaStatus = bestPage
      ? hasFail || issues.some((issue) => issue.id === 'thin')
        ? 'needs_work'
        : 'covered'
      : mentionPages > 0
        ? 'mentioned'
        : 'missing'

    return { area, priority, status, bestPage, otherDedicated: dedicated.slice(1), mentionPages, issues }
  })

  // Near-duplicates among the best dedicated pages of different areas.
  const duplicates: DuplicatePair[] = []
  const withPages = results.filter((result) => result.bestPage !== null)
  const shingleCache = new Map<string, Set<string>>()
  const shinglesFor = (pageId: string) => {
    let set = shingleCache.get(pageId)
    if (!set) {
      const page = pages.find((candidate) => candidate.id === pageId)
      set = shingles(page?.body_text ?? '', areas)
      shingleCache.set(pageId, set)
    }
    return set
  }
  for (let i = 0; i < withPages.length; i += 1) {
    for (let j = i + 1; j < withPages.length; j += 1) {
      const a = withPages[i]
      const b = withPages[j]
      if (!a?.bestPage || !b?.bestPage || a.bestPage.pageId === b.bestPage.pageId) continue
      const score = similarity(shinglesFor(a.bestPage.pageId), shinglesFor(b.bestPage.pageId))
      if (score >= DUPLICATE_THRESHOLD) {
        duplicates.push({ a: a.bestPage, b: b.bestPage, areaA: a.area.name, areaB: b.area.name, similarity: score })
      }
    }
  }
  duplicates.sort((x, y) => y.similarity - x.similarity)
  const duplicatedIds = new Set(duplicates.flatMap((pair) => [pair.a.pageId, pair.b.pageId]))
  for (const result of results) {
    if (result.bestPage && duplicatedIds.has(result.bestPage.pageId)) {
      result.issues.push({
        id: 'duplicate',
        severity: 'warn',
        text: 'The text is nearly the same as another area page with the city name swapped. Google may treat these as doorway pages; write unique local content.',
      })
      if (result.status === 'covered') result.status = 'needs_work'
    }
  }

  // Service x area matrix: a cell is covered when one page names both (URL, title or H1).
  let matrix: CoverageMatrix | null = null
  if (services.length > 0 && areas.length > 0) {
    let covered = 0
    const cells = services.map((service) =>
      areas.map((area) => {
        const page = pages.find((candidate) => {
          const areaHit =
            urlMatchesArea(candidate.url, area) || textMatchesArea(candidate.title, area) || textMatchesArea(candidate.h1, area)
          if (!areaHit) return false
          return (
            urlMatchesService(candidate.url, service) ||
            matchesService(candidate.title, service) ||
            matchesService(candidate.h1, service)
          )
        })
        if (page) covered += 1
        return { pageUrl: page?.url ?? null }
      }),
    )
    matrix = {
      services: services.map((service) => service.label),
      areas: areas.map((area) => area.name),
      cells,
      covered,
      total: services.length * areas.length,
    }
  }

  // Suggestions: areas without a dedicated page first (in the user's priority order), then
  // missing service + area combinations for areas that do have a page.
  const prefix = commonAreaPrefix(results.flatMap((result) => (result.bestPage ? [result.bestPage.url] : [])))
  const mainService = services[0]?.label ?? null
  const suggestions: PageSuggestion[] = []
  for (const result of results) {
    if (result.status !== 'missing' && result.status !== 'mentioned') continue
    const place = placeLabel(result.area)
    const lead = mainService ? `${titleCase(mainService)} in ${place}` : `Serving ${place}`
    suggestions.push({
      area: result.area.label,
      service: mainService,
      reason: result.status,
      url: `${prefix}${slugify(result.area.name)}/`,
      title: `${lead} | ${brand}`.slice(0, 70),
      h1: lead,
    })
  }
  if (matrix && services.length > 1) {
    matrix.cells.forEach((row, serviceIndex) => {
      row.forEach((cell, areaIndex) => {
        const area = areas[areaIndex]
        const service = services[serviceIndex]
        const areaResult = results[areaIndex]
        if (cell.pageUrl || !area || !service || !areaResult?.bestPage) return
        const lead = `${titleCase(service.label)} in ${placeLabel(area)}`
        suggestions.push({
          area: area.label,
          service: service.label,
          reason: 'service_gap',
          url: `${prefix}${slugify(area.name)}/${slugify(service.label)}/`,
          title: `${lead} | ${brand}`.slice(0, 70),
          h1: lead,
        })
      })
    })
  }

  const totals: Record<AreaStatus, number> = { covered: 0, needs_work: 0, mentioned: 0, missing: 0 }
  for (const result of results) totals[result.status] += 1
  const withPage = totals.covered + totals.needs_work

  return {
    areas: results,
    totals,
    coveragePercent: results.length === 0 ? 0 : Math.round((withPage / results.length) * 100),
    duplicates,
    matrix,
    suggestions,
    areaPathPrefix: prefix,
    usablePages: pages.length,
  }
}

// ---------------------------------------------------------------------------------------------
// Area suggestions from the site itself
// ---------------------------------------------------------------------------------------------

const AREA_FOLDER = /^(locations?|service-areas?|areas?|areas-we-serve|areas-served|cities|city|communities|neighbou?rhoods?|serving|near-me|where-we-work|coverage)$/

/**
 * Place names the site already seems to target: pages inside folders such as /service-areas/ or
 * /locations/. Returns title-cased names not already in `current`.
 */
export function suggestAreasFromSite(pages: readonly Pick<CrawlPageRow, 'url' | 'error' | 'status_code'>[], current: readonly string[]): string[] {
  const existing = current.map(buildAreaMatcher)
  const found = new Map<string, string>()
  for (const page of pages) {
    if (page.error !== null || page.status_code === null || page.status_code >= 300) continue
    const segments = segmentsOf(page.url)
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (!AREA_FOLDER.test(segments[index] ?? '')) continue
      const slug = segments[index + 1] ?? ''
      if (!/^[\p{L}][\p{L}-]{1,40}$/u.test(slug) || AREA_FOLDER.test(slug)) continue
      const name = titleCase(slug.replace(/-/g, ' '))
      const key = slugify(name)
      if (existing.some((area) => area.slugs.includes(key))) continue
      if (!found.has(key)) found.set(key, name)
    }
  }
  return [...found.values()].slice(0, 30)
}

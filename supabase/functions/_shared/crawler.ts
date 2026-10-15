/**
 * Website crawler core. Pure TypeScript with injected I/O (fetch and DNS checks) so it runs in the
 * Supabase Edge Function (Deno) and is unit-tested in Vitest (Node) without network access.
 *
 * Safety goals: only crawl public http(s) sites (no localhost / private networks), stay on the
 * project's own site, honour robots.txt, and bound pages, bytes and time.
 */
import { analyzePage, findDuplicateIssues, sortIssues, type IssueCode } from './issues.ts'

export const USER_AGENT = 'LocalSEOWorkbenchBot/1.0 (site audit requested by the site owner)'
const ROBOTS_AGENT = 'localseoworkbenchbot'

export type CrawlLimits = {
  maxPages: number
  maxBytes: number
  fetchTimeoutMs: number
  totalBudgetMs: number
  maxRedirects: number
  concurrency: number
}

export const DEFAULT_LIMITS: CrawlLimits = {
  maxPages: 25,
  maxBytes: 1_000_000,
  fetchTimeoutMs: 8_000,
  totalBudgetMs: 90_000,
  maxRedirects: 3,
  concurrency: 3,
}

// ---------------------------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------------------------

function parseIpv4(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa']

/**
 * True when a hostname must never be crawled: localhost, private/loopback/link-local IPv4 ranges,
 * every IPv6 literal, internal-only suffixes and single-label names.
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (host === '') return true
  if (host.includes(':') || host.startsWith('[')) return true
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true

  const ipv4 = parseIpv4(host)
  if (ipv4) return isPrivateIpv4(ipv4)
  if (/^[\d.]+$/.test(host)) return true // malformed numeric host
  return !host.includes('.')
}

/** For DNS results: true only for public unicast addresses. */
export function isPublicIp(ip: string): boolean {
  const value = ip.trim().toLowerCase()
  const ipv4 = parseIpv4(value)
  if (ipv4) return !isPrivateIpv4(ipv4)
  if (value.includes(':')) return /^[23]/.test(value) && !value.startsWith('2001:db8')
  return false
}

/** Parses a user-supplied URL; returns null unless it is a crawlable public http(s) URL. */
export function parseCrawlUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return null
  if (isBlockedHostname(url.hostname)) return null
  url.hash = ''
  return url
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

export function isSameSite(a: URL, b: URL): boolean {
  return bareHost(a.hostname) === bareHost(b.hostname)
}

const TRACKING_PARAMS = /^(utm_.+|gclid|fbclid|msclkid|mc_eid|_ga)$/i
const SKIPPED_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|zip|gz|tar|rar|mp[34]|mov|avi|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?|csv|txt|apk|dmg|exe)$/i

/** Key used to de-duplicate URLs: no fragment, no tracking params, no trailing slash (except root). */
export function normalizeForQueue(url: URL): string {
  const copy = new URL(url.href)
  copy.hash = ''
  for (const key of [...copy.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) copy.searchParams.delete(key)
  }
  if (copy.pathname.length > 1 && copy.pathname.endsWith('/')) copy.pathname = copy.pathname.slice(0, -1)
  return copy.href
}

// ---------------------------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------------------------

export type RobotsRules = { allow: string[]; disallow: string[] }

type RobotsGroup = { agents: string[]; rules: RobotsRules }

export function parseRobots(text: string, agent: string = ROBOTS_AGENT): RobotsRules {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let lastWasAgent = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current || value === '') continue
    if (field === 'allow') current.rules.allow.push(value)
    else if (field === 'disallow') current.rules.disallow.push(value)
  }

  const specific = groups.filter((group) => group.agents.some((name) => name !== '*' && agent.includes(name)))
  const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes('*'))
  return {
    allow: chosen.flatMap((group) => group.rules.allow),
    disallow: chosen.flatMap((group) => group.rules.disallow),
  }
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`)
}

/** Longest matching rule wins; Allow beats Disallow on a tie. Input is path plus query. */
export function isPathAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let bestLength = -1
  let allowed = true
  for (const pattern of rules.disallow) {
    if (patternToRegExp(pattern).test(pathAndQuery) && pattern.length > bestLength) {
      bestLength = pattern.length
      allowed = false
    }
  }
  for (const pattern of rules.allow) {
    if (patternToRegExp(pattern).test(pathAndQuery) && pattern.length >= bestLength) {
      bestLength = pattern.length
      allowed = true
    }
  }
  return allowed
}

// ---------------------------------------------------------------------------------------------
// HTML extraction (deliberately lightweight; no DOM available in Deno edge functions)
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function toText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const inner = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '')
  for (const match of inner.matchAll(pattern)) {
    const name = match[1]?.toLowerCase()
    if (name && !(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

export type PageExtract = {
  title: string | null
  metaDescription: string | null
  h1s: string[]
  canonicalUrl: string | null
  robotsMeta: string | null
  wordCount: number
  /** Followable same-or-other-site http(s) links, fragment removed, in document order. */
  links: URL[]
}

const MAX_HTML_CHARS = 2_000_000

export function extractPage(html: string, baseUrl: URL): PageExtract {
  const source = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(cleaned)
  const title = titleMatch ? toText(titleMatch[1] ?? '') || null : null

  let metaDescription: string | null = null
  let robotsMeta: string | null = null
  for (const tag of cleaned.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag)
    const name = attributes['name']?.toLowerCase()
    const content = attributes['content']?.replace(/\s+/g, ' ').trim()
    if (!content) continue
    if (name === 'description' && metaDescription === null) metaDescription = content
    if ((name === 'robots' || name === 'googlebot') && robotsMeta === null) robotsMeta = content
  }

  let canonicalUrl: string | null = null
  for (const tag of cleaned.match(/<link\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag)
    if (attributes['rel']?.toLowerCase().split(/\s+/).includes('canonical') && attributes['href']) {
      try {
        canonicalUrl = new URL(attributes['href'], baseUrl).href
      } catch {
        canonicalUrl = null
      }
      break
    }
  }

  const h1s: string[] = []
  for (const match of cleaned.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)) {
    const text = toText(match[1] ?? '')
    if (text) h1s.push(text)
  }

  const bodyStart = cleaned.search(/<body\b/i)
  const body = (bodyStart === -1 ? cleaned : cleaned.slice(bodyStart))
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  const words = toText(body).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  const wordCount = words ? words.length : 0

  const links: URL[] = []
  for (const tag of cleaned.match(/<a\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag)
    const href = attributes['href']?.trim()
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data|sms):/i.test(href)) continue
    if (attributes['rel']?.toLowerCase().split(/\s+/).includes('nofollow')) continue
    try {
      const url = new URL(href, baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      url.hash = ''
      links.push(url)
    } catch {
      // ignore malformed hrefs
    }
  }

  return { title, metaDescription, h1s, canonicalUrl, robotsMeta, wordCount, links }
}

// ---------------------------------------------------------------------------------------------
// Crawl loop
// ---------------------------------------------------------------------------------------------

export type CrawledPage = {
  url: string
  final_url: string | null
  status_code: number | null
  title: string | null
  meta_description: string | null
  h1: string | null
  h1_count: number
  word_count: number
  canonical_url: string | null
  robots_meta: string | null
  internal_links_count: number
  response_time_ms: number | null
  depth: number
  issues: IssueCode[]
  error: string | null
}

export type StopReason = 'completed' | 'page_limit' | 'time_limit' | 'blocked_by_robots'

export type CrawlResult = {
  pages: CrawledPage[]
  stoppedReason: StopReason
  skippedByRobots: number
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export type CrawlOptions = {
  startUrl: URL
  fetcher: Fetcher
  /** Resolve-and-verify hook: return false to refuse a hostname (e.g. DNS points to a private IP). */
  hostCheck?: (hostname: string) => Promise<boolean>
  now?: () => number
  limits?: Partial<CrawlLimits>
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null
  return value.length > max ? value.slice(0, max) : value
}

async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, maxBytes)
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (received >= maxBytes) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  return text + decoder.decode()
}

class CrawlFetchError extends Error {}

export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const limits: CrawlLimits = { ...DEFAULT_LIMITS, ...options.limits }
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const start = options.startUrl

  /** Fetches with manual redirects so every hop is re-validated; never leaves the site. */
  async function safeFetch(
    target: URL,
    accept: string,
  ): Promise<{ response: Response; finalUrl: URL; leftSite: boolean }> {
    let current = target
    for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
      const checked = parseCrawlUrl(current.href)
      if (!checked) throw new CrawlFetchError('Blocked: not a public http(s) address')
      if (options.hostCheck && !(await options.hostCheck(checked.hostname))) {
        throw new CrawlFetchError('Blocked: address is not publicly reachable')
      }
      let response: Response
      try {
        response = await options.fetcher(checked.href, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': USER_AGENT, accept },
          signal: AbortSignal.timeout(limits.fetchTimeoutMs),
        })
      } catch (error) {
        const name = error instanceof Error ? error.name : ''
        throw new CrawlFetchError(name === 'TimeoutError' || name === 'AbortError' ? 'Timed out' : 'Could not connect')
      }
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
      if (!location) return { response, finalUrl: checked, leftSite: false }

      await response.body?.cancel().catch(() => undefined)
      let next: URL
      try {
        next = new URL(location, checked)
      } catch {
        throw new CrawlFetchError('Invalid redirect')
      }
      if (!isSameSite(start, next)) return { response, finalUrl: next, leftSite: true }
      current = next
    }
    throw new CrawlFetchError('Too many redirects')
  }

  // robots.txt: unreachable or missing means "no restrictions".
  let robots: RobotsRules = { allow: [], disallow: [] }
  try {
    const robotsUrl = new URL('/robots.txt', start)
    const { response, leftSite } = await safeFetch(robotsUrl, 'text/plain')
    if (response.status === 200 && !leftSite) robots = parseRobots(await readTextCapped(response, 200_000))
    else await response.body?.cancel().catch(() => undefined)
  } catch {
    // keep permissive defaults
  }

  if (!isPathAllowed(robots, start.pathname + start.search)) {
    return { pages: [], stoppedReason: 'blocked_by_robots', skippedByRobots: 1 }
  }

  type QueueItem = { url: URL; depth: number }
  const queue: QueueItem[] = [{ url: start, depth: 0 }]
  const seen = new Set<string>([normalizeForQueue(start)])
  const pages: CrawledPage[] = []
  const analysed: { title: string | null; metaDescription: string | null; index: number }[] = []
  let scheduled = 0
  let skippedByRobots = 0
  let stoppedReason: StopReason = 'completed'

  async function crawlOne(item: QueueItem): Promise<{ page: CrawledPage | null; links: URL[] }> {
    const began = now()
    const base: CrawledPage = {
      url: truncate(item.url.href, 2048) ?? item.url.href,
      final_url: null,
      status_code: null,
      title: null,
      meta_description: null,
      h1: null,
      h1_count: 0,
      word_count: 0,
      canonical_url: null,
      robots_meta: null,
      internal_links_count: 0,
      response_time_ms: null,
      depth: item.depth,
      issues: [],
      error: null,
    }

    try {
      const { response, finalUrl, leftSite } = await safeFetch(item.url, 'text/html,application/xhtml+xml')
      const status = response.status
      base.status_code = status
      base.final_url = finalUrl.href === item.url.href ? null : truncate(finalUrl.href, 2048)

      if (leftSite) {
        base.response_time_ms = now() - began
        return { page: base, links: [] } // redirect to another site: record, never follow
      }
      const contentType = response.headers.get('content-type') ?? ''
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType) || contentType === ''
      if (status >= 400 || !isHtml || status >= 300) {
        await response.body?.cancel().catch(() => undefined)
        base.response_time_ms = now() - began
        if (status >= 400) {
          base.issues = analyzePage({ ...emptyFacts(), statusCode: status, responseTimeMs: base.response_time_ms })
          return { page: base, links: [] }
        }
        if (item.depth === 0) {
          base.error = 'Not an HTML page'
          base.issues = ['fetch_error']
          return { page: base, links: [] }
        }
        return { page: null, links: [] } // silently skip non-HTML resources
      }

      const html = await readTextCapped(response, limits.maxBytes)
      base.response_time_ms = now() - began
      const extract = extractPage(html, finalUrl)

      base.title = truncate(extract.title, 500)
      base.meta_description = truncate(extract.metaDescription, 1000)
      base.h1 = truncate(extract.h1s[0] ?? null, 500)
      base.h1_count = extract.h1s.length
      base.word_count = extract.wordCount
      base.canonical_url = truncate(extract.canonicalUrl, 2048)
      base.robots_meta = truncate(extract.robotsMeta, 200)

      const internal = extract.links.filter((link) => isSameSite(start, link))
      base.internal_links_count = new Set(internal.map(normalizeForQueue)).size
      base.issues = analyzePage({
        statusCode: status,
        fetchFailed: false,
        title: extract.title,
        metaDescription: extract.metaDescription,
        h1Count: extract.h1s.length,
        wordCount: extract.wordCount,
        canonicalUrl: extract.canonicalUrl,
        robotsMeta: extract.robotsMeta,
        responseTimeMs: base.response_time_ms,
      })
      return { page: base, links: internal }
    } catch (error) {
      base.response_time_ms = now() - began
      base.error = truncate(error instanceof CrawlFetchError ? error.message : 'Could not fetch this page', 300)
      base.issues = ['fetch_error']
      return { page: base, links: [] }
    }
  }

  while (queue.length > 0) {
    if (scheduled >= limits.maxPages) {
      stoppedReason = 'page_limit'
      break
    }
    if (now() - startedAt >= limits.totalBudgetMs) {
      stoppedReason = 'time_limit'
      break
    }

    const batch: QueueItem[] = []
    while (queue.length > 0 && batch.length < limits.concurrency && scheduled + batch.length < limits.maxPages) {
      const next = queue.shift()
      if (!next) break
      if (!isPathAllowed(robots, next.url.pathname + next.url.search)) {
        skippedByRobots += 1
        continue
      }
      batch.push(next)
    }
    scheduled += batch.length

    const results = await Promise.all(batch.map((item) => crawlOne(item)))
    for (const [position, result] of results.entries()) {
      const item = batch[position]
      if (!item || !result.page) continue
      pages.push(result.page)
      if (result.page.status_code !== null && result.page.status_code < 400 && !result.page.error) {
        analysed.push({ title: result.page.title, metaDescription: result.page.meta_description, index: pages.length - 1 })
      }
      for (const link of result.links) {
        if (SKIPPED_EXTENSIONS.test(link.pathname)) continue
        const key = normalizeForQueue(link)
        if (seen.has(key)) continue
        seen.add(key)
        queue.push({ url: link, depth: item.depth + 1 })
      }
    }
  }

  const duplicates = findDuplicateIssues(analysed)
  for (const [position, entry] of analysed.entries()) {
    const page = pages[entry.index]
    const extra = duplicates[position]
    if (page && extra && extra.length > 0) page.issues = [...page.issues, ...extra]
  }
  for (const page of pages) page.issues = sortIssues(page.issues)

  return { pages, stoppedReason, skippedByRobots }
}

function emptyFacts() {
  return {
    statusCode: null,
    fetchFailed: false,
    title: null,
    metaDescription: null,
    h1Count: 0,
    wordCount: 0,
    canonicalUrl: null,
    robotsMeta: null,
    responseTimeMs: null,
  }
}

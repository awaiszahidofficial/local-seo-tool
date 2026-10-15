import { phoneKey } from '../../supabase/functions/_shared/phone.ts'
import type { CrawlPageRow, ProjectRow } from '../types/database'

/**
 * Local Page Auditor engine. Pure functions over a project and its crawled pages: no network,
 * no database. Every result is derived from data the crawler actually collected.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info'

export type AuditCheck = {
  id: string
  label: string
  status: CheckStatus
  /** Plain-language explanation: what was found, and what to change when it is not a pass. */
  detail: string
}

export type PageType = 'home' | 'contact' | 'location' | 'service' | 'about' | 'blog' | 'other'

export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  home: 'Home',
  contact: 'Contact',
  location: 'Location',
  service: 'Service',
  about: 'About',
  blog: 'Blog',
  other: 'Other',
}

/** Page types the audit treats as "key" local landing pages. */
export const KEY_PAGE_TYPES: readonly PageType[] = ['home', 'contact', 'service', 'location']

export type AuditContext = {
  /** Name used for brand checks: the business name, or the project name when none was entered. */
  brand: string
  brandIsProjectName: boolean
  /** Lower-cased location terms (city first, then the full location text). Empty when no location. */
  cityTerms: string[]
  locationLabel: string | null
  /** Lower-cased word stems taken from the business type (e.g. "plumb", "roof"). */
  typeStems: string[]
}

export type PageAudit = {
  pageId: string
  url: string
  title: string | null
  type: PageType
  checks: AuditCheck[]
  passed: number
  warnings: number
  failed: number
}

export type FixSummary = { id: string; label: string; status: 'fail' | 'warn'; pages: number }

export type SiteAudit = {
  context: AuditContext
  siteChecks: AuditCheck[]
  pages: PageAudit[]
  /** Pages that could not be audited (fetch errors, HTTP errors, redirects). */
  skippedPages: number
  totals: { passed: number; warnings: number; failed: number }
  topFixes: FixSummary[]
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

const TYPE_STOP_WORDS = new Set([
  'and', 'the', 'for', 'services', 'service', 'company', 'companies', 'business', 'local', 'professional',
  'home', 'general', 'group', 'solutions', 'inc', 'llc', 'ltd', 'shop', 'store', 'pro', 'pros',
])

function stemOf(word: string): string {
  const stripped = word.replace(/(ing|ers|er|ists|ist|ians|ian|s)$/, '')
  return stripped.length >= 4 ? stripped : word
}

export function buildContext(
  project: Pick<ProjectRow, 'name' | 'business_name' | 'location' | 'business_type'>,
): AuditContext {
  const businessName = project.business_name?.trim()
  const location = project.location?.trim() ?? ''
  const city = location.split(',')[0]?.trim() ?? ''

  const cityTerms = [...new Set([city, location].map((term) => term.toLowerCase()).filter((term) => term.length >= 2))]

  const typeWords = (project.business_type ?? '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 4 && !TYPE_STOP_WORDS.has(word))
  const typeStems = [...new Set(typeWords.map(stemOf))]

  return {
    brand: businessName || project.name.trim(),
    brandIsProjectName: !businessName,
    cityTerms,
    locationLabel: location || null,
    typeStems,
  }
}

// ---------------------------------------------------------------------------------------------
// Text matching helpers
// ---------------------------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Counts whole-word, case-insensitive occurrences of any term (longer terms win on overlap). */
export function countTerms(text: string | null | undefined, terms: readonly string[]): number {
  if (!text || terms.length === 0) return 0
  const alternation = [...terms]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  const matches = text.match(new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'giu'))
  return matches ? matches.length : 0
}

function hasStem(text: string | null | undefined, stems: readonly string[]): boolean {
  if (!text || stems.length === 0) return false
  const alternation = stems.map(escapeRegExp).join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})`, 'iu').test(text)
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function mentionsBrand(text: string | null | undefined, brand: string): boolean {
  const needle = compact(brand)
  return needle.length >= 3 && !!text && compact(text).includes(needle)
}

function quote(value: string | null | undefined, max = 70): string {
  if (!value) return ''
  return `“${value.length > max ? `${value.slice(0, max)}…` : value}”`
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------------------------------------
// Page classification
// ---------------------------------------------------------------------------------------------

const BLOG_PATH = /(^|\/)(blog|news|articles?|posts?|insights|press|resources)(\/|$)|\/\d{4}\/\d{1,2}\//
const CONTACT_PATH = /(contact|get-in-touch|reach-us|book(-online|-now|ing)?|appointments?|request-(a-)?(quote|estimate|service)|free-(quote|estimate)|quote)/
const ABOUT_PATH = /(^|\/)(about|about-us|our-story|our-team|team|who-we-are|company)(\/|$|-)/
const LOCATION_PATH = /(location|locations|service-areas?|areas?-(we-)?serv(e|ed)|coverage|serving|near-me|cities|neighborhoods)/
const SERVICE_PATH = /(^|\/)(services?|what-we-do|solutions|treatments|repairs?|installation|replacement|cleaning|maintenance)(\/|$|-)/

export function classifyPage(page: Pick<CrawlPageRow, 'url'>, context: AuditContext): PageType {
  let path: string
  try {
    path = decodeURIComponent(new URL(page.url).pathname).toLowerCase()
  } catch {
    return 'other'
  }

  if (path === '/' || path === '' || /^\/(index|home)(\.[a-z]+)?\/?$/.test(path)) return 'home'
  if (BLOG_PATH.test(path)) return 'blog'
  if (CONTACT_PATH.test(path)) return 'contact'
  if (ABOUT_PATH.test(path)) return 'about'

  const segments = path.split('/').filter(Boolean)
  const citySlugs = context.cityTerms.map(slugify).filter((slug) => slug.length >= 3)
  if (LOCATION_PATH.test(path) || segments.some((segment) => citySlugs.some((slug) => segment.includes(slug)))) {
    return 'location'
  }
  if (SERVICE_PATH.test(path) || segments.some((segment) => context.typeStems.some((stem) => segment.includes(stem)))) {
    return 'service'
  }
  return 'other'
}

// ---------------------------------------------------------------------------------------------
// Per-page checks
// ---------------------------------------------------------------------------------------------

type PageCheckDef = {
  id: string
  label: string
  appliesTo: readonly PageType[]
  /** Return null when the check cannot run (for example, no location on the project). */
  run: (page: CrawlPageRow, type: PageType, context: AuditContext) => Pick<AuditCheck, 'status' | 'detail'> | null
}

const CONTACT_LINK = /(contact|get-in-touch|reach-us|book|appointment|quote|estimate)/i

/** Failing is reserved for dedicated service/location pages; home and contact pages get warnings. */
function missing(type: PageType, severe: readonly PageType[] = ['service', 'location']): CheckStatus {
  return severe.includes(type) ? 'fail' : 'warn'
}

const PAGE_CHECKS: readonly PageCheckDef[] = [
  {
    id: 'location_in_title',
    label: 'Location in page title',
    appliesTo: ['home', 'service', 'location', 'contact'],
    run: (page, type, ctx) => {
      if (ctx.cityTerms.length === 0) return null
      const found = countTerms(page.title, ctx.cityTerms) > 0
      return found
        ? { status: 'pass', detail: `The title mentions the location: ${quote(page.title)}.` }
        : {
            status: missing(type),
            detail: `Add “${ctx.locationLabel}” to the title${page.title ? ` (currently ${quote(page.title)})` : ' (there is no title)'}.`,
          }
    },
  },
  {
    id: 'location_in_h1',
    label: 'Location in main heading (H1)',
    appliesTo: ['home', 'service', 'location'],
    run: (page, type, ctx) => {
      if (ctx.cityTerms.length === 0) return null
      if (!page.h1) return { status: 'fail', detail: 'This page has no H1 heading. Add one that includes the location.' }
      return countTerms(page.h1, ctx.cityTerms) > 0
        ? { status: 'pass', detail: `The H1 mentions the location: ${quote(page.h1)}.` }
        : { status: missing(type), detail: `The H1 ${quote(page.h1)} does not mention “${ctx.locationLabel}”.` }
    },
  },
  {
    id: 'location_in_meta',
    label: 'Location in meta description',
    appliesTo: ['home', 'service', 'location', 'contact'],
    run: (page, _type, ctx) => {
      if (ctx.cityTerms.length === 0) return null
      if (!page.meta_description) return { status: 'warn', detail: 'There is no meta description. Write one that mentions the location.' }
      return countTerms(page.meta_description, ctx.cityTerms) > 0
        ? { status: 'pass', detail: 'The meta description mentions the location.' }
        : { status: 'warn', detail: `Mention “${ctx.locationLabel}” in the meta description.` }
    },
  },
  {
    id: 'location_in_body',
    label: 'Location mentioned in page content',
    appliesTo: ['home', 'service', 'location'],
    run: (page, type, ctx) => {
      if (ctx.cityTerms.length === 0) return null
      const count = countTerms(page.body_text, ctx.cityTerms)
      if (count >= 2) return { status: 'pass', detail: `The location is mentioned ${count} times in the page content.` }
      if (count === 1) return { status: 'warn', detail: 'The location is mentioned only once. Work it naturally into the content a couple more times.' }
      return { status: missing(type), detail: `The page content never mentions “${ctx.locationLabel}”.` }
    },
  },
  {
    id: 'brand_in_title',
    label: 'Business name in page title',
    appliesTo: ['home', 'service', 'location', 'contact', 'about', 'other'],
    run: (page, _type, ctx) =>
      mentionsBrand(page.title, ctx.brand)
        ? { status: 'pass', detail: 'The title includes the business name.' }
        : { status: 'warn', detail: `Include “${ctx.brand}” in the title so searchers recognise the business.` },
  },
  {
    id: 'service_keyword',
    label: 'Service keyword in title or H1',
    appliesTo: ['home', 'service', 'location'],
    run: (page, _type, ctx) => {
      if (ctx.typeStems.length === 0) return null
      return hasStem(page.title, ctx.typeStems) || hasStem(page.h1, ctx.typeStems)
        ? { status: 'pass', detail: 'The title or H1 mentions what the business does.' }
        : { status: 'warn', detail: 'Neither the title nor the H1 mentions the main service. Add the service name (for example the business type).' }
    },
  },
  {
    id: 'phone_visible',
    label: 'Phone number on the page',
    appliesTo: ['home', 'contact', 'service', 'location'],
    run: (page, type) =>
      page.phones.length > 0
        ? { status: 'pass', detail: `Phone number shown: ${page.phones.join(', ')}.` }
        : { status: missing(type, ['home', 'contact']), detail: 'No phone number was found on this page. Show the business phone number in plain text.' },
  },
  {
    id: 'click_to_call',
    label: 'Click-to-call link',
    appliesTo: ['home', 'contact'],
    run: (page) =>
      page.tel_links > 0
        ? { status: 'pass', detail: 'The page has a tap-to-call (tel:) link.' }
        : { status: 'warn', detail: 'No tel: link found. Make the phone number a tap-to-call link for mobile visitors.' },
  },
  {
    id: 'local_schema',
    label: 'LocalBusiness structured data',
    appliesTo: ['home', 'contact'],
    run: (page, type) =>
      page.schema_local
        ? { status: 'pass', detail: `Structured data found (${page.schema_local.types.join(', ')}).` }
        : {
            status: missing(type, ['home']),
            detail: 'No LocalBusiness (or similar) JSON-LD found. Add structured data with the name, address, phone and hours.',
          },
  },
  {
    id: 'address_visible',
    label: 'Address on the page',
    appliesTo: ['home', 'contact'],
    run: (page) =>
      page.address_text || page.schema_local?.address
        ? { status: 'pass', detail: `Address found: ${quote(page.address_text ?? page.schema_local?.address)}.` }
        : { status: 'warn', detail: 'No address was detected (no <address> element or schema address). Show the full business address.' },
  },
  {
    id: 'map_embed',
    label: 'Map on the contact page',
    appliesTo: ['contact'],
    run: (page) =>
      page.has_map_embed
        ? { status: 'pass', detail: 'An embedded map was found.' }
        : { status: 'warn', detail: 'No embedded map found. A Google Map helps visitors and reinforces the location.' },
  },
  {
    id: 'contact_link',
    label: 'Link to the contact page',
    appliesTo: ['home', 'service', 'location', 'about'],
    run: (page) =>
      page.link_paths.some((path) => CONTACT_LINK.test(path))
        ? { status: 'pass', detail: 'The page links to a contact or booking page.' }
        : { status: 'warn', detail: 'No link to a contact, quote or booking page was found. Add a clear call to action.' },
  },
  {
    id: 'content_depth',
    label: 'Enough content (500+ words)',
    appliesTo: ['service', 'location'],
    run: (page) => {
      if (page.word_count >= 500) return { status: 'pass', detail: `${page.word_count} words of main content.` }
      if (page.word_count >= 300) return { status: 'warn', detail: `${page.word_count} words. Aim for 500 or more on service and location pages.` }
      return { status: 'fail', detail: `Only ${page.word_count} words. Thin pages rarely rank; expand with useful, specific content.` }
    },
  },
  {
    id: 'subheadings',
    label: 'Uses subheadings (H2)',
    appliesTo: ['home', 'service', 'location'],
    run: (page) =>
      page.h2s.length >= 2
        ? { status: 'pass', detail: `${page.h2s.length} subheadings found.` }
        : { status: 'warn', detail: 'Fewer than two H2 subheadings. Break the content into sections with descriptive subheadings.' },
  },
  {
    id: 'indexable',
    label: 'Page can be indexed',
    appliesTo: ['home', 'contact', 'service', 'location'],
    run: (page) =>
      page.robots_meta && /\bnoindex\b/i.test(page.robots_meta)
        ? { status: 'fail', detail: 'This page is marked noindex, so search engines will not list it.' }
        : { status: 'pass', detail: 'No noindex directive found.' },
  },
]

export function auditPage(page: CrawlPageRow, context: AuditContext): PageAudit {
  const type = classifyPage(page, context)
  const checks: AuditCheck[] = []
  for (const def of PAGE_CHECKS) {
    if (!def.appliesTo.includes(type)) continue
    const result = def.run(page, type, context)
    if (result) checks.push({ id: def.id, label: def.label, ...result })
  }
  return {
    pageId: page.id,
    url: page.url,
    title: page.title,
    type,
    checks,
    passed: checks.filter((check) => check.status === 'pass').length,
    warnings: checks.filter((check) => check.status === 'warn').length,
    failed: checks.filter((check) => check.status === 'fail').length,
  }
}

// ---------------------------------------------------------------------------------------------
// Site-level checks
// ---------------------------------------------------------------------------------------------

function isAuditable(page: CrawlPageRow): boolean {
  return page.error === null && page.status_code !== null && page.status_code >= 200 && page.status_code < 300
}

export function auditSiteChecks(
  pages: readonly CrawlPageRow[],
  audits: readonly PageAudit[],
  context: AuditContext,
): AuditCheck[] {
  const checks: AuditCheck[] = []
  const typeOf = new Map(audits.map((audit) => [audit.pageId, audit.type]))
  const ofType = (type: PageType) => pages.filter((page) => typeOf.get(page.id) === type)

  const home = ofType('home')[0]
  checks.push(
    home
      ? { id: 'home_crawled', label: 'Home page found', status: 'pass', detail: 'The home page was crawled.' }
      : { id: 'home_crawled', label: 'Home page found', status: 'fail', detail: 'The home page could not be crawled, so home-page checks were skipped.' },
  )

  const contactPages = ofType('contact')
  checks.push(
    contactPages.length > 0
      ? { id: 'contact_page', label: 'Contact page exists', status: 'pass', detail: `Found: ${contactPages[0]?.url}.` }
      : { id: 'contact_page', label: 'Contact page exists', status: 'warn', detail: 'No contact, quote or booking page was found among the crawled pages. Add one with the full name, address and phone.' },
  )

  const servicePages = ofType('service')
  checks.push(
    servicePages.length > 0
      ? { id: 'service_pages', label: 'Service pages exist', status: 'pass', detail: `${servicePages.length} service ${servicePages.length === 1 ? 'page' : 'pages'} found.` }
      : { id: 'service_pages', label: 'Service pages exist', status: 'warn', detail: 'No dedicated service pages were found (URLs containing /services, /repair and similar). Each main service should have its own page.' },
  )

  const locationPages = ofType('location')
  checks.push({
    id: 'location_pages',
    label: 'Location or service-area pages',
    status: 'info',
    detail:
      locationPages.length > 0
        ? `${locationPages.length} location-style ${locationPages.length === 1 ? 'page' : 'pages'} found.`
        : 'No location-style pages found. Whether you need them depends on how many areas the business serves.',
  })

  const schemaPages = pages.filter((page) => page.schema_local)
  const schema = schemaPages[0]?.schema_local ?? null
  checks.push(
    schema
      ? { id: 'schema_present', label: 'LocalBusiness structured data on the site', status: 'pass', detail: `Found on ${schemaPages.length} ${schemaPages.length === 1 ? 'page' : 'pages'}.` }
      : { id: 'schema_present', label: 'LocalBusiness structured data on the site', status: 'fail', detail: 'No LocalBusiness-type JSON-LD was found on any crawled page.' },
  )

  const phoneKeys = new Map<string, string>()
  for (const page of pages) for (const phone of page.phones) if (!phoneKeys.has(phoneKey(phone))) phoneKeys.set(phoneKey(phone), phone)
  const phones = [...phoneKeys.values()]
  checks.push(
    phones.length === 0
      ? { id: 'phone_consistency', label: 'Phone number consistent across pages', status: 'fail', detail: 'No phone number was found on any crawled page.' }
      : phones.length === 1
        ? { id: 'phone_consistency', label: 'Phone number consistent across pages', status: 'pass', detail: `One phone number is used site-wide: ${phones[0]}.` }
        : { id: 'phone_consistency', label: 'Phone number consistent across pages', status: 'warn', detail: `${phones.length} different phone numbers appear (${phones.join(', ')}). Use one number everywhere unless the others are deliberate.` },
  )

  if (schema) {
    checks.push(
      mentionsBrand(schema.name, context.brand)
        ? { id: 'schema_name', label: 'Schema name matches the business name', status: 'pass', detail: `Structured data name: ${quote(schema.name)}.` }
        : { id: 'schema_name', label: 'Schema name matches the business name', status: 'warn', detail: `Structured data name is ${schema.name ? quote(schema.name) : 'missing'}, but the business name is “${context.brand}”. Keep them identical.` },
    )

    if (!schema.telephone) {
      checks.push({ id: 'schema_phone', label: 'Schema phone matches the page', status: 'warn', detail: 'The structured data has no telephone. Add the same number shown on the pages.' })
    } else if (phoneKeys.has(phoneKey(schema.telephone))) {
      checks.push({ id: 'schema_phone', label: 'Schema phone matches the page', status: 'pass', detail: `Schema telephone ${schema.telephone} appears on the site.` })
    } else {
      checks.push({
        id: 'schema_phone',
        label: 'Schema phone matches the page',
        status: 'warn',
        detail: `Schema telephone ${schema.telephone} does not match any number shown on the crawled pages${phones.length ? ` (${phones.join(', ')})` : ''}.`,
      })
    }

    if (context.cityTerms.length > 0) {
      checks.push(
        schema.address && countTerms(schema.address, context.cityTerms) > 0
          ? { id: 'schema_address', label: 'Schema address matches the project location', status: 'pass', detail: `Structured data address: ${quote(schema.address)}.` }
          : { id: 'schema_address', label: 'Schema address matches the project location', status: 'warn', detail: `The structured data address (${schema.address ? quote(schema.address) : 'missing'}) does not mention “${context.locationLabel}”.` },
      )
    }
  }

  return checks
}

// ---------------------------------------------------------------------------------------------
// Whole-site audit
// ---------------------------------------------------------------------------------------------

export function auditSite(
  project: Pick<ProjectRow, 'name' | 'business_name' | 'location' | 'business_type'>,
  crawlPages: readonly CrawlPageRow[],
): SiteAudit {
  const context = buildContext(project)
  const auditable = crawlPages.filter(isAuditable)
  const pages = auditable.map((page) => auditPage(page, context))
  const siteChecks = auditSiteChecks(auditable, pages, context)

  const fixes = new Map<string, FixSummary>()
  const note = (id: string, label: string, status: CheckStatus) => {
    if (status !== 'fail' && status !== 'warn') return
    const existing = fixes.get(id)
    if (existing) {
      existing.pages += 1
      if (status === 'fail') existing.status = 'fail'
    } else {
      fixes.set(id, { id, label, status, pages: 1 })
    }
  }
  for (const page of pages) for (const check of page.checks) note(check.id, check.label, check.status)
  for (const check of siteChecks) note(check.id, check.label, check.status)

  const all = [...pages.flatMap((page) => page.checks), ...siteChecks]
  const topFixes = [...fixes.values()].sort(
    (a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1) || b.pages - a.pages,
  )

  return {
    context,
    siteChecks,
    pages,
    skippedPages: crawlPages.length - auditable.length,
    totals: {
      passed: all.filter((check) => check.status === 'pass').length,
      warnings: all.filter((check) => check.status === 'warn').length,
      failed: all.filter((check) => check.status === 'fail').length,
    },
    topFixes,
  }
}

/** True when the pages were crawled before local signals were stored (the user should crawl again). */
export function needsRecrawl(pages: readonly Pick<CrawlPageRow, 'local_version' | 'error'>[]): boolean {
  const usable = pages.filter((page) => page.error === null)
  return usable.length > 0 && usable.every((page) => page.local_version < 1)
}

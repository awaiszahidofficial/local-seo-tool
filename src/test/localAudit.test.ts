import { describe, expect, it } from 'vitest'
import {
  auditPage,
  auditSite,
  buildContext,
  classifyPage,
  countTerms,
  needsRecrawl,
  type AuditContext,
  type PageAudit,
} from '../lib/localAudit'
import type { CrawlPageRow } from '../types/database'
import { makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  name: 'Acme Plumbing Austin',
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  business_type: 'Plumber',
})

const ctx: AuditContext = buildContext(project)

function checkStatus(audit: PageAudit, id: string) {
  return audit.checks.find((check) => check.id === id)?.status
}

const goodSchema = {
  types: ['Plumber'],
  name: 'Acme Plumbing',
  telephone: '(512) 555-0142',
  address: '12 Main St, Austin, TX, 78701',
  has_geo: true,
  has_hours: true,
  same_as_count: 2,
  has_rating: false,
  url: 'https://acme.example',
}

const goodBody = 'Acme Plumbing serves Austin homeowners. Our Austin plumbers fix leaks fast. '.repeat(20)

function goodHome(overrides: Partial<CrawlPageRow> = {}) {
  return makeCrawlPage({
    url: 'https://acme.example/',
    title: 'Plumber in Austin, TX | Acme Plumbing',
    meta_description: 'Acme Plumbing offers fast plumbing repairs across Austin, Texas.',
    h1: 'Austin Plumber You Can Trust',
    h2s: ['Our services', 'Why choose us'],
    body_text: goodBody,
    word_count: 600,
    phones: ['(512) 555-0142'],
    tel_links: 1,
    schema_local: goodSchema,
    address_text: '12 Main St Austin, TX 78701',
    link_paths: ['/contact', '/services/drains'],
    ...overrides,
  })
}

describe('buildContext', () => {
  it('uses the business name, splits the location and derives service stems', () => {
    expect(ctx.brand).toBe('Acme Plumbing')
    expect(ctx.brandIsProjectName).toBe(false)
    expect(ctx.cityTerms).toEqual(['austin', 'austin, tx'])
    expect(ctx.locationLabel).toBe('Austin, TX')
    expect(ctx.typeStems).toEqual(['plumb'])
  })

  it('falls back to the project name and tolerates missing optional fields', () => {
    const bare = buildContext({ name: '  Solo Project ', business_name: null, location: null, business_type: null })
    expect(bare.brand).toBe('Solo Project')
    expect(bare.brandIsProjectName).toBe(true)
    expect(bare.cityTerms).toEqual([])
    expect(bare.locationLabel).toBeNull()
    expect(bare.typeStems).toEqual([])
  })

  it('handles a location without a comma and ignores generic business-type words', () => {
    const result = buildContext({ name: 'X', business_name: ' ', location: 'Lahore', business_type: 'Home services company' })
    expect(result.cityTerms).toEqual(['lahore'])
    expect(result.typeStems).toEqual([])
    expect(result.brand).toBe('X')
  })

  it('stems common business types so related words match', () => {
    expect(buildContext({ ...project, business_type: 'Roofing contractor' }).typeStems).toEqual(['roof', 'contractor'])
    expect(buildContext({ ...project, business_type: 'Dentist' }).typeStems).toEqual(['dent'])
    expect(buildContext({ ...project, business_type: 'Electrician' }).typeStems).toEqual(['electric'])
  })
})

describe('countTerms', () => {
  it('counts whole words case-insensitively and prefers the longer term', () => {
    expect(countTerms('Austin, TX and AUSTIN. Austinite is different.', ['austin'])).toBe(2)
    expect(countTerms('We serve Austin, TX.', ['austin', 'austin, tx'])).toBe(1)
  })

  it('returns zero for empty input or terms and escapes regex characters', () => {
    expect(countTerms(null, ['a'])).toBe(0)
    expect(countTerms('text', [])).toBe(0)
    expect(countTerms('St. Louis (MO) area', ['st. louis (mo)'])).toBe(1)
  })
})

describe('classifyPage', () => {
  const cases: [string, string][] = [
    ['https://acme.example/', 'home'],
    ['https://acme.example/index.html', 'home'],
    ['https://acme.example/blog/how-to-fix-a-leak', 'blog'],
    ['https://acme.example/2026/10/news-item', 'blog'],
    ['https://acme.example/contact-us', 'contact'],
    ['https://acme.example/book-online', 'contact'],
    ['https://acme.example/about-us', 'about'],
    ['https://acme.example/service-areas', 'location'],
    ['https://acme.example/austin', 'location'],
    ['https://acme.example/plumber-austin-tx', 'location'],
    ['https://acme.example/services/drain-cleaning', 'service'],
    ['https://acme.example/water-heater-plumbing', 'service'],
    ['https://acme.example/privacy', 'other'],
  ]
  it.each(cases)('classifies %s as %s', (url, expected) => {
    expect(classifyPage({ url }, ctx)).toBe(expected)
  })

  it('treats a city in the path as a location page even under /services', () => {
    expect(classifyPage({ url: 'https://acme.example/services/austin' }, ctx)).toBe('location')
  })

  it('returns other for unparsable URLs', () => {
    expect(classifyPage({ url: 'not a url' }, ctx)).toBe('other')
  })
})

describe('auditPage: home page', () => {
  it('passes every check for a well-optimised home page', () => {
    const audit = auditPage(goodHome(), ctx)
    expect(audit.type).toBe('home')
    expect(audit.failed).toBe(0)
    expect(audit.warnings).toBe(0)
    expect(audit.passed).toBe(audit.checks.length)
    expect(audit.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['location_in_title', 'phone_visible', 'click_to_call', 'local_schema', 'address_visible']),
    )
  })

  it('flags a bare home page with specific, actionable problems', () => {
    const audit = auditPage(
      goodHome({
        title: 'Welcome',
        meta_description: null,
        h1: 'Hello',
        body_text: 'We fix things.',
        phones: [],
        tel_links: 0,
        schema_local: null,
        address_text: null,
        link_paths: [],
        h2s: [],
      }),
      ctx,
    )
    expect(checkStatus(audit, 'location_in_title')).toBe('warn')
    expect(checkStatus(audit, 'location_in_meta')).toBe('warn')
    expect(checkStatus(audit, 'location_in_body')).toBe('warn')
    expect(checkStatus(audit, 'brand_in_title')).toBe('warn')
    expect(checkStatus(audit, 'phone_visible')).toBe('fail')
    expect(checkStatus(audit, 'local_schema')).toBe('fail')
    expect(checkStatus(audit, 'click_to_call')).toBe('warn')
    expect(checkStatus(audit, 'contact_link')).toBe('warn')
    expect(checkStatus(audit, 'subheadings')).toBe('warn')
    const title = audit.checks.find((c) => c.id === 'location_in_title')
    expect(title?.detail).toContain('Austin, TX')
    expect(title?.detail).toContain('Welcome')
  })

  it('fails indexability for noindex pages', () => {
    const audit = auditPage(goodHome({ robots_meta: 'noindex, nofollow' }), ctx)
    expect(checkStatus(audit, 'indexable')).toBe('fail')
  })

  it('detects the service keyword in the H1 even when the title lacks it', () => {
    const audit = auditPage(goodHome({ title: 'Acme Austin', h1: 'Trusted plumbing experts' }), ctx)
    expect(checkStatus(audit, 'service_keyword')).toBe('pass')
    const without = auditPage(goodHome({ title: 'Acme Austin', h1: 'Fast and friendly' }), ctx)
    expect(checkStatus(without, 'service_keyword')).toBe('warn')
  })

  it('accepts the schema address as the visible address', () => {
    const audit = auditPage(goodHome({ address_text: null }), ctx)
    expect(checkStatus(audit, 'address_visible')).toBe('pass')
  })
})

describe('auditPage: service and location pages', () => {
  const service = (overrides: Partial<CrawlPageRow> = {}) =>
    makeCrawlPage({
      url: 'https://acme.example/services/drain-cleaning',
      title: 'Drain Cleaning in Austin | Acme Plumbing',
      meta_description: 'Drain cleaning in Austin by Acme Plumbing.',
      h1: 'Drain Cleaning in Austin',
      h2s: ['Signs of a clog', 'Our process'],
      body_text: goodBody,
      word_count: 650,
      phones: ['(512) 555-0142'],
      link_paths: ['/contact'],
      ...overrides,
    })

  it('applies service-page checks and passes a good page', () => {
    const audit = auditPage(service(), ctx)
    expect(audit.type).toBe('service')
    expect(audit.failed + audit.warnings).toBe(0)
    expect(audit.checks.map((c) => c.id)).not.toContain('local_schema') // schema is judged on home/contact
    expect(audit.checks.map((c) => c.id)).toContain('content_depth')
  })

  it('fails (not just warns) missing location signals on service pages', () => {
    const audit = auditPage(service({ title: 'Drain Cleaning | Acme Plumbing', h1: 'Drain Cleaning', body_text: 'Fast drain work.' }), ctx)
    expect(checkStatus(audit, 'location_in_title')).toBe('fail')
    expect(checkStatus(audit, 'location_in_h1')).toBe('fail')
    expect(checkStatus(audit, 'location_in_body')).toBe('fail')
  })

  it('grades content depth: 500+ pass, 300-499 warn, under 300 fail', () => {
    expect(checkStatus(auditPage(service({ word_count: 500 }), ctx), 'content_depth')).toBe('pass')
    expect(checkStatus(auditPage(service({ word_count: 499 }), ctx), 'content_depth')).toBe('warn')
    expect(checkStatus(auditPage(service({ word_count: 299 }), ctx), 'content_depth')).toBe('fail')
  })

  it('only warns about a missing phone number on service pages', () => {
    expect(checkStatus(auditPage(service({ phones: [] }), ctx), 'phone_visible')).toBe('warn')
  })

  it('reports a missing H1 as a failure with an explanation', () => {
    const audit = auditPage(service({ h1: null }), ctx)
    expect(checkStatus(audit, 'location_in_h1')).toBe('fail')
    expect(audit.checks.find((c) => c.id === 'location_in_h1')?.detail).toMatch(/no H1/i)
  })
})

describe('auditPage: contact, blog and unconfigured projects', () => {
  it('checks the map and click-to-call on the contact page', () => {
    const contact = makeCrawlPage({ url: 'https://acme.example/contact', title: 'Contact Acme Plumbing in Austin', meta_description: 'Call Acme in Austin.' })
    const audit = auditPage(contact, ctx)
    expect(audit.type).toBe('contact')
    expect(checkStatus(audit, 'map_embed')).toBe('warn')
    expect(checkStatus(audit, 'click_to_call')).toBe('warn')
    expect(checkStatus(audit, 'phone_visible')).toBe('fail')
    expect(checkStatus(auditPage({ ...contact, has_map_embed: true }, ctx), 'map_embed')).toBe('pass')
  })

  it('runs no local checks on blog posts', () => {
    const audit = auditPage(makeCrawlPage({ url: 'https://acme.example/blog/tips' }), ctx)
    expect(audit.type).toBe('blog')
    expect(audit.checks).toEqual([])
  })

  it('skips location and service checks when the project has no location or business type', () => {
    const bare = buildContext({ name: 'Acme Plumbing', business_name: null, location: null, business_type: null })
    const audit = auditPage(goodHome(), bare)
    const ids = audit.checks.map((c) => c.id)
    expect(ids).not.toContain('location_in_title')
    expect(ids).not.toContain('location_in_body')
    expect(ids).not.toContain('service_keyword')
    expect(ids).toContain('phone_visible')
  })

  it('matches the business name ignoring punctuation and case', () => {
    const named = buildContext({ ...project, business_name: 'D&R Home Service' })
    expect(checkStatus(auditPage(goodHome({ title: 'DR Home Service — Austin' }), named), 'brand_in_title')).toBe('pass')
    expect(checkStatus(auditPage(goodHome({ title: 'Some Other Company' }), named), 'brand_in_title')).toBe('warn')
  })
})

describe('auditSite', () => {
  const contact = makeCrawlPage({
    url: 'https://acme.example/contact',
    title: 'Contact Acme Plumbing in Austin',
    meta_description: 'Call us in Austin.',
    phones: ['512-555-0142'],
    tel_links: 1,
    schema_local: goodSchema,
    has_map_embed: true,
    address_text: '12 Main St',
  })
  const service = makeCrawlPage({
    url: 'https://acme.example/services/drains',
    title: 'Drains in Austin | Acme Plumbing',
    h1: 'Drains in Austin',
    body_text: goodBody,
    word_count: 700,
    phones: ['(512) 555-0142'],
    link_paths: ['/contact'],
    h2s: ['a', 'b'],
  })

  it('passes site-level checks for a consistent site', () => {
    const result = auditSite(project, [goodHome(), contact, service])
    const status = (id: string) => result.siteChecks.find((c) => c.id === id)?.status
    expect(status('home_crawled')).toBe('pass')
    expect(status('contact_page')).toBe('pass')
    expect(status('service_pages')).toBe('pass')
    expect(status('schema_present')).toBe('pass')
    expect(status('phone_consistency')).toBe('pass') // same number in different formats
    expect(status('schema_name')).toBe('pass')
    expect(status('schema_phone')).toBe('pass')
    expect(status('schema_address')).toBe('pass')
    expect(status('location_pages')).toBe('info')
    expect(result.pages).toHaveLength(3)
    expect(result.skippedPages).toBe(0)
  })

  it('reports missing pages, schema and phone numbers on a bare site', () => {
    const result = auditSite(project, [makeCrawlPage({ url: 'https://acme.example/', phones: [], title: 'x' })])
    const status = (id: string) => result.siteChecks.find((c) => c.id === id)?.status
    expect(status('contact_page')).toBe('warn')
    expect(status('service_pages')).toBe('warn')
    expect(status('schema_present')).toBe('fail')
    expect(status('phone_consistency')).toBe('fail')
    expect(result.siteChecks.map((c) => c.id)).not.toContain('schema_name')
  })

  it('warns about different phone numbers and a schema phone that does not appear on the site', () => {
    const result = auditSite(project, [
      goodHome({ phones: ['(512) 555-0142'], schema_local: { ...goodSchema, telephone: '(737) 555-0000' } }),
      contact,
      makeCrawlPage({ url: 'https://acme.example/services/x', phones: ['(737) 555-9999'] }),
    ])
    const phone = result.siteChecks.find((c) => c.id === 'phone_consistency')
    expect(phone?.status).toBe('warn')
    expect(phone?.detail).toContain('2 different phone numbers')
    const schemaPhone = result.siteChecks.find((c) => c.id === 'schema_phone')
    expect(schemaPhone?.status).toBe('warn')
    expect(schemaPhone?.detail).toContain('737')
  })

  it('warns when the schema name or address disagrees with the project', () => {
    const result = auditSite(project, [
      goodHome({ schema_local: { ...goodSchema, name: 'Other Co', address: '1 Elm St, Dallas, TX' } }),
    ])
    expect(result.siteChecks.find((c) => c.id === 'schema_name')?.status).toBe('warn')
    expect(result.siteChecks.find((c) => c.id === 'schema_address')?.status).toBe('warn')
  })

  it('skips pages that failed or redirected and counts them', () => {
    const result = auditSite(project, [
      goodHome(),
      makeCrawlPage({ url: 'https://acme.example/gone', status_code: 404 }),
      makeCrawlPage({ url: 'https://acme.example/boom', status_code: null, error: 'Timed out' }),
      makeCrawlPage({ url: 'https://acme.example/moved', status_code: 301 }),
    ])
    expect(result.pages).toHaveLength(1)
    expect(result.skippedPages).toBe(3)
  })

  it('totals checks and ranks fixes with failures first, then by pages affected', () => {
    const noPhone = (path: string) =>
      makeCrawlPage({ url: `https://acme.example/services/${path}`, title: 'Plain', h1: 'Plain', body_text: 'x', word_count: 100, phones: [] })
    const result = auditSite(project, [goodHome(), noPhone('a'), noPhone('b')])

    const all = [...result.pages.flatMap((p) => p.checks), ...result.siteChecks]
    expect(result.totals.passed).toBe(all.filter((c) => c.status === 'pass').length)
    expect(result.totals.failed).toBe(all.filter((c) => c.status === 'fail').length)
    expect(result.totals.warnings).toBe(all.filter((c) => c.status === 'warn').length)

    const firstWarnIndex = result.topFixes.findIndex((fix) => fix.status === 'warn')
    expect(result.topFixes.slice(0, firstWarnIndex).every((fix) => fix.status === 'fail')).toBe(true)
    const locationInTitle = result.topFixes.find((fix) => fix.id === 'location_in_title')
    expect(locationInTitle).toMatchObject({ status: 'fail', pages: 2 })
    const fails = result.topFixes.filter((fix) => fix.status === 'fail')
    for (let i = 1; i < fails.length; i += 1) expect(fails[i - 1]!.pages).toBeGreaterThanOrEqual(fails[i]!.pages)
  })

  it('handles an empty crawl', () => {
    const result = auditSite(project, [])
    expect(result.pages).toEqual([])
    expect(result.siteChecks.find((c) => c.id === 'home_crawled')?.status).toBe('fail')
    expect(result.totals.passed).toBe(0)
  })
})

describe('needsRecrawl', () => {
  it('is true only when every usable page predates local signals', () => {
    expect(needsRecrawl([{ local_version: 0, error: null }, { local_version: 0, error: null }])).toBe(true)
    expect(needsRecrawl([{ local_version: 0, error: null }, { local_version: 1, error: null }])).toBe(false)
    expect(needsRecrawl([{ local_version: 1, error: null }])).toBe(false)
    expect(needsRecrawl([])).toBe(false)
    expect(needsRecrawl([{ local_version: 0, error: 'Timed out' }])).toBe(false)
  })
})

describe('crawler output feeds the auditor end to end', () => {
  it('audits pages produced by crawlSite from realistic HTML', async () => {
    const { crawlSite } = await import('../../supabase/functions/_shared/crawler.ts')
    const filler = 'Our licensed Austin plumbers repair leaks, clear drains and replace water heaters across Austin. '.repeat(40)
    const pages: Record<string, string> = {
      'https://acme.example/': `<!doctype html><html><head>
        <title>Plumber in Austin, TX | Acme Plumbing</title>
        <meta name="description" content="Acme Plumbing provides fast, upfront-priced plumbing repair across Austin, Texas.">
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Acme Plumbing","telephone":"(512) 555-0142","address":{"@type":"PostalAddress","streetAddress":"12 Main St","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701"}}</script>
        </head><body><header>Call <a href="tel:+15125550142">(512) 555-0142</a></header>
        <h1>Austin Plumber You Can Trust</h1><h2>Services</h2><h2>Reviews</h2><p>${filler}</p>
        <a href="/contact">Contact</a><a href="/services/drains">Drains</a>
        <footer><address>12 Main St, Austin, TX 78701</address></footer></body></html>`,
      'https://acme.example/contact': `<html><head><title>Contact Acme Plumbing in Austin, TX</title>
        <meta name="description" content="Contact Acme Plumbing in Austin. Call (512) 555-0142 or request a quote online today.">
        <script type="application/ld+json">{"@type":"Plumber","name":"Acme Plumbing","telephone":"512-555-0142"}</script></head>
        <body><h1>Contact us</h1><p>Call <a href="tel:5125550142">512-555-0142</a></p>
        <iframe src="https://www.google.com/maps/embed?pb=1"></iframe><address>12 Main St, Austin</address></body></html>`,
      'https://acme.example/services/drains': `<html><head><title>Drain Cleaning</title></head>
        <body><h1>Drain Cleaning</h1><p>We clear drains.</p></body></html>`,
    }
    const fetcher = async (url: string) =>
      pages[url]
        ? new Response(pages[url], { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } })

    const crawl = await crawlSite({ startUrl: new URL('https://acme.example/'), fetcher })
    const rows = crawl.pages.map((page, index) => ({
      ...makeCrawlPage(),
      ...page,
      id: `0000000${index}-0000-4000-8000-000000000000`,
    }))
    const result = auditSite(project, rows)

    const byType = Object.fromEntries(result.pages.map((p) => [p.type, p]))
    expect(Object.keys(byType).sort()).toEqual(['contact', 'home', 'service'])

    // Home page: fully optimised, so everything passes.
    expect(byType.home?.failed).toBe(0)
    expect(checkStatus(byType.home!, 'local_schema')).toBe('pass')
    expect(checkStatus(byType.home!, 'click_to_call')).toBe('pass')
    expect(checkStatus(byType.home!, 'address_visible')).toBe('pass')
    expect(checkStatus(byType.home!, 'location_in_body')).toBe('pass')

    // Contact page: map and schema detected.
    expect(checkStatus(byType.contact!, 'map_embed')).toBe('pass')
    expect(checkStatus(byType.contact!, 'phone_visible')).toBe('pass')

    // Thin, un-localised service page: concrete failures.
    expect(checkStatus(byType.service!, 'location_in_title')).toBe('fail')
    expect(checkStatus(byType.service!, 'content_depth')).toBe('fail')
    expect(checkStatus(byType.service!, 'phone_visible')).toBe('warn')

    // Same number written three ways counts as one number.
    expect(result.siteChecks.find((c) => c.id === 'phone_consistency')?.status).toBe('pass')
    expect(result.siteChecks.find((c) => c.id === 'schema_phone')?.status).toBe('pass')
    expect(result.siteChecks.find((c) => c.id === 'schema_address')?.status).toBe('pass')
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyDuplicateIssues,
  beginCrawl,
  crawlSite,
  crawlStep,
  DEFAULT_LIMITS,
  isCrawlState,
  decodeEntities,
  extractPage,
  isBlockedHostname,
  isPathAllowed,
  isPublicIp,
  normalizeForQueue,
  parseCrawlUrl,
  parseRobots,
  type Fetcher,
} from '../../supabase/functions/_shared/crawler.ts'

function html(opts: { title?: string; description?: string; h1?: string; links?: string[]; words?: number; extraHead?: string } = {}) {
  const words = Array.from({ length: opts.words ?? 350 }, (_, i) => `word${i}`).join(' ')
  const links = (opts.links ?? []).map((href) => `<a href="${href}">link</a>`).join('\n')
  return `<!doctype html><html><head>
    ${opts.title === undefined ? '' : `<title>${opts.title}</title>`}
    ${opts.description === undefined ? '' : `<meta name="description" content="${opts.description}">`}
    <link rel="canonical" href="https://example.com/">
    ${opts.extraHead ?? ''}
  </head><body>
    <nav><a href="#menu">Nav</a> navigation words that should not count</nav>
    ${opts.h1 === undefined ? '' : `<h1>${opts.h1}</h1>`}
    <p>${words}</p>${links}</body></html>`
}

const GOOD_TITLE = 'Emergency Plumber in Austin TX | Acme Plumbing'
const GOOD_DESC = 'Acme Plumbing provides 24/7 emergency plumbing repairs across Austin, Texas with upfront pricing and fast response.'

type Route = { status?: number; body?: string; type?: string; location?: string; delayError?: Error }

function makeFetcher(routes: Record<string, Route>, log: string[] = []): Fetcher {
  return async (url) => {
    log.push(url)
    const route = routes[url]
    if (!route) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    if (route.delayError) throw route.delayError
    const headers: Record<string, string> = { 'content-type': route.type ?? 'text/html; charset=utf-8' }
    if (route.location) headers.location = route.location
    return new Response(route.body ?? '', { status: route.status ?? 200, headers })
  }
}

describe('isBlockedHostname', () => {
  it.each([
    'localhost',
    'app.localhost',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.4.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '[::1]',
    '::1',
    'fe80::1',
    'printer.local',
    'db.internal',
    'intranet',
    '',
    '999.1.1.1',
  ])('blocks %s', (host) => {
    expect(isBlockedHostname(host)).toBe(true)
  })

  it.each(['example.com', 'www.example.co.uk', '8.8.8.8', '172.32.0.1', '11.0.0.1', 'sub.domain.example.org'])(
    'allows %s',
    (host) => {
      expect(isBlockedHostname(host)).toBe(false)
    },
  )
})

describe('isPublicIp', () => {
  it('accepts public IPv4/IPv6 and rejects private ranges', () => {
    expect(isPublicIp('93.184.216.34')).toBe(true)
    expect(isPublicIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(true)
    expect(isPublicIp('10.1.2.3')).toBe(false)
    expect(isPublicIp('127.0.0.1')).toBe(false)
    expect(isPublicIp('fd00::1')).toBe(false)
    expect(isPublicIp('::1')).toBe(false)
    expect(isPublicIp('not-an-ip')).toBe(false)
  })
})

describe('parseCrawlUrl', () => {
  it('accepts public http and https URLs and strips the fragment', () => {
    expect(parseCrawlUrl('https://example.com/a#top')?.href).toBe('https://example.com/a')
    expect(parseCrawlUrl('http://example.com')?.href).toBe('http://example.com/')
  })

  it.each([
    'ftp://example.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://2130706433/', // decimal form of 127.0.0.1
    'http://[::1]/',
    'https://user:pass@example.com',
    'https://example.com:8080/',
    'not a url',
  ])('rejects %s', (raw) => {
    expect(parseCrawlUrl(raw)).toBeNull()
  })
})

describe('normalizeForQueue', () => {
  it('removes fragments, tracking params and trailing slashes but keeps real params', () => {
    expect(normalizeForQueue(new URL('https://example.com/about/?utm_source=x&page=2#team'))).toBe(
      'https://example.com/about?page=2',
    )
    expect(normalizeForQueue(new URL('https://example.com/'))).toBe('https://example.com/')
  })
})

describe('robots.txt', () => {
  const text = `
    User-agent: *
    Disallow: /private
    Disallow: /search?
    Allow: /private/public
    Disallow: /*.pdf$

    User-agent: localseoworkbenchbot
    Disallow: /bot-only
  `

  it('prefers the group that names our agent over *', () => {
    const rules = parseRobots(text)
    expect(isPathAllowed(rules, '/bot-only')).toBe(false)
    expect(isPathAllowed(rules, '/private')).toBe(true)
  })

  it('applies the * group, longest match wins, Allow wins ties, wildcards and $ work', () => {
    const rules = parseRobots(text.split('User-agent: localseoworkbenchbot')[0] ?? '')
    expect(isPathAllowed(rules, '/private/area')).toBe(false)
    expect(isPathAllowed(rules, '/private/public/page')).toBe(true)
    expect(isPathAllowed(rules, '/search?q=x')).toBe(false)
    expect(isPathAllowed(rules, '/files/menu.pdf')).toBe(false)
    expect(isPathAllowed(rules, '/files/menu.pdf.html')).toBe(true)
    expect(isPathAllowed(rules, '/services')).toBe(true)
  })

  it('treats an empty Disallow and a missing file as allow-all', () => {
    expect(isPathAllowed(parseRobots('User-agent: *\nDisallow:'), '/anything')).toBe(true)
    expect(isPathAllowed(parseRobots(''), '/anything')).toBe(true)
  })

  it('ignores comments and keeps grouped user-agent lines together', () => {
    const rules = parseRobots('User-agent: foo # comment\nUser-agent: *\nDisallow: /x # note')
    expect(isPathAllowed(rules, '/x')).toBe(false)
  })
})

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities and leaves unknown ones alone', () => {
    expect(decodeEntities('Fish &amp; Chips &#8211; &#x2019;s &unknown;')).toBe('Fish & Chips – ’s &unknown;')
  })
})

describe('extractPage', () => {
  const base = new URL('https://example.com/services/')

  it('extracts title, description, canonical, robots, h1 and word count', () => {
    const page = extractPage(
      html({
        title: 'Fish &amp; Chips',
        description: 'A  tasty   place',
        h1: 'Welcome <span>home</span>',
        words: 10,
        extraHead: '<meta name="robots" content="noindex, follow">',
      }),
      base,
    )
    expect(page.title).toBe('Fish & Chips')
    expect(page.metaDescription).toBe('A tasty place')
    expect(page.canonicalUrl).toBe('https://example.com/')
    expect(page.robotsMeta).toBe('noindex, follow')
    expect(page.h1s).toEqual(['Welcome home'])
    expect(page.wordCount).toBeGreaterThanOrEqual(10)
    expect(page.wordCount).toBeLessThan(20) // nav text excluded
  })

  it('ignores script, style and comment content', () => {
    const page = extractPage(
      '<html><head><title>T</title><script>var a="<h1>fake</h1>"</script></head><body><!-- <h1>c</h1> --><h1>Real</h1><style>h1{}</style></body></html>',
      base,
    )
    expect(page.h1s).toEqual(['Real'])
  })

  it('counts only non-empty H1s', () => {
    expect(extractPage('<body><h1> </h1><h1>One</h1><h1>Two</h1></body>', base).h1s).toEqual(['One', 'Two'])
  })

  it('returns nulls for pages without head metadata', () => {
    const page = extractPage('<body><p>hello world</p></body>', base)
    expect(page.title).toBeNull()
    expect(page.metaDescription).toBeNull()
    expect(page.canonicalUrl).toBeNull()
    expect(page.wordCount).toBe(2)
  })

  it('resolves relative links and skips mailto, tel, javascript, anchors and nofollow', () => {
    const page = extractPage(
      `<body>
        <a href="/contact">c</a>
        <a href="team#bio">t</a>
        <a href="https://other.com/x">o</a>
        <a href="mailto:a@b.com">m</a>
        <a href="tel:123">t</a>
        <a href="javascript:void(0)">j</a>
        <a href="#top">a</a>
        <a href="/skip" rel="nofollow">n</a>
        <a href='/single'>s</a>
        <a>none</a>
      </body>`,
      base,
    )
    expect(page.links.map((l) => l.href)).toEqual([
      'https://example.com/contact',
      'https://example.com/services/team',
      'https://other.com/x',
      'https://example.com/single',
    ])
  })
})

describe('crawlSite', () => {
  const start = new URL('https://example.com/')
  const ok = { title: GOOD_TITLE, description: GOOD_DESC, h1: 'Heading' }

  it('crawls internal links breadth-first, de-duplicates and ignores external links and files', async () => {
    const log: string[] = []
    const fetcher = makeFetcher(
      {
        'https://example.com/': {
          body: html({
            ...ok,
            links: ['/about', '/about/', '/about#team', '/about?utm_source=news', 'https://other.com/', '/brochure.pdf', '/contact'],
          }),
        },
        'https://example.com/about': { body: html({ ...ok, title: GOOD_TITLE + ' About', links: ['/contact'] }) },
        'https://example.com/contact': { body: html({ ...ok, title: GOOD_TITLE + ' Contact' }) },
      },
      log,
    )

    const result = await crawlSite({ startUrl: start, fetcher })

    expect(result.stoppedReason).toBe('completed')
    expect(result.pages.map((p) => p.url)).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/contact',
    ])
    expect(result.pages.map((p) => p.depth)).toEqual([0, 1, 1])
    expect(log.filter((u) => u.includes('other.com'))).toHaveLength(0)
    expect(log.filter((u) => u.endsWith('.pdf'))).toHaveLength(0)
    expect(log.filter((u) => u === 'https://example.com/about')).toHaveLength(1)
  })

  it('records metadata and flags per-page issues', async () => {
    const fetcher = makeFetcher({
      'https://example.com/': { body: html({ links: ['/good'], words: 50 }) },
      'https://example.com/good': { body: html({ ...ok }) },
    })
    const result = await crawlSite({ startUrl: start, fetcher })
    const [home, good] = result.pages

    expect(home?.issues).toEqual(
      expect.arrayContaining(['missing_title', 'missing_meta_description', 'missing_h1', 'thin_content']),
    )
    expect(home?.issues[0]).toBe('missing_title') // errors sort before warnings
    expect(good?.title).toBe(GOOD_TITLE)
    expect(good?.h1).toBe('Heading')
    expect(good?.h1_count).toBe(1)
    expect(good?.canonical_url).toBe('https://example.com/')
    expect(good?.issues).toEqual([])
    expect(good?.word_count).toBeGreaterThan(300)
  })

  it('flags titles and descriptions that repeat across pages', async () => {
    const fetcher = makeFetcher({
      'https://example.com/': { body: html({ ...ok, links: ['/a', '/b'] }) },
      'https://example.com/a': { body: html({ ...ok, title: GOOD_TITLE.toUpperCase() }) },
      'https://example.com/b': { body: html({ ...ok, title: 'A completely different page title here', description: GOOD_DESC + ' Extra.' }) },
    })
    const { pages } = await crawlSite({ startUrl: start, fetcher })
    expect(pages[0]?.issues).toContain('duplicate_title')
    expect(pages[0]?.issues).toContain('duplicate_meta_description')
    expect(pages[1]?.issues).toContain('duplicate_title')
    expect(pages[2]?.issues).not.toContain('duplicate_title')
    expect(pages[2]?.issues).not.toContain('duplicate_meta_description')
  })

  it('records 404s, fetch failures and timeouts without aborting the crawl', async () => {
    const timeout = new Error('slow')
    timeout.name = 'TimeoutError'
    const fetcher = makeFetcher({
      'https://example.com/': { body: html({ ...ok, links: ['/missing', '/boom', '/slow'] }) },
      'https://example.com/missing': { status: 404, body: 'nope' },
      'https://example.com/boom': { delayError: new Error('ECONNRESET') },
      'https://example.com/slow': { delayError: timeout },
    })
    const { pages } = await crawlSite({ startUrl: start, fetcher })
    const byUrl = Object.fromEntries(pages.map((p) => [p.url, p]))

    expect(byUrl['https://example.com/missing']?.status_code).toBe(404)
    expect(byUrl['https://example.com/missing']?.issues).toEqual(['http_error'])
    expect(byUrl['https://example.com/boom']?.error).toBe('Could not connect')
    expect(byUrl['https://example.com/boom']?.issues).toEqual(['fetch_error'])
    expect(byUrl['https://example.com/slow']?.error).toBe('Timed out')
    expect(pages).toHaveLength(4)
  })

  it('follows same-site redirects and records the final URL', async () => {
    const fetcher = makeFetcher({
      'https://example.com/': { body: html({ ...ok, links: ['/old'] }) },
      'https://example.com/old': { status: 301, location: '/new' },
      'https://example.com/new': { body: html({ ...ok, title: GOOD_TITLE + ' New' }) },
    })
    const { pages } = await crawlSite({ startUrl: start, fetcher })
    const moved = pages.find((p) => p.url === 'https://example.com/old')
    expect(moved?.status_code).toBe(200)
    expect(moved?.final_url).toBe('https://example.com/new')
  })

  it('does not follow redirects to another site', async () => {
    const log: string[] = []
    const fetcher = makeFetcher(
      {
        'https://example.com/': { body: html({ ...ok, links: ['/away'] }) },
        'https://example.com/away': { status: 302, location: 'https://evil.example.net/landing' },
      },
      log,
    )
    const { pages } = await crawlSite({ startUrl: start, fetcher })
    const away = pages.find((p) => p.url.endsWith('/away'))
    expect(away?.status_code).toBe(302)
    expect(away?.final_url).toBe('https://evil.example.net/landing')
    expect(log.some((u) => u.includes('evil.example.net'))).toBe(false)
  })

  it('refuses redirects into private addresses', async () => {
    const log: string[] = []
    const fetcher = makeFetcher(
      {
        'https://example.com/': { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
      },
      log,
    )
    const { pages } = await crawlSite({ startUrl: start, fetcher })
    expect(log.some((u) => u.includes('169.254'))).toBe(false)
    expect(pages[0]?.status_code).toBe(302)
  })

  it('gives up on redirect loops', async () => {
    const fetcher = makeFetcher({
      'https://example.com/': { body: html({ ...ok, links: ['/a'] }) },
      'https://example.com/a': { status: 301, location: '/b' },
      'https://example.com/b': { status: 301, location: '/a' },
    })
    const { pages } = await crawlSite({ startUrl: start, fetcher })
    expect(pages.find((p) => p.url.endsWith('/a'))?.error).toBe('Too many redirects')
  })

  it('stops at the page limit and reports it', async () => {
    const routes: Record<string, Route> = {
      'https://example.com/': { body: html({ ...ok, links: ['/1', '/2', '/3', '/4', '/5'] }) },
    }
    for (const n of [1, 2, 3, 4, 5]) routes[`https://example.com/${n}`] = { body: html({ ...ok, title: `${GOOD_TITLE} ${n}` }) }
    const result = await crawlSite({ startUrl: start, fetcher: makeFetcher(routes), limits: { maxPages: 3 } })
    expect(result.pages).toHaveLength(3)
    expect(result.stoppedReason).toBe('page_limit')
  })

  it('stops when the time budget is spent', async () => {
    let clock = 0
    const fetcher = makeFetcher({
      'https://example.com/': { body: html({ ...ok, links: ['/a', '/b', '/c', '/d'] }) },
    })
    const timed: Fetcher = async (url, init) => {
      clock += 60_000
      return fetcher(url, init)
    }
    const result = await crawlSite({
      startUrl: start,
      fetcher: timed,
      now: () => clock,
      limits: { totalBudgetMs: 100_000, concurrency: 1 },
    })
    expect(result.stoppedReason).toBe('time_limit')
    expect(result.pages.length).toBeLessThan(5)
  })

  it('honours robots.txt for pages and for the start URL', async () => {
    const log: string[] = []
    const fetcher = makeFetcher(
      {
        'https://example.com/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /admin' },
        'https://example.com/': { body: html({ ...ok, links: ['/admin/panel', '/services'] }) },
        'https://example.com/services': { body: html({ ...ok, title: GOOD_TITLE + ' S' }) },
      },
      log,
    )
    const result = await crawlSite({ startUrl: start, fetcher })
    expect(log).not.toContain('https://example.com/admin/panel')
    expect(result.skippedByRobots).toBe(1)
    expect(result.pages).toHaveLength(2)

    const blocked = await crawlSite({
      startUrl: new URL('https://example.com/admin'),
      fetcher: makeFetcher({ 'https://example.com/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /admin' } }),
    })
    expect(blocked.stoppedReason).toBe('blocked_by_robots')
    expect(blocked.pages).toEqual([])
  })

  it('uses the host check to refuse hostnames that resolve to private addresses', async () => {
    const log: string[] = []
    const fetcher = makeFetcher({ 'https://example.com/': { body: html(ok) } }, log)
    const { pages } = await crawlSite({ startUrl: start, fetcher, hostCheck: async () => false })
    expect(log).toEqual([])
    expect(pages[0]?.issues).toEqual(['fetch_error'])
    expect(pages[0]?.error).toMatch(/not publicly reachable/)
  })

  it('records a non-HTML start URL as a failure but silently skips non-HTML links', async () => {
    const pdfStart = await crawlSite({
      startUrl: start,
      fetcher: makeFetcher({ 'https://example.com/': { type: 'application/pdf', body: '%PDF' } }),
    })
    expect(pdfStart.pages[0]?.error).toBe('Not an HTML page')

    const withFile = await crawlSite({
      startUrl: start,
      fetcher: makeFetcher({
        'https://example.com/': { body: html({ ...ok, links: ['/download'] }) },
        'https://example.com/download': { type: 'application/octet-stream', body: 'bin' },
      }),
    })
    expect(withFile.pages).toHaveLength(1)
  })

  it('sends an identifying user agent and manual redirect mode', async () => {
    const seen: RequestInit[] = []
    const fetcher: Fetcher = async (url, init) => {
      seen.push(init)
      return makeFetcher({ 'https://example.com/': { body: html(ok) } })(url, init)
    }
    await crawlSite({ startUrl: start, fetcher })
    expect(seen.length).toBeGreaterThan(0)
    for (const init of seen) {
      expect(init.redirect).toBe('manual')
      expect(JSON.stringify(init.headers)).toContain('LocalSEOWorkbenchBot')
    }
  })

  it('caps how much of a response body is read', async () => {
    const big = html({ ...ok, words: 5 }) + 'x'.repeat(5_000)
    const result = await crawlSite({
      startUrl: start,
      fetcher: makeFetcher({ 'https://example.com/': { body: big } }),
      limits: { maxBytes: 600 },
    })
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]?.status_code).toBe(200)
  })
})

describe('local signal extraction', () => {
  const base = new URL('https://example.com/')

  const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`

  it('summarises LocalBusiness JSON-LD, including @graph and array types', () => {
    const page = extractPage(
      `<html><head>${jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Site' },
          {
            '@type': ['Plumber', 'LocalBusiness'],
            name: 'Acme Plumbing',
            telephone: '+1 512-555-0142',
            url: 'https://acme.example',
            address: { '@type': 'PostalAddress', streetAddress: '12 Main St', addressLocality: 'Austin', addressRegion: 'TX', postalCode: '78701' },
            geo: { latitude: 1, longitude: 2 },
            openingHours: 'Mo-Fr 08:00-17:00',
            sameAs: ['https://facebook.com/acme', 'https://instagram.com/acme'],
            aggregateRating: { ratingValue: 4.8 },
          },
        ],
      })}</head><body><h1>Hi</h1></body></html>`,
      base,
    )
    expect(page.schemaTypes).toEqual(expect.arrayContaining(['WebSite', 'Plumber', 'LocalBusiness']))
    expect(page.schemaLocal).toEqual({
      types: ['Plumber', 'LocalBusiness'],
      name: 'Acme Plumbing',
      telephone: '+1 512-555-0142',
      address: '12 Main St, Austin, TX, 78701',
      has_geo: true,
      has_hours: true,
      same_as_count: 2,
      has_rating: true,
      url: 'https://acme.example',
    })
  })

  it('returns no local schema for non-local types, string addresses and invalid JSON', () => {
    const nonLocal = extractPage(`<head>${jsonLd({ '@type': 'Organization', name: 'Acme' })}</head>`, base)
    expect(nonLocal.schemaTypes).toEqual(['Organization'])
    expect(nonLocal.schemaLocal).toBeNull()

    const broken = extractPage('<head><script type="application/ld+json">{ not json</script></head>', base)
    expect(broken.schemaTypes).toEqual([])
    expect(broken.schemaLocal).toBeNull()

    const stringAddress = extractPage(
      `<head>${jsonLd({ '@type': 'Dentist', name: 'Smile', address: '5 Oak Ave, Dallas' })}</head>`,
      base,
    )
    expect(stringAddress.schemaLocal?.address).toBe('5 Oak Ave, Dallas')
    expect(stringAddress.schemaLocal?.telephone).toBeNull()
  })

  it('finds phone numbers in header/footer and tel: links, de-duplicated across formats', () => {
    const page = extractPage(
      `<body>
        <header>Call (512) 555-0142 today</header>
        <main><h1>Home</h1><p>Founded in 2026-10-16. Order 12345 ready.</p>
          <a href="tel:+15125550142">Call</a><a href="tel:+1-512-555-0199">Other</a>
        </main>
        <footer>Phone: 512.555.0142</footer>
      </body>`,
      base,
    )
    expect(page.phones).toHaveLength(2)
    expect(page.telLinks).toBe(2)
    expect(page.phones.join(' ')).toMatch(/512/)
  })

  it('does not mistake dates, short numbers or prices for phone numbers', () => {
    const page = extractPage('<body><p>Posted 2026-10-16. Price $1,234.50. Ref 123-45. Code 99999</p></body>', base)
    expect(page.phones).toEqual([])
    expect(page.telLinks).toBe(0)
  })

  it('excludes tel: links from crawlable links', () => {
    const page = extractPage('<body><a href="tel:5125550142">x</a><a href="/a">y</a></body>', base)
    expect(page.links.map((l) => l.pathname)).toEqual(['/a'])
  })

  it('captures h2s, address element, map embed and body text without nav/footer', () => {
    const page = extractPage(
      `<body>
        <nav>Menu items</nav>
        <h1>Plumber in Austin</h1>
        <h2>Drain cleaning</h2><h2>Water heaters</h2>
        <p>We serve Austin homeowners.</p>
        <iframe src="https://www.google.com/maps/embed?pb=123"></iframe>
        <footer><address>12 Main St<br>Austin, TX 78701</address></footer>
      </body>`,
      base,
    )
    expect(page.h2s).toEqual(['Drain cleaning', 'Water heaters'])
    expect(page.hasMapEmbed).toBe(true)
    expect(page.addressText).toBe('12 Main St Austin, TX 78701')
    expect(page.bodyText).toContain('We serve Austin homeowners.')
    expect(page.bodyText).not.toContain('Menu items')
    expect(page.bodyText).not.toContain('78701')
  })

  it('caps stored body text', () => {
    const page = extractPage(`<body><p>${'word '.repeat(10_000)}</p></body>`, base)
    expect(page.bodyText.length).toBeLessThanOrEqual(12_000)
    expect(page.wordCount).toBe(10_000)
  })
})

describe('crawlSite stores local signals', () => {
  it('records signals, internal link paths and the signals version on each page', async () => {
    const body = `<html><head><title>${GOOD_TITLE}</title><meta name="description" content="${GOOD_DESC}">
      <script type="application/ld+json">{"@type":"Plumber","name":"Acme","telephone":"512-555-0142"}</script></head>
      <body><h1>Plumber in Austin</h1><h2>Services</h2><a href="tel:5125550142">Call</a>
      <a href="/contact">Contact</a><a href="/services/drains?x=1">Drains</a><a href="https://other.com/">Out</a>
      <p>${'word '.repeat(350)}</p></body></html>`
    const result = await crawlSite({
      startUrl: new URL('https://example.com/'),
      fetcher: makeFetcher({ 'https://example.com/': { body } }),
      limits: { maxPages: 1 },
    })
    const page = result.pages[0]
    expect(page?.local_version).toBe(1)
    expect(page?.schema_local?.name).toBe('Acme')
    expect(page?.phones).toHaveLength(1)
    expect(page?.tel_links).toBe(1)
    expect(page?.h2s).toEqual(['Services'])
    expect(page?.link_paths).toEqual(['/contact', '/services/drains?x=1'])
    expect(page?.body_text).toContain('Plumber in Austin')
  })

  it('gives failed pages empty signals', async () => {
    const result = await crawlSite({
      startUrl: new URL('https://example.com/'),
      fetcher: makeFetcher({ 'https://example.com/': { status: 500, body: 'x' } }),
    })
    const page = result.pages[0]
    expect(page?.phones).toEqual([])
    expect(page?.schema_local).toBeNull()
    expect(page?.body_text).toBeNull()
    expect(page?.link_paths).toEqual([])
  })
})

describe('resumable crawl in slices', () => {
  const start = new URL('https://example.com/')
  const ok = { title: GOOD_TITLE, description: GOOD_DESC, h1: 'Heading' }

  function siteWith(count: number): Record<string, Route> {
    const links = Array.from({ length: count - 1 }, (_, i) => `/p${i + 1}`)
    const routes: Record<string, Route> = { 'https://example.com/': { body: html({ ...ok, links }) } }
    for (const [i, path] of links.entries()) {
      // every page links back to two others, so de-duplication across slices matters
      routes[`https://example.com${path}`] = {
        body: html({ ...ok, title: `${GOOD_TITLE} ${i}`, description: `${GOOD_DESC} ${i}`, links: ['/', links[(i + 1) % links.length] ?? '/'] }),
      }
    }
    return routes
  }

  it('defaults to a 1,000-page limit with 5 pages at a time', () => {
    expect(DEFAULT_LIMITS.maxPages).toBe(1000)
    expect(DEFAULT_LIMITS.concurrency).toBe(5)
  })

  it('crawls the same pages in several slices as in one go, without repeats', async () => {
    const routes = siteWith(23)
    const whole = await crawlSite({ startUrl: start, fetcher: makeFetcher(routes) })

    const log: string[] = []
    const fetcher = makeFetcher(routes, log)
    let state = await beginCrawl({ startUrl: start, fetcher })
    expect(state).not.toBeNull()
    const urls: string[] = []
    let slices = 0
    for (;;) {
      slices += 1
      // round-trip through JSON, as the Edge Function stores state in the database between calls
      const step = await crawlStep({ startUrl: start, fetcher, state: JSON.parse(JSON.stringify(state)), deadline: Infinity, stepMaxPages: 5 })
      urls.push(...step.pages.map((p) => p.url))
      state = step.state
      if (step.outcome !== 'slice_end') {
        expect(step.outcome).toBe('completed')
        break
      }
    }

    expect(slices).toBe(5)
    expect(urls).toEqual(whole.pages.map((p) => p.url))
    expect(new Set(urls).size).toBe(23)
    expect(log.filter((u) => u === 'https://example.com/p3')).toHaveLength(1)
  })

  it('stops at the total page limit across slices', async () => {
    const routes = siteWith(30)
    const fetcher = makeFetcher(routes)
    let state = await beginCrawl({ startUrl: start, fetcher })
    let total = 0
    let outcome = 'slice_end'
    while (state && outcome === 'slice_end') {
      const step = await crawlStep({ startUrl: start, fetcher, state, deadline: Infinity, stepMaxPages: 4, limits: { maxPages: 10 } })
      total += step.pages.length
      outcome = step.outcome
      state = step.state
    }
    expect(total).toBe(10)
    expect(outcome).toBe('page_limit')
  })

  it('ends a slice at its deadline and keeps the rest of the queue', async () => {
    let clock = 0
    const base = makeFetcher(siteWith(12))
    const fetcher: Fetcher = async (url, init) => {
      clock += 10_000
      return base(url, init)
    }
    const state = await beginCrawl({ startUrl: start, fetcher, now: () => clock })
    if (!state) throw new Error('expected state')
    const step = await crawlStep({ startUrl: start, fetcher, now: () => clock, state, deadline: clock + 25_000, limits: { concurrency: 1 } })
    expect(step.outcome).toBe('slice_end')
    expect(step.pages.length).toBeGreaterThan(0)
    expect(step.pages.length).toBeLessThan(12)
    expect(step.state.queue.length).toBeGreaterThan(0)
  })

  it('returns null from beginCrawl when robots.txt blocks the start page', async () => {
    const fetcher = makeFetcher({ 'https://example.com/robots.txt': { body: 'User-agent: *\nDisallow: /', type: 'text/plain' } })
    expect(await beginCrawl({ startUrl: start, fetcher })).toBeNull()
  })

  it('validates stored state', () => {
    expect(isCrawlState({ v: 1, queue: [], seen: [], robots: { allow: [], disallow: [] }, scheduled: 0, skippedByRobots: 0 })).toBe(true)
    expect(isCrawlState({ v: 2 })).toBe(false)
    expect(isCrawlState(null)).toBe(false)
    expect(isCrawlState({ v: 1, queue: 'x', seen: [], robots: { allow: [], disallow: [] }, scheduled: 0, skippedByRobots: 0 })).toBe(false)
  })

  it('ignores queued URLs from other sites in tampered state', async () => {
    const log: string[] = []
    const fetcher = makeFetcher({}, log)
    await crawlStep({
      startUrl: start,
      fetcher,
      state: { v: 1, queue: [{ u: 'https://evil.example/', d: 1 }, { u: 'http://127.0.0.1/', d: 1 }], seen: [], robots: { allow: [], disallow: [] }, scheduled: 0, skippedByRobots: 0 },
      deadline: Infinity,
    })
    expect(log).toEqual([])
  })

  it('adds duplicate issues across pages from different slices', () => {
    let n = 0
    const page = (title: string, extra: Partial<{ status_code: number | null; error: string | null; issues: string[] }> = {}) => ({
      title,
      meta_description: `Unique description ${(n += 1)}`,
      status_code: 200,
      error: null,
      issues: ['missing_canonical'],
      ...extra,
    })
    const updated = applyDuplicateIssues([
      page('Same title'),
      page('Other'),
      page('same title '),
      page('Same title', { status_code: 404, issues: ['http_error'] }),
    ])
    expect(updated[0]).toEqual(['duplicate_title', 'missing_canonical'])
    expect(updated[1]).toBeNull()
    expect(updated[2]).toEqual(['duplicate_title', 'missing_canonical'])
    expect(updated[3]).toBeNull() // broken pages are not compared
    // already flagged pages are left alone
    expect(applyDuplicateIssues([page('A', { issues: ['duplicate_title'] }), page('A', { issues: ['duplicate_title'] })])).toEqual([null, null])
  })
})

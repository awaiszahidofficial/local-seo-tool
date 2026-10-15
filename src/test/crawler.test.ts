import { describe, expect, it } from 'vitest'
import {
  crawlSite,
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

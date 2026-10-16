import { describe, expect, it } from 'vitest'
import type { ProjectBundle } from '../lib/projectBundle'
import { buildRecommendations, recScore, splitByState } from '../lib/recommendations'
import { buildSnapshot, defaultReportTitle, isReportSnapshot } from '../lib/reportSnapshot'
import type { BusinessListingRow, GbpProfileRow } from '../types/database'
import { makeCrawl, makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  name: 'Acme',
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  business_type: 'Plumber',
  service_areas: ['Austin, TX', 'Round Rock, TX'],
  services: ['Drain cleaning'],
  gsc_property: 'sc-domain:acme.example',
})

const body = 'Acme Plumbing serves Austin with drain cleaning. Austin homes, Austin businesses. '.repeat(20)

const pages = [
  makeCrawlPage({ url: 'https://acme.example/', title: 'Acme Plumbing', h1: 'Plumbers', body_text: body, link_paths: ['/drain-cleaning-austin'] }),
  makeCrawlPage({ url: 'https://acme.example/drain-cleaning-austin', title: 'Drain Cleaning in Austin', h1: 'Drain cleaning Austin', body_text: body, word_count: 600 }),
  makeCrawlPage({ url: 'https://acme.example/old', status_code: 404, title: null, h1: null, issues: ['http_error'] }),
]

const gbp = {
  project_id: project.id,
  user_id: project.user_id,
  verified: false,
  business_name: 'Acme Plumbing',
  primary_category: 'Plumber',
  additional_categories: [],
  phone: '(512) 555-0142',
  website_url: 'https://acme.example',
  address: null,
  service_area_business: true,
  gbp_service_areas: ['Austin'],
  has_hours: true,
  has_special_hours: true,
  description: null,
  services: [],
  products_count: null,
  photos_count: null,
  has_logo: null,
  has_cover_photo: null,
  review_count: 4,
  rating: 4.9,
  reviews_last_90_days: null,
  reply_rate: null,
  last_post_date: null,
  attributes_count: null,
  has_booking_link: null,
  created_at: '',
  updated_at: '',
} satisfies GbpProfileRow

const yelp: BusinessListingRow = {
  id: '00000000-0000-4000-8000-0000000000aa',
  project_id: project.id,
  user_id: project.user_id,
  directory: 'Yelp',
  listing_url: null,
  status: 'live',
  name: 'Acme Plumbing',
  address: null,
  phone: '512-555-9999',
  website: null,
  notes: null,
  last_checked: null,
  created_at: '',
  updated_at: '',
}

const row = (key: string, clicks: number, impressions: number, position: number) => ({ key, clicks, impressions, ctr: clicks / impressions, position })

const bundle: ProjectBundle = {
  crawl: makeCrawl(),
  pages,
  gbp,
  listings: [yelp],
  gsc: {
    property: 'sc-domain:acme.example',
    ranges: { current: { startDate: '2026-09-17', endDate: '2026-10-14' }, previous: { startDate: '2026-08-20', endDate: '2026-09-16' } },
    totals: { current: { clicks: 50, impressions: 2000, ctr: 0.025, position: 12 }, previous: { clicks: 40, impressions: 1800, ctr: 0.022, position: 13 } },
    queries: { current: [row('drain cleaning austin', 10, 300, 8.4), row('plumber austin', 2, 800, 3)], previous: [] },
    pages: { current: [], previous: [] },
  },
  gscState: 'ok',
  problems: [],
}

describe('buildRecommendations', () => {
  const recs = buildRecommendations(project, bundle)
  const keys = recs.map((rec) => rec.key)

  it('collects findings from every module with stable keys', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'crawler:http_error',
        'coverage:page:round-rock-tx',
        'gbp:verified',
        'gbp:review_count',
        `listings:fix:${yelp.id}`,
        'listings:add:google-business-profile',
        'gsc:striking:drain-cleaning-austin',
        'gsc:ctr:plumber-austin',
      ]),
    )
    expect(keys.some((key) => key.startsWith('audit:'))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('ranks by impact first, then effort', () => {
    const scores = recs.map(recScore)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(recs[0]?.impact).toBe('high')
  })

  it('asks for missing setup instead of guessing', () => {
    const empty = buildRecommendations(makeProject(), { crawl: null, pages: [], gbp: null, listings: [], gsc: null, gscState: 'not_connected', problems: [] })
    expect(empty.map((rec) => rec.key)).toEqual(
      expect.arrayContaining(['setup:crawl', 'setup:areas', 'setup:gbp', 'setup:gsc']),
    )
    expect(empty.some((rec) => rec.module === 'crawler')).toBe(false)
  })

  it('splits by saved state', () => {
    const split = splitByState(recs, [
      { rec_key: 'gbp:verified', status: 'done' },
      { rec_key: 'crawler:http_error', status: 'dismissed' },
    ])
    expect(split.done.map((rec) => rec.key)).toEqual(['gbp:verified'])
    expect(split.dismissed.map((rec) => rec.key)).toEqual(['crawler:http_error'])
    expect(split.open).toHaveLength(recs.length - 2)
  })
})

describe('buildSnapshot', () => {
  it('captures every module in a JSON-safe snapshot', () => {
    const snapshot = buildSnapshot(project, bundle, [{ rec_key: 'gbp:verified', status: 'done' }], new Date('2026-10-17T10:00:00Z'))
    expect(isReportSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true)
    expect(snapshot.crawl).toMatchObject({ pages: 3, pagesWithErrors: 1 })
    expect(snapshot.coverage?.areas.map((area) => area.status)).toEqual(['covered', 'missing'])
    expect(snapshot.gbp).toMatchObject({ reviews: 4, rating: 4.9 })
    expect(snapshot.listings).toMatchObject({ tracked: 1, needFixing: 1 })
    expect(snapshot.searchConsole).toMatchObject({ clicks: 50, clicksChangePct: 25 })
    expect(snapshot.searchConsole?.topQueries[0]?.query).toBe('drain cleaning austin')
    expect(snapshot.recommendations.done).toBe(1)
    expect(snapshot.recommendations.top.length).toBeLessThanOrEqual(10)
  })

  it('leaves missing modules empty', () => {
    const snapshot = buildSnapshot(makeProject(), { crawl: null, pages: [], gbp: null, listings: null, gsc: null, gscState: 'not_configured', problems: [] }, [])
    expect(snapshot).toMatchObject({ crawl: null, audit: null, coverage: null, gbp: null, listings: null, searchConsole: null })
  })

  it('suggests a monthly title', () => {
    expect(defaultReportTitle({ name: 'Rodeo Blinds' }, new Date('2026-10-17T10:00:00Z'))).toBe('Rodeo Blinds: local SEO report, October 2026')
  })
})

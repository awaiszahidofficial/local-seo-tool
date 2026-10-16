import { describe, expect, it } from 'vitest'
import { dailySeries, niceMax } from '../lib/gscAnalysis'
import { bandFor, mapWithLimit, scoreClient } from '../lib/visibilityScore'
import type { BusinessListingRow, GbpProfileRow } from '../types/database'
import { makeCrawl, makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({ business_name: 'Acme', location: 'Austin, TX', service_areas: ['Austin, TX', 'Round Rock, TX'], business_type: 'Plumber' })

const listing = (directory: string, overrides: Partial<BusinessListingRow> = {}): BusinessListingRow => ({
  id: `00000000-0000-4000-8000-${String(directory.length).padStart(12, '0')}`,
  project_id: project.id,
  user_id: 'u',
  directory,
  listing_url: null,
  status: 'live',
  name: 'Acme',
  address: null,
  phone: null,
  website: null,
  notes: null,
  last_checked: null,
  created_at: '',
  updated_at: '',
  ...overrides,
})

describe('scoreClient', () => {
  it('leaves out parts with no data instead of counting them as zero', () => {
    const score = scoreClient(project, { crawl: null, pages: [], gbp: null, listings: [] })
    expect(score.overall).toBeNull()
    expect(score.parts).toEqual({ website: null, areas: null, profile: null, listings: null })
    expect(score.focus).toBe('website')
  })

  it('scores website health and service-area coverage from the crawl', () => {
    const pages = [
      makeCrawlPage({ url: 'https://acme.example/', issues: [] }),
      makeCrawlPage({ url: 'https://acme.example/austin', title: 'Plumber in Austin', h1: 'Austin plumber', issues: [] }),
      makeCrawlPage({ url: 'https://acme.example/old', status_code: 404, issues: ['http_error'] }),
      makeCrawlPage({ url: 'https://acme.example/x', issues: ['missing_title'] }),
    ]
    const score = scoreClient(project, { crawl: makeCrawl(), pages, gbp: null, listings: null })
    expect(score.parts.website).toBe(50)
    expect(score.parts.areas).toBe(50)
    expect(score.overall).toBe(50)
    expect(score.pagesCrawled).toBe(4)
    expect(score.focus).toBe('website')
  })

  it('weights listings by essential coverage and consistency', () => {
    const listings = ['Google Business Profile', 'Bing Places', 'Apple Business Connect', 'Facebook', 'Yelp'].map((name) => listing(name))
    const score = scoreClient(project, { crawl: null, pages: [], gbp: null, listings })
    expect(score.parts.listings).toBe(100)
    const partial = scoreClient(project, { crawl: null, pages: [], gbp: null, listings: [listing('Yelp', { name: 'Other Name' })] })
    expect(partial.parts.listings).toBe(10)
  })

  it('includes the Business Profile score', () => {
    const filled: GbpProfileRow = {
      project_id: project.id,
      user_id: 'u',
      verified: true,
      business_name: 'Acme',
      primary_category: 'Plumber',
      additional_categories: [],
      phone: null,
      website_url: null,
      address: null,
      service_area_business: false,
      gbp_service_areas: [],
      has_hours: null,
      has_special_hours: null,
      description: null,
      services: [],
      products_count: null,
      photos_count: null,
      has_logo: null,
      has_cover_photo: null,
      review_count: 100,
      rating: 4.9,
      reviews_last_90_days: null,
      reply_rate: null,
      last_post_date: null,
      attributes_count: null,
      has_booking_link: null,
      created_at: '',
      updated_at: '',
    }
    const score = scoreClient(project, { crawl: null, pages: [], gbp: filled, listings: null })
    expect(score.parts.profile).not.toBeNull()
    expect(score.overall).toBe(score.parts.profile)
  })

  it('bands scores', () => {
    expect([bandFor(80), bandFor(60), bandFor(10)]).toEqual(['strong', 'fair', 'weak'])
  })
})

describe('mapWithLimit', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const result = await mapWithLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return n * 2
    })
    expect(result).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })
})

describe('daily trend helpers', () => {
  it('fills every day of the range, with zero for missing days', () => {
    const series = dailySeries({ startDate: '2026-10-01', endDate: '2026-10-04' }, [
      { key: '2026-10-02', clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
    ])
    expect(series.map((point) => [point.date, point.clicks])).toEqual([
      ['2026-10-01', 0],
      ['2026-10-02', 5],
      ['2026-10-03', 0],
      ['2026-10-04', 0],
    ])
  })

  it('rounds axis maxima to tidy numbers', () => {
    expect([niceMax(0), niceMax(7), niceMax(13), niceMax(240), niceMax(4100)]).toEqual([1, 10, 20, 250, 5000])
  })
})

import { describe, expect, it } from 'vitest'
import { buildKeyword, buildKeywordReport, keywordsToCsv } from '../lib/keywords'
import { makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  service_areas: ['Austin, TX', 'Round Rock, TX'],
  services: ['Drain cleaning', 'Water heater repair'],
})

const pages = [
  makeCrawlPage({ url: 'https://acme.example/drain-cleaning-austin', title: 'Drain Cleaning in Austin, TX', h1: 'Drain cleaning Austin', word_count: 600 }),
  makeCrawlPage({ url: 'https://acme.example/water-heater-repair', title: 'Water Heater Repair', h1: 'Water heater repair', word_count: 500 }),
  makeCrawlPage({ url: 'https://acme.example/broken', status_code: 404, title: 'Drain cleaning Round Rock', h1: 'Drain cleaning Round Rock' }),
]

const row = (key: string, clicks: number, impressions: number, position: number) => ({ key, clicks, impressions, ctr: clicks / impressions, position })

describe('buildKeyword', () => {
  it('fills each pattern', () => {
    expect(buildKeyword('core', 'Drain Cleaning', 'Round Rock')).toBe('drain cleaning round rock')
    expect(buildKeyword('near_me', 'Drain Cleaning', null)).toBe('drain cleaning near me')
    expect(buildKeyword('best', 'Drain Cleaning', 'Austin')).toBe('best drain cleaning austin')
  })
})

describe('buildKeywordReport', () => {
  it('builds service × area keywords plus near-me, maps pages, and orders missing pages first', () => {
    const report = buildKeywordReport(project, pages, null)
    expect(report.rows.map((r) => r.keyword).sort()).toEqual(
      [
        'drain cleaning austin',
        'drain cleaning round rock',
        'drain cleaning near me',
        'water heater repair austin',
        'water heater repair round rock',
        'water heater repair near me',
      ].sort(),
    )
    const byKeyword = Object.fromEntries(report.rows.map((r) => [r.keyword, r]))
    expect(byKeyword['drain cleaning austin']?.page).toMatchObject({ match: 'dedicated', url: 'https://acme.example/drain-cleaning-austin' })
    expect(byKeyword['drain cleaning round rock']?.action).toBe('create_page') // the 404 page does not count
    expect(byKeyword['water heater repair austin']?.page?.match).toBe('service_only')
    expect(byKeyword['water heater repair near me']?.page?.match).toBe('dedicated')
    expect(byKeyword['drain cleaning austin']?.status).toBe('unknown')
    expect(report.rows[0]?.action).toBe('create_page')
    expect(report.gscUsed).toBe(false)
  })

  it('matches Search Console searches by service and area and grades the position', () => {
    const queries = [
      row('drain cleaning austin tx', 20, 400, 2.5),
      row('austin drain cleaning service', 5, 200, 6.5),
      row('drain cleaning near me', 3, 300, 14),
      row('emergency plumber round rock', 2, 50, 9),
      row('plumbing tips', 1, 80, 30),
    ]
    const report = buildKeywordReport(project, pages, queries)
    const austin = report.rows.find((r) => r.keyword === 'drain cleaning austin')
    expect(austin?.gsc).toMatchObject({ clicks: 25, impressions: 600, matchingQueries: 2, topQuery: 'drain cleaning austin tx' })
    expect(austin?.gsc?.position).toBe(3.8)
    expect(austin?.status).toBe('page1')
    expect(austin?.action).toBe('push_top')
    expect(report.rows.find((r) => r.keyword === 'drain cleaning near me')?.status).toBe('striking')
    expect(report.rows.find((r) => r.keyword === 'water heater repair austin')?.status).toBe('no_data')
    expect(report.discovered.map((r) => r.key)).toEqual(['emergency plumber round rock'])
  })

  it('returns nothing when services or areas are missing', () => {
    expect(buildKeywordReport(makeProject(), pages, null).rows).toEqual([])
  })

  it('exports CSV with escaping and formula protection', () => {
    const report = buildKeywordReport(makeProject({ services: ['=cmd, "x"'], service_areas: ['Austin'] }), [], null, ['core'])
    const csv = keywordsToCsv(report.rows)
    expect(csv.split('\r\n')[0]).toBe('Keyword,Service,Area,Status,Avg position,Impressions,Clicks,Top matching search,Page,Action')
    expect(csv).toContain(`"'=cmd, ""x"""`)
  })
})
